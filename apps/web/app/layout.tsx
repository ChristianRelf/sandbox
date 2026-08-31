import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { brand } from "@sandbox/brand";
import { ArrowUpRight, Box, User } from "lucide-react";
import { authenticatedClient } from "../lib/auth";
import { PortalMobileNavigation, PortalNavigation } from "./PortalNavigation";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(brand.domains.app),
  title: { default: "Sandbox account", template: "%s · Sandbox" },
  description: "Manage Sandbox releases, licences, purchases, usage, organisations and support.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a href="#portal-main" className="skip-link">Skip to account content</a>
        <header className="portal-header">
          <Link href="/" className="wordmark" aria-label="Sandbox account home">
            <span><Box aria-hidden="true" size={16} /></span>
            <strong>Sandbox</strong>
          </Link>
          <i>Account</i>
          <nav className="portal-destinations" aria-label="Sandbox destinations">
            <a href={brand.domains.marketing}>Product</a>
            <a href={brand.domains.docs}>Docs <ArrowUpRight aria-hidden="true" size={12} /></a>
          </nav>
          <Suspense fallback={<div className="account-chip" aria-label="Loading account"><User aria-hidden="true" size={13} /></div>}>
            <AccountChip />
          </Suspense>
          <PortalMobileNavigation />
        </header>

        <aside className="portal-sidebar">
          <div className="portal-sidebar-intro">
            <strong>Account</strong>
            <span>Identity and operations</span>
          </div>
          <PortalNavigation />
          <footer><span>Local execution</span><strong>Unmetered</strong></footer>
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
      <div className="account-chip" title={`${profile.displayName} · ${profile.email}`} aria-label={`Signed in as ${profile.displayName}`}>
        {profile.displayName.slice(0, 2).toUpperCase()}
      </div>
    );
  } catch {
    return <div className="account-chip" aria-label="Account unavailable"><User aria-hidden="true" size={13} /></div>;
  }
}
