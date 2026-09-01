import { createHash, createPrivateKey, sign as cryptoSign } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { unzipSync } from "fflate";
import type { PluginManifest } from "./types.js";
import { safePath, validateManifest } from "./validation.js";

const encoder = new TextEncoder();

export interface PackageInspection {
  manifest: PluginManifest;
  files: string[];
  validation: ReturnType<typeof validateManifest>;
}

export async function readManifest(directory: string): Promise<PluginManifest> {
  return JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")) as PluginManifest;
}

export async function packageFiles(directory: string): Promise<Map<string, Uint8Array>> {
  const files = new Map<string, Uint8Array>();
  for (const root of ["components", "assets", "docs", "migrations", "locales", "examples"]) {
    const absolute = path.join(directory, root);
    if (!(await exists(absolute))) continue;
    await walk(directory, absolute, files);
  }
  return new Map([...files.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

export function canonicalManifest(manifest: PluginManifest): Uint8Array {
  const unsigned: PluginManifest = structuredClone(manifest);
  unsigned.packageIntegrity = "";
  unsigned.signature = { algorithm: "ed25519", keyId: "", value: "" };
  for (const node of unsigned.nodes) {
    for (const port of [...(node.inputPorts ?? []), ...(node.outputPorts ?? [])]) {
      if (port.required === false) delete port.required;
      if (port.sensitive === false) delete port.sensitive;
    }
    for (const requirement of node.connectionRequirements ?? []) {
      if (requirement.required === false) delete (requirement as { required?: boolean }).required;
      if (!requirement.permissions.length) delete (requirement as { permissions?: string[] }).permissions;
    }
    for (const file of node.fileInputs ?? []) {
      if (file.required === false) delete (file as { required?: boolean }).required;
      if (!file.acceptedMimeTypes?.length) delete file.acceptedMimeTypes;
    }
    if (unsigned.manifestVersion === 1) {
      delete node.kind; delete node.inputPorts; delete node.outputPorts; delete node.connectionRequirements; delete node.fileInputs; delete node.placements; delete node.externalEffect;
    } else {
      node.inputPorts ??= []; node.outputPorts ??= []; node.connectionRequirements ??= []; node.fileInputs ??= []; node.placements ??= [];
    }
  }
  return encoder.encode(JSON.stringify(sortValue(unsigned)));
}

export function packageDigest(manifest: PluginManifest, files: ReadonlyMap<string, Uint8Array>): Buffer {
  const hash = createHash("sha256");
  hash.update(Buffer.from("SANDBOX-PLUGIN-PACKAGE-V1\0"));
  addDigestEntry(hash, "manifest.json", canonicalManifest(manifest));
  for (const [name, contents] of [...files.entries()].sort(([left], [right]) => left.localeCompare(right))) addDigestEntry(hash, name, contents);
  return hash.digest();
}

export async function packDirectory(directory: string, outputFile: string): Promise<{ outputFile: string; manifest: PluginManifest }> {
  const manifest = await readManifest(directory);
  const validation = validateManifest(manifest, false);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const files = await packageFiles(directory);
  validateContents(manifest, files);
  const archive = writeStoredZip(new Map<string, Uint8Array>([["manifest.json", encoder.encode(JSON.stringify(sortValue(manifest), null, 2))], ...files]));
  await writeFile(outputFile, archive);
  return { outputFile, manifest };
}

export async function signDirectory(directory: string, privateKeyFile: string, keyId: string, outputFile: string): Promise<{ outputFile: string; manifest: PluginManifest }> {
  const manifest = await readManifest(directory);
  manifest.packageIntegrity = "";
  manifest.signature = { algorithm: "ed25519", keyId: "", value: "" };
  const validation = validateManifest(manifest, false);
  if (!validation.valid) throw new Error(validation.errors.join("\n"));
  const files = await packageFiles(directory);
  validateContents(manifest, files);
  const digest = packageDigest(manifest, files);
  const privateKey = createPrivateKey(await readFile(privateKeyFile, "utf8"));
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Signing key must be Ed25519.");
  manifest.packageIntegrity = `sha256:${digest.toString("hex")}`;
  manifest.signature = { algorithm: "ed25519", keyId, value: cryptoSign(null, digest, privateKey).toString("base64") };
  const signedValidation = validateManifest(manifest, true);
  if (!signedValidation.valid) throw new Error(signedValidation.errors.join("\n"));
  const archive = writeStoredZip(new Map<string, Uint8Array>([["manifest.json", encoder.encode(JSON.stringify(sortValue(manifest), null, 2))], ...files]));
  await writeFile(outputFile, archive);
  return { outputFile, manifest };
}

export async function inspectPackage(file: string): Promise<PackageInspection> {
  const archive = unzipSync(new Uint8Array(await readFile(file)));
  const names = Object.keys(archive).sort();
  const rawManifest = archive["manifest.json"];
  if (!rawManifest) throw new Error("Package has no manifest.json.");
  const manifest = JSON.parse(new TextDecoder().decode(rawManifest)) as PluginManifest;
  return { manifest, files: names, validation: validateManifest(manifest, true) };
}

export function writeStoredZip(entries: ReadonlyMap<string, Uint8Array>): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const [name, value] of [...entries.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!safePath(name)) throw new Error(`Unsafe ZIP path '${name}'.`);
    const filename = Buffer.from(name, "utf8");
    const contents = Buffer.from(value);
    const checksum = crc32(contents);
    const local = Buffer.alloc(30 + filename.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10); local.writeUInt16LE(0x21, 12); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(contents.length, 18); local.writeUInt32LE(contents.length, 22);
    local.writeUInt16LE(filename.length, 26); local.writeUInt16LE(0, 28); filename.copy(local, 30);
    localParts.push(local, contents);
    const central = Buffer.alloc(46 + filename.length);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8); central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12); central.writeUInt16LE(0x21, 14); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(contents.length, 20); central.writeUInt32LE(contents.length, 24);
    central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(0, 30); central.writeUInt16LE(0, 32); central.writeUInt16LE(0, 34); central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38); central.writeUInt32LE(offset, 42); filename.copy(central, 46);
    centralParts.push(central);
    offset += local.length + contents.length;
  }
  const central = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.size, 8); end.writeUInt16LE(entries.size, 10);
  end.writeUInt32LE(central.length, 12); end.writeUInt32LE(offset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, central, end]);
}

