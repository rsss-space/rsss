# Test Requirements — payment-method-modal

**Feature:** payment-method-modal
**Generated:** 2026-05-17
**Coverage summary:** 35 acceptance criteria total — 28 fully Automated,
4 Hybrid (partial automation + manual smoke), 3 Human-verification only.

This document maps every acceptance criterion from
`DOCS/design-plans/2026-05-17-payment-method-modal.md` to the test code
that exercises it, or to the human verification step that does. It is
the canonical bridge between design intent, automated suite, and the
manual test plan at
`DOCS/test-plans/2026-05-17-payment-method-modal.md`.

Each AC is tagged with one of three types:

- **Automated** — exercised by a test in the project's automated suite.
  The `File / Plan section` column points at the file (and, where
  helpful, the test name or AC label inside it).
- **Hybrid** — partially exercised by an automated test, then finished
  by a manual smoke step. Both anchors are listed.
- **Human verification** — verified by a step in
  `DOCS/test-plans/2026-05-17-payment-method-modal.md` only. These ACs
  depend on real browser / real Stripe Elements behavior that the test
  stubs cannot faithfully model.

---

## AC1 — Modal launches from the Settings page

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC1.1 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC1.1 / AC1.2") | After mounting the modal with `open=true`, a `<dialog.app-dialog.payment-method-modal>` is in the DOM, `dialog.open === true`, and two seeded `.pm-row` entries are rendered (proving `list` mode). |
| AC1.2 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC1.1 / AC1.2") | `window.location.href` recorded before opening is identical after opening — opening the modal does not navigate or redirect. |
| AC1.3 | Automated | `test/settings-route.ts` (existing UI-DOM gating test) + `test/payment-method-modal.ts` (test "AC1.3") | When `billingStatus.useLive === false`, the Subscription panel does not render the "Manage payment methods" trigger; if a caller force-mounts the modal anyway, attempting to add a card surfaces the `stripe_unconfigured` inline error because the publishable key is null. |

## AC2 — Payment methods list loads

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC2.1 | Automated | `test/payment-methods.ts` (server-integration, test "returns canonical list and default id") | A successful `GET /api/billing/payment-methods` returns a body where each method has the normalized fields `id`, `brand`, `last4`, `expMonth`, `expYear`, `isDefault` and they are populated from the mocked Stripe responses. |
| AC2.2 | Automated | `test/payment-methods.ts` (server-integration, test "returns canonical list and default id") | The response has exactly one method with `isDefault: true`, and that method's `id` equals the top-level `defaultId`. |
| AC2.3 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC2.3: The default method row shows a Default badge") | The DOM row matching the default method's `last4` contains a `.pm-default-badge`; the non-default row does not. Note: the data shape supporting this AC ships in Phase 2; the visual badge is implemented and tested in Phase 4 (this is the explicit AC2.3 deferral). |
| AC2.4 | Hybrid | Automated: `test/payment-methods.ts` (server-integration, test "returns 503 when STRIPE_SECRET_KEY is unset"). Manual: `DOCS/test-plans/2026-05-17-payment-method-modal.md` Phase F steps 1-4. | Automated half: the endpoint responds with HTTP 503 and `{ error: 'stripe_unconfigured' }` when the secret env var is unset. Manual half: with the env var commented out in `.dev.vars` and the dev server restarted, the user-visible UX is loud failure (inline error in the modal, 503 visible in the Network panel) rather than silent success. Both halves are explicitly named in the Phase 6 coverage list. |

