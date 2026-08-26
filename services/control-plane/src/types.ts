import type { AuditEvent, BuiltInRole, Permission, WorkflowRevision } from "@sandbox/contracts";

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
  decidePluginReview(actor: AuthenticatedSession, reviewId: string, decision: "approved" | "changes_requested" | "rejected", reasons: string[], correlationId: string): Promise<void>;
  revokePluginVersion(actor: AuthenticatedSession, pluginVersionId: string, reason: string, securityNoticeUrl: string, correlationId: string): Promise<void>;
  listAuditEvents(actor: AuthenticatedSession, workspaceId: string, cursor: string | null, limit: number): Promise<{ items: AuditEvent[]; nextCursor: string | null }>;
  exportAccountData(actor: AuthenticatedSession): Promise<Record<string, unknown>>;
  requestAccountDeletion(actor: AuthenticatedSession, correlationId: string): Promise<void>;
  listSessions(actor: AuthenticatedSession): Promise<Array<{ id: string; deviceName: string; createdAt: string; lastSeenAt: string; expiresAt: string; current: boolean }>>;
  revokeSession(actor: AuthenticatedSession, sessionId: string, correlationId: string): Promise<boolean>;
}

export class DomainError extends Error {
  constructor(public readonly code: string, message: string, public readonly statusCode = 400) {
    super(message);
  }
}
