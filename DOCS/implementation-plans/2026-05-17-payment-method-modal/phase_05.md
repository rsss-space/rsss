# Payment Method Modal — Phase 5: Remove + Set-Default Paths

**Goal:** Complete the multi-method management surface. Users can remove
non-default cards and elevate a different card to be the default. Both
operations return the canonical refreshed list so the client never has
to reconcile state.

**Architecture:**
- Two new server endpoints:
  - `DELETE /api/billing/payment-methods/:id` — refuses to detach the
    current default (returns `409 cannot_remove_default`), otherwise
    detaches the PM and returns the refreshed list.
  - `POST /api/billing/payment-methods/:id/default` — updates the
    customer-level default, then the active subscription's default.
    If the customer update succeeds but the subscription update fails,
    returns `502 stripe_error` with both states reported in the body;
    the client refetches the canonical list on the next render.
- Two new client State actions on `State.removePaymentMethod(id)` and
  `State.setDefaultPaymentMethod(id)`, each replacing
  `{paymentMethods, defaultMethodId}` from the response via `batch()`
  (delegated through Phase 2's `setPaymentMethodsState`).
- Modal expansion: the existing `Row` component grows per-row action
  buttons ("Set as default" on non-defaults, "Remove" on non-defaults,
  a disabled "Remove" with explanatory tooltip on the default).
  Confirming a remove triggers `mode='confirming-remove'` within the
  same dialog (no nested dialog).
- Per-row loading state is held in modal-scoped `useState` as a
  `Record<string, boolean>` keyed by PM id.

**Tech Stack:** Stripe Node SDK mutations (`paymentMethods.detach`,
`customers.update`, `subscriptions.list`, `subscriptions.update`),
Hono path-params, Preact signals, the modal component from Phase 4.

**Scope:** 5 of 6 phases. Depends on Phases 1-4.

**Codebase verified:** 2026-05-17. Key confirmations:
- The Autumn customer record holds the user's Stripe customer id via
  `stripe_id`; the user's active *Stripe subscription* is NOT stored
  locally. Look it up via `stripe.subscriptions.list({customer,
  status: 'active', limit: 1})`. `'active'` covers "currently billing";
  `'trialing'` does not (per Stripe docs).
- Hono path params via `c.req.param('id')`. Several precedents in
  `src/server/durable-objects/index.ts` (e.g., lines 624, 911, 949).
- Existing DELETE example at `src/server/index.ts:973` (the
  `/api/account/delete` route).
- HTTP status codes 404, 409, 502 all have precedent in the codebase
  (lines 1608, 1344, 985 in `src/server/index.ts`).
- Stripe error detection: `err.code === 'resource_missing'` for "not
  found" cases. Use a small helper.
- The `listPaymentMethodsPayload` helper from Phase 2 is the canonical
  way to build `{methods, defaultId}` — Phase 5 mutation handlers
  call it to refresh.

---

## Acceptance Criteria Coverage

This phase implements and tests:

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

### payment-method-modal.AC8 (extended from Phase 4)
- **payment-method-modal.AC8.1:** Mutation endpoints return canonical
  refreshed list; client replaces signals via response. (Phase 5
  extends to `DELETE` and `POST :id/default`.)

---

<!-- START_SUBCOMPONENT_A (tasks 1-2) -->

<!-- START_TASK_1 -->
### Task 1: Add a small Stripe-error helper to `stripe-billing.ts`

**Verifies:** Pre-work for AC4.5 / AC5.6 (404 mapping).

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/stripe-billing.ts` — add a
  helper that classifies Stripe error shapes.

**Step 1: Append the helpers**

```typescript
/**
 * Detect Stripe's "not found" error shape. `err.code === 'resource_missing'`
 * is the canonical signal across all of Stripe's mutation APIs (detach,
 * customer.update, subscription.update, retrieve, etc.).
 */
export function isStripeNotFoundError (err:unknown):boolean {
    if (!err || typeof err !== 'object') return false
    const e = err as { code?:unknown; statusCode?:unknown }
    return e.code === 'resource_missing' || e.statusCode === 404
}
```

**Step 2: Type-check + lint**

```bash
npm run typecheck && npm run lint
```

Expected: zero errors.

**Step 3: Commit**

```bash
git add src/server/stripe-billing.ts
git commit -m "feat(billing): isStripeNotFoundError helper"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Register `DELETE /api/billing/payment-methods/:id`

**Verifies:** `payment-method-modal.AC4.2`, `payment-method-modal.AC4.4`,
`payment-method-modal.AC4.5`. (AC4.1, AC4.3, AC4.6 are UI-side and
covered in Tasks 5/6.)

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts` — add the new
  route after the GET endpoint introduced in Phase 2.

**Step 1: Import the new helper**

In the import block from `./stripe-billing.js`, add
`isStripeNotFoundError` to the named imports.

**Step 2: Add the route handler**

Add the handler near the other payment-methods routes (after the GET
from Phase 2, before the setup-intent POST from Phase 4):

```typescript
app.delete(
    '/api/billing/payment-methods/:id',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const id = c.req.param('id')
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        try {
            const stripe = getStripe(c.env)
            const customerId = await getStripeCustomerId(
                c.env,
                session.did
            )
            // Defense-in-depth: refuse to detach the current default.
            const customer = await stripe.customers.retrieve(customerId)
            if (customer.deleted) {
                return c.json({ error: 'stripe_error' }, 502)
            }
            const currentDefault = (
                customer as import('stripe').Stripe.Customer
            ).invoice_settings?.default_payment_method
            const defaultId = typeof currentDefault === 'string' ?
                currentDefault :
                currentDefault?.id ?? null
            if (defaultId === id) {
                return c.json({
                    error: 'cannot_remove_default'
                }, 409)
            }
            try {
                await stripe.paymentMethods.detach(id)
            } catch (err) {
                if (isStripeNotFoundError(err)) {
                    return c.json({
                        error: 'payment_method_not_found'
                    }, 404)
                }
                throw err
            }
            const payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
            return c.json(payload)
        } catch (err) {
            console.error(
                'billing/payment-methods DELETE error:',
                err
            )
            return c.json({ error: 'stripe_error' }, 502)
        }
    }
)
```

**Notes:**
- The 409 check is defense-in-depth — the client is supposed to disable
  the Remove button on the default row (AC4.3) — but the server must
  refuse anyway, in case a client bug or a non-browser caller sends the
  request.
- 404 mapping is scoped to the `detach` call specifically. A
  `resource_missing` on the `retrieve` is a different bug (customer
  itself missing) and falls through to the generic 502.
- We deliberately do NOT pass `expand:['invoice_settings.default_payment_method']`
  on the `retrieve`. The unexpanded shape is `string|null` which is
  sufficient and avoids paying for the extra expansion.

**Step 3: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

**Step 4: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(billing): DELETE /api/billing/payment-methods/:id"
```
<!-- END_TASK_2 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 3-4) -->

