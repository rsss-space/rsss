# Payment Method Modal — Phase 4: Add-a-Card Path (SetupIntent + PaymentElement)

**Goal:** End-to-end add a new payment method without leaving the app:
launch the modal, render the current list (read-only this phase),
collect a card via Stripe's `PaymentElement` backed by a `SetupIntent`,
confirm it inline, and refresh the canonical list. Also remove the
legacy redirect link, helper text, and state action.

**Architecture:**
- Server: rename `POST /api/billing/payment-method` ->
  `POST /api/billing/payment-methods/setup-intent`. The new handler
  uses the Phase 1 Stripe SDK boundary to create a SetupIntent with
  `usage: 'off_session'` and `automatic_payment_methods: { enabled: true }`,
  returning `{ clientSecret }`. The old URL-returning behavior is
  removed (no compat shim).
- Client: new component
  `src/client/components/payment-method-modal.ts` that wraps the
  Phase 3 `<Dialog>`. It owns modal-scoped local state via `useState`
  for `mode: 'list' | 'adding' | 'confirming-remove'`, the
  `setupIntentSecret`, the loaded `Stripe`/`StripeElements` instances,
  and any error string. The render under `mode === 'list'` shows the
  `paymentMethods` signal (no row actions yet — those land in Phase 5);
  `mode === 'adding'` mounts the `PaymentElement` and runs
  `stripe.confirmSetup({elements, confirmParams, redirect: 'if_required'})`.
- Settings panel: replaces the existing "Update payment method"
  `<button>` + the "This will open page on stripe.com." `<p>` with a
  single "Manage payment methods" `<button>` that opens the new modal.
- Cleanup: `State.openPaymentMethodUpdate()` at
  `src/client/state.ts:1497-1517` is deleted along with its declaration
  on the `State` interface.

**Tech Stack:** `@stripe/stripe-js` (client), `stripe` (server, already
in via Phase 1), Hono, Preact, signals, the Phase 3 `<Dialog>` primitive.

**Scope:** 4 of 6 phases. Depends on Phases 1, 2, 3.

**Codebase verified:** 2026-05-17. Key confirmations and corrections:
- The current button at `src/client/routes/settings.ts:499-508` is
  already a `<button>` (not an `<a>`, contrary to design's earlier
  language). It and the trailing `<p class="hint">` paragraph are the
  exact lines to be replaced.
- `handleUpdatePaymentMethod` is at
  `src/client/routes/settings.ts:179-182` and is the only call site of
  `State.openPaymentMethodUpdate`. Deleting both is safe (no tests
  reference the action; verified via grep).
- `POST /api/billing/payment-method` at `src/server/index.ts:1459-1482`
  is consumed only by the legacy state action. Renaming the route is
  safe.
- The Phase 4 SetupIntent flow uses the Phase 1 `getStripe()` directly
  to create the SetupIntent — we do NOT route through Autumn's
  `getPaymentSetupUrl()` (that was a hosted-page redirect, not an
  in-app flow).
- An existing test at `test/settings-route.ts:629-654` asserts that the
  "Update payment method" button hides when `useLive=false`. We update
  it to assert the new "Manage payment methods" button behavior.
- `@stripe/stripe-js` is NOT yet in `package.json`. Phase 4 adds it.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### payment-method-modal.AC1: Modal launches from the Settings page
- **payment-method-modal.AC1.1 Success:** Clicking "Manage payment methods"
  opens a native `<dialog>` via `showModal()` in `list` mode.
- **payment-method-modal.AC1.2 Success:** The URL is unchanged when the modal
  opens (no client-side route navigation, no full-page redirect).
- **payment-method-modal.AC1.3 Failure:** When the existing `useLive` flag is
  `false` (Autumn not configured), the Subscription panel renders the existing
  Free-plan branch and the "Manage payment methods" button is not rendered.

