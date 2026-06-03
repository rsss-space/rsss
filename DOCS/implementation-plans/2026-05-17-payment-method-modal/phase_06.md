# Payment Method Modal — Phase 6: Manual Smoke Test + Test Plan

**Goal:** Verify the feature end-to-end against Stripe test mode and
capture a reproducible manual test plan in `DOCS/test-plans/`. No new
product code in this phase — only execution and documentation.

**Architecture:** None — this phase is operational verification.

**Scope:** 6 of 6 phases. Depends on Phases 1-5.

**Codebase verified:** 2026-05-17. The project's existing test-plan
convention lives at `/Users/nick/code/rsss/DOCS/test-plans/` (e.g.
`2026-05-15-empty-state-pending-updates.md`). New plans follow the
same `YYYY-MM-DD-<slug>.md` naming and same table format.

---

## Acceptance Criteria Coverage

This phase verifies (end-to-end against Stripe test mode):

- **payment-method-modal.AC2.4** (loud failure when STRIPE_SECRET_KEY
  missing): exercised by toggling the env var off and confirming the
  modal surfaces an inline error rather than hanging or silently
  succeeding. Automated coverage exists in
  `test/payment-methods.ts` from Phase 2; this phase confirms the
  end-to-end UX of the loud failure.
- **payment-method-modal.AC3.5** (3DS/SCA challenge inline): asserts
  that Stripe's 3DS iframe renders inside the modal and that the flow
  resolves without redirecting. Test card `4000 0027 6000 3184`.
- All previously-covered ACs (AC1.x, AC2.1-3, AC3.1-4, AC3.6, AC4.x,
  AC5.x, AC6.x, AC7.x, AC8.x): smoke-pass against real Stripe test
  mode as a final gate.

---

<!-- START_TASK_1 -->
### Task 1: Confirm Stripe test-mode credentials in `.dev.vars`

**Step 1: Verify the keys are present**

```bash
grep -E 'STRIPE_(SECRET|PUBLISHABLE)_KEY' .dev.vars
```

Expected: two lines, one each. If either is missing, obtain test-mode
keys from the Stripe dashboard
(`https://dashboard.stripe.com/test/apikeys`) and add them to
`.dev.vars` using the names declared in Phase 1.

**Step 2: Ensure the local Autumn customer has a `stripe_id`**

For a smoke test to work end-to-end, the Autumn customer record for
the test user must have its `stripe_id` populated with a real Stripe
customer in the test account. If a brand-new dev account is used,
this typically happens after the first checkout flow.

If `stripe_id` is null and a checkout flow is not desired, manually
create a Stripe test customer via the dashboard and update the Autumn
customer record's `stripe_id` field via Autumn's UI or its API.

**Step 3: No commit needed**

`.dev.vars` is git-ignored.
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Execute the manual smoke test

**Step 1: Start the dev server**

```bash
npm start
```

Open `http://127.0.0.1:2222/settings` in a Chromium-based browser
(Stripe's PaymentElement is best-tested cross-browser, but Chromium is
sufficient for the smoke).

**Step 2: Run through the test plan**

Follow the steps in the test plan being written in Task 3. Confirm
each row's "Expected" before moving on.

If any step fails, STOP and file a defect linked to the AC. Do not
mark Phase 6 done.
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Write the manual test plan to
`DOCS/test-plans/2026-05-17-payment-method-modal.md`

**Files:**
- Create: `/Users/nick/code/rsss/DOCS/test-plans/2026-05-17-payment-method-modal.md`

**Step 1: Write the document**

