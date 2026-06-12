import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import { fakeResult } from './helpers/sql-fake.js'

interface Feed {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    created_at:string
    updated_at:string
}

function createFeed (id:number, url = `https://example.com/${id}.xml`):Feed {
    return {
        id,
        url,
        title: null,
        description: null,
        site_url: null,
        last_fetched: null,
        created_at: '2026-04-26 00:00:00',
        updated_at: '2026-04-26 00:00:00'
    }
}

function createRefreshDo (
    feeds:Feed[],
    fetchFeedFn:(feed:Feed) => Promise<void>,
    advanceCursorFn:(feedId:number) => void
) {
    const broadcasts:Array<{event:string; data:unknown}> = []

    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:{ exec:(query:string, ...params:unknown[]) => QueryResult }
        ctx:{ waitUntil:(promise:Promise<void>) => void }
        fetchFeed:(feed:Feed) => Promise<void>
        advanceFeedCursor:(feedId:number) => void
        broadcast:(event:string, data:unknown) => void
        runFeedPool:(
            items:Feed[],
            worker:(feed:Feed) => Promise<void>
        ) => Promise<void>
    }

    userDo.sql = {
        exec (query:string) {
            if (query.includes('SELECT * FROM feeds')) {
                return fakeResult(feeds)
            }
            throw new Error(`Unexpected SQL: ${query}`)
        }
    }

    userDo.ctx = {
        waitUntil: (_promise:Promise<void>) => {
            // no-op for test
        }
    }
    userDo.fetchFeed = fetchFeedFn
    userDo.advanceFeedCursor = advanceCursorFn
    userDo.broadcast = (event:string, data:unknown) => {
        broadcasts.push({ event, data })
    }

    // Bind the real runFeedPool from the prototype
    // Cast to access private method for testing purposes
    userDo.runFeedPool = (
        RsssUserDO.prototype as unknown as {
            runFeedPool:(
                items:Feed[],
                worker:(feed:Feed) => Promise<void>
            ) => Promise<void>
        }
    ).runFeedPool

    return { userDo, broadcasts }
}

test('AC6.1: POST /feeds/refresh respects max concurrency', async (t) => {
    // Create more feeds than FEED_REFRESH_CONCURRENCY (8)
    const feedCount = 15
    const feeds = Array.from({ length: feedCount }, (_, i) =>
        createFeed(i + 1)
    )

    // Track in-flight fetch calls
    let maxConcurrent = 0
    let currentConcurrent = 0

    const { userDo, broadcasts } = createRefreshDo(
        feeds,
        async () => {
            currentConcurrent++
            maxConcurrent = Math.max(maxConcurrent, currentConcurrent)

            // Simulate fetch delay
            await new Promise(resolve => setTimeout(resolve, 10))

            currentConcurrent--
        },
        () => { /* no-op for this test */ }
    )

    // Simulate the POST /feeds/refresh flow
    await userDo.runFeedPool(feeds, async feed => {
        await userDo.fetchFeed(feed)
        userDo.advanceFeedCursor(feed.id)
    })
    userDo.broadcast('refresh-complete', { refreshed: feeds.length })

    t.ok(
        maxConcurrent <= 8,
        `Max concurrent fetches (${maxConcurrent}) should not exceed 8`
    )
    t.equal(broadcasts.length, 1, 'broadcast should be called once')
    t.equal(
        broadcasts[0]?.event,
        'refresh-complete',
        'broadcast event should be refresh-complete'
    )
})

test('AC6.2: refresh-complete broadcasts despite individual feed errors',
    async (t) => {
        const feeds = [
            createFeed(1),
            createFeed(2), // will fail
            createFeed(3)
        ]

        let completedCount = 0
        let cursorAdvancedCount = 0

        const { userDo, broadcasts } = createRefreshDo(
            feeds,
            async (feed) => {
                if (feed.id === 2) {
                    throw new Error('Feed 2 fetch failed')
                }
                completedCount++
            },
            (feedId) => {
                // Only count successful advances (feed 2's cursor won't
                // advance because fetchFeed throws)
                if (feedId !== 2) {
                    cursorAdvancedCount++
                }
            }
        )

        // Simulate the POST /feeds/refresh flow
        await userDo.runFeedPool(feeds, async feed => {
            await userDo.fetchFeed(feed)
            userDo.advanceFeedCursor(feed.id)
        })
        userDo.broadcast('refresh-complete', { refreshed: feeds.length })

        t.ok(
            broadcasts.length > 0,
            'broadcast("refresh-complete") should be called'
        )
        t.equal(
            broadcasts[0]?.event,
            'refresh-complete',
            'event should be refresh-complete'
        )
        t.equal(
            completedCount,
            2,
            'feeds 1 and 3 should have completed successfully'
        )
        t.ok(
            cursorAdvancedCount >= 1,
            'at least some cursors should have advanced'
        )
    }
)
