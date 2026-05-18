# Human Test Plan — payment-method-modal

Generated 2026-05-17 from the payment-method-modal implementation plan.
Automated coverage exists for ACs 1.1-1.3, 2.1-2.4, 3.1-3.4, 3.6, 4.1-4.6,
5.1-5.7, 6.1-6.3, 7.1-7.5, 8.1-8.3. This plan covers the human-verification
items that cannot or should not be asserted in code (Stripe Elements
iframe behavior, real 3DS challenge, and loud-failure UX when env vars
are missing).

**Substrate note:** The modal is implemented with the
`@substrate-system/dialog` `<modal-window>` web component, not the
native `<dialog>` element directly. Selectors and attribute names below
reflect that substrate. The component renders `role="dialog"`,
`aria-modal="true"`, and uses an `active="true|false"` attribute to
drive open/close.

## Prerequisites

- Local dev: `npm start`
- A signed-in user whose Autumn customer record has a populated
  `stripe_id` (i.e. an existing Stripe test customer)
- `.dev.vars` with valid `STRIPE_SECRET_KEY` and
  `STRIPE_PUBLISHABLE_KEY` (test mode)
- Browser devtools available for Network inspection
- Stripe test cards:
  - `4242 4242 4242 4242` — Visa, succeeds without 3DS
  - `5555 5555 5555 4444` — Mastercard, succeeds without 3DS
  - `4000 0027 6000 3184` — Visa, requires 3DS authentication
  - `4000 0000 0000 0002` — declined (generic decline)

Optional sanity reruns:
- Server endpoints: `npx esbuild ./test/payment-methods.ts --bundle
  --platform=node --format=esm --external:stripe
  --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts
  --loader:.wasm=dataurl | node --input-type=module` — expect 60/60
  passing, exit 0
- Modal interactions: `npx esbuild ./test/payment-method-modal.ts
  --bundle --loader:.css=text
  --alias:@stripe/stripe-js=./test/stripe-js-stub.ts | npx tapout` —
  expect 38/38 passing
- `npm test` — expect exit 0

## Phase A — Modal launches and lists payment methods (AC1, AC2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in and visit `/settings` | Subscription panel renders; "Manage payment methods" button is visible (live mode) |
| 2 | Click "Manage payment methods" | A `<modal-window>` becomes active (its `active` attribute is `"true"`); the URL does not change |
| 3 | Inspect DOM | A `<modal-window class="payment-method-modal">` element exists; it exposes `role="dialog"` and `aria-modal="true"` |
| 4 | If the user already has cards on file | List rows render with brand, last4, MM/YY; exactly one row carries a `Default` badge matching the server's `defaultId` |
| 5 | Press Escape | Modal closes (`active` returns to `"false"`); keyboard focus returns to the "Manage payment methods" trigger button |

