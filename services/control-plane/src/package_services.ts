export interface PackageObjectMetadata {
  size: number;
  sha256: string;
  immutable: boolean;
}

export interface ImmutablePackageStorage {
  createUpload(objectKey: string, size: number, sha256: string): Promise<{ uploadUrl: string; expiresAt: string }>;
  createDownload(objectKey: string): Promise<{ downloadUrl: string; expiresAt: string }>;
  inspect(objectKey: string): Promise<PackageObjectMetadata>;
}

export interface PackageScanResult {
  passed: boolean;
  manifestValid: boolean;
  signatureValid: boolean;
  integrityValid: boolean;
  declaredContentsOnly: boolean;
  malwareScan: "clean" | "blocked" | "error";
  capabilityFindings: string[];
  networkFindings: string[];
  dependencyInventory: Array<Record<string, unknown>>;
  behaviourTests: Array<{ name: string; passed: boolean; detail?: string }>;
  reproducibility: Record<string, unknown>;
  rejectionReasons: string[];
}

export interface PackageReviewScanner {
  scan(objectKey: string, expectedIntegrity: string, publisherPublicId: string, publisherKeyId: string): Promise<PackageScanResult>;
}

export class HttpImmutablePackageStorage implements ImmutablePackageStorage {
  constructor(private readonly baseUrl: string, private readonly bearerToken: string) {}
  async createUpload(objectKey: string, size: number, sha256: string) {
    return this.request<{ uploadUrl: string; expiresAt: string }>("/v1/uploads", { objectKey, size, sha256, immutable: true, expiresInSeconds: 900 });
  }
  async inspect(objectKey: string) {
    return this.request<PackageObjectMetadata>("/v1/objects/inspect", { objectKey });
  }
  async createDownload(objectKey: string) {
    return this.request<{ downloadUrl: string; expiresAt: string }>("/v1/downloads", { objectKey, expiresInSeconds: 300 });
  }
  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}${path}`, { method: "POST", headers: { authorization: `Bearer ${this.bearerToken}`, "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new Error(`Immutable object storage request failed with HTTP ${response.status}`);
    return response.json() as Promise<T>;
  }
}

export class HttpPackageReviewScanner implements PackageReviewScanner {
  constructor(private readonly baseUrl: string, private readonly bearerToken: string) {}
  async scan(objectKey: string, expectedIntegrity: string, publisherPublicId: string, publisherKeyId: string): Promise<PackageScanResult> {
    const response = await fetch(`${this.baseUrl.replace(/\/$/, "")}/v1/scans`, { method: "POST", headers: { authorization: `Bearer ${this.bearerToken}`, "content-type": "application/json" }, body: JSON.stringify({ objectKey, expectedIntegrity, publisherPublicId, publisherKeyId, runtime: "sandbox-plugin-runtime-0.3" }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Package security scanner failed with HTTP ${response.status}`);
    return response.json() as Promise<PackageScanResult>;
  }
}
