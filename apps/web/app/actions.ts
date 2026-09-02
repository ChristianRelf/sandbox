"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { authenticatedClient, sessionCookie } from "../lib/auth";

async function client() {
  const value = await authenticatedClient();
  if (!value)
    throw new Error("Your account session has expired. Sign in again.");
  return value;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim())
    throw new Error(`${name} is required.`);
  return value.trim();
}

export async function createOrganisationAction(formData: FormData) {
  const api = await client();
  await api.createOrganisation({
    name: field(formData, "name"),
    slug: field(formData, "slug"),
  });
  revalidatePath("/organisations");
}

export async function inviteMemberAction(formData: FormData) {
  const api = await client();
  const workspaceId = field(formData, "workspaceId");
  await api.request({
    method: "POST",
    path: `/v1/workspaces/${encodeURIComponent(workspaceId)}/invitations`,
    body: {
      email: field(formData, "email"),
      role: field(formData, "role"),
      workspaceIds: [workspaceId],
      expiresInHours: 72,
    },
  });
  revalidatePath("/organisations");
}

export async function decideApprovalAction(formData: FormData) {
  const api = await client();
  const workspaceId = field(formData, "workspaceId");
  const decision = field(formData, "decision") as "approved" | "rejected";
  await api.decideWorkflowApproval(
    workspaceId,
    field(formData, "approvalId"),
    decision,
    (formData.get("reason") as string | null)?.trim() || null,
  );
  revalidatePath("/organisations");
}

export async function publishWorkflowAction(formData: FormData) {
  const api = await client();
  await api.publishWorkflow(
    field(formData, "workspaceId"),
    field(formData, "workflowId"),
    field(formData, "revisionId"),
    field(formData, "changeSummary"),
  );
  revalidatePath("/organisations");
}

export async function transitionDeploymentAction(formData: FormData) {
  const api = await client();
  const workspaceId = field(formData, "workspaceId");
  const status = field(formData, "status");
  if (status !== "active" && status !== "paused" && status !== "rolled_back") {
    throw new Error("Unsupported deployment transition.");
  }
  await api.transitionDeployment(workspaceId, field(formData, "deploymentId"), {
    status,
    reason: field(formData, "reason"),
  });
  revalidatePath("/organisations");
}

export async function revokeSessionAction(formData: FormData) {
  const api = await client();
  await api.revokeAccountSession(field(formData, "sessionId"));
  revalidatePath("/security");
}

export interface PersonalTokenActionState {
  token: string | null;
  prefix: string | null;
  error: string | null;
}

export async function issuePersonalTokenAction(
  _state: PersonalTokenActionState,
  formData: FormData,
): Promise<PersonalTokenActionState> {
  try {
    const api = await client();
    const [organisationId, workspaceId] = field(formData, "target").split(":");
    if (!organisationId || !workspaceId) throw new Error("Choose a workspace for this key.");
    const scopes = formData
      .getAll("scope")
      .filter((value): value is string => typeof value === "string");
    if (!scopes.length) throw new Error("Choose at least one permission.");
    const response = await api.createPersonalAccessToken({
      name: field(formData, "name"),
      organisationId,
      workspaceIds: [workspaceId],
      scopes,
      expiresInDays: Number(field(formData, "expiresInDays")),
    });
    revalidatePath("/security");
    return {
      token: response.data.credential.token,
      prefix: response.data.credential.prefix,
      error: null,
    };
  } catch (error) {
    return {
      token: null,
      prefix: null,
      error: error instanceof Error ? error.message : "The API key could not be created.",
    };
  }
}

export async function revokePersonalTokenAction(formData: FormData) {
  const api = await client();
  await api.revokePersonalAccessToken(
    field(formData, "tokenId"),
    "Revoked from account security settings",
  );
  revalidatePath("/security");
}

export interface RunnerPairingActionState {
  token: string | null;
  prefix: string | null;
  error: string | null;
}

