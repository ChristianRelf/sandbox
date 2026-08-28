import { describe, expect, it } from "vitest";
import { postIncidentReportSchema, validateIncidentTransition } from "./incidents.js";

describe("operational incident lifecycle", () => {
  it("allows only forward transitions ending in an immutable review", () => {
    expect(() => validateIncidentTransition("investigating", "identified")).not.toThrow();
    expect(() => validateIncidentTransition("identified", "monitoring")).not.toThrow();
    expect(() => validateIncidentTransition("monitoring", "resolved")).not.toThrow();
    expect(() => validateIncidentTransition("resolved", "reviewed")).not.toThrow();
    expect(() => validateIncidentTransition("monitoring", "investigating")).toThrow(/cannot transition/);
    expect(() => validateIncidentTransition("reviewed", "resolved")).toThrow(/cannot transition/);
  });

  it("requires accountable corrective action before a review can be published", () => {
    const report = {
      summary: "Runner capacity was exhausted in the primary region.",
      impact: "Scheduled production workflows waited for runners.",
      rootCause: "Capacity alert thresholds did not account for a regional drain.",
      detection: "The waiting-for-runner SLI alerted the on-call operator.",
      response: "The incident commander paused new schedules and enabled the approved failover pool.",
      recovery: "Queued work retained identity and completed in the secondary region.",
      lessons: ["Regional capacity must be included in pre-deployment checks."],
      correctiveActions: [{ action: "Add regional headroom alerting.", owner: "Runtime SRE", dueAt: "2026-09-04T12:00:00.000Z", trackingReference: "OPS-142" }]
    };
    expect(postIncidentReportSchema.parse(report)).toEqual(report);
    expect(() => postIncidentReportSchema.parse({ ...report, correctiveActions: [] })).toThrow();
  });
});
