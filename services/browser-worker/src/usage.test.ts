import { createHmac } from "node:crypto";
import { createServer } from "node:http";
import { afterEach,describe,expect,it } from "vitest";
import { HttpUsageReporter } from "./usage.js";

describe("browser usage reporting",()=>{
  const servers:ReturnType<typeof createServer>[]=[];
  afterEach(async()=>{await Promise.all(servers.map(server=>new Promise<void>(resolve=>server.close(()=>resolve()))));servers.length=0;});
  it("submits a signed, retry-stable managed-browser event",async()=>{
    const secret=Buffer.alloc(32,9);let received:{headers:Record<string,string|string[]|undefined>;body:string}|undefined;
    const server=createServer((request,response)=>{const chunks:Buffer[]=[];request.on("data",chunk=>chunks.push(Buffer.from(chunk)));request.on("end",()=>{received={headers:request.headers,body:Buffer.concat(chunks).toString("utf8")};response.writeHead(200,{"content-type":"application/json"});response.end('{"created":true}');});});servers.push(server);
    await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));const address=server.address();if(!address||typeof address==="string")throw new Error("server did not bind");
    const reporter=new HttpUsageReporter(`http://127.0.0.1:${address.port}`,"browser-worker",secret),started=new Date("2026-08-28T10:00:00Z"),ended=new Date("2026-08-28T10:00:04Z");
    await reporter.recordBrowserSeconds({workspaceId:"10000000-0000-4000-8000-000000000001",environmentId:"20000000-0000-4000-8000-000000000002",executionId:"30000000-0000-4000-8000-000000000003",deploymentId:"40000000-0000-4000-8000-000000000004",region:"eu-west-2"},started,ended,4);
    expect(received).toBeDefined();const timestamp=String(received!.headers["x-sandbox-usage-timestamp"]),signature=String(received!.headers["x-sandbox-usage-signature"]),body=JSON.parse(received!.body) as Record<string,unknown>;
    expect(signature).toBe(createHmac("sha256",secret).update(`${timestamp}.${received!.body}`).digest("hex"));
    expect(body).toMatchObject({meter:"managed_browser_seconds",quantity:4,unit:"seconds",idempotencyKey:"managed-browser-usage:30000000-0000-4000-8000-000000000003"});
  });
});
