import { test } from '@substrate-system/tapzero'
import { fakeResult } from './helpers/sql-fake.js'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import app from '../src/server/index.js'
import { makeEnv, executionCtx } from './signup-helpers.js'

interface FeedRow {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_error:string|null
    last_status:number|null
    published:number
    published_rkey:string|null
    published_at:string|null
    publish_error:string|null
    created_at:string
    updated_at:string
}

function feedRow (id:number, url:string):FeedRow {
    return {
        id,
        url,
        title: null,
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        published: 0,
        published_rkey: null,
        published_at: null,
        publish_error: null,
        created_at: '2026-05-01 00:00:00',
        updated_at: '2026-05-01 00:00:00'
    }
}

// ---- Worker-level tests (AC3.2) ----

test('POST /api/dev/poll-now returns 404 in production',
    async t => {
        const res = await app.request(
            'https://rsss.space/api/dev/poll-now',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: 'csrf_token=test-csrf',
                    'x-csrf-token': 'test-csrf',
                    'sec-fetch-site': 'same-origin'
                }
            },
            makeEnv({ NODE_ENV: 'production' }),
            executionCtx
        )
        t.equal(res.status, 404, 'poll-now is 404 in production')
    }
)

test('POST /api/dev/poll-now returns 404 in staging',
    async t => {
        const res = await app.request(
            'https://rsss.space/api/dev/poll-now',
            {
                method: 'POST',
                headers: {
                    'content-type': 'application/json',
                    cookie: 'csrf_token=test-csrf',
                    'x-csrf-token': 'test-csrf',
                    'sec-fetch-site': 'same-origin'
                }
            },
            makeEnv({ NODE_ENV: 'staging' }),
            executionCtx
        )
        t.equal(res.status, 404, 'poll-now is 404 in staging')
    }
)

// ---- DO-level tests (AC3.1, AC3.3) ----

// eslint-disable-next-line @typescript-eslint/no-explicit-any
interface DevPollDoType {
    sql:{ exec:(q:string, ...p:unknown[]) => any }
    fetchFeed:(feed:FeedRow) => Promise<void>
    advanceFeedCursor:(feedId:number) => void
    getFeedUpdateCounts:() => Record<string, number>
    runFeedPool:(
        feeds:FeedRow[],
        worker:(feed:FeedRow) => Promise<void>
    ) => Promise<void>
    broadcast:(event:string, data:unknown) => void
    createRouter:() => {
        request:(path:string, init?:RequestInit) => Promise<Response>
    }
}

function createDevPollHarness () {
    const feeds:FeedRow[] = [feedRow(1, 'https://a.example/feed')]
    let itemCount = 100
    const fetchCalls:number[] = []
    const advanceCalls:number[] = []

    const userDo = Object.create(RsssUserDO.prototype) as DevPollDoType

    userDo.sql = {
        exec (query:string) {
            if (query.includes('SELECT * FROM feeds')) {
                return fakeResult([...feeds])
            }
            if (query.includes('SELECT COUNT(*) AS c FROM items')) {
                return fakeResult([{ c: itemCount }])
            }
            return fakeResult([])
        }
    }

    userDo.fetchFeed = async (feed:FeedRow) => {
        fetchCalls.push(feed.id)
        // Simulate inserting items: increment the item count
        itemCount += 5
    }

    userDo.advanceFeedCursor = (feedId:number) => {
        advanceCalls.push(feedId)
    }

    userDo.getFeedUpdateCounts = () => ({
        1: 5
    })

    userDo.runFeedPool = async (
        feedsList:FeedRow[],
        worker:(feed:FeedRow) => Promise<void>
    ) => {
        for (const feed of feedsList) {
            try {
                await worker(feed)
            } catch (_err) {
                // Isolate per-feed failure
            }
        }
    }

    userDo.broadcast = () => {}

    return {
        app: userDo.createRouter(),
        fetchCalls,
        advanceCalls,
        feeds
    }
}

test('AC3.1: dev poll-now discovers feeds, counts items, does not advance cursor',
    async t => {
        const { app, fetchCalls, advanceCalls } = createDevPollHarness()

        const res = await app.request(
            '/internal/dev/poll-now',
            { method: 'POST' }
        )
        const body = await res.json() as {
            polledFeeds?:number
            newItems?:number
            counts?:Record<string, number>
        }

        t.equal(res.status, 200, 'returns 200')
        t.equal(body.polledFeeds, 1, 'polledFeeds is feed count')
        t.equal(fetchCalls.length, 1, 'fetchFeed called once per feed')
        t.equal(fetchCalls[0], 1, 'fetchFeed called for feed 1')
        t.equal(body.newItems, 5, 'newItems matches inserted count (>0)')
        t.ok(body.counts, 'response includes counts object')
        t.ok(
            typeof body.counts === 'object',
            'counts is an object'
        )
        if (body.counts) {
            t.ok(body.counts[1], 'counts has entry for feed 1')
        }
        t.equal(
            advanceCalls.length,
            0,
            'advanceFeedCursor was never called (cursor untouched)'
        )
    }
)

test('AC3.3: dev poll-now handles 304 without error, returns full response',
    async t => {
        // Stub fetchFeed to insert nothing (304 simulation)
        const userDo = Object.create(RsssUserDO.prototype) as DevPollDoType
        const state = { itemCount: 100 }

        userDo.sql = {
            exec (query:string) {
                if (query.includes('SELECT * FROM feeds')) {
                    return fakeResult([feedRow(1, 'https://a.example/feed')])
                }
                if (query.includes('SELECT COUNT(*) AS c FROM items')) {
                    return fakeResult([{ c: state.itemCount }])
                }
                return fakeResult([])
            }
        }

        userDo.fetchFeed = async () => {
            // 304: no items inserted, itemCount unchanged
        }

        userDo.getFeedUpdateCounts = () => ({ 1: 0 })

        userDo.runFeedPool = async (
            feedsList:FeedRow[],
            worker:(feed:FeedRow) => Promise<void>
        ) => {
            for (const feed of feedsList) {
                try {
                    await worker(feed)
                } catch (_err) {
                    // Isolate per-feed failure
                }
            }
        }

        userDo.broadcast = () => {}

        const res = await userDo.createRouter().request(
            '/internal/dev/poll-now',
            { method: 'POST' }
        )
        const body = await res.json() as {
            polledFeeds?:number
            newItems?:number
            counts?:Record<string, number>
        }

        t.equal(res.status, 200, 'returns 200 even with no new items')
        t.equal(body.newItems, 0, 'newItems is 0 for 304')
        t.ok(body.polledFeeds !== undefined, 'response has polledFeeds')
        t.ok(body.counts !== undefined, 'response has counts')
        // No error thrown, full response shape returned
    }
)
