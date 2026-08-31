import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PluginManifest } from "./types.js";

export interface ScaffoldOptions { pluginId: string; name: string; publisherId: string }

export async function scaffold(directory: string, options: ScaffoldOptions): Promise<void> {
  await mkdir(path.join(directory, "guest", "src"), { recursive: true });
  await mkdir(path.join(directory, "components"), { recursive: true });
  await mkdir(path.join(directory, "assets"), { recursive: true });
  await mkdir(path.join(directory, "docs"), { recursive: true });
  const manifest: PluginManifest = {
    manifestVersion: 1, pluginId: options.pluginId, name: options.name, description: `${options.name} integration`, version: "0.1.0", publisherId: options.publisherId,
    minimumHostVersion: ">=0.5.0", homepage: "https://example.com", documentation: "https://example.com/docs", supportUrl: "https://example.com/support", licence: "MIT",
    categories: ["developer-tools"], keywords: [], icon: "assets/icon.svg",
    nodes: [{ nodeType: "example.echo", nodeVersion: 1, displayName: "Echo", description: "Returns typed input.", category: "Data", riskLevel: "low", inputSchema: { type: "object" }, outputSchema: { type: "object" }, configurationSchema: { type: "object", properties: {}, additionalProperties: false }, credentialRequirements: [], capabilities: ["workflow_input", "structured_logging"], timeoutMs: 10_000, retryBehavior: "safe", idempotencySupport: "read_only", documentation: "docs/echo.md", migrationHandlers: [], executionEntrypoint: "main" }],
    credentials: [], capabilities: [{ type: "workflow_input" }, { type: "structured_logging" }], networkDomains: [], storageRequirements: { temporaryBytes: 0, persistentBytes: 0, isolateByMajorVersion: false }, migrations: [],
    entrypoints: [{ id: "main", path: "components/main.wasm", export: "execute" }], packageIntegrity: "", signature: { algorithm: "ed25519", keyId: "", value: "" }, pricing: { model: "free" }
  };
  await writeFile(path.join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(directory, "guest", "Cargo.toml"), cargoToml(options.pluginId));
  await writeFile(path.join(directory, "guest", "src", "lib.rs"), rustGuest);
  await writeFile(path.join(directory, "assets", "icon.svg"), icon);
  await writeFile(path.join(directory, "docs", "echo.md"), "# Echo\n\nReturns the JSON input using the production sndbox JSON ABI.\n");
  await writeFile(path.join(directory, "README.md"), `# ${options.name}\n\nBuild with \`sandbox plugin dev .\`. The development package still uses the production sandbox and requires permission approval.\n`);
}

function cargoToml(pluginId: string): string {
  const name = pluginId.replace(/[^a-z0-9]+/g, "-");
  return `[package]\nname = "${name}-guest"\nversion = "0.1.0"\nedition = "2021"\n\n[lib]\ncrate-type = ["cdylib"]\n\n[dependencies]\nserde_json = "1"\n\n[profile.release]\nopt-level = "s"\nlto = true\npanic = "abort"\nstrip = true\n`;
}

const rustGuest = `use serde_json::{json, Value};

#[no_mangle]
pub extern "C" fn alloc(length: i32) -> i32 {
    let mut value = Vec::<u8>::with_capacity(length.max(0) as usize);
    let pointer = value.as_mut_ptr();
    std::mem::forget(value);
    pointer as i32
}

#[no_mangle]
pub unsafe extern "C" fn execute(pointer: i32, length: i32) -> i64 {
    let input = std::slice::from_raw_parts(pointer as *const u8, length.max(0) as usize);
    let value: Value = serde_json::from_slice(input).unwrap_or_else(|_| json!({"error":"invalid input"}));
    return_json(json!({"echo":value}))
}

fn return_json(value: Value) -> i64 {
    let mut output = serde_json::to_vec(&value).unwrap_or_else(|_| b"null".to_vec());
    let pointer = output.as_mut_ptr() as u32;
    let length = output.len() as u32;
    std::mem::forget(output);
    ((pointer as i64) << 32) | length as i64
}
`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="#18181b"/><path d="M18 32h28M32 18v28" stroke="#fafafa" stroke-width="6" stroke-linecap="round"/></svg>\n`;
