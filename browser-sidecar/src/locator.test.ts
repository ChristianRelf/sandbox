import { describe, expect, it } from "vitest";
import { rankCandidates } from "./locator.js";
import { deduplicateRecorderEvents, isSensitiveField } from "./recorder.js";

describe("locator ranking", () => {
  it("prioritises semantic locators over raw selectors", () => {
    const ranked = rankCandidates({
      primary: { kind: "css", value: "#submit" },
      alternatives: [
        { kind: "xpath", value: "//button" },
        { kind: "text", value: "Submit" },
        { kind: "role", value: "button", name: "Submit" },
      ],
      tag: "button", recordingUrl: "http://localhost/",
    });
    expect(ranked.map(candidate => candidate.kind)).toEqual(["role", "text", "css", "xpath"]);
  });
});

describe("recorder hygiene", () => {
  it("deduplicates sentence typing into one fill step", () => {
    const locator = { primary: { kind: "label", value: "Email" }, tag: "input", recordingUrl: "http://localhost/" };
    const steps = deduplicateRecorderEvents([
      { id: "1", action: "fill_field", name: "Fill email", configuration: { locator, value: "a" } },
      { id: "2", action: "fill_field", name: "Fill email", configuration: { locator, value: "alice@example.com" } },
    ]);
    expect(steps).toHaveLength(1);
    expect(steps[0].configuration.value).toBe("alice@example.com");
  });

  it("detects password and payment fields", () => {
    expect(isSensitiveField({ type: "password" })).toBe(true);
    expect(isSensitiveField({ autocomplete: "cc-number" })).toBe(true);
    expect(isSensitiveField({ label: "Display name" })).toBe(false);
  });
});
