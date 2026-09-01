import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { generateKeyPairSync, randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const output = resolve(root, "deploy/control-plane/.env");

if (existsSync(output)) {
  throw new Error(`${output} already exists. Move it aside explicitly before generating replacement secrets.`);
}

const base64 = () => randomBytes(32).toString("base64");
const base64url = () => randomBytes(32).toString("base64url");
const privateKey = () => generateKeyPairSync("ed25519").privateKey
  .export({ format: "pem", type: "pkcs8" })
  .toString()
  .trim()
  .replace(/\n/g, "\\n");
const usageSecret = base64();

const values = {
  NODE_ENV: "production",
  SANDBOX_BETA_MODE: "true",
  HOST: "0.0.0.0",
  PORT: "8080",
  DATABASE_URL: "REPLACE_WITH_NEON_DIRECT_DATABASE_URL",
  DATABASE_POOL_SIZE: "5",
  CONTROL_PLANE_PUBLIC_URL: "https://api.sndbox.app",
  WEB_BASE_URL: "https://app.sndbox.app",
  OIDC_ISSUER: "https://sndbox.uk.auth0.com/",
  OIDC_AUDIENCE: "https://api.sndbox.app",
  OIDC_JWKS_URL: "https://sndbox.uk.auth0.com/.well-known/jwks.json",
  ACCESS_TOKEN_PEPPER_BASE64: base64(),
  WEBHOOK_ENCRYPTION_KEY_BASE64: base64(),
  API_IDEMPOTENCY_ENCRYPTION_KEY_BASE64: base64(),
  PROTECTED_VALUE_ENCRYPTION_KEY_BASE64: base64(),
  METRICS_BEARER_TOKEN: base64url(),
  RUNNER_COMMAND_SIGNING_KEY_ID: "beta-runner-1",
  RUNNER_COMMAND_SIGNING_PRIVATE_KEY_PEM: privateKey(),
  ENTITLEMENT_SIGNING_KEY_ID: "beta-entitlement-1",
  ENTITLEMENT_SIGNING_PRIVATE_KEY_PEM: privateKey(),
  USAGE_PRODUCER_SECRETS_JSON: JSON.stringify({ "beta-hosted-runner": usageSecret }),
  STRIPE_SECRET_KEY: "REPLACE_WITH_STRIPE_TEST_SECRET_KEY",
  STRIPE_WEBHOOK_SECRET: "REPLACE_AFTER_FIRST_DEPLOYMENT",
  BUG_REPORT_DISCORD_WEBHOOK_URL: "REPLACE_WITH_DISCORD_BUG_REPORT_WEBHOOK_URL"
};

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${Object.entries(values).map(([key, value]) => `${key}=${value}`).join("\n")}\n`, {
  encoding: "utf8",
  flag: "wx",
  mode: 0o600
});

process.stdout.write(`Created ${output}. It is git-ignored. Add the database and Stripe test key now; replace the webhook placeholder after the first deployment.\n`);
