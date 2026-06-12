/**
 * Tests for AC17.1: Numeric id route params return 400 (not 404) on invalid input
 *
 * Verifies that the REAL parseIdParam function (used by all DO routes)
 * correctly rejects non-numeric, <= 0, and noncanonical id parameters.
 */
import { test } from '@substrate-system/tapzero'
import { parseIdParam } from '../src/server/durable-objects/index.js'
import { Hono } from 'hono'

test('AC17.1: parseIdParam rejects non-numeric id', async (t) => {
    const result = parseIdParam('abc')
    t.equal(result, null, 'non-numeric returns null')
})

test('AC17.1: parseIdParam rejects id <= 0', async (t) => {
    const result = parseIdParam('0')
    t.equal(result, null, 'zero returns null')

    const negResult = parseIdParam('-1')
    t.equal(negResult, null, 'negative returns null')
})

test('AC17.1: parseIdParam rejects noncanonical id', async (t) => {
    const result = parseIdParam('01')
    t.equal(result, null, 'leading zero returns null')

    const secondZero = parseIdParam('001')
    t.equal(secondZero, null, 'multiple leading zeros return null')
})

test('AC17.1: parseIdParam accepts valid ids', async (t) => {
    const result = parseIdParam('1')
    t.equal(result, 1, 'valid positive id accepted')

    const bigId = parseIdParam('999')
    t.equal(bigId, 999, 'large id accepted')
})

test('AC17.1: routes using parseIdParam reject invalid id with 400', async (t) => {
    // Demonstrate that routes using parseIdParam correctly return 400
    const app = new Hono()

    app.get('/feeds/:id', (c) => {
        const id = parseIdParam(c.req.param('id'))
        if (id === null) {
            return c.json({ error: 'invalid_id' }, 400)
        }
        return c.json({ feed: { id } })
    })

    const response = await app.request(
        new Request('http://localhost/feeds/abc')
    )

    t.equal(response.status, 400, 'route returns 400 for non-numeric id')
    const data = await response.json() as Record<string, unknown>
    t.equal(data.error, 'invalid_id')
})

test('AC17.1: routes using parseIdParam route valid id normally', async (t) => {
    const app = new Hono()

    app.get('/feeds/:id', (c) => {
        const id = parseIdParam(c.req.param('id'))
        if (id === null) {
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
