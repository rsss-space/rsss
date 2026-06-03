# Payment Method Modal — Phase 2: Read Endpoint + Client Signal

**Goal:** Wire up the read path end-to-end so the rest of the UI work has
real data to render. Adds a server endpoint that returns a canonical
payment-methods list, a client signal module that mirrors
`billing-status.ts`, and an extension to `GET /api/billing/status` that
surfaces the Stripe publishable key.

**Architecture:** A new Hono route `GET /api/billing/payment-methods`
calls into Phase 1's `stripe-billing.ts` to resolve the Stripe customer id
via Autumn, then makes two Stripe API calls in sequence
(`paymentMethods.list` + `customers.retrieve`) and returns a normalized
JSON payload. A new client module `src/client/payment-methods.ts` mirrors
the shape of `src/client/billing-status.ts` (module-level signals + setter
functions). The settings route mount loads this signal alongside the
existing billing-status load.

**Tech Stack:** Hono, Stripe Node SDK, Preact signals (`@preact/signals`),
`ky` HTTP client (existing `api` instance at `src/client/state.ts:1000`),
tapzero.

**Scope:** 2 of 6 phases. Depends on Phase 1 (`stripe-billing.ts`).

**Codebase verified:** 2026-05-17. Key confirmations and corrections:
- `BillingStatus` interface and exports verified at
  `/Users/nick/code/rsss/src/client/billing-status.ts` (full module is
  ~80 lines; the interface ends at line 55).
- The existing route handler `GET /api/billing/status` is at
  `src/server/index.ts:842-871` and ends with a `contactEmail` field that
  becomes the insertion point for the new `stripePublishableKey` field.
- `State.loadBillingStatus()` lives at `src/client/state.ts:1207-1228`
  and is the canonical pattern for the new `State.loadPaymentMethods()`.
- The route-mount effect in `src/client/routes/settings.ts:65-71` calls
  `State.loadBillingStatus()` inside an authenticated branch — that's
  where `State.loadPaymentMethods()` is added.
- No existing `PaymentMethodSummary` type or `paymentMethods` signal
  exists; the namespace is clean.
- Tests live at `test/`, not `src/test/`. The new test file is
  `test/payment-methods.ts` (matching the convention used by the existing
  `test/billing-management.ts`).
- Stripe SDK shape (from external research): `paymentMethods.list({customer, type:'card'})`
  returns `{ data: Stripe.PaymentMethod[], has_more, ... }`; each item
  has `id`, `card.brand`, `card.last4`, `card.exp_month`, `card.exp_year`.
  `customers.retrieve(id)` without `expand` returns `Stripe.Customer |
  Stripe.DeletedCustomer` where `invoice_settings.default_payment_method`
  is a `string|null`.

---

## Acceptance Criteria Coverage

This phase implements and tests:

### payment-method-modal.AC2: Payment methods list loads
- **payment-method-modal.AC2.1 Success:** `GET /api/billing/payment-methods`
  returns `{methods, defaultId}` where each method has `id`, `brand`, `last4`,
  `expMonth`, `expYear`, and `isDefault` correctly populated.
- **payment-method-modal.AC2.2 Success:** Exactly one method has
  `isDefault: true` and it matches the returned `defaultId`.
- **payment-method-modal.AC2.4 Failure:** When `STRIPE_SECRET_KEY` is unset on
  the worker, the endpoint returns `503 stripe_unconfigured`.

**Deferred to Phase 4:**
- **payment-method-modal.AC2.3 Success:** "The default method is visually
  distinguished in the list (e.g., a 'Default' badge)." This is a UI
  rendering assertion. The data-layer support (`isDefault: true` on the
  matching row, `defaultId` field on the response) is delivered in this
  phase; the visual badge and its test belong with the modal in Phase 4.

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add a helper to read the Stripe publishable key

