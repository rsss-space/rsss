import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import { fakeResult } from './helpers/sql-fake.js'
import {
    generateDPoPKeyPair,
    type OAuthCredentialRecord
} from '../src/server/auth/oauth.js'

interface FeedRow {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_pulled_at:string|null
    last_error:string|null
    last_status:number|null
    published:number
    published_rkey:string|null
    published_at:string|null
    publish_error:string|null
    created_at:string
    updated_at:string
}

interface ItemRow {
    id:number
    feed_id:number
    guid:string
    title:string|null
    link:string|null
    description:string|null
    content:string|null
    author:string|null
    pub_date:string|null
    thumbnail_url:string|null
    og_image_url:string|null
    blurhash:string|null
    image_width:number|null
    image_height:number|null
    is_read:number
    is_starred:number
    created_at:string
    updated_at:string
    full_content:string|null
    full_content_fetched_at:string|null
    full_content_status:string|null
    feed_title:string|null
}

function feedRow (id:number, url:string, title:string|null):FeedRow {
    return {
        id,
        url,
        title,
        description: null,
        site_url: null,
        last_fetched: null,
        last_pulled_at: null,
        last_error: null,
        last_status: null,
        published: 0,
        published_rkey: null,
        published_at: null,
        publish_error: null,
        created_at: '2026-04-26 00:00:00',
        updated_at: '2026-04-26 00:00:00'
    }
}

function itemRow (
    id:number,
    feedId:number,
    title:string,
    pubDate:string
):ItemRow {
    return {
        id,
        feed_id: feedId,
        guid: `guid-${id}`,
        title,
        link: `https://example.com/items/${id}`,
        description: null,
        content: null,
        author: null,
        pub_date: pubDate,
        thumbnail_url: null,
        og_image_url: `https://example.com/images/${id}.jpg`,
        blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        image_width: 1200,
        image_height: 630,
        is_read: 0,
        is_starred: 0,
        created_at: '2026-04-26 00:00:00',
        updated_at: '2026-04-26 00:00:00',
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null,
        feed_title: feedId === 1 ? 'Bravo' : 'Alpha'
    }
}

interface PendingCountRow {
    id:number|string
    pending_count:number|string|null
}

