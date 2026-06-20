import { test } from '@substrate-system/tapzero'
import { applyCommit } from '../src/server/indexer/apply-commit.js'
import type {
    JetstreamEvent
} from '../src/server/indexer/types.js'
import { fakeResult } from './helpers/sql-fake.js'

/**
 * Hand-rolled fake SqlStorage that records every exec call
 */
interface RecordedCall {
    query:string;
    binds:unknown[]
}

class FakeSqlStorage {
    calls:RecordedCall[] = []

    exec (query:string, ...binds:unknown[]): {toArray():unknown[]; one():unknown} {
        this.calls.push({ query, binds })
        return fakeResult([])
    }
}

// Valid space.rsss.feed.subscription record for testing
const validSubscriptionRecord = {
    feedUrl: 'https://example.com/feed.xml',
    createdAt: '2025-01-01T00:00:00.000Z'
}

test('scheduled-drain.AC2.1: create→upsert', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 1000000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey',
            cid: 'bafy123test',
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 1, 'exactly one exec call')

    const call = fake.calls[0]!
    t.ok(
        /INSERT INTO items/.test(call.query),
        'query contains INSERT INTO items'
    )
    t.ok(
        /ON CONFLICT\(uri\) DO UPDATE/.test(call.query),
        'query contains ON CONFLICT(uri) DO UPDATE'
    )

    const expectedUri = 'at://did:web:example.com/space.rsss.feed.subscription/test-rkey'
    t.deepEqual(call.binds[0], expectedUri, 'bind[0] is correct uri')
    t.deepEqual(call.binds[1], 'did:web:example.com', 'bind[1] is did')
    t.deepEqual(call.binds[2], 'space.rsss.feed.subscription', 'bind[2] is collection')
    t.deepEqual(call.binds[3], 'test-rkey', 'bind[3] is rkey')
    t.deepEqual(call.binds[4], 'bafy123test', 'bind[4] is cid')
    t.deepEqual(
        call.binds[5],
        JSON.stringify(validSubscriptionRecord),
        'bind[5] is JSON stringified record'
    )
    t.deepEqual(call.binds[6], 1000000000000, 'bind[6] is time_us')
    t.ok(typeof call.binds[7] === 'number', 'bind[7] is a number (Date.now())')
})

test('scheduled-drain.AC2.2: update→upsert', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 2000000000000,
        kind: 'commit',
        commit: {
            operation: 'update',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-2',
            cid: 'bafy456test',
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 1, 'exactly one exec call')

    const call = fake.calls[0]!
    t.ok(
        /INSERT INTO items/.test(call.query),
        'query contains INSERT INTO items'
    )
    t.ok(
        /ON CONFLICT\(uri\) DO UPDATE/.test(call.query),
        'query contains ON CONFLICT(uri) DO UPDATE'
    )

    const expectedUri = 'at://did:web:example.com/space.rsss.feed.subscription/test-rkey-2'
    t.deepEqual(call.binds[0], expectedUri, 'bind[0] is correct uri')
})

test('scheduled-drain.AC2.3: delete→delete', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 3000000000000,
        kind: 'commit',
        commit: {
            operation: 'delete',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-3'
            // no cid, no record on delete
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 1, 'exactly one exec call')

    const call = fake.calls[0]!
    t.deepEqual(
        call.query,
        'DELETE FROM items WHERE uri = ?',
        'query is exact DELETE statement'
    )

    const expectedUri = 'at://did:web:example.com/space.rsss.feed.subscription/test-rkey-3'
    t.deepEqual(call.binds, [expectedUri], 'binds are [uri]')
})

test('scheduled-drain.AC2.4: off-lexicon drop (unknown collection)', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 4000000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.post', // unknown collection
            rkey: 'test-rkey-4',
            cid: 'bafy789test',
            record: { some: 'data' }
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 0, 'zero exec calls for unknown collection')
})

test('scheduled-drain.AC2.4b: off-lexicon drop (invalid record)', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    // Valid collection but missing required 'createdAt' field
    const invalidRecord = {
        feedUrl: 'https://example.com/feed.xml'
        // missing createdAt
    }

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 4500000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-4b',
            cid: 'bafy999test',
            record: invalidRecord
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 0, 'zero exec calls for invalid record')
})

test('scheduled-drain.AC2.5: uri format', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:plc:abc123xyz',
        time_us: 5000000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'my-feed-id',
            cid: 'bafy111test',
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    const call = fake.calls[0]!
    const expectedUri = 'at://did:plc:abc123xyz/space.rsss.feed.subscription/my-feed-id'
    t.deepEqual(call.binds[0], expectedUri, 'uri format is at://<did>/<collection>/<rkey>')
})

test('scheduled-drain.AC2.6: idempotent (ON CONFLICT)', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 6000000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-6',
            cid: 'bafy222test',
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    const call = fake.calls[0]!
    t.ok(
        /ON CONFLICT\(uri\)/.test(call.query),
        'query contains ON CONFLICT(uri) — idempotency contract'
    )
})

test('scheduled-drain.AC2.7: missing-cid drop', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 7000000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-7',
            // no cid
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 0, 'zero exec calls when cid is absent')
})

test('scheduled-drain.AC2.7b: empty-cid drop', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 7500000000000,
        kind: 'commit',
        commit: {
            operation: 'create',
            collection: 'space.rsss.feed.subscription',
            rkey: 'test-rkey-7b',
            cid: '', // empty string
            record: validSubscriptionRecord
        }
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 0, 'zero exec calls when cid is empty')
})

test('scheduled-drain.AC2.0: no commit field → noop', (t) => {
    const fake = new FakeSqlStorage()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const sql = fake as any as SqlStorage

    const evt:JetstreamEvent = {
        did: 'did:web:example.com',
        time_us: 8000000000000,
        kind: 'identity'
        // no commit field
    }

    applyCommit(sql, evt)

    t.deepEqual(fake.calls.length, 0, 'zero exec calls when no commit field')
})
