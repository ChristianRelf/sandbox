import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { publicAppOrigin } from "../apps/web/lib/public-origin";

describe("publicAppOrigin", () => {
  it("derives the public app origin from the configured callback URL", () => {
    expect(publicAppOrigin("https://app.sndbox.app/auth/callback")).toBe("https://app.sndbox.app");
    expect(publicAppOrigin("http://127.0.0.1:3300/auth/callback")).toBe("http://127.0.0.1:3300");
  });

  it("rejects missing and unsafe callback URLs", () => {
    expect(() => publicAppOrigin(undefined)).toThrow("OIDC_REDIRECT_URI is required");
    expect(() => publicAppOrigin("file:///tmp/callback")).toThrow("must use HTTP or HTTPS");
    expect(() => publicAppOrigin("https://user:password@app.sndbox.app/auth/callback")).toThrow("must not contain credentials");
  });

  it("keeps account redirects independent of the internal request address", () => {
    const callback = readFileSync(resolve("apps/web/app/auth/callback/route.ts"), "utf8");
    const checkout = readFileSync(resolve("apps/web/app/billing/checkout/route.ts"), "utf8");

    expect(callback).toContain("publicAppOrigin");
    expect(callback).not.toContain("request.nextUrl.origin");
    expect(checkout).toContain("publicAppOrigin");
    expect(checkout).not.toContain("request.nextUrl.origin");
    expect(checkout).not.toContain("request.url");
  });
});
