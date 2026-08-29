import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer, getOpenApiDocument, type ApiDependencies } from "../src/server.js";

const unavailable = async () => { throw new Error("Documentation generation must not call runtime dependencies."); };
const repository = new Proxy({}, { get: () => unavailable });
const dependencies = {
  repository,
  sessions: { verify: unavailable },
  email: { sendInvitation: unavailable },
  packageStorage: { createUpload: unavailable, createDownload: unavailable, inspect: unavailable },
  packageScanner: { scan: unavailable },
  webBaseUrl: "https://app.sndbox.app"
} as unknown as ApiDependencies;

const server = await createServer(dependencies);
const serialized = `${JSON.stringify(getOpenApiDocument(server), null, 2)}\n`;
await server.close();
const output = resolve(dirname(fileURLToPath(import.meta.url)), "../../../docs/api/openapi-v1.json");

if (process.argv.includes("--check")) {
  const current = await readFile(output, "utf8").catch(() => "");
  if (current !== serialized) {
    process.stderr.write("docs/api/openapi-v1.json is out of date. Run npm run openapi:generate --workspace @sandbox/control-plane.\n");
    process.exitCode = 1;
  }
} else {
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, serialized, "utf8");
  process.stdout.write(`Wrote ${output}\n`);
}
