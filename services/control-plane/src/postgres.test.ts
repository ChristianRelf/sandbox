import { describe, expect, it } from "vitest";
import { detectSyncConflict, hostCompatible } from "./postgres.js";

describe("sync conflict preservation", () => {
  it("accepts a child of the current draft", () => {
    expect(detectSyncConflict("current", "current")).toBeNull();
  });

  it("preserves the current draft when another device writes a sibling", () => {
    expect(detectSyncConflict("remote-revision", "shared-parent")).toBe("remote-revision");
  });

  it("treats the first revision as non-conflicting", () => {
    expect(detectSyncConflict(null, null)).toBeNull();
  });
});

describe("marketplace compatibility", () => {
  it("filters against both host bounds", () => {
    expect(hostCompatible("0.3.2", ">=0.3.0", "<0.4.0")).toBe(true);
    expect(hostCompatible("0.4.0", ">=0.3.0", "<0.4.0")).toBe(false);
    expect(hostCompatible("0.2.9", ">=0.3.0", null)).toBe(false);
  });
});
