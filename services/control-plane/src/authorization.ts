import type { Permission } from "@sandbox/contracts";
import type { AuthenticatedSession, ControlPlaneRepository } from "./types.js";
import { DomainError } from "./types.js";

export interface PolicyFailure {
  policy: string;
  resource: string;
  administratorAction: string;
  userAction: string;
}

export interface AuthorizationRequest {
  workspaceId: string;
  permission: Permission;
  resourceType: string;
  resourceId?: string;
  organisationId?: string;
  environmentId?: string;
}

export class Authorizer {
  constructor(private readonly repository: ControlPlaneRepository) {}

  async require(session:AuthenticatedSession,request:AuthorizationRequest):Promise<void>;
  async require(session:AuthenticatedSession,workspaceId:string,permission:Permission):Promise<void>;
  async require(session: AuthenticatedSession, requestOrWorkspace: AuthorizationRequest|string, legacyPermission?:Permission): Promise<void> {
    const request:AuthorizationRequest=typeof requestOrWorkspace === "string"
      ? {workspaceId:requestOrWorkspace,permission:legacyPermission!,resourceType:"workspace_resource"}
      : requestOrWorkspace;
    const principalType=session.principalType ?? "user";
    if (session.organisationRestriction && request.organisationId && session.organisationRestriction !== request.organisationId) {
      throw denied("credential_organisation_restricted",session,request,"The credential is restricted to another organisation.");
    }
    if (session.workspaceRestrictions?.length && !session.workspaceRestrictions.includes(request.workspaceId)) {
      throw denied("credential_workspace_restricted",session,request,"The credential is not permitted in this workspace.");
    }
    if (request.environmentId && session.environmentRestrictions?.length && !session.environmentRestrictions.includes(request.environmentId)) {
      throw denied("credential_environment_restricted",session,request,"The credential is not permitted in this environment.");
    }
    if (principalType !== "user" && !session.credentialScopes?.includes(request.permission)) {
      throw denied("credential_scope_denied",session,request,`Credential scope '${request.permission}' is required.`);
    }
    if (session.principalPermissions && !session.principalPermissions.includes(request.permission)) {
      throw denied("principal_permission_denied",session,request,`The principal's assigned role does not grant '${request.permission}'.`);
    }
    const permissions = await this.repository.permissions(session.accountId, request.workspaceId);
    if (!permissions.has(request.permission)) {
      throw new DomainError(
        "permission_denied",
        `Permission '${request.permission}' is required for ${resourceLabel(request)} in workspace '${request.workspaceId}'. Ask a workspace administrator to grant a role containing this permission.`,
        403
      );
    }
  }

  enforcePolicy(allowed: boolean, failure: PolicyFailure): void {
    if (!allowed) {
      throw new DomainError(
        "governance_policy_blocked",
        `Policy '${failure.policy}' blocked ${failure.resource}. ${failure.administratorAction} ${failure.userAction}`,
        403
      );
    }
  }
}

function denied(code:string,session:AuthenticatedSession,request:AuthorizationRequest,detail:string):DomainError {
  return new DomainError(code,`${detail} Principal '${session.principalId ?? session.accountId}' cannot access ${resourceLabel(request)}.`,403);
}

function resourceLabel(request:AuthorizationRequest):string {
  return request.resourceId ? `${request.resourceType} '${request.resourceId}'` : request.resourceType;
}
