import { describe, expect, it } from "vitest";
import { brand } from "../packages/brand/src";

describe("Sandbox public domains", () => {
  it("uses the sndbox.app production namespace", () => {
    expect(brand.domains).toEqual({
      marketing: "https://sndbox.app",
      app: "https://app.sndbox.app",
      docs: "https://docs.sndbox.app",
      api: "https://api.sndbox.app",
      identity: "https://identity.sndbox.app",
    });

    for (const value of Object.values(brand.domains)) {
      expect(new URL(value).protocol).toBe("https:");
    }
  });
});
