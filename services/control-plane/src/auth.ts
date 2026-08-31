import { createRemoteJWKSet, jwtVerify } from "jose";
import type { AuthenticatedSession, SessionVerifier } from "./types.js";
import { DomainError } from "./types.js";
import type { Pool } from "pg";

const sandboxClaimNamespace = "https://sndbox.app/claims";
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
      const accountId = stringClaim(
        payload[`${sandboxClaimNamespace}/account_id`] ?? payload.sandbox_account_id,
        `${sandboxClaimNamespace}/account_id`
      );
      if (!uuidPattern.test(accountId)) throw new Error("Sandbox account ID is not a UUID");
      const subject = stringClaim(payload.sub, "sub");
      const issuedAt = numberClaim(payload.iat, "iat");
      const sessionId = optionalStringClaim(
        payload[`${sandboxClaimNamespace}/session_id`] ?? payload.sid ?? payload.jti
      ) ?? `${subject}:${issuedAt}`;
      const email = stringClaim(
        payload[`${sandboxClaimNamespace}/email`] ?? payload.email,
        `${sandboxClaimNamespace}/email`
      );
      const emailVerified = payload[`${sandboxClaimNamespace}/email_verified`] ?? payload.email_verified;
      if (emailVerified !== true) throw new DomainError("email_not_verified", "Verify the account email before using cloud features.", 403);
      if (!protectedHeader.kid) throw new Error("JWT has no signing key ID");
      const platformPermissions = payload[`${sandboxClaimNamespace}/platform_permissions`] ?? payload.sandbox_platform_permissions;
      return {
        accountId,
        sessionId,
        subject,
        email,
        issuedAt: new Date(issuedAt * 1_000),
        expiresAt: new Date(numberClaim(payload.exp, "exp") * 1_000),
        authenticationMethods: Array.isArray(payload.amr) ? payload.amr.filter((item): item is string => typeof item === "string") : [],
        platformPermissions: Array.isArray(platformPermissions) ? platformPermissions.filter((item): item is string => typeof item === "string") : []
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

export class ProvisioningAccountSessionVerifier implements SessionVerifier {
  constructor(private readonly verifier:SessionVerifier,private readonly database:Pick<Pool,"query">){}
  async verify(token:string):Promise<AuthenticatedSession>{
    const session=await this.verifier.verify(token);
    try {
      const provisioned=await this.database.query(
        `INSERT INTO accounts(id,identity_subject,primary_email,email_verified,display_name)
         VALUES($1,$2,lower($3),true,$4)
         ON CONFLICT(id) DO UPDATE SET
           primary_email=excluded.primary_email,
           email_verified=true,
           display_name=excluded.display_name
         WHERE accounts.identity_subject=excluded.identity_subject AND accounts.deleted_at IS NULL
         RETURNING id`,
        [session.accountId,session.subject,session.email,session.email.split("@")[0]]
      );
      if(!provisioned.rowCount)throw new DomainError("invalid_session","The account is unavailable or deleted.",401);
      return session;
    } catch(error) {
      if(error instanceof DomainError)throw error;
      if((error as {code?:string}).code==="23505")throw new DomainError("account_identity_conflict","The identity is already associated with another Sandbox account.",409);
      throw error;
    }
  }
}

function stringClaim(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`JWT claim '${name}' is missing`);
  return value;
}

function optionalStringClaim(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function numberClaim(value: unknown, name: string): number {
  if (typeof value !== "number") throw new Error(`JWT claim '${name}' is missing`);
  return value;
}
