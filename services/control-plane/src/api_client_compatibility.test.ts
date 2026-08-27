import { SandboxApiClient } from "@sandbox/api-client";
import { describe, expect, it, vi } from "vitest";
import { MemoryApiIdempotencyStore } from "./api_contract.js";
import { createServer, type ApiDependencies } from "./server.js";
import type { AuthenticatedSession, ControlPlaneRepository } from "./types.js";

const session:AuthenticatedSession={accountId:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",subject:"identity|sdk",email:"sdk@example.com",issuedAt:new Date(),expiresAt:new Date(Date.now()+60_000),authenticationMethods:["passkey"],platformPermissions:[]};
type OpenApiOperation={parameters:Array<{$ref?:string}>;responses:Record<string,unknown>};
type OpenApiContract={paths:Record<string,Record<string,OpenApiOperation>>;components:{schemas:Record<string,unknown>}};

describe("published v1 client compatibility",()=>{
  it("executes and replays a typed credential mutation against the real server",async()=>{
    const issued={id:"33333333-3333-4333-8333-333333333333",name:"CI",prefix:"sbx_pat_abcdefghijkl",token:"sbx_pat_abcdefghijkl.secret",scopes:["workflows.run"],organisationId:"44444444-4444-4444-8444-444444444444",workspaceIds:["55555555-5555-4555-8555-555555555555"],environmentIds:[],createdAt:new Date().toISOString(),expiresAt:new Date(Date.now()+86_400_000).toISOString()};
    const issuePersonalToken=vi.fn(async()=>issued);
    const server=await createServer(dependencies({issuePersonalToken}));
    const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",accessToken:"test-token",fetch:injectFetch(server),correlationId:()=>"sdk-server-compatibility",idempotencyKey:()=>"sdk-server-replay-0001"});
    const input={name:"CI",scopes:["workflows.run"],organisationId:issued.organisationId,workspaceIds:issued.workspaceIds,expiresInDays:1};
    const first=await client.createPersonalAccessToken(input);const replay=await client.createPersonalAccessToken(input);
    expect(first.data.credential.token).toBe(issued.token);expect(first.correlationId).toBe("sdk-server-compatibility");
    expect(replay.data).toEqual(first.data);expect(replay.idempotencyReplayed).toBe(true);expect(issuePersonalToken).toHaveBeenCalledTimes(1);
    await server.close();
  });

  it("exposes SDK transport headers and promoted credential schemas in OpenAPI",async()=>{
    const server=await createServer(dependencies({issuePersonalToken:vi.fn()}));const client=new SandboxApiClient({baseUrl:"https://api.sandbox.test",fetch:injectFetch(server)});
    const contract=(await client.request<Record<string,unknown>>({path:"/v1/openapi.json"})).data as OpenApiContract;
    const operation=contract.paths["/v1/personal-access-tokens"].post;
    expect(operation.parameters).toEqual(expect.arrayContaining([{$ref:"#/components/parameters/CorrelationId"},{$ref:"#/components/parameters/IdempotencyKey"}]));
    expect(operation.responses["200"]).toMatchObject({content:{"application/json":{schema:{$ref:"#/components/schemas/IssuedCredentialEnvelope"}}}});
    expect(contract.components.schemas).toHaveProperty("PersonalAccessTokenInput");expect(contract.components.schemas).toHaveProperty("ServiceAccount");
    await server.close();
  });
});

function dependencies(credentialService:{issuePersonalToken:ReturnType<typeof vi.fn>}):ApiDependencies{
  const unavailable=vi.fn(async()=>undefined);
  const repository=new Proxy({permissions:vi.fn(async()=>new Set())},{get:(target,key)=>key in target?target[key as keyof typeof target]:unavailable}) as unknown as ControlPlaneRepository;
  return {repository,sessions:{verify:vi.fn(async()=>session)},credentialService:{...credentialService,createServiceAccount:unavailable,listServiceAccounts:unavailable,issueServiceAccountToken:unavailable,listPersonalTokens:unavailable,revokeToken:unavailable},email:{sendInvitation:unavailable},packageStorage:{createUpload:unavailable,createDownload:unavailable,inspect:unavailable},packageScanner:{scan:unavailable},idempotencyStore:new MemoryApiIdempotencyStore(),webBaseUrl:"https://app.sandbox.test"} as unknown as ApiDependencies;
}

function injectFetch(server:Awaited<ReturnType<typeof createServer>>):typeof globalThis.fetch{
  return async(input,init)=>{
    const url=new URL(input instanceof Request?input.url:String(input));const headers:Record<string,string>={};
    new Headers(init?.headers).forEach((value,key)=>{headers[key]=value;});
    const response=await server.inject({method:(init?.method??"GET") as "GET",url:`${url.pathname}${url.search}`,headers,payload:typeof init?.body==="string"?init.body:undefined});
    const responseHeaders=new Headers();for(const [key,value] of Object.entries(response.headers)){if(Array.isArray(value))for(const item of value)responseHeaders.append(key,item);else if(value!==undefined)responseHeaders.set(key,String(value));}
    return new Response(response.body,{status:response.statusCode,headers:responseHeaders});
  };
}
