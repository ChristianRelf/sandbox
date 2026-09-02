import {
  ArrowRight,
  CircleAlert,
  Cloud,
  CreditCard,
  Download,
  KeyRound,
  Plus,
  Server,
  ShieldCheck,
  Users,
} from "lucide-react";
import Link from "next/link";
import { authenticatedClient } from "../lib/auth";
import "./overview.css";

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

  const [profileResult, organisationsResult, commerceResult, sessionsResult, tokensResult, walletResult] = await Promise.allSettled([
    api.getAccountProfile(),
    api.listAccountOrganisations(),
    api.getProductAccount(),
    api.listAccountSessions(),
    api.listPersonalAccessTokens(),
    api.getAccountWallet(),
  ]);
  const profile = profileResult.status === "fulfilled" ? profileResult.value.data : null;
  const organisations = organisationsResult.status === "fulfilled" ? organisationsResult.value.data.items : [];
  const commerce = commerceResult.status === "fulfilled" ? commerceResult.value.data : null;
  const sessions = sessionsResult.status === "fulfilled" ? sessionsResult.value.data.items : [];
  const tokens = tokensResult.status === "fulfilled" ? tokensResult.value.data.items : [];
  const wallet = walletResult.status === "fulfilled" ? walletResult.value.data : null;
  const subscription = commerce?.subscriptions[0];
  const licence = commerce?.licences[0];
  const workspaces = organisations.flatMap((organisation) => organisation.workspaces.map((workspace) => ({ organisation, workspace })));
  const workspaceCount = workspaces.length;
  const activeTokens = tokens.filter((token) => !token.revokedAt).length;

  return (
    <main className="portal-page account-home">
      <header className="account-home-hero">
        <div>
          <h1>Overview</h1>
          <span>{profile ? `${profile.displayName} · ${profile.email}` : "Your sndbox account"}</span>
        </div>
        <div className="account-home-actions">
          <Link href="/downloads" className="portal-secondary"><Download aria-hidden="true" /> Download app</Link>
          <Link href="/organisations" className="portal-primary"><Plus aria-hidden="true" /> New workspace</Link>
        </div>
      </header>

      <section className="overview-lead-grid">
        <article className="overview-cloud-card">
          <header>
            <div><span className="overview-card-icon"><Cloud aria-hidden="true" /></span><span><small>CLOUD BALANCE</small><strong>Hosted execution</strong></span></div>
            <Link href="/billing">Billing <ArrowRight aria-hidden="true" /></Link>
          </header>
          <strong className="overview-balance">{formatMicros(wallet?.balanceMicros ?? 0)}</strong>
          <p>{wallet && wallet.balanceMicros > 0 ? `${formatRunway(wallet.balanceMicros, wallet.rates.hostedRunnerMicrosPerMinute)} of hosted runner time at the current rate.` : "Add credit before starting a managed cloud run."}</p>
          <footer>
            <Link href="/billing" className="portal-primary">Add credit</Link>
            <Link href="/usage" className="portal-secondary">View usage</Link>
            <span>Local and self-hosted execution stays free.</span>
          </footer>
        </article>

        <aside className="overview-account-card">
          <div className="overview-plan">
            <small>CURRENT PLAN</small>
            <strong>{subscription?.planName ?? "Local"}</strong>
          </div>
          <dl>
            <div><dt>WORKSPACES</dt><dd>{workspaceCount}</dd></div>
            <div><dt>SESSIONS</dt><dd>{sessions.length}</dd></div>
            <div><dt>API KEYS</dt><dd>{activeTokens}</dd></div>
          </dl>
          <footer>
            <ShieldCheck aria-hidden="true" />
            <span><strong>{profile?.email ?? "Authenticated account"}</strong><small>{licence ? `${licence.devices} registered device${licence.devices === 1 ? "" : "s"}` : "Local licence"}</small></span>
            <Link href="/settings" aria-label="View account settings"><ArrowRight aria-hidden="true" /></Link>
          </footer>
        </aside>
      </section>

      <section className="overview-detail-grid">
        <section className="overview-workspaces">
          <header><div><h2>Where work runs</h2></div><Link href="/organisations">Manage <ArrowRight aria-hidden="true" /></Link></header>
          <div>
            {workspaces.slice(0, 3).map(({ organisation, workspace }) => <Link href={`/organisations?workspaceId=${workspace.id}`} key={workspace.id}>
              <span className="overview-row-icon"><Users aria-hidden="true" /></span>
              <span><strong>{workspace.name}</strong><small>{organisation.name} · {sentenceCase(workspace.role)}</small></span>
              <ArrowRight aria-hidden="true" />
            </Link>)}
            {!workspaces.length && <div className="overview-workspace-empty"><strong>No workspaces yet</strong><p>Create one to scope runners, environments and access.</p><Link href="/organisations" className="portal-primary">Create workspace</Link></div>}
          </div>
        </section>

        <aside className="overview-actions">
          <header><div><h2>Start here</h2></div></header>
          <nav aria-label="Overview actions">
            <Link href="/operations"><Server aria-hidden="true" /><span><strong>Runner operations</strong><small>Pair and manage Linux hosts</small></span><ArrowRight aria-hidden="true" /></Link>
            <Link href="/security"><KeyRound aria-hidden="true" /><span><strong>Security & API</strong><small>Sessions, keys and access</small></span><ArrowRight aria-hidden="true" /></Link>
            <Link href="/billing"><CreditCard aria-hidden="true" /><span><strong>Plan & billing</strong><small>Credit, rates and plan</small></span><ArrowRight aria-hidden="true" /></Link>
          </nav>
        </aside>
      </section>
    </main>
  );
}

function formatMicros(value: number) { return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value / 1_000_000); }
function formatRunway(balance: number, rate: number) { const minutes = Math.floor(balance / rate), hours = Math.floor(minutes / 60), remainder = minutes % 60; return hours ? `${hours}h ${remainder}m` : `${minutes}m`; }
function sentenceCase(value: string) { return value.charAt(0).toUpperCase() + value.slice(1).replaceAll("_", " "); }
