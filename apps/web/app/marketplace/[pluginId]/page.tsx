import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowLeft,
  BadgeCheck,
  Box,
  ExternalLink,
  LockKeyhole,
  Network,
  ShieldCheck,
} from "lucide-react";
import { notFound } from "next/navigation";
import { listing } from "../../../lib/control-plane";

type Params = Promise<{ pluginId: string }>;
export async function generateMetadata({
  params,
}: {
  params: Params;
}): Promise<Metadata> {
  const { pluginId } = await params;
  const plugin = await listing(pluginId);
  if (!plugin) return { title: "Plugin not found" };
  return {
    title: plugin.name,
    description: plugin.summary,
    openGraph: {
      title: `${plugin.name} · Sandbox`,
      description: plugin.summary,
      images: [],
    },
    twitter: {
      title: `${plugin.name} · Sandbox`,
      description: plugin.summary,
      images: [],
    },
  };
}
export default async function PluginPage({ params }: { params: Params }) {
  const { pluginId } = await params;
  const plugin = await listing(pluginId);
  if (!plugin) notFound();
  return (
    <main className="detail">
      <Link href="/marketplace" className="back">
        <ArrowLeft size={14} />
        Marketplace
      </Link>
      <section className="detail-head">
        <span className="detail-icon">
          <Box size={28} />
        </span>
        <div>
          <div className="eyebrow">{plugin.categories.join(" · ")}</div>
          <h1>{plugin.name}</h1>
          <p className="publisher">
            By {plugin.publisher.publicName}
            {plugin.publisher.verified && (
              <>
                <BadgeCheck size={14} />
                Verified publisher
              </>
            )}
          </p>
        </div>
        <aside>
          <b>{plugin.pricing.model === "free" ? "Free" : "Paid plugin"}</b>
          <span>Version {plugin.version}</span>
          <span>
            Compatible {plugin.minimumHostVersion}
            {plugin.maximumHostVersion ? ` · ${plugin.maximumHostVersion}` : ""}
          </span>
          <p className="action-note">
            Install and approve this exact version from the Sandbox desktop marketplace.
          </p>
        </aside>
      </section>
      <p className="detail-summary">{plugin.summary}</p>
      {plugin.securityNotices.length > 0 && (
        <div className="security-notice">
          This listing has {plugin.securityNotices.length} security notice
          {plugin.securityNotices.length === 1 ? "" : "s"}. Review before
          installation.
        </div>
      )}
      <div className="detail-columns">
        <section>
          <h2>Included nodes</h2>
          <div className="node-list">
            {plugin.nodes.map((node, index) => (
              <div key={index}>
                <Box size={15} />
                <div>
                  <b>{node.displayName ?? "Plugin node"}</b>
                  <p>{node.description ?? "See plugin documentation."}</p>
                </div>
              </div>
            ))}
          </div>
          <h2>Package identity</h2>
          <dl>
            <dt>Exact version</dt>
            <dd>{plugin.version}</dd>
            <dt>Integrity</dt>
            <dd>
              <code>{plugin.packageIntegrity}</code>
            </dd>
            <dt>Licence</dt>
            <dd>{plugin.licence}</dd>
            <dt>Last reviewed</dt>
            <dd>
              {new Date(plugin.updatedAt).toLocaleDateString("en-GB", {
                dateStyle: "long",
              })}
            </dd>
          </dl>
        </section>
        <aside className="permissions">
          <h2>Permissions</h2>
          <p>Generated from the signed manifest, not publisher prose.</p>
          <div>
            <ShieldCheck size={16} />
            <span>Runs inside the restricted Wasm sandbox</span>
          </div>
          {plugin.networkDomains.map((domain, index) => (
            <div key={index}>
              <Network size={16} />
              <span>
                Connect to <code>{domain.domain ?? "declared domain"}</code>{" "}
                using {(domain.methods ?? []).join(", ").toUpperCase()}
              </span>
            </div>
          ))}
          <div>
            <LockKeyhole size={16} />
            <span>
              Installs disabled; enablement requires explicit approval
            </span>
          </div>
          <a href={plugin.documentationUrl}>
            Documentation <ExternalLink size={12} />
          </a>
          <a href={plugin.supportUrl}>
            Publisher support <ExternalLink size={12} />
          </a>
          {plugin.privacyPolicyUrl && (
            <a href={plugin.privacyPolicyUrl}>
              Privacy policy <ExternalLink size={12} />
            </a>
          )}
        </aside>
      </div>
    </main>
  );
}
