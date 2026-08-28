import { describe, expect, it } from "vitest";
import { redactDiagnosticValue } from "./support_access.js";

describe("support diagnostics redaction", () => {
  it("recursively removes secret-shaped fields while preserving aggregate health", () => {
    expect(redactDiagnosticValue({ status: "degraded", nested: { accessToken: "secret", count: 3 }, payload: { unsafe: true }, items: [{ email: "person@example.com", state: "failed" }] })).toEqual({
      status: "degraded",
      nested: { accessToken: "[REDACTED]", count: 3 },
      payload: "[REDACTED]",
      items: [{ email: "[REDACTED]", state: "failed" }]
    });
  });
});
