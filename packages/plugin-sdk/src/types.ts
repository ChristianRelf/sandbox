export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type JsonSchema = Record<string, unknown>;

export type Capability =
  | { type: "workflow_input" }
  | { type: "structured_logging" }
  | { type: "time" }
  | { type: "random_identifiers" }
  | { type: "cryptography"; operations: string[] }
  | { type: "network" }
  | { type: "credential_operations"; credentialType: string; operations: string[] }
  | { type: "temporary_storage"; maxBytes: number }
  | { type: "persistent_storage"; maxBytes: number }
  | { type: "external_communication" }
  | { type: "file_picker_read"; maxBytes: number };

export interface NetworkDomain {
  domain: string;
  methods: HttpMethod[];
  allowSubdomains?: boolean;
  allowRedirects?: boolean;
}

export interface NodeDefinition<I = unknown, O = unknown, C = unknown> {
  nodeType: string;
  nodeVersion: number;
  displayName: string;
  description: string;
  category: string;
  riskLevel: RiskLevel;
  inputSchema: JsonSchema;
  outputSchema: JsonSchema;
  configurationSchema: JsonSchema;
  credentialRequirements: string[];
  capabilities: string[];
  timeoutMs: number;
  retryBehavior: "none" | "safe" | "idempotency_required";
  idempotencySupport: "none" | "read_only" | "keyed";
  documentation: string;
  migrationHandlers: string[];
  executionEntrypoint: string;
  readonly __input?: I;
  readonly __output?: O;
  readonly __configuration?: C;
}

export interface PluginManifest {
  manifestVersion: 1;
  pluginId: string;
  name: string;
  description: string;
  version: string;
  publisherId: string;
  minimumHostVersion: string;
  maximumHostVersion?: string;
  homepage: string;
  documentation: string;
  supportUrl: string;
  licence: string;
  categories: string[];
  keywords: string[];
  icon: string;
  nodes: NodeDefinition[];
  credentials: Array<{ credentialType: string; displayName: string; operations: string[]; scopes: string[]; configurationSchema: JsonSchema }>;
  capabilities: Capability[];
  networkDomains: NetworkDomain[];
  storageRequirements: { temporaryBytes: number; persistentBytes: number; retentionDays?: number; isolateByMajorVersion: boolean };
  migrations: Array<{ id: string; fromNodeVersion: number; toNodeVersion: number; entrypoint: string }>;
  entrypoints: Array<{ id: string; path: string; export: string }>;
  packageIntegrity: string;
  signature: { algorithm: "ed25519"; keyId: string; value: string };
  pricing:
    | { model: "free" }
    | { model: "one_time" | "subscription" | "workspace_per_user" | "organisation"; currency: string; amountMinor: number; interval?: string };
  privacyPolicy?: string;
}

export type HostRequest =
  | { operation: "http_request"; url: string; method: HttpMethod; headers?: Record<string, string>; bodyBase64?: string; timeoutMs?: number }
  | { operation: "credential_operation"; credentialReference: string; credentialType: string; action: string; input?: unknown }
  | { operation: "log"; level: "debug" | "info" | "warn" | "error"; message: string; fields?: unknown }
  | { operation: "storage_get" | "storage_delete"; key: string; temporary?: boolean }
  | { operation: "storage_put"; key: string; valueBase64: string; temporary?: boolean }
  | { operation: "time" }
  | { operation: "random_identifier" }
  | { operation: "crypto_sha256"; valueBase64: string };

export interface HostResponse<T = unknown> { value: T; diagnostics: string[] }
export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }
