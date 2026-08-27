import { generateKeyPairSync, sign, verify } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildSignedRunnerCommand, canonicalRunnerCommand, canonicalRunnerRequest, Ed25519RunnerCommandSigner, verifyRunnerRequestSignature } from "./runner_protocol.js";

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

  it("authenticates a canonical device request and rejects body tampering", () => {
    const { privateKey, publicKey } = generateKeyPairSync("ed25519");
    const request = { runnerId: "11111111-1111-4111-8111-111111111111", keyId: "device-1", requestTime: "2026-08-27T12:00:00.000Z", nonce: "unique-request-nonce-1", method: "POST", path: "/v1/runner/heartbeat", body: { status: "online", currentWorkload: 0 } };
    const signature = sign(null, canonicalRunnerRequest(request), privateKey).toString("base64");
    const der = publicKey.export({ format: "der", type: "spki" });
    expect(verifyRunnerRequestSignature(request, der, signature)).toBe(true);
    expect(verifyRunnerRequestSignature({ ...request, body: { status: "online", currentWorkload: 1 } }, der, signature)).toBe(false);
  });
});
