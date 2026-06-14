# Client: Billing / Payment Methods

Last verified: 2026-06-13

## Purpose
Client-side surface for managing Stripe PaymentMethods. Mirrors the
server's `PaymentMethodsPayload` into `@preact/signals` and renders
Stripe Elements inside a `<modal-window>` web component.

## Contracts

### Signals module (`payment-methods.ts`)
- **Exposes**:
  - `paymentMethods:Signal<PaymentMethodSummary[]>`
  - `defaultMethodId:Signal<string|null>`
  - `paymentMethodsLoading:Signal<boolean>`
  - `paymentMethodsError:Signal<string|null>`
  - Setter helpers: `setPaymentMethodsState`, `setPaymentMethodsLoading`,
    `setPaymentMethodsError`, `resetPaymentMethods`
- **Guarantees**: Setter helpers wrap multi-signal writes in `batch()`
  (per project convention). Shape matches the server payload exactly.

### State actions (on `State` in `state.ts`)
- `State.loadPaymentMethods():Promise<void>` — `GET
  /api/billing/payment-methods`; sets loading + error + state
- `State.createSetupIntent():Promise<string>` — `POST
  /api/billing/payment-methods/setup-intent`; returns `clientSecret`
- `State.removePaymentMethod(id):Promise<void>` — `DELETE
  /api/billing/payment-methods/:id`; on 404 reloads canonical truth
- `State.setDefaultPaymentMethod(id):Promise<void>` — `POST
  /api/billing/payment-methods/:id/default`; handles the partial-failure
  502 shape by replacing local state from the embedded canonical list

**Removed:** `State.openPaymentMethodUpdate` (legacy URL-redirect flow).

### Component (`components/payment-method-modal.ts`)
- **Exposes**: `<PaymentMethodModal open onClose>` — controlled open
  state; never owns route state.
- **Guarantees**: Renders `@substrate-system/dialog`'s `<modal-window>`
  (NOT the native `<dialog>`); the element exposes `role="dialog"`,
  `aria-modal="true"`, and an `active="true|false"` attribute that
  drives open/close. Loads Stripe.js lazily via `@stripe/stripe-js/pure`'s
  `loadStripe()` using the publishable key from `billingStatus`. The
  `/pure` entrypoint defers injection of the Stripe.js `<script>` tag
  until `loadStripe()` is first awaited (i.e. when the modal opens),
  so the SDK is never on the initial-render critical path.
  `index.html` includes
  `<link rel="preconnect" crossorigin href="https://js.stripe.com">`
  to warm DNS/TLS for that deferred fetch.

## Dependencies
- **Uses**: `@stripe/stripe-js/pure` (deferred script injection;
  Elements + SetupIntent confirmation), types from `@stripe/stripe-js`,
  `@substrate-system/dialog`, server billing routes (see
  `src/server/CLAUDE.md`)
- **Used by**: `routes/settings.ts` — "Manage payment methods" button
- **Boundary**: `@stripe/stripe-js` (and `@stripe/stripe-js/pure`)
  stays confined to `payment-method-modal.ts` — that is the billing
  surface and the only place Stripe.js loads.
- **Note**: `@substrate-system/dialog` (`<modal-window>`) is NOT
  exclusive to this module. It is a shared client dependency; current
  importers are `components/payment-method-modal.ts` (this module) and
  `routes/settings.ts` (the "Share to Bluesky" consent modal). Adding a
  new `<modal-window>` consumer is fine — only the Stripe boundary above
  is exclusive.

## Key Decisions
- **Server is source of truth**: every mutation reads the canonical
  `PaymentMethodsPayload` from the response and replaces local state;
  the client never optimistically mutates `paymentMethods.value`.
- **`<modal-window>` over native `<dialog>`**: chosen for built-in
  focus-trap, animation hooks, and consistent a11y across browsers.
- **Setup-intent over hosted-page redirect**: the legacy
  `openPaymentMethodUpdate` flow (server returned an Autumn URL) was
  removed; we drive Stripe Elements in-page instead.

## Invariants
- Multi-signal writes always go through `batch()` (project rule).
- The modal renders nothing meaningful unless
  `billingStatus.value.stripePublishableKey` is set.
- Error codes mirror the server's wire codes (`stripe_unconfigured`,
  `payment_method_not_found`, `cannot_remove_default`, `stripe_error`).

## Key Files
- `payment-methods.ts` — signals + helpers
- `components/payment-method-modal.{ts,css}` — modal UI
- `state.ts` — the four payment-method actions on `State`

## Gotchas
- The `<modal-window>` element is a custom element imported for its
  side effect; `import { ModalWindow } from '@substrate-system/dialog'`
  triggers registration. Forgetting the import leaves a plain unknown
  element in the DOM.
- Stripe Elements iframes mean DOM-text assertions in tests are unsafe;
  test through the SDK stub instead (see `test/stripe-js-stub.ts`).
