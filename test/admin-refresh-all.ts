/**
 * Tests for AC19.1: /admin/refresh-all pagination
 * Verifies that the REAL /admin/refresh-all route accepts cursor/limit query
 * params, processes only one page of users, and returns pagination state.
 */
import { test } from '@substrate-system/tapzero'
import app from '../src/server/index.js'

const TEST_ADMIN_TOKEN = 'secret-admin-token-abc123'
const TEST_CSRF_TOKEN = 'test-csrf-token-12345'

interface KVListResult {
    keys:Array<{ name:string; expiration?:number }>
    list_complete:boolean
    cursor?:string
}

class MockKvNamespace {
    private data = new Map<string, string>()
    private kvListImpl:(opts:{
        prefix?:string
        limit?:number
        cursor?:string
    })=> Promise<KVListResult>

    constructor (kvListImpl:(opts:{
        prefix?:string
        limit?:number
        cursor?:string
    })=> Promise<KVListResult>) {
        this.kvListImpl = kvListImpl
    }

    async get (key:string):Promise<string|null> {
        return this.data.get(key) ?? null
    }

    async put (key:string, value:string):Promise<void> {
        this.data.set(key, value)
    }

    async list (opts:{
        prefix?:string
        limit?:number
        cursor?:string
    }):Promise<KVListResult> {
        return this.kvListImpl(opts)
    }
}

function makeEnv (
    kvList:(opts:{
        prefix?:string
        limit?:number
        cursor?:string
    })=> Promise<KVListResult>
) {
    const kv = new MockKvNamespace(kvList)
    return {
        ADMIN_TOKEN: TEST_ADMIN_TOKEN,
        APP_ORIGIN: 'http://localhost:3000',
        SESSIONS: kv as unknown as KVNamespace,
        USER_DO: {
            idFromName: () => 'id',
            get: () => ({
                fetch: async (_request:Request) => {
                    return new Response(JSON.stringify({
                        success: true
                    }), { status: 200 })
                }
            })
        },
        NODE_ENV: 'test'
    }
}

test('AC19.1: returns cursor and list_complete when more users exist', async (t) => {
    const mockKvList = async (opts:{
        prefix?:string
        limit?:number
        cursor?:string
    }):Promise<KVListResult> => {
        const limit = opts.limit ?? 100
        const keys = Array.from({ length: limit }, (_, i) => ({
            name: `user:did:plc:user${i}`
        }))
        return {
            keys,
            list_complete: false,
            cursor: 'next-cursor-token'
        }
    }

    const env = makeEnv(mockKvList)

    // Test with default limit
    const response = await app.request(
        'http://localhost:3000/admin/refresh-all',
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
                origin: 'http://localhost:3000',
                cookie: `csrf_token=${TEST_CSRF_TOKEN}`,
                'x-csrf-token': TEST_CSRF_TOKEN
            }
        },
        env
    )

    t.equal(response.status, 200, 'returns 200')
    const data = await response.json() as Record<string, unknown>
    const results = data.results as Array<{ did:string }>
    t.equal(
        results.length,
        100,
        'default limit of 100 users processed'
    )
    t.equal(
        data.list_complete,
        false,
        'list_complete is false when more users exist'
    )
    t.equal(
        data.cursor,
        'next-cursor-token',
        'cursor returned for pagination'
    )
})

test('AC19.1: respects custom limit query param', async (t) => {
    let capturedLimit = 0
    const mockKvList = async (opts:{
        prefix?:string
        limit?:number
        cursor?:string
    }):Promise<KVListResult> => {
        capturedLimit = opts.limit ?? 100
        const keys = Array.from({ length: capturedLimit }, (_, i) => ({
            name: `user:did:plc:user${i}`
        }))
        return {
            keys,
            list_complete: true,
            cursor: undefined
        }
    }

    const env = makeEnv(mockKvList)

    const response = await app.request(
        'http://localhost:3000/admin/refresh-all?limit=50',
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
                origin: 'http://localhost:3000',
                cookie: `csrf_token=${TEST_CSRF_TOKEN}`,
                'x-csrf-token': TEST_CSRF_TOKEN
            }
        },
        env
    )

    t.equal(response.status, 200, 'returns 200')
    const data = await response.json() as Record<string, unknown>
    const results = data.results as Array<{ did:string }>
    t.equal(results.length, 50, 'respects custom limit')
    t.equal(capturedLimit, 50, 'limit passed to KV.list')
})

test('AC19.1: forwards cursor to KV.list', async (t) => {
    let capturedCursor = ''
    const mockKvList = async (opts:{
        prefix?:string
        limit?:number
        cursor?:string
    }):Promise<KVListResult> => {
        capturedCursor = opts.cursor ?? ''
        const keys = Array.from({ length: 10 }, (_, i) => ({
            name: `user:did:plc:user${i}`
        }))
        return {
            keys,
            list_complete: true,
            cursor: undefined
        }
    }

    const env = makeEnv(mockKvList)

    const response = await app.request(
        'http://localhost:3000/admin/refresh-all?cursor=from-prev-page',
        {
            method: 'POST',
            headers: {
                authorization: `Bearer ${TEST_ADMIN_TOKEN}`,
                origin: 'http://localhost:3000',
                cookie: `csrf_token=${TEST_CSRF_TOKEN}`,
                'x-csrf-token': TEST_CSRF_TOKEN
            }
        },
        env
    )

    t.equal(response.status, 200, 'returns 200')
    t.equal(
        capturedCursor,
        'from-prev-page',
        'cursor parameter forwarded to KV.list'
    )
})
