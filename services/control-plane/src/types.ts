import type { AuditEvent, BuiltInRole, MarketplaceListing, Permission, RunnerCommand, RunnerRecord, RunSummary, WorkflowRevision } from "@sandbox/contracts";
import type { BillingEvent } from "./billing.js";

export interface AuthenticatedSession {
  accountId: string;
  sessionId: string;
  subject: string;
  email: string;
  issuedAt: Date;
  expiresAt: Date;
  authenticationMethods: string[];
  platformPermissions: string[];
}

export interface SessionVerifier {
  verify(token: string): Promise<AuthenticatedSession>;
}

export interface OrganisationInput { name: string; slug: string }
export interface OrganisationRecord extends OrganisationInput { id: string; createdAt: string }
export interface WorkspaceRecord { id: string; organisationId: string; name: string; slug: string; createdAt: string }
export interface InvitationInput { workspaceIds: string[]; email: string; role: BuiltInRole; expiresAt: Date; tokenHash: Buffer }
export interface InvitationRecord { id: string; organisationId: string; workspaceIds: string[]; email: string; role: BuiltInRole; expiresAt: string; status: string }
export interface SyncWriteResult { revision: WorkflowRevision; conflictRevisionId: string | null }
export interface SyncedWorkflowInput { workflowId: string; name: string }
export interface PluginSubmissionInput {
  publisherId: string; pluginId: string; name: string; summary: string; visibility: "public" | "organisation" | "selected_workspaces";
  ownerType: "personal" | "organisation"; ownerId: string; version: string; manifestVersion: number; manifest: Record<string, unknown>;
  packageIntegrity: string; packageSize: number; publisherKeyId: string; minimumHostVersion: string; maximumHostVersion: string | null;
  capabilities: unknown[]; networkDomains: unknown[]; dependencyInventory: unknown[]; reproducibility: Record<string, unknown>;
}
export interface PluginSubmissionRecord { reviewId: string; pluginVersionId: string; publisherPublicId: string; publisherKeyId: string; pluginId: string; version: string; packageIntegrity: string; packageSize: number; packageObjectKey: string; status: string }
export interface PublisherInput { publicId: string; ownerType: "personal" | "organisation"; ownerId: string; publicName: string; slug: string; description: string; website: string | null; supportContact: string; securityContact: string }
export interface MarketplaceQuery { search: string | null; category: string | null; pricing: "all" | "free" | "paid"; verifiedOnly: boolean; visibility: "public" | "workspace" | "all"; workspaceId: string | null; teamApprovedOnly: boolean; sort: "recent" | "installs" | "rating"; cursor: string | null; limit: number; hostVersion: string }
export interface MarketplacePackage { pluginId: string; version: string; packageIntegrity: string; packageSize: number; packageObjectKey: string; publisherPublicId: string; publisherKeyId: string; publisherPublicKeyDerBase64: string; pricingModel: string }
export interface RunnerPairingChallengeInput {
  devicePublicKeyDerBase64: string;
  operatingSystem: string;
  architecture: string;
  applicationVersion: string;
  protocolVersion: number;
  pluginRuntimeVersion: string;
  capabilities: Record<string, unknown>;
  safeFolderLabels: string[];
  browserEngine: Record<string, unknown> | null;
  installedPluginVersions: Array<{ pluginId: string; version: string; packageIntegrity: string }>;
  tags: string[];
}
export interface RunnerPairingChallengeRecord { challengeId: string; challenge: string; expiresAt: string }
export interface RunnerPairingConfirmationInput { challengeId: string; challenge: string; signatureBase64: string; workspaceId: string | null; displayName: string }
export interface RunnerCommandInput {
  commandId: string;
  workspaceId: string;
  targetRunnerId: string;
  action: RunnerCommand["action"];
  workflowRevisionId: string | null;
  payload: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  idempotencyKey: string;
  keyId: string;
  signature: string;
}
export interface WorkflowApprovalRecord { approvalId: string; workflowId: string; revisionId: string; status: "pending" | "approved" | "rejected" | "expired"; requiredApprovals: number; approvalCount: number; createdAt: string }
export type GovernancePolicies = Record<string, unknown>;
export interface WorkspaceMemberRecord { accountId: string; email: string; displayName: string; role: BuiltInRole; joinedAt: string }
export interface RunnerDeviceRequestInput { runnerId: string; keyId: string; requestTime: string; nonce: string; signatureBase64: string; method: string; path: string; body: unknown }
export interface RunnerDeviceSession { runnerId: string; accountId: string; workspaceId: string; keyId: string }
export interface WorkspaceEnvironmentRecord { environmentId: string; environment: "development" | "production" }
export interface SharedConnectionRecord { id: string; workspaceId: string; environmentId: string; provider: string; displayName: string; accountIdentity: string | null; grantedScopes: string[]; permittedWorkflowIds: string[]; permittedRoleIds: string[]; health: string; expiresAt: string | null; lastUsedAt: string | null; createdBy: string; approvalRequirements: Record<string, unknown> }
export interface PluginBillingPlan { pluginId: string; planId: string; stripePriceId: string; mode: "payment" | "subscription"; offlineGraceDays: number; seatAllowance: number | null; customerId: string | null }
export interface EntitlementRecord { entitlementId: string; ownerType: "personal" | "workspace" | "organisation" | "publisher"; ownerId: string; pluginId: string; planId: string; status: "trial" | "active" | "past_due" | "expired" | "refunded" | "revoked"; seatAllowance: number | null; startsAt: string; renewsAt: string | null; offlineGraceUntil: string }
export interface WebhookEndpointRecord { id: string; publicId: string; workspaceId: string; workflowId: string; signingSecretCiphertext: Buffer; allowedMethods: string[]; schema: Record<string, unknown> | null; maximumRequestBytes: number; rateLimitPerMinute: number; retentionSeconds: number; runnerPolicy: Record<string, unknown>; offlineExpirySeconds: number; redactedFields: string[]; disabled: boolean }
export interface WebhookDeliveryRecord { deliveryId: string; endpointId: string; workspaceId: string; workflowId: string; payloadCiphertext: Buffer; idempotencyKey: string; receivedAt: string; expiresAt: string; attemptCount: number }