**Verifies:** Pre-work for AC1.3 (gating UI on configured live mode); no
ACs directly. This is functionality enabling Phase 4.

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/stripe-billing.ts` (created in
  Phase 1) — add a `getStripePublishableKey` helper that returns the env
  var or `null`.

**Step 1: Add the helper export**

Append to `/Users/nick/code/rsss/src/server/stripe-billing.ts` (after
`getStripeCustomerId`):

```typescript
/**
 * Returns the Stripe publishable key for the client, or null when it
 * isn't configured. Distinct from `stripeUseLive()` because the secret
 * key gates server-side functionality while the publishable key gates
 * client-side Elements rendering.
 */
export function getStripePublishableKey (
    env:StripeEnv
):string|null {
    return env.STRIPE_PUBLISHABLE_KEY || null
}
```

**Step 2: Verify type-check**

```bash
npm run typecheck
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add src/server/stripe-billing.ts
git commit -m "feat(billing): add stripe publishable key accessor"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend `GET /api/billing/status` and the client interface

**Verifies:** Supports AC1.3 (the `useLive` gating; client gains
`stripePublishableKey` for Phase 4's Stripe Elements mount).

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts:842-871`
  (`GET /api/billing/status` handler — add field to response)
- Modify: `/Users/nick/code/rsss/src/server/index.ts:33` (extend the
  `stripe-billing.js` import — wait, it doesn't import from
  stripe-billing yet, so add the import)
- Modify: `/Users/nick/code/rsss/src/client/billing-status.ts:45-55`
  (extend the `BillingStatus` interface)

**Step 1: Import `getStripePublishableKey` in the server index**

Open `src/server/index.ts`. Currently lines 19-33 import from
`./autumn-billing.js`. Add a new import after that block:

```typescript
import { getStripePublishableKey } from './stripe-billing.js'
```

**Step 2: Extend the `/api/billing/status` response**

Inside the handler (around lines 854-863), the `c.json({...})` call ends
with `contactEmail`. Add `stripePublishableKey` as the final field:

```typescript
return c.json({
    entitled: isEntitled(billing),
    planId: billing.planId,
    status: billing.status,
    refreshedAt: billing.refreshedAt,
    useLive: billingUseLive(c.env),
    pendingDeletion,
    currentPeriodEnd: billing.currentPeriodEnd,
    canceledAt: billing.canceledAt,
    contactEmail,
    stripePublishableKey: getStripePublishableKey(c.env)
})
```

**Step 3: Extend the client `BillingStatus` interface**

Open `/Users/nick/code/rsss/src/client/billing-status.ts`. Add a new
optional field at the end of the interface (after `contactEmail`):

```typescript
export interface BillingStatus {
    entitled:boolean
    planId:string
    status:'active'|'scheduled'|'none'
    refreshedAt:number
    useLive:boolean
    pendingDeletion?:PendingDeletion|null
    currentPeriodEnd?:number|null
    canceledAt?:number|null
    contactEmail?:string|null
    stripePublishableKey?:string|null
}
```

Keep the existing 80-column rule. Do not change any other line.

**Step 4: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors. Existing code that consumes `BillingStatus` should
keep compiling because the new field is optional.

**Step 5: Add a test asserting the field is present**

Open `/Users/nick/code/rsss/test/billing-management.ts`. Find the test
starting around line 34 (`'GET /api/billing/status includes...'`). Add a
new test immediately after it (and before the next test) with this body:

```typescript
test(
    'GET /api/billing/status includes stripePublishableKey when set',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'test',
            STRIPE_PUBLISHABLE_KEY: 'pk_test_phase2'
        })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'http://127.0.0.1/api/billing/status',
            { method: 'GET', headers: authedHeaders(cookieHeader) },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 200, 'returns 200')
        t.equal(
            body.stripePublishableKey,
            'pk_test_phase2',
            'echoes configured publishable key'
        )
    }
)

