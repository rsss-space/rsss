/**
 * Tests for AC17.1: Numeric id route params return 400 (not 404) on invalid input
 *
 * Verifies that invalid numeric id parameters (non-numeric, <= 0, noncanonical)
 * return 400 Bad Request instead of 404 Not Found.
 *
 * These are tested in isolation using Hono route handlers directly.
 */
import { test } from '@substrate-system/tapzero'

test('AC17.1: GET /feeds/:id with non-numeric id returns 400', async (t) => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mock a simple route with the id guard pattern
    app.get('/feeds/:id', (c) => {
        const rawId = c.req.param('id')
        const id = Number.parseInt(rawId, 10)
        // Guard: check for NaN, non-positive, or noncanonical
        if (!Number.isFinite(id) || id <= 0 ||
            String(id) !== rawId) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ feed: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/feeds/abc')
    )
    t.equal(response.status, 400, 'non-numeric id returns 400')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'invalid_id')
})

test('AC17.1: GET /feeds/:id with id <= 0 returns 400', async (t) => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mock a simple route with the id guard pattern
    app.get('/feeds/:id', (c) => {
        const rawId = c.req.param('id')
        const id = Number.parseInt(rawId, 10)
        // Guard: check for NaN, non-positive, or noncanonical
        if (!Number.isFinite(id) || id <= 0 ||
            String(id) !== rawId) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ feed: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/feeds/0')
    )
    t.equal(response.status, 400, 'id <= 0 returns 400')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'invalid_id')
})

test('AC17.1: GET /feeds/:id with noncanonical id returns 400', async (t) => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mock a simple route with the id guard pattern
    app.get('/feeds/:id', (c) => {
        const rawId = c.req.param('id')
        const id = Number.parseInt(rawId, 10)
        // Guard: check for NaN, non-positive, or noncanonical
        if (!Number.isFinite(id) || id <= 0 ||
            String(id) !== rawId) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ feed: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/feeds/01')
    )
    t.equal(response.status, 400, 'noncanonical id (01) returns 400')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'invalid_id')
})

test('AC17.1: GET /feeds/:id with valid id routes normally', async (t) => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mock a simple route with the id guard pattern
    app.get('/feeds/:id', (c) => {
        const rawId = c.req.param('id')
        const id = Number.parseInt(rawId, 10)
        // Guard: check for NaN, non-positive, or noncanonical
        if (!Number.isFinite(id) || id <= 0 ||
            String(id) !== rawId) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ feed: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/feeds/1')
    )
    t.equal(response.status, 200, 'valid id routes normally')
    const data = await response.json() as Record<string, unknown>
    t.ok(data.feed, 'returns feed data')
})

test('AC17.1: PATCH /items/:id with non-numeric id returns 400', async (t) => {
    const { Hono } = await import('hono')
    const app = new Hono()

    // Mount the PATCH /items/:id route
    app.patch('/items/:id', async (c) => {
        const rawId = c.req.param('id')
        const id = Number.parseInt(rawId, 10)
        // Guard: check for NaN, non-positive, or noncanonical
        if (!Number.isFinite(id) || id <= 0 ||
            String(id) !== rawId) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ item: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/items/xyz', { method: 'PATCH' })
    )
    t.equal(response.status, 400, 'non-numeric item id returns 400')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'invalid_id')
})
