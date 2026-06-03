# Phase 1: Investigate Stripe v3 critical-path load

**Goal:** Determine why `js.stripe.com/v3` was pending on the home route in
the original report, and commit either a written finding or a one-line
import change so the home route in a fresh tab does not request
`js.stripe.com/v3`.

**Architecture:** No new modules. Investigation only; if a fix is needed,
it is a single-line import change in `src/client/components/payment-method-modal.ts`
to use `@stripe/stripe-js/pure` (which defers Stripe.js script injection
until `loadStripe()` is explicitly called) instead of the default
entrypoint (which can inject the `<script src="https://js.stripe.com/v3">`
tag as a side effect of module import).

**Tech Stack:** TypeScript (Vite + Preact + signals), `@stripe/stripe-js`
^4.10.0.

**Scope:** Phase 1 of 8.

**Codebase verified:** 2026-05-24

**Key facts from investigation:**
- `payment-method-modal.ts` line 10-13 currently imports from
  `@stripe/stripe-js` (multi-line import including `loadStripe`,
  `type Stripe as StripeLib`, `type StripeElements`).
- `loadStripe()` is called *lazily* at
  `src/client/components/payment-method-modal.ts:130` inside the
  `handleAddCard` callback — NOT at module top level.
- There is no `<Elements>` provider mounted at app root; Elements is
  instantiated locally inside the modal at lines 136-138.
- PaymentMethodModal renders inside `SettingsRoute`
  (`src/client/routes/settings.ts:894-897`), reachable at `/settings`.
- Only `payment-method-modal.ts` imports from `@stripe/stripe-js`
  (excluding the `test/stripe-js-stub.ts` test stub).
- Stripe.js docs confirm: the regular `@stripe/stripe-js` entrypoint
  injects the `<script>` tag as a side effect of *module import*; the
  `/pure` entrypoint defers injection until `loadStripe()` is
  explicitly called. API is otherwise identical (with the bonus that
  `/pure` exposes `loadStripe.setLoadParameters()`).
- `@stripe/stripe-js@4.x` supports `/pure`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### 023-fix-initial-load.AC8: Stripe SDK is not on the home critical path
- **023-fix-initial-load.AC8.1 Success:** Loading the home route in
  a fresh tab (no DOM leftovers) does not result in a network request
  to `https://js.stripe.com/v3` or any `https://js.stripe.com/*`
  resource.
- **023-fix-initial-load.AC8.3 Success:** Opening the payment-method
  modal on the settings route still successfully loads Stripe.js and
  initializes Elements.

### 023-fix-initial-load.AC9: Investigation deliverable
- **023-fix-initial-load.AC9.1 Success:** Phase 1's investigation
  produces a written finding (in the PR description or a committed
  note) identifying why `js.stripe.com/v3` was pending on the home
  page in the original report. The finding either documents that no
  code change is needed (DOM leftover) or names the specific code
  change made.

---

<!-- START_TASK_1 -->
### Task 1: Reproduce the Stripe v3 home-route request

**Verifies:** 023-fix-initial-load.AC9.1 (preparation)

**Files:** None modified yet.

**Implementation:**

Use the project's dev server (per the `run` skill) to load the app in a
fresh browser tab with DevTools' Network panel open and "Disable cache"
checked. Verify whether `js.stripe.com/v3.js` (or any
`https://js.stripe.com/*` URL) appears in the network log when
navigating to the home route (`/`).

