export type HttpMethod = "get" | "post" | "put" | "patch" | "delete" | "head";
export type RiskLevel = "low" | "medium" | "high" | "critical";
export type JsonSchema = Record<string, unknown>;
export type NodeKind = "action" | "polling_trigger";
export type NodePlacement = "desktop" | "self_hosted";
export type ExternalEffect = "read" | "external_write" | "destructive_or_high_impact";
export type PortValueType = "any" | "string" | "number" | "boolean" | "object" | "array" | "path" | "connection";

export interface NodePort {
  key: string;
  label: string;
  type: PortValueType;
  required?: boolean;
  description?: string;
  sensitive?: boolean;
}

export interface ConnectionRequirement {
  reference: string;
  provider: string;
  permissions: string[];
  required: boolean;
}

export interface FileInputDefinition {
  key: string;
  required: boolean;
  maximumBytes?: number;
  acceptedMimeTypes?: string[];
}

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
  /** Manifest v2 fields. They are optional on v1 packages for wire compatibility. */
  kind?: NodeKind;
  inputPorts?: NodePort[];
  outputPorts?: NodePort[];
  connectionRequirements?: ConnectionRequirement[];
  fileInputs?: FileInputDefinition[];
  placements?: NodePlacement[];
  externalEffect?: ExternalEffect;
  readonly __input?: I;
  readonly __output?: O;
  readonly __configuration?: C;
}

export interface PluginManifest {
  manifestVersion: 1 | 2;
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
  | { operation: "provider_request"; connectionReference: string; provider: string; action: string; arguments?: unknown; fileGrants?: string[] }
  | { operation: "log"; level: "debug" | "info" | "warn" | "error"; message: string; fields?: unknown }
  | { operation: "storage_get" | "storage_delete"; key: string; temporary?: boolean }
  | { operation: "storage_put"; key: string; valueBase64: string; temporary?: boolean }
  | { operation: "time" }
  | { operation: "random_identifier" }
  | { operation: "crypto_sha256"; valueBase64: string };

export interface HostResponse<T = unknown> { value: T; diagnostics: string[] }
export interface ValidationResult { valid: boolean; errors: string[]; warnings: string[] }

export interface ExecutionMetadata { executionId: string; workflowId: string; nodeId: string; idempotencyKey: string }
export interface ActionInvocationV2 { kind: "action"; nodeType: string; configuration: unknown; input: unknown; connectionReferences: Record<string, string>; fileGrants: string[]; execution: ExecutionMetadata }
export interface PollInvocationV2 { kind: "poll"; nodeType: string; configuration: unknown; connectionReferences: Record<string, string>; cursor?: unknown; window: { startedAt: string; endedAt: string; maximumPages: number }; execution: ExecutionMetadata }
export interface ActionResultV2<T = unknown> { kind: "action"; output: T; providerMetadata?: Record<string, unknown> }
export interface PollResultV2<T = unknown> { kind: "poll"; events: T[]; nextCursor: unknown; hasMore: boolean; checkpoint?: Record<string, unknown> }
