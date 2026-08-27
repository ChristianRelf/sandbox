import { createPrivateKey, sign } from "node:crypto";
import { runnerCommandSchema, type RunnerCommand } from "@sandbox/contracts";

export interface RunnerCommandSigner {
  readonly keyId: string;
  sign(command: Omit<RunnerCommand, "signature" | "status">): string;
}

export function canonicalRunnerCommand(command: Omit<RunnerCommand, "signature" | "status">): Buffer {
  return Buffer.from(JSON.stringify(sortValue(command)), "utf8");
}

export class Ed25519RunnerCommandSigner implements RunnerCommandSigner {
  readonly keyId: string;
  private readonly privateKey;

  constructor(keyId: string, privateKeyPem: string) {
    this.keyId = keyId;
    this.privateKey = createPrivateKey(privateKeyPem);
    if (this.privateKey.asymmetricKeyType !== "ed25519") throw new Error("Runner command signing key must be Ed25519.");
  }

  sign(command: Omit<RunnerCommand, "signature" | "status">): string {
    return sign(null, canonicalRunnerCommand(command), this.privateKey).toString("base64");
  }
}

export function buildSignedRunnerCommand(
  signer: RunnerCommandSigner,
  input: Omit<RunnerCommand, "keyId" | "signature" | "status">
): RunnerCommand {
  const unsigned = { ...input, keyId: signer.keyId };
  return runnerCommandSchema.parse({ ...unsigned, signature: signer.sign(unsigned), status: "queued" });
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortValue(item)]));
  }
  return value;
}