function validateContents(manifest: PluginManifest, files: ReadonlyMap<string, Uint8Array>): void {
  const wasm = new Set(manifest.entrypoints.map(entrypoint => entrypoint.path));
  for (const entrypoint of wasm) if (!files.has(entrypoint)) throw new Error(`Declared entrypoint '${entrypoint}' is missing.`);
  if (!files.has(manifest.icon)) throw new Error(`Declared icon '${manifest.icon}' is missing.`);
  for (const name of files.keys()) {
    if (wasm.has(name) || name === manifest.icon) continue;
    const extension = path.posix.extname(name).slice(1).toLowerCase();
    const allowed = extension === "md" ? name.startsWith("docs/") || name.startsWith("examples/")
      : extension === "json" ? name.startsWith("migrations/") || name.startsWith("locales/") || name.startsWith("examples/")
      : ["png", "jpg", "jpeg", "webp", "svg"].includes(extension) && name.startsWith("assets/");
    if (!allowed) throw new Error(`Package contains undeclared executable or unsupported content '${name}'.`);
  }
}

async function walk(root: string, directory: string, output: Map<string, Uint8Array>): Promise<void> {
  for (const entry of (await readdir(directory, { withFileTypes: true })).sort((left, right) => left.name.localeCompare(right.name))) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) await walk(root, absolute, output);
    else if (entry.isFile()) {
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      if (!safePath(relative)) throw new Error(`Unsafe package path '${relative}'.`);
      if ((await stat(absolute)).size > 16 * 1024 * 1024) throw new Error(`Package file '${relative}' exceeds 16 MB.`);
      output.set(relative, new Uint8Array(await readFile(absolute)));
    }
  }
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, nested]) => [key, sortValue(nested)]));
  return value;
}

function addDigestEntry(hash: ReturnType<typeof createHash>, name: string, contents: Uint8Array): void {
  const nameBytes = Buffer.from(name, "utf8");
  const nameLength = Buffer.alloc(8); nameLength.writeBigUInt64BE(BigInt(nameBytes.length));
  const contentLength = Buffer.alloc(8); contentLength.writeBigUInt64BE(BigInt(contents.length));
  hash.update(nameLength); hash.update(nameBytes); hash.update(contentLength); hash.update(contents);
}

function crc32(value: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of value) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

async function exists(value: string): Promise<boolean> {
  try { await stat(value); return true; } catch { return false; }
}
