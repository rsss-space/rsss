import { test } from '@substrate-system/tapzero'
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import {
    openLocalDb,
    setTestMode
} from '../src/client/db/sqlite-init.js'
import {
    cacheItemImages,
    type FeedCachePolicyRow
} from '../src/client/db/image-cache.js'
import {
    sumTotal,
    sumByFeed
} from '../src/client/db/cached-images.js'
import { defaultCacheMode } from '../src/client/local-first-settings.js'
import type { Sqlite3Db } from '../src/client/db/sqlite-init.js'

setTestMode(true, wasmUrl as string)

function seedFeed (db:Sqlite3Db):void {
    db.exec(`
        INSERT INTO feeds (id, url, title, created_at, updated_at)
        VALUES (
            1,
            'https://example.com/feed',
            'Test Feed',
            '2024-01-01T00:00:00Z',
            '2024-01-01T00:00:00Z'
        )
    `)
}

function makeMockCaches ():{ storage:Pick<CacheStorage, 'open'>; puts:string[] } {
    const puts:string[] = []
    return {
        storage: {
            open: async (_name:string) => ({
                put: async (url:string, _res:Response) => {
                    puts.push(url)
                },
                match: async (_url:string) => undefined,
                delete: async (_url:string) => false,
                keys: async () => [],
                addAll: async () => undefined,
                add: async () => undefined
            } as unknown as Cache)
        },
        puts
    }
}

function makeMockFetch (
    sizeBytes = 100
): { fn:typeof fetch; calls:string[] } {
    const calls:string[] = []
    return {
        calls,
        fn: async (url:RequestInfo|URL) => {
            calls.push(String(url))
            const buf = new Uint8Array(sizeBytes).buffer
            return new Response(buf, {
                status: 200,
                headers: { 'Content-Type': 'image/jpeg' }
            })
        }
    }
}

test('text mode: returns immediately without fetching', async (t) => {
    const db = await openLocalDb('did:test:ic-text-mode')
    try {
        seedFeed(db)
        const { fn: fetchFn, calls } = makeMockFetch()
        const { storage: cs, puts } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: '<img src="https://example.com/img.jpg">',
                description: null
            },
            { cache_mode: 'text' },
            fetchFn,
            cs
        )

        t.equal(calls.length, 0, 'no fetches in text mode')
        t.equal(puts.length, 0, 'nothing stored in Cache Storage')
    } finally {
        db.close()
    }
})

test('text_images mode: caches new image URLs', async (t) => {
    const db = await openLocalDb('did:test:ic-text-images')
    try {
        seedFeed(db)
        const { fn: fetchFn, calls } = makeMockFetch(256)
        const { storage: cs, puts } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: '<img src="https://example.com/a.jpg">',
                description: '<img src="https://example.com/b.png">'
            },
            { cache_mode: 'text_images' },
            fetchFn,
            cs
        )

        t.equal(calls.length, 2, 'fetched two images')
        t.equal(puts.length, 2, 'stored two images in Cache Storage')

        const rows:Array<{ url:string; size_bytes:number }> = []
        db.exec({
            sql: 'SELECT url, size_bytes FROM cached_images ORDER BY url',
            rowMode: 'object',
            resultRows: rows
        })
        t.equal(rows.length, 2, 'two cached_images rows inserted')
        t.equal(
            rows[0].url,
            'https://example.com/a.jpg',
            'first url recorded'
        )
        t.equal(rows[0].size_bytes, 256, 'size_bytes recorded from buffer')
    } finally {
        db.close()
    }
})

test('already-cached URLs are skipped', async (t) => {
    const db = await openLocalDb('did:test:ic-skip-cached')
    try {
        seedFeed(db)

        // pre-insert a cached_images row
        db.exec(`
            INSERT INTO cached_images (url, feed_id, size_bytes)
            VALUES ('https://example.com/existing.jpg', 1, 50)
        `)

        const { fn: fetchFn, calls } = makeMockFetch()
        const { storage: cs, puts } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: '<img src="https://example.com/existing.jpg">',
                description: null
            },
            { cache_mode: 'text_images' },
            fetchFn,
            cs
        )

        t.equal(calls.length, 0, 'no fetch for already-cached URL')
        t.equal(puts.length, 0, 'nothing put in Cache Storage')

        const rows:Array<{ url:string }> = []
        db.exec({
            sql: 'SELECT url FROM cached_images',
            rowMode: 'object',
            resultRows: rows
        })
        t.equal(rows.length, 1, 'still only one cached_images row')
    } finally {
        db.close()
    }
})