test(
    'GET /api/billing/status returns null stripePublishableKey when unset',
    async t => {
        const env = makeEnv({ NODE_ENV: 'test' })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'http://127.0.0.1/api/billing/status',
            { method: 'GET', headers: authedHeaders(cookieHeader) },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 200, 'returns 200')
        t.equal(
            body.stripePublishableKey,
            null,
            'returns null when publishable key is unconfigured'
        )
    }
)
```

**Step 6: Run the test**

```bash
npm test
```

Expected: all tests pass (existing + the two new ones).

**Step 7: Commit**

```bash
git add src/server/index.ts src/client/billing-status.ts \
    test/billing-management.ts
git commit -m "feat(billing): surface stripe publishable key in status response"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-5) -->

<!-- START_TASK_3 -->
### Task 3: Create `GET /api/billing/payment-methods` route

**Verifies:** `payment-method-modal.AC2.1`, `payment-method-modal.AC2.2`,
`payment-method-modal.AC2.4`.

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts` — add a new helper
  function and a new route. The helper function builds the canonical
  `{methods, defaultId}` payload and will be reused by Phases 4 and 5 for
  the canonical refresh on mutations. Place it near the other billing
  helpers (after `resolveBilling` ends around line 213).
- Modify: `/Users/nick/code/rsss/src/server/index.ts` — register the new
  route near `GET /api/billing/status` (around line 842). Use the same
  middleware stack (`requireAuth`).

**Reference patterns:**
- `src/server/index.ts:842-871` — handler shape for billing read routes
  (`requireAuth` middleware, `c.get('session')!`, try/catch with
  `console.error` + 503 fallback).
- External research at
  `/tmp/plan-2026-05-17-payment-method-modal-1b835f15/phase2-stripe-read-research.md`
  documents the Stripe SDK call shapes.

**Step 1: Add a type for the response shape**

Open `src/server/index.ts`. After the existing `CachedBilling` interface
(around line 71), add:

```typescript
export interface PaymentMethodSummary {
    id:string;
    brand:string;
    last4:string;
    expMonth:number;
    expYear:number;
    isDefault:boolean;
}

export interface PaymentMethodsPayload {
    methods:PaymentMethodSummary[];
    defaultId:string|null;
}
```

(`export` so the helper can be unit-tested if we choose to, and so
later phases can import it.)

**Step 2: Add the helper that builds the canonical payload**

Place this helper alongside `resolveBilling` (e.g., after it ends around
line 213). The helper isolates the Stripe calls and the normalization
logic so Phases 4 and 5 can reuse it without duplicating the JSON
shape.

```typescript
import {
    stripeUseLive,
    getStripe,
    getStripeCustomerId
} from './stripe-billing.js'
import type Stripe from 'stripe'

async function listPaymentMethodsPayload (
    env:Env,
    did:string
):Promise<PaymentMethodsPayload> {
    const stripe = getStripe(env)
    const customerId = await getStripeCustomerId(env, did)
    const [list, customer] = await Promise.all([
        stripe.paymentMethods.list({
            customer: customerId,
            type: 'card'
        }),
        stripe.customers.retrieve(customerId)
    ])
    const defaultId = customer.deleted ?
        null :
        normalizeDefaultId(
            (customer as Stripe.Customer)
                .invoice_settings?.default_payment_method
        )
    const methods:PaymentMethodSummary[] = list.data.map(pm => ({
        id: pm.id,
        brand: pm.card?.brand ?? 'unknown',
        last4: pm.card?.last4 ?? '????',
        expMonth: pm.card?.exp_month ?? 0,
        expYear: pm.card?.exp_year ?? 0,
        isDefault: pm.id === defaultId
    }))
    return { methods, defaultId }
}

