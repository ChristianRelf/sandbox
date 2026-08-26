export const PROTOCOL_VERSION = 1;
export const SIDECAR_VERSION = "0.2.0";

export interface SidecarRequest {
  id: string;
  token: string;
  protocolVersion: number;
  operation: string;
  payload: Record<string, unknown>;
}

export interface SidecarResponse {
  id: string;
  protocolVersion: number;
  sidecarVersion: string;
  ok: boolean;
  result?: unknown;
  error?: { code: string; message: string; details?: unknown };
}

export type LocatorKind = "role" | "label" | "placeholder" | "test_id" | "text" | "attribute" | "css" | "xpath";
export interface LocatorCandidate { kind: LocatorKind; value: string; name?: string; exact?: boolean }
export interface StructuredLocator {
  primary: LocatorCandidate;
  alternatives?: LocatorCandidate[];
  elementRole?: string;
  accessibleName?: string;
  tag: string;
  stableAttributes?: Record<string, string>;
  framePath?: string[];
  recordingUrl: string;
  nearbyText?: string;
}

export interface LocatorAttempt {
  kind: string;
  value: string;
  matchCount: number;
  succeeded: boolean;
  weakFallback: boolean;
  error?: string;
}
