# Sandbox v0.7.1 beta control-plane deployment

This deploys the beta API at `https://api.sndbox.app` with:

- Auth0 for tester login (`sndbox.uk.auth0.com`)
- Neon Launch Postgres for beta data
- Stripe sandbox mode for checkout and billing webhooks
- One DigitalOcean App Platform service for the API

The fixed infrastructure cost is **$5 per month** for the smallest App Platform service, plus Neon's metered database usage. Neon describes an intermittent 1 GB Launch database as typically around $15 per month, but scale-to-zero can make a lightly used invite-only beta cheaper. Auth0 and Stripe can remain free for a small test, although Stripe charges its normal fees if live payments are enabled later.

Do not put any database password, Stripe key, webhook secret, or generated Sandbox key into Git, chat, the desktop application, or a public environment variable.

## What is already configured in the code

The repository contains:

- a production control-plane container at `services/control-plane/Dockerfile`;
- an App Platform reference spec at `deploy/control-plane/app.yaml.example`;
- the Auth0 Post Login Action at `deploy/control-plane/auth0-post-login-action.js`;
- a local secret generator at `scripts/generate-control-plane-beta-env.mjs`;
- first-login provisioning for verified Auth0 users;
- beta-mode fallbacks for transactional email and package scanning/storage.

The Auth0 public configuration is already fixed to:

| Setting | Value |
| --- | --- |
| Tenant domain | `sndbox.uk.auth0.com` |
| Native application client ID | `HYK3Kgx3UDhTLSzkXFreA76Ax2FxoorK` |
| API identifier/audience | `https://api.sndbox.app` |
| Desktop callback | `http://127.0.0.1:53682/account/callback` |

The native client ID is public configuration, not a secret. Do not add a client secret to the desktop application.

## 1. Create the Neon database

