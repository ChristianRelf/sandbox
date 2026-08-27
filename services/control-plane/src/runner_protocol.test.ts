import { generateKeyPairSync, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignedRunnerCommand, canonicalRunnerCommand, Ed25519RunnerCommandSigner } from "./runner_protocol.js";

describe("runner command protocol", () => {
  it("signs a stable canonical command and detects mutation", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const signer = new Ed25519RunnerCommandSigner("control-plane-1", privateKey.export({ format: "pem", type: "pkcs8" }).toString());
    const command = buildSignedRunnerCommand(signer, {
      commandId: "11111111-1111-4111-8111-111111111111", issuerAccountId: "22222222-2222-4222-8222-222222222222", workspaceId: "33333333-3333-4333-8333-333333333333", targetRunnerId: "44444444-4444-4444-8444-444444444444",
      action: "run_workflow", workflowRevisionId: "55555555-5555-4555-8555-555555555555", createdAt: "2026-08-27T12:00:00.000Z", expiresAt: "2026-08-27T12:05:00.000Z", idempotencyKey: "runner-command-0001", payload: { z: 1, a: { second: 2, first: 1 } }
    });
    const { signature, status: _status, ...unsigned } = command;
    expect(verify(null, canonicalRunnerCommand(unsigned), publicKey, Buffer.from(signature, "base64"))).toBe(true);
    expect(verify(null, canonicalRunnerCommand({ ...unsigned, action: "pause_workflow" }), publicKey, Buffer.from(signature, "base64"))).toBe(false);
  });
});