```markdown
# Human Test Plan — payment-method-modal

Generated 2026-05-17 from the payment-method-modal implementation
plan. Automated coverage exists for ACs 1.1-1.3, 2.1-2.4, 3.1-3.4,
3.6, 4.1-4.6, 5.1-5.7, 6.1-6.3, 7.1-7.5, 8.1-8.3. This plan covers
the human-verification items that cannot or should not be asserted
in code (Stripe Elements iframe behavior, real 3DS challenge, and
loud-failure UX when env vars are missing).

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

## Phase A — Modal launches and lists payment methods (AC1, AC2)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in and visit `/settings` | Subscription panel renders; "Manage payment methods" button is visible (live mode) |
| 2 | Click "Manage payment methods" | A native dialog opens via `showModal()`; the URL does not change |
| 3 | Inspect DOM | `<dialog class="app-dialog payment-method-modal">` element exists in the top layer; `aria-labelledby` points to the dialog heading |
| 4 | If the user already has cards on file | List rows render with brand, last4, MM/YY; exactly one row carries a `Default` badge matching the server's `defaultId` |
| 5 | Press Escape | Dialog closes; keyboard focus returns to the "Manage payment methods" trigger button |

## Phase B — Add a card (AC3)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal; click "Add a card" | Modal switches to adding mode; PaymentElement iframe mounts |
| 2 | Open Network panel; filter to `api.stripe.com`. Type test card `4242 4242 4242 4242`, any future expiry, any CVC, any ZIP | A POST goes to `/api/billing/payment-methods/setup-intent` and returns `{ clientSecret: "..." }`. NO request from the worker contains `card`, `number`, or `cvc` in its body — only the iframe (Stripe's domain) sees those |
| 3 | Click "Save card" | After a brief loading state, the modal returns to list mode with the new card visible |
| 4 | Click "Add a card" again and use declined card `4000 0000 0000 0002` | After "Save card", an inline error appears beneath the PaymentElement with Stripe's decline message (e.g. "Your card was declined."); the element remains mounted; the user can edit and retry without closing the dialog |
| 5 | Click "Add a card" again and use 3DS card `4000 0027 6000 3184` | Stripe's 3DS challenge UI appears inside the PaymentElement iframe (a modal *within* the modal, hosted by Stripe). Completing the challenge returns to the parent modal and shows the new card in list mode. No redirect occurs |
| 6 | Mid-flow recovery: click "Add a card", enter a card, then close the dialog (Escape) before clicking "Save card". Re-open the modal | The modal opens in list mode (not stuck in adding mode). The list reflects the actual server state (cards that completed setup are shown; cards whose SetupIntent didn't complete are not). This is the AC3.6 recovery via `return_url=/settings` and the route-mount `loadPaymentMethods()` |

## Phase C — Remove a card (AC4)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal with at least 2 cards. Find a non-default row | Its "Remove" button is enabled |
| 2 | Note that the default row's "Remove" button is disabled and has the tooltip "Set another card as default first." | Tooltip appears on hover/long-focus |
| 3 | Click "Remove" on a non-default row | Modal switches into `confirming-remove` mode (mode change within the same dialog — no nested dialog appears) |
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

| Step | Action | Expected |
|------|--------|----------|
| 1 | Open the modal | Focus moves inside the dialog (browser default) |
| 2 | Tab through the dialog | Focus is trapped within the dialog (cannot tab to elements outside) |
| 3 | Press Escape | Dialog closes; focus returns to "Manage payment methods" trigger |
| 4 | Click the backdrop area (outside the dialog box but inside the page) | Dialog closes |
| 5 | Click inside the dialog content (a button, the heading, the PaymentElement) | Dialog stays open |
| 6 | Trigger an inline error (e.g. submit empty PaymentElement) | The error has `role="alert"` and `aria-describedby` on the dialog points to its id |

## Sign-off

- [ ] Phase A passes
- [ ] Phase B passes (all 6 rows)
- [ ] Phase C passes
- [ ] Phase D passes (partial-failure recovery exercised)
- [ ] Phase E passes
- [ ] Phase F passes
- [ ] Phase G passes

When all phases pass, commit this checklist (filled in) as a record of
the smoke pass:

```bash
git add DOCS/test-plans/2026-05-17-payment-method-modal.md
git commit -m "docs(test-plan): payment-method-modal manual smoke"
```
```

**Step 2: Save the document**

Write the above content to
`/Users/nick/code/rsss/DOCS/test-plans/2026-05-17-payment-method-modal.md`.

**Step 3: Commit (initially, with the sign-off boxes unchecked)**

```bash
git add DOCS/test-plans/2026-05-17-payment-method-modal.md
git commit -m "docs(test-plan): payment-method-modal manual test plan"
```

The sign-off boxes are checked and re-committed only after the smoke
test in Task 2 actually passes end-to-end.
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Final verification gate

**Step 1: Re-run all automated checks one last time**

```bash
npm run lint && npm run stylelint && npm run typecheck && npm test
```

Expected: all green.

**Step 2: Confirm the smoke pass**

Confirm Task 2 completed successfully (all phases of the manual plan
green). If any phase failed, return to the relevant earlier phase
(1-5) and fix the underlying issue; do NOT close Phase 6 with
unresolved failures.

**Step 3: Check the sign-off list into the test plan**

Once the smoke is green, edit the test plan to tick each `[ ]` to
`[x]` and commit the update.

```bash
git add DOCS/test-plans/2026-05-17-payment-method-modal.md
git commit -m "docs(test-plan): payment-method-modal smoke pass"
```

**Done when:**
- Automated test suite passes.
- Manual smoke plan in `DOCS/test-plans/` passes all phases.
- Sign-off list is checked in.
<!-- END_TASK_4 -->
