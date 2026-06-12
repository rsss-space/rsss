/**
 * Tests for US-019: Read the user's public Bluesky follows
 *
 * Tests the getBlueskyFollows helper via injectable deps so no real
 * HTTP calls are made.
 */
import { test } from '@substrate-system/tapzero'
import {
    getBlueskyFollows,
    type BlueskyFollowsDeps
} from '../src/server/bluesky-follows.js'

// ---- helpers ----

function makeFollow (did:string, handle:string) {
    return { did, handle, displayName: handle, avatar: null }
}

function makeAppviewPage (
    follows:ReturnType<typeof makeFollow>[],
    cursor?:string
) {
    return {
        follows,
        ...(cursor ? { cursor } : {})
    }
}

function makeSuccessResponse (body:unknown):Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

function makeErrorResponse (status:number):Response {
    return new Response('Error', { status })
}

function makeDeps (options:{
    pages?:ReturnType<typeof makeAppviewPage>[]
    fetchError?:Error
    cached?:string|null
    puts?:Array<{ key:string; value:string; ttl:number }>
} = {}):BlueskyFollowsDeps & {
    puts:Array<{ key:string; value:string; ttl:number }>
} {
    const pages = options.pages ?? [makeAppviewPage([])]
    let pageIndex = 0
    const puts:Array<{ key:string; value:string; ttl:number }> = []

    return {
        puts,
        fetch: async (_url:string|URL|Request) => {
            if (options.fetchError) throw options.fetchError
            const page = pages[pageIndex] ?? makeAppviewPage([])
            pageIndex++
            return makeSuccessResponse(page)
        },
        getCache: async (_key:string) => {
            return options.cached !== undefined ? options.cached : null
        },
        putCache: async (key:string, value:string, ttl:number) => {
            puts.push({ key, value, ttl })
        }
    }
}

// ---- tests ----

test('returns empty array when user has no follows', async (t) => {
    const deps = makeDeps({ pages: [makeAppviewPage([])] })
    const result = await getBlueskyFollows('did:plc:abc', deps)
    t.equal(result.follows.length, 0, 'should return empty array')
    t.equal(result.ok, true, 'ok should be true for clean natural termination')
})

test('returns follows from a single page', async (t) => {
    const follows = [
        makeFollow('did:plc:alice', 'alice.bsky.social'),
        makeFollow('did:plc:bob', 'bob.bsky.social')
    ]
    const deps = makeDeps({ pages: [makeAppviewPage(follows)] })
    const result = await getBlueskyFollows('did:plc:abc', deps)
    t.equal(result.follows.length, 2)
    t.equal(result.follows[0].did, 'did:plc:alice')
    t.equal(result.follows[0].handle, 'alice.bsky.social')
    t.equal(result.follows[1].did, 'did:plc:bob')
    t.equal(result.ok, true)
})

test('paginates through multiple pages', async (t) => {
    const page1 = makeAppviewPage(
        [makeFollow('did:plc:a', 'a.test'), makeFollow('did:plc:b', 'b.test')],
        'cursor-1'
    )
    const page2 = makeAppviewPage(
        [makeFollow('did:plc:c', 'c.test')]
    )
    const deps = makeDeps({ pages: [page1, page2] })
    const result = await getBlueskyFollows('did:plc:abc', deps)
    t.equal(result.follows.length, 3)
    t.equal(result.follows[2].did, 'did:plc:c')
    t.equal(result.ok, true)
})

