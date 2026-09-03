import { describe, expect, it, vi } from "vitest";
import { countIssues, createIssueReport, displayIssueCode, issueFingerprint } from "./issues";

describe("issue system", () => {
  it("formats stable public identifiers by severity", () => {
    expect(displayIssueCode("incomplete_node", "info")).toBe("I#028");
    expect(displayIssueCode("incomplete_node", "warning")).toBe("W#028");
    expect(displayIssueCode("incomplete_node", "error")).toBe("E#028");
    expect(displayIssueCode("permission_required", "permission")).toBe("P#001");
  });

  it("keeps fallback identifiers deterministic and three digits", () => {
    const first = displayIssueCode("future_machine_code", "error");
    expect(first).toMatch(/^E#9\d{2}$/);
    expect(displayIssueCode("future_machine_code", "error")).toBe(first);
  });

  it("counts each severity separately", () => {
    expect(countIssues([
      { severity: "info" },
      { severity: "warning" },
      { severity: "error" },
      { severity: "permission" },
      { severity: "warning" },
    ])).toEqual({ info: 1, warning: 2, error: 1, permission: 1 });
  });

  it("creates a sanitized report without workflow configuration or secrets", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-03T12:00:00.000Z"));
    const issue = { code: "incomplete_node", message: "URL is required.", severity: "error" as const, nodeId: "node-1", fieldPath: "configuration.url" };
    expect(createIssueReport(issue, { workflowId: "workflow-1" })).toEqual({
      issueCode: "E#028",
      internalCode: "incomplete_node",
      severity: "error",
      message: "URL is required.",
      suggestion: undefined,
      workflowId: "workflow-1",
      executionId: undefined,
      nodeId: "node-1",
      fieldPath: "configuration.url",
      firstSeen: undefined,
      lastSeen: undefined,
      occurrences: undefined,
      reportedAt: "2026-09-03T12:00:00.000Z",
    });
    expect(issueFingerprint(issue)).toBe("incomplete_node:node-1:configuration.url");
    vi.useRealTimers();
  });
});
