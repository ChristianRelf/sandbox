"use server";

import { revalidatePath } from "next/cache";
import { authenticatedClient } from "../lib/auth";

async function client() {
  const value = await authenticatedClient();
  if (!value) throw new Error("Your account session has expired. Sign in again.");
  return value;
}

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || !value.trim()) throw new Error(`${name} is required.`);
  return value.trim();
}

export async function createOrganisationAction(formData: FormData) {
  const api = await client();
  await api.createOrganisation({ name: field(formData, "name"), slug: field(formData, "slug") });
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

export async function revokeSessionAction(formData: FormData) {
  const api = await client();
  await api.revokeAccountSession(field(formData, "sessionId"));
  revalidatePath("/security");
}
