import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import type { FetchFullArticleResult } from '../src/server/article-fetch.js'

interface ItemRow {
    id:number
    feed_id:number
    guid:string
    title:string|null
    link:string|null
    description:string|null
    content:string|null
    author:string|null
    pub_date:string|null
    thumbnail_url:string|null
    is_read:number
    is_starred:number
    created_at:string
    updated_at:string
    full_content:string|null
    full_content_fetched_at:string|null
    full_content_status:string|null
    full_content_images:string|null
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
        title: 't',
        link: 'https://example.com/post',
        description: 'd',
        content: null,
        author: null,
        pub_date: null,
        thumbnail_url: null,
        is_read: 0,
        is_starred: 0,
        created_at: '2026-04-26 00:00:00',
        updated_at: '2026-04-26 00:00:00',
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null,
        full_content_images: null,
        ...overrides
    }
}

function createSql (items:ItemRow[]) {
    return {
        items,
        exec (query:string, ...params:unknown[]) {
            const q = query.replace(/\s+/g, ' ').trim()

            if (q.startsWith('SELECT') &&
                q.includes('FROM items WHERE id = ?')) {
                const id = params[0] as number
                return result(items.filter(i => i.id === id))
            }

            const updateMatch = q.match(/^UPDATE items SET (.+) WHERE id = \?$/)
            if (updateMatch) {
                const setClause = updateMatch[1]
                const id = params[params.length - 1] as number
                const item = items.find(i => i.id === id)
                if (!item) return result([])

                const assignments = setClause.split(',').map(s => s.trim())
                let pIdx = 0
                for (const a of assignments) {
                    const m = a.match(/^(\w+)\s*=\s*(\?|datetime\('now'\))$/)
                    if (!m) continue
                    const col = m[1]
                    const valuePart = m[2]
                    let value:unknown
                    if (valuePart === "datetime('now')") {
                        value = '2026-05-01 12:00:00'
                    } else {
                        value = params[pIdx++]
                    }
                    ;(item as unknown as Record<string, unknown>)[col] = value
                }
                return result([])
            }

            throw new Error(`Unexpected SQL: ${q}`)
        }
    }
}

interface FakeQueue {
    calls:number
    sent:unknown[]
    send:(message:unknown) => Promise<unknown>
}

function captureQueue ():FakeQueue {
    const q:FakeQueue = {
        calls: 0,
        sent: [],
        async send (message:unknown) {
            q.calls++
            q.sent.push(message)
        }
    }
    return q
}

function throwingQueue ():FakeQueue {
    const q:FakeQueue = {
        calls: 0,
        sent: [],
        async send () {
            q.calls++
            throw new Error('queue down')
        }
    }
    return q
}

function createHarness (
    items:ItemRow[],
    fetchResult:FetchFullArticleResult|null,
    queue:FakeQueue = captureQueue()
) {
    const sql = createSql(items)
    const storage = new Map<string, unknown>()
    const fetcher = { calls: 0, next: fetchResult }
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createSql>
        env:{ BLURHASH_QUEUE:FakeQueue }
        ctx:{
            id:{ toString:() => string }
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:(key:string, value:unknown) => Promise<void>
                delete:(key:string) => Promise<void>
            }
            waitUntil:(promise:Promise<unknown>) => void
        }
        doFetchFullArticle:(link:string) => Promise<FetchFullArticleResult>
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }

    userDo.sql = sql
    userDo.env = { BLURHASH_QUEUE: queue }
    userDo.ctx = {
        id: { toString: () => 'test-do-id' },
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put (key:string, value:unknown) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            }
        },
        waitUntil () {}
    }
    userDo.doFetchFullArticle = async (_link:string) => {
        fetcher.calls++
        if (!fetcher.next) {
            throw new Error('no fetch result configured')
        }
        return fetcher.next
    }

    return {
        app: userDo.createRouter(),
        items,
        fetcher,
        queue,
        storage
    }
}

