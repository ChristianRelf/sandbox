"use client";

import Link from "next/link";
import { ChevronDown, FileCode2 } from "lucide-react";
import { usePathname } from "next/navigation";
import type { DocPage } from "../lib/content";

type NavGroup = { section: string; pages: DocPage[] };

export function DocsNavigation({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();
  const currentSlug = pathname.replace(/^\//, "");

  return <nav className="docs-navigation" aria-label="Documentation">
    {groups.map((group) => {
      const containsCurrent = group.pages.some(page => page.slug === currentSlug);
      return <details key={`${group.section}:${containsCurrent}`} open={containsCurrent}>
        <summary>
          <span>{group.section}</span>
          <small>{group.pages.length}</small>
          <ChevronDown size={12}/>
        </summary>
        <div>
          {group.pages.map(page => <Link aria-current={page.slug === currentSlug ? "page" : undefined} className={page.slug === currentSlug ? "active" : ""} key={page.slug} href={`/${page.slug}`}>{page.title}</Link>)}
        </div>
      </details>;
    })}
    <details open={currentSlug === "developers/api/reference" || currentSlug === "nodes/reference"}>
      <summary><span>Generated reference</span><small>2</small><ChevronDown size={12}/></summary>
      <div>
        <Link aria-current={currentSlug === "developers/api/reference" ? "page" : undefined} className={currentSlug === "developers/api/reference" ? "active" : ""} href="/developers/api/reference"><FileCode2 size={11}/> API reference</Link>
        <Link aria-current={currentSlug === "nodes/reference" ? "page" : undefined} className={currentSlug === "nodes/reference" ? "active" : ""} href="/nodes/reference"><FileCode2 size={11}/> Node reference</Link>
      </div>
    </details>
  </nav>;
}
