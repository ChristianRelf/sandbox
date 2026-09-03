import type { Pool,PoolClient } from "pg";
import { describe,expect,it,vi } from "vitest";
import { PostgresReferralProgram,normalizeReferralCode,referralPolicy } from "./referrals.js";
import type { AuthenticatedSession } from "./types.js";

const actor:AuthenticatedSession={accountId:"11111111-1111-4111-8111-111111111111",sessionId:"22222222-2222-4222-8222-222222222222",subject:"identity|one",email:"one@example.com",issuedAt:new Date(),expiresAt:new Date(Date.now()+60_000),authenticationMethods:["passkey"],platformPermissions:[]};

describe("referral program",()=>{
  it("normalises bounded codes and rejects unsafe values",()=>{
    expect(normalizeReferralCode(" ABCDEF123456 ")).toBe("abcdef123456");
    expect(()=>normalizeReferralCode("../not-a-code")).toThrow(/12 to 24/);
  });

  it("rejects self-referrals before creating an attribution",async()=>{
    const{pool,query}=transactionalPool(async(sql)=>{
      if(sql.startsWith("SELECT created_at"))return result([{created_at:new Date()}]);
      if(sql.includes("FROM referral_codes"))return result([{id:"33333333-3333-4333-8333-333333333333",account_id:actor.accountId}]);
      return result([]);
    });
    const service=new PostgresReferralProgram(pool);
    await expect(service.claim(actor,"abcdef123456")).rejects.toMatchObject({code:"referral_self_claim"});
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT INTO account_referrals"))).toBe(false);
    expect(query).toHaveBeenCalledWith("ROLLBACK");
  });

  it("closes attribution after the new-account claim window",async()=>{
    const{pool,query}=transactionalPool(async(sql)=>sql.startsWith("SELECT created_at")?result([{created_at:new Date(Date.now()-(referralPolicy.claimWindowDays+1)*86_400_000)}]):result([]));
    await expect(new PostgresReferralProgram(pool).claim(actor,"abcdef123456")).rejects.toMatchObject({code:"referral_claim_window_closed"});
    expect(query.mock.calls.some(([sql])=>String(sql).includes("FROM referral_codes"))).toBe(false);
  });

  it("rejects referral cycles before attribution",async()=>{
    const{pool,query}=transactionalPool(async(sql)=>{
      if(sql.startsWith("SELECT created_at"))return result([{created_at:new Date()}]);
      if(sql.includes("FROM referral_codes"))return result([{id:"33333333-3333-4333-8333-333333333333",account_id:"44444444-4444-4444-8444-444444444444"}]);
      if(sql.startsWith("WITH RECURSIVE"))return result([{exists:1}]);
      return result([]);
    });
    await expect(new PostgresReferralProgram(pool).claim(actor,"abcdef123456")).rejects.toMatchObject({code:"referral_cycle"});
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT INTO account_referrals"))).toBe(false);
  });

  it("keeps duplicate claims for the same code idempotent",async()=>{
    const codeId="33333333-3333-4333-8333-333333333333";
    const{pool,query}=transactionalPool(async(sql)=>{
      if(sql.startsWith("SELECT created_at"))return result([{created_at:new Date()}]);
      if(sql.includes("FROM referral_codes"))return result([{id:codeId,account_id:"44444444-4444-4444-8444-444444444444"}]);
      if(sql.startsWith("WITH RECURSIVE"))return result([]);
      if(sql.startsWith("SELECT referral_code_id"))return result([{referral_code_id:codeId}]);
      return result([]);
    });
    await expect(new PostgresReferralProgram(pool).claim(actor,"abcdef123456")).resolves.toEqual({claimed:true,status:"pending"});
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT INTO account_referrals"))).toBe(false);
    expect(query).toHaveBeenCalledWith("COMMIT");
  });

  it("credits both wallets once after a qualifying top-up",async()=>{
    const referrer="11111111-1111-4111-8111-111111111111",referred="22222222-2222-4222-8222-222222222222";
    let wallet=0,entry=0;
    const query=vi.fn(async(sql:string,params?:unknown[])=>{
      if(sql.includes("FROM account_referrals WHERE referred_account_id"))return result([{id:"33333333-3333-4333-8333-333333333333",referrer_account_id:referrer,referred_account_id:referred}]);
      if(sql.startsWith("SELECT count(*)"))return result([{count:"0"}]);
      if(sql.startsWith("SELECT id,balance_microusd"))return result([{id:`wallet-${++wallet}`,balance_microusd:"1000000"}]);
      if(sql.startsWith("INSERT INTO prepaid_wallet_entries"))return result([{id:`entry-${++entry}`}]);
      return result([]);
    });
    const service=new PostgresReferralProgram({} as Pool);
    await service.qualifyTopUp({query} as unknown as PoolClient,referred,referralPolicy.qualifyingTopUpCents,"pi_paid");
    const adjustments=query.mock.calls.filter(([sql])=>String(sql).startsWith("INSERT INTO prepaid_wallet_entries"));
    expect(adjustments).toHaveLength(2);
    expect(adjustments.every(([,params])=>(params as unknown[])[1]===String(referralPolicy.rewardMicros))).toBe(true);
    expect(query.mock.calls.some(([sql,params])=>String(sql).startsWith("UPDATE account_referrals SET status='rewarded'")&&(params as unknown[])[0]==="pi_paid")).toBe(true);
  });

  it("enforces the rolling reward cap without crediting a wallet",async()=>{
    const query=vi.fn(async(sql:string,_params?:unknown[])=>{
      if(sql.includes("FROM account_referrals WHERE referred_account_id"))return result([{id:"33333333-3333-4333-8333-333333333333",referrer_account_id:actor.accountId,referred_account_id:"44444444-4444-4444-8444-444444444444"}]);
      if(sql.startsWith("SELECT count(*)"))return result([{count:String(referralPolicy.maximumRewardsPerRollingYear)}]);
      return result([]);
    });
    await new PostgresReferralProgram({} as Pool).qualifyTopUp({query} as unknown as PoolClient,"44444444-4444-4444-8444-444444444444",1_000,"pi_cap");
    expect(query.mock.calls.some(([sql])=>String(sql).includes("status='ineligible'"))).toBe(true);
    expect(query.mock.calls.some(([sql])=>String(sql).startsWith("INSERT INTO prepaid_wallet_entries"))).toBe(false);
  });

  it("reverses both rewards when a refund drops below the threshold",async()=>{
    let wallet=0,entry=0;
    const query=vi.fn(async(sql:string,_params?:unknown[])=>{
      if(sql.startsWith("SELECT id FROM account_referrals"))return result([{id:"33333333-3333-4333-8333-333333333333"}]);
      if(sql.startsWith("SELECT id,beneficiary_account_id"))return result([{id:"reward-a",beneficiary_account_id:"11111111-1111-4111-8111-111111111111",amount_microusd:"5000000"},{id:"reward-b",beneficiary_account_id:"22222222-2222-4222-8222-222222222222",amount_microusd:"5000000"}]);
      if(sql.startsWith("SELECT id,balance_microusd"))return result([{id:`wallet-${++wallet}`,balance_microusd:"7000000"}]);
      if(sql.startsWith("INSERT INTO prepaid_wallet_entries"))return result([{id:`reversal-${++entry}`}]);
      return result([]);
    });
    await new PostgresReferralProgram({} as Pool).reverseTopUp({query} as unknown as PoolClient,"pi_refunded",999);
    const reversals=query.mock.calls.filter(([sql])=>String(sql).startsWith("INSERT INTO prepaid_wallet_entries"));
    expect(reversals).toHaveLength(2);
    expect(reversals.every(([,params])=>(params as unknown[])[1]==="-5000000")).toBe(true);
    expect(query.mock.calls.some(([sql])=>String(sql).includes("status='reversed'"))).toBe(true);
  });
});

function transactionalPool(handler:(sql:string,params?:unknown[])=>Promise<ReturnType<typeof result>>){
  const query=vi.fn(async(sql:string,params?:unknown[])=>["BEGIN","COMMIT","ROLLBACK"].includes(sql)?result([]):handler(sql,params));
  const client={query,release:vi.fn()};
  return{query,pool:{connect:vi.fn(async()=>client)} as unknown as Pool};
}
function result<T>(rows:T[]){return{rows,rowCount:rows.length,command:"",oid:0,fields:[]};}
