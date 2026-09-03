import type { Pool, PoolClient } from "pg";
import type { BillingEvent, BillingProvider } from "./billing.js";
import type { AuthenticatedSession } from "./types.js";
import { DomainError } from "./types.js";
import type { ReferralSettlement } from "./referrals.js";

const MICROS_PER_CENT = 10_000n;
const BYTES_PER_GIB = 1_073_741_824n;
const SECONDS_PER_THIRTY_DAY_MONTH = 2_592_000n;

export const prepaidRateCard = {
  currency: "usd" as const,
  minimumComputeSeconds: 60,
  hostedRunnerMicrosPerMinute: 5_000,
  managedBrowserMicrosPerMinute: 10_000,
  networkEgressMicrosPerGib: 200_000,
  artifactStorageMicrosPerGibMonth: 50_000,
};

export interface PrepaidWalletSummary {
  currency: "usd";
  balanceMicros: number;
  status: "funded" | "low" | "empty";
  rates: typeof prepaidRateCard;
  recentEntries: Array<{
    id: string;
    kind: "top_up" | "usage" | "refund" | "adjustment";
    amountMicros: number;
    balanceAfterMicros: number;
    description: string;
    createdAt: string;
  }>;
}

export interface PrepaidBillingAdministration {
  accountSummary(actor: AuthenticatedSession): Promise<PrepaidWalletSummary>;
  createTopUpCheckout(actor: AuthenticatedSession, amountCents: number, billing: BillingProvider, webBaseUrl: string): Promise<{ checkoutId: string; url: string; expiresAt: string }>;
  applyBillingEvent(event: BillingEvent): Promise<boolean>;
  assertWorkspaceFunded(workspaceId: string, targetType: "managed_cloud_runner" | "managed_browser_worker"): Promise<void>;
  settleExecutionUsage(executionId: string): Promise<void>;
}

export class PostgresPrepaidBilling implements PrepaidBillingAdministration {
  constructor(private readonly pool: Pool,private readonly referrals?:ReferralSettlement) {}

