import type { Metadata } from "next";
import Link from "next/link";
import { brand } from "@sandbox/brand";
import { ArrowUpRight, Box, Menu } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_MARKETING_URL ?? brand.domains.marketing),
  title: { default: `${brand.name} — ${brand.tagline}`, template: `%s — ${brand.name}` },
  description: brand.description,
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: brand.name, title: brand.tagline, description: brand.description },
  twitter: { card: "summary_large_image", title: brand.tagline, description: brand.description },
};

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body>
    <a className="skip-link" href="#content">Skip to content</a>
    <header className="site-nav">
      <div className="nav-inner">
        <Link className="wordmark" href="/"><span><Box size={16} strokeWidth={2.2} /></span>Sandbox</Link>
        <nav aria-label="Main navigation">
          <Link href="/#product">Product</Link><Link href="/solutions">Solutions</Link><Link href="/integrations">Integrations</Link>
          <Link href="/marketplace">Marketplace</Link><Link href="/pricing">Pricing</Link><Link href="/developers">Developers</Link>
          <a href={`${brand.domains.docs}/getting-started`}>Docs</a>
        </nav>
        <div className="nav-actions"><a className="signin" href={`${brand.domains.app}/sign-in`}>Sign in</a><Link className="nav-cta" href="/downloads">Download <ArrowUpRight size={13}/></Link></div>
        <details className="mobile-menu"><summary aria-label="Open navigation"><Menu size={18}/></summary><nav aria-label="Mobile navigation"><Link href="/#product">Product</Link><Link href="/solutions">Solutions</Link><Link href="/integrations">Integrations</Link><Link href="/pricing">Pricing</Link><Link href="/developers">Developers</Link><a href={`${brand.domains.docs}/getting-started`}>Docs</a><a href={`${brand.domains.app}/sign-in`}>Sign in</a></nav></details>
      </div>
    </header>
    {children}
    <footer className="site-footer"><div><Link className="wordmark" href="/"><span><Box size={15}/></span>Sandbox</Link><p>Visual automation with a machine boundary you control.</p></div><div><Link href="/security">Security</Link><Link href="/support">Support</Link><a href={`${brand.domains.docs}/getting-started`}>Documentation</a><Link href="/legal">Legal</Link></div><small>© 2026 Sandbox. Legal content requires professional review.</small></footer>
  </body></html>;
}