function normalizeDefaultId (
    raw:string|Stripe.PaymentMethod|null|undefined
):string|null {
    if (!raw) return null
    if (typeof raw === 'string') return raw
    return raw.id
}
```

**Notes:**

- `Promise.all` runs `paymentMethods.list` and `customers.retrieve` in
  parallel. They're independent and the two-call sequencing the design
  describes is not a hard requirement.
- `customer.deleted` check handles the rare `Stripe.DeletedCustomer`
  union case. Without `expand`, `default_payment_method` is a string id;
  we still narrow defensively in case a future call adds `expand`.
- Fallback values (`'unknown'`, `'????'`, `0`) only fire if Stripe returns
  a non-card PaymentMethod — which `type:'card'` filter should prevent —
  so they're defensive. Do NOT silently swallow Stripe failures here;
  let them bubble to the route handler which maps them to 502.

**Step 3: Register the new route**

Add this route handler right after the existing
`GET /api/billing/status` block (after line 871):

```typescript
app.get(
    '/api/billing/payment-methods',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
            return c.json(payload)
        } catch (err) {
            console.error('billing/payment-methods error:', err)
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)
```

**Step 4: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors.

**Step 5: Commit (without tests yet — tests are Task 4)**

```bash
git add src/server/index.ts
git commit -m "feat(billing): GET /api/billing/payment-methods"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for `GET /api/billing/payment-methods`

**Verifies:** `payment-method-modal.AC2.1`, `payment-method-modal.AC2.2`,
`payment-method-modal.AC2.4`.

**Files:**
- Create: `/Users/nick/code/rsss/test/payment-methods.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — add a new
  entry alongside the existing `billing-management.ts` and the new
  `stripe-billing.ts` entry from Phase 1.

**Pattern reference:**
- `/Users/nick/code/rsss/test/billing-management.ts:34-70` — GET endpoint
  test shape (auth header helper, `app.request`, response assertion).
- `/Users/nick/code/rsss/test/billing-management.ts:150-229` — `withFetch`
  pattern for mocking BOTH Autumn AND Stripe in one test. Stripe URLs
  pass through `api.stripe.com/v1/...`.
- `/Users/nick/code/rsss/test/signup-helpers.ts:236-257` — `customerBody`
  factory; we'll override `stripe_id` to a non-null value to drive the
  Phase 1 `getStripeCustomerId` helper through the pull-through path.

**Step 1: Create `test/payment-methods.ts`**

```typescript
import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'
import {
    makeEnv,
    makeSession,
    withFetch,
    jsonResponse,
    customerBody,
    executionCtx,
    TEST_CSRF_TOKEN
} from './signup-helpers.js'

function authedHeaders (cookieHeader:string):Record<string, string> {
    return {
        'content-type': 'application/json',
        cookie: cookieHeader,
        'x-csrf-token': TEST_CSRF_TOKEN,
        'sec-fetch-site': 'same-origin'
    }
}

const AUTUMN_KEY = 'am_test_secret_key'
const STRIPE_KEY = 'sk_test_payment_methods'

