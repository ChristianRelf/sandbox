import {
  ArrowRight,
  Check,
  CircleAlert,
  CreditCard,
  Download,
  KeyRound,
  MonitorSmartphone,
  Plus,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { authenticatedClient } from "../lib/auth";

export const dynamic = "force-dynamic";

export default async function Home() {
  const api = await authenticatedClient();
  if (!api) {
    return (
      <main className="portal-page">
        <section className="blocked-notice">
          <CircleAlert />
          <div><strong>Account unavailable</strong><p>Your account session could not be loaded. Sign in again to continue.</p></div>
        </section>
      </main>
    );
  }

  const [profileResult, organisationsResult, commerceResult, sessionsResult, tokensResult] = await Promise.allSettled([
    api.getAccountProfile(),
    api.listAccountOrganisations(),
    api.getProductAccount(),
    api.listAccountSessions(),
    api.listPersonalAccessTokens(),
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.data : null;
  const organisations = organisationsResult.status === "fulfilled" ? organisationsResult.value.data.items : [];
  const commerce = commerceResult.status === "fulfilled" ? commerceResult.value.data : null;
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.data.items : [];
  const tokens = tokensResult.status === "fulfilled" ? tokensResult.value.data.items : [];
  const subscription = commerce?.subscriptions[0];
  const licence = commerce?.licences[0];
  const workspaceCount = organisations.flatMap((organisation) => organisation.workspaces).length;
  const activeTokens = tokens.filter((token) => !token.revokedAt).length;

  return (
    <main className="portal-page account-home">
      <header className="account-home-hero">
        <div>
          <p>ACCOUNT</p>
          <h1>Overview</h1>
          <span>{profile ? `${profile.displayName} · ${profile.email}` : "Your sndbox account"}</span>
        </div>
        <div className="account-home-actions">
          <Link href="/downloads" className="portal-secondary"><Download aria-hidden="true" /> Download app</Link>
          <Link href="/organisations" className="portal-primary"><Plus aria-hidden="true" /> New workspace</Link>
        </div>
      </header>

      <section className="account-summary-grid" aria-label="Account summary">
        <Link href="/billing">
          <span><CreditCard aria-hidden="true" /> Plan</span>
          <strong>{subscription?.planName ?? "Local"}</strong>
          <small>{subscription?.status ?? "No subscription required"}</small>
        </Link>
        <Link href="/organisations">
          <span><Users aria-hidden="true" /> Workspaces</span>
          <strong>{workspaceCount}</strong>
          <small>Across {organisations.length} organisation{organisations.length === 1 ? "" : "s"}</small>
        </Link>
        <Link href="/security">
          <span><MonitorSmartphone aria-hidden="true" /> Sessions</span>
          <strong>{sessions.length}</strong>
          <small>{sessions.length === 1 ? "Signed-in device" : "Signed-in devices"}</small>
        </Link>
        <Link href="/security">
          <span><KeyRound aria-hidden="true" /> API keys</span>
          <strong>{activeTokens}</strong>
          <small>Active personal token{activeTokens === 1 ? "" : "s"}</small>
        </Link>
      </section>

      <section className="home-main-grid">
        <div className="home-focus">
          <header>
            <div><small>SHORTCUTS</small><h2>Common tasks</h2></div>
          </header>
          <div className="home-action-list">
            <Link href="/operations">
              <span className="action-icon"><Server aria-hidden="true" /></span>
              <span><strong>Runner operations</strong><small>Pair Linux hosts and manage runner availability.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/security">
              <span className="action-icon"><KeyRound aria-hidden="true" /></span>
              <span><strong>API keys</strong><small>Create and revoke workspace-scoped credentials.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
            <Link href="/billing">
              <span className="action-icon"><CreditCard aria-hidden="true" /></span>
              <span><strong>Plan & billing</strong><small>Review your plan, renewal and available options.</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>
          </div>
        </div>

        <aside className="account-health">
          <header><small>ACCOUNT STATUS</small><span className="health-badge"><Check /> Healthy</span></header>
          <div>
            <span><ShieldCheck aria-hidden="true" /><span><strong>Identity provider</strong><small>{profile?.email ?? "Authenticated account"}</small></span></span>
            <span><Check aria-hidden="true" /><span><strong>Local execution</strong><small>Unmetered</small></span></span>
            <span><Check aria-hidden="true" /><span><strong>Licence</strong><small>{licence ? `${licence.devices} registered device${licence.devices === 1 ? "" : "s"}` : "Local access"}</small></span></span>
          </div>
          <Link href="/settings">View account settings <ArrowRight /></Link>
        </aside>
      </section>
    </main>
  );
}
