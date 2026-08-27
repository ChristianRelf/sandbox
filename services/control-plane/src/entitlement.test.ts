import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { Ed25519EntitlementClaimSigner } from "./entitlement.js";

describe("offline entitlement claims", () => {
  it("signs an exact owner, plugin, plan and grace window", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = new Ed25519EntitlementClaimSigner("entitlement-1", "https://api.sandbox.test/", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const claim = signer.sign({ entitlementId: "11111111-1111-4111-8111-111111111111", ownerType: "workspace", ownerId: "22222222-2222-4222-8222-222222222222", pluginId: "com.example.weather", planId: "team", status: "active", seatAllowance: 10, startsAt: "2026-08-27T12:00:00.000Z", renewsAt: "2026-09-27T12:00:00.000Z", offlineGraceUntil: "2026-10-04T12:00:00.000Z" });
    const { signature, ...unsigned } = claim;
    const canonical = JSON.stringify(Object.fromEntries(Object.entries(unsigned).sort(([a],[b]) => a.localeCompare(b)).map(([key,value]) => [key, value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a],[b]) => a.localeCompare(b))) : value])));
    expect(verify(null, Buffer.from(canonical), publicKey, Buffer.from(signature, "base64"))).toBe(true);
    expect(claim.issuer).toBe("https://api.sandbox.test");
  });
});
