import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export interface NetworkDecision {allowed:boolean;reason:string|null;resolvedAddresses:string[]}
export type AddressResolver=(hostname:string)=>Promise<string[]>;

const blockedHostnames=new Set(["localhost","metadata.google.internal","metadata","kubernetes.default","kubernetes.default.svc"]);

export class BrowserNetworkPolicy {
  constructor(private readonly resolver:AddressResolver=resolveAddresses){}
  async inspect(rawUrl:string):Promise<NetworkDecision>{
    let url:URL;
    try{url=new URL(rawUrl);}catch{return{allowed:false,reason:"invalid_url",resolvedAddresses:[]};}
    if(!["http:","https:"].includes(url.protocol))return{allowed:false,reason:"dangerous_url_scheme",resolvedAddresses:[]};
    const hostname=url.hostname.replace(/^\[|\]$/g,"").toLowerCase().replace(/\.$/,"");
    if(blockedHostnames.has(hostname)||hostname.endsWith(".localhost")||hostname.endsWith(".internal"))return{allowed:false,reason:"internal_hostname",resolvedAddresses:[]};
    let addresses:string[];
    try{addresses=await this.resolver(hostname);}catch{return{allowed:false,reason:"dns_resolution_failed",resolvedAddresses:[]};}
    if(!addresses.length)return{allowed:false,reason:"dns_resolution_empty",resolvedAddresses:[]};
    const blocked=addresses.find(isBlockedAddress);
    return blocked?{allowed:false,reason:"private_or_internal_address",resolvedAddresses:addresses}:{allowed:true,reason:null,resolvedAddresses:addresses};
  }
}

async function resolveAddresses(hostname:string):Promise<string[]>{if(isIP(hostname))return[hostname];return[...new Set((await lookup(hostname,{all:true,verbatim:true})).map(item=>item.address))];}
export function isBlockedAddress(address:string):boolean{
  const normalized=address.toLowerCase().split("%")[0];
  if(normalized.startsWith("::ffff:"))return isBlockedAddress(normalized.slice(7));
  if(isIP(normalized)===4){const parts=normalized.split(".").map(Number),[a,b]=parts;return a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||(a===198&&(b===18||b===19));}
  if(isIP(normalized)===6)return normalized==="::"||normalized==="::1"||normalized.startsWith("fc")||normalized.startsWith("fd")||/^fe[89ab]/.test(normalized);
  return true;
}
