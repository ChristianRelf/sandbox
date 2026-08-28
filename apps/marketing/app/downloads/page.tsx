import { loadReleaseManifest } from "../../lib/release-manifest";
import { DownloadsClient } from "./DownloadsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "Downloads", description: "Sandbox desktop and runner downloads with versions, requirements, checksums and signatures." };

export default async function Page() {
  const manifest = await loadReleaseManifest();
  return <main id="content" className="index-page downloads-page"><header><p className="eyebrow"><span/>Downloads</p><h1>Install the right build.<br/>Verify what you run.</h1><p>Download the Windows desktop beta or pair a lightweight Linux runner. Every published file includes a SHA-256 digest and release provenance.</p></header><DownloadsClient manifest={manifest}/></main>;
}
