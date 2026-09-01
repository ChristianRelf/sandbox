import { describe, expect, it } from "vitest";
import { diagnoseCode } from "./codeDiagnostics";

describe("live code diagnostics", () => {
  it("reports JavaScript syntax and inferred assignment problems", () => {
    expect(diagnoseCode("javascript", "const value = ;")).toEqual([
      expect.objectContaining({ severity: "error", line: 1 }),
    ]);
    expect(diagnoseCode("javascript", "let count = 1;\ncount = 'one';")).toContainEqual(
      expect.objectContaining({ severity: "warning", line: 2, message: expect.stringContaining("initialized as integer") }),
    );
  });

  it("checks Python annotations as the user types", () => {
    expect(diagnoseCode("python", "name: str = 42")).toContainEqual(
      expect.objectContaining({ severity: "error", message: expect.stringContaining("annotated as str") }),
    );
  });

  it("accepts valid HTML and CSS", () => {
    expect(diagnoseCode("html", "<!doctype html><html><body><main>OK</main></body></html>")).toEqual([]);
    expect(diagnoseCode("css", "main { color: rebeccapurple; }")).toEqual([]);
  });
});
