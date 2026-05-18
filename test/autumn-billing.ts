import { test } from '@substrate-system/tapzero'
import {
    didToCustomerId,
    getOrCreateCustomer,
    verifySubscription,
    type VerifiedSubscription
} from '../src/server/autumn-billing.js'
import {
    customerBody,
    jsonResponse
} from './autumn-fixtures.js'

function subscriptionBody (status:string) {
    return {
        id: `sub_${status}`,
        plan_id: 'local-first',
        auto_enable: false,
        add_on: false,
        status,
        past_due: false,
        canceled_at: null,
        expires_at: null,
        trial_ends_at: null,
        started_at: 1700000000000,
        current_period_start: null,
        current_period_end: null,
        quantity: 1
    }
}

test('VerifiedSubscription status is narrowed to known statuses', t => {
    const verified:VerifiedSubscription = {
        planId: 'local-first',
        status: 'active'
    }
    const status:'active'|'scheduled' = verified.status

    t.equal(status, 'active', 'status is assignable to the known union')
})

test('getOrCreateCustomer returns the Autumn customer contact', async t => {
    const originalFetch = globalThis.fetch
    const did = 'did:plc:reader'
    globalThis.fetch = (async () => {
        return jsonResponse(customerBody(did, 'autumn@example.com'))
    }) as typeof fetch

    try {
        const customer = await getOrCreateCustomer(
            { AUTUMN_SECRET_KEY: 'test-secret' },
            did,
            'reader.test',
            'input@example.com'
        )

        t.equal(
            customer.customerId,
            didToCustomerId(did),
            'returns the Autumn customer id'
        )
        t.equal(
            customer.email,
            'autumn@example.com',
            'returns the email from Autumn'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('verifySubscription accepts active subscriptions', async t => {
    const originalFetch = globalThis.fetch
    const did = 'did:plc:reader'
    globalThis.fetch = (async () => {
        return jsonResponse(customerBody(did, 'reader@example.com', [
            subscriptionBody('active')
        ]))
    }) as typeof fetch

    try {
        const subscription = await verifySubscription(
            { AUTUMN_SECRET_KEY: 'test-secret' },
            did,
            'local-first'
        )

        t.deepEqual(
            subscription,
            { planId: 'local-first', status: 'active' },
            'returns active matching subscription'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('verifySubscription accepts scheduled subscriptions', async t => {
    const originalFetch = globalThis.fetch
    const did = 'did:plc:reader'
    globalThis.fetch = (async () => {
        return jsonResponse(customerBody(did, 'reader@example.com', [
            subscriptionBody('scheduled')
        ]))
    }) as typeof fetch

    try {
        const subscription = await verifySubscription(
            { AUTUMN_SECRET_KEY: 'test-secret' },
            did,
            'local-first'
        )

        t.deepEqual(
            subscription,
            { planId: 'local-first', status: 'scheduled' },
            'returns scheduled matching subscription'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('verifySubscription ignores unknown subscription statuses', async t => {
    const originalFetch = globalThis.fetch
    const did = 'did:plc:reader'
    globalThis.fetch = (async () => {
        return jsonResponse(customerBody(did, 'reader@example.com', [
            subscriptionBody('trialing')
        ]))
    }) as typeof fetch

    try {
        const subscription = await verifySubscription(
            { AUTUMN_SECRET_KEY: 'test-secret' },
            did,
            'local-first'
        )

        t.equal(
            subscription,
            null,
            'unknown status is not treated as verified'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
})