<!-- START_TASK_3 -->
### Task 3: Register `POST /api/billing/payment-methods/:id/default`

**Verifies:** `payment-method-modal.AC5.1` (server entry),
`payment-method-modal.AC5.2`, `payment-method-modal.AC5.3`,
`payment-method-modal.AC5.4`, `payment-method-modal.AC5.5`,
`payment-method-modal.AC5.6`.

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts` — add the new
  route alongside the others added in Phase 5 Task 2.

**Step 1: Add the route handler**

```typescript
app.post(
    '/api/billing/payment-methods/:id/default',
    requireAuth,
    async (c) => {
        const session = c.get('session')!
        const id = c.req.param('id')
        if (!stripeUseLive(c.env)) {
            return c.json({ error: 'stripe_unconfigured' }, 503)
        }
        const stripe = getStripe(c.env)
        let customerId:string
        try {
            customerId = await getStripeCustomerId(c.env, session.did)
        } catch (err) {
            console.error('default lookup error:', err)
            return c.json({ error: 'stripe_error' }, 502)
        }

        // Step 1: customer-level default.
        let customerDefaultUpdated = false
        try {
            await stripe.customers.update(customerId, {
                invoice_settings: { default_payment_method: id }
            })
            customerDefaultUpdated = true
        } catch (err) {
            if (isStripeNotFoundError(err)) {
                return c.json({
                    error: 'payment_method_not_found'
                }, 404)
            }
            console.error(
                'customers.update default error:',
                err
            )
            return c.json({ error: 'stripe_error' }, 502)
        }

        // Step 2: subscription-level default (best-effort).
        let subscriptionDefaultUpdated = false
        try {
            const subs = await stripe.subscriptions.list({
                customer: customerId,
                status: 'active',
                limit: 1
            })
            const sub = subs.data[0]
            if (sub) {
                await stripe.subscriptions.update(sub.id, {
                    default_payment_method: id
                })
                subscriptionDefaultUpdated = true
            } else {
                // No active subscription — nothing to update at the
                // subscription level. Treat as success.
                subscriptionDefaultUpdated = true
            }
        } catch (err) {
            console.error(
                'subscriptions.update default error:',
                err
            )
            // Partial failure: customer updated, subscription not.
            // Return 502 with both states so the client can render
            // a precise inline banner.
            const payload = await listPaymentMethodsPayload(
                c.env,
                session.did
            )
            return c.json({
                error: 'stripe_error',
                customerDefaultUpdated,
                subscriptionDefaultUpdated,
                methods: payload.methods,
                defaultId: payload.defaultId
            }, 502)
        }

        // Both succeeded: return canonical refreshed list.
        const payload = await listPaymentMethodsPayload(
            c.env,
            session.did
        )
        return c.json(payload)
    }
)
```

**Notes:**
- The partial-failure response includes the canonical `{methods,
  defaultId}` in addition to the error fields, so the client can
  reflect the (partial) truth without an extra round-trip.
- If the user has no active subscription, treating the subscription
  step as success is the simplest reading of the design's intent —
  there's nothing to update. (If a subscription appears later, the
  default carries over from the customer.)
- 404 mapping is scoped to the `customers.update` call; that's where
  an attached-PM check happens for the default-payment-method field.
  Stripe returns `resource_missing` if the PM id isn't attached to
  this customer.

**Step 2: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

**Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(billing): POST /api/billing/payment-methods/:id/default"
```
<!-- END_TASK_3 -->

