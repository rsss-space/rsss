import { test } from '@substrate-system/tapzero'
import { signal, effect } from '@preact/signals'
import type {
    Feed,
    Item,
    CountsResponse
} from '../src/client/db/types.js'
import type { AppState } from '../src/client/state.js'
import {
    setStoredDid,
    writePaintCache,
    getStoredDid,
    clearStoredDid,
    type PaintCacheV1
} from '../src/client/paint-cache.js'
import { hydratePaintCache } from '../src/client/state.js'

/**
 * Minimal AppState-like object with just the four signals that
 * hydratePaintCache touches. No need for full State() instantiation.
 */
function createTestAppState () {
    return {
        feeds: signal<Feed[]>([]),
        items: signal<Item[]>([]),
        counts: signal<CountsResponse>({
            unread: 0,
            starred: 0,
            total: 0,
            perFeed: {}
        }),
        selectedFeedId: signal<number | null>(null)
    }
}

/**
 * Helper to create a test paint cache snapshot
 */
function createTestSnapshot (
    overrides?:Partial<PaintCacheV1>
):PaintCacheV1 {
    return {
        schemaVersion: 1,
        writtenAt: Date.now(),
        feeds: [
            {
                id: 1,
                url: 'https://example.com/feed',
                title: 'Test Feed',
                description: null,
                site_url: null,
                last_fetched: null,
                last_error: null,
                last_status: null,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z'
            }
        ],
        items: [
            {
                id: 1,
                feed_id: 1,
                guid: 'guid-1',
                title: 'Test Item',
                link: 'https://example.com/item-1',
                description: null,
                content: null,
                author: null,
                pub_date: null,
                thumbnail_url: null,
                is_read: 0,
                is_starred: 0,
                created_at: '2026-01-01T00:00:00Z',
                updated_at: '2026-01-01T00:00:00Z'
            }
        ],
        counts: {
            unread: 1,
            starred: 0,
            total: 1,
            perFeed: { 1: 1 }
        },
        selectedFeedId: 1,
        ...overrides
    }
}

test('AC3.1 - hydration applies to all four signals', async (t) => {
    // Clean localStorage
    localStorage.clear()

    const state = createTestAppState() as AppState
    const testSnapshot = createTestSnapshot()

    // Pre-populate paint cache for alice
    const aliceDid = 'did:plc:alice'
    writePaintCache(aliceDid, {
        feeds: testSnapshot.feeds,
        items: testSnapshot.items,
        counts: testSnapshot.counts,
        selectedFeedId: testSnapshot.selectedFeedId
    })

    // Call hydration with alice's DID
    const result = hydratePaintCache(state, aliceDid)

    // Verify all four signals were updated
    t.ok(result, 'hydratePaintCache returns true on hit')
    t.deepEqual(state.feeds.value, testSnapshot.feeds,
        'feeds signal populated from cache')
    t.deepEqual(state.items.value, testSnapshot.items,
        'items signal populated from cache')
    t.deepEqual(state.counts.value, testSnapshot.counts,
        'counts signal populated from cache')
    t.equal(state.selectedFeedId.value, testSnapshot.selectedFeedId,
        'selectedFeedId signal populated from cache')
})

test('AC3.2 - hydration batches all four writes into one effect notification', async (t) => {
    // Clean localStorage
    localStorage.clear()

    const state = createTestAppState() as AppState
    const testSnapshot = createTestSnapshot()

    // Pre-populate paint cache
    const aliceDid = 'did:plc:alice'
    writePaintCache(aliceDid, {
        feeds: testSnapshot.feeds,
        items: testSnapshot.items,
        counts: testSnapshot.counts,
        selectedFeedId: testSnapshot.selectedFeedId
    })

    // Subscribe an effect that reads all four signals
    let effectRunCount = 0
    const stopEffect = effect(() => {
        // Read all four signals to establish dependencies
        if (state.feeds.value && state.items.value &&
            state.counts.value && state.selectedFeedId.value) {
            // dummy check to establish signal dependencies
        }
        effectRunCount++
    })

    // Reset counter after initial subscription run
    effectRunCount = 0

    // Call hydratePaintCache
    hydratePaintCache(state, aliceDid)

    // Wait for microtask queue to process (batch schedules on next microtask)
    await new Promise(resolve => setTimeout(resolve, 0))

    // Effect should fire exactly once (batch ensures this)
    // The batch() call in hydratePaintCache groups all four writes into
    // a single notification per @preact/signals' semantics
    t.equal(
        effectRunCount,
        1,
        'effect fires exactly once after batch write'
    )

    stopEffect()
})

test('AC3.3 - no hydration when lastSessionDid points to different user', async (t) => {
    // Clean localStorage
    localStorage.clear()

    const state = createTestAppState() as AppState
    const testSnapshot = createTestSnapshot()

    // Pre-populate paint cache for alice ONLY
    const aliceDid = 'did:plc:alice'
    writePaintCache(aliceDid, {
        feeds: testSnapshot.feeds,
        items: testSnapshot.items,
        counts: testSnapshot.counts,
        selectedFeedId: testSnapshot.selectedFeedId
    })

    // But set the lastSessionDid to bob
    const bobDid = 'did:plc:bob'
    setStoredDid(bobDid)

    // Verify stored DID is bob
    t.equal(getStoredDid(), bobDid, 'lastSessionDid is bob')

    // Call hydratePaintCache with bob's DID
    // (simulating a user who has no cached snapshot)
    const result = hydratePaintCache(state, getStoredDid())

    // Hydration should return false (no cache for bob)
    t.equal(result, false, 'hydratePaintCache returns false (no cache for bob)')

    // State signals should remain at initial empty values
    t.deepEqual(state.feeds.value, [],
        'feeds signal remains empty (not alice\'s feeds)')
    t.deepEqual(state.items.value, [],
        'items signal remains empty (not alice\'s items)')
    t.deepEqual(state.counts.value, {
        unread: 0,
        starred: 0,
        total: 0,
        perFeed: {}
    }, 'counts signal remains at default')
    t.equal(state.selectedFeedId.value, null,
        'selectedFeedId remains null')

    clearStoredDid()
})

test('AC3.4 - no crash when lastSessionDid is missing (first-ever load)', async (t) => {
    // Clean localStorage
    localStorage.clear()

    const state = createTestAppState() as AppState

    // Verify no lastSessionDid
    t.equal(getStoredDid(), null, 'lastSessionDid is null on fresh install')

    // Call hydratePaintCache with null
    // Should not throw
    let threw = false
    try {
        const result = hydratePaintCache(state, getStoredDid())
        t.equal(result, false, 'hydratePaintCache returns false when did is null')
    } catch (_err) {
        threw = true
    }

    t.equal(threw, false, 'hydratePaintCache does not throw when did is null')

    // State signals should remain at initial empty values
    t.deepEqual(state.feeds.value, [],
        'feeds signal remains empty after null hydration')
    t.deepEqual(state.items.value, [],
        'items signal remains empty after null hydration')
})
