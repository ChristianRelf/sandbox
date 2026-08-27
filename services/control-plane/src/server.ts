import { createHash, randomBytes, randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { runSummarySchema, workflowRevisionSchema } from "@sandbox/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorizer } from "./authorization.js";
import type { TransactionalEmail } from "./email.js";
import type { ImmutablePackageStorage, PackageReviewScanner } from "./package_services.js";
import type { AuthenticatedSession, ControlPlaneRepository, SessionVerifier } from "./types.js";
import { DomainError } from "./types.js";
import { buildSignedRunnerCommand, type RunnerCommandSigner } from "./runner_protocol.js";

const organisationInput = z.object({ name: z.string().trim().min(2).max(100), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63) });
const invitationInput = z.object({
  email: z.string().email(),
  role: z.enum(["owner", "administrator", "developer", "operator", "viewer"]),
  workspaceIds: z.array(z.string().uuid()).min(1).max(20),
  expiresInHours: z.number().int().min(1).max(168).default(72)
});
const acceptInvitationInput = z.object({ token: z.string().min(32).max(256) });
const syncedWorkflowInput = z.object({ workflowId: z.string().uuid(), name: z.string().trim().min(1).max(200) });
const syncConflictResolutionInput = z.object({ revisionId: z.string().uuid() });
const pluginSubmissionInput = z.object({
  pluginId: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)+$/).max(200), name: z.string().trim().min(1).max(120), summary: z.string().trim().min(1).max(500),
  visibility: z.enum(["public", "organisation", "selected_workspaces"]), ownerType: z.enum(["personal", "organisation"]), ownerId: z.string().uuid(),
  version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).max(50), manifestVersion: z.number().int().positive(), manifest: z.record(z.string(), z.unknown()),
  packageIntegrity: z.string().regex(/^sha256:[a-f0-9]{64}$/), packageSize: z.number().int().min(1).max(32 * 1024 * 1024), publisherKeyId: z.string().min(1).max(120),
  minimumHostVersion: z.string().min(1).max(100), maximumHostVersion: z.string().max(100).nullable(), capabilities: z.array(z.unknown()).max(100), networkDomains: z.array(z.unknown()).max(100),
  dependencyInventory: z.array(z.unknown()).max(2_000), reproducibility: z.record(z.string(), z.unknown())
});
const reviewDecisionInput = z.object({ decision: z.enum(["approved", "changes_requested", "rejected"]), reasons: z.array(z.string().min(1).max(1_000)).max(50) });
const revocationInput = z.object({ reason: z.string().trim().min(10).max(2_000), securityNoticeUrl: z.string().url().startsWith("https://") });
const publisherInput = z.object({ publicId: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)+$/).max(200), ownerType: z.enum(["personal", "organisation"]), ownerId: z.string().uuid(), publicName: z.string().trim().min(2).max(120), slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(63), description: z.string().max(2_000).default(""), website: z.string().url().startsWith("https://").nullable(), supportContact: z.string().email(), securityContact: z.string().email() });
const publisherKeyInput = z.object({ keyId: z.string().regex(/^[a-zA-Z0-9._-]+$/).max(120), algorithm: z.literal("ed25519"), publicKeyDerBase64: z.string().base64().max(256) });
const marketplaceQuery = z.object({ search: z.string().trim().max(200).nullable().default(null), category: z.string().trim().max(80).nullable().default(null), pricing: z.enum(["all", "free", "paid"]).default("all"), verifiedOnly: z.stringbool().default(false), visibility: z.enum(["public", "workspace", "all"]).default("public"), workspaceId: z.string().uuid().nullable().default(null), teamApprovedOnly: z.stringbool().default(false), sort: z.enum(["recent", "installs", "rating"]).default("recent"), cursor: z.string().max(200).nullable().default(null), limit: z.coerce.number().int().min(1).max(50).default(24), hostVersion: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/).default("0.3.0") });
const installedPluginVersion = z.object({ pluginId: z.string().min(3).max(200), version: z.string().min(1).max(50), packageIntegrity: z.string().regex(/^sha256:[a-f0-9]{64}$/) });
const runnerPairingInput = z.object({
  devicePublicKeyDerBase64: z.string().base64().max(256), operatingSystem: z.string().trim().min(1).max(80), architecture: z.string().trim().min(1).max(80),
  applicationVersion: z.string().trim().min(1).max(50), protocolVersion: z.number().int().positive().max(10_000), pluginRuntimeVersion: z.string().trim().min(1).max(50),
  capabilities: z.record(z.string(), z.unknown()), safeFolderLabels: z.array(z.string().trim().min(1).max(100)).max(100).default([]), browserEngine: z.record(z.string(), z.unknown()).nullable().default(null),
  installedPluginVersions: z.array(installedPluginVersion).max(500).default([]), tags: z.array(z.string().trim().min(1).max(50)).max(50).default([])
});
const runnerPairingConfirmation = z.object({ challengeId: z.string().uuid(), challenge: z.string().min(32).max(256), signatureBase64: z.string().base64().max(256), workspaceId: z.string().uuid().nullable(), displayName: z.string().trim().min(1).max(100) });
const runnerCommandInput = z.object({
  targetRunnerId: z.string().uuid(), action: z.enum(["run_workflow", "cancel_execution", "pause_workflow", "resume_workflow", "request_diagnostics", "sync_revision"]),
  workflowRevisionId: z.string().uuid().nullable().default(null), payload: z.record(z.string(), z.unknown()).default({}), idempotencyKey: z.string().min(16).max(200), expiresInSeconds: z.number().int().min(15).max(86_400).default(300)
});
const approvalDecisionInput = z.object({ decision: z.enum(["approved", "rejected"]), reason: z.string().trim().min(1).max(2_000).nullable().default(null) });
const publishWorkflowInput = z.object({ changeSummary: z.string().trim().min(1).max(2_000) });
const rollbackWorkflowInput = z.object({ revisionId: z.string().uuid(), reason: z.string().trim().min(1).max(2_000) });
const governancePolicyValueSchemas = {
  permitted_plugins: z.array(z.string().min(3).max(200)).max(1_000), verified_publishers_only: z.boolean(), private_plugins: z.boolean(), command_execution: z.boolean(), external_communication: z.boolean(),
  approved_network_domains: z.array(z.string().regex(/^(?:\*\.)?[a-z0-9.-]+$/).max(253)).max(1_000), shared_connections: z.boolean(), workflow_publishing: z.boolean(), required_approval_count: z.number().int().min(1).max(10),
  runner_operating_systems: z.array(z.string().trim().min(1).max(80)).max(20), minimum_application_version: z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/), execution_history_retention_days: z.number().int().min(1).max(3_650),
  screenshot_upload: z.boolean(), remote_execution: z.boolean(), webhook_retention_seconds: z.number().int().min(60).max(604_800)
} as const;
const governancePolicyInput = z.object({ policyKey: z.enum(Object.keys(governancePolicyValueSchemas) as [keyof typeof governancePolicyValueSchemas, ...(keyof typeof governancePolicyValueSchemas)[]]), policyValue: z.unknown() });
const memberRoleInput = z.object({ role: z.enum(["owner", "administrator", "developer", "operator", "viewer"]) });
const runnerHeartbeatInput = z.object({ currentWorkload: z.number().int().min(0).max(10_000), status: z.enum(["online", "paused", "draining", "maintenance"]).default("online") });
const runnerCommandStatusInput = z.object({ status: z.enum(["accepted", "rejected", "completed"]), resultSummary: z.record(z.string(), z.unknown()).nullable().default(null) });

