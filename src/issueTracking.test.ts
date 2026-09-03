import { describe, expect, it } from "vitest";
import { updateIssueTracking } from "./issueTracking";

const issue = { code: "incomplete_node", message: "URL required", severity: "error" as const, nodeId: "node-1" };

describe("issue tracking", () => {
  it("tracks first and last seen without counting repeated active renders", () => {
    const first = updateIssueTracking({}, [issue], "2026-09-03T10:00:00.000Z");
    const repeated = updateIssueTracking(first, [issue], "2026-09-03T10:01:00.000Z");
    expect(repeated["incomplete_node:node-1"]).toEqual({
      firstSeen: "2026-09-03T10:00:00.000Z",
      lastSeen: "2026-09-03T10:01:00.000Z",
      occurrences: 1,
      resolvedAt: undefined,
    });
  });

  it("marks missing issues resolved and counts a recurrence", () => {
    const first = updateIssueTracking({}, [issue], "2026-09-03T10:00:00.000Z");
    const resolved = updateIssueTracking(first, [], "2026-09-03T10:01:00.000Z");
    const returned = updateIssueTracking(resolved, [issue], "2026-09-03T10:02:00.000Z");
    expect(returned["incomplete_node:node-1"].occurrences).toBe(2);
    expect(returned["incomplete_node:node-1"].resolvedAt).toBeUndefined();
  });
});
