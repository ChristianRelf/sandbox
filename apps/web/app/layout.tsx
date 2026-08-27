import type { Metadata } from "next";
import Link from "next/link";
import { Boxes, ShieldCheck } from "lucide-react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sandbox Marketplace", template: "%s · Sandbox" },
  description:
    "Discover signed, capability-controlled automation plugins for Sandbox.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/marketplace" className="wordmark">
            <span>
              <Boxes size={17} />
            </span>
            Sandbox
          </Link>
          <nav>
            <Link href="/marketplace">Marketplace</Link>
          </nav>
          <div className="trust-mark">
            <ShieldCheck size={14} />
            Local execution
          </div>
        </header>
        {children}
        <footer className="site-footer">
          <span>Sandbox v0.5 ecosystem</span>
          <span>
            Plugins run locally inside a capability-controlled Wasm sandbox.
          </span>
        </footer>
      </body>
    </html>
  );
}
