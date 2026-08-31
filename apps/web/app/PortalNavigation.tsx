"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  CreditCard,
  Download,
  Gauge,
  KeyRound,
  LifeBuoy,
  Menu,
  Package,
  ReceiptText,
  Settings,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";

const accountLinks = [
  ["/", "Overview", Gauge],
  ["/downloads", "Downloads", Download],
  ["/releases", "Releases", Package],
  ["/billing", "Billing", CreditCard],
  ["/usage", "Usage", ReceiptText],
  ["/licences", "Licences", KeyRound],
  ["/purchases", "Purchases", Package],
  ["/organisations", "Organisations", Users],
  ["/security", "Security", ShieldCheck],
  ["/support", "Support", LifeBuoy],
  ["/settings", "Settings", Settings],
] as const;

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();

  return (
    <nav className="portal-nav" aria-label="Account navigation">
      {accountLinks.map(([href, label, Icon]) => {
        const active = href === "/" ? pathname === href : pathname.startsWith(href);
        return (
          <Link href={href} key={href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={active ? "active" : undefined}>
            <Icon aria-hidden="true" />
            <span>{label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export function PortalNavigation() {
  return <NavigationLinks />;
}

export function PortalMobileNavigation() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className="portal-mobile-navigation">
      <button
        className="portal-menu-trigger"
        type="button"
        aria-label={open ? "Close account navigation" : "Open account navigation"}
        aria-expanded={open}
        aria-controls="portal-mobile-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
      </button>
      {open && (
        <>
          <button className="portal-menu-backdrop" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside id="portal-mobile-panel" className="portal-mobile-panel" role="dialog" aria-modal="true" aria-label="Account navigation">
            <header><strong>Account</strong><span>Manage your Sandbox boundary.</span></header>
            <NavigationLinks onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}
    </div>
  );
}