<!-- START_TASK_4 -->
### Task 4: Tests for `DELETE` and `POST :id/default`

**Verifies:** `payment-method-modal.AC4.2`, `payment-method-modal.AC4.4`,
`payment-method-modal.AC4.5`, `payment-method-modal.AC5.1`,
`payment-method-modal.AC5.2`, `payment-method-modal.AC5.3`,
`payment-method-modal.AC5.4`, `payment-method-modal.AC5.5`,
`payment-method-modal.AC5.6`.

**Files:**
- Modify: `/Users/nick/code/rsss/test/payment-methods.ts` — append new
  tests at the end of the file.

**Step 1: Define a helper for the standard mock environment**

If not already present at the top of `test/payment-methods.ts`, add a
helper that builds the common setup:

```typescript
function makeStripeListResponse (
    methods:Array<{
        id:string;
        brand:string;
        last4:string;
        exp_month:number;
        exp_year:number;
    }>
):unknown {
    return {
        object: 'list',
        has_more: false,
        data: methods.map(m => ({
            id: m.id,
            object: 'payment_method',
            type: 'card',
            card: {
                brand: m.brand,
                last4: m.last4,
                exp_month: m.exp_month,
                exp_year: m.exp_year
            }
        }))
    }
}
```

**Step 2: Add DELETE tests**

```typescript
test(
    'DELETE /api/billing/payment-methods/:id removes non-default ' +
    'and returns canonical refreshed list',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)
        let detachCalled = false
        let stripeListCalls = 0
        await withFetch(async call => {
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/)) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_mc'
                    }
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/payment_methods/pm_visa/detach')) {
                detachCalled = true
                return jsonResponse({ id: 'pm_visa', detached: true })
            }
            if (call.url.includes(
                'api.stripe.com/v1/payment_methods')) {
                stripeListCalls++
                return jsonResponse(makeStripeListResponse([
                    {
                        id: 'pm_mc',
                        brand: 'mastercard',
                        last4: '4444',
                        exp_month: 6,
                        exp_year: 2029
                    }
                ]))
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods/pm_visa',
                {
                    method: 'DELETE',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as {
                methods:Array<{ id:string }>;
                defaultId:string|null;
            }
            t.equal(res.status, 200, '200 OK')
            t.ok(detachCalled, 'called Stripe detach')
            t.equal(body.defaultId, 'pm_mc', 'default unchanged')
            t.equal(body.methods.length, 1, 'one method left')
            t.equal(body.methods[0].id, 'pm_mc', 'mc remains')
            t.equal(
                body.methods.find(m => m.id === 'pm_visa'),
                undefined,
                'pm_visa is gone'
            )
        })
    }
)

test(
    'DELETE /api/billing/payment-methods/:id returns 409 ' +
    'cannot_remove_default for the current default id',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)
        let detachCalled = false
        await withFetch(async call => {
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/)) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_mc'
                    }
                })
            }
            if (call.url.includes(
                '/v1/payment_methods/pm_mc/detach')) {
                detachCalled = true
                return jsonResponse({}, 200)
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods/pm_mc',
                {
                    method: 'DELETE',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as { error?:string }
            t.equal(res.status, 409, 'returns 409')
            t.equal(body.error, 'cannot_remove_default', 'error code')
            t.equal(detachCalled, false, 'did NOT call detach')
        })
    }
)

test(
    'DELETE /api/billing/payment-methods/:id returns 404 ' +
    'payment_method_not_found when Stripe says resource_missing',
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
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/)) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_mc'
                    }
                })
            }
            if (call.url.includes(
                '/v1/payment_methods/pm_ghost/detach')) {
                return jsonResponse({
                    error: {
                        type: 'invalid_request_error',
                        code: 'resource_missing',
                        message: 'No such payment method'
                    }
                }, 404)
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1/api/billing/payment-methods/pm_ghost',
                {
                    method: 'DELETE',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as { error?:string }
            t.equal(res.status, 404, '404 returned')
            t.equal(
                body.error,
                'payment_method_not_found',
                'error code'
            )
        })
    }
)
```