## AC3 — Adding a new payment method (SetupIntent + PaymentElement)

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC3.1 | Automated | `test/payment-methods.ts` (server-integration, test "creates a SetupIntent with usage=off_session and returns clientSecret") | `POST /api/billing/payment-methods/setup-intent` returns HTTP 200 with `{ clientSecret }`, and the URL-encoded body sent to `api.stripe.com/v1/setup_intents` contains `customer=cus_...`, `usage=off_session`, and `automatic_payment_methods[enabled]=true`. |
| AC3.2 | Automated | `test/payment-methods.ts` (server-integration, test "creates a SetupIntent with usage=off_session and returns clientSecret") | The same outgoing-body assertion confirms the worker's request to Stripe contains no `card`, `number`, or `cvc` substring — proving raw card data does not transit our worker (it travels browser ↔ Stripe inside the PaymentElement iframe). |
| AC3.3 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC3.3 / AC8.1: Successful confirmSetup refreshes the list") | After the stub returns a successful `confirmSetup` and `Save card` is clicked, `State.loadPaymentMethods` is called exactly once and the modal returns to `list` mode (the `.pm-list` element is rendered again). |
| AC3.4 | Hybrid | Automated: `test/payment-method-modal.ts` (UI-DOM, test "AC3.4 / AC8.3: Declined card surfaces error and stays in adding mode"). Manual: `DOCS/test-plans/2026-05-17-payment-method-modal.md` Phase B step 4. | Automated half: the inline `.pm-error` shows the stub's decline message and the `.pm-element-host` remains in the DOM (proving the modal stays in `adding` mode). Manual half: against real Stripe Elements with the declined test card `4000 0000 0000 0002`, the user can edit the PaymentElement and resubmit without closing — the test stub returns a one-shot result so resubmission with corrected data must be verified by hand (this hybrid split is called out in Phase 4 Task 7's "Partial-automation note"). |
| AC3.5 | Human verification | `DOCS/test-plans/2026-05-17-payment-method-modal.md` Phase B step 5 | With the 3DS test card `4000 0027 6000 3184`, Stripe renders its 3DS challenge UI inside the PaymentElement iframe; completing the challenge returns the user to the parent modal with the new card in the list, with no full-page redirect. The 3DS iframe is owned by Stripe's CDN and cannot be reproduced by an in-process test stub, so this is verified end-to-end only. |
| AC3.6 | Hybrid | Automated: `test/payment-method-modal.ts` (UI-DOM, test "AC3.6: Closing the modal mid-flow resets to list on next open"). Manual: `DOCS/test-plans/2026-05-17-payment-method-modal.md` Phase B step 6. | Automated half: closing the modal while in `adding` mode and reopening lands in `list` mode with `.pm-element-host` removed, proving modal-scoped state resets cleanly. Manual half: the actual `stripe.elements()` and `PaymentElement.unmount()` cleanup paths use real Stripe SDK objects that the test stub does not model faithfully (`create()`/`getElement()` return distinct no-op objects). Phase 4 Task 7's "Partial-automation note" requires manual verification that the SetupIntent's `return_url=/settings` + route-mount `loadPaymentMethods()` reflects truth after a real mid-flow close. |

## AC4 — Removing a payment method

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC4.1 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC4.1: Clicking Remove enters confirming-remove mode") | After clicking the enabled Remove button on a non-default row, the modal renders the `.pm-confirm-text` element — i.e. `mode === 'confirming-remove'` within the same `<dialog>`, not a nested dialog. |
| AC4.2 | Automated | `test/payment-methods.ts` (server-integration, test "removes non-default and returns canonical refreshed list") | `DELETE /api/billing/payment-methods/:id` calls `paymentMethods.detach` against Stripe, returns HTTP 200 with the refreshed `{ methods, defaultId }`, and the deleted id is absent from `methods`. |
| AC4.3 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC4.3: Remove button is disabled on the default row") | The Remove button rendered on the default row has `disabled === true` and `title === 'Set another card as default first.'`. |
| AC4.4 | Automated | `test/payment-methods.ts` (server-integration, test "returns 409 cannot_remove_default for the current default id") | Sending `DELETE` for the current default id yields HTTP 409 with `{ error: 'cannot_remove_default' }` and never calls Stripe's detach endpoint. |
| AC4.5 | Automated | `test/payment-methods.ts` (server-integration, test "returns 404 payment_method_not_found when Stripe says resource_missing") | When Stripe responds with `resource_missing` on detach, the endpoint maps it to HTTP 404 with `{ error: 'payment_method_not_found' }`. The client-side refetch + inline notice path is covered by the unit-shape of `State.removePaymentMethod` which calls `loadPaymentMethods()` on 404 (asserted indirectly by the surrounding `payment-method-modal.ts` tests that exercise the same code path). |
| AC4.6 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC4.6: Removing the last non-default leaves only the default") | After confirming a remove on the only non-default card, the DOM shows exactly one `.pm-row`, the modal is still in `list` mode (`.pm-list` present), and `dialog.open === true`. |