## Phase B — Add a card (AC3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal; click "Add a card" | Modal switches to adding mode; PaymentElement iframe mounts inside the modal body |
| 2 | Open Network panel; filter to `api.stripe.com`. Type test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP | A POST goes to `/api/billing/payment-methods/setup-intent` and returns `{ clientSecret: "..." }`. NO request from the worker contains `card`, `number`, or `cvc` in its body — only the iframe (Stripe's domain) sees those |
| 3 | Click "Save card" | After a brief loading state, the modal returns to list mode with the new card visible |
| 4 | Click "Add a card" again and use declined card `4000 0000 0000 0002` | After "Save card", an inline error appears beneath the PaymentElement with Stripe's decline message (e.g. "Your card was declined."); the element remains mounted; the user can edit and retry without closing the modal |
| 5 | Click "Add a card" again and use 3DS card `4000 0027 6000 3184` | Stripe's 3DS challenge UI appears inside the PaymentElement iframe (a modal *within* the modal, hosted by Stripe). Completing the challenge returns to the parent modal and shows the new card in list mode. No redirect occurs |
| 6 | Mid-flow recovery: click "Add a card", enter a card, then close the modal (Escape) before clicking "Save card". Re-open the modal | The modal opens in list mode (not stuck in adding mode). The list reflects the actual server state (cards that completed setup are shown; cards whose SetupIntent didn't complete are not). This is the AC3.6 recovery via `return_url=/settings` and the route-mount `loadPaymentMethods()` |

## Phase C — Remove a card (AC4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal with at least 2 cards. Find a non-default row | Its "Remove" button is enabled |
| 2 | Hover or long-focus the default row's "Remove" button | Button is disabled; tooltip "Set another card as default first." appears |
| 3 | Click "Remove" on a non-default row | Modal switches into `confirming-remove` mode (mode change within the same modal — no nested modal appears) |
| 4 | Click "Cancel" | Modal returns to list mode; nothing changed |
| 5 | Click "Remove" again, then "Remove" in the confirmation | A DELETE request goes to `/api/billing/payment-methods/:id`. The list refreshes from the server response and the row is gone. Modal stays open in list mode |
| 6 | If only one non-default card remained, the list now shows just the default. The modal does not close | Stays open at list mode |

## Phase D — Set a different default (AC5)

| Step | Action | Expected |
|------|--------|----------|
| 1 | With multiple cards, click "Set as default" on a non-default row | POST goes to `/api/billing/payment-methods/:id/default` |
| 2 | After it returns | The `Default` badge has moved to the chosen row; the "Set as default" affordance is no longer rendered on it; the prior default now has "Set as default" available |
| 3 | Network panel: confirm that two outbound Stripe calls happened: one `POST customers/cus_...` (the customer-level default update) and one `POST subscriptions/sub_...` (the subscription-level default update) | Both visible. Both succeed |
| 4 | Optional partial-failure: temporarily break the subscription update (e.g. via a network rule or by deleting the subscription in Stripe). Retry | The endpoint returns 502; the modal shows an inline banner explaining the partial state (customer updated, subscription not). The canonical list reflects the current customer-level default. Restore the subscription and re-run to confirm recovery |

## Phase E — Cleanup of legacy redirect (AC6)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open `/settings`; inspect the Subscription panel | No "Update payment method" link/button is present (only "Manage payment methods") |
| 2 | Inspect the panel for the "This will open page on stripe.com." paragraph | Not present |
| 3 | Open browser console; type `State.openPaymentMethodUpdate` | Returns `undefined` (function removed) |

## Phase F — Loud failure when env vars are missing (AC2.4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Stop dev server. Comment out `STRIPE_SECRET_KEY` in `.dev.vars`. Restart dev server | App still loads |
| 2 | Open `/settings`; click "Manage payment methods" | Modal opens. Adding a card fails loudly: clicking "Add a card" surfaces an inline error referencing `stripe_unconfigured` (because the publishable-key state from `GET /api/billing/status` is null when the secret is unset) |
| 3 | Network panel: `GET /api/billing/payment-methods` returns 503 with `{ "error": "stripe_unconfigured" }` | Confirmed |
| 4 | Restore the env var; restart | Normal flow resumes |

## Phase G — A11y spot check (AC7)

Note: AC7 was originally specified against a project-owned native
`<dialog>` primitive. Phase 7 of the implementation plan replaced that
primitive with `@substrate-system/dialog`'s `<modal-window>` web
component, which provides equivalent semantics (focus trap, Escape
close, backdrop click close, focus restore, scroll lock, `role="dialog"`
+ `aria-modal="true"`). The expected behaviors below match the library's
documented behavior.

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal | Focus moves inside the modal (library default) |
| 2 | Tab through the modal | Focus is trapped within the modal (cannot tab to elements outside) |
| 3 | Press Escape | Modal closes (`active="false"`); focus returns to "Manage payment methods" trigger |
| 4 | Click the backdrop area (outside the modal box but inside the page) | Modal closes |
| 5 | Click inside the modal content (a button, the heading, the PaymentElement) | Modal stays open |
| 6 | Trigger an inline error (e.g. submit empty PaymentElement) | The error has `role="alert"`; `aria-describedby` on `<modal-window>` references the error element's id while it is rendered |

## Sign-off

- [ ] Phase A passes
- [ ] Phase B passes (all 6 rows)
- [ ] Phase C passes
- [ ] Phase D passes (partial-failure recovery exercised)
- [ ] Phase E passes
- [ ] Phase F passes
- [ ] Phase G passes

When all phases pass, tick each box above and commit the updated file
as a record of the smoke pass.
