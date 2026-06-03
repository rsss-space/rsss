import { test } from '@substrate-system/tapzero'
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import {
    openLocalDb,
    setTestMode
} from '../src/client/db/sqlite-init.js'
import {
    getFeedCachePolicy,
    upsertFeedCachePolicy,
    isContentCachedForPolicy,
    isContentCachedForFeed,
    feedPolicies,
    _resetFeedPolicies
} from '../src/client/db/feed-cache-policy.js'
import { storeContent } from '../src/client/local-first-settings.js'

setTestMode(true, wasmUrl as string)

test('feed_cache_policy table exists with correct columns', async (t) => {
    const db = await openLocalDb('did:test:fcp-columns')
    try {
        const rows:Array<{ name:string; notnull:number; dflt_value:string|null }> =
            []
        db.exec({
            sql: 'PRAGMA table_info(feed_cache_policy)',
            rowMode: 'object',
            resultRows: rows
        })
        const names = rows.map((r) => r.name)
        t.ok(names.includes('feed_id'), 'has feed_id column')
        t.ok(names.includes('cache_mode'), 'has cache_mode column')
        t.ok(names.includes('max_size_bytes'), 'has max_size_bytes column')
        t.ok(names.includes('max_age_seconds'), 'has max_age_seconds column')
        t.ok(names.includes('updated_at'), 'has updated_at column')

        const updatedAt = rows.find((r) => r.name === 'updated_at')
        t.equal(updatedAt?.notnull, 1, 'updated_at is NOT NULL')
        t.ok(
            updatedAt?.dflt_value?.includes('now'),
            'updated_at has datetime(\'now\') default'
        )

        const cacheMode = rows.find((r) => r.name === 'cache_mode')
        t.equal(cacheMode?.notnull, 0, 'cache_mode is nullable')

        const maxSize = rows.find((r) => r.name === 'max_size_bytes')
        t.equal(maxSize?.notnull, 0, 'max_size_bytes is nullable')

        const maxAge = rows.find((r) => r.name === 'max_age_seconds')
        t.equal(maxAge?.notnull, 0, 'max_age_seconds is nullable')
    } finally {
        db.close()
    }
})

test('feed_cache_policy INSERT OR REPLACE upserts correctly', async (t) => {
    const db = await openLocalDb('did:test:fcp-upsert')
    try {
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/feed',
                'Test Feed',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)

        db.exec(`
            INSERT OR REPLACE INTO feed_cache_policy
                (feed_id, cache_mode, max_size_bytes, max_age_seconds)
            VALUES (1, 'text_images', 10000000, 604800)
        `)

        const rows:Array<{
            feed_id:number
            cache_mode:string
            max_size_bytes:number
            max_age_seconds:number
        }> = []
        db.exec({
            sql: 'SELECT * FROM feed_cache_policy WHERE feed_id = 1',
            rowMode: 'object',
            resultRows: rows
        })
        t.equal(rows.length, 1, 'one row inserted')
        t.equal(rows[0].cache_mode, 'text_images', 'cache_mode stored')
        t.equal(rows[0].max_size_bytes, 10000000, 'max_size_bytes stored')
        t.equal(rows[0].max_age_seconds, 604800, 'max_age_seconds stored')

        // Replace/update the row
        db.exec(`
            INSERT OR REPLACE INTO feed_cache_policy
                (feed_id, cache_mode, max_size_bytes, max_age_seconds)
            VALUES (1, 'text', NULL, NULL)
        `)

        const updated:typeof rows = []
        db.exec({
            sql: 'SELECT * FROM feed_cache_policy WHERE feed_id = 1',
            rowMode: 'object',
            resultRows: updated
        })
        t.equal(updated.length, 1, 'still one row after replace')
        t.equal(updated[0].cache_mode, 'text', 'cache_mode updated')
        t.equal(updated[0].max_size_bytes, null, 'max_size_bytes nullable null')
    } finally {
        db.close()
    }
})