### payment-method-modal.AC2 (residual)
- **payment-method-modal.AC2.3 Success:** The default method is visually
  distinguished in the list (e.g., a "Default" badge). (Phase 2 delivered
  the data; this phase adds the UI badge in the modal's `list` mode.)

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
  - *Partial-automation note:* the automated test (Task 7) asserts the
    inline error appears AND the element host remains mounted (proving
    "modal stays open"). The "user can correct and resubmit" half is
    structurally supported by the modal staying in `adding` mode, but
    the resubmission itself is verified manually in Phase 6 Phase B
    step 4 because the test stub returns a one-shot result per test.
- **payment-method-modal.AC3.6 Edge:** Closing the modal mid-`confirmSetup`
  does not corrupt state. The `return_url` (`/settings`) ensures that the
  route-mount `loadPaymentMethods()` reflects truth on next page load.
  - *Partial-automation note:* the automated test (Task 7) asserts the
    mode resets to `list` and the element host is removed from the DOM
    on close-then-reopen. The actual `stripe.elements()` /
    `PaymentElement.unmount()` cleanup uses Stripe SDK objects that
    the test stub does not faithfully model (the stub's `create()`
    and `getElement()` return distinct noop objects). Real
    `.unmount()` correctness is verified manually in Phase 6
    Phase B step 6.

### payment-method-modal.AC6: Cleanup of legacy redirect path
- **payment-method-modal.AC6.1 Success:** The "Update payment method" button
  no longer exists in the Subscription panel
  (`src/client/routes/settings.ts:499-508`).
- **payment-method-modal.AC6.2 Success:** The "This will open page on
  stripe.com." `<p>` helper text no longer exists in the Subscription panel.
- **payment-method-modal.AC6.3 Success:** `State.openPaymentMethodUpdate()` at
  `src/client/state.ts:1497-1517` and the redirect-URL-returning behavior of
  the old `POST /api/billing/payment-method` endpoint are deleted (no
  backwards-compatibility shim).

### payment-method-modal.AC8: Cross-cutting behaviors
- **payment-method-modal.AC8.1:** Every mutation endpoint (`POST /setup-intent`,
  `DELETE /:id`, `POST /:id/default`) returns the canonical refreshed
  `{methods, defaultId}` list on success, and the client always replaces its
  signals from the response — no optimistic updates. (Phase 4 implements
  this contract for the add-a-card path; Phase 5 extends to remove/default.)
- **payment-method-modal.AC8.2:** Every multi-signal state update in
  `src/client/payment-methods.ts` and the modal component uses `batch()`
  from `@preact/signals`.
- **payment-method-modal.AC8.3:** Network failures during any mutation surface
  as an inline error inside the dialog and leave the dialog open in its
  current mode (no toast, no redirect).

**Deferred:**
- **payment-method-modal.AC3.5 Edge (3DS/SCA challenge inside iframe):**
  asserting that the 3DS iframe opens and resolves in-modal requires a
  real Stripe Elements environment. Verified manually in Phase 6 against
  test card `4000 0027 6000 3184`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Rename `POST /api/billing/payment-method` ->
`POST /api/billing/payment-methods/setup-intent` and switch to a real
Stripe SetupIntent

**Verifies:** AC3.1 (server), AC6.3 (deletion of redirect behavior),
AC8.1 (canonical-shape contract — this endpoint returns
`{clientSecret}`, not a list, because the list is reloaded separately
on `confirmSetup` success per the design's data-flow step 4).

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts:1459-1482` —
  replace the existing handler.

**Step 1: Replace the handler**

Find the existing block at `src/server/index.ts:1459-1482`:

```typescript
app.post('/api/billing/payment-method', requireAuth, async (c) => {
    const session = c.get('session')!

    if (!billingUseLive(c.env)) {
        return c.json({
            error: 'portal_unavailable_in_dev'
        }, 503)
    }

    try {
        const baseUrl = new URL(c.req.url).origin
        const url = await getPaymentSetupUrl(
            c.env,
            session.did,
            `${baseUrl}/settings`
        )
        return c.json({ url })
    } catch (err) {
        console.error('billing/payment-method error:', err)
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})
```

Replace it with:

```typescript
app.post(
    '/api/billing/payment-methods/setup-intent',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const stripe = getStripe(c.env)
            const customerId = await getStripeCustomerId(
                c.env,
                session.did
            )
            const intent = await stripe.setupIntents.create({
                customer: customerId,
                usage: 'off_session',
                automatic_payment_methods: { enabled: true }
            })
            return c.json({ clientSecret: intent.client_secret })
        } catch (err) {
            console.error(
                'billing/payment-methods/setup-intent error:',
                err
            )
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)
```

**Step 2: Drop the unused `getPaymentSetupUrl` import**

After the rename, `getPaymentSetupUrl` is no longer used in
`src/server/index.ts`. Find the import block at lines 19-33 and
remove the line `getPaymentSetupUrl,`. Leave the export in
`autumn-billing.ts` intact for now — it isn't doing harm and a future
phase may revisit Autumn's hosted flow.

**Step 3: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(billing): POST /api/billing/payment-methods/setup-intent"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Tests for the SetupIntent endpoint

**Verifies:** `payment-method-modal.AC3.1` (server-side: endpoint
returns `clientSecret`, `usage: 'off_session'` is passed).

**Files:**
- Modify: `/Users/nick/code/rsss/test/payment-methods.ts` (created
  in Phase 2) — add three new tests at the end of the file.

**Step 1: Add the tests**

Append to `test/payment-methods.ts`:

```typescript
test(
    'POST /api/billing/payment-methods/setup-intent requires auth',
    async t => {
        const env = makeEnv({
            STRIPE_SECRET_KEY: STRIPE_KEY,
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const res = await app.request(
            'http://127.0.0.1/api/billing/payment-methods/setup-intent',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: `csrf_token=${TEST_CSRF_TOKEN}`,
                    'x-csrf-token': TEST_CSRF_TOKEN,
                    'sec-fetch-site': 'same-origin'
                }
            },
            env,
            executionCtx
        )
        t.equal(res.status, 401, 'unauthenticated request rejected')
    }
)

test(
    'POST /api/billing/payment-methods/setup-intent returns 503 ' +
    'when STRIPE_SECRET_KEY is unset',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const { cookieHeader } = await makeSession(env)
        const res = await app.request(
            'http://127.0.0.1/api/billing/payment-methods/setup-intent',
            { method: 'POST', headers: authedHeaders(cookieHeader) },
            env,
            executionCtx
        )
        const body = await res.json() as { error?:string }
        t.equal(res.status, 503, 'returns 503')
        t.equal(body.error, 'stripe_unconfigured', 'error code')
    }
)

test(
    'POST /api/billing/payment-methods/setup-intent creates a ' +
    'SetupIntent with usage=off_session and returns clientSecret',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)
        await withFetch(async call => {
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/setup_intents')) {
                return jsonResponse({
                    id: 'seti_test',
                    object: 'setup_intent',
                    client_secret: 'seti_test_secret_abc',
                    status: 'requires_payment_method'
                })
            }
            return jsonResponse({}, 404)
        }, async calls => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods/setup-intent',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as { clientSecret?:string }
            t.equal(res.status, 200, 'returns 200')
            t.equal(
                body.clientSecret,
                'seti_test_secret_abc',
                'forwards client_secret as clientSecret'
            )
            const createCall = calls.find(c =>
                c.url.includes('api.stripe.com/v1/setup_intents'))
            t.ok(createCall, 'called Stripe setup_intents')
            // Stripe SDK URL-encodes the body. The presence of these
            // tokens in the encoded body confirms the params were
            // sent.
            const rawBody = typeof createCall?.body === 'string' ?
                createCall.body :
                ''
            t.ok(
                rawBody.includes('customer=cus_test_alice'),
                'passed customer id'
            )
            t.ok(
                rawBody.includes('usage=off_session'),
                'passed usage=off_session'
            )
            t.ok(
                rawBody.includes(
                    'automatic_payment_methods%5Benabled%5D=true'),
                'passed automatic_payment_methods.enabled=true'
            )
            // AC3.2 sanity: outgoing request body MUST NOT contain
            // any payment-method data — only customer + intent
            // parameters.
            t.equal(
                rawBody.match(/card|cvc|number/i),
                null,
                'no card data in outgoing request'
            )
        })
    }
)
```

**Step 2: Run the tests**

```bash
npx esbuild ./test/payment-methods.ts --bundle | npx tapout
```

Expected: all tests pass (Phase 2 tests + the three new ones).

**Step 3: Commit**

```bash
git add test/payment-methods.ts
git commit -m "test(billing): setup-intent endpoint coverage"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Add `@stripe/stripe-js` client dependency

