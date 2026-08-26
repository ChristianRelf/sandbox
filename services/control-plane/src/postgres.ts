import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, BuiltInRole, Permission, WorkflowRevision } from "@sandbox/contracts";
import { permissions as allPermissions, rolePermissionMatrix } from "@sandbox/contracts";
import { Pool, type PoolClient } from "pg";
import type { AuthenticatedSession, ControlPlaneRepository, InvitationInput, InvitationRecord, OrganisationInput, PluginSubmissionInput, PluginSubmissionRecord, PublisherInput, SyncedWorkflowInput, SyncWriteResult } from "./types.js";
import { DomainError } from "./types.js";

export class PostgresRepository implements ControlPlaneRepository {
  constructor(private readonly pool: Pool) {}

  async permissions(accountId: string, workspaceId: string): Promise<ReadonlySet<Permission>> {
    return this.withAccount(accountId, async client => {
      const result = await client.query<{ permission: Permission }>(
        `SELECT rp.permission
           FROM workspace_memberships wm
           JOIN role_permissions rp ON rp.role_id = wm.role_id
          WHERE wm.workspace_id = $1 AND wm.account_id = $2`,
        [workspaceId, accountId]
      );
      return new Set(result.rows.map(row => row.permission).filter(permission => allPermissions.includes(permission)));
    });
  }

  async createOrganisation(actor: AuthenticatedSession, input: OrganisationInput, correlationId: string) {
    return this.withAccount(actor.accountId, async client => {
      const organisation = await client.query<{ id: string; name: string; slug: string; created_at: Date }>(
        `INSERT INTO organisations(name, slug, created_by) VALUES($1, $2, $3) RETURNING id, name, slug, created_at`,
        [input.name, input.slug, actor.accountId]
      );
      const organisationId = organisation.rows[0].id;
      const workspace = await client.query<{ id: string; name: string; slug: string; created_at: Date }>(
        `INSERT INTO workspaces(organisation_id, name, slug, created_by) VALUES($1, $2, 'default', $3) RETURNING id, name, slug, created_at`,
        [organisationId, `${input.name} workspace`, actor.accountId]
      );
      const roleIds = new Map<BuiltInRole, string>();
      for (const role of Object.keys(rolePermissionMatrix) as BuiltInRole[]) {
        const inserted = await client.query<{ id: string }>(
          `INSERT INTO roles(organisation_id, role_key, display_name, built_in) VALUES($1, $2, $3, true) RETURNING id`,
          [organisationId, role, role[0].toUpperCase() + role.slice(1)]
        );
        roleIds.set(role, inserted.rows[0].id);
        for (const permission of rolePermissionMatrix[role]) {
          await client.query(`INSERT INTO role_permissions(role_id, permission) VALUES($1, $2)`, [inserted.rows[0].id, permission]);
        }
      }
      const ownerRole = roleIds.get("owner")!;
      await client.query(`INSERT INTO memberships(organisation_id, account_id, role_id) VALUES($1, $2, $3)`, [organisationId, actor.accountId, ownerRole]);
      await client.query(`INSERT INTO workspace_memberships(workspace_id, account_id, role_id) VALUES($1, $2, $3)`, [workspace.rows[0].id, actor.accountId, ownerRole]);
      await client.query(`INSERT INTO environments(workspace_id, environment_key) VALUES($1, 'development'), ($1, 'production')`, [workspace.rows[0].id]);
      await appendAudit(client, actor, workspace.rows[0].id, "organisation.created", "organisation", organisationId, null, { name: input.name, slug: input.slug }, correlationId);
      return {
        organisation: { id: organisationId, name: input.name, slug: input.slug, createdAt: organisation.rows[0].created_at.toISOString() },
        workspace: { id: workspace.rows[0].id, organisationId, name: workspace.rows[0].name, slug: workspace.rows[0].slug, createdAt: workspace.rows[0].created_at.toISOString() }
      };
    });
  }

