import type { AuditEvent, BuiltInRole, Permission, WorkflowRevision } from "@sandbox/contracts";

export interface AuthenticatedSession {
  accountId: string;
  sessionId: string;
  subject: string;
  email: string;
  issuedAt: Date;
  expiresAt: Date;
  authenticationMethods: string[];
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

export interface ControlPlaneRepository {
  permissions(accountId: string, workspaceId: string): Promise<ReadonlySet<Permission>>;
  createOrganisation(actor: AuthenticatedSession, input: OrganisationInput, correlationId: string): Promise<{ organisation: OrganisationRecord; workspace: WorkspaceRecord }>;
  createInvitation(actor: AuthenticatedSession, workspaceId: string, input: InvitationInput, correlationId: string): Promise<InvitationRecord>;
  acceptInvitation(actor: AuthenticatedSession, rawToken: string, correlationId: string): Promise<{ organisationId: string; workspaceIds: string[] }>;
  appendWorkflowRevision(actor: AuthenticatedSession, workspaceId: string, revision: WorkflowRevision, correlationId: string): Promise<SyncWriteResult>;
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
