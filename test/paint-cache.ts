// pattern: Functional Core
import { test } from '@substrate-system/tapzero'
import {
    readPaintCache,
    writePaintCache,
    clearPaintCache,
    getStoredDid,
    setStoredDid,
    clearStoredDid,
    type PaintCacheSnapshotInput,
    type ItemSummary,
    type FeedSummary
} from '../src/client/paint-cache.js'

// Test AC2.1: Round-trip write/read
test('AC2.1: round-trip write/read', async (t) => {
    clearPaintCache()
    clearStoredDid()

    const feeds:FeedSummary[] = [
        {
            id: 1,
            url: 'https://example.com/feed1',
            title: 'Feed 1',
            description: 'Description 1',
            site_url: 'https://example.com',
            last_fetched: '2026-05-25T00:00:00Z',
            last_error: null,
            last_status: 200,
            created_at: '2026-05-20T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z'
        }
    ]

    const items:ItemSummary[] = [
        {
            id: 100,
            feed_id: 1,
            guid: 'guid-1',
            title: 'Item 1',
            link: 'https://example.com/item1',
            description: null,
            content: null,
            author: 'Author 1',
            pub_date: '2026-05-25T00:00:00Z',
            thumbnail_url: null,
            og_image_url: null,
            blurhash: null,
            image_width: null,
            image_height: null,
            is_read: 0,
            is_starred: 0,
            created_at: '2026-05-25T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z',
            feed_title: 'Feed 1'
        }
    ]

    const counts = {
        unread: 1,
        starred: 0,
        total: 1,
        perFeed: { 1: 1 }
    }

    const snapshot:PaintCacheSnapshotInput = {
        feeds,
        items,
        counts,
        selectedFeedId: 1
    }

    writePaintCache('did:plc:alice', snapshot)
    const read = readPaintCache('did:plc:alice')

    t.ok(read, 'snapshot was read back')
    t.equal(read?.schemaVersion, 1, 'schemaVersion is 1')
    t.ok(
        read?.writtenAt &&
        read.writtenAt <= Date.now() &&
        read.writtenAt > Date.now() - 5000,
        'writtenAt is recent'
    )
    t.deepEqual(read?.feeds, feeds, 'feeds round-trip')
    t.deepEqual(read?.items, items, 'items round-trip')
    t.deepEqual(read?.counts, counts, 'counts round-trip')
    t.equal(read?.selectedFeedId, 1, 'selectedFeedId round-trips')
})

// Test AC2.2: Item truncation to 200 max, newest-first preserved
test('AC2.2: item truncation to 200, newest-first preserved', async (t) => {
    clearPaintCache()
    clearStoredDid()

    // Create 300 items
    const items:ItemSummary[] = []
    for (let i = 0; i < 300; i++) {
        items.push({
            id: 100 + i,
            feed_id: 1,
            guid: `guid-${i}`,
            title: `Item ${i}`,
            link: `https://example.com/item${i}`,
            description: null,
            content: null,
            author: 'Author',
            pub_date: '2026-05-25T00:00:00Z',
            thumbnail_url: null,
            og_image_url: null,
            blurhash: null,
            image_width: null,
            image_height: null,
            is_read: 0,
            is_starred: 0,
            created_at: '2026-05-25T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z'
        })
    }

    const snapshot:PaintCacheSnapshotInput = {
        feeds: [],
        items,
        counts: { unread: 300, starred: 0, total: 300, perFeed: {} },
        selectedFeedId: null
    }

    writePaintCache('did:plc:bob', snapshot)
    const read = readPaintCache('did:plc:bob')

    t.equal(read?.items.length, 200, 'items truncated to 200')
    t.deepEqual(
        read?.items[0],
        items[0],
        'first item preserved (newest-first)'
    )
})

