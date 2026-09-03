import { randomBytes } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import type { AuthenticatedSession } from "./types.js";
import { DomainError } from "./types.js";

export const referralPolicy = {
  claimWindowDays: 7,
  qualifyingTopUpCents: 1_000,
  rewardMicros: 5_000_000,
  maximumRewardsPerRollingYear: 50,
} as const;

export type ReferralStatus = "pending" | "rewarded" | "reversed" | "ineligible";

export interface ReferralSummary {
  code: string;
  shareUrl: string;
  policy: typeof referralPolicy;
  stats: { invited: number; pending: number; rewarded: number; earnedMicros: number };
  claim: { status: ReferralStatus; claimedAt: string; rewardedAt: string | null; reversedAt: string | null } | null;
  referrals: Array<{ id: string; status: ReferralStatus; claimedAt: string; rewardedAt: string | null; reversedAt: string | null }>;
}

export interface ReferralAdministration {
  accountSummary(actor: AuthenticatedSession, webBaseUrl: string): Promise<ReferralSummary>;
  claim(actor: AuthenticatedSession, code: string): Promise<{ claimed: true; status: "pending" }>;
}

export interface ReferralSettlement {
  qualifyTopUp(client: PoolClient, accountId: string, amountCents: number, paymentRef: string): Promise<void>;
  reverseTopUp(client: PoolClient, paymentRef: string, remainingPaidCents: number): Promise<void>;
}

export class PostgresReferralProgram implements ReferralAdministration, ReferralSettlement {
  constructor(private readonly pool: Pool) {}

  async accountSummary(actor: AuthenticatedSession, webBaseUrl: string): Promise<ReferralSummary> {
    const code = await this.ensureCode(actor.accountId);
    const counts = await this.pool.query<{ invited:string;pending:string;rewarded:string;earned_micros:string }>(
      `SELECT count(*)::text AS invited,
              count(*) FILTER (WHERE referral.status='pending')::text AS pending,
              count(*) FILTER (WHERE referral.status='rewarded')::text AS rewarded,
              COALESCE((SELECT sum(reward.amount_microusd) FROM referral_rewards reward WHERE reward.beneficiary_account_id=$1 AND reward.reversed_at IS NULL),0)::text AS earned_micros
         FROM account_referrals referral
        WHERE referral.referrer_account_id=$1`,
      [actor.accountId]
    );
    const referrals = await this.pool.query<{id:string;status:ReferralStatus;claimed_at:Date;rewarded_at:Date|null;reversed_at:Date|null}>(
      `SELECT id,status,claimed_at,rewarded_at,reversed_at
         FROM account_referrals
        WHERE referrer_account_id=$1
        ORDER BY claimed_at DESC,id DESC
        LIMIT 100`,
      [actor.accountId]
    );
    const claimed = await this.pool.query<{status:ReferralStatus;claimed_at:Date;rewarded_at:Date|null;reversed_at:Date|null}>(
      `SELECT status,claimed_at,rewarded_at,reversed_at FROM account_referrals WHERE referred_account_id=$1`,[actor.accountId]
    );
    const row=counts.rows[0]??{invited:"0",pending:"0",rewarded:"0",earned_micros:"0"};
    const claim=claimed.rows[0];
    return {
      code,
      shareUrl:`${webBaseUrl.replace(/\/$/,"")}/r/${code}`,
      policy:referralPolicy,
      stats:{invited:safeNumber(row.invited),pending:safeNumber(row.pending),rewarded:safeNumber(row.rewarded),earnedMicros:safeNumber(row.earned_micros)},
      claim:claim?{status:claim.status,claimedAt:claim.claimed_at.toISOString(),rewardedAt:claim.rewarded_at?.toISOString()??null,reversedAt:claim.reversed_at?.toISOString()??null}:null,
      referrals:referrals.rows.map(referral=>({id:referral.id,status:referral.status,claimedAt:referral.claimed_at.toISOString(),rewardedAt:referral.rewarded_at?.toISOString()??null,reversedAt:referral.reversed_at?.toISOString()??null})),
    };
  }