  async createInvitation(actor: AuthenticatedSession, workspaceId: string, input: InvitationInput, correlationId: string): Promise<InvitationRecord> {
    return this.withAccount(actor.accountId, async client => {
      const workspace = await client.query<{ organisation_id: string }>(`SELECT organisation_id FROM workspaces WHERE id = $1`, [workspaceId]);
      if (!workspace.rowCount) throw new DomainError("workspace_not_found", "Workspace not found or not accessible.", 404);
      const role = await client.query<{ id: string }>(`SELECT id FROM roles WHERE organisation_id = $1 AND role_key = $2 AND built_in`, [workspace.rows[0].organisation_id, input.role]);
      if (!role.rowCount) throw new DomainError("role_not_found", "Invitation role is unavailable.", 400);
      const invitation = await client.query<{ id: string }>(
        `INSERT INTO invitations(organisation_id, email, role_id, token_hash, invited_by, expires_at)
         VALUES($1, lower($2), $3, $4, $5, $6) RETURNING id`,
        [workspace.rows[0].organisation_id, input.email, role.rows[0].id, input.tokenHash, actor.accountId, input.expiresAt]
      );
      for (const selectedWorkspaceId of input.workspaceIds) {
        const selected = await client.query(`SELECT 1 FROM workspaces WHERE id = $1 AND organisation_id = $2`, [selectedWorkspaceId, workspace.rows[0].organisation_id]);
        if (!selected.rowCount) throw new DomainError("invalid_invitation_workspace", "Every invited workspace must belong to the same organisation.", 400);
        await client.query(`INSERT INTO invitation_workspaces(invitation_id, workspace_id) VALUES($1, $2)`, [invitation.rows[0].id, selectedWorkspaceId]);
      }
      await appendAudit(client, actor, workspaceId, "member.invited", "invitation", invitation.rows[0].id, null, { email: input.email, role: input.role, workspaceIds: input.workspaceIds }, correlationId);
      return { id: invitation.rows[0].id, organisationId: workspace.rows[0].organisation_id, workspaceIds: input.workspaceIds, email: input.email.toLowerCase(), role: input.role, expiresAt: input.expiresAt.toISOString(), status: "pending" };
    });
  }

  async acceptInvitation(actor: AuthenticatedSession, rawToken: string, correlationId: string) {
    const tokenHash = createHash("sha256").update(rawToken, "utf8").digest();
    return this.withAccount(actor.accountId, async client => {
      const invitation = await client.query<{ id: string; organisation_id: string; role_id: string; email: string }>(
        `SELECT id, organisation_id, role_id, email FROM invitations
          WHERE token_hash = $1 AND status = 'pending' AND expires_at > now() FOR UPDATE`,
        [tokenHash]
      );
      if (!invitation.rowCount) throw new DomainError("invitation_invalid", "Invitation is invalid, expired, revoked, or already accepted.", 404);
      if (invitation.rows[0].email.toLowerCase() !== actor.email.toLowerCase()) throw new DomainError("invitation_email_mismatch", "Sign in with the email address that was invited.", 403);
      const workspaces = await client.query<{ workspace_id: string }>(`SELECT workspace_id FROM invitation_workspaces WHERE invitation_id = $1`, [invitation.rows[0].id]);
      await client.query(
        `INSERT INTO memberships(organisation_id, account_id, role_id) VALUES($1, $2, $3)
         ON CONFLICT(organisation_id, account_id) DO UPDATE SET role_id = excluded.role_id, status = 'active', removed_at = NULL`,
        [invitation.rows[0].organisation_id, actor.accountId, invitation.rows[0].role_id]
      );
      for (const row of workspaces.rows) {
        await client.query(
          `INSERT INTO workspace_memberships(workspace_id, account_id, role_id) VALUES($1, $2, $3)
           ON CONFLICT(workspace_id, account_id) DO UPDATE SET role_id = excluded.role_id`,
          [row.workspace_id, actor.accountId, invitation.rows[0].role_id]
        );
      }
      await client.query(`UPDATE invitations SET status = 'accepted', accepted_by = $1, accepted_at = now() WHERE id = $2`, [actor.accountId, invitation.rows[0].id]);
      const firstWorkspace = workspaces.rows[0]?.workspace_id;
      if (firstWorkspace) await appendAudit(client, actor, firstWorkspace, "member.invitation_accepted", "invitation", invitation.rows[0].id, null, { accountId: actor.accountId }, correlationId);
      return { organisationId: invitation.rows[0].organisation_id, workspaceIds: workspaces.rows.map(row => row.workspace_id) };
    });
  }

  async createSyncedWorkflow(actor: AuthenticatedSession, workspaceId: string, input: SyncedWorkflowInput, correlationId: string) {
    return this.withAccount(actor.accountId, async client => {
      await client.query(
        `INSERT INTO synced_workflows(id, owner_type, owner_id, workspace_id, name)
         VALUES($1, 'workspace', $2, $2, $3)`,
        [input.workflowId, workspaceId, input.name]
      );
      await appendAudit(client, actor, workspaceId, "workflow.sync_enabled", "workflow", input.workflowId, null, { name: input.name }, correlationId);
      return { workflowId: input.workflowId, name: input.name, ownerType: "workspace" as const, ownerId: workspaceId };
    });
  }

