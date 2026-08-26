import type { Permission } from "@sandbox/contracts";
import type { AuthenticatedSession, ControlPlaneRepository } from "./types.js";
import { DomainError } from "./types.js";

export interface PolicyFailure {
  policy: string;
  resource: string;
  administratorAction: string;
  userAction: string;
}

export class Authorizer {
  constructor(private readonly repository: ControlPlaneRepository) {}

  async require(session: AuthenticatedSession, workspaceId: string, permission: Permission): Promise<void> {
    const permissions = await this.repository.permissions(session.accountId, workspaceId);
    if (!permissions.has(permission)) {
      throw new DomainError(
        "permission_denied",
        `Permission '${permission}' is required for workspace '${workspaceId}'. Ask a workspace administrator to grant a role containing this permission.`,
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
