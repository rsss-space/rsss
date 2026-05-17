# Payment Method Modal Design

## Summary

Payment-method management moves from a redirect to a Stripe-hosted page into an
in-app modal built directly in the `/settings` route. The feature introduces a
Stripe Node SDK boundary on the Cloudflare Worker that sits alongside the
existing Autumn integration: Autumn continues to own entitlements and
subscription lifecycle, while the new `src/server/stripe-billing.ts` module
handles the `PaymentMethod` and `Customer` operations that Autumn does not
expose. Customer identity is resolved at request time by calling Autumn for the
customer object and extracting its `stripe_id` — no Stripe customer ID is
stored in the Durable Object.

On the client, a new `PaymentMethodModal` Preact component is backed by a
project-owned `<dialog>` primitive (using the platform's native `showModal()`
for focus-trap, backdrop, and Escape semantics without adding a dependency).
Card input uses Stripe's `PaymentElement` mounted inside the dialog and backed
by a `SetupIntent`; raw card data never reaches the Worker. All payment-method
operations (`list`, `add`, `remove`, `set-default`) are managed through four
new REST endpoints, each returning the canonical refreshed list on success so
the client never performs optimistic updates. The old redirect link and its
backing endpoint are deleted with no backwards-compatibility shim.

## Definition of Done

1. The "Update payment method" link in `/settings` opens an in-app modal overlay
   instead of redirecting to a Stripe-hosted page.
2. The modal uses Stripe Elements (`PaymentElement`) backed by a SetupIntent to
   add new payment methods. Raw card data never touches our app or our Cloudflare
   Worker; it flows directly between the user's browser and Stripe.
3. From within the modal, users can:
   - List their existing payment methods (brand, last4, exp).
   - Remove any non-default payment method.
   - Set a different existing payment method as default.
4. The current "This will open page on stripe.com." helper text is removed from
   the Subscription panel.
5. Errors (Stripe failures, network failures, validation failures) surface inline
   inside the modal. On success the modal closes and the Subscription panel
   re-reflects current billing state.
6. Dev workflow uses Stripe test keys via `.dev.vars` (server) and a
   `STRIPE_PUBLISHABLE_KEY` exposed to the client; production uses
   `wrangler secret put`. If Stripe credentials are missing the endpoints fail
   loud (no stubbing of payment endpoints).
7. The modal is implemented as a small project-owned Preact component built on
   the native `<dialog>` element (focus trap, backdrop, escape-to-close). No new
   modal/dialog dependency is added.
8. Empty-state behavior (a user opening the modal with zero payment methods on
   file) is **not** designed for. Every user with an active subscription is
   assumed to have a payment method on file.

## Acceptance Criteria

### payment-method-modal.AC1: Modal launches from the Settings page
- **payment-method-modal.AC1.1 Success:** Clicking "Manage payment methods"
  opens a native `<dialog>` via `showModal()` in `list` mode.
- **payment-method-modal.AC1.2 Success:** The URL is unchanged when the modal
  opens (no client-side route navigation, no full-page redirect).
- **payment-method-modal.AC1.3 Failure:** When the existing `useLive` flag is
  `false` (Autumn not configured), the Subscription panel renders the existing
  Free-plan branch and the "Manage payment methods" button is not rendered.

### payment-method-modal.AC2: Payment methods list loads
- **payment-method-modal.AC2.1 Success:** `GET /api/billing/payment-methods`
  returns `{methods, defaultId}` where each method has `id`, `brand`, `last4`,
  `expMonth`, `expYear`, and `isDefault` correctly populated.
- **payment-method-modal.AC2.2 Success:** Exactly one method has
  `isDefault: true` and it matches the returned `defaultId`.
- **payment-method-modal.AC2.3 Success:** The default method is visually
  distinguished in the list (e.g., a "Default" badge).
- **payment-method-modal.AC2.4 Failure:** When `STRIPE_SECRET_KEY` is unset on
  the worker, the endpoint returns `503 stripe_unconfigured`.

### payment-method-modal.AC3: Adding a new payment method (SetupIntent + PaymentElement)
- **payment-method-modal.AC3.1 Success:** Clicking "Add a card" calls
  `POST /api/billing/payment-methods/setup-intent` and receives
  `{clientSecret}`. The SetupIntent is created with `usage: 'off_session'`.
