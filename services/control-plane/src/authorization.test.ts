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
    permissions: vi.fn(async (_accountId, workspaceId) => new Set(permissionByWorkspace[workspaceId] ?? [])),
    createOrganisation: vi.fn(), createInvitation: vi.fn(), acceptInvitation: vi.fn(), createSyncedWorkflow: vi.fn(), appendWorkflowRevision: vi.fn(),
    listWorkflowRevisions: vi.fn(), getWorkflowRevision: vi.fn(), resolveSyncConflict: vi.fn(),
    createPublisher: vi.fn(), registerPublisherSigningKey: vi.fn(), createPluginSubmission: vi.fn(), getPluginSubmission: vi.fn(), recordAutomatedPluginReview: vi.fn(), publishPluginVersion: vi.fn(), decidePluginReview: vi.fn(), revokePluginVersion: vi.fn(),
    searchMarketplace: vi.fn(), getMarketplaceListing: vi.fn(), getMarketplacePackage: vi.fn(),
    listAuditEvents: vi.fn(), exportAccountData: vi.fn(), requestAccountDeletion: vi.fn(), listSessions: vi.fn(), revokeSession: vi.fn(),
    createRunnerPairingChallenge: vi.fn(), confirmRunnerPairing: vi.fn(), listRunners: vi.fn(), createRunnerCommand: vi.fn(), revokeRunner: vi.fn(),
    requestWorkflowApproval: vi.fn(), decideWorkflowApproval: vi.fn(), publishWorkflowRevision: vi.fn(), rollbackWorkflowRevision: vi.fn(),
    getGovernancePolicies: vi.fn(), setGovernancePolicy: vi.fn()
  };
}

describe("Authorizer", () => {
  it("does not carry permissions across workspace tenants", async () => {
    const authorizer = new Authorizer(repository({
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa": ["members.manage"],
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb": []
    }));
    await expect(authorizer.require(session, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "members.manage")).resolves.toBeUndefined();
    await expect(authorizer.require(session, "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "members.manage")).rejects.toMatchObject({ code: "permission_denied", statusCode: 403 });
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