**Step 3: Add set-default tests**

```typescript
test(
    'POST /api/billing/payment-methods/:id/default updates ' +
    'customer + subscription and returns canonical list',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)
        let customerUpdated = false
        let subscriptionUpdated = false
        await withFetch(async call => {
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/) &&
                call.method === 'POST') {
                customerUpdated = true
                const rawBody = typeof call.body === 'string' ?
                    call.body :
                    ''
                t.ok(
                    rawBody.includes(
                        'invoice_settings%5Bdefault_payment_method%5D' +
                        '=pm_visa'),
                    'customer update sets default to pm_visa'
                )
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer'
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/subscriptions') &&
                call.method === 'GET') {
                return jsonResponse({
                    object: 'list',
                    data: [{
                        id: 'sub_active1',
                        object: 'subscription',
                        status: 'active'
                    }]
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/subscriptions/sub_active1') &&
                call.method === 'POST') {
                subscriptionUpdated = true
                const rawBody = typeof call.body === 'string' ?
                    call.body :
                    ''
                t.ok(
                    rawBody.includes(
                        'default_payment_method=pm_visa'),
                    'subscription update sets default'
                )
                return jsonResponse({
                    id: 'sub_active1',
                    object: 'subscription'
                })
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/) &&
                call.method === 'GET') {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_visa'
                    }
                })
            }
            if (call.url.includes('api.stripe.com/v1/payment_methods')) {
                return jsonResponse(makeStripeListResponse([
                    {
                        id: 'pm_visa',
                        brand: 'visa',
                        last4: '4242',
                        exp_month: 12,
                        exp_year: 2030
                    },
                    {
                        id: 'pm_mc',
                        brand: 'mastercard',
                        last4: '4444',
                        exp_month: 6,
                        exp_year: 2029
                    }
                ]))
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1' +
                '/api/billing/payment-methods/pm_visa/default',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as {
                methods:Array<{ id:string; isDefault:boolean }>;
                defaultId:string|null;
            }
            t.equal(res.status, 200, '200 OK')
            t.ok(customerUpdated, 'customer.invoice_settings updated')
            t.ok(subscriptionUpdated, 'subscription default updated')
            t.equal(body.defaultId, 'pm_visa', 'defaultId moved')
            const visa = body.methods.find(m => m.id === 'pm_visa')
            t.ok(visa?.isDefault, 'visa now isDefault')
        })
    }
)

test(
    'POST /api/billing/payment-methods/:id/default returns 502 ' +
    'with both states when subscription update fails',
    async t => {
        const env = makeEnv({
            NODE_ENV: 'production',
            AUTUMN_SECRET_KEY: AUTUMN_KEY,
            STRIPE_SECRET_KEY: STRIPE_KEY
        })
        const { session, cookieHeader } = await makeSession(env)
        let customerUpdated = false
        await withFetch(async call => {
            if (call.url.includes('/v1/customers') &&
                !call.url.includes('api.stripe.com')) {
                return jsonResponse({
                    ...customerBody(session.did, 'alice@example.com'),
                    stripe_id: 'cus_test_alice'
                })
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/) &&
                call.method === 'POST') {
                customerUpdated = true
                const rawBody = typeof call.body === 'string' ?
                    call.body :
                    ''
                t.ok(
                    rawBody.includes(
                        'invoice_settings%5Bdefault_payment_method%5D' +
                        '=pm_visa'),
                    'customer.update sent default=pm_visa'
                )
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer'
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/subscriptions') &&
                call.method === 'GET') {
                return jsonResponse({
                    object: 'list',
                    data: [{
                        id: 'sub_active1',
                        object: 'subscription',
                        status: 'active'
                    }]
                })
            }
            if (call.url.includes(
                'api.stripe.com/v1/subscriptions/sub_active1') &&
                call.method === 'POST') {
                return jsonResponse({
                    error: {
                        type: 'api_error',
                        message: 'transient'
                    }
                }, 500)
            }
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/)) {
                return jsonResponse({
                    id: 'cus_test_alice',
                    object: 'customer',
                    invoice_settings: {
                        default_payment_method: 'pm_visa'
                    }
                })
            }
            if (call.url.includes('api.stripe.com/v1/payment_methods')) {
                return jsonResponse(makeStripeListResponse([
                    {
                        id: 'pm_visa',
                        brand: 'visa',
                        last4: '4242',
                        exp_month: 12,
                        exp_year: 2030
                    }
                ]))
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1' +
                '/api/billing/payment-methods/pm_visa/default',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as {
                error?:string;
                customerDefaultUpdated?:boolean;
                subscriptionDefaultUpdated?:boolean;
                methods:Array<{ id:string }>;
                defaultId:string|null;
            }
            t.equal(res.status, 502, 'returns 502')
            t.equal(body.error, 'stripe_error', 'error code')
            t.ok(customerUpdated, 'customer.update was actually called')
            t.equal(
                body.customerDefaultUpdated,
                true,
                'customer step succeeded'
            )
            t.equal(
                body.subscriptionDefaultUpdated,
                false,
                'subscription step failed'
            )
            t.equal(body.defaultId, 'pm_visa', 'canonical list included')
        })
    }
)

test(
    'POST /api/billing/payment-methods/:id/default returns 404 ' +
    'for unknown PM',
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
            if (call.url.match(/api\.stripe\.com\/v1\/customers\/[^/]+$/) &&
                call.method === 'POST') {
                return jsonResponse({
                    error: {
                        type: 'invalid_request_error',
                        code: 'resource_missing',
                        message: 'No such payment method'
                    }
                }, 404)
            }
            return jsonResponse({}, 404)
        }, async () => {
            const res = await app.request(
                'http://127.0.0.1' +
                '/api/billing/payment-methods/pm_ghost/default',
                {
                    method: 'POST',
                    headers: authedHeaders(cookieHeader)
                },
                env,
                executionCtx
            )
            const body = await res.json() as { error?:string }
            t.equal(res.status, 404, 'returns 404')
            t.equal(
                body.error,
                'payment_method_not_found',
                'error code'
            )
        })
    }
)
```

