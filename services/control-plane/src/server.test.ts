import { describe, expect, it, vi } from "vitest";
import type { TransactionalEmail } from "./email.js";
import { createServer } from "./server.js";
import type { AuthenticatedSession, ControlPlaneRepository, SessionVerifier } from "./types.js";

const session: AuthenticatedSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  subject: "identity|one",
  email: "one@example.com",
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  authenticationMethods: ["passkey"],
  platformPermissions: []
};
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function dependencies(permissions: string[]) {
  const repository: ControlPlaneRepository = {
    permissions: vi.fn(async () => new Set(permissions as never[])),
    createOrganisation: vi.fn(),
    createInvitation: vi.fn(async (_actor, _workspace, input) => ({ id: crypto.randomUUID(), organisationId: crypto.randomUUID(), workspaceIds: input.workspaceIds, email: input.email, role: input.role, expiresAt: input.expiresAt.toISOString(), status: "pending" })),
    acceptInvitation: vi.fn(),
    createSyncedWorkflow: vi.fn(),
    appendWorkflowRevision: vi.fn(async (_actor, _workspace, revision) => ({ revision: { ...revision, syncState: "synced" }, conflictRevisionId: null })),
    listWorkflowRevisions: vi.fn(),
    getWorkflowRevision: vi.fn(),
    resolveSyncConflict: vi.fn(),
    createPublisher: vi.fn(), registerPublisherSigningKey: vi.fn(), createPluginSubmission: vi.fn(), getPluginSubmission: vi.fn(), recordAutomatedPluginReview: vi.fn(), decidePluginReview: vi.fn(), revokePluginVersion: vi.fn(),
    listAuditEvents: vi.fn(), exportAccountData: vi.fn(), requestAccountDeletion: vi.fn(), listSessions: vi.fn(), revokeSession: vi.fn()
  };
  const sessions: SessionVerifier = { verify: vi.fn(async () => session) };
  const email: TransactionalEmail = { sendInvitation: vi.fn(async () => undefined) };
  const packageStorage = { createUpload: vi.fn(), inspect: vi.fn() };
  const packageScanner = { scan: vi.fn() };
  return { repository, sessions, email, packageStorage, packageScanner, webBaseUrl: "https://app.sandbox.test" };
}

