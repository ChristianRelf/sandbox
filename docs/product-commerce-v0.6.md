# Product commerce configuration

Status: implemented contract; production plans require commercial approval before synchronization.

`product_plans` is the authoritative source for public pricing, checkout eligibility, hosted allowances and product entitlements. Marketing and account applications read `/v1/product-plans`; they do not maintain price copies.

## Configure plans

Set `DATABASE_URL` and `PRODUCT_PLANS_JSON`, then run:

```powershell
npm.cmd run product-plans:sync --workspace @sandbox/control-plane
```

Each plan record requires:

- Stable `id`, display name, audience and reviewed description.
- ISO-4217 lowercase currency, minor-unit amount, month/year interval and Stripe price ID together; all four are `null` for a non-billed plan.
- Included usage by meter and explicit entitlement flags.
- Seat allowance, offline-grace days and overage policy.
- `localExecutionUnmetered: true`.
- Publication state and sort order.

The synchronizer validates the complete document in one transaction, updates matching records and unpublishes records omitted from the reviewed configuration. It never deletes subscriptions or licences.

## Checkout lifecycle

1. Marketing reads only published plans.
2. Account authentication establishes an HTTP-only OIDC session cookie using authorization code plus PKCE.
3. The portal derives the personal owner from the verified account; it never accepts an account ID from the browser.
4. The control plane resolves the Stripe price from `product_plans` and creates hosted checkout.
5. A signed Stripe webhook creates the subscription and corresponding licence exactly once.
6. Later subscription events update subscription and offline-grace-aware licence status.

Organisation checkout additionally requires an owner or administrator membership. Team seat assignment, device activation, cancellation and invoice retrieval remain the next commerce slice.