// Test AC2.3: 1 MB byte cap, items dropped from tail
test('AC2.3: 1 MB byte cap enforcement', async (t) => {
    clearPaintCache()
    clearStoredDid()

    // Create 200 items with 10 KB titles each
    const largeTitle = 'a'.repeat(10_000)
    const items:ItemSummary[] = []
    for (let i = 0; i < 200; i++) {
        items.push({
            id: 100 + i,
            feed_id: 1,
            guid: `guid-${i}`,
            title: largeTitle,
            link: `https://example.com/item${i}`,
            description: null,
            content: null,
            author: 'Author',
            pub_date: '2026-05-25T00:00:00Z',
            thumbnail_url: null,
            og_image_url: null,
            blurhash: null,
            image_width: null,
            image_height: null,
            is_read: 0,
            is_starred: 0,
            created_at: '2026-05-25T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z'
        })
    }

    const snapshot:PaintCacheSnapshotInput = {
        feeds: [],
        items,
        counts: { unread: 200, starred: 0, total: 200, perFeed: {} },
        selectedFeedId: null
    }

    writePaintCache('did:plc:carol', snapshot)
    const read = readPaintCache('did:plc:carol')

    t.ok(read, 'snapshot was read back')
    t.ok(
        read && read.items.length < 200,
        'items truncated below 200 to respect byte cap'
    )
    const serialized = JSON.stringify(read)
    t.ok(
        serialized.length <= 1_000_000,
        'serialized snapshot is under 1 MB'
    )
})

// Test AC2.5: Missing key returns null
test('AC2.5: missing key returns null', async (t) => {
    clearPaintCache()
    clearStoredDid()

    const result = readPaintCache('did:plc:bob')
    t.equal(result, null, 'missing key returns null')
})

// Test AC2.6: Malformed JSON returns null
test('AC2.6: malformed JSON returns null', async (t) => {
    clearPaintCache()
    clearStoredDid()

    localStorage.setItem('rsss.paintCache.v1.did:plc:carol', '{not json')

    const result = readPaintCache('did:plc:carol')
    t.equal(result, null, 'malformed JSON returns null')

    clearPaintCache()
})

// Test AC2.7: Schema version mismatch returns null
test('AC2.7: schema version mismatch returns null', async (t) => {
    clearPaintCache()
    clearStoredDid()

    const invalid = {
        schemaVersion: 2,
        writtenAt: Date.now(),
        feeds: [],
        items: [],
        counts: { unread: 0, starred: 0, total: 0, perFeed: {} },
        selectedFeedId: null
    }

    localStorage.setItem(
        'rsss.paintCache.v1.did:plc:dan',
        JSON.stringify(invalid)
    )

    const result = readPaintCache('did:plc:dan')
    t.equal(result, null, 'schema version mismatch returns null')

    clearPaintCache()
})

// Test AC6.4: Per-DID isolation
test('AC6.4: per-DID isolation', async (t) => {
    clearPaintCache()
    clearStoredDid()

    // Write snapshot for Alice
    const aliceSnapshot:PaintCacheSnapshotInput = {
        feeds: [{
            id: 1,
            url: 'https://alice.com/feed',
            title: 'Alice Feed',
            description: null,
            site_url: null,
            last_fetched: null,
            last_error: null,
            last_status: null,
            created_at: '2026-05-25T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z'
        }],
        items: [],
        counts: { unread: 0, starred: 0, total: 0, perFeed: {} },
        selectedFeedId: 1
    }
    writePaintCache('did:plc:alice', aliceSnapshot)

    // Write snapshot for Bob
    const bobSnapshot:PaintCacheSnapshotInput = {
        feeds: [{
            id: 2,
            url: 'https://bob.com/feed',
            title: 'Bob Feed',
            description: null,
            site_url: null,
            last_fetched: null,
            last_error: null,
            last_status: null,
            created_at: '2026-05-25T00:00:00Z',
            updated_at: '2026-05-25T00:00:00Z'
        }],
        items: [],
        counts: { unread: 0, starred: 0, total: 0, perFeed: {} },
        selectedFeedId: 2
    }
    writePaintCache('did:plc:bob', bobSnapshot)

    // Clear Alice's cache
    clearPaintCache('did:plc:alice')

    // Verify Alice's cache is gone
    const aliceAfter = readPaintCache('did:plc:alice')
    t.equal(aliceAfter, null, 'Alice cache cleared')

    // Verify Bob's cache still exists
    const bobAfter = readPaintCache('did:plc:bob')
    t.ok(bobAfter, 'Bob cache still exists')
    t.deepEqual(bobAfter?.feeds, bobSnapshot.feeds, 'Bob cache intact')
})

// Extra test: getStoredDid / setStoredDid round-trip
test('Extra: getStoredDid/setStoredDid round-trip', async (t) => {
    clearPaintCache()
    clearStoredDid()

    setStoredDid('did:plc:dan')
    const stored = getStoredDid()
    t.equal(stored, 'did:plc:dan', 'setStoredDid/getStoredDid round-trip')

    clearStoredDid()
    const after = getStoredDid()
    t.equal(after, null, 'clearStoredDid clears the value')
})
