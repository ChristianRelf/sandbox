import { useEffect, useMemo, useState } from "react";
import { issueFingerprint, type IssueLike, type IssueTrackingRecord } from "./issues";

const STORAGE_PREFIX = "sndbox.issue-tracking.v1";

export function updateIssueTracking(
  current: Record<string, IssueTrackingRecord>,
  issues: IssueLike[],
  now: string,
): Record<string, IssueTrackingRecord> {
  const next = { ...current };
  const active = new Set(issues.map(issueFingerprint));

  issues.forEach((issue) => {
    const key = issueFingerprint(issue);
    const existing = next[key];
    next[key] = existing
      ? {
          ...existing,
          lastSeen: now,
          occurrences: existing.resolvedAt ? existing.occurrences + 1 : existing.occurrences,
          resolvedAt: undefined,
        }
      : { firstSeen: now, lastSeen: now, occurrences: 1 };
  });

  Object.entries(next).forEach(([key, record]) => {
    if (!active.has(key) && !record.resolvedAt) next[key] = { ...record, resolvedAt: now };
  });
  return next;
}

export function useIssueTracking(scopeId: string, issues: IssueLike[]) {
  const signature = useMemo(
    () => issues.map((issue) => `${issueFingerprint(issue)}:${issue.severity}`).sort().join("|"),
    [issues],
  );
  const [state, setState] = useState<{ scopeId: string; records: Record<string, IssueTrackingRecord> }>(() => ({
    scopeId,
    records: load(scopeId),
  }));

  useEffect(() => {
    setState((current) => {
      const records = current.scopeId === scopeId ? current.records : load(scopeId);
      const next = updateIssueTracking(records, issues, new Date().toISOString());
      save(scopeId, next);
      return { scopeId, records: next };
    });
  }, [issues, scopeId, signature]);

  return state.scopeId === scopeId ? state.records : {};
}

function load(scopeId: string): Record<string, IssueTrackingRecord> {
  try {
    return JSON.parse(window.localStorage.getItem(`${STORAGE_PREFIX}.${scopeId}`) ?? "{}");
  } catch {
    return {};
  }
}

function save(scopeId: string, records: Record<string, IssueTrackingRecord>) {
  try {
    window.localStorage.setItem(`${STORAGE_PREFIX}.${scopeId}`, JSON.stringify(records));
  } catch {
    // Tracking must never interrupt validation or workflow execution.
  }
}
