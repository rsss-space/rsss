import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'
import { makeEnv, executionCtx, makeSession } from './signup-helpers.js'

// AC5.5a: authed request to /api/index/feed forwards to DO and returns body
test('AC5.5a: GET /api/index/feed forwards query to DO /internal/index/feed',
    async t => {
        let recordedPath = ''
        let recordedSearch = ''

        // Mock environment with INDEXER_DO that records the requested path/search
        const mockIndexerDo = {
            idFromName () {
                return 'test-id'
            },
            get () {
                return {
                    async fetch (req:Request) {
                        recordedPath = new URL(req.url).pathname
                        recordedSearch = new URL(req.url).search
                        return new Response(JSON.stringify({
                            items: [
                                {
                                    uri: 'at://did:plc:x/space.rsss.graph.follow/y',
                                    did: 'did:plc:x',
                                    collection: 'space.rsss.graph.follow',
                                    rkey: 'y',
                                    cid: 'bafy123',
                                    record: { subject: 'did:plc:z' },
                                    time_us: 1000000,
                                    indexed_at: Date.now()
                                }
                            ]
                        }), { status: 200 })
                    }
                }
            }
        }

        const env = makeEnv({
            INDEXER_DO: mockIndexerDo as unknown as
                DurableObjectNamespace
        })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'https://rsss.space/api/index/feed?collection=space.rsss.graph.follow',
            {
                method: 'GET',
                headers: {
                    cookie: cookieHeader,
                    'sec-fetch-site': 'same-origin'
                }
            },
            env,
            executionCtx
        )

        t.equal(res.status, 200, 'returns 200')
        t.equal(recordedPath, '/internal/index/feed',
            'forwards to /internal/index/feed')
        t.equal(recordedSearch, '?collection=space.rsss.graph.follow',
            'forwards query string')

        const body = await res.json() as { items?: unknown[] }
        t.ok(body.items, 'returns DO response body')
        t.ok(body.items?.length === 1, 'response includes items')
    }
)

// AC5.5b: INDEXER_DO absent returns 404
test('AC5.5b: INDEXER_DO absent => 404',
    async t => {
        const env = makeEnv({
            // INDEXER_DO explicitly not set
        })
        const { cookieHeader } = await makeSession(env)

        const res = await app.request(
            'https://rsss.space/api/index/feed?collection=X',
            {
                method: 'GET',
                headers: {
                    cookie: cookieHeader,
                    'sec-fetch-site': 'same-origin'
                }
            },
            env,
            executionCtx
        )

        t.equal(res.status, 404, 'returns 404 when INDEXER_DO unbound')
    }
)

// AC5.5c: no session => requireAuth 401, no stub call
test('AC5.5c: unauthenticated => 401, no stub call',
    async t => {
        let stubCalled = false

        const mockIndexerDo = {
            idFromName () {
                return 'test-id'
            },
            get () {
                return {
                    async fetch () {
                        stubCalled = true
                        return new Response('{}', { status: 200 })
                    }
                }
            }
        }

        const env = makeEnv({
            INDEXER_DO: mockIndexerDo as unknown as
                DurableObjectNamespace
        })

        const res = await app.request(
            'https://rsss.space/api/index/feed?collection=X',
            {
                method: 'GET',
                headers: {
                    'sec-fetch-site': 'same-origin'
                }
                // No session cookie
            },
            env,
            executionCtx
        )

        t.equal(res.status, 401, 'returns 401 (requireAuth)')
        t.equal(stubCalled, false, 'stub was never called')
    }
)
