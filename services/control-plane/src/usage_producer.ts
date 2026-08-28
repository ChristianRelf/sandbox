import { createHmac,timingSafeEqual } from "node:crypto";
import { DomainError } from "./types.js";

export interface UsageProducerRequest {
  producerId: string;
  timestamp: string;
  signature: string;
  body: unknown;
}

export interface UsageProducerAuthenticator {
  verify(request:UsageProducerRequest):void;
}

export class HmacUsageProducerAuthenticator implements UsageProducerAuthenticator {
  constructor(private readonly secrets:ReadonlyMap<string,Buffer>,private readonly maximumClockSkewSeconds=300) {
    if (!secrets.size) throw new Error("At least one trusted usage producer is required.");
  }
  verify(request:UsageProducerRequest):void {
    const secret=this.secrets.get(request.producerId);
    if (!secret) throw new DomainError("usage_producer_unauthorized","The usage producer is not trusted.",401);
    const timestamp=Number(request.timestamp);
    if (!Number.isSafeInteger(timestamp) || Math.abs(Date.now()-timestamp*1000)>this.maximumClockSkewSeconds*1000) throw new DomainError("usage_producer_timestamp_invalid","The usage producer timestamp is outside the accepted window.",401);
    if (!/^[a-f0-9]{64}$/.test(request.signature)) throw new DomainError("usage_producer_signature_invalid","The usage producer signature is invalid.",401);
    const expected=createHmac("sha256",secret).update(`${request.timestamp}.${JSON.stringify(request.body)}`).digest();
    const supplied=Buffer.from(request.signature,"hex");
    if (supplied.length!==expected.length || !timingSafeEqual(supplied,expected)) throw new DomainError("usage_producer_signature_invalid","The usage producer signature is invalid.",401);
  }
}

export function parseUsageProducerSecrets(value:string):Map<string,Buffer> {
  const parsed=JSON.parse(value) as unknown;
  if (!parsed || typeof parsed!=="object" || Array.isArray(parsed)) throw new Error("USAGE_PRODUCER_SECRETS_JSON must be an object.");
  const result=new Map<string,Buffer>();
  for (const [producerId,encoded] of Object.entries(parsed)) {
    if (!/^[a-z0-9][a-z0-9._-]{2,79}$/.test(producerId) || typeof encoded!=="string") throw new Error("Usage producer identifiers or secrets are invalid.");
    const secret=Buffer.from(encoded,"base64");
    if (secret.length<32) throw new Error(`Usage producer '${producerId}' requires at least 32 bytes of key material.`);
    result.set(producerId,secret);
  }
  return result;
}
