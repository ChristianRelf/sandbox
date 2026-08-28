import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthenticatedSession, SessionVerifier } from "./types.js";
import { DomainError } from "./types.js";
import type { Pool } from "pg";

export interface OidcConfiguration {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

export class OidcSessionVerifier implements SessionVerifier {
  readonly #issuer: string;
  readonly #audience: string;
  readonly #keys: ReturnType<typeof createRemoteJWKSet>;

  constructor(configuration: OidcConfiguration) {
    this.#issuer = configuration.issuer;
    this.#audience = configuration.audience;
    this.#keys = createRemoteJWKSet(new URL(configuration.jwksUrl), { cooldownDuration: 30_000, timeoutDuration: 5_000 });
  }

  async verify(token: string): Promise<AuthenticatedSession> {
    try {
      const { payload, protectedHeader } = await jwtVerify(token, this.#keys, {
        issuer: this.#issuer,
        audience: this.#audience,
        algorithms: ["ES256", "EdDSA", "RS256"],
        clockTolerance: 5
      });
      const accountId = stringClaim(payload.sandbox_account_id, "sandbox_account_id");
      const sessionId = stringClaim(payload.sid, "sid");
      const email = stringClaim(payload.email, "email");
      if (!payload.email_verified) throw new DomainError("email_not_verified", "Verify the account email before using cloud features.", 403);
      if (!protectedHeader.kid) throw new Error("JWT has no signing key ID");
      return {
        accountId,
        sessionId,
        subject: stringClaim(payload.sub, "sub"),
        email,
        issuedAt: new Date(numberClaim(payload.iat, "iat") * 1_000),
        expiresAt: new Date(numberClaim(payload.exp, "exp") * 1_000),
        authenticationMethods: Array.isArray(payload.amr) ? payload.amr.filter((item): item is string => typeof item === "string") : [],
        platformPermissions: Array.isArray(payload.sandbox_platform_permissions) ? payload.sandbox_platform_permissions.filter((item): item is string => typeof item === "string") : []
      };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError("invalid_session", `The session is invalid or expired: ${error instanceof Error ? error.message : "verification failed"}`, 401);
    }
  }
}

export class ActiveAccountSessionVerifier implements SessionVerifier {
  constructor(private readonly verifier:SessionVerifier,private readonly database:Pick<Pool,"query">){}
  async verify(token:string):Promise<AuthenticatedSession>{const session=await this.verifier.verify(token);const active=await this.database.query(`SELECT 1 FROM accounts WHERE id=$1 AND deleted_at IS NULL`,[session.accountId]);if(!active.rowCount)throw new DomainError("invalid_session","The account is unavailable or deleted.",401);return session;}
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`JWT claim '${name}' is missing`);
  return value;
}

function numberClaim(value: unknown, name: string): number {
  if (typeof value !== "number") throw new Error(`JWT claim '${name}' is missing`);
  return value;
}