test(
    'GET /api/billing/payment-methods requires auth',
    async t => {
        const env = makeEnv({
            STRIPE_SECRET_KEY: STRIPE_KEY,
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const res = await app.request(
            'http://127.0.0.1/api/billing/payment-methods',
            {
                method: 'GET',
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
    'GET /api/billing/payment-methods returns 503 when ' +
    'STRIPE_SECRET_KEY is unset',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY
            // STRIPE_SECRET_KEY intentionally unset
        })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'http://127.0.0.1/api/billing/payment-methods',
            { method: 'GET', headers: authedHeaders(cookieHeader) },
            env,
            executionCtx
        )
        const body = await res.json() as { error?:string }

        t.equal(res.status, 503, 'returns 503')
        t.equal(
            body.error,
            'stripe_unconfigured',
            'error code identifies missing secret'
        )
    }
)

test(
    'GET /api/billing/payment-methods returns canonical list ' +
    'and default id',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)

        await withFetch(async call => {
            // Autumn customer lookup -> returns stripe_id
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            // Stripe payment_methods.list
            if (call.url.includes(
                'api.stripe.com/v1/payment_methods')) {
                return jsonResponse({
                    object: 'list',
                    has_more: false,
                    data: [
                        {
                            id: 'pm_visa',
                            object: 'payment_method',
                            type: 'card',
                            card: {
                                brand: 'visa',
                                last4: '4242',
                                exp_month: 12,
                                exp_year: 2030
                            }
                        },
                        {
                            id: 'pm_mastercard',
                            object: 'payment_method',
                            type: 'card',
                            card: {
                                brand: 'mastercard',
                                last4: '4444',
                                exp_month: 6,
                                exp_year: 2029
                            }
                        }
                    ]
                })
            }
            // Stripe customers.retrieve -> default_payment_method
            if (call.url.includes(
                'api.stripe.com/v1/customers/cus_test_alice')) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_mastercard'
                    }
                })
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods',
                { method: 'GET', headers: authedHeaders(cookieHeader) },
                env,
                executionCtx
            )
            const body = await res.json() as {
                methods:Array<{
                    id:string;
                    brand:string;
                    last4:string;
                    expMonth:number;
                    expYear:number;
                    isDefault:boolean;
                }>;
                defaultId:string|null;
            }

            t.equal(res.status, 200, 'returns 200')
            t.equal(body.defaultId, 'pm_mastercard', 'defaultId set')
            t.equal(body.methods.length, 2, 'two methods returned')

            const visa = body.methods.find(m => m.id === 'pm_visa')!
            t.equal(visa.brand, 'visa', 'visa brand populated')
            t.equal(visa.last4, '4242', 'visa last4 populated')
            t.equal(visa.expMonth, 12, 'visa expMonth populated')
            t.equal(visa.expYear, 2030, 'visa expYear populated')
            t.equal(visa.isDefault, false, 'visa is not default')

            const mc = body.methods.find(m => m.id === 'pm_mastercard')!
            t.equal(mc.isDefault, true, 'mastercard is default')

            const defaults = body.methods.filter(m => m.isDefault)
            t.equal(
                defaults.length,
                1,
                'exactly one method has isDefault=true'
            )
            t.equal(
                defaults[0].id,
                body.defaultId,
                'isDefault matches defaultId'
            )
        })
    }
)

test(
    'GET /api/billing/payment-methods returns empty methods + ' +
    'null defaultId when customer has no cards on file',
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
                'api.stripe.com/v1/payment_methods')) {
                return jsonResponse({
                    object: 'list',
                    has_more: false,
                    data: []
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/customers/cus_test_alice')) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: null
                    }
                })
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods',
                { method: 'GET', headers: authedHeaders(cookieHeader) },
                env,
                executionCtx
            )
            const body = await res.json() as {
                methods:unknown[];
                defaultId:string|null;
            }

            t.equal(res.status, 200, 'returns 200')
            t.equal(body.defaultId, null, 'defaultId is null')
            t.equal(body.methods.length, 0, 'methods is empty')
        })
    }
)

test(
    'GET /api/billing/payment-methods returns 502 when Stripe ' +
    'list call fails',
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
            if (call.url.includes('api.stripe.com/v1/')) {
                return jsonResponse(
                    { error: { type: 'api_error' } },
                    500
                )
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods',
                { method: 'GET', headers: authedHeaders(cookieHeader) },
                env,
                executionCtx
            )
            const body = await res.json() as { error?:string }

            t.equal(res.status, 502, 'returns 502 on Stripe failure')
            t.equal(body.error, 'stripe_error', 'error code is stripe_error')
        })
    }
)
```

**Step 2: Wire the new test into the runner**

Open `/Users/nick/code/rsss/test/run-all-tests.mjs`. After the
`billing-management.ts` block (which Phase 1 placed the `stripe-billing.ts`
block next to), add a new entry for `payment-methods.ts`:

```javascript
    [
        'esbuild ./test/payment-methods.ts --bundle',
        '| tapout'
    ].join(' '),