function createSql (options:{
    feeds?:FeedRow[]
    feedVersion?:number
    items?:ItemRow[]
    pendingCountRows?:PendingCountRow[]
} = {}) {
    const feeds:FeedRow[] = options.feeds ?? [
        feedRow(1, 'https://bravo.example/feed.xml', 'Bravo'),
        feedRow(2, 'https://alpha.example/feed.xml', 'Alpha')
    ]
    const items:ItemRow[] = options.items ?? [
        itemRow(3, 1, 'Later item', '2026-04-27 00:00:00'),
        itemRow(2, 2, 'Earlier item', '2026-04-26 00:00:00')
    ]
    const feedVersion = options.feedVersion ?? 0
    let pendingCountRows:PendingCountRow[]|null =
        options.pendingCountRows ?? null

    return {
        feeds,
        calls: [] as string[],
        itemQueries: [] as string[],
        feedSyncQueries: [] as string[],
        blurhashUpdates: [] as unknown[][],
        publishUpdates: [] as unknown[][],
        unpublishUpdates: [] as unknown[][],
        feedVersionBumps: 0,
        setPendingCountRows (rows:PendingCountRow[]) {
            pendingCountRows = rows
        },
        exec (query:string, ...params:unknown[]) {
            if (query.includes('SELECT feed_version FROM user_state')) {
                this.calls.push('version')
                return fakeResult([{ feed_version: feedVersion }])
            }

            if (
                query.includes('FROM items') &&
                query.includes('JOIN feeds') &&
                query.includes('ORDER BY items.updated_at ASC')
            ) {
                return fakeResult(items)
            }

            if (
                query.includes('FROM items') &&
                query.includes('JOIN feeds') &&
                query.includes('ORDER BY items.pub_date DESC')
            ) {
                this.calls.push('items')
                this.itemQueries.push(query)
                return fakeResult(items)
            }

            if (query.includes('SELECT * FROM feeds ORDER BY title ASC')) {
                return fakeResult([...feeds].sort((a, b) => {
                    return (a.title || '').localeCompare(b.title || '')
                }))
            }

            if (query.trim() === 'SELECT * FROM feeds') {
                return fakeResult(feeds)
            }

            if (
                query.includes('FROM feeds') &&
                query.includes('ORDER BY updated_at ASC, id ASC')
            ) {
                this.feedSyncQueries.push(query)
                return fakeResult(feeds)
            }

            if (query.includes('SELECT MAX(updated_at) as latest FROM feeds')) {
                return fakeResult([{ latest: feeds[0]?.updated_at ?? null }])
            }

            if (query.includes('SELECT MAX(updated_at) as latest FROM items')) {
                return fakeResult([{ latest: items[0]?.updated_at ?? null }])
            }

            if (query.includes('SELECT id FROM feeds WHERE url = ?')) {
                return fakeResult(feeds
                    .filter(feed => feed.url === params[0])
                    .map(feed => ({ id: feed.id })))
            }

            if (query.includes('INSERT INTO feeds (url) VALUES (?)')) {
                const url = params[0] as string
                feeds.push(feedRow(feeds.length + 1, url, null))
                return fakeResult([])
            }

            if (query.includes('SELECT * FROM feeds WHERE url = ?')) {
                return fakeResult(feeds.filter(feed => feed.url === params[0]))
            }

            if (query.includes('SELECT * FROM feeds WHERE id = ?')) {
                return fakeResult(feeds.filter(feed => feed.id === params[0]))
            }

            // POST /feeds unread count query
            if (query.includes('SELECT COUNT(*) as unread FROM items') &&
                query.includes('WHERE feed_id = ?') &&
                query.includes('AND is_read = 0')) {
                return fakeResult([{ unread: 0 }])
            }

            // /feeds/:id/refresh selects with FEED_SYNC_COLUMNS for the
            // post-refresh response; the harness returns the same row
            // shape since it doesn't model per-column projection.
            if (
                query.includes('SELECT') &&
                query.includes('FROM feeds WHERE id = ?')
            ) {
                return fakeResult(feeds.filter(feed => feed.id === params[0]))
            }

            if (query.includes('DELETE FROM feeds WHERE id = ?')) {
                const index = feeds.findIndex(feed => feed.id === params[0])
                if (index >= 0) feeds.splice(index, 1)
                return fakeResult([])
            }

            if (query.includes('UPDATE items SET') &&
                query.includes('blurhash = ?')) {
                this.blurhashUpdates.push(params)
                return fakeResult([])
            }

            if (
                query.includes('UPDATE feeds SET') &&
                query.includes('published = 1')
            ) {
                this.publishUpdates.push(params)
                const feed = feeds.find(row => row.id === params[2])
                if (feed) {
                    feed.published = 1
                    feed.published_rkey = params[0] as string
                    feed.published_at = params[1] as string
                    feed.publish_error = null
                }
                return fakeResult([])
            }

            if (
                query.includes('UPDATE feeds SET') &&
                query.includes('publish_error = ?')
            ) {
                const feed = feeds.find(row => row.id === params[1])
                if (feed) {
                    feed.published = 0
                    feed.publish_error = params[0] as string
                }
                return fakeResult([])
            }

            if (
                query.includes('UPDATE feeds SET') &&
                query.includes('published = 0') &&
                query.includes('published_rkey = NULL')
            ) {
                this.unpublishUpdates.push(params)
                const feed = feeds.find(row => row.id === params[0])
                if (feed) {
                    feed.published = 0
                    feed.published_rkey = null
                    feed.published_at = null
                    feed.publish_error = null
                }
                return fakeResult([])
            }

            if (query.includes('UPDATE user_state SET feed_version')) {
                this.feedVersionBumps++
                return fakeResult([{ feed_version: this.feedVersionBumps }])
            }

            if (query.includes('pending_count')) {
                if (pendingCountRows !== null) {
                    return fakeResult(pendingCountRows)
                }
                return fakeResult(feeds.map(feed => ({
                    id: feed.id,
                    pending_count: 0
                })))
            }

            if (query.includes('last_pulled_at')) {
                return fakeResult([])
            }

            // /internal/lazy-html-data fans out into per-counts
            // queries. The harness doesn't model item counters, so
            // return a deterministic zero shape that satisfies the
            // .one()/.toArray() consumers.
            if (
                query.includes('SELECT COUNT(*) as count FROM items')
            ) {
                return fakeResult([{ count: 0 }])
            }
            if (
                query.includes(
                    'SELECT feed_id, COUNT(*) as unread FROM items'
                )
            ) {
                return fakeResult([])
            }

            // sweepStuckResolvingFeeds (018) probes still-resolving
            // rows; no-op for harnesses that don't model the queue.
            if (query.includes('UPDATE feeds SET')) {
                return fakeResult([])
            }
            if (
                query.includes('SELECT id FROM feeds') &&
                query.includes('last_status = 504')
            ) {
                return fakeResult([])
            }

            throw new Error(`Unexpected SQL: ${query}`)
        }
    }
}

async function makeCredentials ():Promise<OAuthCredentialRecord> {
    const keyPair = await generateDPoPKeyPair()
    const privateJwk = await crypto.subtle.exportKey(
        'jwk',
        keyPair.privateKey
    )

    return {
        did: 'did:plc:alice',
        accessToken: 'access-token-secret',
        refreshToken: 'refresh-token-secret',
        tokenEndpoint: 'https://auth.example/token',
        pdsEndpoint: 'https://pds.example',
        dpopPrivateKeyJwk: privateJwk,
        tokenType: 'DPoP',
        updatedAt: '2026-06-09T20:00:00.000Z'
    }
}

