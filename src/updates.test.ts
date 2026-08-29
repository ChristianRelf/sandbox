import { describe, expect, it } from "vitest";
import { compareVersions, isNewerVersion } from "./updates";

describe("desktop update version comparison", () => {
  it("orders beta increments and stable releases correctly", () => {
    expect(isNewerVersion("0.7.0-beta.2", "0.7.0-beta.3")).toBe(true);
    expect(isNewerVersion("0.7.0-beta.2", "0.7.0")).toBe(true);
    expect(isNewerVersion("0.7.0", "0.7.0-beta.3")).toBe(false);
  });

  it("orders semantic versions rather than comparing strings", () => {
    expect(compareVersions("0.10.0", "0.9.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("not-a-version", "1.0.0")).toBe(0);
  });
});
