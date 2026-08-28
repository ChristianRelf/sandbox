import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { NODE_DEFINITIONS } from "../src/catalogue";

const output = resolve(import.meta.dirname, "../apps/docs/generated/nodes.json");
const nodes = NODE_DEFINITIONS.map(node => ({
  type: node.type,
  name: node.name,
  description: node.description,
  category: node.group,
  version: 1,
  configurationDefaults: node.defaults,
  risk: ["run_command", "gmail_send_email", "upload_file"].includes(node.type) ? "high" : ["http_request", "move_file", "download_file"].includes(node.type) ? "medium" : "low",
  supportedRunners: node.group === "Browser" ? ["desktop", "managed-browser"] : node.group === "System" ? ["desktop", "self-hosted"] : ["desktop", "hosted", "self-hosted"],
}));

mkdirSync(resolve(output, ".."), { recursive: true });
writeFileSync(output, `${JSON.stringify({ generatedFrom: "src/catalogue.ts", nodes }, null, 2)}\n`);
