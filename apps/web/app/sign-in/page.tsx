import Link from "next/link";
import { SndboxMark } from "@sandbox/product-ui/brand";
import { ArrowUpRight, Download, KeyRound, ShieldCheck, Users } from "lucide-react";
import { safeReturnTo } from "../../lib/auth";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const values = await searchParams;
  const safe = safeReturnTo(values.returnTo);
  const configured = Boolean(
    process.env.OIDC_AUTHORIZE_URL &&
    process.env.OIDC_TOKEN_URL &&
    process.env.OIDC_CLIENT_ID &&
    process.env.OIDC_REDIRECT_URI &&
    process.env.OIDC_AUDIENCE,
  );

  return (
    <main className="signin-page">
      <header className="signin-brand">
        <Link href="https://sndbox.app" className="wordmark">
          <SndboxMark size={30} /><strong>sndbox</strong>
        </Link>
        <a href="https://sndbox.app">Back to product <ArrowUpRight aria-hidden="true" size={12} /></a>
      </header>

      <div className="signin-layout">
        <aside className="signin-context">
          <p>Account boundary</p>
          <h2>Operate the parts that need a shared home.</h2>
          <div><Download aria-hidden="true" /><span><strong>Releases</strong>Access only artifacts published to your account.</span></div>
          <div><Users aria-hidden="true" /><span><strong>Organisations</strong>Manage workspaces, roles, runners and approvals.</span></div>
          <div><ShieldCheck aria-hidden="true" /><span><strong>Support</strong>Keep temporary diagnostic access explicit and time-boxed.</span></div>
        </aside>

        <section className="signin-card">
          <small>sndbox account</small>
          <h1>Sign in to continue.</h1>
          <p>Use the identity provider configured for your sndbox account.</p>
          {values.referral==="invited"&&<p className="signin-referral">You were invited to sndbox. Create or sign in to an eligible new account, then add at least $10 cloud credit so you and your referrer each receive $5 credit.</p>}
          {values.referral==="invalid"&&<p className="signin-referral error" role="alert">That referral link is not valid. You can still sign in normally.</p>}
          {configured ? (
            <a className="portal-primary" href={`/auth/start?returnTo=${encodeURIComponent(safe)}`}>
              <KeyRound aria-hidden="true" size={14} />Continue securely
            </a>
          ) : (
            <button className="portal-primary" type="button" disabled>
              <KeyRound aria-hidden="true" size={14} />Identity provider not configured
            </button>
          )}
          <div className="signin-security">
            <ShieldCheck aria-hidden="true" size={15} />
            <p>Authentication is completed by the configured provider. This page never asks for your account password.</p>
          </div>
          <p className="domain-note">Signing in at <strong>app.sndbox.app</strong></p>
        </section>
      </div>
    </main>
  );
}
