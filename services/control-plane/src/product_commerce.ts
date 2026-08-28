import type { Pool, PoolClient } from "pg";
import type { BillingEvent, BillingProvider } from "./billing.js";
import type { AuthenticatedSession } from "./types.js";
import { DomainError } from "./types.js";

export interface ProductPlan {
  id: string;
  displayName: string;
  audience: "individual" | "team" | "enterprise";
  description: string;
  price: { currency: string; unitAmount: number; interval: "month" | "year" } | null;
  includedUsage: Record<string, number>;
  entitlements: Record<string, boolean | number | string>;
  seatAllowance: number | null;
  offlineGraceDays: number;
  localExecutionUnmetered: true;
  overagePolicy: "blocked" | "spending_limit" | "contract";
}

export interface ProductAccountSummary {
  subscriptions: Array<{
    id: string; ownerType: "personal" | "organisation"; ownerId: string; planId: string;
    planName: string; status: "trial" | "active" | "past_due" | "cancelled" | "expired";
    currentPeriodEndsAt: string | null; cancelAtPeriodEnd: boolean;
  }>;
  licences: Array<{
    id: string; ownerType: "personal" | "organisation"; ownerId: string; planId: string;
    status: "active" | "past_due" | "expired" | "revoked"; seatAllowance: number | null;
    seatsAssigned: number; devices: number; offlineGraceUntil: string;
  }>;
}

export interface ProductCommerceAdministration {
  listPublishedPlans(): Promise<ProductPlan[]>;
  accountSummary(actor: AuthenticatedSession): Promise<ProductAccountSummary>;
  createCheckout(actor: AuthenticatedSession, ownerType: "personal" | "organisation", ownerId: string, planId: string, billing: BillingProvider, webBaseUrl: string): Promise<{ checkoutId: string; url: string; expiresAt: string }>;
  applyBillingEvent(event: BillingEvent): Promise<boolean>;
}

type PlanRow = {
  id: string; display_name: string; audience: ProductPlan["audience"]; description: string;
  currency: string | null; unit_amount: string | number | null; billing_interval: "month" | "year" | null;
  included_usage: Record<string, number>; entitlements: ProductPlan["entitlements"];
  seat_allowance: number | null; offline_grace_days: number; local_execution_unmetered: boolean;
  overage_policy: ProductPlan["overagePolicy"]; stripe_price_ref?: string | null;
};

export class PostgresProductCommerce implements ProductCommerceAdministration {
  constructor(private readonly pool: Pool) {}

  async listPublishedPlans(): Promise<ProductPlan[]> {
    const result = await this.pool.query<PlanRow>(`SELECT id,display_name,audience,description,currency,unit_amount,billing_interval,included_usage,entitlements,seat_allowance,offline_grace_days,local_execution_unmetered,overage_policy FROM product_plans WHERE published ORDER BY sort_order,id`);
    return result.rows.map(toPlan);
  }

  async accountSummary(actor: AuthenticatedSession): Promise<ProductAccountSummary> {
    return this.withActor(actor, async client => {
      const subscriptions = await client.query<{
        id:string;owner_type:"personal"|"organisation";owner_id:string;plan_id:string;display_name:string;status:ProductAccountSummary["subscriptions"][number]["status"];current_period_ends_at:Date|null;cancel_at_period_end:boolean;
      }>(`SELECT subscription.id,subscription.owner_type,subscription.owner_id,subscription.plan_id,plan.display_name,subscription.status,subscription.current_period_ends_at,subscription.cancel_at_period_end FROM product_subscriptions subscription JOIN product_plans plan ON plan.id=subscription.plan_id ORDER BY subscription.updated_at DESC`);
      const licences = await client.query<{
        id:string;owner_type:"personal"|"organisation";owner_id:string;plan_id:string;status:ProductAccountSummary["licences"][number]["status"];seat_allowance:number|null;offline_grace_until:Date;seats_assigned:string;devices:string;
      }>(`SELECT licence.id,licence.owner_type,licence.owner_id,licence.plan_id,licence.status,licence.seat_allowance,licence.offline_grace_until,count(DISTINCT seat.account_id)::text AS seats_assigned,count(DISTINCT device.id) FILTER (WHERE device.revoked_at IS NULL)::text AS devices FROM product_licences licence LEFT JOIN product_licence_seats seat ON seat.licence_id=licence.id LEFT JOIN licensed_devices device ON device.licence_id=licence.id GROUP BY licence.id ORDER BY licence.updated_at DESC`);
      return {
        subscriptions: subscriptions.rows.map(row => ({ id:row.id,ownerType:row.owner_type,ownerId:row.owner_id,planId:row.plan_id,planName:row.display_name,status:row.status,currentPeriodEndsAt:row.current_period_ends_at?.toISOString()??null,cancelAtPeriodEnd:row.cancel_at_period_end })),
        licences: licences.rows.map(row => ({ id:row.id,ownerType:row.owner_type,ownerId:row.owner_id,planId:row.plan_id,status:row.status,seatAllowance:row.seat_allowance,seatsAssigned:Number(row.seats_assigned),devices:Number(row.devices),offlineGraceUntil:row.offline_grace_until.toISOString() })),
      };
    });
  }

