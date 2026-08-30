"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "../lib/auth";

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