- **payment-method-modal.AC3.2 Success:** Stripe `PaymentElement` mounts inside
  the dialog using the `clientSecret`. Raw card data is never transmitted to
  our worker (verified by inspecting outgoing request bodies — no PAN, no
  CVC).
- **payment-method-modal.AC3.3 Success:** On successful `confirmSetup`, the
  dialog returns to `list` mode and `loadPaymentMethods()` is invoked so the
  list reflects the newly added card.
- **payment-method-modal.AC3.4 Failure:** A declined test card surfaces
  Stripe's `error.message` inline under the PaymentElement; the element
  remains mounted and the user can correct and resubmit without closing the
  modal.
- **payment-method-modal.AC3.5 Edge:** A 3DS/SCA test card triggers Stripe's
  challenge inside the PaymentElement iframe. On user completion the flow
  proceeds as success without additional worker code.
- **payment-method-modal.AC3.6 Edge:** Closing the modal mid-`confirmSetup`
  does not corrupt state. The `return_url` (`/settings`) ensures that the
  route-mount `loadPaymentMethods()` reflects truth on next page load.

### payment-method-modal.AC4: Removing a payment method
- **payment-method-modal.AC4.1 Success:** Clicking "Remove" on a non-default
  row switches the dialog into `confirming-remove` mode (mode change within
  the same dialog, not a nested dialog).
- **payment-method-modal.AC4.2 Success:** Confirming the remove calls
  `DELETE /api/billing/payment-methods/:id`. The response replaces the
  `paymentMethods` signal with the canonical refreshed list; the removed
  card is no longer present.
- **payment-method-modal.AC4.3 Failure:** The "Remove" button on the default
  row is disabled with a tooltip: "Set another card as default first."
- **payment-method-modal.AC4.4 Failure:** Server-side defense-in-depth — if a
  `DELETE` is submitted for the current default id, the worker returns
  `409 cannot_remove_default` and the client surfaces the message inline.
- **payment-method-modal.AC4.5 Failure:** `DELETE` for an unknown id returns
  `404 payment_method_not_found`; the client refetches the canonical list
  and shows an inline notice that the card was already removed.
- **payment-method-modal.AC4.6 Edge:** Removing the last non-default card
  leaves a list containing only the default; the modal stays open in `list`
  mode.

### payment-method-modal.AC5: Setting a different default
- **payment-method-modal.AC5.1 Success:** Clicking "Set as default" on a
  non-default row calls `POST /api/billing/payment-methods/:id/default`.
- **payment-method-modal.AC5.2 Success:** The endpoint updates
  `customer.invoice_settings.default_payment_method` on Stripe.
- **payment-method-modal.AC5.3 Success:** The endpoint also updates the active
  subscription's `default_payment_method` on Stripe.
- **payment-method-modal.AC5.4 Success:** The response includes the canonical
  refreshed list; the default badge moves to the newly chosen row in the UI.
- **payment-method-modal.AC5.5 Failure:** If the customer-default update
  succeeds but the subscription-default update fails, the endpoint returns
  `502 stripe_error` with both states described in the body. The client
  refetches the canonical list and surfaces an inline banner explaining
  the partial state.
- **payment-method-modal.AC5.6 Failure:** `POST /default` for an unknown id
  returns `404 payment_method_not_found`; client refetches and shows an
  inline notice.
- **payment-method-modal.AC5.7 Edge:** The "Set as default" affordance is not
  rendered on the row that is already the default.

### payment-method-modal.AC6: Cleanup of legacy redirect path
- **payment-method-modal.AC6.1 Success:** The `<a>` "Update payment method"
  link no longer exists in the Subscription panel
  (`src/client/routes/settings.ts:442-525`).
- **payment-method-modal.AC6.2 Success:** The "This will open page on
  stripe.com." `<p>` helper text no longer exists in the Subscription panel.
- **payment-method-modal.AC6.3 Success:** `State.openPaymentMethodUpdate()` at
  `src/client/state.ts:1497-1517` and the redirect-URL-returning behavior of
  the old `POST /api/billing/payment-method` endpoint are deleted (no
  backwards-compatibility shim).

### payment-method-modal.AC7: Dialog primitive correctness (a11y)
- **payment-method-modal.AC7.1 Success:** The `<dialog>` opens via
  `showModal()` and keyboard focus is moved inside the dialog.
