"use client";

import { useEffect, useMemo, useState } from "react";
import { Search as SearchIcon, X } from "lucide-react";
import type { DocPage } from "../lib/content";

const recentSearchKey = "sandbox-doc-searches";

export function Search({ pages }: { pages: DocPage[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [recent, setRecent] = useState<string[]>([]);

  useEffect(() => {
    try {
      setRecent(JSON.parse(localStorage.getItem(recentSearchKey) ?? "[]"));
    } catch {
      localStorage.removeItem(recentSearchKey);
    }

    const handleKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === "Escape") setOpen(false);
    };

    addEventListener("keydown", handleKey);
    return () => removeEventListener("keydown", handleKey);
  }, []);

  const results = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];

    return pages
      .filter((page) => {
        const concepts = page.concepts
          ?.map((concept) => `${concept.title} ${concept.body}`)
          .join(" ");
        const steps = page.steps
          .map((step) => `${step.title} ${step.body} ${step.code ?? ""}`)
          .join(" ");
        const haystack = [
          page.title,
          page.description,
          page.section,
          page.prerequisites?.join(" "),
          concepts,
          page.notes?.join(" "),
          steps,
          page.result,
          page.errors.join(" "),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return terms.every((term) => haystack.includes(term));
      })
      .slice(0, 10);
  }, [query, pages]);

  function visit(slug: string) {
    const value = query.trim();
    if (value) {
      const next = [value, ...recent.filter((item) => item !== value)].slice(0, 5);
      localStorage.setItem(recentSearchKey, JSON.stringify(next));
    }
    location.href = `/${slug}`;
  }

  return (
    <>
      <button className="search-button" aria-label="Search documentation" onClick={() => setOpen(true)}>
        <SearchIcon aria-hidden="true" size={14} />
        <span>Search documentation</span>
        <kbd>Ctrl K</kbd>
      </button>

      {open && (
        <div
          className="search-dialog"
          role="dialog"
          aria-modal="true"
          aria-label="Search documentation"
        >
          <button
            className="search-backdrop"
            onClick={() => setOpen(false)}
            aria-label="Close search"
          />
          <section>
            <header>
              <SearchIcon aria-hidden="true" size={16} />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search guides, nodes, errors and examples"
                aria-label="Search query"
              />
              <button onClick={() => setOpen(false)} aria-label="Close">
                <X aria-hidden="true" size={16} />
              </button>
            </header>
            <div className="results">
              {query ? (
                results.length ? (
                  results.map((page) => (
                    <button key={page.slug} onClick={() => visit(page.slug)}>
                      <small>{page.section}</small>
                      <strong>{page.title}</strong>
                      <span>{page.description}</span>
                    </button>
                  ))
                ) : (
                  <p>No results. Try a node name, error, runner or task.</p>
                )
              ) : recent.length ? (
                <>
                  <small>RECENT SEARCHES</small>
                  {recent.map((value) => (
                    <button key={value} onClick={() => setQuery(value)}>
                      <strong>{value}</strong>
                    </button>
                  ))}
                </>
              ) : (
                <p>Search all guides, including concepts, procedures and errors.</p>
              )}
            </div>
          </section>
        </div>
      )}
    </>
  );
}
