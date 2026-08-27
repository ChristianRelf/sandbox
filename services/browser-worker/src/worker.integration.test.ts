import { createServer } from "node:http";
import { mkdtemp,rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll,beforeAll,describe,expect,it } from "vitest";
import { ManagedBrowserWorker,type BrowserExecution, type NetworkPolicy } from "./worker.js";

describe("browser workload lifecycle",()=>{
  const server=createServer((request,response)=>{if(request.url==="/set")response.setHeader("Set-Cookie","workspace_secret=one; Path=/");response.setHeader("Content-Type","text/html");response.end(`<body>${request.headers.cookie??"none"}</body>`);});
  let origin="",artifactRoot="";
  const testPolicy:NetworkPolicy={inspect:async()=>({allowed:true,reason:null,resolvedAddresses:["127.0.0.1"]})};
  beforeAll(async()=>{artifactRoot=await mkdtemp(path.join(tmpdir(),"sandbox-browser-test-artifacts-"));await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw new Error("Test server did not bind.");origin=`http://127.0.0.1:${address.port}`;});
  afterAll(async()=>{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));await rm(artifactRoot,{recursive:true,force:true});});
  const execution=(id:string,steps:BrowserExecution["steps"]):BrowserExecution=>({executionId:id,workspaceId:"20000000-0000-4000-8000-000000000002",profile:null,steps,maximumArtifactBytes:1024*1024,allowedUploadRoots:[]});
  it("uses separate contexts and destroys both execution sandboxes",async()=>{const worker=new ManagedBrowserWorker(testPolicy);const first=await worker.execute(execution("first",[{type:"navigate",url:`${origin}/set`},{type:"navigate",url:`${origin}/read`},{type:"extract",selector:"body"}]));const second=await worker.execute(execution("second",[{type:"navigate",url:`${origin}/read`},{type:"extract",selector:"body"}]));expect(first.outputs).toEqual([["workspace_secret=one"]]);expect(second.outputs).toEqual([["none"]]);expect(first.sandboxDestroyed).toBe(true);expect(second.sandboxDestroyed).toBe(true);});
  it("destroys the sandbox when policy rejects navigation",async()=>{const worker=new ManagedBrowserWorker();await expect(worker.execute(execution("blocked",[{type:"navigate",url:"http://169.254.169.254/latest/meta-data"}]))).rejects.toThrow(/blocked/i);});
});