```

**Step 3: Run the new test in isolation first**

```bash
npx esbuild ./test/payment-methods.ts --bundle | npx tapout
```

Expected: all assertions pass. If they fail, fix Task 3's implementation
before continuing.

**Step 4: Run the full suite**

```bash
npm test
```

Expected: no regressions.

**Step 5: Commit**

```bash
git add test/payment-methods.ts test/run-all-tests.mjs
git commit -m "test(billing): payment-methods GET endpoint"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Create client signal module `src/client/payment-methods.ts`

**Verifies:** Pre-work for Phase 4's modal. No ACs directly.

**Files:**
- Create: `/Users/nick/code/rsss/src/client/payment-methods.ts`

**Pattern reference:**
- `/Users/nick/code/rsss/src/client/billing-status.ts` (full file is the
  template) — same shape: module-level signals, setter functions,
  `batch()` for multi-signal resets.

**Step 1: Create the file**

```typescript
/**
 * Global signals for the user's saved Stripe payment methods. Mirrors
 * the shape of the server's GET /api/billing/payment-methods response.
 */
import { type Signal, signal, batch } from '@preact/signals'

export interface PaymentMethodSummary {
    id:string;
    brand:string;
    last4:string;
    expMonth:number;
    expYear:number;
    isDefault:boolean;
}

export const paymentMethods:Signal<PaymentMethodSummary[]> = signal([])
export const defaultMethodId:Signal<string|null> = signal(null)
export const paymentMethodsLoading:Signal<boolean> = signal(false)
export const paymentMethodsError:Signal<string|null> = signal(null)

export function setPaymentMethodsState (
    methods:PaymentMethodSummary[],
    defaultId:string|null
):void {
    batch(() => {
        paymentMethods.value = methods
        defaultMethodId.value = defaultId
    })
}

export function setPaymentMethodsLoading (v:boolean):void {
    paymentMethodsLoading.value = v
}

export function setPaymentMethodsError (msg:string|null):void {
    paymentMethodsError.value = msg
}

export function resetPaymentMethods ():void {
    batch(() => {
        paymentMethods.value = []
        defaultMethodId.value = null
        paymentMethodsLoading.value = false
        paymentMethodsError.value = null
    })
}
```

**Step 2: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors. Keep the 80-column rule.

**Step 3: Commit**

```bash
git add src/client/payment-methods.ts
git commit -m "feat(billing): payment-methods client signal module"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 6-7) -->

<!-- START_TASK_6 -->
### Task 6: Add `State.loadPaymentMethods()` and the route-mount call

**Verifies:** Wires Task 3's endpoint to Task 5's signals; enables the
data to be present when Phase 4's modal opens.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add new action
  alongside `State.loadBillingStatus`. Place it adjacent to the existing
  `State.loadBillingStatus = async function...` definition (around line
  1207-1228) so related billing actions are grouped.
- Modify: `/Users/nick/code/rsss/src/client/routes/settings.ts:65-71` —
  add `State.loadPaymentMethods()` to the route-mount effect.

**Pattern reference:**
- `src/client/state.ts:1207-1228` — `loadBillingStatus()` is the
  template. Use the same `try { ... } catch` shape, the same
  `throwHttpErrors: false` flag, the same per-action error message
  format (e.g., `status_${res.status}` for HTTP errors).

**Step 1: Add the new import block at the top of `state.ts`**

The file already has imports. Find the import of `billing-status.js`
(grep for `from './billing-status` near the top of the file). Below
it, add:

```typescript
import {
    setPaymentMethodsState,
    setPaymentMethodsLoading,
    setPaymentMethodsError,
    type PaymentMethodSummary
} from './payment-methods.js'
```

**Step 2: Add the action**

Find the line `State.loadBillingStatus = async function (` (around line
1207). After that function's closing brace (around line 1228), add:

