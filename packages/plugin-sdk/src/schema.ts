import type { JsonSchema } from "./types.js";

export const schema = {
  string: (options: { title?: string; description?: string; format?: string; minLength?: number; maxLength?: number; default?: string } = {}): JsonSchema => ({ type: "string", ...options }),
  number: (options: { title?: string; description?: string; minimum?: number; maximum?: number; default?: number } = {}): JsonSchema => ({ type: "number", ...options }),
  integer: (options: { title?: string; description?: string; minimum?: number; maximum?: number; default?: number } = {}): JsonSchema => ({ type: "integer", ...options }),
  boolean: (options: { title?: string; description?: string; default?: boolean } = {}): JsonSchema => ({ type: "boolean", ...options }),
  enum: <T extends string>(values: readonly T[], options: { title?: string; description?: string; default?: T } = {}): JsonSchema => ({ type: "string", enum: [...values], ...options }),
  array: (items: JsonSchema, options: { title?: string; description?: string; minItems?: number; maxItems?: number } = {}): JsonSchema => ({ type: "array", items, ...options }),
  object: (properties: Record<string, JsonSchema>, options: { title?: string; description?: string; required?: string[]; additionalProperties?: boolean } = {}): JsonSchema => ({ type: "object", properties, additionalProperties: false, ...options })
};
