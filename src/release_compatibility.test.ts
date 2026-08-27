import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { RUNNER_PROTOCOL_VERSION } from "@sandbox/contracts";

const root = resolve(import.meta.dirname, "..");
const releaseVersion = "0.5.0";

describe("v0.5 release compatibility", () => {
  it("keeps product package and crate metadata on the documented release", () => {
    const packages = [
      "package.json",
      "apps/web/package.json",
      "browser-sidecar/package.json",
      "packages/api-client/package.json",
      "packages/contracts/package.json",
      "packages/plugin-sdk/package.json",
      "services/browser-worker/package.json",
      "services/control-plane/package.json",
      "services/scheduler/package.json"
    ];
    for (const file of packages) {
      expect(JSON.parse(read(file)).version, file).toBe(releaseVersion);
    }

    const crates = [
      "agents/server/Cargo.toml",
      "services/hosted-runner/Cargo.toml",
      "src-tauri/Cargo.toml",
      "src-tauri/engine/Cargo.toml",
      "src-tauri/plugin-runtime/Cargo.toml"
    ];
    for (const file of crates) {
      expect(read(file), file).toMatch(/^version = "0\.5\.0"$/m);
    }
    expect(JSON.parse(read("src-tauri/tauri.conf.json")).version).toBe(releaseVersion);
  });

  it("keeps runtime constants and the published matrix aligned", () => {
    expect(RUNNER_PROTOCOL_VERSION).toBe(2);
    expect(read("agents/server/src/lib.rs")).toContain('pub const RUNNER_PROTOCOL_VERSION: u16 = 2;');
    expect(read("agents/server/src/lib.rs")).toContain('pub const ENGINE_VERSION: &str = "0.5.0";');
    expect(read("agents/server/src/lib.rs")).toContain('pub const PLUGIN_RUNTIME_VERSION: &str = "0.5.0";');
    expect(read("src-tauri/plugin-runtime/src/lib.rs")).toContain('pub const HOST_VERSION: &str = "0.5.0";');
    const matrix = read("docs/support-matrix-v0.5.md");
    expect(matrix).toContain("runner protocol 2");
    expect(matrix).toContain("Node.js 20 or later");
    expect(matrix).toContain("PostgreSQL 16");
    expect(matrix).toContain('`minimumHostVersion: ">=0.5.0"`');
  });
});

function read(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}