function createDoHarness (options:{
    feeds?:FeedRow[]
    feedVersion?:number
    items?:ItemRow[]
    pendingCountRows?:PendingCountRow[]
} = {}) {
    const sql = createSql(options)
    const refreshed:number[] = []
    const waitUntilPromises:Promise<unknown>[] = []
    const storage = new Map<string, unknown>()
    let alarmAt:number|null = null
    const refreshFeedBatchesCalls:number[] = []
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createSql>
        ctx:{
            storage:{
                get:<T>(key:string)=> Promise<T|undefined>
                put:(key:string, value:unknown)=> Promise<void>
                delete:(key:string)=> Promise<void>
                getAlarm:()=> Promise<number|null>
                setAlarm:(at:number)=> Promise<void>
                deleteAlarm:()=> Promise<void>
            }
            waitUntil:(promise:Promise<unknown>)=> void
            getWebSockets:()=> Array<{ send:(msg:string)=> void }>
        }
        fetchFeed:(feed:FeedRow)=> Promise<void>
        refreshFeedBatches:()=> Promise<void>
        createRouter:()=> { request:(path:string, init?:RequestInit)=>
            Promise<Response> }
    }

    userDo.sql = sql
    userDo.ctx = {
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put (key:string, value:unknown) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            },
            async getAlarm () {
                return alarmAt
            },
            async setAlarm (at:number) {
                alarmAt = at
            },
            async deleteAlarm () {
                alarmAt = null
            }
        },
        waitUntil (promise) {
            waitUntilPromises.push(promise)
        },
        getWebSockets () {
            return []
        }
    }
    userDo.fetchFeed = async (feed) => {
        refreshed.push(feed.id)
    }
    userDo.refreshFeedBatches = async () => {
        refreshFeedBatchesCalls.push(Date.now())
    }

    return {
        app: userDo.createRouter(),
        sql,
        refreshed,
        storage,
        waitUntilPromises,
        refreshFeedBatchesCalls,
        userDo
    }
}

test('RsssUserDO feed handlers list create and refresh feeds', async t => {
    const {
        app,
        sql,
        refreshed,
        waitUntilPromises
    } = createDoHarness()

    const listResponse = await app.request('/feeds')
    const listBody = await listResponse.json() as { feeds:FeedRow[] }

    t.equal(listResponse.status, 200, 'list returns 200')
    t.deepEqual(
        listBody.feeds.map(feed => feed.title),
        ['Alpha', 'Bravo'],
        'feeds are listed alphabetically'
    )

    const createResponse = await app.request('/feeds', {
        method: 'POST',
        body: JSON.stringify({ url: 'https://charlie.example/feed.xml' })
    })
    const createBody = await createResponse.json() as { feed:FeedRow; unread?:number }

    t.equal(createResponse.status, 201, 'create returns 201')
    t.equal(
        createBody.feed.url,
        'https://charlie.example/feed.xml',
        'created feed is returned'
    )
    t.equal(sql.feeds.length, 3, 'feed row is inserted')
    t.equal(
        waitUntilPromises.length,
        2,
        'GET /feeds schedules publish-state reconcile and POST /feeds schedules fetchFeed in background'
    )

    await Promise.all(waitUntilPromises)

    const refreshResponse = await app.request('/feeds/3/refresh', {
        method: 'POST'
    })
    const refreshBody = await refreshResponse.json() as {
        feed:FeedRow | null
    }

    t.equal(refreshResponse.status, 200, 'refresh returns 200')
    t.ok(refreshBody.feed, 'refresh returns the refreshed feed row')
    t.deepEqual(refreshed, [3, 3], 'created feed is refreshed')
})

test('RsssUserDO internal blurhash handler writes image metadata', async t => {
    const { app, sql } = createDoHarness()

    const response = await app.request('/internal/blurhash/items/77', {
        method: 'POST',
        body: JSON.stringify({
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            image_width: 1200,
            image_height: 630
        })
    })

    t.equal(response.status, 204, 'internal update returns 204')
    t.deepEqual(sql.blurhashUpdates, [[
        'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
        1200,
        630,
        77
    ]], 'item row is updated with blurhash metadata')
    t.equal(sql.feedVersionBumps, 1, 'blurhash metadata bumps version')
})

test(
    'RsssUserDO internal feed-version endpoint returns current version',
    async t => {
        const { app, sql } = createDoHarness({ feedVersion: 42 })

        const response = await app.request('/internal/feed-version')
        const body = response.status === 200 ?
            await response.json() as { version:number } :
            { version: -1 }

        t.equal(response.status, 200, 'internal feed version returns 200')
        t.equal(body.version, 42, 'current feed version is returned')
        t.deepEqual(sql.calls, ['version'], 'endpoint only reads feed version')
    }
)

