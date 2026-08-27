import { describe, expect, it, vi } from "vitest";
import type { TransactionalEmail } from "./email.js";
import { createServer } from "./server.js";
import type { AuthenticatedSession, ControlPlaneRepository, SessionVerifier } from "./types.js";
import type { RunnerCommandSigner } from "./runner_protocol.js";

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
    createPublisher: vi.fn(), registerPublisherSigningKey: vi.fn(), createPluginSubmission: vi.fn(), getPluginSubmission: vi.fn(), recordAutomatedPluginReview: vi.fn(), publishPluginVersion: vi.fn(), decidePluginReview: vi.fn(), revokePluginVersion: vi.fn(),
    searchMarketplace: vi.fn(async () => ({ items: [], nextCursor: null })), getMarketplaceListing: vi.fn(), getMarketplacePackage: vi.fn(),
    listAuditEvents: vi.fn(), exportAccountData: vi.fn(), requestAccountDeletion: vi.fn(), listSessions: vi.fn(), revokeSession: vi.fn(),
    createRunnerPairingChallenge: vi.fn(), confirmRunnerPairing: vi.fn(), listRunners: vi.fn(), createRunnerCommand: vi.fn(), revokeRunner: vi.fn(),
    requestWorkflowApproval: vi.fn(), decideWorkflowApproval: vi.fn(), publishWorkflowRevision: vi.fn(), rollbackWorkflowRevision: vi.fn(),
    getGovernancePolicies: vi.fn(async () => ({})), setGovernancePolicy: vi.fn()
  };
  const sessions: SessionVerifier = { verify: vi.fn(async () => session) };
  const email: TransactionalEmail = { sendInvitation: vi.fn(async () => undefined) };
  const packageStorage = { createUpload: vi.fn(), createDownload: vi.fn(), inspect: vi.fn() };
  const packageScanner = { scan: vi.fn() };
  const runnerCommandSigner: RunnerCommandSigner = { keyId: "control-plane-1", sign: vi.fn(() => Buffer.alloc(64, 7).toString("base64")) };
  return { repository, sessions, email, packageStorage, packageScanner, runnerCommandSigner, webBaseUrl: "https://app.sandbox.test" };
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

  it("allows anonymous public discovery but requires workspace access for private filters", async () => {
    const deps = dependencies(["workflows.view"]);
    const server = await createServer(deps);
    const publicResponse = await server.inject({ method: "GET", url: "/v1/marketplace/plugins?pricing=free&verifiedOnly=true&hostVersion=0.3.0" });
    expect(publicResponse.statusCode, publicResponse.body).toBe(200);
    expect(deps.repository.searchMarketplace).toHaveBeenCalledWith(null, expect.objectContaining({ pricing: "free", verifiedOnly: true, visibility: "public" }));
    const privateResponse = await server.inject({ method: "GET", url: `/v1/marketplace/plugins?visibility=workspace&workspaceId=${workspaceId}` });
    expect(privateResponse.statusCode).toBe(401);
    await server.close();
  });

  it("issues a short-lived free-package grant with the publisher verification key", async () => {
    const deps = dependencies([]);
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32, 4)]).toString("base64");
    vi.mocked(deps.repository.getMarketplacePackage).mockResolvedValue({ pluginId: "com.example.weather", version: "1.0.0", packageIntegrity: `sha256:${"c".repeat(64)}`, packageSize: 1024, packageObjectKey: "plugins/weather", publisherPublicId: "com.example.publisher", publisherKeyId: "release-1", publisherPublicKeyDerBase64: der, pricingModel: "free" });
    vi.mocked(deps.packageStorage.createDownload).mockResolvedValue({ downloadUrl: "https://objects.example/download?signature=short-lived", expiresAt: new Date(Date.now()+300_000).toISOString() });
    const server = await createServer(deps);
    const response = await server.inject({ method: "GET", url: "/v1/marketplace/plugins/com.example.weather/install" });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().publisher.publicKeyPem).toContain("BEGIN PUBLIC KEY");
    expect(response.json().download.downloadUrl).toContain("signature=short-lived");
    await server.close();
  });

  it("pairs a runner only after workspace authorization and proof of possession", async () => {
    const deps = dependencies(["runners.manage"]);
    const challengeId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const runnerId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.alloc(32, 9)]).toString("base64");
    vi.mocked(deps.repository.createRunnerPairingChallenge).mockResolvedValue({ challengeId, challenge: "challenge-value-with-enough-entropy-123", expiresAt: new Date(Date.now()+600_000).toISOString() });
    vi.mocked(deps.repository.confirmRunnerPairing).mockResolvedValue({ runnerId, displayName: "Studio PC", workspaceId, operatingSystem: "windows", architecture: "x86_64", applicationVersion: "0.3.0", protocolVersion: 1, pluginRuntimeVersion: "0.3.0", capabilities: {}, safeFolderLabels: [], browserEngine: null, installedPluginVersions: [], tags: ["studio"], status: "offline", currentWorkload: 0, pairedAt: new Date().toISOString(), lastSeenAt: null });
    const server = await createServer(deps);
    const started = await server.inject({ method: "POST", url: "/v1/runners/pairing/challenges", headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { devicePublicKeyDerBase64: der, operatingSystem: "windows", architecture: "x86_64", applicationVersion: "0.3.0", protocolVersion: 1, pluginRuntimeVersion: "0.3.0", capabilities: {}, tags: ["studio"] } });
    expect(started.statusCode, started.body).toBe(200);
    const confirmed = await server.inject({ method: "POST", url: "/v1/runners/pairing/confirm", headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { challengeId, challenge: started.json().challenge, signatureBase64: Buffer.alloc(64, 3).toString("base64"), workspaceId, displayName: "Studio PC" } });
    expect(confirmed.statusCode, confirmed.body).toBe(200);
    expect(deps.repository.confirmRunnerPairing).toHaveBeenCalledWith(session, expect.objectContaining({ workspaceId, displayName: "Studio PC" }), expect.any(String));
    await server.close();
  });

  it("creates signed expiring idempotent commands for an exact workflow revision", async () => {
    const deps = dependencies(["workflows.run"]);
    const targetRunnerId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const revisionId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    vi.mocked(deps.repository.createRunnerCommand).mockImplementation(async (_actor, command) => ({ ...command, issuerAccountId: session.accountId, status: "queued" }));
    const server = await createServer(deps);
    const response = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/runner-commands`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { targetRunnerId, action: "run_workflow", workflowRevisionId: revisionId, payload: { trigger: "remote" }, idempotencyKey: "remote-run-unique-0001", expiresInSeconds: 300 } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().command).toMatchObject({ workspaceId, targetRunnerId, workflowRevisionId: revisionId, keyId: "control-plane-1", status: "queued" });
    expect(response.json().command.signature).toBeTruthy();
    await server.close();
  });

  it("keeps draft approval and publication as explicit authorized transitions", async () => {
    const deps = dependencies(["workflows.edit", "workflows.approve", "workflows.publish"]);
    const workflowId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    const revisionId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const approvalId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const createdAt = new Date().toISOString();
    vi.mocked(deps.repository.requestWorkflowApproval).mockResolvedValue({ approvalId, workflowId, revisionId, status: "pending", requiredApprovals: 1, approvalCount: 0, createdAt });
    vi.mocked(deps.repository.decideWorkflowApproval).mockResolvedValue({ approvalId, workflowId, revisionId, status: "approved", requiredApprovals: 1, approvalCount: 1, createdAt });
    vi.mocked(deps.repository.publishWorkflowRevision).mockResolvedValue({ workflowId, publishedRevisionId: revisionId, previousPublishedRevisionId: null });
    const server = await createServer(deps);
    const headers = { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() };
    const requested = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/workflows/${workflowId}/revisions/${revisionId}/request-approval`, headers });
    expect(requested.statusCode, requested.body).toBe(200);
    const decided = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/workflow-approvals/${approvalId}/decision`, headers, payload: { decision: "approved" } });
    expect(decided.statusCode, decided.body).toBe(200);
    const published = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/workflows/${workflowId}/revisions/${revisionId}/publish`, headers, payload: { changeSummary: "Approved production revision" } });
    expect(published.statusCode, published.body).toBe(200);
    expect(deps.repository.publishWorkflowRevision).toHaveBeenCalledWith(session, workspaceId, workflowId, revisionId, "Approved production revision", expect.any(String));
    await server.close();
  });

  it("returns an actionable governance failure when remote execution is disabled", async () => {
    const deps = dependencies(["workflows.run"]);
    vi.mocked(deps.repository.getGovernancePolicies).mockResolvedValue({ remote_execution: false });
    const server = await createServer(deps);
    const response = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/runner-commands`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { targetRunnerId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", action: "run_workflow", workflowRevisionId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", idempotencyKey: "remote-run-unique-0002" } });
    expect(response.statusCode).toBe(403);
    expect(response.json().error.message).toMatch(/remote_execution.*administrator.*local runner/i);
    expect(deps.repository.createRunnerCommand).not.toHaveBeenCalled();
    await server.close();
  });
});