  async accountSummary(actor: AuthenticatedSession): Promise<PrepaidWalletSummary> {
    await this.pool.query(`INSERT INTO prepaid_wallets(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`, [actor.accountId]);
    const wallet = await this.pool.query<{ id:string;balance_microusd:string }>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1`, [actor.accountId]);
    const row = wallet.rows[0];
    if (!row) throw new DomainError("wallet_unavailable", "The prepaid wallet could not be created.", 503);
    const entries = await this.pool.query<{ id:string;kind:PrepaidWalletSummary["recentEntries"][number]["kind"];amount_microusd:string;balance_after_microusd:string;description:string;created_at:Date }>(
      `SELECT id,kind,amount_microusd::text,balance_after_microusd::text,description,created_at FROM prepaid_wallet_entries WHERE wallet_id=$1 ORDER BY created_at DESC,id DESC LIMIT 12`,
      [row.id]
    );
    const balanceMicros = safeNumber(row.balance_microusd, "wallet balance");
    return {
      currency: "usd",
      balanceMicros,
      status: balanceMicros <= 0 ? "empty" : balanceMicros < 1_000_000 ? "low" : "funded",
      rates: prepaidRateCard,
      recentEntries: entries.rows.map(entry => ({
        id:entry.id,
        kind:entry.kind,
        amountMicros:safeNumber(entry.amount_microusd,"wallet entry"),
        balanceAfterMicros:safeNumber(entry.balance_after_microusd,"wallet balance"),
        description:entry.description,
        createdAt:entry.created_at.toISOString(),
      })),
    };
  }

  async createTopUpCheckout(actor: AuthenticatedSession, amountCents: number, billing: BillingProvider, webBaseUrl: string) {
    if (!Number.isSafeInteger(amountCents) || amountCents < 500 || amountCents > 50_000) throw new DomainError("topup_amount_invalid", "Choose a top-up between $5 and $500.");
    const account = await this.pool.query<{billing_customer_ref:string|null}>(`SELECT billing_customer_ref FROM accounts WHERE id=$1 AND deleted_at IS NULL`, [actor.accountId]);
    if (!account.rowCount) throw new DomainError("account_not_found", "The billing account was not found.", 404);
    const base = webBaseUrl.replace(/\/$/, "");
    const metadata = { billingKind:"prepaid_topup",accountId:actor.accountId,amountCents:String(amountCents),currency:"usd" };
    const checkout = await billing.createCheckout({
      priceData:{currency:"usd",unitAmount:amountCents,productName:"sndbox cloud credit"},
      mode:"payment",
      customerId:account.rows[0].billing_customer_ref??undefined,
      successUrl:`${base}/billing?topup=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl:`${base}/billing?topup=cancelled`,
      metadata,
      allowPromotionCodes:false,
    });
    await this.pool.query(
      `INSERT INTO prepaid_topup_sessions(id,account_id,amount_cents,expires_at) VALUES($1,$2,$3,$4)`,
      [checkout.checkoutId,actor.accountId,amountCents,checkout.expiresAt]
    );
    return checkout;
  }

  async applyBillingEvent(event: BillingEvent): Promise<boolean> {
    if (event.kind === "checkout_completed") {
      if (event.metadata.billingKind !== "prepaid_topup") return false;
      if (event.paymentStatus !== "paid" || !event.paymentId) throw new DomainError("topup_payment_incomplete", "Cloud credit is added only after payment completes.", 409);
      const paymentId=event.paymentId;
      return this.transaction(async client => {
        const checkout = await client.query<{account_id:string;amount_cents:number;currency:string;status:string}>(
          `SELECT account_id,amount_cents,currency,status FROM prepaid_topup_sessions WHERE id=$1 FOR UPDATE`, [event.checkoutId]
        );
        if (!checkout.rowCount) throw new DomainError("topup_checkout_not_found", "Completed top-up checkout was not created by sndbox.", 409);
        const row = checkout.rows[0];
        if (row.status === "completed" || row.status === "refunded") return true;
        if (event.metadata.accountId !== row.account_id || event.metadata.amountCents !== String(row.amount_cents) || event.metadata.currency !== row.currency) throw new DomainError("topup_checkout_mismatch", "Top-up checkout metadata did not match the stored request.", 409);
        await client.query(`INSERT INTO prepaid_wallets(account_id,currency) VALUES($1,$2) ON CONFLICT(account_id) DO NOTHING`, [row.account_id,row.currency]);
        const wallet = await client.query<{id:string;balance_microusd:string}>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1 FOR UPDATE`, [row.account_id]);
        const credit = BigInt(row.amount_cents)*MICROS_PER_CENT;
        const balance = BigInt(wallet.rows[0].balance_microusd)+credit;
        await client.query(`UPDATE prepaid_wallets SET balance_microusd=$1,updated_at=now() WHERE id=$2`, [balance.toString(),wallet.rows[0].id]);
        await client.query(
          `INSERT INTO prepaid_wallet_entries(wallet_id,kind,amount_microusd,balance_after_microusd,description,idempotency_key,billing_event_id) VALUES($1,'top_up',$2,$3,$4,$5,$6)`,
          [wallet.rows[0].id,credit.toString(),balance.toString(),`Cloud credit top-up · $${(row.amount_cents/100).toFixed(2)}`,`topup:${event.checkoutId}`,event.eventId]
        );
        await client.query(`UPDATE prepaid_topup_sessions SET status='completed',payment_ref=$1,completed_at=now() WHERE id=$2`, [paymentId,event.checkoutId]);
        if (event.customerId) await client.query(`UPDATE accounts SET billing_customer_ref=COALESCE(billing_customer_ref,$1) WHERE id=$2`, [event.customerId,row.account_id]);
        await this.referrals?.qualifyTopUp(client,row.account_id,row.amount_cents,paymentId);
        return true;
      });
    }
    if (event.kind !== "refund_changed") return false;
    const known = await this.pool.query(`SELECT 1 FROM prepaid_topup_sessions WHERE payment_ref=$1`, [event.paymentId]);
    if (!known.rowCount) return false;
    if (!event.refunded || event.refundedAmountCents === null) return true;
    const refundedAmountCents=event.refundedAmountCents;
    return this.transaction(async client => {
      const topup = await client.query<{id:string;account_id:string;amount_cents:number;currency:string;refunded_microusd:string}>(
        `SELECT id,account_id,amount_cents,currency,refunded_microusd::text FROM prepaid_topup_sessions WHERE payment_ref=$1 FOR UPDATE`, [event.paymentId]
      );
      const row = topup.rows[0];
      if (!row) return true;
      if (event.currency && event.currency !== row.currency) throw new DomainError("topup_refund_currency_mismatch", "The refund currency did not match the original top-up.", 409);
      const credited = BigInt(row.amount_cents)*MICROS_PER_CENT;
      const requestedRefund = BigInt(refundedAmountCents)*MICROS_PER_CENT;
      const targetRefund = requestedRefund > credited ? credited : requestedRefund;
      const previousRefund = BigInt(row.refunded_microusd);
      const delta = targetRefund-previousRefund;
      if (delta <= 0n) return true;
      const wallet = await client.query<{id:string;balance_microusd:string}>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1 FOR UPDATE`, [row.account_id]);
      const balance = BigInt(wallet.rows[0].balance_microusd)-delta;
      await client.query(`UPDATE prepaid_wallets SET balance_microusd=$1,updated_at=now() WHERE id=$2`, [balance.toString(),wallet.rows[0].id]);
      await client.query(
        `INSERT INTO prepaid_wallet_entries(wallet_id,kind,amount_microusd,balance_after_microusd,description,idempotency_key,billing_event_id) VALUES($1,'refund',$2,$3,$4,$5,$6)`,
        [wallet.rows[0].id,(-delta).toString(),balance.toString(),"Cloud credit refund",`refund:${row.id}:${targetRefund}`,event.eventId]
      );
      await client.query(`UPDATE prepaid_topup_sessions SET refunded_microusd=$1,status=CASE WHEN $1 >= amount_cents::bigint*10000 THEN 'refunded' ELSE status END WHERE id=$2`, [targetRefund.toString(),row.id]);
      await this.referrals?.reverseTopUp(client,event.paymentId,row.amount_cents-Number(targetRefund/MICROS_PER_CENT));
      return true;
    });
  }

  async assertWorkspaceFunded(workspaceId: string, targetType: "managed_cloud_runner" | "managed_browser_worker"): Promise<void> {
    const required = targetType === "managed_browser_worker" ? prepaidRateCard.managedBrowserMicrosPerMinute : prepaidRateCard.hostedRunnerMicrosPerMinute;
    const result = await this.pool.query<{balance_microusd:string}>(
      `SELECT wallet.balance_microusd::text
         FROM workspaces workspace
         JOIN organisations organisation ON organisation.id=workspace.organisation_id
         LEFT JOIN prepaid_wallets wallet ON wallet.account_id=organisation.created_by
        WHERE workspace.id=$1`, [workspaceId]
    );
    if (!result.rowCount) throw new DomainError("workspace_not_found", "The workspace billing owner was not found.", 404);
    const balance = BigInt(result.rows[0].balance_microusd??"0");
    if (balance < BigInt(required)) throw new DomainError("cloud_credit_required", "Add cloud credit before starting a managed run.", 402);
  }

  async settleExecutionUsage(executionId: string): Promise<void> {
    await this.transaction(async client => {
      const execution = await client.query<{account_id:string;meter:string|null;quantity:string|null}>(
        `SELECT organisation.created_by AS account_id,usage.meter::text,sum(usage.quantity)::text AS quantity
           FROM executions execution
           JOIN workspaces workspace ON workspace.id=execution.workspace_id
           JOIN organisations organisation ON organisation.id=workspace.organisation_id
           LEFT JOIN usage_events usage ON usage.execution_id=execution.id
          WHERE execution.id=$1
          GROUP BY organisation.created_by,usage.meter`, [executionId]
      );
      if (!execution.rowCount) throw new DomainError("usage_execution_not_found", "Usage could not be matched to an execution.", 404);
      const quantities:Record<string,bigint>={};
      for (const row of execution.rows) if (row.meter && row.quantity) quantities[row.meter]=BigInt(row.quantity);
      const target = calculateUsageCostMicros({
        hostedRunnerSeconds:quantities.hosted_runner_seconds??0n,
        managedBrowserSeconds:quantities.managed_browser_seconds??0n,
        networkEgressBytes:quantities.network_egress_bytes??0n,
        artifactStorageByteSeconds:quantities.artifact_storage_byte_seconds??0n,
      });
      const accountId = execution.rows[0].account_id;
      await client.query(`INSERT INTO prepaid_wallets(account_id) VALUES($1) ON CONFLICT(account_id) DO NOTHING`, [accountId]);
      const wallet = await client.query<{id:string;balance_microusd:string}>(`SELECT id,balance_microusd::text FROM prepaid_wallets WHERE account_id=$1 FOR UPDATE`, [accountId]);
      const previous = await client.query<{amount_microusd:string}>(`SELECT amount_microusd::text FROM prepaid_execution_charges WHERE execution_id=$1 FOR UPDATE`, [executionId]);
      const previousCharge = BigInt(previous.rows[0]?.amount_microusd??"0");
      if (target < previousCharge) throw new DomainError("usage_charge_regression", "An append-only usage charge cannot decrease.", 409);
      const delta = target-previousCharge;
      if (delta === 0n) return;
      const balance = BigInt(wallet.rows[0].balance_microusd)-delta;
      await client.query(`UPDATE prepaid_wallets SET balance_microusd=$1,updated_at=now() WHERE id=$2`, [balance.toString(),wallet.rows[0].id]);
      await client.query(
        `INSERT INTO prepaid_execution_charges(execution_id,wallet_id,amount_microusd) VALUES($1,$2,$3) ON CONFLICT(execution_id) DO UPDATE SET amount_microusd=excluded.amount_microusd,updated_at=now()`,
        [executionId,wallet.rows[0].id,target.toString()]
      );
      await client.query(
        `INSERT INTO prepaid_wallet_entries(wallet_id,kind,amount_microusd,balance_after_microusd,description,idempotency_key,execution_id) VALUES($1,'usage',$2,$3,$4,$5,$6)`,
        [wallet.rows[0].id,(-delta).toString(),balance.toString(),`Cloud usage · ${executionId.slice(0,8)}`,`usage:${executionId}:${target}`,executionId]
      );
    });
  }

  private async transaction<T>(operation:(client:PoolClient)=>Promise<T>):Promise<T> {
    const client=await this.pool.connect();
    try { await client.query("BEGIN");const result=await operation(client);await client.query("COMMIT");return result; }
    catch(error){await client.query("ROLLBACK");throw error;}
    finally{client.release();}
  }
}