test(
    'RsssUserDO internal lazy-html-data returns version and first page',
    async t => {
        const { app, sql } = createDoHarness({ feedVersion: 12 })

        const response = await app.request('/internal/lazy-html-data')
        const body = response.status === 200 ?
            await response.json() as {
                version:number
                items:ItemRow[]
            } :
            {
                version: -1,
                items: []
            }

        t.equal(response.status, 200, 'lazy HTML data returns 200')
        t.equal(body.version, 12, 'response includes the current version')
        t.deepEqual(
            body.items.map(item => item.title),
            ['Later item', 'Earlier item'],
            'response includes first-page items'
        )
        t.deepEqual(
            sql.calls,
            ['version', 'items'],
            'version is read before querying items'
        )
        t.equal(sql.itemQueries.length, 1, 'items are read once')
        const query = sql.itemQueries[0] ?? ''
        t.ok(
            query.includes('items.og_image_url') &&
                query.includes('items.blurhash') &&
                query.includes('items.image_width') &&
                query.includes('items.image_height'),
            'query selects image metadata columns'
        )
        t.ok(
            query.includes('feeds.title AS feed_title'),
            'query selects joined feed title'
        )
        t.ok(
            query.includes(
                'FROM items JOIN feeds ON items.feed_id = feeds.id'
            ),
            'query uses the same feed join shape as item listing'
        )
        t.ok(
            query.includes('ORDER BY items.pub_date DESC, items.id DESC'),
            'query uses deterministic lazy-html ordering'
        )
        t.ok(query.includes('LIMIT 50'), 'query limits to first page')
    }
)

test('RsssUserDO sync projects feed publish state columns', async t => {
    const { app, sql } = createDoHarness({
        feeds: [{
            ...feedRow(9, 'https://published.example/feed.xml', 'Shared'),
            published: 1,
            published_rkey: 'feed.abc123',
            published_at: '2026-06-09 13:00:00',
            publish_error: null
        }],
        items: []
    })

    const response = await app.request('/sync')
    const body = await response.json() as { feeds:FeedRow[] }

    t.equal(response.status, 200, 'sync returns 200')
    t.equal(
        body.feeds[0]?.published,
        1,
        'published state is included in sync payload'
    )
    t.equal(
        body.feeds[0]?.published_rkey,
        'feed.abc123',
        'published rkey is included in sync payload'
    )
    const query = sql.feedSyncQueries[0] ?? ''
    t.ok(query.includes('published'), 'sync selects published')
    t.ok(query.includes('published_rkey'), 'sync selects published_rkey')
    t.ok(query.includes('published_at'), 'sync selects published_at')
    t.ok(query.includes('publish_error'), 'sync selects publish_error')
})

