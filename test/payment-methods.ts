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
    'GET /api/billing/payment-methods returns methods with no ' +
    'default when defaultId is null',
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
            // Stripe customers.retrieve -> default_payment_method is null
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
            t.equal(body.defaultId, null, 'defaultId is null')
            t.equal(body.methods.length, 2, 'two methods returned')

            const defaults = body.methods.filter(m => m.isDefault)
            t.equal(
                defaults.length,
                0,
                'no methods have isDefault=true'
            )
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
                    'automatic_payment_methods[enabled]=true'),
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
                    rawBody.includes('pm_visa'),
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
                    rawBody.includes('pm_visa'),
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