test('feed_cache_policy accepts NULL for optional columns', async (t) => {
    const db = await openLocalDb('did:test:fcp-nulls')
    try {
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/feed',
                'Test Feed',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)

        db.exec(`
            INSERT OR REPLACE INTO feed_cache_policy (feed_id)
            VALUES (1)
        `)

        const rows:Array<{
            feed_id:number
            cache_mode:string|null
            max_size_bytes:number|null
            max_age_seconds:number|null
        }> = []
        db.exec({
            sql: 'SELECT * FROM feed_cache_policy WHERE feed_id = 1',
            rowMode: 'object',
            resultRows: rows
        })
        t.equal(rows.length, 1, 'row inserted with all-null optional columns')
        t.equal(rows[0].cache_mode, null, 'cache_mode defaults to NULL')
        t.equal(rows[0].max_size_bytes, null, 'max_size_bytes defaults to NULL')
        t.equal(rows[0].max_age_seconds, null, 'max_age_seconds defaults to NULL')
    } finally {
        db.close()
    }
})

test('AC7.1: content_enabled rounds trip across upsert and read',
    async (t) => {
        const db = await openLocalDb('did:test:fcp-rt-1')
        try {
            db.exec(`
                INSERT INTO feeds (url, title, created_at, updated_at)
                VALUES (
                    'https://example.com/feed',
                    'Test Feed',
                    '2024-01-01T00:00:00Z',
                    '2024-01-01T00:00:00Z'
                )
            `)

            // Test round-trip for content_enabled = 1
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 1
            })
            let row = await getFeedCachePolicy(db, 1)
            t.equal(row?.content_enabled, 1, 'content_enabled 1 round-trips')

            // Test round-trip for content_enabled = 0
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 0
            })
            row = await getFeedCachePolicy(db, 1)
            t.equal(row?.content_enabled, 0, 'content_enabled 0 round-trips')

            // Test that all-null deletes the row (inherit)
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            })
            row = await getFeedCachePolicy(db, 1)
            t.equal(row, null, 'all-null row is deleted (inherit)')
        } finally {
            db.close()
        }
    })

test('AC7.2: content_enabled 0 row survives with null cache settings',
    async (t) => {
        const db = await openLocalDb('did:test:fcp-zero-survives')
        try {
            db.exec(`
                INSERT INTO feeds (url, title, created_at, updated_at)
                VALUES (
                    'https://example.com/feed',
                    'Test Feed',
                    '2024-01-01T00:00:00Z',
                    '2024-01-01T00:00:00Z'
                )
            `)

            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 0
            })
            const row = await getFeedCachePolicy(db, 1)
            t.ok(row !== null, 'row is not deleted')
            t.equal(row?.content_enabled, 0, 'content_enabled is 0')
        } finally {
            db.close()
        }
    })

test('AC7.3: all-null row deletes; non-null cache_mode survives',
    async (t) => {
        const db = await openLocalDb('did:test:fcp-all-null-delete')
        try {
            db.exec(`
                INSERT INTO feeds (url, title, created_at, updated_at)
                VALUES (
                    'https://example.com/feed',
                    'Test Feed',
                    '2024-01-01T00:00:00Z',
                    '2024-01-01T00:00:00Z'
                )
            `)

            // Insert a row with all-null fields
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            })
            let row = await getFeedCachePolicy(db, 1)
            t.equal(row, null, 'all-null row is deleted')

            // Insert with cache_mode set but others null
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: 'text',
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            })
            row = await getFeedCachePolicy(db, 1)
            t.ok(row !== null, 'row with cache_mode survives')
            t.equal(row?.cache_mode, 'text', 'cache_mode is text')

            // Update content_enabled to null (rest remain set)
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: 'text',
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            })
            row = await getFeedCachePolicy(db, 1)
            t.ok(row !== null, 'row survives with cache_mode set')
            t.equal(row?.content_enabled, null, 'content_enabled is null')
        } finally {
            db.close()
        }
    })

test('AC9.1/AC9.2: storage (0/1 persist, all-null deletes)',
    async (t) => {
        const db = await openLocalDb('did:test:fcp-ac9')
        try {
            db.exec(`
                INSERT INTO feeds (url, title, created_at, updated_at)
                VALUES (
                    'https://example.com/feed',
                    'Test Feed',
                    '2024-01-01T00:00:00Z',
                    '2024-01-01T00:00:00Z'
                )
            `)

            // Write 0
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 0
            })
            let row = await getFeedCachePolicy(db, 1)
            t.ok(row !== null, 'row 0 persists')
            t.equal(row?.content_enabled, 0, 'content_enabled is 0')

            // Write 1
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 1
            })
            row = await getFeedCachePolicy(db, 1)
            t.ok(row !== null, 'row 1 persists')
            t.equal(row?.content_enabled, 1, 'content_enabled is 1')

            // Write all-null
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            })
            row = await getFeedCachePolicy(db, 1)
            t.equal(row, null, 'all-null removes row')
        } finally {
            db.close()
        }
    })