  async claim(actor: AuthenticatedSession, suppliedCode: string): Promise<{ claimed: true; status: "pending" }> {
    const code=normalizeReferralCode(suppliedCode);
    return this.transaction(async client=>{
      const account=await client.query<{created_at:Date}>(`SELECT created_at FROM accounts WHERE id=$1 AND deleted_at IS NULL FOR SHARE`,[actor.accountId]);
      if(!account.rowCount)throw new DomainError("account_not_found","The referred account was not found.",404);
      if(account.rows[0].created_at.getTime()<Date.now()-referralPolicy.claimWindowDays*86_400_000)throw new DomainError("referral_claim_window_closed",`Referral codes must be claimed within ${referralPolicy.claimWindowDays} days of creating the account.`,409);
      const referralCode=await client.query<{id:string;account_id:string}>(
        `SELECT code.id,code.account_id FROM referral_codes code JOIN accounts account ON account.id=code.account_id WHERE code.code=$1 AND account.deleted_at IS NULL FOR SHARE`,[code]
      );
      if(!referralCode.rowCount)throw new DomainError("referral_code_invalid","This referral link is invalid or no longer available.",404);
      const referrer=referralCode.rows[0];
      if(referrer.account_id===actor.accountId)throw new DomainError("referral_self_claim","An account cannot claim its own referral code.",409);
      const cycle=await client.query(
        `WITH RECURSIVE ancestry(account_id) AS (
           SELECT $1::uuid
           UNION
           SELECT referral.referrer_account_id FROM account_referrals referral JOIN ancestry ON referral.referred_account_id=ancestry.account_id
         ) SELECT 1 FROM ancestry WHERE account_id=$2 LIMIT 1`,
        [referrer.account_id,actor.accountId]
      );
      if(cycle.rowCount)throw new DomainError("referral_cycle","Referral relationships cannot form a cycle.",409);
      const existing=await client.query<{referral_code_id:string}>(`SELECT referral_code_id FROM account_referrals WHERE referred_account_id=$1 FOR SHARE`,[actor.accountId]);
      if(existing.rowCount){
        if(existing.rows[0].referral_code_id!==referrer.id)throw new DomainError("referral_already_claimed","This account has already claimed a different referral.",409);
        return{claimed:true,status:"pending"};
      }
      const inserted=await client.query<{referral_code_id:string}>(
        `INSERT INTO account_referrals(referral_code_id,referrer_account_id,referred_account_id) VALUES($1,$2,$3) ON CONFLICT(referred_account_id) DO NOTHING RETURNING referral_code_id`,
        [referrer.id,referrer.account_id,actor.accountId]
      );
      if(!inserted.rowCount){
        const winner=await client.query<{referral_code_id:string}>(`SELECT referral_code_id FROM account_referrals WHERE referred_account_id=$1`,[actor.accountId]);
        if(winner.rows[0]?.referral_code_id!==referrer.id)throw new DomainError("referral_already_claimed","This account has already claimed a different referral.",409);
      }
      return{claimed:true,status:"pending"};
    });
  }

