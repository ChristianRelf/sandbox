import type { Metadata } from "next";
import { apiInfo, apiOperations } from "../../../../lib/openapi";
import { groupBy } from "../../../../lib/group-by";

export const metadata: Metadata = {
  title: "API reference",
  description: "Generated reference for the versioned sndbox control-plane v1 beta API.",
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function ApiReferencePage() {
  const groups = groupBy(apiOperations, operation => operation.tag);
  return <main id="doc" className="doc-page"><article>
    <header><div><span className="version">Generated from OpenAPI {apiInfo.version}</span></div><h1>{apiInfo.title}</h1><p>{apiInfo.description}</p></header>
    <section><h2>Contract status</h2><p>This beta reference is generated from <code>docs/api/openapi-v1.json</code>, the same validated contract used by the control-plane compatibility tests and typed client. Operations explicitly marked stable are additive within v1.</p></section>
    {Array.from(groups, ([tag, operations]) => <section key={tag}>
      <h2>{tag}</h2>
      <div className="api-operations">{operations.map(operation => <article className="api-operation" key={operation.operationId}>
        <h3><code>{operation.method}</code> <code>{operation.path}</code></h3>
        <p>{operation.summary}</p>
        <dl><div><dt>Authentication</dt><dd>{operation.authenticated ? "Bearer token" : "Public"}</dd></div><div><dt>Stability</dt><dd>{operation.stable ? "Stable" : "Preview"}</dd></div><div><dt>Idempotency</dt><dd>{operation.idempotency}</dd></div><div><dt>Responses</dt><dd>{operation.responses}</dd></div></dl>
      </article>)}</div>
    </section>)}
  </article></main>;
}