export async function issueRunnerPairingTokenAction(
  _state: RunnerPairingActionState,
  formData: FormData,
): Promise<RunnerPairingActionState> {
  try {
    const api = await client();
    const [organisationId, workspaceId] = field(formData, "target").split(":");
    if (!organisationId || !workspaceId) throw new Error("Choose the workspace this runner will join.");
    const response = await api.createPersonalAccessToken({
      name: `Runner pairing · ${field(formData, "runnerName")}`,
      organisationId,
      workspaceIds: [workspaceId],
      scopes: ["runners.manage"],
      expiresInDays: 1,
    });
    revalidatePath("/operations");
    return { token: response.data.credential.token, prefix: response.data.credential.prefix, error: null };
  } catch (error) {
    return { token: null, prefix: null, error: error instanceof Error ? error.message : "The pairing token could not be created." };
  }
}

export async function updateRunnerStatusAction(formData: FormData) {
  const api = await client();
  const workspaceId = field(formData, "workspaceId");
  await api.request({
    method: "PATCH",
    path: `/v1/workspaces/${encodeURIComponent(workspaceId)}/runners/${encodeURIComponent(field(formData, "runnerId"))}`,
    body: { displayName: null, status: field(formData, "status") },
  });
  revalidatePath("/operations");
}

export async function revokeRunnerAction(formData: FormData) {
  const api = await client();
  const workspaceId = field(formData, "workspaceId");
  await api.request({
    method: "DELETE",
    path: `/v1/workspaces/${encodeURIComponent(workspaceId)}/runners/${encodeURIComponent(field(formData, "runnerId"))}`,
    body: {},
  });
  revalidatePath("/operations");
}

export interface AccountDeletionState {
  error: string | null;
}

export async function deleteAccountAction(
  _state: AccountDeletionState,
  formData: FormData,
): Promise<AccountDeletionState> {
  try {
    if (field(formData, "confirmation") !== "DELETE") {
      return { error: "Type DELETE exactly to confirm." };
    }
    const api = await client();
    await api.request({ method: "DELETE", path: "/v1/account", body: {} });
    (await cookies()).delete(sessionCookie);
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Account deletion could not be completed.",
    };
  }
  redirect("/sign-in");
}

export async function createRoleAction(formData: FormData) {
  const api = await client();
  await api.createOrganisationRole(field(formData, "organisationId"), {
    key: field(formData, "key"),
    displayName: field(formData, "displayName"),
    permissions: formData
      .getAll("permission")
      .filter((value): value is string => typeof value === "string"),
  });
  revalidatePath("/organisations");
}

export async function createSsoConnectionAction(formData: FormData) {
  const api = await client();
  await api.createSsoConnection(field(formData, "organisationId"), {
    connectionType: field(formData, "connectionType") as "oidc" | "saml",
    displayName: field(formData, "displayName"),
    issuerUrl: field(formData, "issuerUrl"),
    clientIdentifier: field(formData, "clientIdentifier"),
    verifiedDomains: field(formData, "verifiedDomains")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
    enabled: false,
  });
  revalidatePath("/organisations");
}

export interface ScimTokenActionState {
  token: string | null;
  prefix: string | null;
  error: string | null;
}

export async function issueScimTokenAction(
  _state: ScimTokenActionState,
  formData: FormData,
): Promise<ScimTokenActionState> {
  try {
    const api = await client();
    const response = await api.createScimToken(
      field(formData, "organisationId"),
      {
        name: field(formData, "name"),
        expiresInDays: Number(field(formData, "expiresInDays")),
      },
    );
    revalidatePath("/organisations");
    return {
      token: response.data.credential.token,
      prefix: response.data.credential.prefix,
      error: null,
    };
  } catch (error) {
    return {
      token: null,
      prefix: null,
      error:
        error instanceof Error
          ? error.message
          : "SCIM credential creation failed.",
    };
  }
}

export async function revokeScimTokenAction(formData: FormData) {
  const api = await client();
  await api.revokeScimToken(
    field(formData, "organisationId"),
    field(formData, "tokenId"),
  );
  revalidatePath("/organisations");
}