```typescript
State.loadPaymentMethods = async function (
):Promise<void> {
    setPaymentMethodsLoading(true)
    try {
        const res = await api.get('billing/payment-methods', {
            throwHttpErrors: false
        })
        if (!res.ok) {
            const body = await res.json<{ error?:string }>().catch(
                () => ({} as { error?:string })
            )
            const code = body.error || `status_${res.status}`
            batch(() => {
                setPaymentMethodsError(code)
                setPaymentMethodsLoading(false)
            })
            return
        }
        const data = await res.json<{
            methods:PaymentMethodSummary[];
            defaultId:string|null;
        }>()
        batch(() => {
            setPaymentMethodsState(data.methods, data.defaultId)
            setPaymentMethodsError(null)
            setPaymentMethodsLoading(false)
        })
    } catch (err) {
        debug('loadPaymentMethods error:', err)
        batch(() => {
            setPaymentMethodsError(err instanceof Error ?
                err.message :
                'failed_to_load')
            setPaymentMethodsLoading(false)
        })
    }
}
```

**Notes:**
- `batch()` is required because multiple signals (`paymentMethods`,
  `defaultMethodId`, `paymentMethodsLoading`, `paymentMethodsError`)
  may update together. The wrapper functions `setPaymentMethodsState`
  and `setPaymentMethodsError` already use `batch()` internally for
  multi-signal sets, but wrapping the whole effect in `batch()` is also
  necessary because the loading-flag transition is on a separate
  setter.
- The error code shape mirrors the design: server returns
  `{error: 'stripe_unconfigured'}` for AC2.4 — the client surfaces that
  exact code so UI can map it to a human message.
- Ensure `import { batch } from '@preact/signals'` exists in
  `state.ts`. Confirm with:
  ```bash
  grep -n "from '@preact/signals'" src/client/state.ts
  ```
  Expected: at least one import line that includes `batch`. If
  missing, add `batch` to the existing `@preact/signals` import.

**Step 3: Declare the new method on the State type**

Earlier in `state.ts`, look for the State surface declaration (it's
either an `interface State { ... }` or an `export const State: ... = {}`
shape). Find the `loadBillingStatus` field declaration and add
`loadPaymentMethods:() => Promise<void>` immediately after it.

If you can't immediately locate the declaration block, search for
`loadBillingStatus`:

```bash
grep -n 'loadBillingStatus' src/client/state.ts
```

There will be two hits: the declaration in the type/interface, and the
implementation. Add `loadPaymentMethods` parallel to both.

**Step 4: Add to the route-mount effect**

Open `/Users/nick/code/rsss/src/client/routes/settings.ts`. The
effect at lines 65-71 currently reads:

```typescript
useEffect(() => {
    loadLocalFirstSettings()
    isLocalFirstSupported()
    if (state.isAuthenticated.value) {
        State.loadBillingStatus()
    }
}, [])
```

Change the authenticated branch to call both:

```typescript
useEffect(() => {
    loadLocalFirstSettings()
    isLocalFirstSupported()
    if (state.isAuthenticated.value) {
        State.loadBillingStatus()
        State.loadPaymentMethods()
    }
}, [])
```

**Step 5: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors. If `State.loadPaymentMethods` is reported as
undeclared, the type declaration in Step 3 is missing.

**Step 6: Commit**

```bash
git add src/client/state.ts src/client/routes/settings.ts
git commit -m "feat(billing): wire loadPaymentMethods into State and settings route"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Final verification gate

**Step 1: Run lint, typecheck, full test suite**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all three succeed.

**Step 2: Smoke-build the worker**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-smoke-1b835f15-p2
```

Expected: dry-run build succeeds and bundle includes the new route.

**Step 3: Quick grep sanity checks**

```bash
grep -n "payment-methods" src/server/index.ts
grep -n "loadPaymentMethods" src/client/state.ts src/client/routes/settings.ts
```

Expected:
- `src/server/index.ts` shows the new GET route registration.
- `src/client/state.ts` shows both the type declaration and the method
  body.
- `src/client/routes/settings.ts` shows the call inside the effect.

**Done when:**
- AC2.1, AC2.2, AC2.4 are covered by passing tests in
  `test/payment-methods.ts`.
- `npm test` and `npm run lint` are green.
- `wrangler deploy --dry-run` succeeds.
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->
