# Client: Billing / Payment Methods

Last verified: 2026-05-18

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
  drives open/close. Loads Stripe.js lazily via `@stripe/stripe-js`'s
  `loadStripe()` using the publishable key from `billingStatus`.

## Dependencies
- **Uses**: `@stripe/stripe-js` (Elements + SetupIntent confirmation),
  `@substrate-system/dialog`, server billing routes (see
  `src/server/CLAUDE.md`)
- **Used by**: `routes/settings.ts` — "Manage payment methods" button
- **Boundary**: Only `payment-method-modal.ts` may import
  `@stripe/stripe-js` or `@substrate-system/dialog`.

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