**Step 4: Run the tests**

```bash
npx esbuild ./test/payment-methods.ts --bundle | npx tapout
```

Expected: all tests in the file pass.

**Step 5: Commit**

```bash
git add test/payment-methods.ts
git commit -m "test(billing): DELETE + set-default endpoint tests"
```
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_SUBCOMPONENT_C (tasks 5-7) -->

<!-- START_TASK_5 -->
### Task 5: Add `State.removePaymentMethod` and `State.setDefaultPaymentMethod`

**Verifies:** Wires Tasks 2/3 into the client surface so the modal can
call `State.removePaymentMethod(id)` and
`State.setDefaultPaymentMethod(id)` and have signals refresh from the
response.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` — add two new
  actions near the Phase 2 `loadPaymentMethods` action.

**Step 1: Add the actions**

```typescript
State.removePaymentMethod = async function (
    id:string
):Promise<void> {
    const res = await api.delete(
        `billing/payment-methods/${encodeURIComponent(id)}`,
        { throwHttpErrors: false }
    )
    if (!res.ok) {
        const body = await res.json<{
            error?:string;
            methods?:PaymentMethodSummary[];
            defaultId?:string|null;
        }>().catch(() => ({}))
        if (res.status === 404 &&
            body.methods !== undefined &&
            body.defaultId !== undefined) {
            // (Not currently the server's shape for 404 — server
            // returns just {error}. We refetch below.)
        }
        if (res.status === 404) {
            // Refresh canonical truth so the now-gone row disappears.
            await State.loadPaymentMethods()
            throw new Error(body.error || 'payment_method_not_found')
        }
        throw new Error(
            body.error || `remove_${res.status}`
        )
    }
    const data = await res.json<{
        methods:PaymentMethodSummary[];
        defaultId:string|null;
    }>()
    setPaymentMethodsState(data.methods, data.defaultId)
}

State.setDefaultPaymentMethod = async function (
    id:string
):Promise<void> {
    const res = await api.post(
        `billing/payment-methods/${encodeURIComponent(id)}/default`,
        { throwHttpErrors: false }
    )
    if (!res.ok) {
        const body = await res.json<{
            error?:string;
            methods?:PaymentMethodSummary[];
            defaultId?:string|null;
        }>().catch(() => ({}))
        if (res.status === 404) {
            await State.loadPaymentMethods()
            throw new Error(body.error || 'payment_method_not_found')
        }
        if (res.status === 502 &&
            Array.isArray(body.methods) &&
            body.defaultId !== undefined) {
            // Partial-failure: server included canonical list.
            setPaymentMethodsState(
                body.methods,
                body.defaultId ?? null
            )
            throw new Error(body.error || 'partial_failure')
        }
        throw new Error(
            body.error || `set_default_${res.status}`
        )
    }
    const data = await res.json<{
        methods:PaymentMethodSummary[];
        defaultId:string|null;
    }>()
    setPaymentMethodsState(data.methods, data.defaultId)
}
```

**Step 2: Add the imports**

If not already there, ensure `PaymentMethodSummary` is imported from
`./payment-methods.js` at the top of `state.ts`.

**Step 3: Add to the State surface declaration**

Add the two methods to the State interface/type alongside the existing
`loadPaymentMethods` and `createSetupIntent`:

```typescript
removePaymentMethod:(id:string) => Promise<void>;
setDefaultPaymentMethod:(id:string) => Promise<void>;
```

**Step 4: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

**Step 5: Commit**

```bash
git add src/client/state.ts
git commit -m "feat(billing): State.removePaymentMethod + setDefaultPaymentMethod"
```
<!-- END_TASK_5 -->

<!-- START_TASK_6 -->
### Task 6: Extend the modal's `Row` and add `confirming-remove` mode

**Verifies:** `payment-method-modal.AC4.1`, `payment-method-modal.AC4.3`,
`payment-method-modal.AC4.6`, `payment-method-modal.AC5.7`.

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/components/payment-method-modal.ts`
  — replace the read-only `Row` from Phase 4 with one that has per-row
  action buttons; add `confirming-remove` mode handling.