Steps:
1. Start the dev server (`npm run dev` or per the project's run skill).
2. Open a fresh browser tab in DevTools mode with "Disable cache" on.
3. Navigate to the home route.
4. Inspect the Network panel: record whether any
   `https://js.stripe.com/*` request fires, the *initiator* chain (which
   JS file / function caused it), and the time relative to bundle load.

**Verification:**
- A reproduction recording (screenshot of network panel + initiator
  column) is captured and attached to a scratch note at
  `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md`.

If `js.stripe.com/v3` does NOT fire on the home route in a fresh tab
*before* any code change, the original report was a DOM leftover (a
stale `<script>` from a prior `/settings` visit in the same tab); the
preconnect from Phase 2 still helps, and the `/pure` switch in Task 3
is defensive but not strictly required.

If `js.stripe.com/v3` DOES fire on the home route in a fresh tab, the
import chain is loading `@stripe/stripe-js` eagerly. Proceed with
Task 3.

**Commit:** No commit yet (investigation only).

<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Trace the import chain

**Verifies:** 023-fix-initial-load.AC9.1 (preparation)

**Files:** None modified.

**Implementation:**

Regardless of the Task 1 result, run the following greps to map the
import chain and document it in `phase_01_findings.md`:

```bash
# Find every file importing @stripe/stripe-js (production code only)
rg -n "from ['\"]@stripe/stripe-js" src/

# Find every file importing payment-method-modal
rg -n "payment-method-modal" src/

# Find every file importing settings route
rg -n "from ['\"]\\./settings" src/client/routes/

# Confirm route module loading (eager vs dynamic import)
rg -n "import\\(.*settings" src/client/routes/index.ts
```

Record in `phase_01_findings.md`:
- Whether `routes/index.ts` imports `./settings.js` statically (eagerly)
  or via dynamic `import()` (lazily).
- The full import chain from `src/client/index.ts` to
  `@stripe/stripe-js`.
- A one-paragraph conclusion: "Stripe.js script tag is injected at
  module-load time because [reason]" OR "No path from index.ts to
  @stripe/stripe-js is eagerly evaluated; the request observed in
  the original report must have been a DOM leftover from a prior
  modal open in the same tab."

**Verification:**

`phase_01_findings.md` exists and contains the import chain plus
conclusion.

**Commit:** No commit yet (investigation only).

<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Switch to `@stripe/stripe-js/pure`

**Verifies:** 023-fix-initial-load.AC8.1, 023-fix-initial-load.AC8.3,
023-fix-initial-load.AC9.1

**Files:**
- Modify: `src/client/components/payment-method-modal.ts:10-14`

**Implementation:**

This change is defensive: it guarantees that *importing* the module
graph containing `@stripe/stripe-js` does not inject the Stripe.js
script tag. Stripe.js loads only when `loadStripe()` is explicitly
called inside `handleAddCard`.

Change the import statement from:

```typescript
import {
    loadStripe,
    type Stripe as StripeLib,
    type StripeElements
} from '@stripe/stripe-js'
```

to:

```typescript
import {
    loadStripe,
    type Stripe as StripeLib,
    type StripeElements
} from '@stripe/stripe-js/pure'
```

No other code change. The `loadStripe()` API surface is identical between
the regular and `/pure` entrypoints.

If the test stub at `test/stripe-js-stub.ts` mocks the `@stripe/stripe-js`
specifier, audit whether it also needs to handle the `/pure` subpath.
(Run `rg -n "stripe-js" test/` and inspect.) If the stub matches by
prefix or maps the module, no change is needed; if it maps the exact
`@stripe/stripe-js` specifier only, add the `/pure` mapping too. Do not
weaken any existing test coverage.

**Verification:**

Run: `npm run typecheck`
Expected: Clean (no new type errors).

Run: `npm run lint`
Expected: Clean.

Run: `npm test`
Expected: Existing payment-method-modal tests pass unchanged.

Manual check (per the `run` skill):
1. Load the home route in a fresh tab with "Disable cache" on. Confirm
   *no* `https://js.stripe.com/*` request fires.
2. Navigate to `/settings`. Confirm *no* `https://js.stripe.com/*`
   request fires yet (modal is mounted but `loadStripe()` not called).
3. Click "Add a card" to open the modal flow. Confirm
   `https://js.stripe.com/v3*` is requested at this point and Elements
   initializes successfully (the card input field renders).

**Commit:**

```bash
git add src/client/components/payment-method-modal.ts
git commit -m "fix: defer Stripe.js script injection via /pure entrypoint

Switches the @stripe/stripe-js import in payment-method-modal.ts to
the /pure entrypoint so that importing the module graph no longer
injects the Stripe.js script tag as a side effect. loadStripe() is
still called only inside handleAddCard, so the script fetches lazily
when the user actually opens the add-card flow.

Part of 023-fix-initial-load."
```

<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Commit the investigation finding

**Verifies:** 023-fix-initial-load.AC9.1

**Files:**
- Modify: `DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md`
  (finalize)

**Implementation:**

Finalize `phase_01_findings.md` with three sections:
1. **Reproduction:** What was observed on the home route, with/without
   the Task 3 change.
2. **Root cause:** The conclusion from Task 2's import-chain trace.
3. **Resolution:** Either "Switched to `@stripe/stripe-js/pure` (defensive)"
   or "No code change needed; the original request was a DOM leftover."

This document satisfies AC9.1 regardless of which branch the
investigation falls into.

**Verification:**

The file exists at
`DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md`
and contains the three sections above with concrete observations from
Tasks 1-2 (not speculation).

**Commit:**

```bash
git add DOCS/implementation-plans/2026-05-24-023-fix-initial-load/phase_01_findings.md
git commit -m "docs: 023 phase 1 — Stripe v3 critical-path investigation finding"
```

<!-- END_TASK_4 -->
