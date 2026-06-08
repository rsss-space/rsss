import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'

interface ItemRow {
    id:number
    feed_id:number
    guid:string
    full_content:string|null
    full_content_fetched_at:string|null
    full_content_status:string|null
}

interface QueryResult {
    toArray:() => unknown[]
    one:() => unknown | null
}

function result (rows:unknown[]):QueryResult {
    return {
        toArray () { return rows },
        one () { return rows[0] || null }
    }
}

function makeItem (overrides:Partial<ItemRow> = {}):ItemRow {
    return {
        id: 1,
        feed_id: 1,
        guid: 'g1',
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null,
        ...overrides
    }
}

function createSql (items:ItemRow[]) {
    let versionBumped = false
    return {
        items,
        get versionBumped () { return versionBumped },
        exec (query:string, ...params:unknown[]) {
            const q = query.replace(/\s+/g, ' ').trim()

            if (q.includes('UPDATE user_state SET feed_version')) {
                versionBumped = true
                return result([{ feed_version: 1 }])
            }

            const fullUpdateMatch = q.match(
                /^UPDATE items SET full_content = \?, full_content_fetched_at = \?, full_content_status = \? WHERE id = \?$/
            )
            if (fullUpdateMatch) {
                const [html, fetchedAt, status, id] = params as [
                    string, string, string, number
                ]
                const item = items.find(i => i.id === id)
                if (item) {
                    item.full_content = html
                    item.full_content_fetched_at = fetchedAt
                    item.full_content_status = status
                }
                return result([])
            }

            const failUpdateMatch = q.match(
                /^UPDATE items SET full_content_fetched_at = datetime\('now'\), full_content_status = \? WHERE id = \?$/
            )
            if (failUpdateMatch) {
                const [status, id] = params as [string, number]
                const item = items.find(i => i.id === id)
                if (item) {
                    item.full_content_fetched_at = '2026-05-01 12:00:00'
                    item.full_content_status = status
                }
                return result([])
            }

            throw new Error(`Unexpected SQL: ${q}`)
        }
    }
}

type MockSql = ReturnType<typeof createSql>

function createHarness (items:ItemRow[]) {
    const sql = createSql(items)
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:MockSql
        ctx:{ storage:object; waitUntil:(p:Promise<unknown>) => void }
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }
    userDo.sql = sql
    userDo.ctx = {
        storage: {},
        waitUntil () {}
    }
    return {
        app: userDo.createRouter(),
        items,
        sql
    }
}

test('store-full-content - 204 + saves html when status is succeeded',
    async t => {
        const { app, items, sql } = createHarness([makeItem()])
        const r = await app.request(
            '/internal/full-content/items/1',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    status: 'succeeded',
                    html: '<p>body</p>',
                    fetchedAt: '2026-05-01 12:00:00'
                })
            }
        )
        t.equal(r.status, 204, '204 No Content')
        t.equal(items[0].full_content, '<p>body</p>', 'html stored')
        t.equal(
            items[0].full_content_status,
            'succeeded',
            'status stored'
        )
        t.equal(
            items[0].full_content_fetched_at,
            '2026-05-01 12:00:00',
            'fetched_at stored'
        )
        t.equal(sql.versionBumped, true, 'feed version bumped')
    }
)

test('store-full-content - 204 + preserves prior html on failure',
    async t => {
        const { app, items, sql } = createHarness([
            makeItem({ full_content: '<p>old</p>' })
        ])
        const r = await app.request(
            '/internal/full-content/items/1',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: 'failed_network' })
            }
        )
        t.equal(r.status, 204, '204 No Content')
        t.equal(
            items[0].full_content,
            '<p>old</p>',
            'prior html preserved'
        )
        t.equal(
            items[0].full_content_status,
            'failed_network',
            'failure status stored'
        )
        t.equal(sql.versionBumped, true, 'feed version bumped')
    }
)

test('store-full-content - 204 + no html written when html is empty',
    async t => {
        const { app, items } = createHarness([makeItem()])
        const r = await app.request(
            '/internal/full-content/items/1',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ status: 'failed_no_body', html: '' })
            }
        )
        t.equal(r.status, 204, '204 No Content')
        t.equal(items[0].full_content, null, 'html not written on empty string')
    }
)

test('store-full-content - 400 on id = 0', async t => {
    const { app } = createHarness([makeItem()])
    const r = await app.request(
        '/internal/full-content/items/0',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'succeeded' })
        }
    )
    t.equal(r.status, 400, '400 on id=0')
})

test('store-full-content - 400 on non-integer id', async t => {
    const { app } = createHarness([makeItem()])
    const r = await app.request(
        '/internal/full-content/items/abc',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'succeeded' })
        }
    )
    t.equal(r.status, 400, '400 on non-integer id')
})

test('store-full-content - 400 on invalid status', async t => {
    const { app } = createHarness([makeItem()])
    const r = await app.request(
        '/internal/full-content/items/1',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ status: 'not_a_real_status' })
        }
    )
    t.equal(r.status, 400, '400 on invalid status')
})

test('store-full-content - 400 on missing status', async t => {
    const { app } = createHarness([makeItem()])
    const r = await app.request(
        '/internal/full-content/items/1',
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ html: '<p>body</p>' })
        }
    )
    t.equal(r.status, 400, '400 on missing status')
})

test('store-full-content - uses datetime(now) for fetchedAt when omitted',
    async t => {
        const { app, items } = createHarness([makeItem()])
        const r = await app.request(
            '/internal/full-content/items/1',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    status: 'succeeded',
                    html: '<p>body</p>'
                })
            }
        )
        t.equal(r.status, 204, '204 No Content')
        t.ok(
            typeof items[0].full_content_fetched_at === 'string' &&
            items[0].full_content_fetched_at.length > 0,
            'fetchedAt falls back to a non-empty string'
        )
    }
)