export interface ControlPlaneRepository {
  permissions(accountId: string, workspaceId: string): Promise<ReadonlySet<Permission>>;
  createOrganisation(actor: AuthenticatedSession, input: OrganisationInput, correlationId: string): Promise<{ organisation: OrganisationRecord; workspace: WorkspaceRecord }>;
  createInvitation(actor: AuthenticatedSession, workspaceId: string, input: InvitationInput, correlationId: string): Promise<InvitationRecord>;
  acceptInvitation(actor: AuthenticatedSession, rawToken: string, correlationId: string): Promise<{ organisationId: string; workspaceIds: string[] }>;
  createSyncedWorkflow(actor: AuthenticatedSession, workspaceId: string, input: SyncedWorkflowInput, correlationId: string): Promise<{ workflowId: string; name: string; ownerType: "workspace"; ownerId: string }>;
  appendWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, revision: WorkflowRevision, correlationId: string): Promise<SyncWriteResult>;
  listWorkflowRevisions(actor: AuthenticatedSession, workspaceId: string, workflowId: string, cursor: string | null, limit: number): Promise<{ items: WorkflowRevision[]; nextCursor: string | null }>;
  getWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string): Promise<WorkflowRevision | null>;
  resolveSyncConflict(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string, correlationId: string): Promise<{ selectedRevisionId: string }>;
  createPublisher(actor: AuthenticatedSession, input: PublisherInput, correlationId: string): Promise<{ id: string; publicId: string; slug: string; verificationStatus: "unverified" }>;
  registerPublisherSigningKey(actor: AuthenticatedSession, publisherId: string, keyId: string, publicKeyDerBase64: string, correlationId: string): Promise<{ publisherId: string; keyId: string; algorithm: "ed25519" }>;
  createPluginSubmission(actor: AuthenticatedSession, input: PluginSubmissionInput, objectKey: string, correlationId: string): Promise<PluginSubmissionRecord>;
  getPluginSubmission(actor: AuthenticatedSession, publisherId: string, reviewId: string): Promise<PluginSubmissionRecord | null>;
  recordAutomatedPluginReview(actor: AuthenticatedSession, publisherId: string, reviewId: string, results: Record<string, unknown>, passed: boolean, rejectionReasons: string[], correlationId: string): Promise<PluginSubmissionRecord>;
  publishPluginVersion(actor: AuthenticatedSession, publisherId: string, reviewId: string, correlationId: string): Promise<{ pluginId: string; version: string; status: "published" }>;
  decidePluginReview(actor: AuthenticatedSession, reviewId: string, decision: "approved" | "changes_requested" | "rejected", reasons: string[], correlationId: string): Promise<void>;
  revokePluginVersion(actor: AuthenticatedSession, pluginVersionId: string, reason: string, securityNoticeUrl: string, correlationId: string): Promise<void>;
  searchMarketplace(actor: AuthenticatedSession | null, query: MarketplaceQuery): Promise<{ items: MarketplaceListing[]; nextCursor: string | null }>;
  getMarketplaceListing(actor: AuthenticatedSession | null, pluginId: string, workspaceId: string | null): Promise<MarketplaceListing | null>;
  getMarketplacePackage(actor: AuthenticatedSession | null, pluginId: string, workspaceId: string | null): Promise<MarketplacePackage | null>;
  listAuditEvents(actor: AuthenticatedSession, workspaceId: string, cursor: string | null, limit: number): Promise<{ items: AuditEvent[]; nextCursor: string | null }>;
  exportAccountData(actor: AuthenticatedSession): Promise<Record<string, unknown>>;
  requestAccountDeletion(actor: AuthenticatedSession, correlationId: string): Promise<void>;
  listSessions(actor: AuthenticatedSession): Promise<Array<{ id: string; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }>>;
  revokeSession(actor: AuthenticatedSession, sessionId: string, correlationId: string): Promise<boolean>;
  createRunnerPairingChallenge(actor: AuthenticatedSession, input: RunnerPairingChallengeInput, challenge: string, expiresAt: Date): Promise<RunnerPairingChallengeRecord>;
  confirmRunnerPairing(actor: AuthenticatedSession, input: RunnerPairingConfirmationInput, correlationId: string): Promise<RunnerRecord>;
  listRunners(actor: AuthenticatedSession, workspaceId: string): Promise<RunnerRecord[]>;
  createRunnerCommand(actor: AuthenticatedSession, input: RunnerCommandInput, correlationId: string): Promise<RunnerCommand>;
  revokeRunner(actor: AuthenticatedSession, workspaceId: string, runnerId: string, correlationId: string): Promise<boolean>;
  requestWorkflowApproval(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string, correlationId: string): Promise<WorkflowApprovalRecord>;
  decideWorkflowApproval(actor: AuthenticatedSession, workspaceId: string, approvalId: string, decision: "approved" | "rejected", reason: string | null, correlationId: string): Promise<WorkflowApprovalRecord>;
  publishWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string, changeSummary: string, correlationId: string): Promise<{ workflowId: string; publishedRevisionId: string; previousPublishedRevisionId: string | null }>;
  rollbackWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, workflowId: string, revisionId: string, reason: string, correlationId: string): Promise<{ workflowId: string; publishedRevisionId: string; previousPublishedRevisionId: string | null }>;
  getGovernancePolicies(actor: AuthenticatedSession, workspaceId: string): Promise<GovernancePolicies>;
  setGovernancePolicy(actor: AuthenticatedSession, workspaceId: string, policyKey: string, policyValue: unknown, correlationId: string): Promise<{ policyKey: string; policyValue: unknown }>;
  listWorkspaceMembers(actor: AuthenticatedSession, workspaceId: string): Promise<WorkspaceMemberRecord[]>;
  updateWorkspaceMemberRole(actor: AuthenticatedSession, workspaceId: string, accountId: string, role: BuiltInRole, correlationId: string): Promise<WorkspaceMemberRecord>;
  removeWorkspaceMember(actor: AuthenticatedSession, workspaceId: string, accountId: string, correlationId: string): Promise<boolean>;
  revokeInvitation(actor: AuthenticatedSession, workspaceId: string, invitationId: string, correlationId: string): Promise<boolean>;
  authenticateRunnerRequest(input: RunnerDeviceRequestInput): Promise<RunnerDeviceSession>;
  recordRunnerHeartbeat(device: RunnerDeviceSession, currentWorkload: number, status: "online" | "paused" | "draining" | "maintenance"): Promise<RunnerRecord>;
  dequeueRunnerCommands(device: RunnerDeviceSession, limit: number): Promise<RunnerCommand[]>;
  updateRunnerCommandStatus(device: RunnerDeviceSession, commandId: string, status: "accepted" | "rejected" | "completed", resultSummary: Record<string, unknown> | null): Promise<boolean>;
  recordRunSummary(device: RunnerDeviceSession, summary: RunSummary): Promise<void>;
  listWorkspaceActivity(actor: AuthenticatedSession, workspaceId: string, limit: number): Promise<{ runners: RunnerRecord[]; runs: RunSummary[]; pendingApprovalCount: number; webhookFailureCount: number }>;
  listWorkspaceEnvironments(actor: AuthenticatedSession, workspaceId: string): Promise<WorkspaceEnvironmentRecord[]>;
  listSharedConnections(actor: AuthenticatedSession, workspaceId: string, environmentId: string | null): Promise<SharedConnectionRecord[]>;
  createSharedConnection(actor: AuthenticatedSession, workspaceId: string, input: Omit<SharedConnectionRecord, "id" | "workspaceId" | "health" | "expiresAt" | "lastUsedAt" | "createdBy">, correlationId: string): Promise<SharedConnectionRecord>;
  deploySharedConnection(actor: AuthenticatedSession, workspaceId: string, connectionId: string, runnerId: string, status: "authorization_required" | "available" | "unavailable", localCredentialLabel: string | null, correlationId: string): Promise<{ connectionId: string; runnerId: string; status: string; localCredentialLabel: string | null }>;
  getPluginBillingPlan(actor: AuthenticatedSession, ownerType: "personal" | "workspace", ownerId: string, pluginId: string, planId: string): Promise<PluginBillingPlan | null>;
  recordMarketplaceCheckout(actor: AuthenticatedSession, checkoutId: string, ownerType: "personal" | "workspace", ownerId: string, pluginId: string, planId: string, expiresAt: string): Promise<void>;
  applyBillingEvent(event: BillingEvent): Promise<void>;
  getActiveEntitlement(actor: AuthenticatedSession, ownerType: "personal" | "workspace", ownerId: string, pluginId: string): Promise<EntitlementRecord | null>;
  createWebhookEndpoint(actor: AuthenticatedSession, workspaceId: string, input: Omit<WebhookEndpointRecord, "id" | "publicId" | "workspaceId" | "signingSecretCiphertext" | "disabled">, publicId: string, signingSecretHash: Buffer, signingSecretCiphertext: Buffer, correlationId: string): Promise<WebhookEndpointRecord>;
  listWebhookEndpoints(actor: AuthenticatedSession, workspaceId: string): Promise<Array<Omit<WebhookEndpointRecord, "signingSecretCiphertext">>>;
  getWebhookEndpointByPublicId(publicId: string): Promise<WebhookEndpointRecord | null>;
  rotateWebhookSecret(actor: AuthenticatedSession, workspaceId: string, endpointId: string, signingSecretHash: Buffer, signingSecretCiphertext: Buffer, correlationId: string): Promise<boolean>;
  enqueueWebhookDelivery(endpoint: WebhookEndpointRecord, deliveryId: string, nonce: string, idempotencyKey: string, payloadCiphertext: Buffer, payloadHash: string, receivedAt: Date): Promise<{ status: "queued"; expiresAt: string }>;
  dequeueWebhookDeliveries(device: RunnerDeviceSession, limit: number): Promise<WebhookDeliveryRecord[]>;
  acknowledgeWebhookDelivery(device: RunnerDeviceSession, deliveryId: string, outcome: "delivered" | "retry" | "failed"): Promise<boolean>;
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
  }
}
