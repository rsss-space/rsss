import { test } from '@substrate-system/tapzero'
import fs from 'node:fs'
import path from 'node:path'
import {
    stripeUseLive,
    getStripe,
    getStripeCustomerId
} from '../src/server/stripe-billing.js'
import {
    customerBody,
    jsonResponse
} from './autumn-fixtures.js'

test('Stripe SDK dependency is pinned to an exact version', t => {
    const pkgPath = path.join(process.cwd(), 'package.json')
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8')) as {
        dependencies?:Record<string, string>;
    }
    const version = pkg.dependencies?.stripe
    t.equal(version, '17.7.0', 'stripe dependency is exact')
})

test('getStripe passes an explicit Stripe API version', t => {
    const sourcePath = path.join(
        process.cwd(),
        'src/server/stripe-billing.ts'
    )
    const source = fs.readFileSync(sourcePath, 'utf8')
    t.ok(
        source.includes("apiVersion: '2025-02-24.acacia'"),
        'Stripe constructor pins the reviewed API version'
    )
})

test('stripeUseLive is false when STRIPE_SECRET_KEY is unset', t => {
    t.equal(
        stripeUseLive({}),
        false,
        'returns false for empty env'
    )
    t.equal(
        stripeUseLive({ STRIPE_SECRET_KEY: '' }),
        false,
        'returns false for empty-string key'
    )
})

test('stripeUseLive is true when STRIPE_SECRET_KEY is set', t => {
    t.equal(
        stripeUseLive({ STRIPE_SECRET_KEY: 'sk_test_x' }),
        true,
        'returns true when key is present'
    )
})

test('getStripe throws when STRIPE_SECRET_KEY is unset', t => {
    let threw = false
    try {
        getStripe({})
    } catch (err) {
        threw = true
        const msg = err instanceof Error ? err.message : String(err)
        t.ok(
            msg.includes('STRIPE_SECRET_KEY'),
            'error message mentions the missing key name'
        )
    }
    t.ok(threw, 'getStripe throws when unconfigured')
})

test('getStripe returns a Stripe instance when configured', t => {
    const s = getStripe({ STRIPE_SECRET_KEY: 'sk_test_x' })
    t.ok(s, 'returns a truthy SDK handle')
    t.equal(
        typeof (s as { paymentMethods?:unknown }).paymentMethods,
        'object',
        'SDK has paymentMethods namespace'
    )
})

test('getStripeCustomerId returns stripe_id from Autumn', async t => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
        return jsonResponse(
            customerBody('did:plc:alice', null, [], 'cus_test_abc')
        )
    }) as typeof fetch
    try {
        const id = await getStripeCustomerId(
            {
                STRIPE_SECRET_KEY: 'sk_test_x',
                AUTUMN_SECRET_KEY: 'am_test'
            },
            'did:plc:alice'
        )
        t.equal(id, 'cus_test_abc', 'returns the stripe_id from Autumn')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test(
    'getStripeCustomerId throws when Autumn record has no stripeId',
    async t => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => {
            return jsonResponse(
                customerBody('did:plc:alice', null, [], null)
            )
        }) as typeof fetch
        let threw = false
        try {
            await getStripeCustomerId(
                {
                    STRIPE_SECRET_KEY: 'sk_test_x',
                    AUTUMN_SECRET_KEY: 'am_test'
                },
                'did:plc:alice'
            )
        } catch (err) {
            threw = true
            const msg = err instanceof Error ? err.message : String(err)
            t.ok(
                msg.includes('stripeId'),
                'error message mentions stripeId'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
        t.ok(threw, 'throws when stripeId is missing')
    }
)

test(
    'getStripeCustomerId throws when AUTUMN_SECRET_KEY is unset',
    async t => {
        let threw = false
        try {
            await getStripeCustomerId(
                { STRIPE_SECRET_KEY: 'sk_test_x' },
                'did:plc:alice'
            )
        } catch (err) {
            threw = true
            const msg = err instanceof Error ? err.message : String(err)
            t.ok(
                msg.includes('AUTUMN_SECRET_KEY'),
                'error message mentions AUTUMN_SECRET_KEY'
            )
        }
        t.ok(threw, 'throws when Autumn is not configured')
    }
)
