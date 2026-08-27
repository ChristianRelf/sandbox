import { z } from "zod";
import type { PluginManifest, ValidationResult } from "./types.js";

const identifier = /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/;
const nodeIdentifier = /^[a-z][a-z0-9_.-]{2,127}$/;
const semver = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

const manifestShape = z.object({
  manifestVersion: z.literal(1), pluginId: z.string(), name: z.string().min(1), description: z.string().min(1), version: z.string(), publisherId: z.string(),
  minimumHostVersion: z.string().min(1), maximumHostVersion: z.string().optional(), homepage: z.string().url(), documentation: z.string().url(), supportUrl: z.string().url(),
  licence: z.string().min(1), categories: z.array(z.string()), keywords: z.array(z.string()), icon: z.string(), nodes: z.array(z.any()).min(1), credentials: z.array(z.any()),
  capabilities: z.array(z.any()), networkDomains: z.array(z.any()), storageRequirements: z.object({ temporaryBytes: z.number().int().nonnegative(), persistentBytes: z.number().int().nonnegative(), retentionDays: z.number().int().positive().optional(), isolateByMajorVersion: z.boolean() }),
  migrations: z.array(z.any()), entrypoints: z.array(z.any()).min(1), packageIntegrity: z.string(), signature: z.object({ algorithm: z.literal("ed25519"), keyId: z.string(), value: z.string() }), pricing: z.any(), privacyPolicy: z.string().url().optional()
});

export function validateManifest(value: unknown, requireSignature = false): ValidationResult {
  const parsed = manifestShape.safeParse(value);
  if (!parsed.success) return { valid: false, errors: parsed.error.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`), warnings: [] };
  const manifest = value as PluginManifest;
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!identifier.test(manifest.pluginId)) errors.push("pluginId must be a lowercase reverse-domain identifier.");
  if (!identifier.test(manifest.publisherId)) errors.push("publisherId must be a lowercase reverse-domain identifier.");
  if (!semver.test(manifest.version)) errors.push("version must be semantic versioning.");
  for (const [field, url] of [["homepage", manifest.homepage], ["documentation", manifest.documentation], ["supportUrl", manifest.supportUrl], ["privacyPolicy", manifest.privacyPolicy]] as const) {
    if (url && !url.startsWith("https://")) errors.push(`${field} must use HTTPS.`);
  }
  const entrypoints = new Set(manifest.entrypoints.map(item => item.id));
  const seenNodes = new Set<string>();
  const capabilityKeys = new Set(manifest.capabilities.map(capabilityKey));
  for (const entrypoint of manifest.entrypoints) {
    if (!safePath(entrypoint.path) || !entrypoint.path.endsWith(".wasm")) errors.push(`Entrypoint '${entrypoint.id}' must use a safe .wasm path.`);
  }
  for (const node of manifest.nodes) {
    const key = `${node.nodeType}@${node.nodeVersion}`;
    if (!nodeIdentifier.test(node.nodeType) || node.nodeVersion < 1 || seenNodes.has(key)) errors.push(`Node '${key}' is invalid or duplicated.`);
    seenNodes.add(key);
    if (!entrypoints.has(node.executionEntrypoint)) errors.push(`Node '${node.nodeType}' references an undeclared entrypoint.`);
    for (const capability of node.capabilities) if (!capabilityKeys.has(capability)) errors.push(`Node '${node.nodeType}' references undeclared capability '${capability}'.`);
    if (node.timeoutMs < 100 || node.timeoutMs > 300_000) errors.push(`Node '${node.nodeType}' timeout must be between 100 and 300000 ms.`);
  }
  if (capabilityKeys.has("network") !== (manifest.networkDomains.length > 0)) errors.push("network capability and networkDomains must be declared together.");
  for (const rule of manifest.networkDomains) {
    if (rule.domain !== rule.domain.toLowerCase() || rule.domain.includes(":")) errors.push(`Network domain '${rule.domain}' is invalid.`);
    if (!rule.methods.length) errors.push(`Network domain '${rule.domain}' must declare methods.`);
  }
  if (manifest.storageRequirements.persistentBytes > 100 * 1024 * 1024 || manifest.storageRequirements.temporaryBytes > 100 * 1024 * 1024) errors.push("Storage requirements cannot exceed 100 MB per class.");
  const privacyRequired = capabilityKeys.has("network") || capabilityKeys.has("persistent_storage") || capabilityKeys.has("external_communication") || [...capabilityKeys].some(key => key.startsWith("credential_operations:"));
  if (privacyRequired && !manifest.privacyPolicy?.startsWith("https://")) errors.push("An HTTPS privacyPolicy is required for data-accessing plugins.");
  if (requireSignature) {
    if (!/^sha256:[a-f0-9]{64}$/.test(manifest.packageIntegrity)) errors.push("packageIntegrity must be a SHA-256 digest.");
    if (!manifest.signature.keyId || !manifest.signature.value) errors.push("A complete Ed25519 signature is required.");
  } else if (!manifest.signature.value) warnings.push("Development plugin is unsigned and cannot be marketplace verified.");
  return { valid: errors.length === 0, errors, warnings };
}

export function permissionSummary(manifest: PluginManifest): string[] {
  const permissions: string[] = [];
  for (const capability of manifest.capabilities) {
    if (capability.type === "network") for (const rule of manifest.networkDomains) permissions.push(`Connect to ${rule.domain} using ${rule.methods.map(method => method.toUpperCase()).join(", ")}`);
    if (capability.type === "credential_operations") permissions.push(`Use a selected ${capability.credentialType} connection for ${capability.operations.join(", ")}`);
    if (capability.type === "persistent_storage") permissions.push(`Store up to ${Math.ceil(capability.maxBytes / 1024 / 1024)} MB of isolated plugin data`);
    if (capability.type === "temporary_storage") permissions.push(`Use up to ${Math.ceil(capability.maxBytes / 1024 / 1024)} MB of temporary storage`);
    if (capability.type === "external_communication") permissions.push("Send external messages or actions");
    if (capability.type === "file_picker_read") permissions.push("Read files explicitly selected through the file picker");
  }
  return [...new Set(permissions)].sort();
}

export function permissionDiff(previous: PluginManifest, next: PluginManifest): string[] {
  const before = new Set(permissionSummary(previous));
  return permissionSummary(next).filter(permission => !before.has(permission));
}

function capabilityKey(capability: PluginManifest["capabilities"][number]): string {
  return capability.type === "credential_operations" ? `credential_operations:${capability.credentialType}` : capability.type;
}

export function safePath(value: string): boolean {
  return value.length > 0 && !value.includes("\\") && !value.startsWith("/") && value.split("/").every(part => part !== "" && part !== "." && part !== "..");
}
