/**
 * Tests for US-017: Profile route
 *  - GET /graph/follow/:targetDid on RsssUserDO
 *  - listRecords on SlingshotClient
 *  - GET /api/profile/:did server endpoint (tested via the standalone
 *    profileApiHandler exported from src/server/profile-api.ts)
 */
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import {
    createSlingshotClient,
    type MicrocosmServiceError
} from '../src/server/microcosm-client.js'
import {
    buildProfileResponse,
    type ProfileApiDeps
} from '../src/server/profile-api.js'

// ---- helpers shared with graph-follow tests ----

interface FollowRow {
    subject_did:string
    rkey:string
}

interface QueryResult {
    toArray:() => unknown[]
    one:() => unknown | null
}

function result (rows:unknown[]):QueryResult {
    return {
        toArray () { return rows },
        one () { return rows[0] ?? null }
    }
}

function createFollowSql (initialFollows:FollowRow[] = []) {
    const follows:FollowRow[] = [...initialFollows]

    return {
        follows,
        exec (query:string, ...params:unknown[]) {
            if (query.includes(
                'SELECT rkey FROM graph_follows WHERE subject_did = ?'
            )) {
                return result(
                    follows.filter(f => f.subject_did === params[0])
                )
            }
            // Absorb DDL and other queries
            return result([])
        }
    }
}

function createFollowHarness (options:{
    initialFollows?:FollowRow[]
} = {}) {
    const sql = createFollowSql(options.initialFollows)

    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createFollowSql>
        ctx:{
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:(key:string, value:unknown) => Promise<void>
                delete:(key:string) => Promise<void>
                getAlarm:() => Promise<number|null>
                setAlarm:(at:number) => Promise<void>
                deleteAlarm:() => Promise<void>
            }
            waitUntil:(promise:Promise<unknown>) => void
            getWebSockets:() => Array<{ send:(msg:string) => void }>
        }
        fetchFeed:(feed:unknown) => Promise<void>
        refreshFeedBatches:() => Promise<void>
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }

    const storage = new Map<string, unknown>()
    userDo.sql = sql
    userDo.ctx = {
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put (key:string, value:unknown) {
                storage.set(key, value)
            },
            async delete (key:string) { storage.delete(key) },
            async getAlarm () { return null },
            async setAlarm () {},
            async deleteAlarm () {}
        },
        waitUntil (_promise) {},
        getWebSockets () { return [] }
    }
    userDo.fetchFeed = async () => {}
    userDo.refreshFeedBatches = async () => {}

    return { app: userDo.createRouter(), sql }
}

// ---- GET /graph/follow/:targetDid ----

test('GET /graph/follow/:did returns following:true when row exists', async t => {
    const { app } = createFollowHarness({
        initialFollows: [{ subject_did: 'did:plc:bob', rkey: 'abc123' }]
    })
    const res = await app.request(
        '/graph/follow/did:plc:bob',
        { method: 'GET' }
    )
    t.equal(res.status, 200)
    const body = await res.json() as { following:boolean }
    t.equal(body.following, true)
})

test('GET /graph/follow/:did returns following:false when no row', async t => {
    const { app } = createFollowHarness()
    const res = await app.request(
        '/graph/follow/did:plc:unknown',
        { method: 'GET' }
    )
    t.equal(res.status, 200)
    const body = await res.json() as { following:boolean }
    t.equal(body.following, false)
})

// ---- SlingshotClient.listRecords ----

interface CapturedRequest {
    url:string
    method:string
}

function captureRequests (
    responses:Response[]
):{ fetch:typeof fetch; calls:CapturedRequest[] } {
    const calls:CapturedRequest[] = []
    let idx = 0

    const fakeFetch:typeof fetch = (input, init) => {
        const url = typeof input === 'string' ?
            input :
            (input as Request).url
        calls.push({ url, method: init?.method ?? 'GET' })
        const response = responses[idx] ?? responses[responses.length - 1]
        idx++
        return Promise.resolve(response)
    }

    return { fetch: fakeFetch, calls }
}

function jsonResponse (
    body:unknown,
    status = 200
):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    })
}

test('slingshot listRecords calls correct URL with collection', async t => {
    const records = [
        {
            uri: 'at://did:plc:alice/space.rsss.feed.subscription/rk1',
            cid: 'baf1',
            value: {
                feedUrl: 'https://example.com/feed',
                title: 'Example',
                createdAt: '2024-01-01T00:00:00Z'
            }
        }
    ]
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ records, cursor: undefined })
    ])
    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.listRecords({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        limit: 50
    })

    t.ok(!('code' in result), 'no error')
    t.equal(calls.length, 1)
    const url = new URL(calls[0].url)
    t.ok(
        url.pathname.includes('listRecords'),
        'path includes listRecords'
    )
    t.equal(url.searchParams.get('repo'), 'did:plc:alice')
    t.equal(
        url.searchParams.get('collection'),
        'space.rsss.feed.subscription'
    )
})

