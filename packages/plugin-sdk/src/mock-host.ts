import type { HostRequest, HostResponse } from "./types.js";

export type HostHandler = (request: HostRequest) => HostResponse | Promise<HostResponse>;

export class MockHost {
  readonly calls: HostRequest[] = [];
  readonly #handlers = new Map<HostRequest["operation"], HostHandler>();

  on<T extends HostRequest["operation"]>(operation: T, handler: HostHandler): this {
    this.#handlers.set(operation, handler);
    return this;
  }

  async call(request: HostRequest): Promise<HostResponse> {
    this.calls.push(structuredClone(request));
    const handler = this.#handlers.get(request.operation);
    if (!handler) throw new Error(`Mock host has no handler for '${request.operation}'.`);
    const response = await handler(request);
    if (containsSecretLikeField(response.value)) throw new Error("Mock credential response contains secret-like material and would be blocked by the production host.");
    return response;
  }
}

function containsSecretLikeField(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretLikeField);
  if (value && typeof value === "object") return Object.entries(value).some(([key, nested]) => /token|secret|password|authorization|cookie|credential/i.test(key) || containsSecretLikeField(nested));
  return false;
}