export interface ApiDependencies {
  repository: ControlPlaneRepository;
  sessions: SessionVerifier;
  email: TransactionalEmail;
  packageStorage: ImmutablePackageStorage;
  packageScanner: PackageReviewScanner;
  runnerCommandSigner?: RunnerCommandSigner;
  webBaseUrl: string;
  logger?: boolean;
}

export async function createServer(dependencies: ApiDependencies): Promise<FastifyInstance> {
  const app = Fastify({ logger: dependencies.logger ?? false, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
  await app.register(rateLimit, { max: 240, timeWindow: "1 minute", keyGenerator: request => request.ip });
  const authorizer = new Authorizer(dependencies.repository);

  app.setErrorHandler((error, request, reply) => {
    if (error instanceof DomainError) {
      void reply.status(error.statusCode).send({ error: { code: error.code, message: error.message }, correlationId: request.id });
      return;
    }
    if (error instanceof z.ZodError) {
      void reply.status(400).send({ error: { code: "invalid_request", message: z.prettifyError(error) }, correlationId: request.id });
      return;
    }
    request.log.error(error);
    void reply.status(500).send({ error: { code: "internal_error", message: "The request could not be completed." }, correlationId: request.id });
  });

  app.addHook("onSend", async (_request, reply, payload) => {
    reply.header("cache-control", "no-store");
    reply.header("x-content-type-options", "nosniff");
    reply.header("referrer-policy", "no-referrer");
    reply.header("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    return payload;
  });

  app.get("/health", { config: { rateLimit: { max: 60, timeWindow: "1 minute" } } }, async () => ({ status: "ok", service: "sandbox-control-plane", execution: "local-only" }));

  app.get("/v1/marketplace/plugins", async request => {
    const query = marketplaceQuery.parse(request.query);
    const session = await authenticateOptional(request, dependencies.sessions);
    if (query.workspaceId) {
      if (!session) throw new DomainError("authentication_required", "Sign in to browse workspace-approved or private plugins.", 401);
      await authorizer.require(session, query.workspaceId, "workflows.view");
    }
    if ((query.visibility !== "public" || query.teamApprovedOnly) && !query.workspaceId) throw new DomainError("marketplace_workspace_required", "A workspace is required for team-approved or private plugin filters.", 400);
    return dependencies.repository.searchMarketplace(session, query);
  });

  app.get("/v1/marketplace/plugins/:pluginId", async request => {
    const { pluginId } = z.object({ pluginId: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)+$/) }).parse(request.params);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid().nullable().default(null) }).parse(request.query);
    const session = await authenticateOptional(request, dependencies.sessions);
    if (workspaceId) {
      if (!session) throw new DomainError("authentication_required", "Sign in to inspect a private workspace plugin.", 401);
      await authorizer.require(session, workspaceId, "workflows.view");
    }
    const listing = await dependencies.repository.getMarketplaceListing(session, pluginId, workspaceId);
    if (!listing) throw new DomainError("listing_not_found", "Published compatible plugin listing not found.", 404);
    return { listing };
  });

  app.get("/v1/marketplace/plugins/:pluginId/install", async request => {
    const { pluginId } = z.object({ pluginId: z.string().regex(/^[a-z0-9]+([.-][a-z0-9]+)+$/) }).parse(request.params);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid().nullable().default(null) }).parse(request.query);
    const session = await authenticateOptional(request, dependencies.sessions);
    if (workspaceId) {
      if (!session) throw new DomainError("authentication_required", "Sign in to install a private workspace plugin.", 401);
      await authorizer.require(session, workspaceId, "plugins.manage");
    }
    const packageRecord = await dependencies.repository.getMarketplacePackage(session, pluginId, workspaceId);
    if (!packageRecord) throw new DomainError("package_not_available", "The current signed package is unavailable, incompatible, suspended, or revoked.", 404);
    if (packageRecord.pricingModel !== "free") throw new DomainError("entitlement_required", "Purchase or assign an active entitlement before installing this paid plugin.", 402);
    const download = await dependencies.packageStorage.createDownload(packageRecord.packageObjectKey);
    return { pluginId: packageRecord.pluginId, version: packageRecord.version, packageIntegrity: packageRecord.packageIntegrity, packageSize: packageRecord.packageSize, publisher: { publicId: packageRecord.publisherPublicId, keyId: packageRecord.publisherKeyId, publicKeyPem: publicKeyPem(packageRecord.publisherPublicKeyDerBase64) }, download };
  });

  app.get("/v1/account/export", async request => {
    const session = await authenticate(request, dependencies.sessions);
    return dependencies.repository.exportAccountData(session);
  });

  app.get("/v1/account/profile", async request => {
    const session = await authenticate(request, dependencies.sessions);
    return {
      accountId: session.accountId,
      email: session.email,
      displayName: session.email.split("@")[0],
      sessionId: session.sessionId
    };
  });

  app.delete("/v1/account", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    if (!session.authenticationMethods.some(method => method === "mfa" || method === "webauthn" || method === "passkey")) {
      throw new DomainError("step_up_required", "Account deletion requires a recent passkey or multi-factor authentication step.", 403);
    }
    await dependencies.repository.requestAccountDeletion(session, request.id);
    return { deleted: true };
  });

  app.get("/v1/account/sessions", async request => {
    const session = await authenticate(request, dependencies.sessions);
    return { items: await dependencies.repository.listSessions(session) };
  });

  app.post("/v1/account/sessions/:sessionId/revoke", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { sessionId } = z.object({ sessionId: z.string().uuid() }).parse(request.params);
    const revoked = await dependencies.repository.revokeSession(session, sessionId, request.id);
    if (!revoked) throw new DomainError("session_not_found", "Session not found or already revoked.", 404);
    return { revoked: true };
  });

  app.post("/v1/organisations", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    return dependencies.repository.createOrganisation(session, organisationInput.parse(request.body), request.id);
  });

  app.post("/v1/workspaces/:workspaceId/invitations", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "members.manage");
    const input = invitationInput.parse(request.body);
    if (!input.workspaceIds.includes(workspaceId)) throw new DomainError("invitation_scope_invalid", "The current workspace must be included in the invitation.", 400);
    const token = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + input.expiresInHours * 60 * 60 * 1_000);
    const invitation = await dependencies.repository.createInvitation(session, workspaceId, {
      email: input.email,
      role: input.role,
      workspaceIds: input.workspaceIds,
      expiresAt,
      tokenHash: createHash("sha256").update(token, "utf8").digest()
    }, request.id);
    await dependencies.email.sendInvitation({
      recipient: input.email,
      organisationName: invitation.organisationId,
      invitationUrl: `${dependencies.webBaseUrl.replace(/\/$/, "")}/invitations/accept?token=${encodeURIComponent(token)}`,
      expiresAt
    });
    return { invitation };
  });

  app.post("/v1/invitations/accept", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const input = acceptInvitationInput.parse(request.body);
    return dependencies.repository.acceptInvitation(session, input.token, request.id);
  });

  app.delete("/v1/workspaces/:workspaceId/invitations/:invitationId", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, invitationId } = z.object({ workspaceId: z.string().uuid(), invitationId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "members.manage");
    const revoked = await dependencies.repository.revokeInvitation(session, workspaceId, invitationId, request.id);
    if (!revoked) throw new DomainError("invitation_not_found", "Pending invitation not found in this workspace.", 404);
    return { revoked: true };
  });

  app.get("/v1/workspaces/:workspaceId/members", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.view");
    return { items: await dependencies.repository.listWorkspaceMembers(session, workspaceId) };
  });

  app.put("/v1/workspaces/:workspaceId/members/:accountId/role", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, accountId } = z.object({ workspaceId: z.string().uuid(), accountId: z.string().uuid() }).parse(request.params);
    const { role } = memberRoleInput.parse(request.body);
    await authorizer.require(session, workspaceId, role === "owner" ? "organisation.owners.manage" : "members.manage");
    return { member: await dependencies.repository.updateWorkspaceMemberRole(session, workspaceId, accountId, role, request.id) };
  });

  app.delete("/v1/workspaces/:workspaceId/members/:accountId", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, accountId } = z.object({ workspaceId: z.string().uuid(), accountId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "members.manage");
    const removed = await dependencies.repository.removeWorkspaceMember(session, workspaceId, accountId, request.id);
    if (!removed) throw new DomainError("member_not_found", "Member was not found in this workspace.", 404);
    return { removed: true };
  });

  app.post("/v1/runners/pairing/challenges", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const input = runnerPairingInput.parse(request.body);
    validateEd25519PublicKey(input.devicePublicKeyDerBase64);
    const challenge = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 10 * 60_000);
    return dependencies.repository.createRunnerPairingChallenge(session, input, challenge, expiresAt);
  });

  app.post("/v1/runners/pairing/confirm", { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } }, async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const input = runnerPairingConfirmation.parse(request.body);
    if (input.workspaceId) await authorizer.require(session, input.workspaceId, "runners.manage");
    return { runner: await dependencies.repository.confirmRunnerPairing(session, input, request.id) };
  });

  app.get("/v1/workspaces/:workspaceId/runners", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.view");
    return { items: await dependencies.repository.listRunners(session, workspaceId) };
  });

  app.post("/v1/workspaces/:workspaceId/runner-commands", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const input = runnerCommandInput.parse(request.body);
    await authorizer.require(session, workspaceId, input.action === "request_diagnostics" ? "runners.manage" : "workflows.run");
    const policies = await dependencies.repository.getGovernancePolicies(session, workspaceId);
    authorizer.enforcePolicy(policies.remote_execution !== false, { policy: "remote_execution", resource: `runner command ${input.action}`, administratorAction: "A workspace administrator can enable remote execution in Governance.", userAction: "Run the workflow directly on an eligible local runner instead." });
    if (!dependencies.runnerCommandSigner) throw new DomainError("runner_signing_unavailable", "Remote commands are unavailable because the control-plane signing key is not configured.", 503);
    const createdAt = new Date();
    const expiresAt = new Date(createdAt.getTime() + input.expiresInSeconds * 1_000);
    const command = buildSignedRunnerCommand(dependencies.runnerCommandSigner, {
      commandId: randomUUID(), issuerAccountId: session.accountId, workspaceId, targetRunnerId: input.targetRunnerId, action: input.action,
      workflowRevisionId: input.workflowRevisionId, createdAt: createdAt.toISOString(), expiresAt: expiresAt.toISOString(), idempotencyKey: input.idempotencyKey, payload: input.payload
    });
    return { command: await dependencies.repository.createRunnerCommand(session, command, request.id) };
  });

  app.get("/v1/workspaces/:workspaceId/governance", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.view");
    return { policies: await dependencies.repository.getGovernancePolicies(session, workspaceId) };
  });

  app.put("/v1/workspaces/:workspaceId/governance", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "policies.manage");
    const input = governancePolicyInput.parse(request.body);
    const schema = governancePolicyValueSchemas[input.policyKey];
    const policyValue = schema.parse(input.policyValue);
    return dependencies.repository.setGovernancePolicy(session, workspaceId, input.policyKey, policyValue, request.id);
  });

  app.delete("/v1/workspaces/:workspaceId/runners/:runnerId", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, runnerId } = z.object({ workspaceId: z.string().uuid(), runnerId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "runners.manage");
    const revoked = await dependencies.repository.revokeRunner(session, workspaceId, runnerId, request.id);
    if (!revoked) throw new DomainError("runner_not_found", "Runner not found in this workspace or already revoked.", 404);
    return { revoked: true, localDataDeleted: false };
  });

  app.post("/v1/runner/heartbeat", async request => {
    const device = await authenticateRunnerDevice(request, dependencies.repository);
    const input = runnerHeartbeatInput.parse(request.body);
    return { runner: await dependencies.repository.recordRunnerHeartbeat(device, input.currentWorkload, input.status) };
  });

  app.get("/v1/runner/commands", async request => {
    const device = await authenticateRunnerDevice(request, dependencies.repository);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    return { items: await dependencies.repository.dequeueRunnerCommands(device, limit) };
  });

  app.post("/v1/runner/commands/:commandId/status", async request => {
    const device = await authenticateRunnerDevice(request, dependencies.repository);
    const { commandId } = z.object({ commandId: z.string().uuid() }).parse(request.params);
    const input = runnerCommandStatusInput.parse(request.body);
    const updated = await dependencies.repository.updateRunnerCommandStatus(device, commandId, input.status, input.resultSummary);
    if (!updated) throw new DomainError("runner_command_not_found", "Command is unavailable, expired, or not assigned to this runner.", 404);
    return { updated: true };
  });

  app.post("/v1/runner/run-summaries", async request => {
    const device = await authenticateRunnerDevice(request, dependencies.repository);
    const summary = runSummarySchema.parse(request.body);
    if (summary.runnerId !== device.runnerId || summary.workspaceId !== device.workspaceId) throw new DomainError("runner_summary_scope_invalid", "Run summary does not match the authenticated runner and workspace.", 403);
    await dependencies.repository.recordRunSummary(device, summary);
    return { recorded: true };
  });

  app.get("/v1/workspaces/:workspaceId/activity", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(100).default(30) }).parse(request.query);
    await authorizer.require(session, workspaceId, "executions.view_summary");
    return dependencies.repository.listWorkspaceActivity(session, workspaceId, limit);
  });

  app.post("/v1/workspaces/:workspaceId/sync/revisions", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.edit");
    const revision = workflowRevisionSchema.parse(request.body);
    const payloadBytes = Buffer.byteLength(revision.encryptedPayload, "base64");
    const envelopeBytes = Buffer.byteLength(revision.payloadKeyEnvelope, "base64");
    if (payloadBytes > 2 * 1024 * 1024) throw new DomainError("sync_payload_too_large", "Encrypted workflow payload exceeds 2 MB.", 413);
    if (envelopeBytes > 512) throw new DomainError("sync_key_envelope_too_large", "Workflow key envelope exceeds 512 bytes.", 413);
    return dependencies.repository.appendWorkflowRevision(session, workspaceId, revision, request.id);
  });

  app.post("/v1/workspaces/:workspaceId/sync/workflows", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.edit");
    return dependencies.repository.createSyncedWorkflow(session, workspaceId, syncedWorkflowInput.parse(request.body), request.id);
  });

  app.get("/v1/workspaces/:workspaceId/sync/workflows/:workflowId/revisions", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId, workflowId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid() }).parse(request.params);
    const { cursor, limit } = z.object({ cursor: z.string().uuid().nullable().default(null), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    await authorizer.require(session, workspaceId, "workflows.view");
    return dependencies.repository.listWorkflowRevisions(session, workspaceId, workflowId, cursor, limit);
  });

  app.get("/v1/workspaces/:workspaceId/sync/workflows/:workflowId/revisions/:revisionId", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId, workflowId, revisionId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid(), revisionId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.view");
    const revision = await dependencies.repository.getWorkflowRevision(session, workspaceId, workflowId, revisionId);
    if (!revision) throw new DomainError("revision_not_found", "Workflow revision not found in this workspace.", 404);
    return { revision };
  });

  app.post("/v1/workspaces/:workspaceId/sync/workflows/:workflowId/conflicts/resolve", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, workflowId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.edit");
    const { revisionId } = syncConflictResolutionInput.parse(request.body);
    return dependencies.repository.resolveSyncConflict(session, workspaceId, workflowId, revisionId, request.id);
  });

  app.post("/v1/workspaces/:workspaceId/workflows/:workflowId/revisions/:revisionId/request-approval", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, workflowId, revisionId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid(), revisionId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.edit");
    return { approval: await dependencies.repository.requestWorkflowApproval(session, workspaceId, workflowId, revisionId, request.id) };
  });

  app.post("/v1/workspaces/:workspaceId/workflow-approvals/:approvalId/decision", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, approvalId } = z.object({ workspaceId: z.string().uuid(), approvalId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.approve");
    const input = approvalDecisionInput.parse(request.body);
    if (input.decision === "rejected" && !input.reason) throw new DomainError("approval_reason_required", "A rejection reason is required.", 400);
    return { approval: await dependencies.repository.decideWorkflowApproval(session, workspaceId, approvalId, input.decision, input.reason, request.id) };
  });

  app.post("/v1/workspaces/:workspaceId/workflows/:workflowId/revisions/:revisionId/publish", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, workflowId, revisionId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid(), revisionId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.publish");
    const input = publishWorkflowInput.parse(request.body);
    return dependencies.repository.publishWorkflowRevision(session, workspaceId, workflowId, revisionId, input.changeSummary, request.id);
  });

  app.post("/v1/workspaces/:workspaceId/workflows/:workflowId/rollback", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { workspaceId, workflowId } = z.object({ workspaceId: z.string().uuid(), workflowId: z.string().uuid() }).parse(request.params);
    await authorizer.require(session, workspaceId, "workflows.publish");
    const input = rollbackWorkflowInput.parse(request.body);
    return dependencies.repository.rollbackWorkflowRevision(session, workspaceId, workflowId, input.revisionId, input.reason, request.id);
  });

  app.post("/v1/publishers/:publisherId/plugins/submissions", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { publisherId } = z.object({ publisherId: z.string().uuid() }).parse(request.params);
    const input = pluginSubmissionInput.parse(request.body);
    const digest = input.packageIntegrity.slice("sha256:".length);
    const objectKey = `plugins/${publisherId}/${input.pluginId}/${input.version}/${digest}.sandbox-plugin`;
    const submission = await dependencies.repository.createPluginSubmission(session, { ...input, publisherId }, objectKey, request.id);
    const upload = await dependencies.packageStorage.createUpload(objectKey, input.packageSize, digest);
    return { submission, upload };
  });

  app.post("/v1/publishers", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    return dependencies.repository.createPublisher(session, publisherInput.parse(request.body), request.id);
  });

  app.post("/v1/publishers/:publisherId/signing-keys", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { publisherId } = z.object({ publisherId: z.string().uuid() }).parse(request.params);
    const input = publisherKeyInput.parse(request.body);
    const key = Buffer.from(input.publicKeyDerBase64, "base64");
    const ed25519SpkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
    if (key.length !== 44 || !key.subarray(0, ed25519SpkiPrefix.length).equals(ed25519SpkiPrefix)) throw new DomainError("publisher_key_invalid", "Public key must be an Ed25519 SubjectPublicKeyInfo DER value.", 400);
    return dependencies.repository.registerPublisherSigningKey(session, publisherId, input.keyId, input.publicKeyDerBase64, request.id);
  });

  app.post("/v1/publishers/:publisherId/plugins/submissions/:reviewId/upload", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { publisherId, reviewId } = z.object({ publisherId: z.string().uuid(), reviewId: z.string().uuid() }).parse(request.params);
    const submission = await dependencies.repository.getPluginSubmission(session, publisherId, reviewId);
    if (!submission) throw new DomainError("submission_not_found", "Plugin submission not found for this publisher.", 404);
    if (submission.status !== "draft" && submission.status !== "changes_requested") throw new DomainError("review_state_invalid", "Only draft or changes-requested submissions can receive an upload URL.", 409);
    return dependencies.packageStorage.createUpload(submission.packageObjectKey, submission.packageSize, submission.packageIntegrity.slice(7));
  });

  app.post("/v1/publishers/:publisherId/plugins/submissions/:reviewId/submit", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { publisherId, reviewId } = z.object({ publisherId: z.string().uuid(), reviewId: z.string().uuid() }).parse(request.params);
    const submission = await dependencies.repository.getPluginSubmission(session, publisherId, reviewId);
    if (!submission) throw new DomainError("submission_not_found", "Plugin submission not found for this publisher.", 404);
    const object = await dependencies.packageStorage.inspect(submission.packageObjectKey);
    if (!object.immutable || object.size !== submission.packageSize || `sha256:${object.sha256}` !== submission.packageIntegrity) {
      throw new DomainError("package_upload_mismatch", "Uploaded package size, checksum, or immutable-storage policy does not match the submission.", 409);
    }
    const scan = await dependencies.packageScanner.scan(submission.packageObjectKey, submission.packageIntegrity, submission.publisherPublicId, submission.publisherKeyId);
    const passed = scan.passed && scan.manifestValid && scan.signatureValid && scan.integrityValid && scan.declaredContentsOnly && scan.malwareScan === "clean";
    const updated = await dependencies.repository.recordAutomatedPluginReview(session, publisherId, reviewId, scan as unknown as Record<string, unknown>, passed, scan.rejectionReasons, request.id);
    return { submission: updated, automatedReview: { passed, rejectionReasons: scan.rejectionReasons } };
  });

  app.post("/v1/publishers/:publisherId/plugins/submissions/:reviewId/publish", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    const { publisherId, reviewId } = z.object({ publisherId: z.string().uuid(), reviewId: z.string().uuid() }).parse(request.params);
    return dependencies.repository.publishPluginVersion(session, publisherId, reviewId, request.id);
  });

  app.post("/v1/internal/plugin-reviews/:reviewId/decision", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    requirePlatform(session, "marketplace.review");
    const { reviewId } = z.object({ reviewId: z.string().uuid() }).parse(request.params);
    const input = reviewDecisionInput.parse(request.body);
    if (input.decision !== "approved" && input.reasons.length === 0) throw new DomainError("review_reason_required", "Changes requested and rejected decisions require at least one reason.", 400);
    await dependencies.repository.decidePluginReview(session, reviewId, input.decision, input.reasons, request.id);
    return { reviewId, status: input.decision };
  });

  app.post("/v1/internal/plugin-versions/:pluginVersionId/revoke", async request => {
    const session = await authenticate(request, dependencies.sessions);
    requireFreshRequest(request);
    requirePlatform(session, "marketplace.security");
    const { pluginVersionId } = z.object({ pluginVersionId: z.string().uuid() }).parse(request.params);
    const input = revocationInput.parse(request.body);
    await dependencies.repository.revokePluginVersion(session, pluginVersionId, input.reason, input.securityNoticeUrl, request.id);
    return { pluginVersionId, revoked: true, scope: "exact_version", dataDeleted: false };
  });

  app.get("/v1/workspaces/:workspaceId/audit", async request => {
    const session = await authenticate(request, dependencies.sessions);
    const { workspaceId } = z.object({ workspaceId: z.string().uuid() }).parse(request.params);
    const { cursor, limit } = z.object({ cursor: z.string().uuid().nullable().default(null), limit: z.coerce.number().int().min(1).max(100).default(50) }).parse(request.query);
    await authorizer.require(session, workspaceId, "audit.view");
    return dependencies.repository.listAuditEvents(session, workspaceId, cursor, limit);
  });

  return app;
}

