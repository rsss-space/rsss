/**
 * Stripe SDK boundary for the Cloudflare Worker.
 *
 * Pairs with autumn-billing.ts: Autumn owns the canonical customer
 * record (keyed by Bluesky DID, exposing `stripe_id`); this module
 * uses the `stripe_id` to talk to Stripe directly for PaymentMethod
 * and Customer.invoice_settings operations that Autumn does not
 * expose.
 *
 * When `stripeUseLive(env)` is false (no `STRIPE_SECRET_KEY`), every
 * route that depends on this module should return 503 — there is
 * deliberately no dev-mode stub. The Autumn pull-through means we
 * never store the Stripe customer id locally; the source of truth
 * for the DID -> cus_* mapping is the Autumn customer record itself.
 */
import Stripe from 'stripe'
import { Autumn } from 'autumn-js'
import {
    didToCustomerId,
    type BillingEnv as AutumnEnv
} from './autumn-billing.js'

export interface StripeEnv extends AutumnEnv {
    STRIPE_SECRET_KEY?:string;
    STRIPE_PUBLISHABLE_KEY?:string;
}

export function stripeUseLive (env:StripeEnv):boolean {
    return Boolean(env.STRIPE_SECRET_KEY)
}

/**
 * Per-request Stripe SDK handle. Throws when the secret key is not
 * configured; callers are expected to check `stripeUseLive(env)`
 * first and return 503 to clients in that case.
 *
 * Uses `Stripe.createFetchHttpClient()` so the SDK runs on the
 * Cloudflare Workers fetch runtime (no Node `http` module).
 */
export function getStripe (env:StripeEnv):Stripe {
    if (!env.STRIPE_SECRET_KEY) {
        throw new Error(
            'stripe-billing: STRIPE_SECRET_KEY is not configured'
        )
    }
    return new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient()
    })
}

/**
 * Resolve the Stripe customer id (`cus_*`) for a Bluesky DID by
 * asking Autumn on every request. The Autumn customer record's
 * `stripe_id` field is the source of truth.
 *
 * Throws if Autumn isn't configured, if the Autumn customer record
 * has no `stripe_id`, or if the lookup fails. Callers should catch
 * and surface a 503 / 502.
 */
export async function getStripeCustomerId (
    env:StripeEnv,
    did:string
):Promise<string> {
    if (!env.AUTUMN_SECRET_KEY) {
        throw new Error(
            'stripe-billing: AUTUMN_SECRET_KEY is not configured'
        )
    }
    const autumn = new Autumn({ secretKey: env.AUTUMN_SECRET_KEY })
    const customer = await (autumn as unknown as {
        customers:{
            getOrCreate:(args:{ customerId:string }) =>
                Promise<{ stripeId?:string|null }>;
        };
    }).customers.getOrCreate({
        customerId: didToCustomerId(did)
    })
    const stripeId = customer.stripeId
    if (!stripeId) {
        throw new Error(
            'stripe-billing: autumn customer has no stripe_id'
        )
    }
    return stripeId
}
