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

        await withFetch(async call => {
            if (call.url.includes('/v1/billing.update')) {
                return jsonResponse({ customer_id: 'cust' })
            }
            if (call.url.includes('/v1/customers')) {
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
                c.url.includes('billing.update'))
            t.ok(updateCall, 'called Autumn billing.update')
            const updateBody = updateCall?.body as Record<string, unknown>
            t.equal(
                updateBody.cancel_action,
                'cancel_end_of_cycle',
                'requested cancel_end_of_cycle'
            )

            const raw = await env.SESSIONS.get(`billing:${session.did}`)
            const cached = raw ? JSON.parse(raw) : null
            t.equal(
                cached?.currentPeriodEnd,
                1800000000000,
                'cached currentPeriodEnd reflects Autumn snapshot'
            )
            t.equal(
                cached?.canceledAt,
                1700000000000,
                'cached canceledAt reflects Autumn snapshot'
            )
        })
    }
)

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

        // Seed an entitled cache so live mode passes the gate.
        await env.SESSIONS.put(
            `billing:${session.did}`,
            JSON.stringify({
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                currentPeriodEnd: 1800000000000,
                canceledAt: Date.now() - 1000
            }),
            { expirationTtl: 600 }
        )

        await withFetch(async call => {
            if (call.url.includes('/v1/billing.update')) {
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
                c.url.includes('/v1/billing.update'))
            t.ok(updateCall, 'called Autumn billing.update')
            const updateBody = updateCall?.body as Record<string, unknown>
            t.equal(
                updateBody.cancel_action,
                'uncancel',
                'requested uncancel'
            )

            const raw = await env.SESSIONS.get(
                `billing:${session.did}`
            )
            const cached = raw ? JSON.parse(raw) : null
            t.equal(
                cached?.canceledAt,
                null,
                'cached canceledAt cleared from Autumn snapshot'
            )
        })
    }
)

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
            if (call.url.includes('/v1/billing.setup_payment')) {
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
                    c.url.includes('/v1/billing.setup_payment')),
                'called Autumn billing.setupPayment'
            )
        })
    }
)