**Step 1: Update the modal component**

Open `src/client/components/payment-method-modal.ts` and make these
changes:

**a. Replace the `Row` component** (the read-only version from Phase 4)
with this version that takes mutation handlers and a per-row pending
flag:

```typescript
const Row:FunctionComponent<{
    method:PaymentMethodSummary;
    isDefault:boolean;
    pending:boolean;
    onRemove:(id:string) => void;
    onSetDefault:(id:string) => void;
}> = function ({
    method, isDefault, pending, onRemove, onSetDefault
}) {
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
            <div class="pm-row-actions">
                ${!isDefault && html`
                    <button
                        type="button"
                        class="btn-link"
                        onClick=${() => onSetDefault(method.id)}
                        disabled=${pending || undefined}
                    >
                        ${pending ? 'Working...' : 'Set as default'}
                    </button>
                `}
                <button
                    type="button"
                    class="btn-link"
                    onClick=${() => onRemove(method.id)}
                    disabled=${isDefault || pending || undefined}
                    title=${isDefault ?
                        'Set another card as default first.' :
                        undefined}
                >
                    Remove
                </button>
            </div>
        </li>
    `
}
```

**b. In the parent `PaymentMethodModal` component, replace the read-only
`<${Row} ... />` call with the new shape and add the per-row state and
the mode-handling logic.**

Add near the other `useState` declarations:

```typescript
const [removeCandidate, setRemoveCandidate] = useState<string|null>(
    null
)
const [rowPending, setRowPending] = useState<Record<string, boolean>>(
    {}
)
const [opError, setOpError] = useState<string|null>(null)
```

Add handler callbacks:

```typescript
const handleAskRemove = useCallback((id:string) => {
    setRemoveCandidate(id)
    setOpError(null)
    setMode('confirming-remove')
}, [])

const handleCancelRemove = useCallback(() => {
    setRemoveCandidate(null)
    setOpError(null)
    setMode('list')
}, [])

const handleConfirmRemove = useCallback(async () => {
    const id = removeCandidate
    if (!id) return
    setRowPending(s => ({ ...s, [id]: true }))
    setOpError(null)
    try {
        await State.removePaymentMethod(id)
        setRemoveCandidate(null)
        setMode('list')
    } catch (err) {
        setOpError(err instanceof Error ?
            err.message :
            'remove_failed')
    } finally {
        setRowPending(s => {
            const copy = { ...s }
            delete copy[id]
            return copy
        })
    }
}, [removeCandidate])

