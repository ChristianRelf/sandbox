import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export class WebhookProtector {
  constructor(private readonly key: Buffer) { if (key.length !== 32) throw new Error("Webhook encryption key must be 32 bytes."); }
  encrypt(value: Buffer): Buffer {
    const nonce = randomBytes(12); const cipher = createCipheriv("aes-256-gcm", this.key, nonce); const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([Buffer.from([1]), nonce, cipher.getAuthTag(), ciphertext]);
  }
  decrypt(envelope: Buffer): Buffer {
    if (envelope.length < 30 || envelope[0] !== 1) throw new Error("Webhook encryption envelope is invalid.");
    const decipher = createDecipheriv("aes-256-gcm", this.key, envelope.subarray(1, 13)); decipher.setAuthTag(envelope.subarray(13, 29));
    return Buffer.concat([decipher.update(envelope.subarray(29)), decipher.final()]);
  }
}

export function webhookSignature(secret: Buffer, timestamp: string, nonce: string, body: Buffer): string {
  return createHmac("sha256", secret).update(timestamp).update(".").update(nonce).update(".").update(body).digest("base64");
}

export function verifyWebhookSignature(secret: Buffer, timestamp: string, nonce: string, body: Buffer, signature: string): boolean {
  try { const expected = Buffer.from(webhookSignature(secret, timestamp, nonce, body), "base64"); const actual = Buffer.from(signature, "base64"); return actual.length === expected.length && timingSafeEqual(actual, expected); }
  catch { return false; }
}

export function redactWebhookPayload(value: unknown, paths: string[]): unknown {
  const clone = structuredClone(value);
  for (const path of paths) {
    const segments = path.split(".").filter(Boolean); let current: unknown = clone;
    for (let index = 0; index < segments.length - 1; index++) { if (!current || typeof current !== "object") break; current = (current as Record<string, unknown>)[segments[index]]; }
    if (current && typeof current === "object" && segments.length) (current as Record<string, unknown>)[segments.at(-1)!] = "[REDACTED]";
  }
  return clone;
}
