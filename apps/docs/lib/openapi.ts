import specification from "../../../docs/api/openapi-v1.json";

type Operation = {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Array<Record<string, string[]>>;
  responses?: Record<string, { description?: string }>;
  [key: `x-${string}`]: unknown;
};

const methods = ["get", "post", "put", "patch", "delete"] as const;

export const apiInfo = specification.info;
export const apiOperations = Object.entries(specification.paths).flatMap(([path, item]) =>
  methods.flatMap(method => {
    const operation = (item as Record<string, Operation>)[method];
    if (!operation) return [];
    return [{
      path,
      method: method.toUpperCase(),
      operationId: operation.operationId ?? `${method}_${path}`,
      summary: operation.summary ?? operation.description ?? "Versioned API operation",
      tag: operation.tags?.[0] ?? "platform",
      authenticated: Boolean(operation.security?.length),
      stable: operation["x-sandbox-stability"] === "stable",
      idempotency: String(operation["x-sandbox-idempotency"] ?? "not supported"),
      responses: Object.keys(operation.responses ?? {}).join(", "),
    }];
  })
);