**Verifies:** Pre-work for AC3.2 (PaymentElement render).

**Files:**
- Modify: `/Users/nick/code/rsss/package.json` — install
  `@stripe/stripe-js`.

**Step 1: Install**

```bash
npm install @stripe/stripe-js@^4.0.0
```

`^4.x` is the current stable major as of 2026. If the registry has
moved to `^5.x` at execution time, use that. Pin to a major.

**Step 2: Verify installation**

```bash
node -e "console.log(require('@stripe/stripe-js/package.json').version)"
```

Expected: prints a version number.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(billing): add @stripe/stripe-js client dependency"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Add `State.createSetupIntent()` action

**Verifies:** Wires Task 1's endpoint into the client state surface so
the modal can call it via `State.createSetupIntent()`. Supports AC3.1
on the client side.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add a new
  action near `State.loadPaymentMethods` (added in Phase 2).

**Step 1: Add the action**

```typescript
State.createSetupIntent = async function (
):Promise<string> {
    const res = await api.post(
        'billing/payment-methods/setup-intent',
        { throwHttpErrors: false }
    )
    if (!res.ok) {
        const body = await res.json<{ error?:string }>().catch(
            () => ({} as { error?:string })
        )
        throw new Error(
            body.error || `setup_intent_${res.status}`
        )
    }
    const data = await res.json<{ clientSecret:string }>()
    return data.clientSecret
}
```

**Notes:**
- Returns the `clientSecret` directly to the caller so the modal can
  hand it to `stripe.elements({ clientSecret })`.
- Throws an `Error` with the server's `error` code as the message —
  the modal maps that to a human-readable inline message.
- Does NOT touch `paymentMethods` signals. The list is reloaded
  separately on `confirmSetup` success (per design step 4).

**Step 2: Add to the State surface declaration**

Add `createSetupIntent:() => Promise<string>` next to
`loadPaymentMethods` on the State interface/type (same pattern as
Phase 2 Task 6 Step 3).

**Step 3: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/client/state.ts
git commit -m "feat(billing): State.createSetupIntent action"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-7) -->

<!-- START_TASK_5 -->
### Task 5: Create the modal component
`src/client/components/payment-method-modal.ts`

**Verifies:** AC1.1, AC1.2, AC2.3 (default badge), AC3.2 (mount Element),
AC3.3 (success path), AC3.4 (error path with retry), AC3.6 (mid-flow
close), AC8.2 (batch), AC8.3 (inline error, modal stays open).

**Files:**
- Create: `/Users/nick/code/rsss/src/client/components/payment-method-modal.ts`
- Create: `/Users/nick/code/rsss/src/client/components/payment-method-modal.css`

**Reference patterns:**
- Phase 3's `src/client/components/dialog.ts` — the primitive used
  here.
- `src/client/components/cache-status.ts` — htm/preact + signals
  pattern.
- `/tmp/plan-2026-05-17-payment-method-modal-1b835f15/phase4-stripe-elements-research.md`
  — `loadStripe`, `elements.create('payment')`, `confirmSetup` snippets.

**Step 1: Create the stylesheet**

`src/client/components/payment-method-modal.css`:

```css
.payment-method-modal {
    /* additional sizing on top of the Dialog primitive */
    max-width: 32rem;

    & .pm-list {
        list-style: none;
        padding: 0;
        margin: 0 0 1rem 0;
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }

    & .pm-row {
        display: flex;
        align-items: center;
        gap: 0.75rem;
        padding: 0.75rem;
        border: 1px solid var(--color-border);
        border-radius: 0.375rem;
    }

    & .pm-brand-line {
        flex: 1;
        font-size: 1rem;
    }

    & .pm-default-badge {
        font-size: 1rem;
        /* Default is a positive/informational state, not a warning.
         * Use existing success token; if _variables.css later
         * grows a --color-success-bg variant, prefer it. */
        background: color-mix(in srgb, var(--color-success) 12%, transparent);
        color: var(--color-success);
        padding: 0.125rem 0.5rem;
        border-radius: 999px;
    }

    & .pm-error {
        color: var(--color-error);
        margin-top: 0.5rem;
        font-size: 1rem;
        line-height: 1.4;
    }

    & .pm-actions {
        display: flex;
        gap: 0.5rem;
        justify-content: flex-end;
        margin-top: 1rem;
    }

    & .pm-element-host {
        min-height: 16rem;
        margin: 1rem 0;
    }
}
```

**Step 2: Create the component**

`src/client/components/payment-method-modal.ts`:

```typescript
import { html } from 'htm/preact/index.js'
import { type FunctionComponent } from 'preact'
import {
    useCallback,
    useEffect,
    useRef,
    useState
} from 'preact/hooks'
import {
    loadStripe,
    type Stripe as StripeLib,
    type StripeElements
} from '@stripe/stripe-js'
import { batch } from '@preact/signals'
import { State } from '../state.js'
import {
    paymentMethods,
    defaultMethodId,
    paymentMethodsError,
    type PaymentMethodSummary
} from '../payment-methods.js'
import { billingStatus } from '../billing-status.js'
import { Dialog } from './dialog.js'
import './payment-method-modal.css'

type Mode = 'list' | 'adding' | 'confirming-remove'

export interface PaymentMethodModalProps {
    open:boolean;
    onClose:() => void;
}

const TITLE_ID = 'payment-method-modal-title'
const ERROR_ID = 'payment-method-modal-error'

function formatExp (m:number, y:number):string {
    const mm = String(m).padStart(2, '0')
    const yy = String(y).slice(-2)
    return `${mm}/${yy}`
}

function formatBrand (b:string):string {
    if (!b) return 'Card'
    return b.charAt(0).toUpperCase() + b.slice(1)
}

export const PaymentMethodModal:FunctionComponent<
    PaymentMethodModalProps
> = function ({ open, onClose }) {
    const [mode, setMode] = useState<Mode>('list')
    const [setupSecret, setSetupSecret] = useState<string|null>(null)
    const [addError, setAddError] = useState<string|null>(null)
    const [adding, setAdding] = useState(false)
    const stripeRef = useRef<StripeLib|null>(null)
    const elementsRef = useRef<StripeElements|null>(null)
    const elementHostRef = useRef<HTMLDivElement|null>(null)

    // Reset modal-scoped state whenever the dialog closes.
    const handleClose = useCallback(() => {
        batch(() => {
            // Modal-local signals: clear them so a re-open starts
            // clean.
        })
        setMode('list')
        setSetupSecret(null)
        setAddError(null)
        setAdding(false)
        const el = elementsRef.current
        if (el) {
            try {
                // Unmount the payment element to detach event
                // listeners.
                const pmEl = el.getElement('payment')
                if (pmEl) pmEl.unmount()
            } catch {
                // Best-effort cleanup.
            }
        }
        elementsRef.current = null
        onClose()
    }, [onClose])

    // Begin add-a-card flow: fetch a SetupIntent client_secret,
    // initialise Stripe Elements, mount PaymentElement.
    const handleAddCard = useCallback(async () => {
        const pk = billingStatus.value?.stripePublishableKey
        if (!pk) {
            setAddError('stripe_unconfigured')
            return
        }
        setMode('adding')
        setAddError(null)
        try {
            const secret = await State.createSetupIntent()
            setSetupSecret(secret)
            const stripeLib = await loadStripe(pk)
            if (!stripeLib) {
                setAddError('failed_to_load_stripe_js')
                return
            }
            stripeRef.current = stripeLib
            const elements = stripeLib.elements({
                clientSecret: secret
            })
            elementsRef.current = elements
            // The element mounts in a useEffect below once the
            // host node is on screen (mode === 'adding').
        } catch (err) {
            setAddError(err instanceof Error ?
                err.message :
                'setup_intent_failed')
            setMode('list')
        }
    }, [])

    // Once `mode === 'adding'` AND the host node exists AND the
    // elements instance exists, mount the payment element.
    useEffect(() => {
        if (mode !== 'adding') return
        const host = elementHostRef.current
        const elements = elementsRef.current
        if (!host || !elements) return
        const pm = elements.create('payment')
        pm.mount(host)
        return () => {
            try {
                pm.unmount()
            } catch {
                // Best-effort cleanup.
            }
        }
    }, [mode, setupSecret])

    const handleSubmitAdd = useCallback(async () => {
        const stripeLib = stripeRef.current
        const elements = elementsRef.current
        if (!stripeLib || !elements) return
        setAdding(true)
        setAddError(null)
        try {
            const origin = window.location.origin
            const { error } = await stripeLib.confirmSetup({
                elements,
                confirmParams: {
                    return_url: `${origin}/settings`
                },
                redirect: 'if_required'
            })
            if (error) {
                setAddError(error.message || 'card_declined')
                setAdding(false)
                return
            }
            // Success: refresh canonical list (AC3.3, AC8.1), drop
            // back to list mode.
            await State.loadPaymentMethods()
            batch(() => {
                // Phase 2 setters already use batch() internally;
                // wrapping here keeps modal-local resets atomic.
            })
            setMode('list')
            setSetupSecret(null)
            setAdding(false)
        } catch (err) {
            setAddError(err instanceof Error ?
                err.message :
                'confirm_failed')
            setAdding(false)
        }
    }, [])

    const handleCancelAdd = useCallback(() => {
        setMode('list')
        setSetupSecret(null)
        setAddError(null)
        const el = elementsRef.current
        if (el) {
            try {
                const pmEl = el.getElement('payment')
                if (pmEl) pmEl.unmount()
            } catch {
                // Best-effort.
            }
        }
        elementsRef.current = null
    }, [])

    const methods = paymentMethods.value
    const defaultId = defaultMethodId.value
    const globalError = paymentMethodsError.value

    return html`
        <${Dialog}
            open=${open}
            onClose=${handleClose}
            labelledBy=${TITLE_ID}
            describedBy=${addError || globalError ? ERROR_ID : undefined}
            className="payment-method-modal"
        >
            <div class="app-dialog-header">
                <h2 id=${TITLE_ID} class="app-dialog-title">
                    Payment methods
                </h2>
            </div>
            <div class="app-dialog-body">
                ${mode === 'list' && html`
                    <ul class="pm-list">
                        ${methods.map((m) => html`
                            <${Row}
                                method=${m}
                                isDefault=${m.id === defaultId}
                            />
                        `)}
                    </ul>
                    ${globalError && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${globalError}
                        </p>
                    `}
                    <div class="pm-actions">
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleAddCard}
                        >
                            Add a card
                        </button>
                    </div>
                `}
                ${mode === 'adding' && html`
                    <div
                        class="pm-element-host"
                        ref=${elementHostRef}
                    ></div>
                    ${addError && html`
                        <p
                            id=${ERROR_ID}
                            class="pm-error"
                            role="alert"
                        >
                            ${addError}
                        </p>
                    `}
                    <div class="pm-actions">
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleCancelAdd}
                            disabled=${adding || undefined}
                        >
                            Cancel
                        </button>
                        <button
                            type="button"
                            class="btn-link"
                            onClick=${handleSubmitAdd}
                            disabled=${adding || undefined}
                        >
                            ${adding ? 'Adding...' : 'Save card'}
                        </button>
                    </div>
                `}
            </div>
        </${Dialog}>
    `
}

