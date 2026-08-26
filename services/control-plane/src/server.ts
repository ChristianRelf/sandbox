import { createHash, randomBytes, randomUUID } from "node:crypto";
import rateLimit from "@fastify/rate-limit";
import { workflowRevisionSchema } from "@sandbox/contracts";
import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { z } from "zod";
import { Authorizer } from "./authorization.js";
import type { TransactionalEmail } from "./email.js";
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

export interface ApiDependencies {
  repository: ControlPlaneRepository;
  sessions: SessionVerifier;
  email: TransactionalEmail;
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
    if (revision.encryptedPayload.length > 2 * 1024 * 1024) throw new DomainError("sync_payload_too_large", "Encrypted workflow payload exceeds 2 MB.", 413);
    return dependencies.repository.appendWorkflowRevision(session, workspaceId, revision, request.id);
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

export function correlationId(): string {
  return randomUUID();
}
