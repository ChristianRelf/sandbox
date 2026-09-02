import Stripe from "stripe";

export interface CheckoutRequest {
  priceId?: string;
  priceData?: { currency: string; unitAmount: number; productName: string };
  mode: "payment" | "subscription";
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
  allowPromotionCodes?: boolean;
}

export interface BillingProvider {
  createCheckout(request: CheckoutRequest): Promise<{ checkoutId: string; url: string; expiresAt: string }>;
  parseWebhook(rawBody: Buffer, signature: string): BillingEvent | null;
}

export type BillingEvent =
  | { kind: "checkout_completed"; eventId: string; checkoutId: string; customerId: string | null; subscriptionId: string | null; paymentId: string | null; paymentStatus: "paid" | "unpaid" | "no_payment_required"; metadata: Record<string, string> }
  | { kind: "subscription_changed"; eventId: string; subscriptionId: string; customerId: string; status: string; renewsAt: string | null; metadata: Record<string, string> }
  | { kind: "refund_changed"; eventId: string; paymentId: string; refunded: boolean; refundedAmountCents: number | null; currency: string | null };

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) { this.stripe = new Stripe(secretKey); }

  async createCheckout(request: CheckoutRequest) {
    if (Boolean(request.priceId) === Boolean(request.priceData)) throw new Error("Checkout requires exactly one configured price.");
    const session = await this.stripe.checkout.sessions.create({
      mode: request.mode,
      customer: request.customerId,
      customer_creation: request.mode === "payment" && !request.customerId ? "always" : undefined,
      line_items: [{
        ...(request.priceId
          ? { price: request.priceId }
          : { price_data: { currency: request.priceData!.currency, unit_amount: request.priceData!.unitAmount, product_data: { name: request.priceData!.productName } } }),
        quantity: 1,
      }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: request.metadata,
      payment_intent_data: request.mode === "payment" ? { metadata: request.metadata } : undefined,
      subscription_data: request.mode === "subscription" ? { metadata: request.metadata } : undefined,
      allow_promotion_codes: request.allowPromotionCodes ?? true,
    });
    if (!session.url) throw new Error("Stripe did not return a hosted checkout URL.");
    return { checkoutId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1_000).toISOString() };
  }

  parseWebhook(rawBody: Buffer, signature: string): BillingEvent | null {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (event.type === "checkout.session.completed" || event.type === "checkout.session.async_payment_succeeded") {
      const session = event.data.object;
      return { kind: "checkout_completed", eventId: event.id, checkoutId: session.id, customerId: referenceId(session.customer), subscriptionId: referenceId(session.subscription), paymentId: referenceId(session.payment_intent), paymentStatus: session.payment_status, metadata: session.metadata ?? {} };
    }
    if (event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const itemPeriods = subscription.items.data.map(item => item.current_period_end).filter((value): value is number => typeof value === "number");
      const renewal = itemPeriods.length ? Math.max(...itemPeriods) : null;
      return { kind: "subscription_changed", eventId: event.id, subscriptionId: subscription.id, customerId: referenceId(subscription.customer) ?? "", status: subscription.status, renewsAt: renewal ? new Date(renewal * 1_000).toISOString() : null, metadata: subscription.metadata };
    }
    if (event.type === "charge.refunded" || event.type === "charge.refund.updated") {
      const charge = event.type === "charge.refunded" ? event.data.object : event.data.object.charge;
      const paymentId = typeof charge === "string" ? null : referenceId(charge?.payment_intent ?? null);
      if (!paymentId) return null;
      return {
        kind: "refund_changed",
        eventId: event.id,
        paymentId,
        refunded: event.type === "charge.refunded" ? event.data.object.refunded : event.data.object.status === "succeeded",
        refundedAmountCents: event.type === "charge.refunded" ? event.data.object.amount_refunded : null,
        currency: event.type === "charge.refunded" ? event.data.object.currency : null,
      };
    }
    return null;
  }
}

function referenceId(value: string | { id: string } | null): string | null { return typeof value === "string" ? value : value?.id ?? null; }
