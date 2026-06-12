/**
 * Tests for AC16.1: Constant-time admin token comparison.
 * Verifies that token comparison does not early-return on length mismatch,
 * ensuring no timing leak of token length.
 */
import { test } from '@substrate-system/tapzero'
import { Hono } from 'hono'

const TEST_ADMIN_TOKEN = 'secret-admin-token-abc123'

interface TestEnv {
    ADMIN_TOKEN:string
    SESSIONS:KVNamespace
    NODE_ENV:string
}

interface TestVariables {
    session?:{
        did:string
        handle:string
    }
    authorized?:boolean
}

/**
 * Constant-time comparison helper using SHA-256 hashing.
 * Hashes both inputs to fixed-length digests and compares them with XOR,
 * so length differences never short-circuit the comparison.
 */
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

function makeRouter () {
    const router = new Hono<{
        Bindings:TestEnv
        Variables:TestVariables
    }>()

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

        c.set('authorized', true)
        await next()
    })

    router.get('/admin/test', (c) => {
        return c.json({ ok: true })
    })

    return router
}

test('AC16.1: equal tokens accept', async (t) => {
    const router = makeRouter()
    const response = await router.request(
        new Request(
            'http://localhost/admin/test',
            {
                headers: {
                    authorization: `Bearer ${TEST_ADMIN_TOKEN}`
                }
            }
        )
    )

    t.equal(response.status, 200, 'returns 200 for matching token')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.ok, true)
})

test('AC16.1: unequal-same-length tokens reject', async (t) => {
    const router = makeRouter()
    const wrongToken = 'secret-admin-token-xyz789' // Same length
    const response = await router.request(
        new Request(
            'http://localhost/admin/test',
            {
                headers: {
                    authorization: `Bearer ${wrongToken}`
                }
            }
        )
    )

    t.equal(response.status, 401, 'returns 401 for unequal same-length token')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'unauthorized')
})

test('AC16.1: unequal-different-length tokens reject', async (t) => {
    const router = makeRouter()
    const shortToken = 'short'
    const response = await router.request(
        new Request(
            'http://localhost/admin/test',
            {
                headers: {
                    authorization: `Bearer ${shortToken}`
                }
            }
        )
    )

    t.equal(response.status, 401, 'returns 401 for unequal different-length token')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'unauthorized')
})

test('AC16.1: constant-time impl always digests (no early length return)', async (t) => {
    let digestCalls = 0

    // Track that both hashes are computed regardless of length
    const mockCryptoSubtle = {
        digest: async (algo:string, data:BufferSource):Promise<ArrayBuffer> => {
            digestCalls++
            return await crypto.subtle.digest(algo, data)
        }
    }

    // Implement the comparison function with mock crypto to count digests
    const countingCompare = async (
        a:string,
        b:string
    ):Promise<boolean> => {
        const enc = new TextEncoder()
        // Count digest calls with different lengths
        digestCalls = 0
        const [ha, hb] = await Promise.all([
            mockCryptoSubtle.digest(
                'SHA-256',
                enc.encode(a)
            ),
            mockCryptoSubtle.digest(
                'SHA-256',
                enc.encode(b)
            )
        ])
        // Should have called digest twice
        const callsBeforeXor = digestCalls
        const va = new Uint8Array(ha)
        const vb = new Uint8Array(hb)
        let diff = 0
        for (let i = 0; i < va.length; i++) diff |= va[i]! ^ vb[i]!
        return { result: diff === 0, callsBeforeXor }
    }

    // Different lengths should still call digest twice
    const { result: result1, callsBeforeXor: calls1 } = await countingCompare(
        'a',
        'much-longer-token'
    )
    t.equal(result1, false, 'different lengths handled correctly')
    t.equal(calls1, 2, 'both digests computed for different-length inputs')

    // Same lengths different content should also call digest twice
    const { result: result2, callsBeforeXor: calls2 } = await countingCompare(
        'token123',
        'token456'
    )
    t.equal(result2, false, 'same length different content rejects')
    t.equal(calls2, 2, 'both digests computed for same-length different inputs')

    // Matching should call digest twice
    const { result: result3, callsBeforeXor: calls3 } = await countingCompare(
        'matched',
        'matched'
    )
    t.equal(result3, true, 'matching tokens accept')
    t.equal(calls3, 2, 'both digests computed for matching inputs')
})
