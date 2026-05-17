# Settings Subscription Panel Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the giant "Manage subscription" portal-redirect button in `/settings` with an in-app panel that shows plan, renewal date, and contact email, and lets the user cancel and resume the subscription without leaving RSSS. Updating the payment method is the only remaining redirect, and uses a single-purpose Stripe-hosted page (Autumn `setupPayment`) instead of the kitchen-sink customer portal.

**Architecture:**
1. Backend (`src/server/autumn-billing.ts`, `src/server/index.ts`) — add a single `getSubscriptionSnapshot` helper, widen the cached billing record and `GET /api/billing/status` response, add three POST endpoints (`/api/billing/cancel`, `/api/billing/resume`, `/api/billing/payment-method`) that delegate to `billing.update({ cancelAction: ... })` and `billing.setupPayment`. In dev mode (no Autumn key), cancel/resume mutate the KV-cached billing record so the UI is testable end-to-end without Autumn.
2. Frontend (`src/client/billing-status.ts`, `src/client/state.ts`, `src/client/routes/settings.ts`, `src/client/routes/settings.css`) — extend the `BillingStatus` interface, add three new `State` methods (`cancelSubscription`, `resumeSubscription`, `openPaymentMethodUpdate`), and rewrite the Subscription section markup + CSS to render an information-rich panel with quiet text-button controls instead of one big blue CTA.
3. Tests — server endpoint tests live in `test/billing-management.ts` (Node, bundled with `--alias:cloudflare:workers=...`), client component tests extend `test/settings-route.ts` (Chromium via tapout).

**Tech Stack:** TypeScript (Cloudflare Workers + ES2022 lib) · Hono · Preact + `@preact/signals` · `htm/preact` · `autumn-js` · `@substrate-system/tapzero` · esbuild + `tapout`.

**Spec:** `docs/design-plans/2026-05-16-settings-subscription-redesign.md`

---

## File Structure

### Server

| File | Status | Responsibility |
|---|---|---|
| `src/server/autumn-billing.ts` | Modify | Add `getSubscriptionSnapshot`, `cancelSubscription`, `resumeSubscription`, `getPaymentSetupUrl`. Refactor `getCurrentPeriodEnd` to delegate to the snapshot helper. |
| `src/server/index.ts` | Modify | Widen `CachedBilling`, extend `GET /api/billing/status` payload, add `POST /api/billing/{cancel,resume,payment-method}` routes. Existing `POST /api/billing/portal` stays for one release. |

### Client

| File | Status | Responsibility |
|---|---|---|
| `src/client/billing-status.ts` | Modify | Extend `BillingStatus` with `currentPeriodEnd`, `canceledAt`, `contactEmail`. |
| `src/client/state.ts` | Modify | Add `State.cancelSubscription`, `State.resumeSubscription`, `State.openPaymentMethodUpdate`. Leave `State.openCustomerPortal` defined (still used by `signup.ts`). |
| `src/client/routes/settings.ts` | Modify | Replace the Subscription section's markup and click handler; preserve the free-tier branch and the rest of the file. |
| `src/client/routes/settings.css` | Modify | Replace `.subscription-section` rules with the new panel layout. No new CSS variables. |

### Tests

| File | Status | Responsibility |
|---|---|---|
| `test/billing-management.ts` | Create | Server integration tests for cancel/resume/payment-method endpoints in both dev mode and live (autumn-mocked) mode. |
| `test/settings-route.ts` | Modify | Add UI tests covering: active panel renders cancel + payment-method controls; scheduled-cancel panel renders resume button; cancel button calls `State.cancelSubscription`. |
| `test/run-all-tests.mjs` | Modify | Register the new `test/billing-management.ts` bundle in the aggregator. |

---

## Phase 1 — Server-side subscription snapshot

### Task 1: Add `getSubscriptionSnapshot` to `autumn-billing.ts`

**Files:**
- Modify: `src/server/autumn-billing.ts`
- Test: covered indirectly by Task 4 endpoint tests; no isolated unit test (the function is a thin wrapper around the Autumn SDK and a generic mock has limited value)

- [ ] **Step 1: Add a `SubscriptionSnapshot` interface and `getSubscriptionSnapshot` function**

Open `src/server/autumn-billing.ts` and add the following after `getCurrentPeriodEnd` (around line 175):

```ts
export interface SubscriptionSnapshot {
    /** end of the current paid period (ms epoch), or null */
    currentPeriodEnd:number|null;
    /** ms epoch the user scheduled cancellation, or null */
    canceledAt:number|null;
}

/**
 * Read the user's active or scheduled subscription matching planId
 * (defaults to the user's first active or scheduled non-add-on
 * subscription) and return its lifecycle timestamps.
 *
 * Returns a snapshot with null fields when Autumn isn't configured
 * or when there's no matching subscription.
 */
export async function getSubscriptionSnapshot (
    env:BillingEnv,
    did:string,
    planId?:BillingPlanId
):Promise<SubscriptionSnapshot> {
    if (!useLive(env)) {
        return { currentPeriodEnd: null, canceledAt: null }
    }
    const customer = await client(env).customers.getOrCreate({
        customerId: didToCustomerId(did),
        expand: ['subscriptions.plan']
    })
    const subs = customer.subscriptions ?? []
    for (const s of subs) {
        if (s.addOn) continue
        if (planId && s.planId !== planId) continue
        if (!isVerifiedSubscriptionStatus(s.status)) continue
        const cur = (s as { currentPeriodEnd?:number|null })
            .currentPeriodEnd
        const cancelledRaw = (s as { canceledAt?:number|null })
            .canceledAt
        return {
            currentPeriodEnd: typeof cur === 'number' &&
                Number.isFinite(cur) ?
                cur :
                null,
            canceledAt: typeof cancelledRaw === 'number' &&
                Number.isFinite(cancelledRaw) ?
                cancelledRaw :
                null
        }
    }
    return { currentPeriodEnd: null, canceledAt: null }
}
```

- [ ] **Step 2: Refactor `getCurrentPeriodEnd` to delegate to the snapshot**

Replace the body of `getCurrentPeriodEnd` (around line 155) with:

