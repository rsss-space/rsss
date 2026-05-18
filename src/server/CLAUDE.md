# Server: Billing Domain

Last verified: 2026-05-18

## Purpose
Reconciles two third-party billing providers: Autumn owns the canonical
customer record (keyed by Bluesky DID, exposing `stripeId`), and Stripe
owns PaymentMethods and `Customer.invoice_settings`. The DID -> `cus_*`
mapping is never persisted locally; it is pulled from Autumn per request.

## Contracts

### Stripe SDK boundary (`stripe-billing.ts`)
- **Exposes**:
  - `stripeUseLive(env):boolean` — true iff `STRIPE_SECRET_KEY` is set
  - `getStripe(env):Stripe` — per-request SDK handle using
    `Stripe.createFetchHttpClient()` (Workers fetch runtime, not Node)
  - `getStripeCustomerId(env, did):Promise<string>` — Autumn pull-through;
    throws when Autumn is unconfigured or returns no `stripeId`
  - `getStripePublishableKey(env):string|null`
  - `isStripeNotFoundError(err):boolean` — matches `code:'resource_missing'`
    or `statusCode:404`
- **Guarantees**: There is deliberately no dev-mode stub. When
  `stripeUseLive(env)` is false, dependent routes return **503**.
- **Expects**: `Env` carries optional `STRIPE_SECRET_KEY` and
  `STRIPE_PUBLISHABLE_KEY`; `AUTUMN_SECRET_KEY` is set whenever
  `getStripeCustomerId` is called.

### HTTP routes (`/api/billing/*`)
All require `requireAuth` and use the session DID for customer lookup.

| Route | Returns |
|-------|---------|
| `GET /status` | `BillingStatus` extended with `stripePublishableKey:string\|null` |
| `GET /payment-methods` | `PaymentMethodsPayload` (`{ methods, defaultId }`) |
| `POST /payment-methods/setup-intent` | `{ clientSecret:string }` |
| `DELETE /payment-methods/:id` | `PaymentMethodsPayload` (canonical post-detach list) |
| `POST /payment-methods/:id/default` | `PaymentMethodsPayload` |

**Error contract (uniform across the four `payment-methods*` routes):**
- `503 { error: 'stripe_unconfigured' }` when `stripeUseLive` is false
- `404 { error: 'payment_method_not_found' }` when Stripe says
  `resource_missing` (caller should refresh canonical list)
- `409 { error: 'cannot_remove_default' }` on DELETE of the current default
- `502 { error: 'stripe_error' }` for unexpected Stripe failures; the
  set-default route may also return `502 { error, methods, defaultId }`
  with the canonical list when only the subscription-level update failed
  (partial-failure shape)

**Removed in this branch:** legacy `POST /api/billing/payment-method`
(which returned an Autumn-hosted URL) is gone. Clients now drive
Stripe Elements through the SetupIntent flow.

### Exported types (from `src/server/index.ts`)
- `PaymentMethodSummary { id, brand, last4, expMonth, expYear, isDefault }`
- `PaymentMethodsPayload { methods, defaultId }`

## Dependencies
- **Uses**: `autumn-js` (DID -> `stripeId` lookup), `stripe` (PaymentMethods,
  Customers, Subscriptions), Hono `requireAuth` middleware
- **Used by**: Client `src/client/state.ts` actions
  (`loadPaymentMethods`, `createSetupIntent`, `removePaymentMethod`,
  `setDefaultPaymentMethod`) and `<PaymentMethodModal>`
- **Boundary**: Do NOT persist `cus_*` ids in DO SQLite or KV — Autumn is
  the source of truth. Do NOT call Stripe directly from any module other
  than `stripe-billing.ts` and the route handlers in `index.ts`.

## Key Decisions
- **No dev-mode Stripe stub**: Loud 503 when `STRIPE_SECRET_KEY` is
  unset, rather than silently faking PaymentMethod state.
- **Autumn pull-through every request**: avoids storing a derived mapping
  that could drift from Autumn's record.
- **Set-default is two-step (customer + subscription)**: Stripe's customer
  default does not propagate to active subscriptions; we update both, and
  surface subscription-only failures as `502` with a canonical-list body.
- **Defense in depth on DELETE**: refuse to detach the current default
  before calling `paymentMethods.detach`.

## Invariants
- `cus_*` ids are never written to local storage (DO SQLite, KV, or KV
  cache).
- Every successful mutation route (DELETE, set-default) returns the
  canonical `PaymentMethodsPayload`; clients replace local state from it.
- `getStripe()` always uses `createFetchHttpClient()` (Workers runtime).

## Key Files
- `stripe-billing.ts` — Stripe SDK boundary and Autumn pull-through
- `autumn-billing.ts` — Autumn boundary, `didToCustomerId`, `BillingEnv`
- `index.ts` — Hono routes; `listPaymentMethodsPayload` helper

## Gotchas
- `Stripe.createFetchHttpClient()` is required on Cloudflare Workers; the
  default Node HTTP client will fail to bundle.
- The customer-level default does NOT cascade to active subscriptions —
  always update the subscription too when changing default.
- Autumn returns `stripeId` (camelCase) even though the wire format is
  `stripe_id`; rely on the SDK's normalization.