const handleSetDefault = useCallback(async (id:string) => {
    setRowPending(s => ({ ...s, [id]: true }))
    setOpError(null)
    try {
        await State.setDefaultPaymentMethod(id)
    } catch (err) {
        setOpError(err instanceof Error ?
            err.message :
            'set_default_failed')
    } finally {
        setRowPending(s => {
            const copy = { ...s }
            delete copy[id]
            return copy
        })
    }
}, [])
```

Replace the `mode === 'list'` block's `<${Row} method=... isDefault=... />`
to pass the new props:

```typescript
${mode === 'list' && html`
    <ul class="pm-list">
        ${methods.map((m) => html`
            <${Row}
                method=${m}
                isDefault=${m.id === defaultId}
                pending=${Boolean(rowPending[m.id])}
                onRemove=${handleAskRemove}
                onSetDefault=${handleSetDefault}
            />
        `)}
    </ul>
    ${(opError || globalError) && html`
        <p id=${ERROR_ID} class="pm-error" role="alert">
            ${opError ?? globalError}
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
```

Add a new render branch for `confirming-remove`:

```typescript
${mode === 'confirming-remove' && html`
    <p class="pm-confirm-text">
        Remove this card?
    </p>
    ${opError && html`
        <p id=${ERROR_ID} class="pm-error" role="alert">
            ${opError}
        </p>
    `}
    <div class="pm-actions">
        <button
            type="button"
            class="btn-link"
            onClick=${handleCancelRemove}
            disabled=${removeCandidate ?
                Boolean(rowPending[removeCandidate]) :
                false}
        >
            Cancel
        </button>
        <button
            type="button"
            class="btn-link"
            onClick=${handleConfirmRemove}
            disabled=${removeCandidate ?
                Boolean(rowPending[removeCandidate]) :
                false}
        >
            ${removeCandidate && rowPending[removeCandidate] ?
                'Removing...' :
                'Remove'}
        </button>
    </div>
`}
```

Update `handleClose` to also reset the new state:

```typescript
const handleClose = useCallback(() => {
    setMode('list')
    setSetupSecret(null)
    setAddError(null)
    setAdding(false)
    setRemoveCandidate(null)
    setRowPending({})
    setOpError(null)
    // ... existing element unmount code ...
    onClose()
}, [onClose])
```

**Step 2: Verify type-check + lint**

```bash
npm run typecheck && npm run lint
```

**Step 3: Commit**

```bash
git add src/client/components/payment-method-modal.ts
git commit -m "feat(billing): per-row remove + set-default actions in modal"
```
<!-- END_TASK_6 -->

<!-- START_TASK_7 -->
### Task 7: Modal interaction tests for remove + set-default flows

**Verifies:** `payment-method-modal.AC4.1`, `payment-method-modal.AC4.3`,
`payment-method-modal.AC4.6`, `payment-method-modal.AC5.4`,
`payment-method-modal.AC5.5` (client surface), `payment-method-modal.AC5.7`.

**Files:**
- Modify: `/Users/nick/code/rsss/test/payment-method-modal.ts` — append
  new tests at the end.

**Step 1: Append tests**

```typescript
test('AC4.1: Clicking Remove enters confirming-remove mode',
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
            // Find the non-default row's Remove button.
            const rows = Array.from(
                dialog.querySelectorAll('.pm-row')
            )
            const nonDefault = rows.find(r =>
                r.textContent?.includes('4242')
            ) as HTMLElement
            const removeBtn = Array.from(
                nonDefault.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').trim() === 'Remove'
            ) as HTMLButtonElement
            t.ok(removeBtn, 'Remove button present on non-default')
            t.equal(removeBtn.disabled, false, 'enabled')
            removeBtn.click()
            await nextTask()
            t.ok(
                dialog.querySelector('.pm-confirm-text'),
                'now in confirming-remove mode'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC4.3: Remove button is disabled on the default row',
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
            const defaultRow = Array.from(
                dialog.querySelectorAll('.pm-row')
            ).find(r =>
                r.textContent?.includes('4444')
            ) as HTMLElement
            const removeBtn = Array.from(
                defaultRow.querySelectorAll('button')
            ).find(b =>
                (b.textContent ?? '').trim() === 'Remove'
            ) as HTMLButtonElement
            t.ok(removeBtn, 'Remove button rendered on default row')
            t.equal(
                removeBtn.disabled,
                true,
                'disabled on default'
            )
            t.equal(
                removeBtn.title,
                'Set another card as default first.',
                'tooltip set'
            )
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC4.6: Removing the last non-default leaves only the default',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalRemove = State.removePaymentMethod
            State.removePaymentMethod = async (id:string) => {
                // Server-side has already detached; simulate canonical
                // refresh by writing to the signals.
                batch(() => {
                    paymentMethods.value = paymentMethods.value
                        .filter(m => m.id !== id)
                })
            }
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
                const nonDefault = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                const removeBtn = Array.from(
                    nonDefault.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').trim() === 'Remove'
                ) as HTMLButtonElement
                removeBtn.click()
                await nextTask()
                const confirmBtn = Array.from(
                    dialog.querySelectorAll('.pm-actions button')
                ).find(b =>
                    (b.textContent ?? '').match(/^Remove$/)
                ) as HTMLButtonElement
                confirmBtn.click()
                await nextTask()
                await nextTask()
                t.equal(
                    dialog.querySelectorAll('.pm-row').length,
                    1,
                    'one row remains'
                )
                t.ok(
                    dialog.querySelector('.pm-list'),
                    'returned to list mode'
                )
                t.equal(dialog.open, true, 'modal still open')
            } finally {
                State.removePaymentMethod = originalRemove
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC5.4 + AC5.7: Set as default moves the badge; ' +
    'is not rendered on the current default', async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalSet = State.setDefaultPaymentMethod
            State.setDefaultPaymentMethod = async (id:string) => {
                batch(() => {
                    paymentMethods.value = paymentMethods.value.map(
                        m => ({ ...m, isDefault: m.id === id })
                    )
                    defaultMethodId.value = id
                })
            }
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
                // AC5.7: The default row should NOT have a
                // "Set as default" button.
                const defaultRow = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4444')
                ) as HTMLElement
                const setOnDefault = Array.from(
                    defaultRow.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/set as default/i)
                )
                t.equal(
                    setOnDefault,
                    undefined,
                    'no "Set as default" on default row'
                )
                // Click "Set as default" on visa.
                const visaRow = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                const setBtn = Array.from(
                    visaRow.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/set as default/i)
                ) as HTMLButtonElement
                setBtn.click()
                await nextTask()
                await nextTask()
                // Default badge should now be on the visa row.
                const newVisaRow = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                t.ok(
                    newVisaRow.querySelector('.pm-default-badge'),
                    'visa row now has Default badge'
                )
            } finally {
                State.setDefaultPaymentMethod = originalSet
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC5.5: Partial-failure surface inline banner (UI smoke)',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            seedBilling(true)
            seedMethods()
            const originalSet = State.setDefaultPaymentMethod
            State.setDefaultPaymentMethod = async () => {
                throw new Error('partial_failure')
            }
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
                const visaRow = Array.from(
                    dialog.querySelectorAll('.pm-row')
                ).find(r =>
                    r.textContent?.includes('4242')
                ) as HTMLElement
                const setBtn = Array.from(
                    visaRow.querySelectorAll('button')
                ).find(b =>
                    (b.textContent ?? '').match(/set as default/i)
                ) as HTMLButtonElement
                setBtn.click()
                await nextTask()
                await nextTask()
                const err = dialog.querySelector('.pm-error')
                t.ok(err, 'inline error shown')
                t.ok(
                    err?.textContent?.includes('partial_failure'),
                    'error code surfaces'
                )
            } finally {
                State.setDefaultPaymentMethod = originalSet
            }
        } finally {
            resetState()
            cleanup()
        }
    }
)