export function calculateUsageCostMicros(input:{hostedRunnerSeconds:bigint;managedBrowserSeconds:bigint;networkEgressBytes:bigint;artifactStorageByteSeconds:bigint}):bigint {
  for (const quantity of Object.values(input)) if (quantity < 0n) throw new DomainError("usage_quantity_invalid", "Usage quantities cannot be negative.");
  const runner = input.hostedRunnerSeconds === 0n ? 0n : divideRoundUp(maximum(input.hostedRunnerSeconds,60n)*BigInt(prepaidRateCard.hostedRunnerMicrosPerMinute),60n);
  const browser = input.managedBrowserSeconds === 0n ? 0n : divideRoundUp(maximum(input.managedBrowserSeconds,60n)*BigInt(prepaidRateCard.managedBrowserMicrosPerMinute),60n);
  const egress = divideRoundUp(input.networkEgressBytes*BigInt(prepaidRateCard.networkEgressMicrosPerGib),BYTES_PER_GIB);
  const storage = divideRoundUp(input.artifactStorageByteSeconds*BigInt(prepaidRateCard.artifactStorageMicrosPerGibMonth),BYTES_PER_GIB*SECONDS_PER_THIRTY_DAY_MONTH);
  return runner+browser+egress+storage;
}

function divideRoundUp(value:bigint,divisor:bigint):bigint{return value===0n?0n:(value+divisor-1n)/divisor;}
function maximum(left:bigint,right:bigint):bigint{return left>right?left:right;}
function safeNumber(value:string,label:string):number{const parsed=BigInt(value);if(parsed>BigInt(Number.MAX_SAFE_INTEGER)||parsed<BigInt(Number.MIN_SAFE_INTEGER))throw new DomainError("wallet_value_overflow",`${label} exceeds the supported range.`,500);return Number(parsed);}