  async appendWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, revision: WorkflowRevision, correlationId: string): Promise<SyncWriteResult> {
    return this.withAccount(actor.accountId, async client => {
      const workflow = await client.query<{ current_draft_revision_id: string | null }>(`SELECT current_draft_revision_id FROM synced_workflows WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [revision.workflowId, workspaceId]);
      if (!workflow.rowCount) throw new DomainError("workflow_not_found", "Workflow not found or not owned by this workspace.", 404);
      const current = workflow.rows[0].current_draft_revision_id;
      const conflictRevisionId = detectSyncConflict(current, revision.parentRevisionId);
      if (revision.parentRevisionId) {
        const parent = await client.query(`SELECT 1 FROM workflow_revisions WHERE id = $1 AND workflow_id = $2`, [revision.parentRevisionId, revision.workflowId]);
        if (!parent.rowCount) throw new DomainError("sync_parent_not_found", "The parent revision does not belong to this workflow. Refresh revision history and retry.", 409);
      }
      const existing = await client.query<{ content_hash: string }>(`SELECT content_hash FROM workflow_revisions WHERE id = $1`, [revision.revisionId]);
      if (existing.rowCount) {
        if (existing.rows[0].content_hash !== revision.contentHash) throw new DomainError("sync_revision_id_reused", "A revision ID cannot be reused for different content.", 409);
        return { revision: { ...revision, syncState: conflictRevisionId ? "conflicted" : "synced" }, conflictRevisionId };
      }
      await client.query(
        `INSERT INTO workflow_revisions(id, workflow_id, parent_revision_id, schema_version, content_hash, encrypted_payload, payload_key_envelope, searchable_metadata, plugin_requirements, permission_requirements, runner_policy, editor_device_id, updated_by, updated_at, publish_status, encryption_algorithm, encryption_key_version, sync_state)
         VALUES($1,$2,$3,$4,$5,decode($6,'base64'),decode($7,'base64'),$8,$9,$10,$11,$12,$13,$14,'draft',$15,$16,$17)`,
        [revision.revisionId, revision.workflowId, revision.parentRevisionId, revision.schemaVersion, revision.contentHash, revision.encryptedPayload, revision.payloadKeyEnvelope, { name: revision.searchableMetadata.name, folderId: revision.searchableMetadata.folderId }, revision.searchableMetadata.requiredPlugins, revision.searchableMetadata.permissionRequirements, revision.searchableMetadata.runnerPolicy, revision.editorDeviceId, actor.accountId, revision.updatedAt, revision.encryption.algorithm, revision.encryption.keyVersion, conflictRevisionId ? "conflicted" : "synced"]
      );
      if (!conflictRevisionId) await client.query(`UPDATE synced_workflows SET current_draft_revision_id = $1 WHERE id = $2`, [revision.revisionId, revision.workflowId]);
      await appendAudit(client, actor, workspaceId, conflictRevisionId ? "workflow.sync_conflict" : "workflow.revision_saved", "workflow_revision", revision.revisionId, null, { workflowId: revision.workflowId, parentRevisionId: revision.parentRevisionId, conflictRevisionId }, correlationId);
      return { revision: { ...revision, syncState: conflictRevisionId ? "conflicted" : "synced" }, conflictRevisionId };
    });
  }

  async listWorkflowRevisions(actor: AuthenticatedSession, workspaceId: string, workflowId: string, cursor: string | null, limit: number) {
    return this.withAccount(actor.accountId, async client => {
      const values: unknown[] = [workflowId, workspaceId, limit + 1];
      const cursorClause = cursor ? "AND (r.updated_at, r.id) < (SELECT updated_at, id FROM workflow_revisions WHERE id = $4 AND workflow_id = $1)" : "";
      if (cursor) values.push(cursor);
      const result = await client.query<WorkflowRevisionRow>(
        `SELECT r.id, r.workflow_id, r.parent_revision_id, r.schema_version, r.content_hash,
                encode(r.encrypted_payload,'base64') AS encrypted_payload,
                encode(r.payload_key_envelope,'base64') AS payload_key_envelope,
                r.searchable_metadata, r.plugin_requirements, r.permission_requirements, r.runner_policy,
                r.editor_device_id, r.updated_at, r.encryption_algorithm, r.encryption_key_version, r.sync_state
           FROM workflow_revisions r
           JOIN synced_workflows w ON w.id = r.workflow_id
          WHERE r.workflow_id = $1 AND w.workspace_id = $2 ${cursorClause}
          ORDER BY r.updated_at DESC, r.id DESC LIMIT $3`,
        values
      );
      const page = result.rows.slice(0, limit);
      return { items: page.map(workflowRevisionFromRow), nextCursor: result.rows.length > limit ? page.at(-1)!.id : null };
    });
  }

  async getWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string) {
    return this.withAccount(actor.accountId, async client => {
      const result = await client.query<WorkflowRevisionRow>(
        `SELECT r.id, r.workflow_id, r.parent_revision_id, r.schema_version, r.content_hash,
                encode(r.encrypted_payload,'base64') AS encrypted_payload,
                encode(r.payload_key_envelope,'base64') AS payload_key_envelope,
                r.searchable_metadata, r.plugin_requirements, r.permission_requirements, r.runner_policy,
                r.editor_device_id, r.updated_at, r.encryption_algorithm, r.encryption_key_version, r.sync_state
           FROM workflow_revisions r JOIN synced_workflows w ON w.id = r.workflow_id
          WHERE r.id = $1 AND r.workflow_id = $2 AND w.workspace_id = $3`,
        [revisionId, workflowId, workspaceId]
      );
      return result.rowCount ? workflowRevisionFromRow(result.rows[0]) : null;
    });
  }

  async resolveSyncConflict(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string, correlationId: string) {
    return this.withAccount(actor.accountId, async client => {
      const workflow = await client.query<{ current_draft_revision_id: string | null }>(`SELECT current_draft_revision_id FROM synced_workflows WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [workflowId, workspaceId]);
      if (!workflow.rowCount) throw new DomainError("workflow_not_found", "Workflow not found or not owned by this workspace.", 404);
      const selected = await client.query(`SELECT 1 FROM workflow_revisions WHERE id = $1 AND workflow_id = $2`, [revisionId, workflowId]);
      if (!selected.rowCount) throw new DomainError("revision_not_found", "The selected revision does not belong to this workflow.", 404);
      await client.query(`UPDATE synced_workflows SET current_draft_revision_id = $1 WHERE id = $2`, [revisionId, workflowId]);
      await client.query(`UPDATE workflow_revisions SET sync_state = CASE WHEN id = $1 THEN 'synced' ELSE sync_state END WHERE workflow_id = $2`, [revisionId, workflowId]);
      await appendAudit(client, actor, workspaceId, "workflow.sync_conflict_resolved", "workflow_revision", revisionId, { previousDraftRevisionId: workflow.rows[0].current_draft_revision_id }, { selectedRevisionId: revisionId }, correlationId);
      return { selectedRevisionId: revisionId };
    });
  }

  async createPublisher(actor: AuthenticatedSession, input: PublisherInput, correlationId: string) {
    return this.withAccount(actor.accountId, async client => {
      if (input.ownerType === "personal" && input.ownerId !== actor.accountId) throw new DomainError("publisher_owner_invalid", "A personal publisher must be owned by the authenticated account.", 403);
      if (input.ownerType === "organisation") {
        const owner = await client.query(`SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.organisation_id = $1 AND m.account_id = $2 AND m.status = 'active' AND r.role_key = 'owner'`, [input.ownerId, actor.accountId]);
        if (!owner.rowCount) throw new DomainError("publisher_owner_invalid", "Only an organisation owner can create its publisher profile.", 403);
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO publishers(public_id, owner_type, owner_id, public_name, slug, description, website, support_contact, security_contact)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [input.publicId, input.ownerType, input.ownerId, input.publicName, input.slug, input.description, input.website, input.supportContact, input.securityContact]
      );
      for (const permission of ["admin", "submit", "view", "manage_keys", "security"]) await client.query(`INSERT INTO publisher_members(publisher_id, account_id, permission) VALUES($1,$2,$3)`, [result.rows[0].id, actor.accountId, permission]);
      await appendPlatformAudit(client, actor, "publisher.created", "publisher", result.rows[0].id, { publicId: input.publicId, ownerType: input.ownerType, ownerId: input.ownerId }, correlationId);
      return { id: result.rows[0].id, publicId: input.publicId, slug: input.slug, verificationStatus: "unverified" as const };
    });
  }

  async registerPublisherSigningKey(actor: AuthenticatedSession, publisherId: string, keyId: string, publicKeyDerBase64: string, correlationId: string) {
    return this.withAccount(actor.accountId, async client => {
      await requirePublisherPermission(client, actor.accountId, publisherId, ["admin", "manage_keys"]);
      await client.query(`INSERT INTO publisher_signing_keys(publisher_id, key_id, algorithm, public_key) VALUES($1,$2,'ed25519',decode($3,'base64'))`, [publisherId, keyId, publicKeyDerBase64]);
      await appendPlatformAudit(client, actor, "publisher.signing_key_registered", "publisher_signing_key", `${publisherId}:${keyId}`, { publisherId, keyId, algorithm: "ed25519" }, correlationId);
      return { publisherId, keyId, algorithm: "ed25519" as const };
    });
  }

  async createPluginSubmission(actor: AuthenticatedSession, input: PluginSubmissionInput, objectKey: string, correlationId: string): Promise<PluginSubmissionRecord> {
    return this.withAccount(actor.accountId, async client => {
      const publisher = await requirePublisherPermission(client, actor.accountId, input.publisherId, ["admin", "submit"]);
      const key = await client.query(`SELECT 1 FROM publisher_signing_keys WHERE publisher_id = $1 AND key_id = $2 AND revoked_at IS NULL`, [input.publisherId, input.publisherKeyId]);
      if (!key.rowCount) throw new DomainError("publisher_key_not_active", "The manifest signing key is not registered or has been revoked.", 409);
      if (input.manifest.publisherId !== publisher.public_id || input.manifest.pluginId !== input.pluginId || input.manifest.version !== input.version || input.manifest.packageIntegrity !== input.packageIntegrity) {
        throw new DomainError("manifest_identity_mismatch", "Submission identity, version, integrity, and publisher must exactly match the manifest.", 400);
      }
      await client.query(
        `INSERT INTO plugins(id, publisher_id, visibility, owner_type, owner_id, name, summary)
         VALUES($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT(id) DO NOTHING`,
        [input.pluginId, input.publisherId, input.visibility, input.ownerType, input.ownerId, input.name, input.summary]
      );
      const plugin = await client.query<{ publisher_id: string }>(`SELECT publisher_id FROM plugins WHERE id = $1`, [input.pluginId]);
      if (!plugin.rowCount || plugin.rows[0].publisher_id !== input.publisherId) throw new DomainError("plugin_id_owned", "This immutable plugin ID belongs to another publisher.", 409);
      const version = await client.query<{ id: string }>(
        `INSERT INTO plugin_versions(plugin_id, version, manifest_version, manifest, package_integrity, package_object_key, package_size, publisher_key_id, minimum_host_version, maximum_host_version, capabilities, network_domains, dependency_inventory, reproducibility)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [input.pluginId, input.version, input.manifestVersion, input.manifest, input.packageIntegrity, objectKey, input.packageSize, input.publisherKeyId, input.minimumHostVersion, input.maximumHostVersion, input.capabilities, input.networkDomains, input.dependencyInventory, input.reproducibility]
      ).catch(error => {
        if ((error as { code?: string }).code === "23505") throw new DomainError("plugin_version_immutable", "This plugin version or package digest already exists and cannot be replaced.", 409);
        throw error;
      });
      const review = await client.query<{ id: string }>(`INSERT INTO plugin_reviews(plugin_version_id, status) VALUES($1, 'draft') RETURNING id`, [version.rows[0].id]);
      await appendPlatformAudit(client, actor, "plugin.submission_created", "plugin_review", review.rows[0].id, { pluginId: input.pluginId, version: input.version, integrity: input.packageIntegrity }, correlationId);
      return { reviewId: review.rows[0].id, pluginVersionId: version.rows[0].id, publisherPublicId: publisher.public_id, publisherKeyId: input.publisherKeyId, pluginId: input.pluginId, version: input.version, packageIntegrity: input.packageIntegrity, packageSize: input.packageSize, packageObjectKey: objectKey, status: "draft" };
    });
  }

  async getPluginSubmission(actor: AuthenticatedSession, publisherId: string, reviewId: string): Promise<PluginSubmissionRecord | null> {
    return this.withAccount(actor.accountId, async client => {
      await requirePublisherPermission(client, actor.accountId, publisherId, ["admin", "submit", "view"]);
      const result = await client.query<SubmissionRow>(
        `SELECT pr.id AS review_id, pv.id AS plugin_version_id, p.public_id AS publisher_public_id, pv.publisher_key_id,
                pv.plugin_id, pv.version, pv.package_integrity, pv.package_size, pv.package_object_key, pr.status::text
           FROM plugin_reviews pr JOIN plugin_versions pv ON pv.id = pr.plugin_version_id
           JOIN plugins pl ON pl.id = pv.plugin_id JOIN publishers p ON p.id = pl.publisher_id
          WHERE pr.id = $1 AND p.id = $2`, [reviewId, publisherId]
      );
      return result.rowCount ? submissionFromRow(result.rows[0]) : null;
    });
  }

  async recordAutomatedPluginReview(actor: AuthenticatedSession, publisherId: string, reviewId: string, results: Record<string, unknown>, passed: boolean, rejectionReasons: string[], correlationId: string): Promise<PluginSubmissionRecord> {
    return this.withAccount(actor.accountId, async client => {
      await requirePublisherPermission(client, actor.accountId, publisherId, ["admin", "submit"]);
      const updated = await client.query<SubmissionRow>(
        `UPDATE plugin_reviews pr SET status = $1, automated_results = $2, rejection_reasons = $3, submitted_at = COALESCE(submitted_at, now()), updated_at = now()
          FROM plugin_versions pv, plugins pl, publishers p
         WHERE pr.id = $4 AND pv.id = pr.plugin_version_id AND pl.id = pv.plugin_id AND p.id = pl.publisher_id AND p.id = $5 AND pr.status IN ('draft','submitted','automated_review','changes_requested')
         RETURNING pr.id AS review_id, pv.id AS plugin_version_id, p.public_id AS publisher_public_id, pv.publisher_key_id,
                   pv.plugin_id, pv.version, pv.package_integrity, pv.package_size, pv.package_object_key, pr.status::text`,
        [passed ? "manual_review" : "changes_requested", results, rejectionReasons, reviewId, publisherId]
      );
      if (!updated.rowCount) throw new DomainError("review_state_invalid", "This review cannot be submitted from its current state.", 409);
      await appendPlatformAudit(client, actor, passed ? "plugin.automated_review_passed" : "plugin.changes_requested", "plugin_review", reviewId, { rejectionReasons }, correlationId);
      return submissionFromRow(updated.rows[0]);
    });
  }

  async decidePluginReview(actor: AuthenticatedSession, reviewId: string, decision: "approved" | "changes_requested" | "rejected", reasons: string[], correlationId: string): Promise<void> {
    await this.withAccount(actor.accountId, async client => {
      const result = await client.query(`UPDATE plugin_reviews SET status = $1, rejection_reasons = $2, assigned_reviewer = $3, decided_at = CASE WHEN $1 IN ('approved','rejected') THEN now() ELSE decided_at END, updated_at = now() WHERE id = $4 AND status IN ('manual_review','changes_requested')`, [decision, reasons, actor.accountId, reviewId]);
      if (!result.rowCount) throw new DomainError("review_state_invalid", "Only a manual-review submission can receive this decision.", 409);
      await appendPlatformAudit(client, actor, `plugin.review_${decision}`, "plugin_review", reviewId, { reasons }, correlationId);
    });
  }

  async revokePluginVersion(actor: AuthenticatedSession, pluginVersionId: string, reason: string, securityNoticeUrl: string, correlationId: string): Promise<void> {
    await this.withAccount(actor.accountId, async client => {
      const version = await client.query<{ plugin_id: string }>(`UPDATE plugin_versions SET revoked_at = now(), revocation_reason = $1 WHERE id = $2 AND revoked_at IS NULL RETURNING plugin_id`, [reason, pluginVersionId]);
      if (!version.rowCount) throw new DomainError("plugin_version_not_found", "Plugin version not found or already revoked.", 404);
      await client.query(`UPDATE plugin_reviews SET status = 'suspended', updated_at = now() WHERE plugin_version_id = $1`, [pluginVersionId]);
      await client.query(`UPDATE plugin_listings SET security_notices = security_notices || $1::jsonb, suspended_at = CASE WHEN current_version_id = $2 THEN now() ELSE suspended_at END WHERE plugin_id = $3`, [JSON.stringify([{ versionId: pluginVersionId, reason, url: securityNoticeUrl, publishedAt: new Date().toISOString() }]), pluginVersionId, version.rows[0].plugin_id]);
      await appendPlatformAudit(client, actor, "plugin.version_revoked", "plugin_version", pluginVersionId, { reason, securityNoticeUrl }, correlationId);
    });
  }

  async listAuditEvents(actor: AuthenticatedSession, workspaceId: string, cursor: string | null, limit: number) {
    return this.withAccount(actor.accountId, async client => {
      const values: unknown[] = [workspaceId, limit + 1];
      const cursorClause = cursor ? "AND (occurred_at, id) < (SELECT occurred_at, id FROM audit_events WHERE id = $3)" : "";
      if (cursor) values.push(cursor);
      const result = await client.query<{
        id: string; occurred_at: Date; actor_account_id: string | null; action: string; resource_type: string; resource_id: string;
        before_summary: Record<string, unknown> | null; after_summary: Record<string, unknown> | null; source_device_id: string | null; correlation_id: string;
      }>(`SELECT id, occurred_at, actor_account_id, action, resource_type, resource_id, before_summary, after_summary, source_device_id, correlation_id
            FROM audit_events WHERE workspace_id = $1 ${cursorClause} ORDER BY occurred_at DESC, id DESC LIMIT $2`, values);
      const page = result.rows.slice(0, limit);
      return {
        items: page.map(row => ({ eventId: row.id, timestamp: row.occurred_at.toISOString(), actorAccountId: row.actor_account_id, workspaceId, action: row.action, resourceType: row.resource_type, resourceId: row.resource_id, beforeSummary: row.before_summary, afterSummary: row.after_summary, sourceDeviceId: row.source_device_id, correlationId: row.correlation_id } satisfies AuditEvent)),
        nextCursor: result.rows.length > limit ? page.at(-1)!.id : null
      };
    });
  }

  async exportAccountData(actor: AuthenticatedSession) {
    return this.withAccount(actor.accountId, async client => {
      const account = await client.query(`SELECT id, primary_email, email_verified, display_name, created_at FROM accounts WHERE id = $1`, [actor.accountId]);
      const memberships = await client.query(`SELECT organisation_id, role_id, status, joined_at FROM memberships WHERE account_id = $1`, [actor.accountId]);
      const sessions = await client.query(`SELECT id, device_name, created_at, last_seen_at, expires_at, revoked_at FROM account_sessions WHERE account_id = $1`, [actor.accountId]);
      return { exportedAt: new Date().toISOString(), account: account.rows[0] ?? null, memberships: memberships.rows, sessions: sessions.rows };
    });
  }

  async requestAccountDeletion(actor: AuthenticatedSession, correlationId: string): Promise<void> {
    await this.withAccount(actor.accountId, async client => {
      const owned = await client.query(`SELECT 1 FROM memberships m JOIN roles r ON r.id = m.role_id WHERE m.account_id = $1 AND r.role_key = 'owner' AND m.status = 'active'`, [actor.accountId]);
      if (owned.rowCount) throw new DomainError("ownership_transfer_required", "Transfer or delete owned organisations before deleting the account.", 409);
      await client.query(`UPDATE account_sessions SET revoked_at = now() WHERE account_id = $1 AND revoked_at IS NULL`, [actor.accountId]);
      await client.query(`UPDATE accounts SET deleted_at = now(), primary_email = concat('deleted+', id, '@invalid.local'), display_name = 'Deleted account' WHERE id = $1`, [actor.accountId]);
      void correlationId;
    });
  }

  async listSessions(actor: AuthenticatedSession) {
    return this.withAccount(actor.accountId, async client => {
      const result = await client.query<{ id: string; device_name: string; created_at: Date; last_seen_at: Date; expires_at: Date }>(
        `SELECT id, device_name, created_at, last_seen_at, expires_at FROM account_sessions WHERE account_id = $1 AND revoked_at IS NULL ORDER BY last_seen_at DESC`, [actor.accountId]
      );
      return result.rows.map(row => ({ id: row.id, deviceName: row.device_name, createdAt: row.created_at.toISOString(), lastSeenAt: row.last_seen_at.toISOString(), expiresAt: row.expires_at.toISOString(), current: row.id === actor.sessionId }));
    });
  }

  async revokeSession(actor: AuthenticatedSession, sessionId: string, correlationId: string): Promise<boolean> {
    return this.withAccount(actor.accountId, async client => {
      const result = await client.query(`UPDATE account_sessions SET revoked_at = now() WHERE id = $1 AND account_id = $2 AND revoked_at IS NULL`, [sessionId, actor.accountId]);
      void correlationId;
      return (result.rowCount ?? 0) > 0;
    });
  }

  private async withAccount<T>(accountId: string, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SELECT set_config('app.account_id', $1, true)`, [accountId]);
      const result = await operation(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}

interface WorkflowRevisionRow {
  id: string;
  workflow_id: string;
  parent_revision_id: string | null;
  schema_version: number;
  content_hash: string;
  encrypted_payload: string;
  payload_key_envelope: string;
  searchable_metadata: { name?: string; folderId?: string | null };
  plugin_requirements: WorkflowRevision["searchableMetadata"]["requiredPlugins"];
  permission_requirements: string[];
  runner_policy: Record<string, unknown>;
  editor_device_id: string;
  updated_at: Date;
  encryption_algorithm: "aes-256-gcm";
  encryption_key_version: number;
  sync_state: WorkflowRevision["syncState"];
}

function workflowRevisionFromRow(row: WorkflowRevisionRow): WorkflowRevision {
  return {
    workflowId: row.workflow_id,
    revisionId: row.id,
    parentRevisionId: row.parent_revision_id,
    schemaVersion: row.schema_version,
    contentHash: row.content_hash,
    editorDeviceId: row.editor_device_id,
    updatedAt: row.updated_at.toISOString(),
    syncState: row.sync_state,
    encryption: { algorithm: row.encryption_algorithm, keyVersion: row.encryption_key_version },
    encryptedPayload: row.encrypted_payload.replace(/\s/g, ""),
    payloadKeyEnvelope: row.payload_key_envelope.replace(/\s/g, ""),
    searchableMetadata: {
      name: row.searchable_metadata.name ?? "Encrypted workflow",
      folderId: row.searchable_metadata.folderId ?? null,
      requiredPlugins: row.plugin_requirements,
      permissionRequirements: row.permission_requirements,
      runnerPolicy: row.runner_policy
    }
  };
}

export function detectSyncConflict(currentRevisionId: string | null, parentRevisionId: string | null): string | null {
  return currentRevisionId && currentRevisionId !== parentRevisionId ? currentRevisionId : null;
}

interface SubmissionRow {
  review_id: string; plugin_version_id: string; publisher_public_id: string; publisher_key_id: string;
  plugin_id: string; version: string; package_integrity: string; package_size: number; package_object_key: string; status: string;
}

function submissionFromRow(row: SubmissionRow): PluginSubmissionRecord {
  return { reviewId: row.review_id, pluginVersionId: row.plugin_version_id, publisherPublicId: row.publisher_public_id, publisherKeyId: row.publisher_key_id, pluginId: row.plugin_id, version: row.version, packageIntegrity: row.package_integrity, packageSize: Number(row.package_size), packageObjectKey: row.package_object_key, status: row.status };
}

async function requirePublisherPermission(client: PoolClient, accountId: string, publisherId: string, accepted: string[]): Promise<{ public_id: string }> {
  const result = await client.query<{ public_id: string }>(
    `SELECT p.public_id FROM publishers p JOIN publisher_members pm ON pm.publisher_id = p.id
      WHERE p.id = $1 AND pm.account_id = $2 AND pm.permission = ANY($3::text[]) LIMIT 1`,
    [publisherId, accountId, accepted]
  );
  if (!result.rowCount) throw new DomainError("publisher_permission_denied", "You do not have the required permission for this publisher.", 403);
  return result.rows[0];
}

async function appendPlatformAudit(client: PoolClient, actor: AuthenticatedSession, action: string, resourceType: string, resourceId: string, summary: Record<string, unknown>, correlationId: string) {
  await client.query(`INSERT INTO platform_audit_events(actor_account_id, action, resource_type, resource_id, summary, correlation_id) VALUES($1,$2,$3,$4,$5,$6)`, [actor.accountId, action, resourceType, resourceId, redact(summary), correlationId]);
}

async function appendAudit(client: PoolClient, actor: AuthenticatedSession, workspaceId: string, action: string, resourceType: string, resourceId: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null, correlationId: string) {
  await client.query(
    `INSERT INTO audit_events(id, occurred_at, actor_account_id, workspace_id, action, resource_type, resource_id, before_summary, after_summary, correlation_id)
     VALUES($1, now(), $2, $3, $4, $5, $6, $7, $8, $9)`,
    [randomUUID(), actor.accountId, workspaceId, action, resourceType, resourceId, before, redact(after), correlationId]
  );
}

function redact(value: Record<string, unknown> | null): Record<string, unknown> | null {
  if (!value) return null;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, /token|secret|password|cookie|authorization|payload|ciphertext/i.test(key) ? "[REDACTED]" : item]));
}