async function authenticate(request: FastifyRequest, verifier: SessionVerifier): Promise<AuthenticatedSession> {
  const authorization = request.headers.authorization;
  if (!authorization?.startsWith("Bearer ")) throw new DomainError("authentication_required", "A bearer access token is required.", 401);
  return verifier.verify(authorization.slice("Bearer ".length));
}

async function authenticateOptional(request: FastifyRequest, verifier: SessionVerifier): Promise<AuthenticatedSession | null> {
  const authorization = request.headers.authorization;
  if (!authorization) return null;
  if (!authorization.startsWith("Bearer ")) throw new DomainError("authentication_required", "Bearer authentication is malformed.", 401);
  return verifier.verify(authorization.slice("Bearer ".length));
}

function requireFreshRequest(request: FastifyRequest): void {
  const value = request.headers["x-sandbox-request-time"];
  if (typeof value !== "string") throw new DomainError("request_freshness_required", "x-sandbox-request-time is required for this operation.", 400);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60 * 1_000) {
    throw new DomainError("stale_request", "The request timestamp is outside the five-minute freshness window.", 400);
  }
}

function requirePlatform(session: AuthenticatedSession, permission: string): void {
  if (!session.platformPermissions.includes(permission)) throw new DomainError("platform_permission_denied", `Platform permission '${permission}' is required.`, 403);
}

