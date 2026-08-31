import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, join, relative } from "node:path";

const options = parseArguments(process.argv.slice(2));
const tag = required(options, "tag");
const version = tag.replace(/^v/, "");
if (!/^\d+\.\d+\.\d+(?:-(?:alpha|beta|rc)\.\d+)?$/.test(version)) throw new Error(`Unsupported release version: ${version}`);

const input = required(options, "input");
const output = required(options, "output");
const repository = required(options, "repository");
const files = (await walk(input)).filter(file => file !== output && basename(file) !== basename(output));
const artifacts = await Promise.all(files.map(async file => {
  const name = basename(file);
  const contents = await readFile(file);
  return {
    ...classify(name),
    name,
    bytes: (await stat(file)).size,
    sha256: createHash("sha256").update(contents).digest("hex"),
    downloadUrl: `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`
  };
}));

artifacts.sort((left, right) => left.name.localeCompare(right.name));
const manifest = {
  schemaVersion: 1,
  product: "sndbox",
  version,
  tag,
  channel: version.includes("-") ? "beta" : "stable",
  source: { repository, commit: options.commit ?? "unknown" },
  artifacts
};
await writeFile(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`Wrote ${relative(process.cwd(), output)} with ${artifacts.length} artifacts.`);

function classify(name) {
  const lower = name.toLowerCase();
  if (lower.endsWith(".exe") || lower.endsWith(".msi")) return { kind: "desktop-installer", platform: "windows", architecture: "x86_64" };
  if (/sandbox-runner-.*-linux-x86_64\.tar\.gz$/.test(lower)) return { kind: "runner-archive", platform: "linux", architecture: "x86_64" };
  if (/sandbox-runner-.*-linux-aarch64\.tar\.gz$/.test(lower)) return { kind: "runner-archive", platform: "linux", architecture: "aarch64" };
  if (lower.includes("sha256sums.sigstore")) return { kind: "signature", platform: "any", architecture: "any" };
  if (lower.includes("sha256sums")) return { kind: "checksum", platform: "any", architecture: "any" };
  if (lower.endsWith(".txt")) return { kind: "container-reference", platform: "linux", architecture: "multi" };
  return { kind: "supporting-file", platform: "any", architecture: "any" };
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map(entry => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? walk(path) : Promise.resolve([path]);
  }))).flat();
}

function parseArguments(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 2) {
    const key = values[index]?.replace(/^--/, "");
    const value = values[index + 1];
    if (!key || !value) throw new Error(`Invalid argument near ${values[index] ?? "end of input"}`);
    parsed[key] = value;
  }
  return parsed;
}

function required(values, key) {
  const value = values[key];
  if (!value) throw new Error(`--${key} is required`);
  return value;
}
