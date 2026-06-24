import { test } from '@substrate-system/tapzero'
import { fakeResult } from './helpers/sql-fake.js'
import { RsssUserDO } from '../src/server/durable-objects/index.js'

interface FeedRow {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    created_at:string
    updated_at:string
}

function createFeedSql () {
    const feeds:FeedRow[] = []

    return {
        feeds,
        exec (query:string, ...params:unknown[]) {
            if (query.includes('SELECT id FROM feeds WHERE url = ?')) {
                return fakeResult(feeds
                    .filter(feed => feed.url === params[0])
                    .map(feed => ({ id: feed.id })))
            }

            if (query.includes('INSERT INTO feeds (url) VALUES (?)')) {
                const url = params[0] as string
                feeds.push({
                    id: feeds.length + 1,
                    url,
                    title: null,
                    description: null,
                    site_url: null,
                    last_fetched: null,
                    created_at: '2026-04-26 00:00:00',
                    updated_at: '2026-04-26 00:00:00'
                })
                return fakeResult([])
            }

            if (query.includes('SELECT * FROM feeds WHERE url = ?')) {
                return fakeResult(feeds.filter(feed => feed.url === params[0]))
            }

            if (query.includes('SELECT * FROM feeds WHERE id = ?')) {
                return fakeResult(feeds)
            }

            if (query.includes('SELECT COUNT(*) as count')) {
                return fakeResult([{ count: 0 }])
            }

            // POST /feeds unread count query
            if (query.includes('SELECT COUNT(*) as unread FROM items') &&
                query.includes('WHERE feed_id = ?') &&
                query.includes('AND is_read = 0')) {
                return fakeResult([{ unread: 0 }])
            }

            throw new Error(`Unexpected SQL: ${query}`)
        }
    }
}

function createStorageStub () {
    let alarm:number|null = null
    return {
        getAlarm: async () => alarm,
        setAlarm: async (when:number) => { alarm = when },
        deleteAlarm: async () => { alarm = null }
    }
}

function createRouterForPostFeeds (
    waitUntil:(promise:Promise<unknown>) => void,
    fetchFeed:(feed:FeedRow) => Promise<void>
) {
    const sql = createFeedSql()
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createFeedSql>
        ctx:{
            waitUntil:(promise:Promise<unknown>) => void
            storage:ReturnType<typeof createStorageStub>
        }
        fetchFeed:(feed:FeedRow) => Promise<void>
        createRouter:() => { request:(path:string, init:RequestInit) =>
            Promise<Response> }
    }

    userDo.sql = sql
    userDo.ctx = { waitUntil, storage: createStorageStub() }
    userDo.fetchFeed = fetchFeed

    return {
        app: userDo.createRouter(),
        sql
    }
}

test('POST /feeds non-blocking: always responds with 201 bare row without awaiting fetchFeed', async t => {
    let waitUntilCalled = false
    let fetchStarted = false
    const { app, sql } = createRouterForPostFeeds(
        () => {
            waitUntilCalled = true
        },
        async () => {
            fetchStarted = true
            // Fast fetch resolves immediately
        }
    )

    const response = await app.request('/feeds', {
        method: 'POST',
        body: JSON.stringify({
            url: 'https://example.com/feed.xml'
        })
    })

    t.equal(response.status, 201, 'feed create returns 201')
    t.equal(fetchStarted, true, 'fetch was started')
    t.equal(waitUntilCalled, true, 'fetch is always pushed to waitUntil')
    t.equal(sql.feeds.length, 1, 'feed row is inserted')

    const body = await response.json() as { feed:FeedRow; unread?:number }
    t.equal(body.feed.url, 'https://example.com/feed.xml')
    t.equal(body.unread, 0, 'response includes unread count')
    // bare row: last_fetched is null (fetch hasn't completed yet)
    t.equal(body.feed.last_fetched, null, 'response is the bare inserted row')
})

test('POST /feeds non-blocking: slow fetchFeed does not delay response', async t => {
    let resolveSlowFetch!:() => void
    const slowFetch = new Promise<void>((resolve) => {
        resolveSlowFetch = resolve
    })

    const { app } = createRouterForPostFeeds(
        () => {},
        () => slowFetch
    )

    const startTime = Date.now()
    const response = await app.request('/feeds', {
        method: 'POST',
        body: JSON.stringify({
            url: 'https://slow.example.com/feed.xml'
        })
    })
    const elapsed = Date.now() - startTime

    t.equal(response.status, 201, 'returns 201 before fetch completes')
    t.ok(
        elapsed < 500,
        `response time is independent of fetch latency (actual: ${elapsed}ms)`
    )

    // Resolve the slow fetch so the promise doesn't hang the process
    resolveSlowFetch()
})
