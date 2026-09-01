import type { Permission } from "@sandbox/contracts";
import { describe, expect, it, vi } from "vitest";
import { Authorizer } from "./authorization.js";
import type { AuthenticatedSession, ControlPlaneRepository } from "./types.js";

const session: AuthenticatedSession = {
  accountId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  subject: "identity|one",
  email: "one@example.com",
  issuedAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  authenticationMethods: ["passkey"]
  ,platformPermissions: []
};

function repository(permissionByWorkspace: Record<string, Permission[]>): ControlPlaneRepository {
  return {
    permissions: vi.fn(async (_accountId, workspaceId) => new Set(permissionByWorkspace[workspaceId] ?? [])), listAccountOrganisations:vi.fn(),
    createOrganisation: vi.fn(), createInvitation: vi.fn(), acceptInvitation: vi.fn(), createSyncedWorkflow: vi.fn(), listSyncedWorkflows:vi.fn(), appendWorkflowRevision: vi.fn(),
    listWorkflowRevisions: vi.fn(), getWorkflowRevision: vi.fn(), resolveSyncConflict: vi.fn(),
    createPublisher: vi.fn(), registerPublisherSigningKey: vi.fn(), createPluginSubmission: vi.fn(), getPluginSubmission: vi.fn(), recordAutomatedPluginReview: vi.fn(), publishPluginVersion: vi.fn(), decidePluginReview: vi.fn(), revokePluginVersion: vi.fn(),
    searchMarketplace: vi.fn(), getMarketplaceListing: vi.fn(), getMarketplacePackage: vi.fn(),
    listAuditEvents: vi.fn(), exportAccountData: vi.fn(), requestAccountDeletion: vi.fn(), listSessions: vi.fn(), revokeSession: vi.fn(),
    createRunnerPairingChallenge: vi.fn(), confirmRunnerPairing: vi.fn(), listRunners: vi.fn(), createRunnerCommand: vi.fn(), revokeRunner: vi.fn(),
    requestWorkflowApproval: vi.fn(), listWorkflowApprovals:vi.fn(), decideWorkflowApproval: vi.fn(), publishWorkflowRevision: vi.fn(), rollbackWorkflowRevision: vi.fn(),
    getGovernancePolicies: vi.fn(), setGovernancePolicy: vi.fn(), listWorkspaceMembers: vi.fn(), updateWorkspaceMemberRole: vi.fn(), removeWorkspaceMember: vi.fn(), revokeInvitation: vi.fn(),
    authenticateRunnerRequest: vi.fn(), recordRunnerHeartbeat: vi.fn(), dequeueRunnerCommands: vi.fn(), updateRunnerCommandStatus: vi.fn(), recordRunnerTriggerEvents: vi.fn(), recordRunSummary: vi.fn(), listWorkspaceActivity: vi.fn(), listDeployments:vi.fn(), createDeployment:vi.fn(), transitionDeployment:vi.fn(), listRunnerPools:vi.fn(), createRunnerPool:vi.fn(), updateRunnerPool:vi.fn(), deleteRunnerPool:vi.fn(),
    listOrganisationRoles:vi.fn(),createOrganisationRole:vi.fn(),updateOrganisationRole:vi.fn(),deleteOrganisationRole:vi.fn(),listSsoConnections:vi.fn(),createSsoConnection:vi.fn(),updateSsoConnection:vi.fn(),deleteSsoConnection:vi.fn(),listScimTokens:vi.fn(),createScimToken:vi.fn(),revokeScimToken:vi.fn(),authenticateScimToken:vi.fn(),listScimUsers:vi.fn(),getScimUser:vi.fn(),upsertScimUser:vi.fn(),
    listWorkspaceEnvironments: vi.fn(), listSharedConnections: vi.fn(), createSharedConnection: vi.fn(), deploySharedConnection: vi.fn(),
    getPluginBillingPlan: vi.fn(), recordMarketplaceCheckout: vi.fn(), applyBillingEvent: vi.fn(), getActiveEntitlement: vi.fn(),
    createWebhookEndpoint: vi.fn(), listWebhookEndpoints: vi.fn(), getWebhookEndpointByPublicId: vi.fn(), rotateWebhookSecret: vi.fn(), enqueueWebhookDelivery: vi.fn(), dequeueWebhookDeliveries: vi.fn(), acknowledgeWebhookDelivery: vi.fn(),
    listPluginRatings: vi.fn(), upsertPluginRating: vi.fn(), respondToPluginRating: vi.fn(), reportPluginRating: vi.fn(), updateRunner: vi.fn(), moveRunner: vi.fn(), rotateRunnerDeviceKey: vi.fn(),
    listProtectedVariables: vi.fn(), upsertProtectedVariable: vi.fn(), resolveProtectedVariables: vi.fn()
  };
}

describe("Authorizer", () => {
  it("does not carry permissions across workspace tenants", async () => {
    const authorizer = new Authorizer(repository({
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": ["members.manage"],
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": []
    }));
    await expect(authorizer.require(session, { workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",permission:"members.manage",resourceType:"workspace_member" })).resolves.toBeUndefined();
    await expect(authorizer.require(session, { workspaceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",permission:"members.manage",resourceType:"workspace_member" })).rejects.toMatchObject({ code: "permission_denied", statusCode: 403 });
  });

  it("enforces credential scopes plus workspace and environment restrictions before role permissions",async()=>{
    const authorizer=new Authorizer(repository({"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa":["workflows.run","workflows.edit"]}));
    const token:AuthenticatedSession={...session,principalType:"personal_access_token",principalId:"token-1",credentialScopes:["workflows.run"],workspaceRestrictions:["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],environmentRestrictions:["cccccccc-cccc-4ccc-8ccc-cccccccccccc"]};
    await expect(authorizer.require(token,{workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",environmentId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",permission:"workflows.run",resourceType:"workflow"})).resolves.toBeUndefined();
    await expect(authorizer.require(token,{workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",environmentId:"cccccccc-cccc-4ccc-8ccc-cccccccccccc",permission:"workflows.edit",resourceType:"workflow"})).rejects.toMatchObject({code:"credential_scope_denied"});
    await expect(authorizer.require(token,{workspaceId:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",permission:"workflows.run",resourceType:"workflow"})).rejects.toMatchObject({code:"credential_workspace_restricted"});
    await expect(authorizer.require(token,{workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",environmentId:"dddddddd-dddd-4ddd-8ddd-dddddddddddd",permission:"workflows.run",resourceType:"workflow"})).rejects.toMatchObject({code:"credential_environment_restricted"});
    await expect(authorizer.require({...token,credentialScopes:["workflows.run"],principalPermissions:["workflows.view"]},{workspaceId:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",permission:"workflows.run",resourceType:"workflow"})).rejects.toMatchObject({code:"principal_permission_denied"});
  });

  it("returns actionable governance failures", () => {
    const authorizer = new Authorizer(repository({}));
    expect(() => authorizer.enforcePolicy(false, {
      policy: "verified_publishers_only",
      resource: "plugin com.example.weather",
      administratorAction: "An administrator can change Marketplace policy.",
      userAction: "Choose a verified alternative or request an exception."
    })).toThrow(/verified_publishers_only.*administrator.*verified alternative/i);
  });
});
