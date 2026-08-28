import { createHash, timingSafeEqual } from "node:crypto";

export interface ReadinessProbe {
  name: string;
  check(): Promise<void>;
}

export interface ReadinessCheck {
  name: string;
  status: "ready" | "not_ready";
  durationMs: number;
}

export interface ReadinessResult {
  status: "ready" | "not_ready";
  checkedAt: string;
  checks: ReadinessCheck[];
}

export class ReadinessService {
  constructor(
    private readonly probes: ReadinessProbe[],
    private readonly timeoutMs = 2_000
  ) {}

  async check(now = new Date()): Promise<ReadinessResult> {
    const checks = await Promise.all(this.probes.map(probe => this.runProbe(probe)));
    return {
      status: checks.every(check => check.status === "ready") ? "ready" : "not_ready",
      checkedAt: now.toISOString(),
      checks
    };
  }

  private async runProbe(probe: ReadinessProbe): Promise<ReadinessCheck> {
    const started = performance.now();
    let timeout: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        probe.check(),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error("readiness probe timed out")), this.timeoutMs);
        })
      ]);
      return { name: probe.name, status: "ready", durationMs: Math.round(performance.now() - started) };
    } catch {
      return { name: probe.name, status: "not_ready", durationMs: Math.round(performance.now() - started) };
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

export class RecurringTaskMonitor {
  private readonly successes = new Map<string, number>();

  success(name: string, at = new Date()): void {
    this.successes.set(name, at.getTime());
  }

  probe(name: string, maximumAgeMs: number, now: () => number = () => Date.now()): ReadinessProbe {
    return {
      name: `background:${name}`,
      check: async () => {
        const last = this.successes.get(name);
        if (last === undefined || now() - last > maximumAgeMs) throw new Error("background task is stale");
      }
    };
  }
}

interface RequestMetric {
  count: number;
  durationSeconds: number;
}

export class ServiceMetrics {
  private readonly requests = new Map<string, RequestMetric>();
  private readinessReady = 0;
  private readinessFailed = 0;

  recordRequest(method: string, route: string, statusCode: number, durationMs: number): void {
    const statusClass = `${Math.floor(statusCode / 100)}xx`;
    const key = JSON.stringify([method, route, statusClass]);
    const current = this.requests.get(key) ?? { count: 0, durationSeconds: 0 };
    current.count += 1;
    current.durationSeconds += durationMs / 1_000;
    this.requests.set(key, current);
  }

  recordReadiness(ready: boolean): void {
    if (ready) this.readinessReady += 1;
    else this.readinessFailed += 1;
  }

  prometheus(): string {
    const lines = [
      "# HELP sandbox_http_requests_total HTTP requests completed.",
      "# TYPE sandbox_http_requests_total counter",
      "# HELP sandbox_http_request_duration_seconds_sum Total HTTP request duration.",
      "# TYPE sandbox_http_request_duration_seconds_sum counter"
    ];
    for (const [key, value] of [...this.requests].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, statusClass] = JSON.parse(key) as string[];
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status_class="${escapeLabel(statusClass)}"`;
      lines.push(
        `sandbox_http_requests_total{${labels}} ${value.count}`,
        `sandbox_http_request_duration_seconds_sum{${labels}} ${value.durationSeconds.toFixed(6)}`
      );
    }
    lines.push(
      "# HELP sandbox_readiness_checks_total Readiness checks by outcome.",
      "# TYPE sandbox_readiness_checks_total counter",
      `sandbox_readiness_checks_total{outcome="ready"} ${this.readinessReady}`,
      `sandbox_readiness_checks_total{outcome="not_ready"} ${this.readinessFailed}`,
      ""
    );
    return lines.join("\n");
  }
}

export function validMetricsBearer(authorization: string | undefined, expected: string): boolean {
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = createHash("sha256").update(authorization.slice(7)).digest();
  const wanted = createHash("sha256").update(expected).digest();
  return timingSafeEqual(supplied, wanted);
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n");
}