describe("control-plane API", () => {
  it("requires server-side workspace permission for invitations", async () => {
    const deps = dependencies([]);
    const server = await createServer(deps);
    const response = await server.inject({
      method: "POST", url: `/v1/workspaces/${workspaceId}/invitations`,
      headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() },
      payload: { email: "developer@example.com", role: "developer", workspaceIds: [workspaceId], expiresInHours: 24 }
    });
    expect(response.statusCode).toBe(403);
    expect(deps.repository.createInvitation).not.toHaveBeenCalled();
    await server.close();
  });

  it("emails the one-time invitation token without returning it from the API", async () => {
    const deps = dependencies(["members.manage"]);
    const server = await createServer(deps);
    const response = await server.inject({
      method: "POST", url: `/v1/workspaces/${workspaceId}/invitations`,
      headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() },
      payload: { email: "developer@example.com", role: "developer", workspaceIds: [workspaceId], expiresInHours: 24 }
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain("token=");
    expect(deps.email.sendInvitation).toHaveBeenCalledWith(expect.objectContaining({ recipient: "developer@example.com", invitationUrl: expect.stringContaining("token=") }));
    await server.close();
  });

  it("rejects stale privileged requests", async () => {
    const deps = dependencies(["members.manage"]);
    const server = await createServer(deps);
    const response = await server.inject({
      method: "POST", url: `/v1/workspaces/${workspaceId}/invitations`,
      headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date(Date.now() - 10 * 60_000).toISOString() },
      payload: { email: "developer@example.com", role: "developer", workspaceIds: [workspaceId] }
    });
    expect(response.statusCode).toBe(400);
    expect(response.json().error.code).toBe("stale_request");
    await server.close();
  });

  it("preserves the separate client-generated workflow key envelope", async () => {
    const deps = dependencies(["workflows.edit"]);
    const server = await createServer(deps);
    const encryptedPayload = Buffer.alloc(64, 7).toString("base64");
    const payloadKeyEnvelope = Buffer.alloc(60, 9).toString("base64");
    const revision = {
      workflowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      revisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      parentRevisionId: null,
      schemaVersion: 3,
      contentHash: `sha256:${"a".repeat(64)}`,
      editorDeviceId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      updatedAt: new Date().toISOString(),
      syncState: "local",
      encryption: { algorithm: "aes-256-gcm", keyVersion: 1 },
      encryptedPayload,
      payloadKeyEnvelope,
      searchableMetadata: { name: "Encrypted workflow", folderId: null, requiredPlugins: [], permissionRequirements: [], runnerPolicy: {} }
    };
    const response = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/sync/revisions`, headers: { authorization: "Bearer token" }, payload: revision });
    expect(response.statusCode).toBe(200);
    expect(deps.repository.appendWorkflowRevision).toHaveBeenCalledWith(session, workspaceId, expect.objectContaining({ encryptedPayload, payloadKeyEnvelope }), expect.any(String));
    expect(payloadKeyEnvelope).not.toBe(encryptedPayload.slice(0, 64));
    await server.close();
  });

  it("creates an immutable upload then runs deterministic automated review", async () => {
    const deps = dependencies([]);
    const publisherId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const reviewId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    const versionId = "99999999-9999-4999-8999-999999999999";
    const integrity = `sha256:${"b".repeat(64)}`;
    const submission = { reviewId, pluginVersionId: versionId, publisherPublicId: "com.example.publisher", publisherKeyId: "release-1", pluginId: "com.example.weather", version: "1.0.0", packageIntegrity: integrity, packageSize: 1024, packageObjectKey: `plugins/${publisherId}/package`, status: "draft" };
    vi.mocked(deps.repository.createPluginSubmission).mockResolvedValue(submission);
    vi.mocked(deps.repository.getPluginSubmission).mockResolvedValue(submission);
    vi.mocked(deps.repository.recordAutomatedPluginReview).mockResolvedValue({ ...submission, status: "manual_review" });
    vi.mocked(deps.packageStorage.createUpload).mockResolvedValue({ uploadUrl: "https://objects.example/upload", expiresAt: new Date(Date.now() + 60_000).toISOString() });
    vi.mocked(deps.packageStorage.inspect).mockResolvedValue({ size: 1024, sha256: "b".repeat(64), immutable: true });
    vi.mocked(deps.packageScanner.scan).mockResolvedValue({ passed: true, manifestValid: true, signatureValid: true, integrityValid: true, declaredContentsOnly: true, malwareScan: "clean", capabilityFindings: [], networkFindings: [], dependencyInventory: [], behaviourTests: [{ name: "sandbox", passed: true }], reproducibility: {}, rejectionReasons: [] });
    const server = await createServer(deps);
    const payload = { pluginId: "com.example.weather", name: "Weather", summary: "Weather data", visibility: "public", ownerType: "personal", ownerId: session.accountId, version: "1.0.0", manifestVersion: 1, manifest: { publisherId: "com.example.publisher", pluginId: "com.example.weather", version: "1.0.0", packageIntegrity: integrity }, packageIntegrity: integrity, packageSize: 1024, publisherKeyId: "release-1", minimumHostVersion: ">=0.3.0", maximumHostVersion: null, capabilities: [], networkDomains: [], dependencyInventory: [], reproducibility: {} };
    const initiated = await server.inject({ method: "POST", url: `/v1/publishers/${publisherId}/plugins/submissions`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload });
    expect(initiated.statusCode, initiated.body).toBe(200);
    expect(initiated.json().upload.uploadUrl).toContain("objects.example");
    const finalized = await server.inject({ method: "POST", url: `/v1/publishers/${publisherId}/plugins/submissions/${reviewId}/submit`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() } });
    expect(finalized.statusCode, finalized.body).toBe(200);
    expect(finalized.json().submission.status).toBe("manual_review");
    expect(deps.packageScanner.scan).toHaveBeenCalledWith(submission.packageObjectKey, integrity, "com.example.publisher", "release-1");
    await server.close();
  });
});