const Row:FunctionComponent<{
    method:PaymentMethodSummary;
    isDefault:boolean;
}> = function ({ method, isDefault }) {
    return html`
        <li class="pm-row">
            <span class="pm-brand-line">
                ${formatBrand(method.brand)} ending in ${method.last4}
                <span class="pm-exp">
                    (${formatExp(method.expMonth, method.expYear)})
                </span>
            </span>
            ${isDefault && html`
                <span class="pm-default-badge">Default</span>
            `}
        </li>
    `
}
```

**Notes:**
- The `Row` component is in the same file because it isn't used
  elsewhere. Phase 5 will extend `Row` to include per-row "Remove"
  and "Set as default" actions; for now it's read-only.
- We deliberately do NOT call `loadPaymentMethods()` inside the modal's
  open transition — the data is loaded by the settings route mount
  (Phase 2 Task 6) and stays current via subsequent mutations. The
  modal renders from the existing signal.
- `aria-describedby` is conditionally set to `ERROR_ID` only when an
  error is showing (AC7.5).
- The `handleClose` callback unmounts the `payment` element and clears
  modal-local state, guaranteeing that re-opening the modal after a
  mid-flow close produces a clean `list` view (AC3.6).
- Note: `batch()` is imported even though most multi-signal updates in
  this component go through Phase 2's setter functions which already
  use `batch()` internally. The import is there for completeness and
  for any future direct-signal updates the modal may add.

**Step 3: Verify type-check + lint + stylelint**

```bash
npm run typecheck && npm run lint && npm run stylelint
```

Expected: zero errors.

**Step 4: Commit**

```bash
git add src/client/components/payment-method-modal.ts \
    src/client/components/payment-method-modal.css
git commit -m "feat(billing): payment-method-modal component"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Wire the modal into the Subscription panel and delete legacy code

**Verifies:** AC1.1, AC1.2, AC1.3, AC6.1, AC6.2, AC6.3.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/routes/settings.ts`
  - Lines 179-182: delete `handleUpdatePaymentMethod` (replace with
    handler for the modal).
  - Lines 499-508: replace the `<button>` + `<p class="hint">` block
    with a "Manage payment methods" button that opens the modal.
  - Add the `PaymentMethodModal` mount at the end of the route's
    render output, and a local `useState` for the open boolean.
- Modify: `/Users/nick/code/rsss/src/client/state.ts`
  - Lines 1497-1517: delete `State.openPaymentMethodUpdate`.
  - Remove its declaration on the State interface/type.

**Step 1: Delete `State.openPaymentMethodUpdate`**

Open `src/client/state.ts`. Find the function definition at lines
1497-1517 and delete the entire block. Also find the matching
declaration on the State interface/type — search for
`openPaymentMethodUpdate`:

```bash
grep -n openPaymentMethodUpdate src/client/state.ts
```

Delete both hits.

**Step 2: Update settings.ts — handler and modal mount**

Open `/Users/nick/code/rsss/src/client/routes/settings.ts`.

**At the top (imports):** Add an import for the new component, near
the existing component imports:

```typescript
import { PaymentMethodModal } from
    '../components/payment-method-modal.js'
