import { describe, expect, it } from "vitest";
import { redactWebhookPayload, verifyWebhookSignature, WebhookProtector, webhookSignature } from "./webhook_crypto.js";

describe("webhook relay cryptography", () => {
  it("encrypts queued payloads and authenticates exact request bytes", () => {
    const protector = new WebhookProtector(Buffer.alloc(32, 3)); const body = Buffer.from('{"event":"created"}'); const secret = Buffer.alloc(32, 8);
    const envelope = protector.encrypt(body);
    expect(envelope.toString()).not.toContain("created");
    expect(protector.decrypt(envelope)).toEqual(body);
    const signature = webhookSignature(secret, "2026-08-27T12:00:00Z", "nonce-1234567890", body);
    expect(verifyWebhookSignature(secret, "2026-08-27T12:00:00Z", "nonce-1234567890", body, signature)).toBe(true);
    expect(verifyWebhookSignature(secret, "2026-08-27T12:00:00Z", "nonce-1234567890", Buffer.from("changed"), signature)).toBe(false);
  });
  it("redacts configured nested fields without mutating input", () => {
    const input = { user: { token: "secret", name: "Ada" } };
    expect(redactWebhookPayload(input, ["user.token"])).toEqual({ user: { token: "[REDACTED]", name: "Ada" } });
    expect(input.user.token).toBe("secret");
  });
});
