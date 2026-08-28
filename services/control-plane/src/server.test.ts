import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { TransactionalEmail } from "./email.js";
import { createServer } from "./server.js";
import type { AuthenticatedSession, ControlPlaneRepository, SessionVerifier } from "./types.js";
import type { RunnerCommandSigner } from "./runner_protocol.js";
import type { BillingProvider } from "./billing.js";
import type { EntitlementClaimSigner } from "./entitlement.js";
import { WebhookProtector, webhookSignature } from "./webhook_crypto.js";
import type { CredentialAdministration } from "./credentials.js";
import { MemoryApiIdempotencyStore } from "./api_contract.js";
import { HmacUsageProducerAuthenticator } from "./usage_producer.js";
import type { UsageEventInput } from "./usage.js";

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
    getGovernancePolicies: vi.fn(async () => ({})), setGovernancePolicy: vi.fn(), listWorkspaceMembers: vi.fn(), updateWorkspaceMemberRole: vi.fn(), removeWorkspaceMember: vi.fn(), revokeInvitation: vi.fn(),
    authenticateRunnerRequest: vi.fn(), recordRunnerHeartbeat: vi.fn(), dequeueRunnerCommands: vi.fn(), updateRunnerCommandStatus: vi.fn(), recordRunSummary: vi.fn(), listWorkspaceActivity: vi.fn(),
    listWorkspaceEnvironments: vi.fn(), listSharedConnections: vi.fn(), createSharedConnection: vi.fn(), deploySharedConnection: vi.fn(),
    getPluginBillingPlan: vi.fn(), recordMarketplaceCheckout: vi.fn(), applyBillingEvent: vi.fn(), getActiveEntitlement: vi.fn(),
    createWebhookEndpoint: vi.fn(), listWebhookEndpoints: vi.fn(), getWebhookEndpointByPublicId: vi.fn(), rotateWebhookSecret: vi.fn(), enqueueWebhookDelivery: vi.fn(), dequeueWebhookDeliveries: vi.fn(), acknowledgeWebhookDelivery: vi.fn(),
    listPluginRatings: vi.fn(), upsertPluginRating: vi.fn(), respondToPluginRating: vi.fn(), reportPluginRating: vi.fn(), updateRunner: vi.fn(), moveRunner: vi.fn(), rotateRunnerDeviceKey: vi.fn(),
    listProtectedVariables: vi.fn(), upsertProtectedVariable: vi.fn(), resolveProtectedVariables: vi.fn()
  };
  const sessions: SessionVerifier = { verify: vi.fn(async () => session) };
  const email: TransactionalEmail = { sendInvitation: vi.fn(async () => undefined) };
  const packageStorage = { createUpload: vi.fn(), createDownload: vi.fn(), inspect: vi.fn() };
  const packageScanner = { scan: vi.fn() };
  const runnerCommandSigner: RunnerCommandSigner = { keyId: "control-plane-1", sign: vi.fn(() => Buffer.alloc(64, 7).toString("base64")) };
  const billing: BillingProvider = { createCheckout: vi.fn(), parseWebhook: vi.fn() };
  const entitlementSigner: EntitlementClaimSigner = { keyId: "entitlement-1", issuer: "https://api.sandbox.test", sign: vi.fn(record => ({ entitlementId: record.entitlementId, owner: { ownerType: record.ownerType, ownerId: record.ownerId }, pluginId: record.pluginId, planId: record.planId, status: record.status, seatAllowance: record.seatAllowance, validFrom: record.startsAt, validUntil: record.renewsAt, offlineGraceUntil: record.offlineGraceUntil, issuer: "https://api.sandbox.test", keyId: "entitlement-1", signature: Buffer.alloc(64, 8).toString("base64") })) };
  const credentialService:CredentialAdministration={createServiceAccount:vi.fn(),listServiceAccounts:vi.fn(),issuePersonalToken:vi.fn(),issueServiceAccountToken:vi.fn(),listPersonalTokens:vi.fn(),revokeToken:vi.fn()};
  return { repository, sessions, email, packageStorage, packageScanner, runnerCommandSigner, billing, entitlementSigner, credentialService, webhookProtector: new WebhookProtector(Buffer.alloc(32, 4)), protectedValueProtector: new WebhookProtector(Buffer.alloc(32, 5)), webhookBaseUrl: "https://hooks.sandbox.test", webBaseUrl: "https://app.sandbox.test" };
}