test('fetch errors do not write cached_images rows', async (t) => {
    const db = await openLocalDb('did:test:ic-fetch-error')
    try {
        seedFeed(db)

        let call = 0
        const fetchFn:typeof fetch = async (_url) => {
            call++
            throw new Error('network error')
        }
        const { storage: cs, puts } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: '<img src="https://example.com/fail.jpg">',
                description: null
            },
            { cache_mode: 'text_images' },
            fetchFn,
            cs
        )

        t.equal(call, 1, 'fetch was attempted')
        t.equal(puts.length, 0, 'nothing stored in Cache Storage')

        const rows:Array<{ url:string }> = []
        db.exec({
            sql: 'SELECT url FROM cached_images',
            rowMode: 'object',
            resultRows: rows
        })
        t.equal(rows.length, 0, 'no cached_images row on fetch error')
    } finally {
        db.close()
    }
})

test('null policy falls back to defaultCacheMode', async (t) => {
    const db = await openLocalDb('did:test:ic-null-policy')
    try {
        seedFeed(db)

        const orig = defaultCacheMode.value
        defaultCacheMode.value = 'text'

        const { fn: fetchFn, calls } = makeMockFetch()
        const { storage: cs } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: '<img src="https://example.com/img.jpg">',
                description: null
            },
            null,
            fetchFn,
            cs
        )

        t.equal(calls.length, 0, 'text default skips fetch')

        defaultCacheMode.value = orig
    } finally {
        db.close()
    }
})

test('duplicate URLs in content are only fetched once', async (t) => {
    const db = await openLocalDb('did:test:ic-dedup')
    try {
        seedFeed(db)
        const { fn: fetchFn, calls } = makeMockFetch()
        const { storage: cs, puts } = makeMockCaches()

        await cacheItemImages(
            db,
            {
                id: 1,
                feed_id: 1,
                content: `
                    <img src="https://example.com/dup.jpg">
                    <img src="https://example.com/dup.jpg">
                `,
                description: '<img src="https://example.com/dup.jpg">'
            },
            { cache_mode: 'text_images' } as FeedCachePolicyRow,
            fetchFn,
            cs
        )

        t.equal(calls.length, 1, 'deduplicated to one fetch')
        t.equal(puts.length, 1, 'one entry in Cache Storage')
    } finally {
        db.close()
    }
})

