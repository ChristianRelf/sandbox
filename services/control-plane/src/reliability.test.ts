import { describe, expect, it } from "vitest";
import { ReadinessService, RecurringTaskMonitor, ServiceMetrics, validMetricsBearer } from "./reliability.js";

describe("control-plane reliability signals", () => {
  it("fails readiness without leaking probe errors and recovers when dependencies do", async () => {
    let databaseReady = false;
    const monitor = new RecurringTaskMonitor();
    const readiness = new ReadinessService([
      { name: "database", check: async () => { if (!databaseReady) throw new Error("secret connection detail"); } },
      monitor.probe("access-reviews", 1_000, () => 2_000)
    ], 50);
    let result = await readiness.check(new Date("2026-08-28T00:00:00Z"));
    expect(result).toEqual({
      status: "not_ready",
      checkedAt: "2026-08-28T00:00:00.000Z",
      checks: expect.arrayContaining([
        expect.objectContaining({ name: "database", status: "not_ready" }),
        expect.objectContaining({ name: "background:access-reviews", status: "not_ready" })
      ])
    });
    expect(JSON.stringify(result)).not.toContain("secret");
    databaseReady = true;
    monitor.success("access-reviews", new Date(1_500));
    result = await readiness.check();
    expect(result.status).toBe("ready");
  });

  it("bounds a probe that does not settle", async () => {
    const readiness = new ReadinessService([{ name: "stalled", check: () => new Promise<void>(() => undefined) }], 10);
    const result = await readiness.check();
    expect(result).toMatchObject({ status: "not_ready", checks: [{ name: "stalled", status: "not_ready" }] });
  });

  it("exports bounded route labels and protects metrics with a fixed-length bearer comparison", () => {
    const metrics = new ServiceMetrics();
    metrics.recordRequest("GET", "/v1/workspaces/:workspaceId", 200, 125);
    metrics.recordReadiness(false);
    const output = metrics.prometheus();
    expect(output).toContain('sandbox_http_requests_total{method="GET",route="/v1/workspaces/:workspaceId",status_class="2xx"} 1');
    expect(output).toContain('sandbox_readiness_checks_total{outcome="not_ready"} 1');
    expect(validMetricsBearer("Bearer observability-secret", "observability-secret")).toBe(true);
    expect(validMetricsBearer("Bearer wrong", "observability-secret")).toBe(false);
  });
});
