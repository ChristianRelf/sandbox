import { Pool } from "pg";
import { z } from "zod";

const planSchema = z.object({
  id:z.string().regex(/^[a-z][a-z0-9_-]{1,49}$/),displayName:z.string().min(2).max(80),audience:z.enum(["individual","team","enterprise"]),description:z.string().min(1).max(500),
  currency:z.string().regex(/^[a-z]{3}$/).nullable(),unitAmount:z.number().int().nonnegative().nullable(),billingInterval:z.enum(["month","year"]).nullable(),stripePriceId:z.string().min(3).nullable(),
  includedUsage:z.record(z.string(),z.number().int().nonnegative()),entitlements:z.record(z.string(),z.union([z.boolean(),z.number(),z.string()])),seatAllowance:z.number().int().positive().nullable(),offlineGraceDays:z.number().int().min(1).max(90),
  localExecutionUnmetered:z.literal(true),overagePolicy:z.enum(["blocked","spending_limit","contract"]),published:z.boolean(),sortOrder:z.number().int(),
}).strict().refine(plan => [plan.currency,plan.unitAmount,plan.billingInterval,plan.stripePriceId].every(value=>value===null)||[plan.currency,plan.unitAmount,plan.billingInterval,plan.stripePriceId].every(value=>value!==null),"Billing fields must be supplied together.");
const plans = z.array(planSchema).min(1).parse(JSON.parse(required("PRODUCT_PLANS_JSON")));
if (new Set(plans.map(plan=>plan.id)).size !== plans.length) throw new Error("PRODUCT_PLANS_JSON contains duplicate plan IDs.");

const pool = new Pool({ connectionString:required("DATABASE_URL") });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  for (const plan of plans) await client.query(
    `INSERT INTO product_plans(id,display_name,audience,description,currency,unit_amount,billing_interval,stripe_price_ref,included_usage,entitlements,seat_allowance,offline_grace_days,local_execution_unmetered,overage_policy,published,sort_order)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,true,$13,$14,$15)
     ON CONFLICT(id) DO UPDATE SET display_name=excluded.display_name,audience=excluded.audience,description=excluded.description,currency=excluded.currency,unit_amount=excluded.unit_amount,billing_interval=excluded.billing_interval,stripe_price_ref=excluded.stripe_price_ref,included_usage=excluded.included_usage,entitlements=excluded.entitlements,seat_allowance=excluded.seat_allowance,offline_grace_days=excluded.offline_grace_days,local_execution_unmetered=true,overage_policy=excluded.overage_policy,published=excluded.published,sort_order=excluded.sort_order,updated_at=now()`,
    [plan.id,plan.displayName,plan.audience,plan.description,plan.currency,plan.unitAmount,plan.billingInterval,plan.stripePriceId,plan.includedUsage,plan.entitlements,plan.seatAllowance,plan.offlineGraceDays,plan.overagePolicy,plan.published,plan.sortOrder]
  );
  await client.query(`UPDATE product_plans SET published=false,updated_at=now() WHERE NOT(id=ANY($1::text[]))`, [plans.map(plan=>plan.id)]);
  await client.query("COMMIT");
  console.log(`Synchronized ${plans.length} product plans.`);
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { client.release(); await pool.end(); }

function required(name:string):string { const value=process.env[name]; if(!value)throw new Error(`${name} is required`); return value; }
