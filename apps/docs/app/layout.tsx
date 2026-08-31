import type { Metadata } from "next";
import Link from "next/link";
import { ArrowUpRight, Box } from "lucide-react";
import { brand } from "@sandbox/brand";
import { docs, nav, currentProductVersion } from "../lib/content";
import { DocsNavigation } from "../components/DocsNavigation";
import { MobileDocsNavigation } from "../components/MobileDocsNavigation";
import { Search } from "../components/Search";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL ?? brand.domains.docs),
  title: { default: "Sandbox documentation", template: "%s — Sandbox Docs" },
  description: "Practical guides and technical reference for building, running and operating Sandbox visual automations.",
  openGraph: {
    type: "website",
    title: "Sandbox Docs",
    description: "Build it. Run it. Understand every step.",
    images: [{ url: "/og.png", width: 1200, height: 630, alt: "Sandbox Docs" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sandbox Docs",
    description: "Build it. Run it. Understand every step.",
    images: ["/og.png"],
  },
};

export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth">
      <body>
        <a href="#doc" className="skip-link">Skip to article</a>
        <header className="topbar">
          <Link href="/getting-started" className="wordmark" aria-label="Sandbox documentation home">
            <span><Box aria-hidden="true" size={15} /></span>
            <strong>Sandbox</strong>
            <i>Docs</i>
          </Link>
          <Search pages={docs} />
          <nav className="topbar-links" aria-label="Sandbox destinations">
            <a href={brand.domains.marketing}>Product</a>
            <a href={brand.domains.app}>Account <ArrowUpRight aria-hidden="true" size={12} /></a>
          </nav>
          <MobileDocsNavigation groups={nav} />
        </header>

        <aside className="sidebar">
          <div className="sidebar-intro">
            <strong>Documentation</strong>
            <p>Build, run and operate Sandbox.</p>
          </div>
          <DocsNavigation groups={nav} />
          <footer>
            <span>Current source version</span>
            <strong>{currentProductVersion}</strong>
          </footer>
        </aside>

        {children}
      </body>
    </html>
  );
}