test('AC10.1: DB write failure deletes Cache Storage entry (no orphan)',
    async (t) => {
        const db = await openLocalDb('did:test:ic-db-failure-rollback')
        try {
            seedFeed(db)

            const puts:string[] = []
            const deletes:string[] = []
            const storage:Pick<CacheStorage, 'open'> = {
                open: async (_name:string) => ({
                    put: async (url:string, _res:Response) => {
                        puts.push(url)
                    },
                    match: async (url:string) => {
                        // Return response if the URL was put and not deleted
                        return puts.includes(url) && !deletes.includes(url) ?
                            new Response() :
                            undefined
                    },
                    delete: async (url:string) => {
                        deletes.push(url)
                        return true
                    },
                    keys: async () => [],
                    addAll: async () => undefined,
                    add: async () => undefined
                } as unknown as Cache)
            }

            // Make fetch succeed so bucket.put happens
            const fetchFn:typeof fetch = async (_url) => {
                const buf = new Uint8Array(100).buffer
                return new Response(buf, {
                    status: 200,
                    headers: { 'Content-Type': 'image/jpeg' }
                })
            }

            // Mock DB to fail on recordCachedImage
            const originalExec = db.exec
            let recordCachedImageCalls = 0
            db.exec = function(...args:unknown[]) {
                const arg = args[0]
                if (typeof arg === 'object' && arg !== null) {
                    const obj = arg as Record<string, unknown>
                    if (typeof obj.sql === 'string' &&
                        obj.sql.includes('INSERT OR IGNORE INTO cached_images')) {
                        recordCachedImageCalls++
                        throw new Error('SQLITE_FULL: database disk image is malformed')
                    }
                }
                return originalExec.call(this, ...args)
            }

            await cacheItemImages(
                db,
                {
                    id: 1,
                    feed_id: 1,
                    content: '<img src="https://example.com/fail.jpg">',
                    description: null
                },
                { cache_mode: 'text_images' },
                fetchFn,
                storage
            )

            t.equal(puts.length, 1,
                'bucket.put was called before DB error')
            t.equal(recordCachedImageCalls, 1,
                'recordCachedImage was attempted')
            t.equal(deletes.length, 1,
                'bucket.delete was called to roll back')
            t.equal(deletes[0], 'https://example.com/fail.jpg',
                'deleted the correct URL')

            // Verify the orphan is absent from Cache Storage mock
            const response = await storage.open('rsss-images-v1')
                .then(c => c.match('https://example.com/fail.jpg'))
            t.equal(response, undefined,
                'no orphan blob after rollback')
        } finally {
            db.close()
        }
    }
)

test('AC10.2: eviction accounting excludes rolled-back blobs',
    async (t) => {
        const db = await openLocalDb('did:test:ic-eviction-accounting')
        try {
            seedFeed(db)

            const puts:string[] = []
            const deletes:string[] = []
            const storage:Pick<CacheStorage, 'open'> = {
                open: async (_name:string) => ({
                    put: async (url:string, _res:Response) => {
                        puts.push(url)
                    },
                    match: async (_url:string) => undefined,
                    delete: async (url:string) => {
                        deletes.push(url)
                        return true
                    },
                    keys: async () => [],
                    addAll: async () => undefined,
                    add: async () => undefined
                } as unknown as Cache)
            }

            // Make fetch succeed
            const fetchFn:typeof fetch = async (_url) => {
                const buf = new Uint8Array(500).buffer
                return new Response(buf, {
                    status: 200,
                    headers: { 'Content-Type': 'image/jpeg' }
                })
            }

            // Mock DB to fail on the second recordCachedImage call
            const originalExec = db.exec
            let recordCachedImageCalls = 0
            db.exec = function(...args:unknown[]) {
                const arg = args[0]
                if (typeof arg === 'object' && arg !== null) {
                    const obj = arg as Record<string, unknown>
                    if (typeof obj.sql === 'string' &&
                        obj.sql.includes('INSERT OR IGNORE INTO cached_images')) {
                        recordCachedImageCalls++
                        if (recordCachedImageCalls === 2) {
                            throw new Error('SQLITE_FULL')
                        }
                    }
                }
                return originalExec.call(this, ...args)
            }

            // First image succeeds
            await cacheItemImages(
                db,
                {
                    id: 1,
                    feed_id: 1,
                    content: '<img src="https://example.com/ok.jpg">',
                    description: null
                },
                { cache_mode: 'text_images' },
                fetchFn,
                storage
            )

            // Second image fails
            await cacheItemImages(
                db,
                {
                    id: 2,
                    feed_id: 1,
                    content: '<img src="https://example.com/fail.jpg">',
                    description: null
                },
                { cache_mode: 'text_images' },
                fetchFn,
                storage
            )

            // Check eviction accounting
            const totalBytes = await sumTotal(db)
            const feedBytes = await sumByFeed(db, 1)

            t.equal(puts.length, 2,
                'two images were put in Cache Storage')
            t.equal(deletes.length, 1,
                'one image was rolled back')
            t.equal(totalBytes, 500,
                'total accounting is 500 (only the successful image)')
            t.equal(feedBytes, 500,
                'feed accounting is 500 (only the successful image)')
            t.ok(totalBytes > 0,
                'eviction accounting correctly excludes rolled-back blob')
        } finally {
            db.close()
        }
    }
)
