import catalogue from "../../../generated/nodes.json";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Node reference",
  description: "Generated reference for built-in Sandbox workflow nodes.",
  openGraph: { images: [] },
  twitter: { images: [] },
};

export default function NodeReferencePage() {
  const groups = Object.groupBy(catalogue.nodes, node => node.category);
  return <main id="doc" className="doc-page"><article>
    <header><div><span className="version">Generated from {catalogue.generatedFrom}</span></div><h1>Built-in node reference</h1><p>Configuration defaults, risk labels and runner support are generated from the real desktop node catalogue.</p></header>
    {Object.entries(groups).map(([category, nodes]) => <section key={category}><h2>{category}</h2>{nodes?.map(node => <article className="api-operation" key={node.type}><h3>{node.name} <code>{node.type}</code></h3><p>{node.description}</p><dl><div><dt>Version</dt><dd>{node.version}</dd></div><div><dt>Risk</dt><dd>{node.risk}</dd></div><div><dt>Runners</dt><dd>{node.supportedRunners.join(", ")}</dd></div><div><dt>Defaults</dt><dd><code>{JSON.stringify(node.configurationDefaults)}</code></dd></div></dl></article>)}</section>)}
  </article></main>;
}