```ts
export async function getCurrentPeriodEnd (
    env:BillingEnv,
    did:string
):Promise<number|null> {
    const snapshot = await getSubscriptionSnapshot(env, did)
    return snapshot.currentPeriodEnd
}
```

- [ ] **Step 3: Run typecheck to verify the refactor compiles**

Run: `npm run typecheck`
Expected: PASS with no errors. If TS complains about the unused `canceledAt`-field reading, double check property names match the `Autumn` `Subscription` type — Autumn returns camelCase via the JS SDK.

- [ ] **Step 4: Commit**

```bash
git add src/server/autumn-billing.ts
git commit -m "feat(billing): add getSubscriptionSnapshot helper

Returns currentPeriodEnd and canceledAt in a single Autumn call.
Refactors getCurrentPeriodEnd to delegate, keeping its public API."
```

---

### Task 2: Add `cancelSubscription`, `resumeSubscription`, `getPaymentSetupUrl` helpers

**Files:**
- Modify: `src/server/autumn-billing.ts`

- [ ] **Step 1: Add the three helpers**

Append to `src/server/autumn-billing.ts` (after `getSubscriptionSnapshot`):

```ts
/**
 * Schedule cancellation of the customer's active subscription at
 * the end of the current billing period. Returns the resulting
 * snapshot so callers can refresh local state in one round-trip.
 */
export async function cancelSubscription (
    env:BillingEnv,
    did:string,
    planId:BillingPlanId
):Promise<SubscriptionSnapshot> {
    await client(env).billing.update({
        customerId: didToCustomerId(did),
        planId,
        cancelAction: 'cancel_end_of_cycle'
    })
    return getSubscriptionSnapshot(env, did, planId)
}

/**
 * Reverse a scheduled cancellation, putting the subscription back
 * into a normal renewing state.
 */
export async function resumeSubscription (
    env:BillingEnv,
    did:string,
    planId:BillingPlanId
):Promise<SubscriptionSnapshot> {
    await client(env).billing.update({
        customerId: didToCustomerId(did),
        planId,
        cancelAction: 'uncancel'
    })
    return getSubscriptionSnapshot(env, did, planId)
}

/**
 * Returns a single-purpose Stripe-hosted URL the user can visit to
 * add or update their payment method. The URL is short-lived; the
 * client navigates to it directly.
 */
export async function getPaymentSetupUrl (
    env:BillingEnv,
    did:string,
    returnUrl:string
):Promise<string> {
    const c = client(env) as unknown as {
        billing:{
            setupPayment:(args:{
                customerId:string;
                returnUrl?:string;
            }) => Promise<{ url:string }>;
        };
    }
    const res = await c.billing.setupPayment({
        customerId: didToCustomerId(did),
        returnUrl
    })
    return res.url
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/server/autumn-billing.ts
git commit -m "feat(billing): add cancel/resume/payment-method helpers

Wrappers around autumn-js billing.update + billing.setupPayment
that return a fresh subscription snapshot to the caller."
```

---

## Phase 2 — Widen the cached billing record and `/api/billing/status` response

### Task 3: Extend `CachedBilling` shape and `resolveBilling`

**Files:**
- Modify: `src/server/index.ts:61-65` and the `resolveBilling` block (around lines 174-202)

- [ ] **Step 1: Update the `CachedBilling` interface**

Replace lines 61-65 of `src/server/index.ts`:

```ts
interface CachedBilling {
    planId:string;
    status:'active'|'scheduled'|'none';
    refreshedAt:number;
    currentPeriodEnd:number|null;
    canceledAt:number|null;
}
```

- [ ] **Step 2: Import `getSubscriptionSnapshot`**

In the `import { ... } from './autumn-billing.js'` block near the top of the file (around lines 19-29), add `getSubscriptionSnapshot,`:

```ts
import {
    BILLING_PLAN_IDS,
    isValidPlanId,
    useLive as billingUseLive,
    getOrCreateCustomer,
    attachCheckout,
    verifySubscription,
    getCustomerPortalUrl,
    getCurrentPeriodEnd,
    getSubscriptionSnapshot,
    type BillingPlanId
} from './autumn-billing.js'
```

- [ ] **Step 3: Update `resolveBilling` to fill the new fields**

Replace the body of `resolveBilling` (around lines 174-202):

```ts
async function resolveBilling (
    env:Env,
    did:string,
    planId:BillingPlanId = DEFAULT_PLAN_ID
):Promise<CachedBilling> {
    const cached = await readCachedBilling(env, did)
    if (cached) return cached

    if (!billingUseLive(env)) {
        const fresh:CachedBilling = {
            planId,
            status: 'none',
            refreshedAt: Date.now(),
            currentPeriodEnd: null,
            canceledAt: null
        }
        await writeCachedBilling(env, did, fresh)
        return fresh
    }

    const verified = await verifySubscription(env, did, planId)
    const snapshot = verified ?
        await getSubscriptionSnapshot(env, did, planId) :
        { currentPeriodEnd: null, canceledAt: null }
    const fresh:CachedBilling = {
        planId,
        status: verified ? verified.status : 'none',
        refreshedAt: Date.now(),
        currentPeriodEnd: snapshot.currentPeriodEnd,
        canceledAt: snapshot.canceledAt
    }
    await writeCachedBilling(env, did, fresh)
    return fresh
}
```

- [ ] **Step 4: Update every other `CachedBilling` literal in `index.ts`**

Search `src/server/index.ts` for `CachedBilling = {`:

```bash
grep -n "CachedBilling = {" src/server/index.ts
```

Each match must include `currentPeriodEnd: null, canceledAt: null` (or computed values). Two known sites: the checkout dev-mode shortcut (around line 1011) and the checkout/return live-mode write (around line 1140). Update both to:

```ts
const billing:CachedBilling = {
    planId,
    status: 'active',
    refreshedAt: Date.now(),
    currentPeriodEnd: null,
    canceledAt: null
}
```

For the checkout/return live-mode site, also fetch the snapshot so we cache the real period end immediately:

```ts
const snapshot = await getSubscriptionSnapshot(
    c.env,
    session.did,
    planId
)
const billing:CachedBilling = {
    planId,
    status: 'active',
    refreshedAt: Date.now(),
    currentPeriodEnd: snapshot.currentPeriodEnd,
    canceledAt: snapshot.canceledAt
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: PASS. If TS errors point at unrelated `CachedBilling` literals, update those too.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(billing): widen CachedBilling with period/cancel timestamps

Reads currentPeriodEnd and canceledAt via getSubscriptionSnapshot
in the same Autumn call. All cache-write sites now carry the new
fields. No client-visible behavior change yet."
```

---

### Task 4: Extend `GET /api/billing/status` response with the new fields

**Files:**
- Modify: `src/server/index.ts` (`GET /api/billing/status` handler around lines 831-853)
- Test: `test/billing-management.ts` (new)

- [ ] **Step 1: Create `test/billing-management.ts` with a "GET /api/billing/status returns extended fields" test**

Create `test/billing-management.ts`:

```ts
/**
 * Server-side integration tests for the in-app subscription-
 * management endpoints introduced by the settings panel redesign.
 *
 * Drives the real Hono app from `src/server/index.ts`. Uses the
 * shared signup-helpers utilities (in-memory KV stub, fetch
 * interceptor, executionCtx) so we don't need a real Autumn
 * account.
 */
import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'
import {
    makeEnv,
    makeSession,
    withFetch,
    jsonResponse,
    customerBody,
    activeSubscription,
    executionCtx,
    TEST_CSRF_TOKEN
} from './signup-helpers.js'

const AUTUMN_KEY = 'am_test_secret_key'

function authedHeaders (cookieHeader:string):Record<string, string> {
    return {
        'content-type': 'application/json',
        cookie: cookieHeader,
        'x-csrf-token': TEST_CSRF_TOKEN,
        'sec-fetch-site': 'same-origin'
    }
}

test(
    'GET /api/billing/status includes currentPeriodEnd and ' +
    'canceledAt fields',
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
        t.equal(body.entitled, false, 'free user is not entitled')
        t.ok(
            'currentPeriodEnd' in body,
            'response includes currentPeriodEnd'
        )
        t.ok(
            'canceledAt' in body,
            'response includes canceledAt'
        )
        t.equal(
            body.currentPeriodEnd,
            null,
            'free user has null currentPeriodEnd'
        )
        t.equal(
            body.canceledAt,
            null,
            'free user has null canceledAt'
        )
    }
)
```

- [ ] **Step 2: Register the new test bundle**

Append to the `commands` array in `test/run-all-tests.mjs`:

```js
[
    'esbuild ./test/billing-management.ts --bundle',
    '--platform=node --format=esm',
    '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
    '| node --input-type=module | tap-spec'
].join(' '),
```

