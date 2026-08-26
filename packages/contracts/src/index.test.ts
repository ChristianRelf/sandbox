import { describe, expect, it } from "vitest";
import { hasPermission, runnerCommandSchema } from "./index.js";

describe("contracts", () => {
  it("uses explicit permission bundles", () => {
    expect(hasPermission("administrator", "plugins.manage")).toBe(true);
    expect(hasPermission("viewer", "workflows.run")).toBe(false);
  });

  it("rejects incomplete runner commands", () => {
    expect(() => runnerCommandSchema.parse({ commandId: crypto.randomUUID() })).toThrow();
  });
});
