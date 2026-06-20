import { test } from '@substrate-system/tapzero'
import { fakeResult, type FakeQueryResult } from './helpers/sql-fake.js'
import { RsssIndexerDO, type IndexItem } from '../src/server/durable-objects/indexer.js'

interface IndexerTestOptions {
    nodeEnv?:string
    items?:IndexItem[]
}

function createIndexerHarness (opts?:IndexerTestOptions) {
    const items = opts?.items ?? []
    let capturedQuery:string = ''
    let capturedBinds:unknown[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const indexerDo = Object.create(RsssIndexerDO.prototype) as any

    // Set env (normally set by DurableObject constructor)
    indexerDo.env = {
        NODE_ENV: opts?.nodeEnv || 'development'
    }

    // Create a fake sql.exec that captures query and binds.
    // Must return a single FakeQueryResult type for consistency.
    indexerDo.sql = {
        exec (
            query:string,
            ...binds:unknown[]
        ):FakeQueryResult<Record<string, unknown>> {
            capturedQuery = query
            capturedBinds = binds
            return fakeResult(
                items as unknown as Array<Record<string, unknown>>
            )
        }
    }

    return {
        indexerDo,
        getCapturedQuery: () => capturedQuery,
        getCapturedBinds: () => capturedBinds
    }
}

// AC5.1: read returns items with parsed record, ordered by time_us DESC
test('AC5.1: returns items with parsed record, ordered DESC',
    async t => {
        const testItems:IndexItem[] = [
            {
                uri: 'at://did:plc:user1/space.rsss.graph.follow/abc1',
                did: 'did:plc:user1',
                collection: 'space.rsss.graph.follow',
                rkey: 'abc1',
                cid: 'bafy123abc',
                record: '{"subject":"did:plc:followee1","createdAt":"2026-01-01T00:00:00.000Z"}',
                time_us: 1000000,
                indexed_at: Date.now()
            },
            {
                uri: 'at://did:plc:user1/space.rsss.graph.follow/abc2',
                did: 'did:plc:user1',
                collection: 'space.rsss.graph.follow',
                rkey: 'abc2',
                cid: 'bafy123def',
                record: '{"subject":"did:plc:followee2","createdAt":"2026-01-02T00:00:00.000Z"}',
                time_us: 2000000,
                indexed_at: Date.now()
            }
        ]

        const { indexerDo, getCapturedQuery } =
            createIndexerHarness({ items: testItems })

        const res = await indexerDo.createRouter().request(
            '/internal/index/feed',
            { method: 'GET' }
        )

        t.equal(res.status, 200, 'returns 200')

        const body = await res.json() as {
            items?: Array<{ record?: unknown }>
        }
        t.ok(body.items, 'response has items array')
        t.equal(body.items?.length, 2, 'returns 2 items')

        // Verify record is parsed (object, not string)
        t.ok(typeof body.items?.[0]?.record === 'object',
            'first item record is parsed object')
        t.ok(body.items?.[0]?.record &&
                typeof body.items[0].record === 'object' &&
                'subject' in body.items[0].record,
        'parsed record contains expected field')

        // Verify ORDER BY time_us DESC is in query
        const query = getCapturedQuery()
        t.ok(query.includes('ORDER BY time_us DESC'),
            'query includes ORDER BY time_us DESC')

        // Verify no WHERE clause (no filters)
        t.ok(!query.includes('WHERE'),
            'query has no WHERE clause for unfiltered request')
    }
)

// AC5.2: collection filter
test('AC5.2: collection filter constrains with collection = ?',
    async t => {
        const testItems:IndexItem[] = [
            {
                uri: 'at://did:plc:user1/space.rsss.graph.follow/abc1',
                did: 'did:plc:user1',
                collection: 'space.rsss.graph.follow',
                rkey: 'abc1',
                cid: 'bafy123',
                record: '{}',
                time_us: 1000000,
                indexed_at: Date.now()
            }
        ]

        const { indexerDo, getCapturedQuery, getCapturedBinds } =
            createIndexerHarness({ items: testItems })

        const res = await indexerDo.createRouter().request(
            '/internal/index/feed?collection=space.rsss.graph.follow',
            { method: 'GET' }
        )

        t.equal(res.status, 200, 'returns 200')

        const query = getCapturedQuery()
        const binds = getCapturedBinds()

        t.ok(query.includes('collection = ?'),
            'query contains collection = ?')
        t.equal(binds[0], 'space.rsss.graph.follow',
            'first bind is the collection value')
    }
)

// AC5.3: did filter
test('AC5.3: did filter constrains with did = ?',
    async t => {
        const testItems:IndexItem[] = [
            {
                uri: 'at://did:plc:abc/space.rsss.graph.follow/xyz',
                did: 'did:plc:abc',
                collection: 'space.rsss.graph.follow',
                rkey: 'xyz',
                cid: 'bafy456',
                record: '{}',
                time_us: 1500000,
                indexed_at: Date.now()
            }
        ]

        const { indexerDo, getCapturedQuery, getCapturedBinds } =
            createIndexerHarness({ items: testItems })

        const res = await indexerDo.createRouter().request(
            '/internal/index/feed?did=did:plc:abc',
            { method: 'GET' }
        )

        t.equal(res.status, 200, 'returns 200')

        const query = getCapturedQuery()
        const binds = getCapturedBinds()

        t.ok(query.includes('did = ?'),
            'query contains did = ?')
        t.equal(binds[0], 'did:plc:abc',
            'first bind is the did value')
    }
)

// AC5.3: both collection and did filters
test('AC5.3: both filters => WHERE collection = ? AND did = ?',
    async t => {
        const testItems:IndexItem[] = []

        const { indexerDo, getCapturedQuery, getCapturedBinds } =
            createIndexerHarness({ items: testItems })

        const res = await indexerDo.createRouter().request(
            '/internal/index/feed?collection=space.rsss.graph.follow&did=did:plc:xyz',
            { method: 'GET' }
        )

        t.equal(res.status, 200, 'returns 200')

        const query = getCapturedQuery()
        const binds = getCapturedBinds()

        t.ok(query.includes('WHERE collection = ? AND did = ?'),
            'query contains WHERE collection = ? AND did = ?')
        t.equal(binds[0], 'space.rsss.graph.follow',
            'first bind is collection')
        t.equal(binds[1], 'did:plc:xyz',
            'second bind is did')
    }
)

// AC5.4: limit default and clamping
test('AC5.4: default limit is 50',
    async t => {
        const { indexerDo, getCapturedBinds } =
            createIndexerHarness({ items: [] })

        await indexerDo.createRouter().request(
            '/internal/index/feed',
            { method: 'GET' }
        )

        const binds = getCapturedBinds()
        t.equal(binds[binds.length - 1], 50,
            'final bind (limit) is 50')
    }
)

test('AC5.4: ?limit=500 clamps to 200',
    async t => {
        const { indexerDo, getCapturedBinds } =
            createIndexerHarness({ items: [] })

        await indexerDo.createRouter().request(
            '/internal/index/feed?limit=500',
            { method: 'GET' }
        )

        const binds = getCapturedBinds()
        t.equal(binds[binds.length - 1], 200,
            'final bind (limit) is clamped to 200')
    }
)

test('AC5.4: ?limit=abc falls back to 50',
    async t => {
        const { indexerDo, getCapturedBinds } =
            createIndexerHarness({ items: [] })

        await indexerDo.createRouter().request(
            '/internal/index/feed?limit=abc',
            { method: 'GET' }
        )

        const binds = getCapturedBinds()
        t.equal(binds[binds.length - 1], 50,
            'final bind (limit) is 50 (fallback for invalid input)')
    }
)

test('AC5.4: limit is the final bind',
    async t => {
        const { indexerDo, getCapturedBinds } =
            createIndexerHarness({ items: [] })

        await indexerDo.createRouter().request(
            '/internal/index/feed?collection=X&did=Y&limit=75',
            { method: 'GET' }
        )

        const binds = getCapturedBinds()
        t.equal(binds.length, 3, 'has 3 binds (collection, did, limit)')
        t.equal(binds[0], 'X', 'first bind is collection')
        t.equal(binds[1], 'Y', 'second bind is did')
        t.equal(binds[2], 75, 'final bind is limit')
    }
)