## AC5 — Setting a different default

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC5.1 | Automated | `test/payment-methods.ts` (server-integration, test "updates customer + subscription and returns canonical list") | `POST /api/billing/payment-methods/:id/default` reaches the handler and triggers the expected outbound Stripe calls (i.e. the route is wired up and the client action targets the right URL — proved by the matching fixture handlers firing). |
| AC5.2 | Automated | `test/payment-methods.ts` (server-integration, test "updates customer + subscription and returns canonical list") | The outgoing POST to `api.stripe.com/v1/customers/cus_...` carries `invoice_settings[default_payment_method]=pm_visa` in its URL-encoded body. |
| AC5.3 | Automated | `test/payment-methods.ts` (server-integration, test "updates customer + subscription and returns canonical list") | A subscription is discovered via `subscriptions.list` and the followup POST to `api.stripe.com/v1/subscriptions/sub_...` carries `default_payment_method=pm_visa`. |
| AC5.4 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC5.4 + AC5.7: Set as default moves the badge…") + `test/payment-methods.ts` (server-integration, "updates customer + subscription…") | Server side: response includes refreshed `methods`/`defaultId` with `pm_visa.isDefault === true`. UI side: after clicking "Set as default" on the visa row, the `.pm-default-badge` is now under the visa row. |
| AC5.5 | Automated | `test/payment-methods.ts` (server-integration, "returns 502 with both states when subscription update fails") + `test/payment-method-modal.ts` (UI-DOM, "AC5.5: Partial-failure surface…" + "AC5.5: State.setDefaultPaymentMethod handles 502 partial-failure shape…") | Server: returns HTTP 502 with `error: 'stripe_error'`, `customerDefaultUpdated: true`, `subscriptionDefaultUpdated: false`, plus a canonical `{methods, defaultId}` body. Client: `State.setDefaultPaymentMethod` replaces signals from the 502 body and throws; the modal surfaces an inline `.pm-error` referencing the partial-failure code. |
| AC5.6 | Automated | `test/payment-methods.ts` (server-integration, test "returns 404 for unknown PM") | When Stripe responds with `resource_missing` on `customers.update`, the endpoint maps it to HTTP 404 with `{ error: 'payment_method_not_found' }`; the client action calls `loadPaymentMethods()` on 404 (covered by `State.setDefaultPaymentMethod`'s implementation, which the surrounding modal tests exercise). |
| AC5.7 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC5.4 + AC5.7…") | The default row contains no button whose text matches `/set as default/i`, while the non-default row does. |

## AC6 — Cleanup of legacy redirect path

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC6.1 | Automated | `test/settings-route.ts` (existing UI-DOM gating test asserting the new "Manage payment methods" trigger) + grep gate in Phase 4 Task 8 Done-when | The Subscription panel renders the "Manage payment methods" button when `useLive` is true; the legacy "Update payment method" `<a>`/button no longer appears in the rendered output. The Done-when of Phase 4 additionally requires a successful grep absence check on the legacy string. |
| AC6.2 | Automated | Phase 4 Task 8 Done-when (grep absence of "This will open page on stripe.com." in `src/client/routes/settings.ts`) | The legacy hint paragraph string is gone from the source. Backed by `test/settings-route.ts` exercising the rendered Subscription panel, which would not contain the deleted node. |
| AC6.3 | Automated | Phase 4 Task 8 Done-when (grep absence of `openPaymentMethodUpdate`) + `test/payment-methods.ts` (server-integration: the renamed route at `/api/billing/payment-methods/setup-intent` is the one under test, proving the old `POST /api/billing/payment-method` URL was repurposed without a compat shim) | Source no longer contains the legacy state action; the old endpoint URL is gone from the route table (its tests now target the new path). |

## AC7 — Dialog primitive correctness (a11y)

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC7.1 | Automated | `test/dialog.ts` (UI-DOM, test "AC7.1: Dialog opens via showModal() when `open` becomes true") | After mount, `dialog.open === true` and the `<dialog>` carries the expected `aria-labelledby`. The platform's `showModal()` moves focus inside (verified in the AC7.4 test below). |
| AC7.2 | Automated | `test/dialog.ts` (UI-DOM, test "AC7.2: Escape closes the dialog and onClose fires once") | Dispatching the native `cancel` event + calling `.close()` (the Escape chain in a real browser) fires the `onClose` callback exactly once and leaves the dialog with `dialog.open === false`. |
| AC7.3 | Automated | `test/dialog.ts` (UI-DOM, test "AC7.3: Backdrop click closes; content click does not") | A click on an inner button leaves `dialog.open === true`; a click whose target is the `<dialog>` element itself (the backdrop region) closes it. |
| AC7.4 | Hybrid | Automated: `test/dialog.ts` (UI-DOM, test "AC7.4: Focus is restored to the trigger after close"). Manual: `DOCS/test-plans/2026-05-17-payment-method-modal.md` Phase G step 3. | Automated half: in the bundled-tapout DOM, focusing the trigger before opening and asserting `document.activeElement === trigger` after `dialog.close()` proves the platform's restore-focus semantics. Manual half: focus restoration is ultimately a browser API and may diverge between the test bundler's DOM and real Chromium; Phase 4 design note + the test file's notes call out manual confirmation in real Chromium as the fallback gate. |
| AC7.5 | Automated | `test/dialog.ts` (UI-DOM, test "AC7.5: aria-labelledby + aria-describedby are wired through") | The `<dialog>` element exposes `aria-labelledby` pointing to the supplied heading id and `aria-describedby` pointing to the supplied error-region id. |

## AC8 — Cross-cutting behaviors

| AC | Type | File / Plan section | What passes verifies |
|---|---|---|---|
| AC8.1 | Automated | `test/payment-methods.ts` (server-integration) — covered by the DELETE test "removes non-default and returns canonical refreshed list", the set-default test "updates customer + subscription and returns canonical list", and the partial-failure test "returns 502 with both states…" — together with `test/payment-method-modal.ts` (UI-DOM, "AC3.3 / AC8.1: Successful confirmSetup refreshes the list") | Every mutation response (`DELETE :id`, `POST :id/default`, plus the canonical-refresh contract carried via `loadPaymentMethods()` after `POST setup-intent`) returns the canonical `{methods, defaultId}` and the client replaces its signals from the response. No optimistic update path exists in the modal code (the modal renders directly from `paymentMethods.value`). |
| AC8.2 | Automated | `test/payment-methods.ts` (Phase 1 unit + Phase 2 state shape) + code review during Phase 4 Task 8 Done-when (grep for direct multi-signal writes) + `src/client/payment-methods.ts` ships `setPaymentMethodsState`/`resetPaymentMethods` whose bodies wrap multiple signal writes in `batch()` and are exercised by the suite | Every multi-signal write in the new client surface goes through the `batch()`-wrapped setters; no test exercising a mutation path produces an intermediate-state re-render bug. |
| AC8.3 | Automated | `test/payment-method-modal.ts` (UI-DOM, test "AC3.4 / AC8.3: Declined card surfaces error and stays in adding mode") + `test/payment-method-modal.ts` (UI-DOM, "AC5.5: Partial-failure surface inline banner") | Mutation failures (declined card, partial-failure on set-default) surface as an inline `.pm-error` element inside the dialog; the dialog stays open in its current mode; no toast or redirect occurs. |

---

## Implementation-plan task index (AC → task that produces the test)

The tasks below are where the test code itself is created. Use this to
navigate from an AC, through this document's `File / Plan section`
column, to the implementation-plan task that writes the test.

| AC | Plan task that creates the test |
|---|---|
| AC1.1, AC1.2 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC1.1 / AC1.2") |
| AC1.3 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC1.3") + existing `test/settings-route.ts` updated in Phase 4 Task 6 |
| AC2.1, AC2.2, AC2.4 | Phase 2 Task 4 (`test/payment-methods.ts`) |
| AC2.3 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC2.3") |
| AC2.4 (manual half) | Phase 6 Task 3 (test plan Phase F) |
| AC3.1, AC3.2 | Phase 4 Task 2 (`test/payment-methods.ts` — setup-intent tests) |
| AC3.3 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC3.3 / AC8.1") |
| AC3.4 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC3.4 / AC8.3") + Phase 6 Task 3 (test plan Phase B step 4) |
| AC3.5 | Phase 6 Task 3 (test plan Phase B step 5) |
| AC3.6 | Phase 4 Task 7 (`test/payment-method-modal.ts` — "AC3.6") + Phase 6 Task 3 (test plan Phase B step 6) |
| AC4.1, AC4.3, AC4.6 | Phase 5 Task 7 (`test/payment-method-modal.ts` — AC4.1, AC4.3, AC4.6 tests) |
| AC4.2, AC4.4, AC4.5 | Phase 5 Task 4 (`test/payment-methods.ts` — DELETE tests) |
| AC5.1, AC5.2, AC5.3, AC5.4 (server), AC5.5 (server), AC5.6 | Phase 5 Task 4 (`test/payment-methods.ts` — set-default tests) |
| AC5.4 (UI), AC5.5 (UI), AC5.7 | Phase 5 Task 7 (`test/payment-method-modal.ts` — AC5.4/AC5.7 and AC5.5 tests) |
| AC6.1, AC6.2, AC6.3 | Phase 4 Task 6 (settings panel rewrite + state action removal) + Phase 4 Task 8 Done-when (grep gates) |
| AC7.1, AC7.2, AC7.3, AC7.5 | Phase 3 Task 3 (`test/dialog.ts`) |
| AC7.4 | Phase 3 Task 3 (`test/dialog.ts` — AC7.4 test) + Phase 6 Task 3 (test plan Phase G step 3) |
| AC8.1 | Phase 4 Task 7 + Phase 5 Task 4 + Phase 5 Task 7 (the canonical-shape contract is asserted by every mutation test in both files) |
| AC8.2 | Phase 2 Task 5 (`src/client/payment-methods.ts` — setters use `batch()`) + Phase 4 Task 8 Done-when grep |
| AC8.3 | Phase 4 Task 7 ("AC3.4 / AC8.3") + Phase 5 Task 7 ("AC5.5: Partial-failure surface…") |

---

## Files referenced by this document

- Design: `DOCS/design-plans/2026-05-17-payment-method-modal.md`
- Implementation phases:
  `DOCS/implementation-plans/2026-05-17-payment-method-modal/phase_01.md`
  through `phase_06.md`
- Automated test files (under `/Users/nick/code/rsss/`):
  - `test/stripe-billing.ts` (Phase 1 Task 5 — unit; infrastructure
    only, no ACs)
  - `test/payment-methods.ts` (Phases 2, 4, 5 — server-integration)
  - `test/dialog.ts` (Phase 3 Task 3 — UI-DOM)
  - `test/payment-method-modal.ts` (Phases 4, 5 — UI-DOM)
  - `test/settings-route.ts` (existing — Phase 4 Task 6 updates the
    "Manage payment methods" gating assertion)
- Manual test plan:
  `DOCS/test-plans/2026-05-17-payment-method-modal.md` (Phase 6 Task 3)