  async createCheckout(actor: AuthenticatedSession, ownerType: "personal" | "organisation", ownerId: string, planId: string, billing: BillingProvider, webBaseUrl: string) {
    if (ownerType === "personal" && ownerId !== actor.accountId) throw new DomainError("billing_owner_invalid", "A personal subscription must belong to the authenticated account.", 403);
    if (ownerType === "organisation") {
      const allowed = await this.pool.query(`SELECT 1 FROM memberships membership JOIN roles role ON role.id=membership.role_id WHERE membership.organisation_id=$1 AND membership.account_id=$2 AND role.role_key IN ('owner','administrator')`, [ownerId, actor.accountId]);
      if (!allowed.rowCount) throw new DomainError("billing_permission_denied", "Organisation billing requires an owner or administrator role.", 403);
    }
    const selected = await this.pool.query<PlanRow & { stripe_price_ref: string | null }>(`SELECT * FROM product_plans WHERE id=$1 AND published`, [planId]);
    const plan = selected.rows[0];
    if (!plan || !plan.stripe_price_ref || plan.unit_amount === null) throw new DomainError("product_plan_unavailable", "The selected product plan is not available for checkout.", 404);
    if ((ownerType === "personal" && plan.audience !== "individual") || (ownerType === "organisation" && plan.audience === "individual")) throw new DomainError("product_plan_owner_mismatch", "The selected plan is not available for this owner type.", 400);
    const existing = await this.pool.query<{stripe_customer_ref:string|null}>(`SELECT stripe_customer_ref FROM product_subscriptions WHERE owner_type=$1 AND owner_id=$2 AND stripe_customer_ref IS NOT NULL ORDER BY updated_at DESC LIMIT 1`, [ownerType, ownerId]);
    const metadata = { billingKind:"product_subscription",accountId:actor.accountId,ownerType,ownerId,planId };
    const base = webBaseUrl.replace(/\/$/, "");
    const checkout = await billing.createCheckout({ priceId:plan.stripe_price_ref,mode:"subscription",customerId:existing.rows[0]?.stripe_customer_ref??undefined,successUrl:`${base}/billing/complete?session_id={CHECKOUT_SESSION_ID}`,cancelUrl:`${base}/billing`,metadata });
    await this.pool.query(`INSERT INTO product_checkout_sessions(id,account_id,owner_type,owner_id,plan_id,expires_at) VALUES($1,$2,$3,$4,$5,$6)`, [checkout.checkoutId,actor.accountId,ownerType,ownerId,planId,checkout.expiresAt]);
    return checkout;
  }

  async applyBillingEvent(event: BillingEvent): Promise<boolean> {
    if (event.kind === "checkout_completed") {
      if (event.metadata.billingKind !== "product_subscription") return false;
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN");
        const checkout = await client.query<{owner_type:"personal"|"organisation";owner_id:string;plan_id:string;seat_allowance:number|null;offline_grace_days:number}>(`SELECT checkout.owner_type,checkout.owner_id,checkout.plan_id,plan.seat_allowance,plan.offline_grace_days FROM product_checkout_sessions checkout JOIN product_plans plan ON plan.id=checkout.plan_id WHERE checkout.id=$1 AND checkout.status='open' FOR UPDATE`, [event.checkoutId]);
        if (!checkout.rowCount) throw new DomainError("product_checkout_not_found", "Completed product checkout is unknown or already applied.", 409);
        const row = checkout.rows[0];
        const subscription = await client.query<{id:string}>(`INSERT INTO product_subscriptions(owner_type,owner_id,plan_id,status,stripe_customer_ref,stripe_subscription_ref) VALUES($1,$2,$3,'active',$4,$5) RETURNING id`, [row.owner_type,row.owner_id,row.plan_id,event.customerId,event.subscriptionId]);
        await client.query(`INSERT INTO product_licences(subscription_id,owner_type,owner_id,plan_id,status,seat_allowance,offline_grace_until) VALUES($1,$2,$3,$4,'active',$5,now()+($6::text||' days')::interval)`, [subscription.rows[0].id,row.owner_type,row.owner_id,row.plan_id,row.seat_allowance,row.offline_grace_days]);
        await client.query(`UPDATE product_checkout_sessions SET status='completed' WHERE id=$1`, [event.checkoutId]);
        await client.query("COMMIT");
        return true;
      } catch (error) { await client.query("ROLLBACK"); throw error; }
      finally { client.release(); }
    }
    if (event.kind === "subscription_changed" && event.metadata.billingKind === "product_subscription") {
      const status = event.status === "active" || event.status === "trialing" ? "active" : event.status === "past_due" ? "past_due" : event.status === "canceled" ? "cancelled" : "expired";
      await this.pool.query(`UPDATE product_subscriptions SET status=$1,current_period_ends_at=$2,updated_at=now() WHERE stripe_subscription_ref=$3`, [status,event.renewsAt,event.subscriptionId]);
      await this.pool.query(`UPDATE product_licences SET status=CASE WHEN $1='active' THEN 'active' WHEN $1='past_due' THEN 'past_due' ELSE 'expired' END,updated_at=now() WHERE subscription_id IN (SELECT id FROM product_subscriptions WHERE stripe_subscription_ref=$2)`, [status,event.subscriptionId]);
      return true;
    }
    return false;
  }

  private async withActor<T>(actor: AuthenticatedSession, operation: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); await client.query(`SELECT set_config('app.account_id',$1,true)`, [actor.accountId]); const result=await operation(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

function toPlan(row: PlanRow): ProductPlan {
  return { id:row.id,displayName:row.display_name,audience:row.audience,description:row.description,price:row.unit_amount===null||!row.currency||!row.billing_interval?null:{currency:row.currency,unitAmount:Number(row.unit_amount),interval:row.billing_interval},includedUsage:row.included_usage,entitlements:row.entitlements,seatAllowance:row.seat_allowance,offlineGraceDays:row.offline_grace_days,localExecutionUnmetered:true,overagePolicy:row.overage_policy };
}