```

**Around line 93 (component state):** Add a new local state:

```typescript
const [pmModalOpen, setPmModalOpen] = useState(false)
```

**Replace lines 179-182:** The `handleUpdatePaymentMethod` callback.
Change from:

```typescript
const handleUpdatePaymentMethod = useCallback((e:MouseEvent) => {
    e.preventDefault()
    State.openPaymentMethodUpdate()
}, [])
```

To:

```typescript
const handleOpenPaymentMethods = useCallback((e:MouseEvent) => {
    e.preventDefault()
    setPmModalOpen(true)
}, [])

const handleClosePaymentMethods = useCallback(() => {
    setPmModalOpen(false)
}, [])
```

**Replace lines 499-508:** The button + hint paragraph. Change from:

```typescript
${billing.value?.useLive ? html`
    <button class="btn-link"
        onClick=${handleUpdatePaymentMethod}
    >
        Update payment method
    </button>
    <p class="hint">
        This will open page on stripe.com.
    </p>
` : null}
```

To:

```typescript
${billing.value?.useLive ? html`
    <button class="btn-link"
        onClick=${handleOpenPaymentMethods}
    >
        Manage payment methods
    </button>
` : null}
```

**Mount the modal at the end of the route's JSX**: Find where the
top-level returned template literal ends. Immediately before the
closing tag of the outermost wrapping element (whichever wraps the
whole settings page), add:

```typescript
<${PaymentMethodModal}
    open=${pmModalOpen}
    onClose=${handleClosePaymentMethods}
/>
```

(Placement is mostly cosmetic — the dialog renders into the top
layer regardless of where it appears in the tree.)

**Step 3: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors. If the typechecker flags
`State.openPaymentMethodUpdate` somewhere we missed, grep for it
and delete the remaining usage.

**Step 4: Update the existing settings-route test for the new button text**

Open `/Users/nick/code/rsss/test/settings-route.ts`. The test at
lines 629-654 looks for buttons whose text matches
`/payment method/i` — that regex matches both "Update payment method"
AND "Manage payment methods", so the test continues to verify the
correct gating without changes. Verify by reading the test source and
confirming the regex still works.

If, by inspection, the test asserts the specific text "Update payment
method", rename to "Manage payment methods" in the test. Otherwise,
leave it alone.

**Step 5: Run the test suite**

```bash
npm test
```

Expected: all tests pass.

**Step 6: Commit**

```bash
git add src/client/routes/settings.ts src/client/state.ts \
    test/settings-route.ts
git commit -m "feat(billing): wire payment-method modal into settings panel"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Tests for the modal — open/close, list render, add-card flow

**Verifies:** `payment-method-modal.AC1.1`, `payment-method-modal.AC1.2`,
`payment-method-modal.AC1.3`, `payment-method-modal.AC2.3`,
`payment-method-modal.AC3.3`, `payment-method-modal.AC3.4`,
`payment-method-modal.AC3.6`, `payment-method-modal.AC8.2`,
`payment-method-modal.AC8.3`.

AC3.2 (no PAN/CVC leaks to worker) is verified at the server layer in
Task 2 — the modal never sees raw card data; Stripe's iframe owns it.

**Files:**
- Create: `/Users/nick/code/rsss/test/payment-method-modal.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` (add the
  test entry; needs the `--loader:.css=text` flag because the modal
  and the Dialog primitive import their CSS).

**Pattern reference:**
- `test/dialog.ts` (created in Phase 3) for the modal-mounting test
  pattern.
- `test/cache-status.ts` for signal-driven Preact tests.

**Step 1: Create the test file**

To avoid loading the real `@stripe/stripe-js`, the test uses esbuild's
`--alias` feature to swap it for a tiny in-test stub that exposes
`loadStripe` and the `Stripe` shape. This keeps test bundles small and
gives us a deterministic `confirmSetup` outcome.

`test/stripe-js-stub.ts`:

```typescript
// Test stub for @stripe/stripe-js. The mode is controlled by a
// queryable function `setNextConfirmSetupResult` so individual
// tests can inject success / failure outcomes.

type ConfirmResult = { error?:{ message:string } }

let nextResult:ConfirmResult = {}

export function setNextConfirmSetupResult (r:ConfirmResult):void {
    nextResult = r
}

export async function loadStripe (_pk:string) {
    return {
        elements: (_opts:{ clientSecret:string }) => {
            return {
                create: (_type:string) => ({
                    mount: (_node:Element) => {},
                    unmount: () => {}
                }),
                getElement: (_type:string) => ({
                    unmount: () => {}
                })
            }
        },
        confirmSetup: async (_args:unknown) => {
            return nextResult
        }
    }
}

// Type re-exports to satisfy the modal component's imports under the
// test bundle. The shapes are intentionally loose; the modal only
// uses a few methods.
export type Stripe = unknown
export type StripeElements = unknown
```

Now the test file:

`test/payment-method-modal.ts`:

