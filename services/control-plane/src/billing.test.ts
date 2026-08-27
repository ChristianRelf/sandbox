import Stripe from "stripe";
import { describe, expect, it } from "vitest";
import { StripeBillingProvider } from "./billing.js";

describe("Stripe billing boundary", () => {
  it("accepts only a signature-valid raw webhook and normalizes metadata", () => {
    const secret = "whsec_test_secret";
    const payload = JSON.stringify({ id: "evt_checkout_1", object: "event", api_version: "2025-08-27.basil", created: 1, livemode: false, pending_webhooks: 1, request: null, type: "checkout.session.completed", data: { object: { id: "cs_test_1", object: "checkout.session", customer: "cus_1", subscription: "sub_1", payment_intent: null, metadata: { ownerType: "workspace", ownerId: "22222222-2222-4222-8222-222222222222", pluginId: "com.example.weather", planId: "team" } } } });
    const signature = Stripe.webhooks.generateTestHeaderString({ payload, secret });
    const provider = new StripeBillingProvider("sk_test_placeholder", secret);
    expect(provider.parseWebhook(Buffer.from(payload), signature)).toMatchObject({ kind: "checkout_completed", checkoutId: "cs_test_1", subscriptionId: "sub_1", metadata: { pluginId: "com.example.weather" } });
    expect(() => provider.parseWebhook(Buffer.from(payload), "t=1,v1=invalid")).toThrow();
  });
});
