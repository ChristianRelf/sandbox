import type { PluginManifest } from "./types.js";
import { permissionSummary } from "./validation.js";

export function generateDocumentation(manifest: PluginManifest): string {
  return `# ${manifest.name}\n\n${manifest.description}\n\nVersion ${manifest.version} by ${manifest.publisherId}.\n\n## Permissions\n\n${permissionSummary(manifest).map(item => `- ${item}`).join("\n") || "No privileged host capabilities."}\n\n## Nodes\n\n${manifest.nodes.map(node => `### ${node.displayName}\n\n${node.description}\n\n- Type: \`${node.nodeType}@${node.nodeVersion}\`\n- Risk: ${node.riskLevel}\n- Timeout: ${node.timeoutMs} ms\n- Retry: ${node.retryBehavior}\n- Idempotency: ${node.idempotencySupport}`).join("\n\n")}\n\n## Support\n\n- [Documentation](${manifest.documentation})\n- [Support](${manifest.supportUrl})\n`;
}