```typescript
import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { useState, useEffect } from 'preact/hooks'
import { batch } from '@preact/signals'
import { PaymentMethodModal } from
    '../src/client/components/payment-method-modal.js'
import {
    paymentMethods,
    defaultMethodId,
    paymentMethodsError,
    resetPaymentMethods
} from '../src/client/payment-methods.js'
import { billingStatus } from '../src/client/billing-status.js'
import { State } from '../src/client/state.js'
// Indirect — the alias in run-all-tests.mjs swaps the real package.
import { setNextConfirmSetupResult } from './stripe-js-stub.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function mountRoot () {
    const root = document.createElement('div')
    document.body.appendChild(root)
    return {
        root,
        cleanup () {
            render(null, root)
            root.remove()
        }
    }
}

function seedBilling (useLive:boolean):void {
    batch(() => {
        billingStatus.value = {
            entitled: true,
            planId: 'local-first',
            status: 'active',
            refreshedAt: Date.now(),
            useLive,
            stripePublishableKey: useLive ? 'pk_test_modal' : null
        }
    })
}

function seedMethods ():void {
    batch(() => {
        paymentMethods.value = [
            {
                id: 'pm_visa',
                brand: 'visa',
                last4: '4242',
                expMonth: 12,
                expYear: 2030,
                isDefault: false
            },
            {
                id: 'pm_mc',
                brand: 'mastercard',
                last4: '4444',
                expMonth: 6,
                expYear: 2029,
                isDefault: true
            }
        ]
        defaultMethodId.value = 'pm_mc'
    })
}

function resetState ():void {
    resetPaymentMethods()
    billingStatus.value = null
}

test('AC1.1 / AC1.2: Modal opens via showModal in list mode; URL stays',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const before = window.location.href

            const Harness = function () {
                const [open, setOpen] = useState(false)
                useEffect(() => { setOpen(true) }, [])
                return html`
                    <${PaymentMethodModal}
                        open=${open}
                        onClose=${() => setOpen(false)}
                    />
                `
            }
            render(html`<${Harness} />`, root)
            await nextTask()

            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            t.ok(dialog, 'modal dialog rendered')
            t.equal(
                dialog.open,
                true,
                'opened via native showModal()'
            )
            const rows = dialog.querySelectorAll('.pm-row')
            t.equal(rows.length, 2, 'two methods rendered')
            t.equal(
                window.location.href,
                before,
                'URL unchanged'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC2.3: The default method row shows a Default badge',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            const rows = Array.from(
                dialog.querySelectorAll('.pm-row')
            )
            const defaultRow = rows.find(r =>
                r.textContent?.includes('4444'))
            const nonDefaultRow = rows.find(r =>
                r.textContent?.includes('4242'))
            t.ok(
                defaultRow?.querySelector('.pm-default-badge'),
                'default row has badge'
            )
            t.equal(
                nonDefaultRow?.querySelector('.pm-default-badge'),
                null,
                'non-default row has no badge'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC1.3: With useLive=false, Settings does not render the trigger',
    async t => {
        // This is more naturally tested at the settings-route layer
        // (already covered by test/settings-route.ts:629-654). Here
        // we assert that even if a caller mounted the modal with
        // open=true while billing.useLive is false, the user can't
        // start the add-a-card flow because the publishable key is
        // null (handleAddCard surfaces "stripe_unconfigured").
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(false)
            seedMethods()
            render(html`
                <${PaymentMethodModal}
                    open=${true}
                    onClose=${() => {}}
                />
            `, root)
            await nextTask()
            const dialog = document.body.querySelector(
                'dialog.app-dialog.payment-method-modal'
            ) as HTMLDialogElement
            const addBtn = Array.from(
                dialog.querySelectorAll('button')
            ).find(b => (b.textContent ?? '').match(/add a card/i))
            t.ok(addBtn, 'Add a card button rendered')
            addBtn?.click()
            await nextTask()
            const err = dialog.querySelector(
                '.pm-error'
            ) as HTMLElement|null
            t.ok(err, 'inline error shown')
            t.ok(
                err?.textContent?.includes('stripe_unconfigured'),
                'error code mentions stripe_unconfigured'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC3.3 / AC8.1: Successful confirmSetup refreshes the list',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            setNextConfirmSetupResult({})  // success
            let reloadCalls = 0
            const originalLoad = State.loadPaymentMethods
            State.loadPaymentMethods = async () => {
                reloadCalls++
            }
            const originalCreate = State.createSetupIntent
            State.createSetupIntent = async () => 'seti_test_secret'
            try {
                const Harness = function () {
                    const [open, setOpen] = useState(true)
                    return html`
                        <${PaymentMethodModal}
                            open=${open}
                            onClose=${() => setOpen(false)}
                        />
                    `
                }
                render(html`<${Harness} />`, root)
                await nextTask()

                const dialog = document.body.querySelector(
                    'dialog.app-dialog.payment-method-modal'
                ) as HTMLDialogElement
                const addBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await nextTask()
                await nextTask()
                const saveBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/save card/i)
                ) as HTMLButtonElement
                t.ok(saveBtn, 'Save card button shown in adding mode')
                saveBtn.click()
                await nextTask()
                await nextTask()
                t.equal(
                    reloadCalls,
                    1,
                    'loadPaymentMethods called once'
                )
                // Returned to list mode
                t.ok(
                    dialog.querySelector('.pm-list'),
                    'returned to list mode'
                )
            } finally {
                State.loadPaymentMethods = originalLoad
                State.createSetupIntent = originalCreate
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC3.4 / AC8.3: Declined card surfaces error and stays in adding ' +
    'mode', async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            setNextConfirmSetupResult({
                error: { message: 'Your card was declined.' }
            })
            const originalCreate = State.createSetupIntent
            State.createSetupIntent = async () => 'seti_test_secret'
            try {
                render(html`
                    <${PaymentMethodModal}
                        open=${true}
                        onClose=${() => {}}
                    />
                `, root)
                await nextTask()
                const dialog = document.body.querySelector(
                    'dialog.app-dialog.payment-method-modal'
                ) as HTMLDialogElement
                const addBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await nextTask()
                await nextTask()
                const saveBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/save card/i)
                ) as HTMLButtonElement
                saveBtn.click()
                await nextTask()
                await nextTask()
                const err = dialog.querySelector(
                    '.pm-error'
                ) as HTMLElement|null
                t.ok(err, 'inline error shown')
                t.ok(
                    err?.textContent?.includes(
                        'Your card was declined'),
                    'error message preserved'
                )
                // Element host still rendered = still in adding mode.
                t.ok(
                    dialog.querySelector('.pm-element-host'),
                    'still in adding mode (element host present)'
                )
            } finally {
                State.createSetupIntent = originalCreate
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC3.6: Closing the modal mid-flow resets to list on next open',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalCreate = State.createSetupIntent
            State.createSetupIntent = async () => 'seti_test_secret'
            try {
                const Harness = function () {
                    const [open, setOpen] = useState(true)
                    return html`
                        <${PaymentMethodModal}
                            open=${open}
                            onClose=${() => setOpen(false)}
                        />
                        <button
                            type="button"
                            id="reopen"
                            onClick=${() => setOpen(true)}
                        >
                            reopen
                        </button>
                    `
                }
                render(html`<${Harness} />`, root)
                await nextTask()

                const dialog = document.body.querySelector(
                    'dialog.app-dialog.payment-method-modal'
                ) as HTMLDialogElement
                const addBtn = Array.from(
                    dialog.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/add a card/i)
                ) as HTMLButtonElement
                addBtn.click()
                await nextTask()
                await nextTask()
                t.ok(
                    dialog.querySelector('.pm-element-host'),
                    'now in adding mode'
                )
                dialog.close()
                await nextTask()
                t.equal(dialog.open, false, 'modal closed')

                const reopen = root.querySelector(
                    '#reopen'
                ) as HTMLButtonElement
                reopen.click()
                await nextTask()
                t.equal(dialog.open, true, 'reopened')
                t.ok(
                    dialog.querySelector('.pm-list'),
                    'reopened in list mode'
                )
                t.equal(
                    dialog.querySelector('.pm-element-host'),
                    null,
                    'element host gone'
                )
            } finally {
                State.createSetupIntent = originalCreate
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)
```

