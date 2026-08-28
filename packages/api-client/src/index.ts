export interface MarketplaceListing {
  pluginId:string; name:string; summary:string; publisher:{publicId:string;publicName:string;verified:boolean}; version:string; packageIntegrity:string;
  categories:string[]; keywords:string[]; pricing:Record<string,unknown>; licence:string; documentationUrl:string; privacyPolicyUrl:string|null; supportUrl:string;
  screenshots:unknown[]; securityNotices:unknown[]; capabilities:unknown[]; networkDomains:Array<{domain?:string;methods?:string[]}>; nodes:Array<{displayName?:string;description?:string}>;
  minimumHostVersion:string; maximumHostVersion:string|null; installCount:number; ratingAverage:number|null; ratingCount:number; updatedAt:string; visibility:string;
}
export class SandboxApiClient {
  constructor(private readonly baseUrl:string,private readonly token?:string){this.baseUrl=baseUrl.replace(/\/$/,"")}
  private async request<T>(path:string,init?:RequestInit):Promise<T>{const response=await fetch(`${this.baseUrl}${path}`,{...init,headers:{accept:"application/json",...(this.token?{authorization:`Bearer ${this.token}`}:{}) ,...init?.headers}});if(!response.ok)throw new Error(`Sandbox API request failed (${response.status})`);return response.json() as Promise<T>}
  marketplace(params:URLSearchParams){return this.request<{items:MarketplaceListing[];nextCursor:string|null}>(`/v1/marketplace/plugins?${params}`)}
  listing(id:string){return this.request<{listing:MarketplaceListing}>(`/v1/marketplace/plugins/${encodeURIComponent(id)}`).then(value=>value.listing)}
}
