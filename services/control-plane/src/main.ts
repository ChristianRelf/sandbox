import { Pool } from "pg";
import { OidcSessionVerifier } from "./auth.js";
import { HttpTransactionalEmail } from "./email.js";
import { HttpImmutablePackageStorage, HttpPackageReviewScanner } from "./package_services.js";
import { PostgresRepository } from "./postgres.js";
import { createServer } from "./server.js";
import { Ed25519RunnerCommandSigner } from "./runner_protocol.js";

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

const server = await createServer({
  repository: new PostgresRepository(pool),
  sessions: new OidcSessionVerifier({ issuer: required("OIDC_ISSUER"), audience: required("OIDC_AUDIENCE"), jwksUrl: required("OIDC_JWKS_URL") }),
  email: new HttpTransactionalEmail(required("EMAIL_API_URL"), required("EMAIL_API_KEY"), required("EMAIL_SENDER")),
  packageStorage: new HttpImmutablePackageStorage(required("OBJECT_STORAGE_SIGNER_URL"), required("OBJECT_STORAGE_SIGNER_TOKEN")),
  packageScanner: new HttpPackageReviewScanner(required("PACKAGE_SCANNER_URL"), required("PACKAGE_SCANNER_TOKEN")),
  runnerCommandSigner: new Ed25519RunnerCommandSigner(required("RUNNER_COMMAND_SIGNING_KEY_ID"), required("RUNNER_COMMAND_SIGNING_PRIVATE_KEY_PEM").replace(/\\n/g, "\n")),
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
