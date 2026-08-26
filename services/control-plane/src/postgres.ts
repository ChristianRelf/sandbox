import { createHash, randomUUID } from "node:crypto";
import type { AuditEvent, BuiltInRole, Permission, WorkflowRevision } from "@sandbox/contracts";
import { permissions as allPermissions, rolePermissionMatrix } from "@sandbox/contracts";
import { Pool, type PoolClient } from "pg";
import type { AuthenticatedSession, ControlPlaneRepository, InvitationInput, InvitationRecord, OrganisationInput, SyncWriteResult } from "./types.js";
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

  async appendWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, revision: WorkflowRevision, correlationId: string): Promise<SyncWriteResult> {
    return this.withAccount(actor.accountId, async client => {
      const workflow = await client.query<{ current_draft_revision_id: string | null }>(`SELECT current_draft_revision_id FROM synced_workflows WHERE id = $1 AND workspace_id = $2 FOR UPDATE`, [revision.workflowId, workspaceId]);
      if (!workflow.rowCount) throw new DomainError("workflow_not_found", "Workflow not found or not owned by this workspace.", 404);
      const current = workflow.rows[0].current_draft_revision_id;
      const conflictRevisionId = current && current !== revision.parentRevisionId ? current : null;
      await client.query(
        `INSERT INTO workflow_revisions(id, workflow_id, parent_revision_id, schema_version, content_hash, encrypted_payload, payload_key_envelope, editor_device_id, updated_by, updated_at, publish_status)
         VALUES($1,$2,$3,$4,$5,decode($6,'base64'),decode($7,'base64'),$8,$9,$10,'draft')`,
        [revision.revisionId, revision.workflowId, revision.parentRevisionId, revision.schemaVersion, revision.contentHash, revision.encryptedPayload, revision.encryptedPayload.slice(0, 64), revision.editorDeviceId, actor.accountId, revision.updatedAt]
      );
      if (!conflictRevisionId) await client.query(`UPDATE synced_workflows SET current_draft_revision_id = $1 WHERE id = $2`, [revision.revisionId, revision.workflowId]);
      await appendAudit(client, actor, workspaceId, conflictRevisionId ? "workflow.sync_conflict" : "workflow.revision_saved", "workflow_revision", revision.revisionId, null, { workflowId: revision.workflowId, parentRevisionId: revision.parentRevisionId, conflictRevisionId }, correlationId);
      return { revision: { ...revision, syncState: conflictRevisionId ? "conflicted" : "synced" }, conflictRevisionId };
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