  async qualifyTopUp(client: PoolClient, accountId: string, amountCents: number, paymentRef: string): Promise<void> {
    if(amountCents<referralPolicy.qualifyingTopUpCents)return;
    const result=await client.query<{id:string;referrer_account_id:string;referred_account_id:string}>(
      `SELECT id,referrer_account_id,referred_account_id FROM account_referrals WHERE referred_account_id=$1 AND status='pending' FOR UPDATE`,[accountId]
    );
    const referral=result.rows[0];
    if(!referral)return;
    const annual=await client.query<{count:string}>(
      `SELECT count(*)::text FROM account_referrals WHERE referrer_account_id=$1 AND status='rewarded' AND rewarded_at>=now()-interval '365 days'`,[referral.referrer_account_id]
    );
    if(BigInt(annual.rows[0]?.count??"0")>=BigInt(referralPolicy.maximumRewardsPerRollingYear)){
      await client.query(`UPDATE account_referrals SET status='ineligible',qualified_at=now(),qualifying_payment_ref=$1,ineligible_reason='referrer_reward_limit' WHERE id=$2`,[paymentRef,referral.id]);
      return;
    }
    for(const beneficiary of [referral.referrer_account_id,referral.referred_account_id].sort()){
      await client.query(`INSERT INTO prepaid_wallets(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`,[beneficiary]);
      const wallet=await client.query<{id:string;balance_microusd:string}>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1 FOR UPDATE`,[beneficiary]);
      const row=wallet.rows[0];
      if(!row)throw new DomainError("referral_wallet_unavailable","A referral reward wallet could not be created.",503);
      const balance=BigInt(row.balance_microusd)+BigInt(referralPolicy.rewardMicros);
      await client.query(`UPDATE prepaid_wallets SET balance_microusd=$1,updated_at=now() WHERE id=$2`,[balance.toString(),row.id]);
      const entry=await client.query<{id:string}>(
        `INSERT INTO prepaid_wallet_entries(wallet_id,kind,amount_microusd,balance_after_microusd,description,idempotency_key) VALUES($1,'adjustment',$2,$3,'Referral reward',$4) RETURNING id`,
        [row.id,String(referralPolicy.rewardMicros),balance.toString(),`referral:${referral.id}:${beneficiary}`]
      );
      await client.query(`INSERT INTO referral_rewards(referral_id,beneficiary_account_id,amount_microusd,wallet_entry_id) VALUES($1,$2,$3,$4)`,[referral.id,beneficiary,referralPolicy.rewardMicros,entry.rows[0].id]);
    }
    await client.query(`UPDATE account_referrals SET status='rewarded',qualified_at=now(),rewarded_at=now(),qualifying_payment_ref=$1 WHERE id=$2`,[paymentRef,referral.id]);
  }

  async reverseTopUp(client: PoolClient, paymentRef: string, remainingPaidCents: number): Promise<void> {
    if(remainingPaidCents>=referralPolicy.qualifyingTopUpCents)return;
    const found=await client.query<{id:string}>(`SELECT id FROM account_referrals WHERE qualifying_payment_ref=$1 AND status='rewarded' FOR UPDATE`,[paymentRef]);
    const referral=found.rows[0];
    if(!referral)return;
    const rewards=await client.query<{id:string;beneficiary_account_id:string;amount_microusd:string}>(
      `SELECT id,beneficiary_account_id,amount_microusd::text FROM referral_rewards WHERE referral_id=$1 AND reversed_at IS NULL ORDER BY beneficiary_account_id FOR UPDATE`,[referral.id]
    );
    for(const reward of rewards.rows){
      const wallet=await client.query<{id:string;balance_microusd:string}>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1 FOR UPDATE`,[reward.beneficiary_account_id]);
      const row=wallet.rows[0];
      if(!row)throw new DomainError("referral_wallet_unavailable","A referral reward wallet could not be reversed.",503);
      const balance=BigInt(row.balance_microusd)-BigInt(reward.amount_microusd);
      await client.query(`UPDATE prepaid_wallets SET balance_microusd=$1,updated_at=now() WHERE id=$2`,[balance.toString(),row.id]);
      const entry=await client.query<{id:string}>(
        `INSERT INTO prepaid_wallet_entries(wallet_id,kind,amount_microusd,balance_after_microusd,description,idempotency_key) VALUES($1,'adjustment',$2,$3,'Referral reward reversal',$4) RETURNING id`,
        [row.id,(-BigInt(reward.amount_microusd)).toString(),balance.toString(),`referral-reversal:${referral.id}:${reward.beneficiary_account_id}`]
      );
      await client.query(`UPDATE referral_rewards SET reversed_at=now(),reversal_wallet_entry_id=$1 WHERE id=$2`,[entry.rows[0].id,reward.id]);
    }
    await client.query(`UPDATE account_referrals SET status='reversed',reversed_at=now() WHERE id=$1`,[referral.id]);
  }

  private async ensureCode(accountId:string):Promise<string>{
    const existing=await this.pool.query<{code:string}>(`SELECT code FROM referral_codes WHERE account_id=$1`,[accountId]);
    if(existing.rows[0])return existing.rows[0].code;
    for(let attempt=0;attempt<5;attempt+=1){
      const code=randomBytes(8).toString("hex");
      try{
        const inserted=await this.pool.query<{code:string}>(`INSERT INTO referral_codes(account_id,code) VALUES($1,$2) ON CONFLICT(account_id) DO UPDATE SET account_id=excluded.account_id RETURNING code`,[accountId,code]);
        if(inserted.rows[0])return inserted.rows[0].code;
      }catch(error){if((error as {code?:string}).code!=="23505")throw error;}
    }
    throw new DomainError("referral_code_unavailable","A unique referral code could not be created.",503);
  }

  private async transaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T>{
    const client=await this.pool.connect();
    try{await client.query("BEGIN");const result=await operation(client);await client.query("COMMIT");return result;}
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }
}

export function normalizeReferralCode(value:string):string{
  const code=value.trim().toLowerCase();
  if(!/^[a-z0-9]{12,24}$/.test(code))throw new DomainError("referral_code_invalid","Referral codes contain 12 to 24 letters or numbers.",400);
  return code;
}

function safeNumber(value:string):number{const parsed=BigInt(value);if(parsed>BigInt(Number.MAX_SAFE_INTEGER)||parsed<BigInt(Number.MIN_SAFE_INTEGER))throw new DomainError("referral_value_overflow","Referral totals exceed the supported range.",500);return Number(parsed);}
