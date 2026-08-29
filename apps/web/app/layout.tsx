import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@sandbox/brand";
import {
  Bell, Box, CreditCard, Download, Gauge, KeyRound, LifeBuoy,
  Package, ReceiptText, Settings, ShieldCheck, User, Users,
} from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(brand.domains.app),
  title: { default: "Sandbox account", template: "%s · Sandbox" },
  description: "Manage Sandbox releases, licences, purchases, usage, organisations and support.",
};

const accountLinks = [
  ["/", "Overview", Gauge], ["/downloads", "Downloads", Download],
  ["/releases", "Releases", Package], ["/billing", "Billing", CreditCard],
  ["/usage", "Usage", ReceiptText], ["/licences", "Licences", KeyRound],
  ["/purchases", "Purchases", Package], ["/organisations", "Organisations", Users],
  ["/security", "Security", ShieldCheck], ["/support", "Support", LifeBuoy],
  ["/settings", "Settings", Settings],
] as const;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>
    <header className="portal-header">
      <Link href="/" className="wordmark"><span><Box size={17}/></span>Sandbox</Link><i>Account</i>
      <a className="product-link" href={brand.domains.marketing}>Back to product</a>
      <button aria-label="Notifications"><Bell size={16}/></button>
      <div className="account-chip" aria-label="Unauthenticated account"><User size={13}/></div>
    </header>
    <aside className="portal-sidebar"><nav aria-label="Account navigation">
      {accountLinks.map(([href, label, Icon]) => <Link href={href} key={href}><Icon/>{label}</Link>)}
    </nav><footer><span>Local runs</span><strong>Unmetered</strong></footer></aside>
    <div className="portal-content">{children}</div>
  </body></html>;
}