function publicKeyPem(derBase64: string): string {
  const lines = derBase64.match(/.{1,64}/g)?.join("\n") ?? derBase64;
  return `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
}

function validateEd25519PublicKey(derBase64: string): void {
  const key = Buffer.from(derBase64, "base64");
  const prefix = Buffer.from("302a300506032b6570032100", "hex");
  if (key.length !== 44 || !key.subarray(0, prefix.length).equals(prefix)) throw new DomainError("runner_key_invalid", "Runner public key must be an Ed25519 SubjectPublicKeyInfo DER value.", 400);
}

async function authenticateRunnerDevice(request: FastifyRequest, repository: ControlPlaneRepository) {
  const runnerId = singleHeader(request, "x-sandbox-runner-id");
  const keyId = singleHeader(request, "x-sandbox-key-id");
  const requestTime = singleHeader(request, "x-sandbox-request-time");
  const nonce = singleHeader(request, "x-sandbox-request-nonce");
  const signatureBase64 = singleHeader(request, "x-sandbox-signature");
  const timestamp = Date.parse(requestTime);
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > 5 * 60_000) throw new DomainError("stale_runner_request", "Runner request timestamp is outside the five-minute freshness window.", 400);
  return repository.authenticateRunnerRequest({ runnerId, keyId, requestTime, nonce, signatureBase64, method: request.method.toUpperCase(), path: request.url, body: request.body ?? null });
}

function singleHeader(request: FastifyRequest, name: string): string {
  const value = request.headers[name];
  if (typeof value !== "string" || !value || value.length > 512) throw new DomainError("runner_authentication_required", `Runner authentication header '${name}' is required.`, 401);
  return value;
}

export function correlationId(): string {
  return randomUUID();
}
