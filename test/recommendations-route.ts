/**
 * AC18.1 / AC18.2: GET /api/recommendations route wiring.
 *
 * These drive the REAL Hono `app` route (not computeRecommendations
 * directly): a forged-but-valid session cookie exercises requireAuth + the
 * session middleware, stubbed USER_DO / REGISTRY_DO back the route's deps, and
 * globalThis.fetch is mocked for the public Bluesky getFollows call. This way
 * the route's dep assembly, the getBlueskyFollows ok:false -> 503 branch, and
 * the requireAuth gate are all exercised through production code.
 */
import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'
import { createSessionCookie } from '../src/server/auth/oauth.js'

const SECRET = 'test-recommendations-secret-0123456789abcdef'
const READER_DID = 'did:plc:reader'

class MemoryKv {
    data = new Map<string, string>()
    async get (k:string):Promise<string|null> {
        return this.data.get(k) ?? null
    }

    async put (k:string, v:string):Promise<void> {
        this.data.set(k, v)
    }

    async delete (k:string):Promise<void> {
        this.data.delete(k)
    }
}

function userDoStub (dids:string[]) {
    return {
        idFromName: () => 'id',
        get: () => ({
            fetch: async (req:Request) => {
                const path = new URL(req.url).pathname
                if (path === '/graph/following') {
                    return new Response(JSON.stringify({ dids }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
                }
                return new Response(null, { status: 404 })
            }
        })
    }
}

function registryDoStub (
    users:Array<{ did:string; handle:string; avatar:string|null }>
) {
    return {
        idFromName: () => 'id',
        get: () => ({
            fetch: async (req:Request) => {
                const path = new URL(req.url).pathname
                if (path === '/batch-lookup') {
                    return new Response(JSON.stringify({ users }), {
                        status: 200,
                        headers: { 'content-type': 'application/json' }
                    })
                }
                return new Response(null, { status: 404 })
            }
        })
    }
}

function makeEnv (
    kv:MemoryKv,
    following:string[],
    registryUsers:Array<{ did:string; handle:string; avatar:string|null }>
) {
    return {
        SESSION_SECRET: SECRET,
        SESSIONS: kv as unknown as KVNamespace,
        USER_DO: userDoStub(following),
        REGISTRY_DO: registryDoStub(registryUsers),
        NODE_ENV: 'test'
    } as unknown as Parameters<typeof app.request>[2]
}

// Mock the public Bluesky getFollows endpoint. `responder` decides each call.
function withMockedFetch (
    responder:(url:string)=> Response,
    run:()=> Promise<void>
):Promise<void> {
    const original = globalThis.fetch
    globalThis.fetch = (async (input:RequestInfo|URL) => {
        const url = typeof input === 'string' ?
            input :
            input instanceof URL ? input.href : input.url
        return responder(url)
    }) as typeof fetch
    return run().finally(() => {
        globalThis.fetch = original
    })
}

function followsResponse (
    follows:Array<{ did:string; handle:string }>
):Response {
    return new Response(JSON.stringify({ follows }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

test('AC18.1: GET /api/recommendations returns computed recommendations',
    async (t) => {
        const kv = new MemoryKv()
        const cookie = await createSessionCookie(
            { did: READER_DID, handle: 'reader.example' },
            SECRET,
            kv as unknown as KVNamespace
        )

        // Bluesky follows: alice (already followed on rsss), bob (rsss user,
        // recommendable), and reader (self — must be excluded).
        const env = makeEnv(
            kv,
            ['did:plc:alice'],
            [{ did: 'did:plc:bob', handle: 'bob.example', avatar: null }]
        )

        await withMockedFetch(
            (url) => {
                if (url.includes('app.bsky.graph.getFollows')) {
                    return followsResponse([
                        { did: 'did:plc:alice', handle: 'alice.example' },
                        { did: 'did:plc:bob', handle: 'bob.example' },
                        { did: READER_DID, handle: 'reader.example' }
                    ])
                }
                return new Response(null, { status: 404 })
            },
            async () => {
                const res = await app.request(
                    'https://rsss.space/api/recommendations',
                    { method: 'GET', headers: { cookie: `session=${cookie}` } },
                    env
                )

                t.equal(res.status, 200, 'authenticated request returns 200')
                const body = await res.json() as Array<{ did:string }>
                t.ok(Array.isArray(body), 'response is an array')
                const dids = body.map((u) => u.did)
                t.ok(dids.includes('did:plc:bob'),
                    'recommends bob (rsss user not yet followed)')
                t.ok(!dids.includes('did:plc:alice'),
                    'excludes alice (already followed on rsss)')
                t.ok(!dids.includes(READER_DID),
                    'excludes the session user themselves')
            }
        )
    })

test('AC18.1: GET /api/recommendations returns 503 when Bluesky fetch fails',
    async (t) => {
        const kv = new MemoryKv()
        const cookie = await createSessionCookie(
            { did: READER_DID, handle: 'reader.example' },
            SECRET,
            kv as unknown as KVNamespace
        )
        const env = makeEnv(kv, [], [])

        await withMockedFetch(
            (url) => {
                if (url.includes('app.bsky.graph.getFollows')) {
                    // Upstream failure -> getBlueskyFollows returns ok:false.
                    return new Response('upstream error', { status: 502 })
                }
                return new Response(null, { status: 404 })
            },
            async () => {
                const res = await app.request(
                    'https://rsss.space/api/recommendations',
                    { method: 'GET', headers: { cookie: `session=${cookie}` } },
                    env
                )
                t.equal(res.status, 503,
                    'Bluesky fetch failure surfaces as 503, not empty list')
                const body = await res.json() as { error?:string }
                t.equal(body.error, 'recommendations_unavailable',
                    'returns recommendations_unavailable')
            }
        )
    })

test('AC18.2: GET /api/recommendations rejects an unauthenticated request',
    async (t) => {
        const kv = new MemoryKv()
        const env = makeEnv(kv, [], [])

        // No session cookie -> requireAuth must reject before any work.
        let blueskyCalled = false
        await withMockedFetch(
            (url) => {
                if (url.includes('app.bsky.graph.getFollows')) {
                    blueskyCalled = true
                }
                return new Response(null, { status: 404 })
            },
            async () => {
                const res = await app.request(
                    'https://rsss.space/api/recommendations',
                    { method: 'GET' },
                    env
                )
                t.equal(res.status, 401,
                    'unauthenticated request is rejected by requireAuth')
                t.equal(blueskyCalled, false,
                    'no recommendations work runs for an unauthed request')
            }
        )
    })