- **payment-method-modal.AC7.2 Success:** Pressing `Escape` closes the dialog
  via the native cancel event; the `onClose` callback runs exactly once.
- **payment-method-modal.AC7.3 Success:** Clicking the backdrop closes the
  dialog; clicking on the dialog's own content does not.
- **payment-method-modal.AC7.4 Success:** On close, keyboard focus is
  restored to the "Manage payment methods" trigger button.
- **payment-method-modal.AC7.5 Success:** The dialog has `aria-labelledby`
  pointing to its heading; inline errors are surfaced with
  `aria-describedby`.

### payment-method-modal.AC8: Cross-cutting behaviors
- **payment-method-modal.AC8.1:** Every mutation endpoint
  (`POST /setup-intent`, `DELETE /:id`, `POST /:id/default`) returns the
  canonical refreshed `{methods, defaultId}` list on success, and the client
  always replaces its signals from the response — no optimistic updates.
- **payment-method-modal.AC8.2:** Every multi-signal state update in
  `src/client/payment-methods.ts` and the modal component uses `batch()`
  from `@preact/signals`.
- **payment-method-modal.AC8.3:** Network failures during any mutation
  surface as an inline error inside the dialog and leave the dialog open in
  its current mode (no toast, no redirect).

## Glossary

- **Autumn (autumn-js)**: A subscription and entitlement management layer used
  by this app to track whether a user has a paid plan (`useLive` flag) and to
  drive the checkout flow. Autumn holds the canonical customer record whose
  `stripe_id` field this feature reads for all Stripe API calls.
- **Stripe Elements / `PaymentElement`**: Stripe's official embeddable UI
  component. `PaymentElement` is the all-in-one variant that renders inside an
  iframe owned by Stripe; raw card numbers and CVCs never touch application
  code.
- **SetupIntent**: A Stripe object that authorizes saving a payment method for
  future use. Creating one returns a `clientSecret` the browser passes to
  `PaymentElement`; the Worker receives only the resulting `pm_*` ID.
- **`off_session` usage flag**: A SetupIntent parameter telling Stripe this
  card will be charged in the future without the customer present (i.e., for
  recurring subscription billing), which triggers the appropriate 3DS/SCA
  exemption logic.
- **Stripe Customer**: A Stripe-side record (`cus_*`) that owns payment methods
  and an `invoice_settings.default_payment_method` pointer. Distinct from an
  Autumn "customer" — the Autumn record is what the Worker queries to obtain
  the `cus_*` ID.
- **Cloudflare Durable Object SQLite**: The per-user stateful compute primitive
  that backs the server. Each user's data (feeds, session, billing state)
  lives in a SQLite database scoped to their Durable Object instance.
- **`Stripe.createFetchHttpClient()`**: A Stripe SDK option that replaces the
  Node.js `http` module with the platform `fetch` API, required for the SDK to
  run inside the Cloudflare Workers runtime.
- **`@preact/signals` `batch()`**: A function that groups multiple signal
  writes into a single re-render cycle, used throughout the client to keep UI
  state consistent when several signals must update together.
- **Hono**: The HTTP router used on the Cloudflare Worker. New billing
  endpoints are registered in `src/server/index.ts` using its `app.get` /
  `app.post` / `app.delete` API.
- **tapzero (`@substrate-system/tapzero`)**: The test framework used in this
  project. Worker-layer tests call the Hono app directly via `app.request()`
  with helper factories (`makeEnv`, `makeSession`) to avoid a running server.
- **`useLive` flag**: A boolean signal returned by `GET /api/billing/status`
  that indicates whether the Autumn/Stripe integration is configured. The
  Subscription panel gates all billing UI on this flag; when `false`, the
  "Manage payment methods" button is not rendered.

## Architecture

Payment-method management moves from a redirect-to-Stripe link into an in-app
modal in `/settings`. Card data continues to flow directly between the browser
and Stripe via the official `PaymentElement`; our Cloudflare Worker only
handles `pm_*` IDs and metadata (brand, last4, exp). The existing Autumn
integration is preserved for entitlements, checkout, and subscription lifecycle.
The Stripe Node SDK is introduced alongside Autumn on the worker, used directly
for `PaymentMethod` and `Customer.invoice_settings` operations that Autumn does
not expose.

