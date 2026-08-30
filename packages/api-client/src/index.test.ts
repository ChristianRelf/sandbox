import { describe, expect, it, vi } from "vitest";
import { SandboxApiClient, SandboxApiCompatibilityError, SandboxApiError } from "./index.js";

function json(body: unknown, status=200, headers: Record<string,string>={}): Response {
  return new Response(JSON.stringify(body),{status,headers:{"content-type":"application/json",...headers}});
}

describe("SandboxApiClient v1 compatibility",()=>{
  it("sends authentication, correlation, JSON and an automatic idempotency key",async()=>{
    const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({credential:{id:"one"}},200,{"x-correlation-id":"server-correlation","idempotency-replayed":"true","x-ratelimit-limit":"240","x-ratelimit-remaining":"239"}));
    const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",accessToken:async()=>"secret-token",fetch,correlationId:()=>"client-correlation",idempotencyKey:()=>"sdk-idempotency-0001"});
    const result=await client.createPersonalAccessToken({name:"CI",scopes:["workflows.run"],organisationId:"org",workspaceIds:["workspace"]});
    const [url,init]=fetch.mock.calls[0];const headers=new Headers(init?.headers);
    expect(String(url)).toBe("https://api.sandbox.test/v1/personal-access-tokens");expect(init?.credentials).toBe("omit");expect(init?.redirect).toBe("error");
    expect(headers.get("authorization")).toBe("Bearer secret-token");expect(headers.get("x-correlation-id")).toBe("client-correlation");expect(headers.get("idempotency-key")).toBe("sdk-idempotency-0001");expect(headers.get("x-sandbox-request-time")).toMatch(/Z$/);
    expect(result).toMatchObject({data:{credential:{id:"one"}},correlationId:"server-correlation",idempotencyReplayed:true,rateLimit:{limit:240,remaining:239}});
  });

  it("preserves structured errors without exposing the bearer token",async()=>{
    const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({error:{code:"permission_denied",message:"Permission denied.",details:{permission:"workflows.run"}},correlationId:"failure-id"},403,{"retry-after":"2"}));
    const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",accessToken:"do-not-leak",fetch,maximumRetries:0});
    await expect(client.request({path:"/v1/account/export"})).rejects.toMatchObject({name:"SandboxApiError",statusCode:403,code:"permission_denied",correlationId:"failure-id",retryAfterSeconds:2} satisfies Partial<SandboxApiError>);
    try{await client.request({path:"/v1/account/export"});}catch(error){expect(String(error)).not.toContain("do-not-leak");}
  });

  it("retries throttled mutations with the same correlation and idempotency keys",async()=>{
    const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({ok:true},200,{"x-correlation-id":"done"})).mockResolvedValueOnce(json({error:{code:"rate_limit_exceeded",message:"Slow down."},correlationId:"rate"},429,{"retry-after":"1"}));
    const sleep=vi.fn(async()=>undefined);const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",fetch,sleep,correlationId:()=>"same-correlation",idempotencyKey:()=>"same-idempotency-001"});
    expect((await client.request({method:"POST",path:"/v1/organisations",body:{name:"Example"}})).data).toEqual({ok:true});
    expect(fetch).toHaveBeenCalledTimes(2);expect(sleep).toHaveBeenCalledWith(1000,undefined);
    const first=new Headers(fetch.mock.calls[0][1]?.headers),second=new Headers(fetch.mock.calls[1][1]?.headers);
    expect(second.get("idempotency-key")).toBe(first.get("idempotency-key"));expect(second.get("x-correlation-id")).toBe(first.get("x-correlation-id"));
  });

  it("rejects contract drift through a caller-supplied response parser",async()=>{
    const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",fetch:async()=>json({status:42},200,{"x-correlation-id":"drift-id"})});
    const parse=(value:unknown)=>{if(!value||typeof value!=="object"||typeof (value as {status?:unknown}).status!=="string")throw new Error("status must be a string");return value as {status:string};};
    await expect(client.health().then(result=>parse(result.data))).rejects.toThrow("status must be a string");
    await expect(client.request({path:"/health",parse})).rejects.toMatchObject({name:"SandboxApiCompatibilityError",correlationId:"drift-id"} satisfies Partial<SandboxApiCompatibilityError>);
  });

  it("encodes query values and rejects paths that could escape the configured origin",async()=>{
    const fetch=vi.fn(async(_input:RequestInfo|URL,_init?:RequestInit)=>json({items:[]}));const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test/root/",fetch});
    await client.listMarketplace({search:"weather & maps",verifiedOnly:true,limit:10});
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.sandbox.test/v1/marketplace/plugins?search=weather+%26+maps&verifiedOnly=true&limit=10");
    await expect(client.request({path:"//attacker.example/v1/account"})).rejects.toThrow(/local/);
    expect(()=>new SandboxApiClient({baseUrl:"http://api.sandbox.test",fetch})).toThrow(/HTTPS/);
    expect(()=>new SandboxApiClient({baseUrl:"https://user:password@api.sandbox.test",fetch})).toThrow(/credentials/);
  });

  it("exposes typed account discovery and encrypted sync routes",async()=>{
    const fetch=vi.fn(async()=>json({items:[]}));
    const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",fetch});
    await client.listAccountOrganisations();
    await client.listSyncedWorkflows("workspace id");
    expect(String(fetch.mock.calls[0][0])).toBe("https://api.sandbox.test/v1/account/organisations");
    expect(String(fetch.mock.calls[1][0])).toBe("https://api.sandbox.test/v1/workspaces/workspace%20id/sync/workflows");
  });
});
