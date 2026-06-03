# Settings: Subscription panel redesign

Date: 2026-05-16
Status: Approved (design)

## Problem

The `/settings` Subscription section currently shows a one-line plan name
and a large blue **Manage subscription** button. The button redirects the
user out of the app to Autumn's Stripe-hosted customer portal for every
subscription-management task (cancel, resume, update card, view
invoices).

Two problems:

1. Visually, the giant blue button is out of step with the rest of
   `/settings`, which uses quiet text controls.
2. UX-wise, dumping the user to a third-party portal hides basic
   information (renewal date, cancellation status) and forces a
   context switch for actions we can drive in-app.

## Goal

Show the user enough information to understand their subscription on
the `/settings` page itself, and let them cancel or resume the
subscription from inside RSSS. The only step that may still leave the
app is updating the payment method (Stripe requires a hosted page for
card entry).

## Non-goals

- Stripe Elements / in-app card-entry form. We accept one narrow,
  single-purpose redirect for card updates.
- Invoice history UI.
- Plan switching. Only one paid plan (`local-first`) exists today.
- Email-receipt preferences.

## Design

### Subscription panel — active state

```
Subscription

  Local-first  - Active
  Renews May 30, 2026
  Billed to nichoth@gmail.com

  Cancel subscription   .   Update payment method
```

### Subscription panel — cancellation scheduled

```
Subscription

  Local-first  - Ending May 30, 2026
  Your device will fall back to online-only after this date.
  Local data stays until you turn it off.

  Resume subscription   .   Update payment method
```

### Subscription panel — free tier

Unchanged from today: short blurb plus the existing
"Upgrade to Local-first" CTA pointing at `/signup`.

### Visual notes

- The plan label and status sit on one inline line; status uses a
  short word (`Active`, `Ending <date>`) rather than a colored badge.
- Renewal/end date is plain text.
- Contact email is shown inline at a smaller weight.
- Actions are quiet text buttons / links, not colored CTAs. They sit
  on one row, separated by a small bullet (`.`). They look like the
  controls already used in the Cache and Danger Zone sections.

## Data flow

### `GET /api/billing/status` response (extended)

```ts
interface BillingStatus {
    entitled:boolean
    planId:string
    status:'active'|'scheduled'|'none'
    refreshedAt:number
    useLive:boolean
    pendingDeletion?:PendingDeletion|null

    // New fields
    currentPeriodEnd:number|null   // ms epoch, end of paid period
    canceledAt:number|null         // ms epoch; non-null = cancel scheduled
    contactEmail:string|null       // recipient for billing notifications
}
```

Sources:

- `currentPeriodEnd`, `canceledAt`: pulled from
  `customers.getOrCreate({ expand: ['subscriptions.plan'] })` in
  `src/server/autumn-billing.ts`. Add a single
  `getSubscriptionSnapshot(env, did)` helper that returns
  `{ currentPeriodEnd, canceledAt }` from the matching subscription,
  so callers don't fan out multiple Autumn round-trips.
  `getCurrentPeriodEnd` becomes a thin wrapper over the snapshot
  helper for callers that only need the period end.
- `contactEmail`: pulled from the existing `readContactEmail(env, did)`
  KV lookup (`billing_contact_email:${did}`). Not from Autumn.

Note on `status` semantics: a cancel-at-period-end subscription is
still `status:'active'` on Autumn's side until the period actually
ends. The UI distinguishes "active" vs "ending soon" purely by
whether `canceledAt` is non-null - the `status` enum stays
`'active'|'scheduled'|'none'` and keeps its current meaning
(`'scheduled'` = a future subscription that hasn't started yet,
e.g. a trial).

Cache the response in `SESSIONS` KV at `billing:${did}` as today.
Cancel and resume operations write the refreshed `CachedBilling`
inline so the next `GET /api/billing/status` returns the new state
without a fresh Autumn round-trip.

### New endpoints

All three require `requireAuth`. All resolve `didToCustomerId(did)`
and call into `src/server/autumn-billing.ts`. On Autumn failure they
return `503` with `{ error: 'billing_unavailable' }`, matching the
existing pattern in `/api/billing/portal`.

| Endpoint | Action | Live mode | Dev mode |
|---|---|---|---|
| `POST /api/billing/cancel` | Schedule cancel at period end | `billing.update({ cancelAction: 'cancel_end_of_cycle' })` | leave `status:'active'`, set `canceledAt:Date.now()` and a synthetic `currentPeriodEnd` 30 days out so the UI can render the "ending" layout |
| `POST /api/billing/resume` | Reverse a scheduled cancel | `billing.update({ cancelAction: 'uncancel' })` | leave `status:'active'`, clear `canceledAt` |
| `POST /api/billing/payment-method` | Get a Stripe SetupIntent URL | `billing.setupPayment({ customerId, returnUrl })` | return `503 portal_unavailable_in_dev` |