Place it next to the other `signup`-style entries.

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx esbuild ./test/billing-management.ts --bundle --platform=node --format=esm --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts | node --input-type=module | npx tap-spec`
Expected: FAIL on the `'currentPeriodEnd' in body` assertion (the field doesn't exist yet).

- [ ] **Step 4: Extend the `GET /api/billing/status` handler**

In `src/server/index.ts`, replace the body of the handler (around lines 831-853):

```ts
app.get('/api/billing/status', requireAuth, async (c) => {
    const session = c.get('session')!
    try {
        const billing = await resolveBilling(c.env, session.did)
        const pendingDeletion = await readPendingDeletion(
            c.env,
            session.did
        )
        const contactEmail = await readContactEmail(
            c.env,
            session.did
        )
        return c.json({
            entitled: isEntitled(billing),
            planId: billing.planId,
            status: billing.status,
            refreshedAt: billing.refreshedAt,
            useLive: billingUseLive(c.env),
            pendingDeletion,
            currentPeriodEnd: billing.currentPeriodEnd,
            canceledAt: billing.canceledAt,
            contactEmail
        })
    } catch (err) {
        console.error('billing/status error:', err)
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})
```

- [ ] **Step 5: Re-run the test to verify it passes**

Run the same command from Step 3.
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/index.ts test/billing-management.ts test/run-all-tests.mjs
git commit -m "feat(billing/status): include period end, cancel ts, contact email

Client renders the new Subscription panel from this payload. Free
users still see entitled=false with null timestamps."
```

---

## Phase 3 — Cancel / Resume / Payment-method endpoints

### Task 5: `POST /api/billing/cancel`

**Files:**
- Modify: `src/server/index.ts` (add new route alongside other `/api/billing/*` handlers)
- Test: `test/billing-management.ts`

- [ ] **Step 1: Add the failing test**

Append to `test/billing-management.ts`:

```ts
test(
    'POST /api/billing/cancel requires auth',
    async t => {
        const env = makeEnv()
        const res = await app.request(
            'http://127.0.0.1/api/billing/cancel',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: `csrf_token=${TEST_CSRF_TOKEN}`,
                    'x-csrf-token': TEST_CSRF_TOKEN,
                    'sec-fetch-site': 'same-origin'
                },
                body: JSON.stringify({})
            },
            env,
            executionCtx
        )
        t.equal(res.status, 401, 'unauthenticated request is rejected')
    }
)

test(
    'POST /api/billing/cancel in dev mode marks billing as canceled',
    async t => {
        const env = makeEnv({ NODE_ENV: 'development' })
        const { session, cookieHeader } = await makeSession(env)

        // Seed an active subscription in the cache.
        await env.SESSIONS.put(
            `billing:${session.did}`,
            JSON.stringify({
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                currentPeriodEnd: null,
                canceledAt: null
            }),
            { expirationTtl: 600 }
        )

        const res = await app.request(
            'http://127.0.0.1/api/billing/cancel',
            {
                method: 'POST',
                headers: authedHeaders(cookieHeader),
                body: JSON.stringify({})
            },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 200, 'returns 200')
        t.equal(body.ok, true, 'returns ok: true')
        t.equal(
            typeof body.canceledAt,
            'number',
            'echoes canceledAt timestamp'
        )

        const raw = await env.SESSIONS.get(`billing:${session.did}`)
        const cached = raw ? JSON.parse(raw) : null
        t.equal(cached.status, 'active', 'status stays active')
        t.equal(
            typeof cached.canceledAt,
            'number',
            'cached canceledAt is set'
        )
        t.equal(
            typeof cached.currentPeriodEnd,
            'number',
            'cached currentPeriodEnd is set'
        )
    }
)

test(
    'POST /api/billing/cancel in live mode calls Autumn ' +
    'billing.update with cancel_end_of_cycle',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const { session, cookieHeader } = await makeSession(env)

        await withFetch(async call => {
            if (call.url.includes('/billing/update')) {
                return jsonResponse({ customer_id: 'cust' })
            }
            if (call.url.includes('/customers')) {
                return jsonResponse(customerBody(
                    session.did,
                    'alice@example.com',
                    [{
                        ...activeSubscription(),
                        canceled_at: 1700000000000,
                        current_period_end: 1800000000000
                    }]
                ))
            }
            return jsonResponse({}, 404)
        }, async calls => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/cancel',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader),
                    body: JSON.stringify({})
                },
                env,
                executionCtx
            )
            const body = await res.json() as Record<string, unknown>

            t.equal(res.status, 200, 'returns 200')
            t.equal(body.ok, true, 'returns ok: true')

            const updateCall = calls.find(c =>
                c.url.includes('/billing/update'))
            t.ok(updateCall, 'called Autumn billing.update')
            const updateBody = updateCall?.body as Record<string, unknown>
            t.equal(
                updateBody.cancel_action,
                'cancel_end_of_cycle',
                'requested cancel_end_of_cycle'
            )
        })
    }
)
```

- [ ] **Step 2: Run the tests to confirm failure**

Run the same esbuild + node pipeline from Task 4 Step 3.
Expected: All three new tests FAIL — the endpoint doesn't exist.

- [ ] **Step 3: Implement the endpoint in `src/server/index.ts`**

Add this route after the existing `POST /api/billing/portal` (around line 1299):

```ts
/**
 * Schedule cancellation of the user's subscription at the end of
 * the current billing period. In dev mode (no Autumn key) we
 * mutate the cached billing entry directly so the client UI can
 * be exercised without Autumn.
 */
app.post('/api/billing/cancel', requireAuth, async (c) => {
    const session = c.get('session')!
    const planId:BillingPlanId = DEFAULT_PLAN_ID

    if (!billingUseLive(c.env)) {
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const now = Date.now()
        // 30-day synthetic period so the UI has a date to show.
        const periodEnd = now + 30 * 24 * 60 * 60 * 1000
        const updated:CachedBilling = {
            ...cached,
            canceledAt: now,
            currentPeriodEnd: cached.currentPeriodEnd ?? periodEnd
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({
            ok: true,
            canceledAt: updated.canceledAt,
            currentPeriodEnd: updated.currentPeriodEnd
        })
    }

    try {
        const { cancelSubscription } = await import(
            './autumn-billing.js'
        )
        const snapshot = await cancelSubscription(
            c.env,
            session.did,
            planId
        )
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        const updated:CachedBilling = {
            planId,
            status: cached?.status ?? 'active',
            refreshedAt: Date.now(),
            currentPeriodEnd: snapshot.currentPeriodEnd,
            canceledAt: snapshot.canceledAt ?? Date.now()
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({
            ok: true,
            canceledAt: updated.canceledAt,
            currentPeriodEnd: updated.currentPeriodEnd
        })
    } catch (err) {
        console.error('billing/cancel error:', err)
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})
```

If the existing imports at the top of `src/server/index.ts` don't already import `cancelSubscription`, hoist the import out of the `await import(...)` form and into the static import block (lazy import here only because the file is already very long; consistency with neighbors wins).

After adding the route, also add a static import:

```ts
import {
    // ...existing...
    cancelSubscription,
    resumeSubscription,
    getPaymentSetupUrl
} from './autumn-billing.js'
```

…and replace the `await import(...)` call inside the handler with a direct call to `cancelSubscription(c.env, session.did, planId)`.

- [ ] **Step 4: Run tests to verify they pass**

Run the same esbuild + node pipeline.
Expected: All three tests for `/api/billing/cancel` PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts test/billing-management.ts
git commit -m "feat(billing): add POST /api/billing/cancel

Schedules cancel_end_of_cycle via Autumn in live mode; in dev
mode mutates the cached billing entry so the UI is testable
without Autumn."
```

---

### Task 6: `POST /api/billing/resume`

**Files:**
- Modify: `src/server/index.ts`
- Test: `test/billing-management.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/billing-management.ts`:

```ts
test(
    'POST /api/billing/resume in dev mode clears canceledAt',
    async t => {
        const env = makeEnv({ NODE_ENV: 'development' })
        const { session, cookieHeader } = await makeSession(env)

        await env.SESSIONS.put(
            `billing:${session.did}`,
            JSON.stringify({
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                currentPeriodEnd: Date.now() + 86_400_000,
                canceledAt: Date.now() - 1000
            }),
            { expirationTtl: 600 }
        )

        const res = await app.request(
            'http://127.0.0.1/api/billing/resume',
            {
                method: 'POST',
                headers: authedHeaders(cookieHeader),
                body: JSON.stringify({})
            },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 200, 'returns 200')
        t.equal(body.ok, true, 'returns ok: true')

        const raw = await env.SESSIONS.get(`billing:${session.did}`)
        const cached = raw ? JSON.parse(raw) : null
        t.equal(cached.canceledAt, null, 'cached canceledAt cleared')
        t.equal(cached.status, 'active', 'status stays active')
    }
)

test(
    'POST /api/billing/resume in live mode calls Autumn ' +
    'billing.update with uncancel',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const { session, cookieHeader } = await makeSession(env)

        await withFetch(async call => {
            if (call.url.includes('/billing/update')) {
                return jsonResponse({ customer_id: 'cust' })
            }
            if (call.url.includes('/customers')) {
                return jsonResponse(customerBody(
                    session.did,
                    'alice@example.com',
                    [{
                        ...activeSubscription(),
                        canceled_at: null,
                        current_period_end: 1800000000000
                    }]
                ))
            }
            return jsonResponse({}, 404)
        }, async calls => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/resume',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader),
                    body: JSON.stringify({})
                },
                env,
                executionCtx
            )
            const body = await res.json() as Record<string, unknown>

            t.equal(res.status, 200, 'returns 200')
            t.equal(body.ok, true, 'returns ok: true')

            const updateCall = calls.find(c =>
                c.url.includes('/billing/update'))
            t.ok(updateCall, 'called Autumn billing.update')
            const updateBody = updateCall?.body as Record<string, unknown>
            t.equal(
                updateBody.cancel_action,
                'uncancel',
                'requested uncancel'
            )
        })
    }
)
```

- [ ] **Step 2: Run tests to confirm failure**

Expected: both tests FAIL — endpoint doesn't exist.

- [ ] **Step 3: Implement the endpoint**

Add to `src/server/index.ts` immediately after `/api/billing/cancel`:

```ts
/**
 * Reverse a scheduled cancellation.
 */