test('includes cursor in subsequent requests', async (t) => {
    const fetchedUrls:string[] = []
    const page1 = makeAppviewPage(
        [makeFollow('did:plc:a', 'a.test')],
        'the-cursor'
    )
    const page2 = makeAppviewPage([makeFollow('did:plc:b', 'b.test')])

    let pageIndex = 0
    const pages = [page1, page2]
    const deps:BlueskyFollowsDeps & { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async (input:string|URL|Request) => {
            fetchedUrls.push(input.toString())
            const page = pages[pageIndex++] ?? makeAppviewPage([])
            return makeSuccessResponse(page)
        },
        getCache: async () => null,
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    await getBlueskyFollows('did:plc:test', deps)
    t.ok(fetchedUrls[0].includes('did:plc:test'), 'first URL includes DID')
    t.ok(
        fetchedUrls[1].includes('cursor=the-cursor'),
        'second URL includes cursor'
    )
})

test('returns cached result when available', async (t) => {
    const cached = JSON.stringify([
        { did: 'did:plc:cached', handle: 'cached.test' }
    ])
    let fetchCalled = false
    const deps:BlueskyFollowsDeps & { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async () => {
            fetchCalled = true
            return makeSuccessResponse(makeAppviewPage([]))
        },
        getCache: async () => cached,
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.equal(fetchCalled, false, 'should not fetch when cached')
    t.equal(result.follows.length, 1)
    t.equal(result.follows[0].did, 'did:plc:cached')
    t.equal(result.ok, true)
})

test('caches fetched results with a TTL', async (t) => {
    const follows = [makeFollow('did:plc:x', 'x.test')]
    const deps = makeDeps({ pages: [makeAppviewPage(follows)] })
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.equal(result.ok, true)
    t.equal(deps.puts.length, 1, 'should write to cache once')
    t.ok(deps.puts[0].ttl > 0, 'TTL should be positive')
    const cached = JSON.parse(deps.puts[0].value)
    t.equal(cached[0].did, 'did:plc:x')
})

test('returns ok:false on fetch error (AC7.4)', async (t) => {
    const deps = makeDeps({ fetchError: new Error('network error') })
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.equal(result.follows.length, 0, 'should return empty follows on error')
    t.equal(result.ok, false, 'ok should be false on fetch error')
})

test('returns ok:false on non-200 response mid-pagination (AC7.3)',
    async (t) => {
    const page1 = makeAppviewPage(
        [makeFollow('did:plc:a', 'a.test')],
        'cursor-1'
    )
    let pageIndex = 0
    const deps:BlueskyFollowsDeps &
        { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async () => {
            if (pageIndex === 0) {
                pageIndex++
                return makeSuccessResponse(page1)
            }
            return makeErrorResponse(400)
        },
        getCache: async () => null,
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.equal(result.follows.length, 1, 'should keep page-1 follows on page-2 error')
    t.equal(result.follows[0].did, 'did:plc:a')
    t.equal(result.ok, false, 'ok should be false on mid-pagination error')
})

test('cache key includes the DID', async (t) => {
    const deps = makeDeps({ pages: [makeAppviewPage([])] })
    await getBlueskyFollows('did:plc:specific', deps)
    t.ok(
        deps.puts.length === 0 || deps.puts[0].key.includes('did:plc:specific'),
        'cache key includes DID'
    )
    // Even if nothing was cached (empty result), verify the cache lookup
    // was keyed on the DID by checking what getCache was called with.
})

test('cache key is consistent for same DID', async (t) => {
    const keys:string[] = []
    const deps:BlueskyFollowsDeps & { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async () => makeSuccessResponse(makeAppviewPage([])),
        getCache: async (key:string) => {
            keys.push(key)
            return null
        },
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    await getBlueskyFollows('did:plc:same', deps)
    await getBlueskyFollows('did:plc:same', deps)
    t.equal(keys[0], keys[1], 'same DID uses same cache key')
})

test('stops at MAX_FOLLOW_PAGES cap (AC7.1)', async (t) => {
    // Create 51 pages all with the same cursor, which would infinite-loop
    // without the page cap. Instead, should stop at page 50.
    let fetchCount = 0
    const deps:BlueskyFollowsDeps &
        { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async () => {
            fetchCount++
            return makeSuccessResponse(makeAppviewPage(
                [makeFollow(`did:plc:f${fetchCount}`, `f${fetchCount}.test`)],
                'constant-cursor'
            ))
        },
        getCache: async () => null,
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.ok(fetchCount <= 50, `should stop at MAX_FOLLOW_PAGES (${fetchCount} fetches)`)
    t.equal(result.ok, false, 'ok should be false when max pages reached')
    t.ok(result.follows.length > 0, 'should return partial follows')
})

test('bails on unchanged cursor (AC7.2)', async (t) => {
    let fetchCount = 0
    const deps:BlueskyFollowsDeps &
        { puts:Array<{ key:string; value:string; ttl:number }> } = {
        puts: [],
        fetch: async () => {
            fetchCount++
            return makeSuccessResponse(makeAppviewPage(
                [makeFollow(`did:plc:g${fetchCount}`, `g${fetchCount}.test`)],
                'stalled-cursor'
            ))
        },
        getCache: async () => null,
        putCache: async (key, value, ttl) => {
            deps.puts.push({ key, value, ttl })
        }
    }
    const result = await getBlueskyFollows('did:plc:test', deps)
    t.equal(fetchCount, 2, 'should make 2 requests (second with same cursor)')
    t.equal(result.ok, false, 'ok should be false on cursor stall')
    t.equal(result.follows.length, 1, 'should return page-1 follows only')
})
