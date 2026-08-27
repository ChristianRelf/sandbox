import { Pool } from "pg";
import { OidcSessionVerifier } from "./auth.js";
import { HttpTransactionalEmail } from "./email.js";
import { HttpImmutablePackageStorage, HttpPackageReviewScanner } from "./package_services.js";
import { PostgresRepository } from "./postgres.js";
import { createServer } from "./server.js";
import { Ed25519RunnerCommandSigner } from "./runner_protocol.js";
import { StripeBillingProvider } from "./billing.js";
import { Ed25519EntitlementClaimSigner } from "./entitlement.js";
import { WebhookProtector } from "./webhook_crypto.js";
import { CompositeSessionVerifier, PostgresCredentialService } from "./credentials.js";
import { PostgresApiIdempotencyStore } from "./api_contract.js";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const pool = new Pool({
  connectionString: required("DATABASE_URL"),
  ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.DATABASE_POOL_SIZE ?? 10),
  statement_timeout: 15_000,
  idle_in_transaction_session_timeout: 15_000
});

const oidcSessions=new OidcSessionVerifier({ issuer: required("OIDC_ISSUER"), audience: required("OIDC_AUDIENCE"), jwksUrl: required("OIDC_JWKS_URL") });
const credentialService=new PostgresCredentialService(pool,Buffer.from(required("ACCESS_TOKEN_PEPPER_BASE64"),"base64"));
const webhookProtector=new WebhookProtector(Buffer.from(required("WEBHOOK_ENCRYPTION_KEY_BASE64"),"base64"));
const idempotencyProtector=new WebhookProtector(Buffer.from(required("API_IDEMPOTENCY_ENCRYPTION_KEY_BASE64"),"base64"));

const server = await createServer({
  repository: new PostgresRepository(pool),
  sessions: new CompositeSessionVerifier(oidcSessions,credentialService),
  credentialService,
  email: new HttpTransactionalEmail(required("EMAIL_API_URL"), required("EMAIL_API_KEY"), required("EMAIL_SENDER")),
  packageStorage: new HttpImmutablePackageStorage(required("OBJECT_STORAGE_SIGNER_URL"), required("OBJECT_STORAGE_SIGNER_TOKEN")),
  packageScanner: new HttpPackageReviewScanner(required("PACKAGE_SCANNER_URL"), required("PACKAGE_SCANNER_TOKEN")),
  runnerCommandSigner: new Ed25519RunnerCommandSigner(required("RUNNER_COMMAND_SIGNING_KEY_ID"), required("RUNNER_COMMAND_SIGNING_PRIVATE_KEY_PEM").replace(/\\n/g, "\n")),
  billing: new StripeBillingProvider(required("STRIPE_SECRET_KEY"), required("STRIPE_WEBHOOK_SECRET")),
  entitlementSigner: new Ed25519EntitlementClaimSigner(required("ENTITLEMENT_SIGNING_KEY_ID"), required("CONTROL_PLANE_PUBLIC_URL"), required("ENTITLEMENT_SIGNING_PRIVATE_KEY_PEM").replace(/\\n/g, "\n")),
  webhookProtector,
  idempotencyStore: new PostgresApiIdempotencyStore(pool,idempotencyProtector),
  protectedValueProtector: new WebhookProtector(Buffer.from(required("PROTECTED_VALUE_ENCRYPTION_KEY_BASE64"), "base64")),
  webhookBaseUrl: required("CONTROL_PLANE_PUBLIC_URL"),
  webBaseUrl: required("WEB_BASE_URL"),
  logger: true
});

const shutdown = async () => {
  await server.close();
  await pool.end();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

await server.listen({ host: process.env.HOST ?? "127.0.0.1", port: Number(process.env.PORT ?? 4100) });
