import { z } from "zod";

export const idSchema = z.string().uuid();
export type OwnerType = "personal" | "workspace" | "organisation" | "publisher";
export const ownerRefSchema = z.object({ ownerType: z.enum(["personal", "workspace", "organisation", "publisher"]), ownerId: idSchema });
export type OwnerRef = z.infer<typeof ownerRefSchema>;

export const permissions = [
  "organisation.billing.manage",
  "organisation.delete",
  "organisation.owners.manage",
  "organisation.security.manage",
  "members.manage",
  "plugins.manage",
  "plugins.develop_private",
  "plugins.permissions.request",
  "runners.manage",
  "connections.manage",
  "connections.use",
  "workflows.create",
  "workflows.edit",
  "workflows.test",
  "workflows.run",
  "workflows.pause",
  "workflows.publish",
  "workflows.approve",
  "workflows.view",
  "executions.view_summary",
  "executions.view_detail",
  "approvals.handle",
  "audit.view",
  "webhooks.manage",
  "policies.manage"
] as const;
export type Permission = typeof permissions[number];
export type BuiltInRole = "owner" | "administrator" | "developer" | "operator" | "viewer";

export const rolePermissionMatrix: Readonly<Record<BuiltInRole, readonly Permission[]>> = {
  owner: permissions,
  administrator: ["members.manage", "plugins.manage", "runners.manage", "connections.manage", "connections.use", "workflows.create", "workflows.edit", "workflows.test", "workflows.run", "workflows.pause", "workflows.publish", "workflows.approve", "workflows.view", "executions.view_summary", "executions.view_detail", "approvals.handle", "audit.view", "webhooks.manage", "policies.manage"],
  developer: ["plugins.develop_private", "plugins.permissions.request", "connections.use", "workflows.create", "workflows.edit", "workflows.test", "workflows.view", "executions.view_summary"],
  operator: ["connections.use", "workflows.run", "workflows.pause", "workflows.view", "executions.view_summary", "approvals.handle"],
  viewer: ["workflows.view", "executions.view_summary"]
};

export const actorSchema = z.object({ accountId: idSchema, sessionId: idSchema, deviceId: idSchema.optional() });
export type Actor = z.infer<typeof actorSchema>;

export const invitationSchema = z.object({
  id: idSchema,
  organisationId: idSchema,
  workspaceIds: z.array(idSchema).min(1),
  email: z.string().email(),
  role: z.enum(["owner", "administrator", "developer", "operator", "viewer"]),
  expiresAt: z.string().datetime(),
  status: z.enum(["pending", "accepted", "revoked", "expired"])
});
export type Invitation = z.infer<typeof invitationSchema>;

export const workflowRevisionSchema = z.object({
  workflowId: idSchema,
  revisionId: idSchema,
  parentRevisionId: idSchema.nullable(),
  schemaVersion: z.number().int().positive(),
  contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  editorDeviceId: idSchema,
  updatedAt: z.string().datetime(),
  syncState: z.enum(["local", "synced", "conflicted", "deleted"]),
  encryption: z.object({ algorithm: z.literal("aes-256-gcm"), keyVersion: z.number().int().positive() }),
  encryptedPayload: z.string().base64().min(20).max(3_000_000),
  payloadKeyEnvelope: z.string().base64().min(20).max(1_024),
  searchableMetadata: z.object({
    name: z.string().trim().min(1).max(200),
    folderId: idSchema.nullable(),
    requiredPlugins: z.array(z.object({
      pluginId: z.string().min(3).max(200),
      version: z.string().min(1).max(50),
      packageIntegrity: z.string().regex(/^sha256:[a-f0-9]{64}$/)
    })).max(100),
    permissionRequirements: z.array(z.string().min(1).max(200)).max(200),
    runnerPolicy: z.record(z.string(), z.unknown())
  })
});
export type WorkflowRevision = z.infer<typeof workflowRevisionSchema>;

export const runnerCommandSchema = z.object({
  commandId: idSchema,
  issuerAccountId: idSchema,
  workspaceId: idSchema,
  targetRunnerId: idSchema,
  action: z.enum(["run_workflow", "cancel_execution", "pause_workflow", "resume_workflow", "request_diagnostics", "sync_revision"]),
  workflowRevisionId: idSchema.nullable(),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  idempotencyKey: z.string().min(16).max(200),
  payload: z.record(z.string(), z.unknown()),
  keyId: z.string().min(1),
  signature: z.string().min(1),
  status: z.enum(["queued", "delivered", "accepted", "rejected", "completed", "expired", "rerouted"])
});
export type RunnerCommand = z.infer<typeof runnerCommandSchema>;

export const runSummarySchema = z.object({
  id: idSchema,
  workspaceId: idSchema,
  workflowId: idSchema,
  revisionId: idSchema,
  runnerId: idSchema,
  trigger: z.string().max(100),
  status: z.enum(["waiting", "running", "successful", "failed", "cancelled", "expired"]),
  startedAt: z.string().datetime().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  failedNodeId: z.string().max(200).nullable(),
  redactedErrorSummary: z.string().max(2_000).nullable()
});
export type RunSummary = z.infer<typeof runSummarySchema>;

export const auditEventSchema = z.object({
  eventId: idSchema,
  timestamp: z.string().datetime(),
  actorAccountId: idSchema.nullable(),
  workspaceId: idSchema,
  action: z.string().min(1).max(120),
  resourceType: z.string().min(1).max(80),
  resourceId: z.string().min(1).max(200),
  beforeSummary: z.record(z.string(), z.unknown()).nullable(),
  afterSummary: z.record(z.string(), z.unknown()).nullable(),
  sourceDeviceId: idSchema.nullable(),
  correlationId: idSchema
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const entitlementClaimSchema = z.object({
  entitlementId: idSchema,
  owner: ownerRefSchema,
  pluginId: z.string().min(3),
  planId: z.string().min(1),
  status: z.enum(["trial", "active", "past_due", "expired", "refunded", "revoked"]),
  seatAllowance: z.number().int().positive().nullable(),
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime().nullable(),
  offlineGraceUntil: z.string().datetime(),
  issuer: z.string().url(),
  keyId: z.string().min(1),
  signature: z.string().min(1)
});
export type EntitlementClaim = z.infer<typeof entitlementClaimSchema>;

export const webhookEventSchema = z.object({
  deliveryId: idSchema,
  endpointId: idSchema,
  workspaceId: idSchema,
  receivedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  payloadCiphertext: z.string().min(1),
  idempotencyKey: z.string().min(16),
  status: z.enum(["queued", "delivered", "expired", "failed"])
});
export type WebhookEvent = z.infer<typeof webhookEventSchema>;

export interface Page<T> { items: T[]; nextCursor: string | null }

export function hasPermission(role: BuiltInRole, permission: Permission): boolean {
  return rolePermissionMatrix[role].includes(permission);
}
