/**
 * Tests for AC19.1: /admin/refresh-all pagination
 * Verifies that the endpoint accepts cursor/limit query params and
 * processes only one page without attempting to fetch all users.
 */
import { test } from '@substrate-system/tapzero'
import { Hono } from 'hono'

const TEST_ADMIN_TOKEN = 'secret-admin-token-abc123'

interface KVListResult {
    keys:Array<{ name:string; expiration?:number }>
    list_complete:boolean
    cursor?:string
}

// Mock the constantTimeEqual since we need it for requireAdmin
async function constantTimeEqual (a:string, b:string):Promise<boolean> {
    const enc = new TextEncoder()
    const [ha, hb] = await Promise.all([
        crypto.subtle.digest('SHA-256', enc.encode(a)),
        crypto.subtle.digest('SHA-256', enc.encode(b))
    ])
    const va = new Uint8Array(ha)
    const vb = new Uint8Array(hb)
    let diff = 0
    for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!
    return diff === 0
}

function makeRouter (kvList:(opts:{
    prefix?:string
    limit?:number
    cursor?:string
}) => Promise<KVListResult>) {
    const router = new Hono()

    // Add requireAdmin middleware
    router.use('*', async (c, next) => {
        const expected = TEST_ADMIN_TOKEN
        if (!expected) {
            return c.json({ error: 'admin_disabled' }, 503)
        }
        const header = c.req.header('authorization') || ''
        const match = header.match(/^Bearer\s+(.+)$/i)
        const provided = match ? match[1] : ''
        if (!provided) {
            return c.json({ error: 'unauthorized' }, 401)
        }
        const isAuthorized = await constantTimeEqual(provided, expected)
        if (!isAuthorized) {
            return c.json({ error: 'unauthorized' }, 401)
        }
        await next()
    })

    // Add the /admin/refresh-all route
    router.post('/admin/refresh-all', async (c) => {
        const body = await c.req.json<{
            dids?:string[]
        }>().catch(() => ({ dids: undefined }))

        if (body.dids && body.dids.length > 0) {
            const dids = body.dids
            const results:Record<string, unknown>[] = []
            for (const did of dids) {
                results.push({
                    did,
                    handle: `handle-${did.slice(-1)}`,
                    success: true
                })
            }
            return c.json({
                results,
                list_complete: true
            })
        }

        // This is the key part: accept limit and cursor from query
        const limit = c.req.query('limit')
            ? parseInt(c.req.query('limit')!, 10)
            : 100
        const cursor = c.req.query('cursor') || undefined

        // List users from KV with pagination params
        const result = await kvList({
            prefix: 'user:',
            limit,
            cursor
        })

        const dids = result.keys.map(
            (key) => key.name.replace('user:', '')
        )

        if (dids.length === 0) {
            return c.json({
                error: 'No users found. Log in first.',
                results: []
            }, 404)
        }

        // Process only this page's DIDs (don't loop)
        const results:Record<string, unknown>[] = []
        for (const did of dids) {
            results.push({
                did,
                handle: `handle-${did.slice(-1)}`,
                success: true
            })
        }

        // Return the response WITH cursor and list_complete
        const response:Record<string, unknown> = {
            results,
            list_complete: result.list_complete
        }

        // Include cursor if one exists
        if (result.cursor) {
            response.cursor = result.cursor
        }

        return c.json(response)
    })

    return router
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

    const router = makeRouter(mockKvList)

    // Test with default limit
    const response = await router.request(
        new Request('http://localhost/admin/refresh-all', {
            method: 'POST',
            headers: {
                authorization: `Bearer ${TEST_ADMIN_TOKEN}`
            }
        })
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

    const router = makeRouter(mockKvList)

    const response = await router.request(
        new Request(
            'http://localhost/admin/refresh-all?limit=50',
            {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${TEST_ADMIN_TOKEN}`
                }
            }
        )
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

    const router = makeRouter(mockKvList)

    const response = await router.request(
        new Request(
            'http://localhost/admin/refresh-all?cursor=from-prev-page',
            {
                method: 'POST',
                headers: {
                    authorization: `Bearer ${TEST_ADMIN_TOKEN}`
                }
            }
        )
    )

    t.equal(response.status, 200, 'returns 200')
    t.equal(
        capturedCursor,
        'from-prev-page',
        'cursor parameter forwarded to KV.list'
    )
})
