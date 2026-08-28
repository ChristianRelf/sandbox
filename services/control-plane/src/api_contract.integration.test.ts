import { randomBytes, randomUUID } from "node:crypto";
import { Pool } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresApiIdempotencyStore } from "./api_contract.js";
import { WebhookProtector } from "./webhook_crypto.js";

const connectionString=process.env.TEST_DATABASE_URL;
const integration=connectionString?describe:describe.skip;

integration("durable API idempotency",()=>{
  const pool=new Pool({connectionString,max:2});
  const store=new PostgresApiIdempotencyStore(pool,new WebhookProtector(randomBytes(32)));
  const scope=`sha256:${randomBytes(32).toString("hex")}`,key=`api-contract-${randomUUID()}`,requestHash=`sha256:${randomBytes(32).toString("hex")}`;
  afterAll(async()=>{await pool.query(`DELETE FROM api_idempotency_records WHERE actor_scope=$1`,[scope]).catch(()=>undefined);await pool.end();});

  it("claims once, encrypts the response, replays it, and rejects payload mutation",async()=>{
    const claim=await store.claim(scope,key,requestHash);
    expect(claim.outcome).toBe("execute");
    if(claim.outcome!=="execute")return;
    const response={statusCode:201,body:{credential:"show-once-secret"},contentType:"application/json",location:"/v1/resources/one"};
    await store.complete(scope,key,claim.ownerToken,response);
    expect(await store.claim(scope,key,requestHash)).toEqual({outcome:"replay",response});
    expect(await store.claim(scope,key,`sha256:${randomBytes(32).toString("hex")}`)).toEqual({outcome:"conflict"});
    const persisted=await pool.query<{ response_ciphertext:Buffer }>(`SELECT response_ciphertext FROM api_idempotency_records WHERE actor_scope=$1 AND idempotency_key=$2`,[scope,key]);
    expect(persisted.rows[0].response_ciphertext.toString("utf8")).not.toContain("show-once-secret");
  });
});