1. Sign in to [Neon](https://console.neon.tech/) and create a project named `sandbox-beta`.
2. Choose **AWS Europe (London) — `eu-west-2`**.
3. Select the paid **Launch** plan.
4. For this invite-only beta, keep scale-to-zero enabled and set a conservative autoscaling range such as `0.25–1 CU`. This controls cost while still allowing short migration or query bursts.
5. Set the restore window to seven days.
6. On the project dashboard, select **Connect**.
7. Select the `main` branch, the `neondb` database, and its generated owner role.
8. Turn **Connection pooling off** and copy the direct connection string. It has this shape:

   ```text
   postgresql://OWNER:PASSWORD@ep-NAME.eu-west-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require
   ```

Use the direct connection rather than the hostname containing `-pooler`. The control plane is a persistent Node process, already maintains a small five-connection application pool, and runs PostgreSQL migrations at startup. Neon's pooled endpoint uses transaction-mode PgBouncer, which Neon does not recommend for migrations.

## 2. Get the Stripe sandbox secret key

1. Sign in to [Stripe](https://dashboard.stripe.com/) and create or select a **sandbox**. Do not switch to live mode.
2. Open **Developers/Workbench → API keys**.
3. Reveal the sandbox secret key beginning with `sk_test_`.
4. Store it in your password manager. Do not use the `pk_test_` publishable key as `STRIPE_SECRET_KEY`.

The webhook secret is created later, after the public API is reachable.

## 3. Install the Auth0 token Action

The API needs namespaced claims in its Auth0 access token. Replace any earlier `Add Sandbox API claims` draft with the exact contents of `deploy/control-plane/auth0-post-login-action.js`.

1. In the Auth0 dashboard, open **Actions → Library**.
2. Select **Build Custom** or **Build from scratch**.
3. Name it `Add Sandbox API claims`, choose **Login / Post Login**, and use the recommended Node runtime.
4. Paste the complete contents of `deploy/control-plane/auth0-post-login-action.js` into the editor.
5. Select **Deploy**.
6. On the deployment confirmation, select **Add to Flow**. If that button is gone, use **Back to Flow**.
7. If your dashboard navigation does not show **Flows**, open **Actions → Triggers → Post Login**. Older tenants show the same screen at **Actions → Flows → Login**.
8. Drag `Add Sandbox API claims` into the Post Login pipeline and select **Apply**.

No Action secret or dependency is required. The Action creates a stable UUID in each Auth0 user's `app_metadata`, then puts the UUID, verified email, session ID, and permissions into namespaced access-token claims.

## 4. Finish the local deployment environment

Complete this section on your Windows workstation in the repository checkout. Do not add these values to `/opt/sandbox/.env` on the existing website/docs Droplet: that Compose stack does not run the control plane and does not read its database or Stripe settings. If a control-plane secret was added there, copy it to the protected file below and then remove the unused line from the Droplet.

From the repository root, run the generator once:

```powershell
node .\scripts\generate-control-plane-beta-env.mjs
```

It creates the git-ignored file `deploy/control-plane/.env` with unique encryption, signing, usage, and metrics secrets. Keep this file as the beta recovery copy; replacing those generated values later can invalidate protected data or signatures.

Open it locally:

```powershell
notepad .\deploy\control-plane\.env
```

Replace:

```dotenv
DATABASE_URL=REPLACE_WITH_NEON_DIRECT_DATABASE_URL
STRIPE_SECRET_KEY=REPLACE_WITH_STRIPE_TEST_SECRET_KEY
```

Leave this temporary value in place for the first deployment:

```dotenv
STRIPE_WEBHOOK_SECRET=REPLACE_AFTER_FIRST_DEPLOYMENT
```

Save the file. Never run `git add -f` on it.

## 5. Create the DigitalOcean App Platform service

This action begins the approximately $5/month charge.

1. In DigitalOcean, select **Create → App Platform → Create App**.
2. Choose **GitHub**, authorize the repository if needed, and select `ChristianRelf/sandbox`.
3. Select branch `main` and disable automatic deploys for the first beta deployment.
4. Configure a **Web Service** with:

   | Setting | Value |
   | --- | --- |
   | Name | `api` |
   | Region | London (`lon`) |
   | Source directory/build context | repository root (`/`) |
   | Dockerfile | `services/control-plane/Dockerfile` |
   | HTTP port | `8080` |
   | Health check path | `/health` |
   | Instances | `1` |
   | Size | Shared CPU, 512 MiB (`apps-s-1vcpu-0.5gb`) |

5. In **Environment Variables**, copy every key and value from the local `deploy/control-plane/.env`.
6. Mark only these values as plain/general runtime variables:

   ```text
   NODE_ENV
   SANDBOX_BETA_MODE
   HOST
   PORT
   DATABASE_POOL_SIZE
   CONTROL_PLANE_PUBLIC_URL
   WEB_BASE_URL
   OIDC_ISSUER
   OIDC_AUDIENCE
   OIDC_JWKS_URL
   RUNNER_COMMAND_SIGNING_KEY_ID
   ENTITLEMENT_SIGNING_KEY_ID
   ```

7. Mark every other value, including `DATABASE_URL` and all Stripe, encryption, signing, metrics, and usage values, as **Encrypted/Secret** and runtime-only.
8. Review the monthly total, then create the app and wait for the deployment to become healthy.

The checked-in `deploy/control-plane/app.yaml.example` records the equivalent App Platform settings. The service runs database migrations automatically before starting the API.

If 512 MiB proves too small during migrations, move to the fixed 1 GiB plan. Do not add replicas while using startup migrations in this beta.

## 6. Attach `api.sndbox.app`

1. In the DigitalOcean app, open **Settings → Domains → Add Domain**.
2. Enter `api.sndbox.app` and choose the option to manage DNS yourself.
3. Copy the CNAME target supplied by DigitalOcean.
4. In Cloudflare DNS, remove any existing `api` A, AAAA, or CNAME record that points elsewhere.
5. Add the CNAME:

   | Type | Name | Target | Proxy status |
   | --- | --- | --- | --- |
   | `CNAME` | `api` | target supplied by DigitalOcean | **DNS only** initially |

6. Wait until DigitalOcean reports the domain and TLS certificate as active.

Keep the Cloudflare proxy grey-clouded until HTTPS works directly. This avoids hiding a certificate-origin problem behind another Cloudflare `525` handshake error. You can test Cloudflare proxying later with SSL/TLS mode **Full (strict)**.

Verify from PowerShell:

```powershell
Invoke-RestMethod https://api.sndbox.app/health
Invoke-RestMethod https://api.sndbox.app/ready
```

`/health` should identify `sandbox-control-plane` with status `ok`; `/ready` should return status `ready` after the startup sweeps and database check complete.

## 7. Create the Stripe webhook

Stay inside the same Stripe sandbox that supplied the `sk_test_` key.

1. Open **Workbench → Webhooks**.
2. Select **Create new destination** and choose events from **Your account**.
3. Subscribe to exactly these event types:

   ```text
   checkout.session.completed
   customer.subscription.updated
   customer.subscription.deleted
   charge.refunded
   charge.refund.updated
   ```

4. Choose **Webhook** and enter:

   ```text
   https://api.sndbox.app/v1/billing/stripe/webhook
   ```

5. Create the destination, reveal its signing secret beginning with `whsec_`, and copy it.
6. In DigitalOcean App Platform, replace `STRIPE_WEBHOOK_SECRET` with that `whsec_` value as an encrypted runtime variable.
7. Redeploy the app.
8. From the Stripe destination page, send a test event and confirm the delivery receives an HTTP `200` response.

The webhook signing secret and `sk_test_` secret key are different values. Do not interchange them.

## 8. End-to-end beta check

1. Confirm `/health` and `/ready` both succeed.
2. Start the v0.7.1 beta desktop build and select **Sign in**.
3. Register or sign in through Auth0, then verify the email address.
4. Return to the desktop application. Its first authenticated API call should create the matching beta account automatically.
5. In Auth0, open **Monitoring → Logs** and confirm the login's Action execution succeeded.
6. In DigitalOcean, inspect the API runtime logs. There should be no migration, OIDC, or database errors.
7. In Neon, open the SQL Editor and run `SELECT id, primary_email, created_at FROM accounts;`. Confirm a row exists only after the first successful authenticated API call.
8. Exercise checkout only with Stripe test cards. Never enter real card details in sandbox mode.

Stripe is connected at this point, but the repository intentionally publishes no prices by default. Before testers can buy a plan, you must make a commercial choice about price and currency, create the matching recurring Price in the Stripe sandbox, deploy the account portal at `app.sndbox.app`, and synchronize the reviewed plan document as described in `docs/product-commerce-v0.6.md`. Those choices are not generated automatically because changing them has product and billing consequences.

## Troubleshooting

### API build fails with missing environment variables

Compare DigitalOcean's runtime variable names against every line in `deploy/control-plane/.env`. Multiline PEM keys must retain their literal `\n` sequences; do not convert them into actual line breaks in the dashboard.

### Database connection fails

Use Neon **Connect** with connection pooling disabled. The hostname must not contain `-pooler`, and the copied URI should retain `sslmode=require&channel_binding=require`. Confirm that the Neon project is in AWS London and has not reached a usage or spending limit.

### Auth0 login succeeds but the API returns `invalid_session`

- Confirm the desktop requests audience `https://api.sndbox.app`.
- Confirm the Action is **Deployed**, attached to **Post Login**, and the flow change was **Applied**.
- Confirm the user's email is verified.
- Sign out and sign in again so Auth0 issues a fresh access token containing the new claims.
- Check **Auth0 → Monitoring → Logs** for the Action execution.

### Stripe test delivery returns `400`

Confirm DigitalOcean contains the `whsec_` value for this exact sandbox endpoint, redeploy, and retry the delivery. A Stripe CLI signing secret or a secret from another endpoint will not validate.

### `api.sndbox.app` reports a TLS handshake error

Set the Cloudflare record to **DNS only**, confirm DigitalOcean's custom-domain certificate is active, and retest. Remove stale `A`/`AAAA` records. Enable the proxy only after origin HTTPS works, using **Full (strict)** rather than Flexible mode.
