import Stripe from "stripe";

export interface CheckoutRequest {
  priceId: string;
  mode: "payment" | "subscription";
  customerId?: string;
  successUrl: string;
  cancelUrl: string;
  metadata: Record<string, string>;
}

export interface BillingProvider {
  createCheckout(request: CheckoutRequest): Promise<{ checkoutId: string; url: string; expiresAt: string }>;
  parseWebhook(rawBody: Buffer, signature: string): BillingEvent | null;
}

export type BillingEvent =
  | { kind: "checkout_completed"; eventId: string; checkoutId: string; customerId: string | null; subscriptionId: string | null; paymentId: string | null; metadata: Record<string, string> }
  | { kind: "subscription_changed"; eventId: string; subscriptionId: string; customerId: string; status: string; renewsAt: string | null; metadata: Record<string, string> }
  | { kind: "refund_changed"; eventId: string; paymentId: string; refunded: boolean };

export class StripeBillingProvider implements BillingProvider {
  private readonly stripe: Stripe;
  constructor(secretKey: string, private readonly webhookSecret: string) { this.stripe = new Stripe(secretKey); }

  async createCheckout(request: CheckoutRequest) {
    const session = await this.stripe.checkout.sessions.create({
      mode: request.mode,
      customer: request.customerId,
      line_items: [{ price: request.priceId, quantity: 1 }],
      success_url: request.successUrl,
      cancel_url: request.cancelUrl,
      metadata: request.metadata,
      payment_intent_data: request.mode === "payment" ? { metadata: request.metadata } : undefined,
      subscription_data: request.mode === "subscription" ? { metadata: request.metadata } : undefined,
      allow_promotion_codes: true
    });
    if (!session.url) throw new Error("Stripe did not return a hosted checkout URL.");
    return { checkoutId: session.id, url: session.url, expiresAt: new Date(session.expires_at * 1_000).toISOString() };
  }

  parseWebhook(rawBody: Buffer, signature: string): BillingEvent | null {
    const event = this.stripe.webhooks.constructEvent(rawBody, signature, this.webhookSecret);
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      return { kind: "checkout_completed", eventId: event.id, checkoutId: session.id, customerId: referenceId(session.customer), subscriptionId: referenceId(session.subscription), paymentId: referenceId(session.payment_intent), metadata: session.metadata ?? {} };
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
      return { kind: "refund_changed", eventId: event.id, paymentId, refunded: event.type === "charge.refunded" || event.data.object.status === "succeeded" };
    }
    return null;
  }
}

function referenceId(value: string | { id: string } | null): string | null { return typeof value === "string" ? value : value?.id ?? null; }
