import { didToCustomerId } from '../src/server/autumn-billing.js'

export function customerBody (
    did:string,
    email:string|null = 'reader@example.com',
    subscriptions:unknown[] = [],
    stripeId:string|null = null
) {
    return {
        id: didToCustomerId(did),
        name: 'reader.test',
        email,
        created_at: 1700000000000,
        fingerprint: null,
        stripe_id: stripeId,
        env: 'live',
        metadata: {},
        send_email_receipts: true,
        billing_controls: {},
        subscriptions,
        purchases: [],
        balances: {},
        flags: {}
    }
}

export function jsonResponse (body:unknown):Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}