`POST /api/billing/cancel` returns `{ ok:true, canceledAt, currentPeriodEnd }`.
`POST /api/billing/resume` returns `{ ok:true }`.
`POST /api/billing/payment-method` returns `{ url }`.

### Retired endpoint

`POST /api/billing/portal` is no longer called from the client. Keep
the route in the server for one release as a fallback, then remove.
Do not remove `getCustomerPortalUrl` from `autumn-billing.ts` in this
change.

## Client behavior

In `src/client/state.ts`:

- `State.cancelSubscription()` - opens a `confirm()` dialog with the
  text below, POSTs `/api/billing/cancel`, then awaits
  `loadBillingStatus()` so the panel re-renders with the
  scheduled-cancel layout.
- `State.resumeSubscription()` - POSTs `/api/billing/resume`, then
  awaits `loadBillingStatus()`. No confirmation - resuming is the
  safe direction.
- `State.openPaymentMethodUpdate()` - POSTs `/api/billing/payment-method`,
  then `window.location.assign(url)`. Replaces the old
  `openCustomerPortal` call site in `settings.ts`.

Keep `State.openCustomerPortal` defined (still used by `signup.ts`
fallback messaging until we remove it in a follow-up).

### Cancel confirmation copy

```
Cancel your Local-first subscription? You'll keep access until
<formatted period end date>. After that, this device returns to the
free plan and goes online-only. Local data on each device stays
until you turn off local storage.
```

### In-flight state

Cancel and resume both disable their button while the request is
in-flight and show a small inline spinner. Re-enable only after
`loadBillingStatus()` completes. This avoids the Autumn lag pitfall
already documented in `finalizeCheckout`.

### Error handling

A `503` from any of the three endpoints sets `billingError` and shows
a single inline message inside the Subscription panel
("Couldn't reach billing. Try again in a moment.") while keeping the
panel rendered with last-known data. Buttons re-enable so the user
can retry.

## File touch list

- `src/server/autumn-billing.ts` - add
  `getSubscriptionSnapshot(env, did)` returning
  `{ currentPeriodEnd, canceledAt }`; refactor `getCurrentPeriodEnd`
  to delegate to it; add `cancelSubscription(env, did)`,
  `resumeSubscription(env, did)`, `getPaymentSetupUrl(env, did, returnUrl)`.
- `src/server/index.ts` - extend `GET /api/billing/status` payload,
  add three new endpoints, update `resolveBilling` /
  `writeCachedBilling` to carry the new fields.
- `src/client/billing-status.ts` - extend `BillingStatus` interface.
- `src/client/state.ts` - add `cancelSubscription`,
  `resumeSubscription`, `openPaymentMethodUpdate`.
- `src/client/routes/settings.ts` - replace Subscription section
  contents; preserve free-tier branch and Local Storage section.
- `src/client/routes/settings.css` - styles for the new inline layout
  (uses existing CSS variables; no new colors).
- Tests - server endpoints under `test/server/`, client component
  under `test/client/routes/`.

## Testing strategy

- Server unit: in dev mode (no Autumn key), `POST /api/billing/cancel`
  sets `canceledAt` on the cached billing entry while leaving `status`
  as `'active'`; `POST /api/billing/resume` clears `canceledAt`.
- Server integration: 503 path returns `billing_unavailable` when
  Autumn throws.
- Client: render the Subscription section against three fixture
  states (active, scheduled-cancel, free) and assert the correct
  control set is present. Assert behavior (which button calls which
  state function), not exact text content.
- Manual / browser: exercise cancel -> panel updates to scheduled
  layout; resume -> panel updates back to active; payment method
  link navigates to a Stripe URL in live mode.

## Out of scope / follow-ups

- Approach B (Stripe Elements in-app card form) - if redirects become
  unacceptable later, swap `openPaymentMethodUpdate` for a Stripe
  Elements modal backed by a SetupIntent endpoint.
- Invoice history - add once Autumn exposes a documented list API or
  we add direct Stripe integration.
- Removing `POST /api/billing/portal` and `State.openCustomerPortal`
  in a follow-up release once the new flow has soaked.

## Implementation phases (for the plan-writing step)

1. Server: widen the Autumn snapshot, extend `GET /api/billing/status`.
2. Server: add cancel / resume / payment-method endpoints + dev-mode
   shims.
3. Client: extend `BillingStatus`, add state actions.
4. Client: rebuild the Subscription section UI and CSS.
5. Tests: server endpoint tests, client component tests.
6. Manual verification + cleanup of any unused portal call sites.
