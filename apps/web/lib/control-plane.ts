export interface MarketplaceListing {
  pluginId:string; name:string; summary:string; publisher:{publicId:string;publicName:string;verified:boolean}; version:string; packageIntegrity:string;
  categories:string[]; keywords:string[]; pricing:Record<string,unknown>; licence:string; documentationUrl:string; privacyPolicyUrl:string|null; supportUrl:string;
  screenshots:unknown[]; securityNotices:unknown[]; capabilities:unknown[]; networkDomains:Array<{domain?:string;methods?:string[]}>; nodes:Array<{displayName?:string;description?:string}>;
  minimumHostVersion:string; maximumHostVersion:string|null; installCount:number; ratingAverage:number|null; ratingCount:number; updatedAt:string; visibility:string;
}

function apiBase(): string {
  const value = process.env.CONTROL_PLANE_URL ?? process.env.NEXT_PUBLIC_CONTROL_PLANE_URL;
  if (!value) throw new Error("CONTROL_PLANE_URL is required");
  return value.replace(/\/$/, "");
}

export async function marketplace(params: URLSearchParams): Promise<{items:MarketplaceListing[];nextCursor:string|null}> {
  const response = await fetch(`${apiBase()}/v1/marketplace/plugins?${params}`, { next: { revalidate: 60 }, headers: { accept: "application/json" } });
  if (!response.ok) throw new Error(`Marketplace is temporarily unavailable (${response.status})`);
  return response.json();
}

export async function listing(pluginId: string): Promise<MarketplaceListing | null> {
  const response = await fetch(`${apiBase()}/v1/marketplace/plugins/${encodeURIComponent(pluginId)}`, { next: { revalidate: 60 }, headers: { accept: "application/json" } });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Plugin listing is temporarily unavailable (${response.status})`);
  return (await response.json()).listing;
}
