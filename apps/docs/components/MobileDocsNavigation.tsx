"use client";

import { useEffect, useState } from "react";
import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import type { DocPage } from "../lib/content";
import { DocsNavigation } from "./DocsNavigation";

type NavGroup = { section: string; pages: DocPage[] };

export function MobileDocsNavigation({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => setOpen(false), [pathname]);

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
    <div className="mobile-navigation">
      <button
        className="mobile-nav-trigger"
        type="button"
        aria-label={open ? "Close documentation navigation" : "Open documentation navigation"}
        aria-expanded={open}
        aria-controls="mobile-docs-panel"
        onClick={() => setOpen((value) => !value)}
      >
        {open ? <X aria-hidden="true" size={18} /> : <Menu aria-hidden="true" size={18} />}
      </button>
      {open && (
        <>
          <button className="mobile-nav-backdrop" type="button" aria-label="Close navigation" onClick={() => setOpen(false)} />
          <aside id="mobile-docs-panel" className="mobile-nav-panel" role="dialog" aria-modal="true" aria-label="Documentation navigation">
            <header>
              <strong>Documentation</strong>
              <span>Choose a guide or reference.</span>
            </header>
            <DocsNavigation groups={groups} onNavigate={() => setOpen(false)} />
          </aside>
        </>
      )}
    </div>
  );
}
