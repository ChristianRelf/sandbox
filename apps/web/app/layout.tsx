import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { brand } from "@sandbox/brand";
import { SndboxMark } from "@sandbox/product-ui/brand";
import { ArrowUpRight, LogOut, User } from "lucide-react";
import { authenticatedClient } from "../lib/auth";
import { PortalMobileNavigation, PortalNavigation } from "./PortalNavigation";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(brand.domains.app),
  title: { default: "sndbox account", template: "%s · sndbox" },
  description: "Manage your sndbox workspaces, plan, security, downloads and account settings.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#portal-main" className="skip-link">Skip to account content</a>
        <header className="portal-header">
          <Link href="/" className="wordmark" aria-label="sndbox account home">
            <SndboxMark size={30} />
            <strong>sndbox</strong>
          </Link>
          <i>Account</i>
          <nav className="portal-destinations" aria-label="sndbox destinations">
            <a href={brand.domains.marketing}>Product</a>
            <a href={brand.domains.docs}>Docs <ArrowUpRight aria-hidden="true" size={12} /></a>
            <a href={brand.community.discord}>Discord <ArrowUpRight aria-hidden="true" size={12} /></a>
          </nav>
          <Suspense fallback={<div className="account-chip" aria-label="Loading account"><User aria-hidden="true" size={13} /></div>}>
            <AccountChip />
          </Suspense>
          <PortalMobileNavigation />
        </header>

        <aside className="portal-sidebar">
          <div className="portal-sidebar-intro">
            <strong>Account</strong>
            <span>Workspace, plan and security</span>
          </div>
          <PortalNavigation />
          <footer>
            <div><span>Local execution</span><strong>Unmetered</strong></div>
            <form action="/auth/sign-out" method="post">
              <button type="submit"><LogOut aria-hidden="true" /> Sign out</button>
            </form>
          </footer>
        </aside>

        <div id="portal-main" className="portal-content">{children}</div>
      </body>
    </html>
  );
}

async function AccountChip() {
  const api = await authenticatedClient();
  if (!api) return <div className="account-chip" aria-label="Account unavailable"><User aria-hidden="true" size={13} /></div>;
  try {
    const profile = (await api.getAccountProfile()).data;
    return (
      <Link href="/settings" className="account-chip" title={profile.email} aria-label={`Open settings for ${profile.displayName}`}>
        {profile.displayName.slice(0, 2).toUpperCase()}
      </Link>
    );
  } catch {
    return <div className="account-chip" aria-label="Account unavailable"><User aria-hidden="true" size={13} /></div>;
  }
}