test('AC5.5: State.setDefaultPaymentMethod handles 502 partial-failure ' +
    'shape by replacing signals from the body and throwing',
    async t => {
        // No State override: exercise the real client action against
        // a stubbed fetch that returns the server's 502
        // partial-failure shape from Task 3.
        seedBilling(true)
        seedMethods()
        const originalFetch = globalThis.fetch
        globalThis.fetch = async () => {
            return new Response(JSON.stringify({
                error: 'stripe_error',
                customerDefaultUpdated: true,
                subscriptionDefaultUpdated: false,
                methods: [
                    {
                        id: 'pm_visa',
                        brand: 'visa',
                        last4: '4242',
                        expMonth: 12,
                        expYear: 2030,
                        isDefault: true
                    },
                    {
                        id: 'pm_mc',
                        brand: 'mastercard',
                        last4: '4444',
                        expMonth: 6,
                        expYear: 2029,
                        isDefault: false
                    }
                ],
                defaultId: 'pm_visa'
            }), {
                status: 502,
                headers: { 'content-type': 'application/json' }
            })
        }
        let threw = false
        try {
            await State.setDefaultPaymentMethod('pm_visa')
        } catch (err) {
            threw = true
            t.ok(
                err instanceof Error &&
                    /stripe_error|partial/.test(err.message),
                'throws with partial-failure error code'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
        t.ok(threw, 'action threw')
        // Signals reflect canonical (partial) truth from the body.
        t.equal(
            defaultMethodId.value,
            'pm_visa',
            'defaultMethodId reflects partial state'
        )
        const visa = paymentMethods.value.find(m => m.id === 'pm_visa')
        t.ok(visa?.isDefault, 'visa isDefault flipped')
        resetState()
    }
)
```

**Step 2: Run the test in isolation**

```bash
npx esbuild ./test/payment-method-modal.ts --bundle \
    --loader:.css=text \
    --alias:@stripe/stripe-js=./test/stripe-js-stub.ts \
    | npx tapout
```

Expected: all tests pass.

**Step 3: Run the full suite**

```bash
npm test
```

Expected: no regressions.

**Step 4: Commit**

```bash
git add test/payment-method-modal.ts
git commit -m "test(billing): remove + set-default modal interactions"
```
<!-- END_TASK_7 -->

<!-- END_SUBCOMPONENT_C -->

<!-- START_TASK_8 -->
### Task 8: Final verification gate

**Step 1: All checks**

```bash
npm run lint && npm run stylelint && npm run typecheck && npm test
```

Expected: all green.

**Step 2: Smoke-build the worker**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-smoke-1b835f15-p5
```

Expected: dry-run build succeeds.

**Done when:**
- ACs listed in this phase's coverage are covered by passing tests.
- `npm test`, `npm run lint`, `npm run stylelint`, `npm run typecheck`
  all green.
- `wrangler deploy --dry-run` succeeds.
<!-- END_TASK_8 -->