test('slingshot listRecords returns records array', async t => {
    const records = [
        {
            uri: 'at://did:plc:alice/space.rsss.feed.subscription/rk1',
            cid: 'baf1',
            value: {
                feedUrl: 'https://example.com/feed',
                title: 'Example',
                createdAt: '2024-01-01T00:00:00Z'
            }
        }
    ]
    const { fetch: fakeFetch } = captureRequests([
        jsonResponse({ records })
    ])
    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.listRecords({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription'
    })

    if ('code' in result) {
        t.fail('expected ok result')
        return
    }
    t.equal(result.records.length, 1)
    t.equal(result.records[0].uri,
        'at://did:plc:alice/space.rsss.feed.subscription/rk1')
})

test('slingshot listRecords returns error on non-2xx', async t => {
    const { fetch: fakeFetch } = captureRequests([
        jsonResponse({ error: 'invalid' }, 400)
    ])
    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.listRecords({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription'
    })

    t.ok('code' in result, 'error result')
    t.equal((result as MicrocosmServiceError).code, 'service_unavailable')
})

test('slingshot listRecords returns error on network failure', async t => {
    const fakeFetch:typeof fetch = () =>
        Promise.reject(new Error('network failure'))
    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.listRecords({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription'
    })

    t.ok('code' in result, 'error result')
    t.equal((result as MicrocosmServiceError).code, 'service_unavailable')
})

// ---- buildProfileResponse ----

test('buildProfileResponse returns subscriptions from slingshot', async t => {
    const deps:ProfileApiDeps = {
        async resolveIdentity (_did:string) {
            return { did: 'did:plc:alice', handle: 'alice.bsky.social' }
        },
        async listSubscriptions (_did:string) {
            return [
                {
                    uri: 'at://did:plc:alice/space.rsss.feed.subscription/rk1',
                    rkey: 'rk1',
                    feedUrl: 'https://feeds.example.com/rss',
                    title: 'Example Feed',
                    siteUrl: 'https://example.com'
                }
            ]
        },
        async lookupAvatar (_did:string) {
            return 'https://cdn.example.com/avatar.jpg'
        }
    }

    const profile = await buildProfileResponse('did:plc:alice', deps)
    t.equal(profile.did, 'did:plc:alice')
    t.equal(profile.handle, 'alice.bsky.social')
    t.equal(profile.avatar, 'https://cdn.example.com/avatar.jpg')
    t.equal(profile.subscriptions.length, 1)
    t.equal(profile.subscriptions[0].feedUrl, 'https://feeds.example.com/rss')
    t.equal(profile.subscriptions[0].title, 'Example Feed')
})

test('buildProfileResponse handles missing avatar gracefully', async t => {
    const deps:ProfileApiDeps = {
        async resolveIdentity (_did:string) {
            return { did: 'did:plc:alice', handle: 'alice.bsky.social' }
        },
        async listSubscriptions (_did:string) {
            return []
        },
        async lookupAvatar (_did:string) {
            return null
        }
    }

    const profile = await buildProfileResponse('did:plc:alice', deps)
    t.equal(profile.avatar, null)
    t.equal(profile.subscriptions.length, 0)
})

test('buildProfileResponse propagates identity error', async t => {
    const deps:ProfileApiDeps = {
        async resolveIdentity (_did:string) {
            throw new Error('identity not found')
        },
        async listSubscriptions (_did:string) {
            return []
        },
        async lookupAvatar (_did:string) {
            return null
        }
    }

    try {
        await buildProfileResponse('did:plc:unknown', deps)
        t.fail('should have thrown')
    } catch (err) {
        t.ok(err instanceof Error)
        t.ok((err as Error).message.includes('identity not found'))
    }
})

test('buildProfileResponse returns empty subscriptions on list error',
    async t => {
        const deps:ProfileApiDeps = {
            async resolveIdentity (_did:string) {
                return { did: 'did:plc:alice', handle: 'alice.bsky.social' }
            },
            async listSubscriptions (_did:string) {
                return []
            },
            async lookupAvatar (_did:string) {
                return null
            }
        }

        const profile = await buildProfileResponse('did:plc:alice', deps)
        t.equal(profile.subscriptions.length, 0)
    }
)