app.post('/api/billing/resume', requireAuth, async (c) => {
    const session = c.get('session')!
    const planId:BillingPlanId = DEFAULT_PLAN_ID

    if (!billingUseLive(c.env)) {
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        if (!cached || !isEntitled(cached)) {
            return c.json({
                error: 'no_active_subscription'
            }, 409)
        }
        const updated:CachedBilling = {
            ...cached,
            canceledAt: null
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({ ok: true })
    }

    try {
        const snapshot = await resumeSubscription(
            c.env,
            session.did,
            planId
        )
        const cached = await readCachedBilling(
            c.env,
            session.did
        )
        const updated:CachedBilling = {
            planId,
            status: cached?.status ?? 'active',
            refreshedAt: Date.now(),
            currentPeriodEnd: snapshot.currentPeriodEnd,
            canceledAt: snapshot.canceledAt
        }
        await writeCachedBilling(c.env, session.did, updated)
        return c.json({ ok: true })
    } catch (err) {
        console.error('billing/resume error:', err)
        return c.json({
            error: 'billing_unavailable'
        }, 503)
    }
})
```

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts test/billing-management.ts
git commit -m "feat(billing): add POST /api/billing/resume

Reverses a scheduled cancel via Autumn billing.update uncancel
in live mode; clears canceledAt on the cached entry in dev mode."
```

---

### Task 7: `POST /api/billing/payment-method`

**Files:**
- Modify: `src/server/index.ts`
- Test: `test/billing-management.ts`

- [ ] **Step 1: Add failing tests**

Append to `test/billing-management.ts`:

```ts
test(
    'POST /api/billing/payment-method returns 503 in dev mode',
    async t => {
        const env = makeEnv({ NODE_ENV: 'development' })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'http://127.0.0.1/api/billing/payment-method',
            {
                method: 'POST',
                headers: authedHeaders(cookieHeader),
                body: JSON.stringify({})
            },
            env,
            executionCtx
        )
        const body = await res.json() as Record<string, unknown>

        t.equal(res.status, 503, 'returns 503')
        t.equal(
            body.error,
            'portal_unavailable_in_dev',
            'reports the dev-mode error code'
        )
    }
)

test(
    'POST /api/billing/payment-method returns Stripe setup URL ' +
    'in live mode',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY
        })
        const { cookieHeader } = await makeSession(env)

        await withFetch(async call => {
            if (call.url.includes('/billing/setup_payment')) {
                return jsonResponse({
                    url: 'https://stripe.example/setup/abc'
                })
            }
            return jsonResponse({}, 404)
        }, async calls => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-method',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader),
                    body: JSON.stringify({})
                },
                env,
                executionCtx
            )
            const body = await res.json() as Record<string, unknown>

            t.equal(res.status, 200, 'returns 200')
            t.equal(
                body.url,
                'https://stripe.example/setup/abc',
                'returns the Stripe setup URL'
            )
            t.ok(
                calls.some(c =>
                    c.url.includes('/billing/setup_payment')),
                'called Autumn billing.setupPayment'
            )
        })
    }
)
```

- [ ] **Step 2: Run tests, confirm failure**

- [ ] **Step 3: Implement**

Append to `src/server/index.ts` immediately after `/api/billing/resume`:

```ts
/**
 * Create a Stripe SetupIntent-backed URL the user can visit to add
 * or update their payment method. Replaces the kitchen-sink
 * `openCustomerPortal` flow for in-app card updates.
 */
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

- [ ] **Step 4: Run tests, verify pass**

- [ ] **Step 5: Commit**

```bash
git add src/server/index.ts test/billing-management.ts
git commit -m "feat(billing): add POST /api/billing/payment-method

Returns a Stripe-hosted setup URL for in-app card updates. Dev
mode returns 503 portal_unavailable_in_dev (matches portal route)."
```

---

## Phase 4 — Client state and signals

### Task 8: Extend `BillingStatus` interface

**Files:**
- Modify: `src/client/billing-status.ts`

- [ ] **Step 1: Edit the interface**

Replace the `BillingStatus` interface in `src/client/billing-status.ts`:

```ts
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
}
```

(Make the three new fields optional with `?` so existing call sites and test fixtures continue to compile without modification.)

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/billing-status.ts
git commit -m "feat(client/billing): widen BillingStatus type

Adds optional currentPeriodEnd, canceledAt, contactEmail fields
matching the extended GET /api/billing/status payload."
```

---

### Task 9: Add `State.cancelSubscription`, `resumeSubscription`, `openPaymentMethodUpdate`

**Files:**
- Modify: `src/client/state.ts`

- [ ] **Step 1: Add the three methods**

In `src/client/state.ts`, locate the `State.openCustomerPortal` function (around line 1415) and add the three new methods immediately after it:

```ts
/**
 * Schedule cancellation of the user's subscription. The server
 * stores the resulting canceledAt + currentPeriodEnd on the
 * cached billing entry; this function reloads billing so the
 * panel re-renders.
 */
State.cancelSubscription = async function ():Promise<void> {
    setBillingError(null)
    try {
        const res = await api.post('billing/cancel', {
            throwHttpErrors: false
        })
        if (!res.ok) {
            const body = await res.json<{
                error?:string
            }>().catch(() => ({} as { error?:string }))
            throw new Error(
                body.error || `cancel_${res.status}`
            )
        }
        await State.loadBillingStatus()
    } catch (err) {
        setBillingError(err instanceof Error ?
            err.message :
            'Failed to cancel subscription')
        throw err
    }
}

/**
 * Reverse a scheduled cancellation.
 */
State.resumeSubscription = async function ():Promise<void> {
    setBillingError(null)
    try {
        const res = await api.post('billing/resume', {
            throwHttpErrors: false
        })
        if (!res.ok) {
            const body = await res.json<{
                error?:string
            }>().catch(() => ({} as { error?:string }))
            throw new Error(
                body.error || `resume_${res.status}`
            )
        }
        await State.loadBillingStatus()
    } catch (err) {
        setBillingError(err instanceof Error ?
            err.message :
            'Failed to resume subscription')
        throw err
    }
}

/**
 * Fetch a single-purpose Stripe URL the user can visit to update
 * their payment method, then navigate to it.
 */
State.openPaymentMethodUpdate = async function ():Promise<void> {
    try {
        const res = await api.post('billing/payment-method', {
            throwHttpErrors: false
        })
        if (!res.ok) {
            const body = await res.json<{
                error?:string
            }>().catch(() => ({} as { error?:string }))
            throw new Error(
                body.error || `payment_method_${res.status}`
            )
        }
        const data = await res.json<{ url:string }>()
        window.location.assign(data.url)
    } catch (err) {
        setBillingError(err instanceof Error ?
            err.message :
            'Failed to open payment-method page')
    }
}
```

- [ ] **Step 2: Add the method declarations to the `State` type**

Find the `State` type/namespace declaration earlier in the file (search for `State.openCustomerPortal = async function` and look at the surrounding `declare namespace State` or `interface StateApi` block; rsss's `state.ts` defines these via assignment to a `State` const). Add the matching declarations:

```ts
declare const State:{
    // ...existing...
    cancelSubscription:() => Promise<void>;
    resumeSubscription:() => Promise<void>;
    openPaymentMethodUpdate:() => Promise<void>;
    // ...rest...
}
```

If `State` is defined via `export const State: StateApi = { ... }` style, add the three properties to `StateApi`. If it's already a free-form record with `[k: string]: any`-style typing, no type-side change needed.

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/state.ts
git commit -m "feat(client/state): add cancel/resume/payment-method actions

Three new State methods that drive the in-app subscription panel.
Each reloads billing status on success so the panel re-renders
without polling."
```

---

## Phase 5 — Rewrite the Subscription section

### Task 10: Replace Subscription markup in `settings.ts`

**Files:**
- Modify: `src/client/routes/settings.ts` (lines 396-418 and the `handleManageSubscription` callback at lines 133-136)

- [ ] **Step 1: Add a date formatter helper near the existing `formatDeletionDate`**

In `src/client/routes/settings.ts`, just below `formatDeletionDate` (around line 119):

```ts
function formatRenewDate (ms:number):string {
    return new Date(ms).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    })
}
```

- [ ] **Step 1b: Import `useState` and `billingError` for in-flight + error UI**

Make sure these are imported at the top of `src/client/routes/settings.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'
import { billingStatus, billingError } from '../billing-status.js'
```

Inside the `SettingsRoute` component body (alongside the other top-of-component hooks, around line 63), add a local in-flight signal:

```ts
const [subscriptionPending, setSubscriptionPending] = useState(false)
```

- [ ] **Step 2: Replace the `handleManageSubscription` callback**

Replace lines 133-136 with three callbacks:

```ts
const handleCancelSubscription = useCallback(async () => {
    const periodEnd = billing.value?.currentPeriodEnd
    const dateText = periodEnd ?
        formatRenewDate(periodEnd) :
        'the end of your billing period'
    const lines = [
        'Cancel your Local-first subscription? You\'ll keep ' +
        `access until ${dateText}.`,
        '',
        'After that, this device returns to the free plan and ' +
        'goes online-only. Local data on each device stays ' +
        'until you turn off local storage.'
    ]
    if (!confirm(lines.join('\n'))) return
    setSubscriptionPending(true)
    try {
        await State.cancelSubscription()
    } catch {
        // State.cancelSubscription already populates billingError;
        // the inline notice below renders it. No alert.
    } finally {
        setSubscriptionPending(false)
    }
}, [billing.value?.currentPeriodEnd])

const handleResumeSubscription = useCallback(async () => {
    setSubscriptionPending(true)
    try {
        await State.resumeSubscription()
    } catch {
        // billingError populated by the action; inline notice below.
    } finally {
        setSubscriptionPending(false)
    }
}, [])

const handleUpdatePaymentMethod = useCallback((e:MouseEvent) => {
    e.preventDefault()
    State.openPaymentMethodUpdate()
}, [])
```

- [ ] **Step 3: Replace the Subscription section JSX**

Replace lines 396-418 (the `<section class="settings-section subscription-section">` block):

```ts
<section class="settings-section subscription-section">
    <h2>Subscription</h2>
    ${isEntitled ? html`
        <div class="subscription-summary">
            <p class="subscription-headline">
                <span class="subscription-plan">
                    ${planLabel}
                </span>
                <span class="subscription-status">
                    ${billing.value?.canceledAt ?
                        (billing.value?.currentPeriodEnd ?
                            `Ending ${formatRenewDate(
                                billing.value.currentPeriodEnd
                            )}` :
                            'Ending soon') :
                        'Active'}
                </span>
            </p>
            ${billing.value?.canceledAt ? html`
                <p class="subscription-note">
                    Your device will fall back to online-only after
                    this date. Local data stays until you turn it off.
                </p>
            ` : billing.value?.currentPeriodEnd ? html`
                <p class="subscription-note">
                    Renews ${formatRenewDate(
                        billing.value.currentPeriodEnd
                    )}
                </p>
            ` : null}
            ${billing.value?.contactEmail ? html`
                <p class="subscription-billed-to">
                    Billed to ${billing.value.contactEmail}
                </p>
            ` : null}
            <div class="subscription-actions">
                ${billing.value?.canceledAt ? html`
                    <button
                        class="btn-link"
                        onClick=${handleResumeSubscription}
                        disabled=${subscriptionPending || undefined}
                    >
                        ${subscriptionPending ?
                            'Resuming...' :
                            'Resume subscription'}
                    </button>
                ` : html`
                    <button
                        class="btn-link"
                        onClick=${handleCancelSubscription}
                        disabled=${subscriptionPending || undefined}
                    >
                        ${subscriptionPending ?
                            'Canceling...' :
                            'Cancel subscription'}
                    </button>
                `}
                ${billing.value?.useLive ? html`
                    <span class="subscription-actions-sep">
                        ·
                    </span>
                    <button
                        class="btn-link"
                        onClick=${handleUpdatePaymentMethod}
                    >
                        Update payment method
                    </button>
                ` : null}
            </div>
            ${billingError.value ? html`
                <p class="subscription-error" role="alert">
                    Couldn't reach billing. Try again in a moment.
                </p>
            ` : null}
        </div>
    ` : html`
        <p>
            You're on the <strong>Free</strong> plan. RSSS
            works while you're online only.
        </p>
        <a href="/signup" class="btn btn-upgrade">
            Upgrade to Local-first
        </a>
    `}
