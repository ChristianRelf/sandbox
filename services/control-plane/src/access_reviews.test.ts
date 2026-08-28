import type {Pool,QueryResult} from "pg";
import {describe,expect,it,vi} from "vitest";
import {PostgresServiceAccountAccessReviews} from "./access_reviews.js";

const result=(rows:unknown[]=[],rowCount=rows.length)=>({rows,rowCount,command:"",oid:0,fields:[]}) as QueryResult;

describe("service-account access review sweep",()=>{
  it("opens due reviews and suspends overdue principals while revoking credentials",async()=>{
    const query=vi.fn(async(sql:string)=>{
      if(["BEGIN","COMMIT","ROLLBACK"].includes(sql)||sql.includes("set_config"))return result();
      if(sql.startsWith("SELECT id,organisation_id"))return result([{id:"11111111-1111-4111-8111-111111111111",organisation_id:"22222222-2222-4222-8222-222222222222",name:"Deploy bot",access_review_interval_days:90}]);
      if(sql.startsWith("SELECT workspace_id,role_id"))return result([{workspace_id:"33333333-3333-4333-8333-333333333333",role_id:"44444444-4444-4444-8444-444444444444",environment_ids:[]}]);
      if(sql.startsWith("SELECT account_id"))return result([{account_id:"55555555-5555-4555-8555-555555555555"}]);
      if(sql.startsWith("SELECT id,token_prefix"))return result([]);
      if(sql.startsWith("INSERT INTO service_account_access_reviews"))return result([],1);
      if(sql.includes("SET next_access_review_at"))return result([],1);
      if(sql.startsWith("UPDATE service_account_access_reviews review"))return result([{id:"66666666-6666-4666-8666-666666666666",service_account_id:"11111111-1111-4111-8111-111111111111"}]);
      if(sql.includes("SET status='suspended'"))return result([],1);
      if(sql.includes("revocation_reason='access_review_overdue'"))return result([{id:"77777777-7777-4777-8777-777777777777"}]);
      if(sql.includes("authorization_context->>'credentialId'"))return result([],1);
      throw new Error(`Unexpected query: ${sql}`);
    });
    const pool={connect:async()=>({query,release:()=>undefined})} as unknown as Pool;
    await expect(new PostgresServiceAccountAccessReviews(pool).runOnce(new Date("2026-08-28T12:00:00.000Z"))).resolves.toEqual({opened:1,overdue:1,revokedCredentials:1});
    expect(query).toHaveBeenCalledWith(expect.stringContaining("SET status='suspended'"),expect.any(Array));
    expect(query).toHaveBeenCalledWith(expect.stringContaining("access_review_overdue"),expect.any(Array));
  });
});
