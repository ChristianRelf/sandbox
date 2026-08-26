import type { Locator, Page } from "playwright";
import type { LocatorAttempt, LocatorCandidate, StructuredLocator } from "./protocol.js";

const priority: Record<LocatorCandidate["kind"], number> = {
  role: 0, label: 1, placeholder: 2, test_id: 3, text: 4, attribute: 5, css: 6, xpath: 7,
};

export function rankCandidates(locator: StructuredLocator): LocatorCandidate[] {
  const seen = new Set<string>();
  return [locator.primary, ...(locator.alternatives ?? [])]
    .filter(candidate => {
      const key = `${candidate.kind}:${candidate.value}:${candidate.name ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((left, right) => priority[left.kind] - priority[right.kind]);
}

export function candidateLocator(page: Page, candidate: LocatorCandidate): Locator {
  switch (candidate.kind) {
    case "role": return page.getByRole(candidate.value as Parameters<Page["getByRole"]>[0], { name: candidate.name, exact: candidate.exact ?? true });
    case "label": return page.getByLabel(candidate.value, { exact: candidate.exact ?? true });
    case "placeholder": return page.getByPlaceholder(candidate.value, { exact: candidate.exact ?? true });
    case "test_id": return page.getByTestId(candidate.value);
    case "text": return page.getByText(candidate.value, { exact: candidate.exact ?? true });
    case "attribute": {
      const [attribute, ...rest] = candidate.value.split("=");
      const value = rest.join("=");
      if (!attribute || !value) throw new Error("Attribute locators must use name=value.");
      if (!/^[a-zA-Z_:][-a-zA-Z0-9_:.]*$/.test(attribute)) throw new Error("Attribute locator name is invalid.");
      return page.locator(`[${attribute}=${JSON.stringify(value)}]`);
    }
    case "css": return page.locator(candidate.value);
    case "xpath": return page.locator(`xpath=${candidate.value}`);
  }
}

export async function resolveLocator(page: Page, structured: StructuredLocator): Promise<{ locator: Locator; candidate: LocatorCandidate; attempts: LocatorAttempt[] }> {
  const attempts: LocatorAttempt[] = [];
  let ambiguous = false;
  for (const candidate of rankCandidates(structured)) {
    try {
      const locator = candidateLocator(page, candidate);
      const count = await locator.count();
      attempts.push({ kind: candidate.kind, value: candidate.value, matchCount: count, succeeded: count === 1, weakFallback: priority[candidate.kind] >= priority.css });
      if (count === 1) return { locator, candidate, attempts };
      if (count > 1) ambiguous = true;
    } catch (error) {
      attempts.push({ kind: candidate.kind, value: candidate.value, matchCount: 0, succeeded: false, weakFallback: priority[candidate.kind] >= priority.css, error: String(error) });
    }
  }
  const error = new Error(ambiguous ? "The recorded target is ambiguous; every matching locator resolved to multiple elements." : "The recorded target no longer exists on this page.");
  Object.assign(error, { locatorAttempts: attempts, code: ambiguous ? "ambiguous_locator" : "locator_not_found" });
  throw error;
}
