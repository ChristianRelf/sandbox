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

  it("fails release publication closed unless every artifact is signed and attested", () => {
    const workflow = read(".github/workflows/release.yml");
    expect(workflow).toContain('tags: ["v*.*.*"]');
    expect(workflow).toContain("Release tags must use the exact vMAJOR.MINOR.PATCH form.");
    expect(workflow).toContain("WINDOWS_CERTIFICATE_PASSWORD");
    expect(workflow).toContain("Get-AuthenticodeSignature");
    expect(workflow).toContain('if ($signature.Status -ne "Valid")');
    expect(workflow.match(/actions\/attest@[a-f0-9]{40}/g)).toHaveLength(3);
    expect(workflow).toContain("cosign verify-blob");
    expect(workflow).toContain("cosign sign --yes");
    expect(workflow).toContain("cosign verify\n");
    expect(workflow).toContain("provenance: mode=max");
    expect(workflow).toContain("sbom: true");
    expect(workflow).toContain("agents/server/Dockerfile");
    expect(workflow).toContain("services/hosted-runner/Dockerfile");
    expect(workflow).toContain("services/browser-worker/Dockerfile");
    expect(workflow).toContain("needs: [verify-release, desktop-windows, agent-linux, containers]");
    expect(workflow).not.toMatch(/uses: [^\n]+@(v\d+|stable|main)\s*$/m);

    const agentRelease = read("agents/server/packaging/build-release.sh");
    expect(agentRelease).toContain('RELEASE_SIGNING_REQUIRED:-0');
    expect(agentRelease).toContain("cosign is required for a production release.");
    expect(agentRelease).toContain("test -s SHA256SUMS.sigstore.json");
    expect(read("agents/server/Dockerfile")).toContain("COPY src-tauri/engine src-tauri/engine");
    expect(read("agents/server/Dockerfile")).toContain("USER nonroot:nonroot");
  });
});

function read(file: string): string {
  return readFileSync(resolve(root, file), "utf8");
}