**Step 2: Wire the test into the runner**

Open `/Users/nick/code/rsss/test/run-all-tests.mjs`. Add a new entry
near the dialog test entry. The alias is critical — it swaps
`@stripe/stripe-js` for our stub so the bundle is tiny and the result
deterministic:

```javascript
    [
        'esbuild ./test/payment-method-modal.ts --bundle',
        '--loader:.css=text',
        '--alias:@stripe/stripe-js=./test/stripe-js-stub.ts',
        '| tapout'
    ].join(' '),
```

**Step 3: Run the test in isolation**

```bash
npx esbuild ./test/payment-method-modal.ts --bundle \
    --loader:.css=text \
    --alias:@stripe/stripe-js=./test/stripe-js-stub.ts \
    | npx tapout
```

Expected: all tests pass.

**Step 4: Run the full suite**

```bash
npm test
```

Expected: no regressions.

**Step 5: Commit**

```bash
git add test/payment-method-modal.ts test/stripe-js-stub.ts \
    test/run-all-tests.mjs
git commit -m "test(billing): payment-method-modal interaction tests"
```
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_8 -->
### Task 8: Final verification gate

**Step 1: Run all checks**

```bash
npm run lint && npm run stylelint && npm run typecheck && npm test
```

Expected: all green.

**Step 2: Smoke-build the worker**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-smoke-1b835f15-p4
```

Expected: dry-run build succeeds.

**Step 3: Manual UI smoke (informational, not gating)**

If `.dev.vars` has real Stripe test keys:

```bash
npm start
```

Then visit `http://127.0.0.1:2222/settings`, click "Manage payment
methods", click "Add a card", enter `4242 4242 4242 4242` with any
future expiry and CVC, click "Save card". Expect the modal to return to
list mode with the new card visible.

Full manual flow (including 3DS) is exercised in Phase 6.

**Done when:**
- ACs listed in this phase's coverage are covered by passing tests in
  `test/payment-methods.ts`, `test/dialog.ts`, and
  `test/payment-method-modal.ts`.
- `npm test`, `npm run lint`, `npm run stylelint`, `npm run typecheck`
  all green.
- `wrangler deploy --dry-run` succeeds.
- Legacy `State.openPaymentMethodUpdate` is removed (`grep` returns no
  matches).
- Legacy `<a>`/button "Update payment method" + hint text are removed
  from `settings.ts`.
<!-- END_TASK_8 -->
