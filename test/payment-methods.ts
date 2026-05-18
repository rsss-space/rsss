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