test('AC2.1-AC2.5: resolver truth table (override ?? global)',
    async (t) => {
        const originalStoreContent = storeContent.value
        try {
            // AC2.1: override null + global on -> effective on
            storeContent.value = true
            const nullWithGlobalOn = {
                feed_id: 1,
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: null
            }
            t.equal(
                isContentCachedForPolicy(nullWithGlobalOn),
                true,
                'AC2.1: null override + global on -> effective on'
            )

            // AC2.2: override null + global off -> effective off
            storeContent.value = false
            t.equal(
                isContentCachedForPolicy(nullWithGlobalOn),
                false,
                'AC2.2: null override + global off -> effective off'
            )

            // AC2.3: override 1 + global off -> effective on
            const overrideOn = {
                feed_id: 1,
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 1
            }
            storeContent.value = false
            t.equal(
                isContentCachedForPolicy(overrideOn),
                true,
                'AC2.3: override 1 + global off -> effective on'
            )

            // AC2.4: override 0 + global on -> effective off
            const overrideOff = {
                feed_id: 1,
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 0
            }
            storeContent.value = true
            t.equal(
                isContentCachedForPolicy(overrideOff),
                false,
                'AC2.4: override 0 + global on -> effective off'
            )

            // AC2.5: override 1 + global on -> effective on
            storeContent.value = true
            t.equal(
                isContentCachedForPolicy(overrideOn),
                true,
                'AC2.5: override 1 + global on -> effective on'
            )
        } finally {
            storeContent.value = originalStoreContent
        }
    })

test('AC7.4: upsert performs no fetch', async (t) => {
    const db = await openLocalDb('did:test:fcp-no-fetch')
    const originalFetch = globalThis.fetch
    let fetchCalled = false
    try {
        db.exec(`
            INSERT INTO feeds (url, title, created_at, updated_at)
            VALUES (
                'https://example.com/feed',
                'Test Feed',
                '2024-01-01T00:00:00Z',
                '2024-01-01T00:00:00Z'
            )
        `)

        globalThis.fetch = (() => {
            fetchCalled = true
            throw new Error('fetch should not be called')
        }) as typeof fetch

        await upsertFeedCachePolicy(db, 1, {
            cache_mode: null,
            max_size_bytes: null,
            max_age_seconds: null,
            content_enabled: 1
        })

        t.equal(fetchCalled, false, 'no fetch called during upsert')
    } finally {
        globalThis.fetch = originalFetch
        db.close()
    }
})

test('isContentCachedForFeed uses feedPolicies signal',
    async (t) => {
        const originalStoreContent = storeContent.value
        const db = await openLocalDb('did:test:fcp-signal')
        try {
            db.exec(`
                INSERT INTO feeds (url, title, created_at, updated_at)
                VALUES (
                    'https://example.com/feed',
                    'Test Feed',
                    '2024-01-01T00:00:00Z',
                    '2024-01-01T00:00:00Z'
                )
            `)

            _resetFeedPolicies()
            storeContent.value = true

            // Feed not in signal yet -> inherits global
            t.equal(
                isContentCachedForFeed(1),
                true,
                'missing feed uses global when true'
            )

            // Load feed with override 0
            await upsertFeedCachePolicy(db, 1, {
                cache_mode: null,
                max_size_bytes: null,
                max_age_seconds: null,
                content_enabled: 0
            })
            const row = await getFeedCachePolicy(db, 1)
            feedPolicies.value = { 1: row }

            // Now check using signal
            t.equal(
                isContentCachedForFeed(1),
                false,
                'feed with override 0 returns false'
            )

            // Update to 1
            feedPolicies.value = {
                1: {
                    ...row!,
                    content_enabled: 1
                }
            }
            t.equal(
                isContentCachedForFeed(1),
                true,
                'feed with override 1 returns true'
            )
        } finally {
            storeContent.value = originalStoreContent
            _resetFeedPolicies()
            db.close()
        }
    })