</section>
```

Important: the previous code used `useCallback(handleManageSubscription)`. After this edit `handleManageSubscription` is gone, so do not leave any stale references — `grep` the file to confirm.

- [ ] **Step 4: Run typecheck**

Run: `npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Run the existing settings UI tests to make sure nothing else broke**

Run: `npm run test:cache-status` (this runs the settings-route component test among others)

Actually the settings tests are bundled under cache-status. Verify the right entry:
```bash
grep -n "settings-route" test/run-all-tests.mjs test/*.mjs
```

Run whichever script bundles `test/settings-route.ts`. Expected: tests that don't touch the subscription section still PASS. Tests that did touch the Subscription `.btn-manage` selector will now fail — those will be updated in Task 12.

- [ ] **Step 6: Commit**

```bash
git add src/client/routes/settings.ts
git commit -m "feat(settings): rebuild Subscription panel as in-app UI

Replaces the Manage-subscription portal redirect with a richer
panel showing plan, status, renewal/end date, contact email, and
inline cancel/resume + update-payment-method actions."
```

---

### Task 11: Replace `.subscription-section` CSS

**Files:**
- Modify: `src/client/routes/settings.css` (the `.subscription-section` block, around lines 124-145)

- [ ] **Step 1: Replace the existing block**

Find the `.subscription-section { ... }` rule in `src/client/routes/settings.css` and replace it with:

```css
.subscription-section {
    & p {
        margin: 0 0 0.5rem;
    }

    & .subscription-summary {
        display: flex;
        flex-direction: column;
        gap: 0.25rem;
    }

    & .subscription-headline {
        display: flex;
        align-items: baseline;
        flex-wrap: wrap;
        gap: 0.5rem;
        font-size: 1.125rem;
        margin: 0 0 0.25rem;
    }

    & .subscription-plan {
        font-weight: 600;
    }

    & .subscription-status {
        color: var(--color-text-secondary);
    }

    & .subscription-note {
        margin: 0 0 0.25rem;
        color: var(--color-text-secondary);
    }

    & .subscription-billed-to {
        margin: 0 0 0.5rem;
        color: var(--color-text-secondary);
        font-size: 1rem;
    }

    & .subscription-actions {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        margin-top: 0.5rem;
    }

    & .subscription-error {
        margin: 0.5rem 0 0;
        color: var(--color-error);
        font-size: 1rem;
    }

    & .btn-link {
        background: transparent;
        border: 0;
        padding: 0;
        cursor: pointer;
        font-size: 1rem;
        color: var(--color-primary);
        text-decoration: underline;
    }

    & .btn-link:hover {
        color: var(--color-primary-hover);
    }

    & .btn-upgrade {
        background-color: var(--color-primary);
        color: var(--color-surface);
        border: 1px solid var(--color-primary);
        padding: 0.5rem 1rem;
        cursor: pointer;
        font-size: 1rem;

        &:hover {
            background-color: var(--color-primary-hover);
            border-color: var(--color-primary-hover);
        }
    }
}
```

(The `.btn-upgrade` rule is preserved because the free-tier branch still renders it.)

- [ ] **Step 2: Run stylelint**

Run: `npm run stylelint`
Expected: PASS.

- [ ] **Step 3: Boot the dev server and eyeball the panel**

Run: `npm start` in a separate terminal, then visit `http://localhost:2222/settings`. Confirm:
- The Subscription section header is unchanged.
- Free-tier rendering still shows the blue "Upgrade to Local-first" CTA.
- After running the dev-mode entitlement flow (visit `/signup`, complete dev checkout), the panel shows plan + status + renewal text + contact email + a small "Cancel subscription" link, no giant blue button.

Stop the dev server (`Ctrl-C`) when finished.

- [ ] **Step 4: Commit**

```bash
git add src/client/routes/settings.css
git commit -m "feat(settings): style the new Subscription panel

Replaces the bold .btn-manage block with quiet inline text
actions and an inline status line. Free-tier upgrade CTA
keeps the existing colored treatment."
```

---

## Phase 6 — Client tests

### Task 12: Add UI tests for the new Subscription panel

**Files:**
- Modify: `test/settings-route.ts`

- [ ] **Step 1: Extend the `entitledBilling` fixture and add a canceled-billing fixture**

Near the top of `test/settings-route.ts`, replace the existing `entitledBilling` helper:

```ts
function entitledBilling (
    overrides:Partial<BillingStatus> = {}
):BillingStatus {
    return {
        entitled: true,
        planId: 'local-first',
        status: 'active',
        refreshedAt: Date.now(),
        useLive: false,
        currentPeriodEnd: Date.now() + 30 * 86_400_000,
        canceledAt: null,
        contactEmail: 'nichoth@example.com',
        ...overrides
    }
}
```

- [ ] **Step 2: Add failing tests for the new markup**

Append to `test/settings-route.ts`:

```ts
test(
    'SettingsRoute renders active subscription panel',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling()

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            t.ok(section, 'subscription section is rendered')

            const cancelBtn = section?.querySelector('button.btn-link')
            t.ok(
                Array.from(
                    section?.querySelectorAll('button.btn-link') ?? []
                ).some(b => (b.textContent ?? '').match(/cancel/i)),
                'cancel button is rendered'
            )
            t.ok(
                !Array.from(
                    section?.querySelectorAll('button.btn-link') ?? []
                ).some(b => (b.textContent ?? '').match(/resume/i)),
                'resume button is not rendered while subscription active'
            )
            t.ok(
                !section?.querySelector('.btn-manage'),
                'old Manage subscription button is gone'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute renders resume button when cancellation scheduled',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling({
            canceledAt: Date.now() - 1000
        })

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const buttons = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            )
            t.ok(
                buttons.some(b => (b.textContent ?? '')
                    .match(/resume/i)),
                'resume button is rendered'
            )
            t.ok(
                !buttons.some(b => (b.textContent ?? '')
                    .match(/^cancel /i)),
                'cancel button is not rendered'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute cancel button calls State.cancelSubscription',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling()

        const originalCancel = State.cancelSubscription
        const originalConfirm = window.confirm
        let called = false
        State.cancelSubscription = async () => { called = true }
        window.confirm = () => true

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const cancelBtn = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            ).find(b => (b.textContent ?? '').match(/cancel/i)) as
                HTMLButtonElement|undefined

            t.ok(cancelBtn, 'cancel button found')
            cancelBtn?.click()
            await nextTick()
            t.ok(called, 'State.cancelSubscription was invoked')
        } finally {
            State.cancelSubscription = originalCancel
            window.confirm = originalConfirm
            resetBilling()
            unmount(root)
        }
    }
)

test(
    'SettingsRoute hides Update payment method when useLive=false',
    async (t) => {
        localStorage.removeItem('rsss.localFirst')
        billingStatus.value = entitledBilling({ useLive: false })

        const root = mount(makeState())
        try {
            await nextTick()
            const section = root.querySelector(
                '.subscription-section'
            )
            const buttons = Array.from(
                section?.querySelectorAll('button.btn-link') ?? []
            )
            t.ok(
                !buttons.some(b => (b.textContent ?? '')
                    .match(/payment method/i)),
                'no payment-method link in dev mode'
            )
        } finally {
            resetBilling()
            unmount(root)
        }
    }
)
```

- [ ] **Step 3: Run the settings tests, confirm new ones fail (or pass) as expected**

Identify the npm script that runs `test/settings-route.ts`:

```bash
grep -n "settings-route" test/run-all-tests.mjs package.json
```

If `test/settings-route.ts` is bundled via `test/run-all-tests.mjs` only, run it through esbuild + tapout directly:

```bash
npx esbuild ./test/settings-route.ts --bundle --loader:.css=text | npx tapout
```

Expected: the four new tests PASS (the markup changes in Task 10 make them pass on the first run). Old tests still pass.

If old tests have started to fail because they referenced `.btn-manage`, search and fix:

```bash
grep -n "btn-manage\|Manage subscription" test/
```

Replace any stale references with the new selectors.

- [ ] **Step 4: Commit**

```bash
git add test/settings-route.ts
git commit -m "test(settings): cover new Subscription panel states

Active, scheduled-cancel, payment-method gating, and cancel-button
click wiring. Asserts the old .btn-manage selector is gone."
```

---

## Phase 7 — Cleanup and verification

### Task 13: Stop calling the old portal endpoint from the new panel

**Files:**
- Inspect: `src/client/routes/settings.ts`, `src/client/routes/signup.ts`, `src/client/state.ts`

- [ ] **Step 1: Confirm `State.openCustomerPortal` is no longer called from `settings.ts`**

```bash
grep -n "openCustomerPortal" src/client
```

Expected: matches only in `state.ts` (definition) and `signup.ts` (legacy fallback). If `settings.ts` still references it, remove the reference — it's a leftover from the earlier code.

- [ ] **Step 2: Leave `POST /api/billing/portal` in `src/server/index.ts` untouched**

Per the spec, we keep the endpoint for one release as a fallback. No change here; just confirm the route is still registered.

- [ ] **Step 3: Run the full test suite**

Run: `npm test && npm run lint`

Expected: all suites PASS, lint is clean. If a test for an unrelated CachedBilling consumer fails because of the new fields, update the test fixture to include `currentPeriodEnd: null, canceledAt: null`.

- [ ] **Step 4: Commit (only if changes were needed)**

If Step 1 surfaced a stale reference:

```bash
git add src/client/routes/settings.ts
git commit -m "chore(settings): drop unused openCustomerPortal reference"
```

Otherwise no commit needed.

---

### Task 14: Manual end-to-end verification in dev mode

**Files:** none

- [ ] **Step 1: Launch the dev server**

Run: `npm start`

- [ ] **Step 2: Sign in via the dev shortcut and become entitled**

In the browser:
1. Visit `http://localhost:2222/`
2. Use the dev-login flow to authenticate.
3. Visit `http://localhost:2222/signup` and complete the dev-mode checkout (no card needed when `AUTUMN_SECRET_KEY` is unset).

- [ ] **Step 3: Exercise the Subscription panel**

Visit `http://localhost:2222/settings`. Confirm:
- Subscription section shows `Local-first` + `Active` + a renewal date.
- The big blue `Manage subscription` button is gone.
- A quiet "Cancel subscription" link is visible.
- No "Update payment method" link (we're in dev mode, `useLive=false`).

Click `Cancel subscription`, accept the confirm dialog. Confirm:
- The panel re-renders with `Ending <date>` and a `Resume subscription` link.

Click `Resume subscription`. Confirm:
- The panel returns to the `Active` state with `Cancel subscription` visible again.

- [ ] **Step 4: Stop the dev server**

Hit `Ctrl-C`. No commit required — this task is verification only.

---

## Self-Review Checklist

After every task above is checked off:

- [ ] `npm test` passes locally.
- [ ] `npm run lint` is clean.
- [ ] `npm run typecheck` is clean.
- [ ] `npm run stylelint` is clean.
- [ ] Subscription panel renders the active, scheduled-cancel, and free-tier states as described in the spec.
- [ ] No file references `.btn-manage` (the old class is dead).
- [ ] `POST /api/billing/portal` is still registered (kept for one release per the spec).
