import { createHmac } from "node:crypto";
import { describe,expect,it } from "vitest";
import { HmacUsageProducerAuthenticator,parseUsageProducerSecrets } from "./usage_producer.js";

describe("trusted usage producer authentication",()=>{
  const secret=Buffer.alloc(32,7),producerId="hosted-runner";
  const authenticator=new HmacUsageProducerAuthenticator(new Map([[producerId,secret]]));
  const signed=(body:unknown,timestamp=Math.floor(Date.now()/1000).toString())=>({producerId,timestamp,body,signature:createHmac("sha256",secret).update(`${timestamp}.${JSON.stringify(body)}`).digest("hex")});
  it("accepts a fresh payload-bound signature",()=>expect(()=>authenticator.verify(signed({executionId:"execution",quantity:4}))).not.toThrow());
  it("rejects tampering, unknown producers, and stale requests",()=>{
    const request=signed({quantity:4});
    expect(()=>authenticator.verify({...request,body:{quantity:5}})).toThrow(/signature/i);
    expect(()=>authenticator.verify({...request,producerId:"unknown"})).toThrow(/trusted/i);
    expect(()=>authenticator.verify(signed({quantity:4},"1"))).toThrow(/timestamp/i);
  });
  it("requires named keys with at least 256 bits",()=>{
    expect(parseUsageProducerSecrets(JSON.stringify({"browser-worker":secret.toString("base64")})).get("browser-worker")).toEqual(secret);
    expect(()=>parseUsageProducerSecrets(JSON.stringify({worker:Buffer.alloc(8).toString("base64")}))).toThrow(/32 bytes/i);
  });
});
