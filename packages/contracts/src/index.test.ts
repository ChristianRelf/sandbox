import { describe, expect, it } from "vitest";
import { checkRunnerCompatibility, hasPermission, RUNNER_PROTOCOL_VERSION, runnerCommandSchema, runnerHeartbeatSchema, type RunnerIdentity, type RunnerRequirements } from "./index.js";

describe("contracts", () => {
  it("uses explicit permission bundles", () => {
    expect(hasPermission("administrator", "plugins.manage")).toBe(true);
    expect(hasPermission("viewer", "workflows.run")).toBe(false);
  });

  it("rejects incomplete runner commands", () => {
    expect(() => runnerCommandSchema.parse({ commandId: crypto.randomUUID() })).toThrow();
  });

  it("rejects runner protocol messages from another protocol version", () => {
    expect(() => runnerHeartbeatSchema.parse({ protocolVersion: RUNNER_PROTOCOL_VERSION + 1, kind: "heartbeat" })).toThrow();
  });

  it("requires every capability, plugin, connection and placement constraint", () => {
    const identity: RunnerIdentity = {
      runnerId: "11111111-1111-4111-8111-111111111111", keyId: "device-1", runnerType: "hosted", protocolVersion: RUNNER_PROTOCOL_VERSION,
      engineVersion: "0.4.0", pluginRuntimeVersion: "0.4.0", architecture: "x86_64", operatingSystem: "linux", workspaceId: "22222222-2222-4222-8222-222222222222",
      environmentId: "33333333-3333-4333-8333-333333333333", region: "eu-west-2", tags: ["standard"], concurrencyLimit: 4, maintenanceState: "active",
      nodeCapabilities: [{ nodeType: "http_request", nodeVersions: [1], constraints: {} }],
      plugins: [{ pluginId: "com.example.weather", version: "1.2.3", packageIntegrity: `sha256:${"a".repeat(64)}`, nodeVersions: { current_weather: [1] } }],
      connections: [{ connectionId: "44444444-4444-4444-8444-444444444444", environmentId: "33333333-3333-4333-8333-333333333333", operations: ["read"], status: "available" }]
    };
    const requirements: RunnerRequirements = {
      protocolVersion: RUNNER_PROTOCOL_VERSION, engineVersion: "0.4.0", pluginRuntimeVersion: "0.4.0", runnerTypes: ["hosted"], architectures: ["x86_64"], workspaceId: identity.workspaceId,
      environmentId: identity.environmentId, region: "eu-west-2", requiredTags: ["standard"], capabilities: [{ nodeType: "http_request", nodeVersions: [1], constraints: {} }],
      plugins: identity.plugins, connectionIds: [identity.connections[0].connectionId], minimumAvailableConcurrency: 1
    };
    expect(checkRunnerCompatibility(identity, requirements)).toEqual({ compatible: true, reasons: [] });
    const mismatch = checkRunnerCompatibility({ ...identity, connections: [], maintenanceState: "draining" }, requirements);
    expect(mismatch.compatible).toBe(false);
    expect(mismatch.reasons).toEqual(expect.arrayContaining(["Runner is draining.", expect.stringContaining("is unavailable") ]));
  });
});
