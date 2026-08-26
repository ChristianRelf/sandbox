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
  authenticationMethods: ["passkey"]
};
const workspaceId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function dependencies(permissions: string[]) {
  const repository: ControlPlaneRepository = {
    permissions: vi.fn(async () => new Set(permissions as never[])),
    createOrganisation: vi.fn(),
    createInvitation: vi.fn(async (_actor, _workspace, input) => ({ id: crypto.randomUUID(), organisationId: crypto.randomUUID(), workspaceIds: input.workspaceIds, email: input.email, role: input.role, expiresAt: input.expiresAt.toISOString(), status: "pending" })),
    acceptInvitation: vi.fn(), appendWorkflowRevision: vi.fn(), listAuditEvents: vi.fn(), exportAccountData: vi.fn(), requestAccountDeletion: vi.fn(), listSessions: vi.fn(), revokeSession: vi.fn()
  };
  const sessions: SessionVerifier = { verify: vi.fn(async () => session) };
  const email: TransactionalEmail = { sendInvitation: vi.fn(async () => undefined) };
  return { repository, sessions, email, webBaseUrl: "https://app.sandbox.test" };
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
    expect(response.statusCode).toBe(200);
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
});
