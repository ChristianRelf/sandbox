import { describe, expect, it } from "vitest";
import { calculateUsageCostMicros } from "./prepaid.js";

describe("prepaid cloud pricing", () => {
  it("applies the one-minute minimum once per compute meter", () => {
    expect(calculateUsageCostMicros({hostedRunnerSeconds:1n,managedBrowserSeconds:0n,networkEgressBytes:0n,artifactStorageByteSeconds:0n})).toBe(5_000n);
    expect(calculateUsageCostMicros({hostedRunnerSeconds:90n,managedBrowserSeconds:0n,networkEgressBytes:0n,artifactStorageByteSeconds:0n})).toBe(7_500n);
    expect(calculateUsageCostMicros({hostedRunnerSeconds:0n,managedBrowserSeconds:10n,networkEgressBytes:0n,artifactStorageByteSeconds:0n})).toBe(10_000n);
  });

  it("prices egress and retained artifacts independently", () => {
    expect(calculateUsageCostMicros({hostedRunnerSeconds:0n,managedBrowserSeconds:0n,networkEgressBytes:1_073_741_824n,artifactStorageByteSeconds:0n})).toBe(200_000n);
    expect(calculateUsageCostMicros({hostedRunnerSeconds:0n,managedBrowserSeconds:0n,networkEgressBytes:0n,artifactStorageByteSeconds:1_073_741_824n*2_592_000n})).toBe(50_000n);
  });
});
