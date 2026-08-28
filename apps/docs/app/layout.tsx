import type { Metadata } from "next";
import Link from "next/link";
import { Box, ExternalLink, Menu } from "lucide-react";
import { brand } from "@sandbox/brand";
import { docs, nav } from "../lib/content";
import { DocsNavigation } from "../components/DocsNavigation";
import { Search } from "../components/Search";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? brand.domains.docs),
  title: { default: "Sandbox documentation", template: "%s — Sandbox Docs" },
  description: "Practical guides and technical reference for building, running and operating Sandbox visual automations.",
  alternates: { canonical: "/" },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="en" data-scroll-behavior="smooth"><body>
    <a href="#doc" className="skip-link">Skip to article</a>
    <header className="topbar">
      <Link href="/getting-started" className="wordmark"><span><Box size={15}/></span>Sandbox <i>Docs</i></Link>
      <Search pages={docs}/>
      <div className="topbar-links"><a href="https://sandbox.com">Product</a><a href="https://app.sandbox.com">Account <ExternalLink size={11}/></a></div>
      <details className="mobile-navigation">
        <summary aria-label="Open documentation navigation"><Menu size={18}/></summary>
        <div><DocsNavigation groups={nav}/></div>
      </details>
    </header>
    <aside className="sidebar">
      <header><span>DOCUMENTATION</span><small>{docs.length} GUIDES</small></header>
      <DocsNavigation groups={nav}/>
      <footer><strong>Current documentation</strong><span>Product 0.5.x · Web 0.6.x</span></footer>
    </aside>
    {children}
  </body></html>;
}
