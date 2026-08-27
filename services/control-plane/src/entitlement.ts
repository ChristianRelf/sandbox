import { createPrivateKey, sign } from "node:crypto";
import { entitlementClaimSchema, type EntitlementClaim } from "@sandbox/contracts";
import type { EntitlementRecord } from "./types.js";

export interface EntitlementClaimSigner { readonly keyId: string; readonly issuer: string; sign(record: EntitlementRecord): EntitlementClaim }

export class Ed25519EntitlementClaimSigner implements EntitlementClaimSigner {
  readonly keyId: string;
  readonly issuer: string;
  private readonly privateKey;
  constructor(keyId: string, issuer: string, privateKeyPem: string) {
    this.keyId = keyId; this.issuer = issuer.replace(/\/$/, ""); this.privateKey = createPrivateKey(privateKeyPem);
    if (this.privateKey.asymmetricKeyType !== "ed25519") throw new Error("Entitlement signing key must be Ed25519.");
  }
  sign(record: EntitlementRecord): EntitlementClaim {
    const unsigned = { entitlementId: record.entitlementId, owner: { ownerType: record.ownerType, ownerId: record.ownerId }, pluginId: record.pluginId, planId: record.planId, status: record.status, seatAllowance: record.seatAllowance, validFrom: record.startsAt, validUntil: record.renewsAt, offlineGraceUntil: record.offlineGraceUntil, issuer: this.issuer, keyId: this.keyId };
    const signature = sign(null, Buffer.from(JSON.stringify(sortValue(unsigned)), "utf8"), this.privateKey).toString("base64");
    return entitlementClaimSchema.parse({ ...unsigned, signature });
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
  return value;
}