test('RsssUserDO publish feed writes subscription record and stores state',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness({
            feeds: [{
                ...feedRow(1, 'https://example.com/feed.xml', 'Example'),
                site_url: 'https://example.com/'
            }]
        })
        storage.set('oauth:credentials', credentials)

        const calls:Array<{ url:string; body:Record<string, unknown> }> = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input, init) => {
            calls.push({
                url: String(input),
                body: JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >
            })
            return new Response(JSON.stringify({
                uri: 'at://did:plc:alice/space.rsss.feed.subscription/x'
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const response = await app.request('/feeds/1/publish', {
                method: 'POST'
            })
            const body = response.status === 200 ?
                await response.json() as { feed:FeedRow } :
                { feed: null }

            t.equal(response.status, 200, 'publish succeeds')
            t.equal(calls.length, 1, 'one PDS write')
            t.equal(
                calls[0]?.url,
                'https://pds.example/xrpc/com.atproto.repo.putRecord'
            )
            t.equal(
                calls[0]?.body.collection,
                'space.rsss.feed.subscription'
            )
            t.equal(typeof calls[0]?.body.rkey, 'string')
            const record = calls[0]?.body.record as Record<string, unknown>
            t.equal(record.feedUrl, 'https://example.com/feed.xml')
            t.equal(record.title, 'Example')
            t.equal(record.siteUrl, 'https://example.com/')
            t.equal(typeof record.createdAt, 'string')
            t.equal(record.createdAt, body.feed?.published_at)
            t.deepEqual({
                feedUrl: record.feedUrl,
                title: record.title,
                siteUrl: record.siteUrl
            }, {
                feedUrl: 'https://example.com/feed.xml',
                title: 'Example',
                siteUrl: 'https://example.com/'
            })
            t.equal(body.feed?.published, 1, 'returned feed is published')
            t.equal(
                body.feed?.published_rkey,
                calls[0]?.body.rkey,
                'returned feed includes deterministic rkey'
            )
            t.equal(sql.publishUpdates.length, 1, 'publish state updated')
            t.equal(sql.feedVersionBumps, 1, 'feed version bumped')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO publish feed reuses rkey on republish', async t => {
    const credentials = await makeCredentials()
    const { app, storage } = createDoHarness({
        feeds: [{
            ...feedRow(1, 'https://example.com/feed.xml', 'Example'),
            published: 1,
            published_rkey: 'feed.existing',
            published_at: '2026-06-09T20:00:00.000Z'
        }]
    })
    storage.set('oauth:credentials', credentials)

    const bodies:Record<string, unknown>[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
        bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
        return new Response('{}', {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    }) as typeof fetch

    try {
        const response = await app.request('/feeds/1/publish', {
            method: 'POST'
        })

        t.equal(response.status, 200, 'republish succeeds')
        t.equal(
            bodies[0]?.rkey,
            'feed.existing',
            'republish updates in place with existing rkey'
        )
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('RsssUserDO publish feed requires stored OAuth credentials', async t => {
    const { app, sql } = createDoHarness()

    const response = await app.request('/feeds/1/publish', {
        method: 'POST'
    })

    t.equal(response.status, 401, 'missing credentials require reconnect')
    t.equal(sql.publishUpdates.length, 0, 'publish state is unchanged')
})

test('RsssUserDO publish feed leaves state unpublished on PDS auth failure',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness()
        storage.set('oauth:credentials', credentials)

        const originalFetch = globalThis.fetch
        const originalError = console.error
        globalThis.fetch = (async () => {
            return new Response(JSON.stringify({ error: 'invalid_grant' }), {
                status: 401,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch
        console.error = () => undefined

        try {
            const response = await app.request('/feeds/1/publish', {
                method: 'POST'
            })
            const body = response.headers.get('content-type')
                ?.includes('application/json') ?
                await response.json() as { error:string } :
                { error: '' }

            t.equal(response.status, 401, 'auth failure maps to reconnect')
            t.equal(body.error, 'reauth_required')
            t.equal(sql.publishUpdates.length, 0, 'state is not published')
            t.equal(sql.feeds[0]?.published, 0, 'feed remains unpublished')
        } finally {
            globalThis.fetch = originalFetch
            console.error = originalError
        }
    })

test('RsssUserDO unpublish feed deletes record and clears publish state',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness({
            feeds: [{
                ...feedRow(1, 'https://example.com/feed.xml', 'Example'),
                published: 1,
                published_rkey: 'feed.existing',
                published_at: '2026-06-09T20:00:00.000Z'
            }]
        })
        storage.set('oauth:credentials', credentials)

        const calls:Array<{ url:string; body:Record<string, unknown> }> = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input, init) => {
            calls.push({
                url: String(input),
                body: JSON.parse(String(init?.body)) as Record<
                    string,
                    unknown
                >
            })
            return new Response('{}', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const response = await app.request('/feeds/1/publish', {
                method: 'DELETE'
            })
            const body = response.status === 200 ?
                await response.json() as { feed:FeedRow } :
                { feed: null }

            t.equal(response.status, 200, 'unpublish succeeds')
            t.equal(
                calls[0]?.url,
                'https://pds.example/xrpc/com.atproto.repo.deleteRecord'
            )
            t.deepEqual(calls[0]?.body, {
                repo: credentials.did,
                collection: 'space.rsss.feed.subscription',
                rkey: 'feed.existing'
            })
            t.equal(body.feed?.published, 0, 'returned feed is unpublished')
            t.equal(
                body.feed?.published_rkey,
                null,
                'returned feed clears rkey'
            )
            t.equal(
                sql.unpublishUpdates.length,
                1,
                'publish state is cleared'
            )
            t.equal(sql.feedVersionBumps, 1, 'feed version bumped')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO unpublish missing remote record is idempotent',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness({
            feeds: [{
                ...feedRow(1, 'https://example.com/feed.xml', 'Example'),
                published: 1,
                published_rkey: 'feed.existing',
                published_at: '2026-06-09T20:00:00.000Z'
            }]
        })
        storage.set('oauth:credentials', credentials)

        const originalFetch = globalThis.fetch
        const originalError = console.error
        globalThis.fetch = (async () => {
            return new Response(JSON.stringify({
                error: 'RecordNotFound'
            }), {
                status: 400,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch
        console.error = () => undefined

        try {
            const response = await app.request('/feeds/1/publish', {
                method: 'DELETE'
            })
            const body = response.status === 200 ?
                await response.json() as { feed:FeedRow } :
                { feed: null }

            t.equal(response.status, 200, 'missing PDS record is success')
            t.equal(body.feed?.published, 0, 'local publish state clears')
            t.equal(sql.unpublishUpdates.length, 1, 'state is cleared once')
        } finally {
            globalThis.fetch = originalFetch
            console.error = originalError
        }
    })

test('RsssUserDO POST /feeds/:id/publish returns 404 for missing feed id',
    async t => {
        const { app } = createDoHarness({
            feeds: []
        })

        const response = await app.request('/feeds/999/publish', {
            method: 'POST'
        })

        t.equal(
            response.status,
            404,
            'missing feed id returns 404 (AC1.4: zero-row queries ' +
            'return null, not 500)'
        )
    })

test('RsssUserDO reconcile publish state from repo records',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness({
            feeds: [
                feedRow(1, 'https://example.com/feed.xml', 'Example'),
                {
                    ...feedRow(2, 'https://missing.example/feed.xml',
                        'Missing'),
                    published: 1,
                    published_rkey: 'feed.missing',
                    published_at: '2026-06-09T20:00:00.000Z'
                }
            ]
        })
        storage.set('oauth:credentials', credentials)

        const calls:string[] = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input) => {
            calls.push(String(input))
            return new Response(JSON.stringify({
                records: [{
                    uri: 'at://did:plc:alice/' +
                        'space.rsss.feed.subscription/feed.remote',
                    cid: 'bafyremote',
                    value: {
                        feedUrl: 'https://example.com/feed.xml',
                        title: 'Example',
                        createdAt: '2026-06-10T21:00:00.000Z'
                    }
                }]
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const response = await app.request(
                '/feeds/reconcile-published',
                { method: 'POST' }
            )
            const body = response.status === 200 ?
                await response.json() as { changed:number } :
                { changed: -1 }

            t.equal(response.status, 200, 'reconcile succeeds')
            t.equal(body.changed, 2, 'two drifting rows are corrected')
            t.equal(calls.length, 1, 'one public listRecords request')
            t.ok(
                calls[0]?.includes(
                    '/xrpc/com.atproto.repo.listRecords?'
                ),
                'reads public listRecords from the PDS'
            )
            t.ok(
                calls[0]?.includes(
                    'collection=space.rsss.feed.subscription'
                ),
                'lists rsss subscription records'
            )
            t.equal(sql.feeds[0]?.published, 1, 'remote record publishes')
            t.equal(
                sql.feeds[0]?.published_rkey,
                'feed.remote',
                'remote rkey is stored'
            )
            t.equal(
                sql.feeds[1]?.published,
                0,
                'missing remote record unpublishes local state'
            )
            t.equal(sql.feedVersionBumps, 1, 'version bumps once')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO reconcile publish state is rate limited',
    async t => {
        const credentials = await makeCredentials()
        const { app, storage } = createDoHarness()
        storage.set('oauth:credentials', credentials)

        let calls = 0
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => {
            calls += 1
            return new Response(JSON.stringify({ records: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const first = await app.request('/feeds/reconcile-published', {
                method: 'POST'
            })
            const second = await app.request('/feeds/reconcile-published', {
                method: 'POST'
            })
            const body = second.status === 200 ?
                await second.json() as { skipped?:string } :
                {}

            t.equal(first.status, 200, 'first reconcile succeeds')
            t.equal(second.status, 200, 'second reconcile is not an error')
            t.equal(body.skipped, 'rate_limited', 'second call is skipped')
            t.equal(calls, 1, 'second call does not hit listRecords')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO reconcile missing credentials does not consume rate limit',
    async t => {
        const credentials = await makeCredentials()
        const { app, storage } = createDoHarness()

        const missing = await app.request('/feeds/reconcile-published', {
            method: 'POST'
        })
        const missingBody = missing.status === 200 ?
            await missing.json() as { skipped?:string } :
            {}

        storage.set('oauth:credentials', credentials)

        let calls = 0
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => {
            calls += 1
            return new Response(JSON.stringify({ records: [] }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const response = await app.request(
                '/feeds/reconcile-published',
                { method: 'POST' }
            )

            t.equal(missing.status, 200, 'missing credentials is not fatal')
            t.equal(
                missingBody.skipped,
                'missing_credentials',
                'missing credentials is reported as skipped'
            )
            t.equal(response.status, 200, 'later credentialed call runs')
            t.equal(calls, 1, 'credentialed call reaches listRecords')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO delete feed removes published record before unsubscribe',
    async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createDoHarness({
            feeds: [{
                ...feedRow(1, 'https://example.com/feed.xml', 'Example'),
                published: 1,
                published_rkey: 'feed.existing',
                published_at: '2026-06-09T20:00:00.000Z'
            }]
        })
        storage.set('oauth:credentials', credentials)

        const calls:Record<string, unknown>[] = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (_input, init) => {
            calls.push(JSON.parse(String(init?.body)) as Record<
                string,
                unknown
            >)
            return new Response('{}', {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        try {
            const response = await app.request('/feeds/1', {
                method: 'DELETE'
            })
            const body = await response.json() as { success:boolean }

            t.equal(response.status, 200, 'unsubscribe succeeds')
            t.equal(body.success, true, 'unsubscribe response is unchanged')
            t.deepEqual(calls[0], {
                repo: credentials.did,
                collection: 'space.rsss.feed.subscription',
                rkey: 'feed.existing'
            })
            t.equal(sql.feeds.length, 0, 'feed row is deleted')
            t.equal(sql.unpublishUpdates.length, 1, 'publish state clears')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('RsssUserDO manual feed refresh is rate limited per feed', async t => {
    const { app, refreshed, storage } = createDoHarness()
    const responses = await Promise.all(Array.from({ length: 100 }, () => {
        return app.request('/feeds/1/refresh', { method: 'POST' })
    }))
    const body = await responses[0].json() as { feed:FeedRow | null }

    t.equal(responses[0].status, 200, 'first refresh returns 200')
    t.ok(body.feed, 'first refresh returns the refreshed feed row')
    t.equal(refreshed.length, 1, 'rapid refreshes fetch the feed once')
    t.equal(refreshed[0], 1, 'the requested feed is refreshed')
    t.equal(storage.size, 1, 'manual refresh timestamp is stored')
})

test(
    'RsssUserDO add feed treats client_op_id duplicate URL as idempotent',
    async t => {
        const { app, sql, waitUntilPromises } = createDoHarness()

        const response = await app.request('/feeds', {
            method: 'POST',
            body: JSON.stringify({
                url: 'https://alpha.example/feed.xml',
                client_op_id: 'op-duplicate-alpha',
                client_updated_at: '2026-04-25 00:00:00'
            })
        })
        const body = await response.json() as { feed:FeedRow }

        t.equal(response.status, 200, 'duplicate outbox retry is success')
        t.equal(body.feed.id, 2, 'authoritative feed is returned')
        t.equal(body.feed.url, 'https://alpha.example/feed.xml', 'URL matches')
        t.equal(sql.feeds.length, 2, 'no duplicate feed row is inserted')
        t.equal(waitUntilPromises.length, 0, 'no refresh is scheduled')
    }
)

test('RsssUserDO add feed deduplicates canonical URL variants', async t => {
    const { app, sql, waitUntilPromises } = createDoHarness()

    const createResponse = await app.request('/feeds', {
        method: 'POST',
        body: JSON.stringify({
            url: 'https://Example.COM/feed/'
        })
    })
    const createBody = await createResponse.json() as { feed:FeedRow }

    const duplicateResponse = await app.request('/feeds', {
        method: 'POST',
        body: JSON.stringify({
            url: 'https://example.com/feed'
        })
    })

    t.equal(createResponse.status, 201, 'variant creates the feed')
    t.equal(
        createBody.feed.url,
        'https://example.com/feed',
        'created feed stores canonical URL'
    )
    t.equal(duplicateResponse.status, 409, 'canonical duplicate conflicts')
    t.equal(sql.feeds.length, 3, 'no duplicate feed row is inserted')
    // With fast mock fetchFeed, the fast path completes without waitUntil
    // Only the duplicate (error path) and success path could use waitUntil
    t.ok(
        waitUntilPromises.length <= 1,
        'at most one refresh is scheduled (for successful POST)'
    )
})

test(
    'RsssUserDO delete feed treats client_op_id missing row as idempotent',
    async t => {
        const { app, sql } = createDoHarness()

        const response = await app.request('/feeds/99', {
            method: 'DELETE',
            body: JSON.stringify({
                client_op_id: 'op-delete-missing',
                client_updated_at: '2026-04-25 00:00:00'
            })
        })
        const body = await response.json() as { success:boolean }

        t.equal(response.status, 200, 'missing deleted row is success')
        t.equal(body.success, true, 'response matches delete success shape')
        t.equal(sql.feeds.length, 2, 'no feed rows are changed')
    }
)

test(
    'GET /feed-status returns empty counts when no feeds are pending',
    async t => {
        const { app } = createDoHarness({
            feeds: [],
            pendingCountRows: []
        })

        const response = await app.request('/feed-status')
        const body = await response.json() as {
            feedUpdateCounts:Record<string, number>
            totalPending:number
        }

        t.equal(response.status, 200, 'returns 200')
        t.deepEqual(
            body.feedUpdateCounts,
            {},
            'feedUpdateCounts is an empty object'
        )
        t.equal(body.totalPending, 0, 'totalPending is 0')
    }
)

test('GET /feed-status returns mixed pending counts', async t => {
    const { app } = createDoHarness({
        pendingCountRows: [
            { id: 1, pending_count: 3 },
            { id: 2, pending_count: 0 },
            { id: 5, pending_count: 7 }
        ]
    })

    const response = await app.request('/feed-status')
    const body = await response.json() as {
        feedUpdateCounts:Record<string, number>
        totalPending:number
    }

    t.equal(response.status, 200, 'returns 200')
    t.deepEqual(
        body.feedUpdateCounts,
        { 1: 3, 2: 0, 5: 7 },
        'feedUpdateCounts contains stringified ids and integer counts'
    )
    t.equal(body.totalPending, 10, 'totalPending sums values across feeds')
})

test('GET /feed-status returns zeros when fully synced', async t => {
    const { app } = createDoHarness({
        pendingCountRows: [
            { id: 1, pending_count: 0 },
            { id: 2, pending_count: 0 }
        ]
    })

    const response = await app.request('/feed-status')
    const body = await response.json() as {
        feedUpdateCounts:Record<string, number>
        totalPending:number
    }

    t.equal(response.status, 200, 'returns 200')
    t.deepEqual(
        body.feedUpdateCounts,
        { 1: 0, 2: 0 },
        'each subscribed feed reported as 0 pending'
    )
    t.equal(body.totalPending, 0, 'totalPending sums to 0')
})

test(
    'GET /feed-status triggers catch-up when returning after long absence',
    async t => {
        const {
            app,
            storage,
            refreshFeedBatchesCalls
        } = createDoHarness()
        const now = Date.now()
        // Seed last_active_at to 31 days ago.
        storage.set('poll:account:last_active_at', {
            lastActiveAt: now - 31 * 24 * 60 * 60 * 1000
        })

        const response = await app.request('/feed-status')

        t.equal(response.status, 200, 'returns 200')
        t.equal(
            refreshFeedBatchesCalls.length,
            1,
            'exactly one refreshFeedBatches call is queued via waitUntil'
        )
        const updated = storage.get('poll:account:last_active_at') as {
            lastActiveAt:number
        }
        t.ok(
            updated.lastActiveAt >= now,
            'last_active_at is advanced to current time'
        )
    }
)

test(
    'GET /feed-status does NOT trigger catch-up at steady state',
    async t => {
        const {
            app,
            storage,
            refreshFeedBatchesCalls
        } = createDoHarness()
        const now = Date.now()
        // Seed both markers as recent.
        storage.set('poll:account:last_active_at', {
            lastActiveAt: now - 30_000
        })
        storage.set('poll:account:last_any_success_at', {
            lastAnySuccessAt: now - 30_000
        })

        const response = await app.request('/feed-status')

        t.equal(response.status, 200, 'returns 200')
        t.equal(
            refreshFeedBatchesCalls.length,
            0,
            'steady-state hits do NOT trigger catch-up'
        )
    }
)

test(
    'GET /feed-status advances last_active_at subject to 60s coalescing',
    async t => {
        const { app, storage } = createDoHarness({
            pendingCountRows: []
        })
        const now = Date.now()
        // First request — no prior marker. Triggers catch-up but
        // also writes the marker.
        await app.request('/feed-status')
        const first = storage.get('poll:account:last_active_at') as {
            lastActiveAt:number
        }
        t.ok(
            first && first.lastActiveAt >= now,
            'first call seeds last_active_at'
        )

        // Second request — within 60s coalescing window. Should be
        // skipped (storage value unchanged).
        const seededAt = first.lastActiveAt
        await app.request('/feed-status')
        const second = storage.get('poll:account:last_active_at') as {
            lastActiveAt:number
        }
        t.equal(
            second.lastActiveAt,
            seededAt,
            'within-60s call does NOT advance the marker'
        )
    }
)

test('RsssUserDO delete feed clamps future client timestamps', async t => {
    const { app, sql } = createDoHarness()
    const originalWarn = console.warn
    const warnings:unknown[][] = []
    console.warn = (...args:unknown[]) => {
        warnings.push(args)
    }
    sql.feeds[0].updated_at = '9999-12-31T23:59:58'

    try {
        const response = await app.request('/feeds/1', {
            method: 'DELETE',
            body: JSON.stringify({
                client_updated_at: '9999-12-31T23:59:59'
            })
        })
        const body = await response.json() as { feed:FeedRow }

        t.equal(response.status, 409, 'clamped write is rejected')
        t.equal(body.feed.id, 1, 'authoritative feed is returned')
        t.equal(sql.feeds.length, 2, 'feed row is not deleted')
        t.equal(warnings.length, 1, 'clamp event is logged')
    } finally {
        console.warn = originalWarn
    }
})

test('RsssUserDO broadcast sends JSON envelope to every live socket', async t => {
    const sent:Array<{ socket:number; payload:string }> = []
    const makeSocket = (n:number) => ({
        send: (payload:string) => sent.push({ socket: n, payload })
    })
    const sockets = [makeSocket(1), makeSocket(2)]

    const userDo = Object.create(RsssUserDO.prototype) as {
        ctx:{ getWebSockets:()=> unknown[] }
        broadcast:(event:string, data:unknown)=> void
    }
    userDo.ctx = { getWebSockets: () => sockets }

    userDo.broadcast('feed-updated', { feedId: 7 })

    t.equal(sent.length, 2, 'every live socket receives the message')
    t.deepEqual(
        sent.map(s => s.socket),
        [1, 2],
        'broadcast enumerates ctx.getWebSockets(), not an in-memory set'
    )
    t.equal(
        sent[0]!.payload,
        JSON.stringify({ event: 'feed-updated', data: { feedId: 7 } }),
        'payload is a JSON envelope of { event, data }'
    )
})

test('RsssUserDO broadcast drops a failing socket and keeps going', async t => {
    const delivered:number[] = []
    const sockets = [
        { send: () => { throw new Error('socket gone') } },
        { send: () => delivered.push(2) }
    ]
    const userDo = Object.create(RsssUserDO.prototype) as {
        ctx:{ getWebSockets:()=> unknown[] }
        broadcast:(event:string, data:unknown)=> void
    }
    userDo.ctx = { getWebSockets: () => sockets }

    userDo.broadcast('feed-updated', { feedId: 1 })

    t.deepEqual(delivered, [2], 'a throwing socket does not abort the loop')
})