**Worker layer.** A new module `src/server/stripe-billing.ts` mirrors the
shape of `src/server/autumn-billing.ts`. It exports `getStripe(c)` (per-request
SDK instantiation with `Stripe.createFetchHttpClient()`) and
`getStripeCustomerId(c, autumnId)` (pull-through resolver that calls Autumn for
the customer object on every request, then returns its `stripe_id`). Four new
routes are registered in `src/server/index.ts`:

- `GET /api/billing/payment-methods` -> canonical list + default id
- `POST /api/billing/payment-methods/setup-intent` -> `{clientSecret}` for
  PaymentElement (rename + repurpose of today's
  `POST /api/billing/payment-method`)
- `DELETE /api/billing/payment-methods/:id` -> refreshed list (409 when
  attempting to detach the default)
- `POST /api/billing/payment-methods/:id/default` -> refreshed list (best-effort
  syncs both `customer.invoice_settings.default_payment_method` and the active
  subscription's `default_payment_method`)

Every mutation endpoint returns the canonical refreshed
`{methods, defaultId}` payload so the client never has to manually reconcile.

**Client layer.** A new module `src/client/payment-methods.ts` mirrors the
shape of `src/client/billing-status.ts` and owns the new module-level signals
`paymentMethods`, `defaultMethodId`, `paymentMethodsLoading`,
`paymentMethodsError`, plus state actions on `State` for load, remove,
set-default, and create-setup-intent. A new component
`src/client/components/payment-method-modal.ts` is a small Preact component
backed by modal-scoped signals (`mode`, `removeCandidate`,
`setupIntentSecret`, `elementsInstance`, `addCardError`). Mounted in the
Subscription panel and opened by a new "Manage payment methods" button (the
old `<a>` link and stripe.com helper text are deleted).

**Dialog primitive.** A new project-owned component
`src/client/components/dialog.ts` wraps the native HTML `<dialog>` element
with `showModal()`/`close()`, focus management, `Escape` close,
backdrop-click close, and the `aria-labelledby` / `aria-describedby` pattern.
No new dependency. Reusable for future settings UI surfaces.

**Data flow.**

1. Route mount on `/settings` calls both `State.loadBillingStatus()` and
   `State.loadPaymentMethods()` (existing pattern at
   `src/client/routes/settings.ts:65-71`).
2. Click "Manage payment methods" -> dialog opens in `list` mode rendering
   from the already-populated `paymentMethods` signal.
3. Click "Add a card" -> dialog enters `adding` mode,
   `State.createSetupIntent()` returns a `clientSecret`, Stripe Elements
   mounts inside the dialog.
4. Stripe `confirmSetup()` -> on `succeeded`, refetch via
   `loadPaymentMethods()` and return to `list` mode.
5. Click "Set as default" on a row -> `setDefaultPaymentMethod(id)` -> server
   returns canonical list, signal replaced via `batch()`.
6. Click "Remove" on a non-default row -> dialog enters `confirming-remove`
   mode with the id; confirming triggers `removePaymentMethod(id)` -> server
   returns canonical list -> return to `list` mode.
7. Dialog `onClose` resets modal-local signals via `batch()`.

## Existing Patterns

The design follows established patterns in the codebase:

- **Server billing module shape:** `src/server/stripe-billing.ts` mirrors
  `src/server/autumn-billing.ts:25-310`: an env-gated `useLive()` style
  guard, per-request SDK instantiation, narrow helper functions exported to
  route handlers in `src/server/index.ts`.
- **Hono route + CSRF + session pattern:** new endpoints reuse the same
  middleware stack as today's `POST /api/billing/payment-method` at
  `src/server/index.ts:1462-1465` and `GET /api/billing/status` at
  `src/server/index.ts:859`.
- **Client typed fetch:** mutations use the `ky.create()` instance at
  `src/client/state.ts:1000-1010` (CSRF token injected, `throwHttpErrors`
  pattern with try/catch + signal updates inside `batch()`), mirroring
  `State.openPaymentMethodUpdate()` at `src/client/state.ts:1497-1517`.
- **Signal modules with `batch()`:** the new `src/client/payment-methods.ts`
  follows the shape of `src/client/billing-status.ts`, including the use of
  `batch()` for any multi-signal update, per the project CLAUDE.md.
- **Env gating + dev posture:** the Subscription panel continues to gate on
  the existing `useLive` signal (returned by `GET /api/billing/status` at
  `src/server/index.ts:859`). With Stripe test keys configured in
  `.dev.vars`, the modal runs for real in dev. When `STRIPE_SECRET_KEY` is
  unset, every new endpoint returns `503 stripe_unconfigured` (loud failure;
  no stubbing).
- **Publishable values surfaced via API:** the Stripe publishable key is
  added to the existing `GET /api/billing/status` response rather than
  injected at build time, matching how `useLive` is surfaced today
  (`src/client/billing-status.ts:16`).
- **Test framework:** `@substrate-system/tapzero` with the
  `makeEnv()` / `makeSession()` / `app.request()` / `withFetch()` helper
  pattern from `src/test/billing-management.ts:350-419`.

**Divergence introduced (with justification):**

- **Native `<dialog>`-based modal primitive.** Investigation found only a
  popover at `src/client/components/cache-status.ts:124-155` that uses
  `role="dialog"` without the native element. A full modal needs the
  platform's focus-trap, restore-focus, and inert-background semantics —
  `<dialog>.showModal()` provides these for free. The new
  `src/client/components/dialog.ts` is reusable for future settings UI and
  introduces no dependency.

## Implementation Phases

<!-- START_PHASE_1 -->
### Phase 1: Stripe SDK boundary on the worker
**Goal:** Add the Stripe Node SDK to the worker and provide a typed,
per-request handle plus the Autumn pull-through customer resolver. No new
endpoints yet — only the plumbing.

**Components:**
- `stripe` npm dependency in `package.json` (current stable, supports the
  fetch http client)
- `STRIPE_SECRET_KEY` declared in `.dev.vars` (untracked) and documented in
  `.dev.vars.example` if one exists, plus in `wrangler.jsonc` `vars` /
  secrets bindings as appropriate
- `src/server/stripe-billing.ts` exporting:
  - `stripeUseLive(env):boolean` — true iff `STRIPE_SECRET_KEY` is set
  - `getStripe(c):Stripe` — per-request, `Stripe.createFetchHttpClient()`
  - `getStripeCustomerId(c, autumnId):Promise<string>` — Autumn pull-through
- No route registration; this phase is library only.

**Dependencies:** None.

**Done when:** `npm install` succeeds, `npm run build` (or
`wrangler dev --build` equivalent) succeeds, type-check passes,
`npm run lint` passes. A trivial unit test imports the module and verifies
`stripeUseLive()` reads the env var. No acceptance-criteria coverage in this
phase (infrastructure only).
<!-- END_PHASE_1 -->

<!-- START_PHASE_2 -->
### Phase 2: Read endpoint + client signal
**Goal:** Wire up the read path end-to-end so the rest of the UI work has
real data to render.

**Components:**
- `GET /api/billing/payment-methods` route in `src/server/index.ts` returning
  `{methods:PaymentMethodSummary[], defaultId:string|null}` using
  `getStripeCustomerId()` + `stripe.paymentMethods.list({customer, type:'card'})`
  + `stripe.customers.retrieve(customer).invoice_settings.default_payment_method`.
  Returns `503` when `!stripeUseLive`, `502` on Stripe errors.
- `src/client/payment-methods.ts` exporting the four module-level signals
  (`paymentMethods`, `defaultMethodId`, `paymentMethodsLoading`,
  `paymentMethodsError`) and `State.loadPaymentMethods()` action.
- Route mount effect in `src/client/routes/settings.ts:65-71` adds
  `loadPaymentMethods()` alongside `loadBillingStatus()`.
- The `useLive` flag returned by `GET /api/billing/status` is extended to
  also carry `stripePublishableKey:string|null`; client picks it up in
  `src/client/billing-status.ts`.

**Dependencies:** Phase 1.

**Done when:** Tests in `src/test/payment-methods.ts` verify:
- `payment-method-modal.AC2.1`, `payment-method-modal.AC2.2`,
  `payment-method-modal.AC2.3`, `payment-method-modal.AC2.4`
<!-- END_PHASE_2 -->

<!-- START_PHASE_3 -->
### Phase 3: Native `<dialog>` primitive
**Goal:** Build the reusable modal primitive in isolation so later phases
can mount payment UI inside it without simultaneous dialog work.

**Components:**
- `src/client/components/dialog.ts` exporting a `Dialog` Preact component:
  - Props: `open:boolean`, `onClose:()=>void`, `labelledBy:string`, `children`
  - Uses `<dialog>` element with `showModal()` on transition to open,
    `close()` on transition to closed
  - `Escape` closes via platform default
  - Backdrop click closes (detect by `e.target === dialogRef.current`)
  - Re-emits `cancel` and `close` events as `onClose`
  - Focuses the first focusable child on open (heading by default)
- Companion CSS in a sibling `dialog.css` (per project nested-selector style,
  using `_variables.css` tokens)
- A standalone visual test page or storybook-equivalent if present in the
  project; otherwise a smoke test page route gated to dev.

**Dependencies:** Phase 1 only (independent of Phase 2 data work; can run
in parallel if desired).

**Done when:** Tests verify the dialog opens, closes via the close handler,
closes on Escape, closes on backdrop click but not on internal click, and
restores focus to the trigger. Covers `payment-method-modal.AC7.1`, `payment-method-modal.AC7.2`,
`payment-method-modal.AC7.3`, `payment-method-modal.AC7.4`, `payment-method-modal.AC7.5`.
<!-- END_PHASE_3 -->

<!-- START_PHASE_4 -->
### Phase 4: Add-a-card path (SetupIntent + PaymentElement)
**Goal:** End-to-end add a new payment method without leaving the app.

**Components:**
- Rename `POST /api/billing/payment-method` -> 
  `POST /api/billing/payment-methods/setup-intent` in `src/server/index.ts`;
  body is `{}`; response is `{clientSecret:string}`. Old URL-returning
  behavior deleted (no compat shim).
- Implementation: `stripe.setupIntents.create({customer, usage:'off_session',
  automatic_payment_methods:{enabled:true}})`; returns `{clientSecret}`.
  Returns `503` when `!stripeUseLive`, `502` on Stripe errors.
- `@stripe/stripe-js` added to `package.json`.
- `src/client/components/payment-method-modal.ts` Preact component with
  modal-scoped signals: `mode:'list'|'adding'|'confirming-remove'`,
  `setupIntentSecret`, `elementsInstance`, `addCardError`,
  `removeCandidate`.
- Modal mounts a stub list (no remove/default actions yet — pure render of
  `paymentMethods`). The "Add a card" affordance switches `mode='adding'`,
  calls `State.createSetupIntent()`, then `loadStripe(publishableKey)` ->
  `stripe.elements({clientSecret})` -> `elements.create('payment').mount(...)`.
  Submit handler calls `stripe.confirmSetup({elements, confirmParams:
  {return_url: '/settings'}})`. On success: `loadPaymentMethods()`,
  `mode='list'`. On error: surface `error.message` inline; element stays
  mounted; user can retry.
- Subscription panel in `src/client/routes/settings.ts` replaces the
  `<a>` "Update payment method" link and the "This will open page on
  stripe.com." `<p>` with a `<button>` "Manage payment methods" that opens
  the new modal. Legacy `State.openPaymentMethodUpdate()` at
  `src/client/state.ts:1497-1517` is removed.

**Dependencies:** Phases 1, 2, 3.

**Done when:** Server tests in `src/test/payment-methods.ts` and state-action
tests cover:
- `payment-method-modal.AC1.1`, `payment-method-modal.AC1.2`,
  `payment-method-modal.AC1.3`,
  `payment-method-modal.AC3.1`, `payment-method-modal.AC3.2`,
  `payment-method-modal.AC3.3`, `payment-method-modal.AC3.4`,
  `payment-method-modal.AC3.6`,
  `payment-method-modal.AC6.1`, `payment-method-modal.AC6.2`,
  `payment-method-modal.AC6.3`,
  `payment-method-modal.AC8.1`, `payment-method-modal.AC8.2`,
  `payment-method-modal.AC8.3`
<!-- END_PHASE_4 -->

<!-- START_PHASE_5 -->
### Phase 5: Remove + set-default paths
**Goal:** Complete the multi-method management surface.

**Components:**
- `DELETE /api/billing/payment-methods/:id` in `src/server/index.ts`:
  loads current `{methods, defaultId}`; if `:id == defaultId`, returns
  `409 cannot_remove_default`; else `stripe.paymentMethods.detach(:id)` and
  returns the refreshed canonical list.
- `POST /api/billing/payment-methods/:id/default` in `src/server/index.ts`:
  `stripe.customers.update(customer, {invoice_settings:
  {default_payment_method: :id}})`, then on the user's active subscription
  `stripe.subscriptions.update(sub, {default_payment_method: :id})`; returns
  refreshed canonical list. If the subscription update fails, returns
  `502 stripe_error` with both states reported (no rollback; client
  refetches truth).
- `State.removePaymentMethod(id)`, `State.setDefaultPaymentMethod(id)` in
  `src/client/payment-methods.ts`; each replaces signals from the response
  via `batch()`.
- Modal `list` mode renders per-row actions: "Set as default" on
  non-defaults, "Remove" on non-defaults, disabled "Remove" with tooltip on
  default ("Set another card as default first"). `confirming-remove` mode
  shows the inline confirmation (mode change, not a nested dialog), with
  per-row loading spinner during mutations.

**Dependencies:** Phases 1, 2, 3, 4.

**Done when:** Tests cover:
- `payment-method-modal.AC4.1`, `payment-method-modal.AC4.2`,
  `payment-method-modal.AC4.3`, `payment-method-modal.AC4.4`,
  `payment-method-modal.AC4.5`, `payment-method-modal.AC4.6`,
  `payment-method-modal.AC5.1`, `payment-method-modal.AC5.2`,
  `payment-method-modal.AC5.3`, `payment-method-modal.AC5.4`,
  `payment-method-modal.AC5.5`, `payment-method-modal.AC5.6`,
  `payment-method-modal.AC5.7`
<!-- END_PHASE_5 -->

<!-- START_PHASE_6 -->
### Phase 6: Manual smoke test + test plan
**Goal:** Verify the feature against Stripe test mode end-to-end and
capture a reproducible manual test plan.

**Components:**
- `docs/test-plans/2026-05-17-payment-method-modal.md` documenting the manual
  steps: configure `.dev.vars` with Stripe test secret + publishable keys,
  open the modal, add `4242 4242 4242 4242`, add `5555 5555 5555 4444`,
  swap default, remove non-default, attempt to remove default and verify
  the action is disabled, trigger 3DS with `4000 0027 6000 3184`.
- No new product code; this phase only verifies and documents.

**Dependencies:** Phases 1-5.

**Done when:** Manual walkthrough passes against Stripe test mode and the
test plan is checked in. Test plan exercises `payment-method-modal.AC2.4`
(loud failure when creds missing) and `payment-method-modal.AC3.5`
(3DS challenge inline) end-to-end against the real Stripe test environment.
<!-- END_PHASE_6 -->

## Additional Considerations

**Error handling.** All errors surface inline inside the dialog — no toasts,
no redirects. Server returns typed error codes (`stripe_unconfigured`,
`stripe_error`, `cannot_remove_default`, `payment_method_not_found`); client
maps each to a human-readable message. The "set default" best-effort
partial-failure path (customer-default succeeded, subscription-default
failed) returns `502 stripe_error` with both states reported and the client
refetches the canonical list so the UI reflects truth.

**Resilience to mid-flow modal close.** If the user closes the modal while
Stripe's `confirmSetup` is in-flight, the SetupIntent may still complete
server-side and the card may attach. The `return_url` is set to `/settings`,
so on the user's next visit the route-mount `loadPaymentMethods()` reflects
the new state. No special recovery code is needed.

**Webhooks.** Out of scope for v1. Modal mutations are user-initiated and
synchronous from the user's perspective; no async reconciliation infrastructure
is needed. A future enhancement could subscribe to `payment_method.attached`,
`payment_method.detached`, and `customer.updated` to keep state in sync with
out-of-band changes (e.g., bank-issued card replacement). Architecture does
not preclude this — adding a webhook endpoint later requires no refactor of
the modal or the existing endpoints.

**Future extensibility — multiple subscriptions.** Today every user has
exactly one active subscription. The "set default" path updates both the
customer-level default and the single active subscription's default. If the
app ever supports multiple concurrent subscriptions per user, the
subscription-default update becomes an iteration over `subscriptions.list({customer, status:'active'})`. No data-model change is required.

**Dependency footprint.** Adds `stripe` (server) and `@stripe/stripe-js`
(client). Both are official packages and dropping them later only requires
deleting the new endpoints and modal — Autumn integration is untouched.
