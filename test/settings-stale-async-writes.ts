import { test } from '@substrate-system/tapzero'
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import {
    openLocalDb,
    setTestMode
} from '../src/client/db/sqlite-init.js'
import {
    feedPolicies,
    loadFeedPolicies,
    upsertFeedCachePolicy
} from '../src/client/db/feed-cache-policy.js'
import {
    feedStorageBytes,
    totalStorageBytes,
    loadStorageUsage,
    _resetStorageUsage
} from '../src/client/db/storage-usage.js'
import {
    billingStatus,
    setBillingStatus
} from '../src/client/billing-status.js'
import {
    paymentMethods,
    defaultMethodId,
    paymentMethodsLoading,
    paymentMethodsError,
    setPaymentMethodsState,
    resetPaymentMethods
} from '../src/client/payment-methods.js'
import { State } from '../src/client/state.js'

setTestMode(true, wasmUrl as string)

interface MaybeFetchHost {
    fetch?:typeof fetch
}

function withFetchStub (
    handler:(url:string) => Response|Promise<Response>,
    body:() => void|Promise<void>
):Promise<void> {
    const host = globalThis as unknown as MaybeFetchHost
    const original = host.fetch
    host.fetch = ((input:RequestInfo|URL):Promise<Response> => {
        const url = typeof input === 'string' ?
            input :
            (input instanceof URL ?
                input.href :
                (input as Request).url)
        return Promise.resolve(handler(url))
    }) as typeof fetch
    return Promise.resolve(body()).finally(() => {
        if (original === undefined) {
            delete (host as { fetch?:unknown }).fetch
        } else {
            host.fetch = original
        }
    })
}

function makeJsonResponse (data:unknown, status = 200):Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' }
    })
}

// ────────────────────────────────────────────────────────────────────
// loadFeedPolicies — INV-3 for feedPolicies signal
// ────────────────────────────────────────────────────────────────────

test('loadFeedPolicies: shouldApply=false leaves feedPolicies ' +
    'untouched', async t => {
    const db = await openLocalDb('did:test:stale-policies')
    try {
        // Seed a row so loadFeedPolicies has something to read.
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/feed',
                'F',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)
        await upsertFeedCachePolicy(db, 1, {
            cache_mode: 'text',
            max_size_bytes: 1_000_000,
            max_age_seconds: 86400
        })

        // Record the current feedPolicies value to detect mutation.
        const before = feedPolicies.value

        await loadFeedPolicies(db, [1], { shouldApply: () => false })

        t.equal(
            feedPolicies.value,
            before,
            'feedPolicies.value unchanged when shouldApply=false'
        )
    } finally {
        db.close()
    }
})

test('loadFeedPolicies: shouldApply=true mutates feedPolicies ' +
    'as before', async t => {
    const db = await openLocalDb('did:test:apply-policies')
    try {
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/feed-apply',
                'F2',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)
        await upsertFeedCachePolicy(db, 1, {
            cache_mode: 'text_images',
            max_size_bytes: 2_000_000,
            max_age_seconds: 172800
        })

        await loadFeedPolicies(db, [1], { shouldApply: () => true })

        const policy = feedPolicies.value[1]
        t.ok(policy, 'feedPolicies has a row for feed 1')
        t.equal(
            policy?.cache_mode,
            'text_images',
            'cache_mode was applied'
        )
    } finally {
        db.close()
    }
})

test('loadFeedPolicies: omitted shouldApply preserves legacy ' +
    'behaviour', async t => {
    const db = await openLocalDb('did:test:default-policies')
    try {
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/legacy',
                'L',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)
        await upsertFeedCachePolicy(db, 1, {
            cache_mode: 'text',
            max_size_bytes: null,
            max_age_seconds: null
        })

        await loadFeedPolicies(db, [1])

        t.ok(
            feedPolicies.value[1],
            'feedPolicies was applied when shouldApply omitted'
        )
    } finally {
        db.close()
    }
})

// ────────────────────────────────────────────────────────────────────
// loadStorageUsage — INV-3 for feedStorageBytes + totalStorageBytes
// ────────────────────────────────────────────────────────────────────

test('loadStorageUsage: shouldApply=false leaves storage signals ' +
    'untouched', async t => {
    const db = await openLocalDb('did:test:stale-storage')
    try {
        _resetStorageUsage()
        const beforePerFeed = feedStorageBytes.value
        const beforeTotal = totalStorageBytes.value

        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/storage',
                'S',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)

        await loadStorageUsage(db, [1], { shouldApply: () => false })

        t.equal(
            feedStorageBytes.value,
            beforePerFeed,
            'feedStorageBytes unchanged'
        )
        t.equal(
            totalStorageBytes.value,
            beforeTotal,
            'totalStorageBytes unchanged'
        )
    } finally {
        db.close()
    }
})

test('loadStorageUsage: shouldApply=true mutates storage signals',
    async t => {
        const db = await openLocalDb('did:test:apply-storage')
        try {
            _resetStorageUsage()
            db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/storage-apply',
                'SA',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)

            await loadStorageUsage(db, [1], { shouldApply: () => true })

            t.ok(
                Object.prototype.hasOwnProperty.call(
                    feedStorageBytes.value,
                    '1'
                ),
                'feedStorageBytes received entry for feed 1'
            )
        } finally {
            db.close()
        }
    })

// ────────────────────────────────────────────────────────────────────
// State.loadBillingStatus — INV-3 for billingStatus
// ────────────────────────────────────────────────────────────────────

test('State.loadBillingStatus: shouldApply=false leaves ' +
    'billingStatus untouched', async t => {
    // Seed a known marker so we can detect mutation.
    const sentinel = {
        entitled: false as const,
        planId: 'sentinel',
        currentPeriodEnd: null,
        canceledAt: null,
        pendingDeletion: null,
        contactEmail: null,
        useLive: false,
        stripePublishableKey: null
    } as unknown as Parameters<typeof setBillingStatus>[0]
    setBillingStatus(sentinel)

    await withFetchStub(
        (_url) => makeJsonResponse({
            entitled: true,
            planId: 'local-first',
            currentPeriodEnd: null,
            canceledAt: null,
            pendingDeletion: null,
            contactEmail: null,
            useLive: false,
            stripePublishableKey: null
        }),
        async () => {
            await State.loadBillingStatus({ shouldApply: () => false })
            t.equal(
                billingStatus.value,
                sentinel,
                'billingStatus retained sentinel (no apply)'
            )
        }
    )
})

test('State.loadBillingStatus: shouldApply=true applies the ' +
    'response', async t => {
    setBillingStatus(null as unknown as Parameters<
        typeof setBillingStatus
    >[0])

    await withFetchStub(
        (_url) => makeJsonResponse({
            entitled: true,
            planId: 'local-first',
            currentPeriodEnd: null,
            canceledAt: null,
            pendingDeletion: null,
            contactEmail: null,
            useLive: false,
            stripePublishableKey: null
        }),
        async () => {
            await State.loadBillingStatus({ shouldApply: () => true })
            t.equal(
                billingStatus.value?.planId,
                'local-first',
                'billingStatus updated when shouldApply=true'
            )
        }
    )
})

// ────────────────────────────────────────────────────────────────────
// State.loadPaymentMethods — INV-3 for paymentMethods cluster
// ────────────────────────────────────────────────────────────────────

test('State.loadPaymentMethods: shouldApply=false leaves payment ' +
    'method signals untouched', async t => {
    resetPaymentMethods()
    const sentinelMethods = [{
        id: 'pm_sentinel',
        brand: 'visa',
        last4: '0000',
        expMonth: 1,
        expYear: 2030,
        isDefault: true
    }]
    setPaymentMethodsState(sentinelMethods, 'pm_sentinel')
    const beforeLoading = paymentMethodsLoading.value
    const beforeError = paymentMethodsError.value

    await withFetchStub(
        (_url) => makeJsonResponse({
            methods: [{
                id: 'pm_new',
                brand: 'mastercard',
                last4: '4242',
                expMonth: 12,
                expYear: 2099
            }],
            defaultId: 'pm_new'
        }),
        async () => {
            await State.loadPaymentMethods({
                shouldApply: () => false
            })
            t.equal(
                paymentMethods.value,
                sentinelMethods,
                'paymentMethods retained sentinel'
            )
            t.equal(
                defaultMethodId.value,
                'pm_sentinel',
                'defaultMethodId retained sentinel'
            )
            t.equal(
                paymentMethodsError.value,
                beforeError,
                'paymentMethodsError unchanged'
            )
            // paymentMethodsLoading may have transitioned true at the
            // synchronous start; the apply gate only suppresses the
            // post-await writes. The important property is the data
            // signals are not overwritten.
            t.ok(
                typeof paymentMethodsLoading.value === 'boolean',
                'paymentMethodsLoading remains a boolean (' +
                String(beforeLoading) + ' → ' +
                String(paymentMethodsLoading.value) + ')'
            )
        }
    )
})

test('State.loadPaymentMethods: shouldApply=true applies the ' +
    'response', async t => {
    resetPaymentMethods()

    await withFetchStub(
        (_url) => makeJsonResponse({
            methods: [{
                id: 'pm_apply',
                brand: 'amex',
                last4: '0007',
                expMonth: 6,
                expYear: 2040
            }],
            defaultId: 'pm_apply'
        }),
        async () => {
            await State.loadPaymentMethods({
                shouldApply: () => true
            })
            t.equal(
                paymentMethods.value.length,
                1,
                'paymentMethods has one method'
            )
            t.equal(
                paymentMethods.value[0].id,
                'pm_apply',
                'method id matches response'
            )
            t.equal(
                defaultMethodId.value,
                'pm_apply',
                'defaultMethodId matches response'
            )
            t.equal(
                paymentMethodsLoading.value,
                false,
                'loading flag cleared on apply'
            )
        }
    )
})
