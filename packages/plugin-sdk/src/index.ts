export * from "./types.js";
export * from "./schema.js";
export * from "./validation.js";
export * from "./mock-host.js";
export * from "./package.js";
export * from "./scaffold.js";
export * from "./docs.js";

import type { NodeDefinition, PluginManifest } from "./types.js";

export function defineNode<I, O, C>(definition: NodeDefinition<I, O, C>): NodeDefinition<I, O, C> {
  return Object.freeze(definition);
}

export function definePlugin(manifest: PluginManifest): PluginManifest {
  return Object.freeze(manifest);
}
