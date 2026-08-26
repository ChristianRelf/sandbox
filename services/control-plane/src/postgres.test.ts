import { describe, expect, it } from "vitest";
import { detectSyncConflict } from "./postgres.js";

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