describe("control-plane API", () => {
  it("accepts only signed events from a trusted usage producer",async()=>{
    const secret=Buffer.alloc(32,8),record=vi.fn(async(input:UsageEventInput)=>({eventId:input.eventId,created:true}));
    const deps={...dependencies([]),usageLedger:{record},usageProducerAuthenticator:new HmacUsageProducerAuthenticator(new Map([["hosted-runner",secret]]))};
    const server=await createServer(deps);const payload={eventId:"10000000-0000-4000-8000-000000000001",workspaceId:"20000000-0000-4000-8000-000000000002",environmentId:"30000000-0000-4000-8000-000000000003",executionId:"40000000-0000-4000-8000-000000000004",deploymentId:"50000000-0000-4000-8000-000000000005",meter:"hosted_runner_seconds" as const,quantity:3,unit:"seconds" as const,sourceEventId:"hosted-runner-stop:execution",idempotencyKey:"hosted-runner-usage:execution",periodStartedAt:"2026-08-28T10:00:00.000Z",periodEndedAt:"2026-08-28T10:00:03.000Z",region:"eu-west-2",metadata:{producer:"hosted-runner"}};
    const timestamp=Math.floor(Date.now()/1000).toString(),signature=createHmac("sha256",secret).update(`${timestamp}.${JSON.stringify(payload)}`).digest("hex"),headers={"x-sandbox-usage-producer":"hosted-runner","x-sandbox-usage-timestamp":timestamp,"x-sandbox-usage-signature":signature};
    const accepted=await server.inject({method:"POST",url:"/v1/internal/usage-events",headers,payload});expect(accepted.statusCode,accepted.body).toBe(200);expect(record).toHaveBeenCalledWith(payload);
    const rejected=await server.inject({method:"POST",url:"/v1/internal/usage-events",headers:{...headers,"x-sandbox-usage-signature":"0".repeat(64)},payload});expect(rejected.statusCode).toBe(401);expect(record).toHaveBeenCalledTimes(1);await server.close();
  });
  it("returns stable structured transport errors and correlation headers",async()=>{
    const deps=dependencies([]);const server=await createServer(deps);
    const response=await server.inject({method:"POST",url:"/v1/personal-access-tokens",headers:{authorization:"Bearer token","content-type":"application/json","x-correlation-id":"client-correlation-0001"},payload:'{"broken":'});
    expect(response.statusCode).toBe(400);
    expect(response.headers["x-correlation-id"]).toBe("client-correlation-0001");
    expect(response.json()).toEqual({error:{code:"invalid_json",message:"The request body must be valid JSON."},correlationId:"client-correlation-0001"});
    await server.close();
  });

  it("replays identical mutating requests and rejects idempotency-key mutation",async()=>{
    const deps={...dependencies(["members.manage"]),idempotencyStore:new MemoryApiIdempotencyStore()};
    const server=await createServer(deps);const key="invitation-request-0001";
    const request={method:"POST" as const,url:`/v1/workspaces/${workspaceId}/invitations`,headers:{authorization:"Bearer token","x-sandbox-request-time":new Date().toISOString(),"idempotency-key":key},payload:{email:"developer@example.com",role:"developer",workspaceIds:[workspaceId],expiresInHours:24}};
    const first=await server.inject(request);const replay=await server.inject(request);
    expect(first.statusCode,first.body).toBe(200);expect(replay.statusCode,replay.body).toBe(200);
    expect(replay.headers["idempotency-replayed"]).toBe("true");expect(replay.json()).toEqual(first.json());
    expect(deps.repository.createInvitation).toHaveBeenCalledTimes(1);expect(deps.email.sendInvitation).toHaveBeenCalledTimes(1);
    const conflict=await server.inject({...request,payload:{...request.payload,email:"different@example.com"}});
    expect(conflict.statusCode).toBe(409);expect(conflict.json().error.code).toBe("idempotency_key_reused");
    await server.close();
  });

  it("publishes rate-limit headers and the machine-readable v1 route contract",async()=>{
    const deps=dependencies([]);const server=await createServer(deps);
    const health=await server.inject({method:"GET",url:"/health"});
    expect(health.headers["x-ratelimit-limit"]).toBe("60");expect(health.headers["x-correlation-id"]).toBeTruthy();
    let limited=health;
    for(let index=1;index<=60;index+=1)limited=await server.inject({method:"GET",url:"/health"});
    expect(limited.statusCode,limited.body).toBe(429);expect(limited.headers["retry-after"]).toBeTruthy();expect(limited.json()).toMatchObject({error:{code:"rate_limit_exceeded"},correlationId:expect.any(String)});
    const contract=await server.inject({method:"GET",url:"/v1/openapi.json"});
    expect(contract.statusCode,contract.body).toBe(200);
    expect(contract.json()).toMatchObject({openapi:"3.1.0",info:{version:"0.5.0"},paths:{"/v1/personal-access-tokens":{get:expect.any(Object),post:expect.any(Object)}}});
    await server.close();
  });

  it("shows a newly issued personal token once and never asks the credential service to persist plaintext",async()=>{
    const deps=dependencies([]);const organisationId="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",environmentId="cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    vi.mocked(deps.credentialService.issuePersonalToken).mockResolvedValue({id:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",name:"CI",prefix:"sbx_pat_abcdefghijkl",token:"sbx_pat_abcdefghijkl.secret",scopes:["workflows.run"],organisationId,workspaceIds:[workspaceId],environmentIds:[environmentId],createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString()});
    const server=await createServer(deps);const response=await server.inject({method:"POST",url:"/v1/personal-access-tokens",headers:{authorization:"Bearer token","x-sandbox-request-time":new Date().toISOString()},payload:{name:"CI",scopes:["workflows.run"],organisationId,workspaceIds:[workspaceId],environmentIds:[environmentId],expiresInDays:1}});
    expect(response.statusCode,response.body).toBe(200);expect(response.json().credential.token).toMatch(/^sbx_pat_/);expect(deps.credentialService.issuePersonalToken).toHaveBeenCalledWith(session,expect.not.objectContaining({token:expect.anything()}),expect.any(String));await server.close();
  });

  it("requires server-side service-account management permission",async()=>{
    const deps=dependencies([]);const server=await createServer(deps);const response=await server.inject({method:"POST",url:`/v1/workspaces/${workspaceId}/service-accounts`,headers:{authorization:"Bearer token","x-sandbox-request-time":new Date().toISOString()},payload:{name:"Deploy bot",roleId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"}});
    expect(response.statusCode).toBe(403);expect(deps.credentialService.createServiceAccount).not.toHaveBeenCalled();await server.close();
  });

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

  it("requires the distinct owner-management permission when assigning an owner", async () => {
    const deps = dependencies(["members.manage"]);
    const server = await createServer(deps);
    const response = await server.inject({ method: "PUT", url: `/v1/workspaces/${workspaceId}/members/33333333-3333-4333-8333-333333333333/role`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { role: "owner" } });
    expect(response.statusCode).toBe(403);
    expect(deps.repository.updateWorkspaceMemberRole).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects stale runner device requests before reading commands", async () => {
    const deps = dependencies([]);
    const server = await createServer(deps);
    const response = await server.inject({ method: "GET", url: "/v1/runner/commands", headers: { "x-sandbox-runner-id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "x-sandbox-key-id": "device-1", "x-sandbox-request-time": new Date(Date.now()-10*60_000).toISOString(), "x-sandbox-request-nonce": "request-nonce-0001", "x-sandbox-signature": Buffer.alloc(64).toString("base64") } });
    expect(response.statusCode).toBe(400);
    expect(deps.repository.authenticateRunnerRequest).not.toHaveBeenCalled();
    await server.close();
  });

  it("rejects raw secret fields when creating a shared connection", async () => {
    const deps = dependencies(["connections.manage"]);
    const server = await createServer(deps);
    const response = await server.inject({ method: "POST", url: `/v1/workspaces/${workspaceId}/connections`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { environmentId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", provider: "gmail", displayName: "Company Gmail", grantedScopes: ["gmail.readonly"], deploymentMode: "authorize_per_runner", accessToken: "must-never-enter-this-api" } });
    expect(response.statusCode).toBe(400);
    expect(deps.repository.createSharedConnection).not.toHaveBeenCalled();
    await server.close();
  });

  it("creates Stripe-hosted checkout without accepting card data", async () => {
    const deps = dependencies([]);
    vi.mocked(deps.repository.getPluginBillingPlan).mockResolvedValue({ pluginId: "com.example.weather", planId: "pro", stripePriceId: "price_123", mode: "subscription", offlineGraceDays: 7, seatAllowance: 5, customerId: null });
    vi.mocked(deps.billing.createCheckout).mockResolvedValue({ checkoutId: "cs_test_123", url: "https://checkout.stripe.com/c/pay/test", expiresAt: new Date(Date.now()+1800_000).toISOString() });
    const server = await createServer(deps);
    const response = await server.inject({ method: "POST", url: "/v1/marketplace/plugins/com.example.weather/checkout", headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { ownerType: "personal", ownerId: session.accountId, planId: "pro" } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().checkout.url).toContain("checkout.stripe.com");
    expect(deps.billing.createCheckout).toHaveBeenCalledWith(expect.objectContaining({ priceId: "price_123", mode: "subscription" }));
    expect(deps.repository.recordMarketplaceCheckout).toHaveBeenCalledWith(session, "cs_test_123", "personal", session.accountId, "com.example.weather", "pro", expect.any(String));
    await server.close();
  });

  it("accepts a signed webhook once and queues only encrypted redacted payload", async () => {
    const deps = dependencies([]);
    const publicId = "abcdefghijklmnopqrstuvwxABCDEFGH";
    const secret = Buffer.alloc(32, 6);
    vi.mocked(deps.repository.getWebhookEndpointByPublicId).mockResolvedValue({ id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", publicId, workspaceId, workflowId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", signingSecretCiphertext: deps.webhookProtector.encrypt(secret), allowedMethods: ["POST"], schema: { type: "object", required: ["event"] }, maximumRequestBytes: 1024, rateLimitPerMinute: 10, retentionSeconds: 3600, runnerPolicy: {}, offlineExpirySeconds: 900, redactedFields: ["user.token"], disabled: false });
    vi.mocked(deps.repository.enqueueWebhookDelivery).mockResolvedValue({ status: "queued", expiresAt: new Date(Date.now()+900_000).toISOString() });
    const server = await createServer(deps);
    const body = Buffer.from(JSON.stringify({ event: "created", user: { token: "secret" } })); const timestamp = new Date().toISOString(); const nonce = "unique-webhook-nonce-1";
    const response = await server.inject({ method: "POST", url: `/hooks/${publicId}`, headers: { "content-type": "application/json", "x-sandbox-webhook-timestamp": timestamp, "x-sandbox-webhook-nonce": nonce, "x-sandbox-webhook-signature": webhookSignature(secret, timestamp, nonce, body) }, payload: body });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.json().execution).toBe("waiting_for_local_runner");
    const encrypted = vi.mocked(deps.repository.enqueueWebhookDelivery).mock.calls[0][4];
    expect(deps.webhookProtector.decrypt(encrypted).toString()).toContain("[REDACTED]");
    expect(deps.webhookProtector.decrypt(encrypted).toString()).not.toContain("secret");
    await server.close();
  });

  it("encrypts secret environment values before persistence and omits the value from the response", async () => {
    const deps = dependencies(["connections.manage"]); const environmentId = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"; const workflowId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
    vi.mocked(deps.repository.upsertProtectedVariable).mockImplementation(async (_actor, _workspace, environment, name, valueType, isSecret, _ciphertext, nonSecretValue, description, allowedWorkflowIds) => ({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", environmentId: environment, name, valueType, isSecret, nonSecretValue, description, allowedWorkflowIds, changedBy: session.accountId, changedAt: new Date().toISOString() }));
    const server = await createServer(deps);
    const response = await server.inject({ method: "PUT", url: `/v1/workspaces/${workspaceId}/environments/${environmentId}/variables/API_KEY`, headers: { authorization: "Bearer token", "x-sandbox-request-time": new Date().toISOString() }, payload: { valueType: "string", isSecret: true, value: "top-secret", description: "Provider key", allowedWorkflowIds: [workflowId] } });
    expect(response.statusCode, response.body).toBe(200);
    expect(response.body).not.toContain("top-secret");
    const call = vi.mocked(deps.repository.upsertProtectedVariable).mock.calls[0];
    expect(call[6]).toBeInstanceOf(Buffer); expect(call[7]).toBeNull(); expect(call[6]?.toString()).not.toContain("top-secret");
    await server.close();
  });
});
