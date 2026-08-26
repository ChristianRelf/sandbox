import { createHash, randomBytes, randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { workflowRevisionSchema } from "@sandbox/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorizer } from "./authorization.js";
import type { TransactionalEmail } from "./email.js";
import type { ImmutablePackageStorage, PackageReviewScanner } from "./package_services.js";
import type { AuthenticatedSession, ControlPlaneRepository, SessionVerifier } from "./types.js";
import { DomainError } from "./types.js";

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

export interface ApiDependencies {
  repository: ControlPlaneRepository;
  sessions: SessionVerifier;
  email: TransactionalEmail;
  packageStorage: ImmutablePackageStorage;
  packageScanner: PackageReviewScanner;
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

export function correlationId(): string {
  return randomUUID();
}