interface BodyBlurMessage {
    imageUrl:string
    itemId:number
    objectId:string
    target:string
}

test('fetch-full fresh fetch enqueues one body blur job per image',
    async t => {
        const items = [makeItem()]
        const { app, queue, fetcher } = createHarness(items, {
            status: 'succeeded',
            html: '<img src="https://img.example.com/a.jpg">' +
                '<img src="https://img.example.com/b.png">',
            fetchedAt: '2026-05-01 12:00:00'
        })

        const r = await app.request('/items/1/fetch-full', { method: 'POST' })

        t.equal(r.status, 200, '200 OK')
        t.equal(fetcher.calls, 1, 'fetched once')
        t.equal(queue.sent.length, 2, 'one blur job per image')
        const first = queue.sent[0] as BodyBlurMessage
        t.equal(first.imageUrl, 'https://img.example.com/a.jpg', 'imageUrl')
        t.equal(first.itemId, 1, 'itemId is the route id')
        t.equal(first.objectId, 'test-do-id', 'objectId is the DO id')
        t.equal(first.target, 'body', 'target is body')
    }
)

test('fetch-full failure status enqueues nothing', async t => {
    const items = [makeItem()]
    const { app, queue, fetcher } = createHarness(items, {
        status: 'failed_status'
    })

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })

    t.equal(r.status, 200, '200 OK (failure recorded inline)')
    t.equal(fetcher.calls, 1, 'fetch attempted')
    t.equal(queue.sent.length, 0, 'no blur jobs on failure')
})

test('fetch-full cache hit with empty blur map lazy-fills', async t => {
    const items = [makeItem({
        full_content: '<img src="https://img.example.com/a.jpg">',
        full_content_status: 'succeeded',
        full_content_fetched_at: '2026-04-30 10:00:00',
        full_content_images: null
    })]
    const { app, queue, fetcher } = createHarness(items, null)

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })

    t.equal(r.status, 200, '200 OK')
    t.equal(fetcher.calls, 0, 'no re-fetch on cache hit')
    t.equal(queue.sent.length, 1, 'lazy-fill enqueues from stored html')
    const msg = queue.sent[0] as BodyBlurMessage
    t.equal(msg.itemId, 1, 'itemId is the route id')
    t.equal(msg.objectId, 'test-do-id', 'objectId is the DO id')
    t.equal(msg.target, 'body', 'target is body')
})

test('fetch-full cache hit with populated blur map enqueues nothing',
    async t => {
        const populated = JSON.stringify({
            'https://img.example.com/a.jpg': {
                blurhash: 'LEHV6nWB',
                width: 100,
                height: 100
            }
        })
        const items = [makeItem({
            full_content: '<img src="https://img.example.com/a.jpg">',
            full_content_status: 'succeeded',
            full_content_fetched_at: '2026-04-30 10:00:00',
            full_content_images: populated
        })]
        const { app, queue, fetcher } = createHarness(items, null)

        const r = await app.request('/items/1/fetch-full', { method: 'POST' })

        t.equal(r.status, 200, '200 OK')
        t.equal(fetcher.calls, 0, 'no re-fetch on cache hit')
        t.equal(queue.sent.length, 0, 'no lazy-fill when map populated')
    }
)

test('fetch-full returns 200 even if blur enqueue throws', async t => {
    const items = [makeItem()]
    const { app, queue, fetcher } = createHarness(
        items,
        {
            status: 'succeeded',
            html: '<img src="https://img.example.com/a.jpg">',
            fetchedAt: '2026-05-01 12:00:00'
        },
        throwingQueue()
    )

    const r = await app.request('/items/1/fetch-full', { method: 'POST' })
    const body = await r.json() as { item:{ id:number } }

    t.equal(r.status, 200, '200 OK despite enqueue failure')
    t.equal(body.item.id, 1, 'item still returned')
    t.equal(fetcher.calls, 1, 'fetched once')
    t.ok(queue.calls >= 1, 'enqueue was attempted')
})
