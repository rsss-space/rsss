import { test } from '@substrate-system/tapzero'
import {
    describeOp,
    isFetchFailed,
    isPublishFailed
} from '../src/client/routes/sync-status-format.js'
import type { DeadLetterRow } from '../src/client/db/push-sync.js'
import type { Feed } from '../src/client/db/types.js'

test('describeOp: add_feed with valid URL', t => {
    const row:DeadLetterRow = {
        id: 1,
        op: 'add_feed',
        target_id: 42,
        payload: JSON.stringify({ url: 'https://example.com/feed' }),
        client_op_id: 'cid1',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: 'network error'
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(desc.includes('example.com'), 'includes URL')
})

test('describeOp: add_feed with missing URL falls back to id', t => {
    const row:DeadLetterRow = {
        id: 2,
        op: 'add_feed',
        target_id: 99,
        payload: JSON.stringify({}),
        client_op_id: 'cid2',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 2,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(desc.includes('99'), 'includes target_id')
})

test('describeOp: delete_feed', t => {
    const row:DeadLetterRow = {
        id: 3,
        op: 'delete_feed',
        target_id: 50,
        payload: JSON.stringify({ id: 50 }),
        client_op_id: 'cid3',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: 'server error'
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(desc.includes('50'), 'includes feed id')
})

test('describeOp: update_item marking as read', t => {
    const row:DeadLetterRow = {
        id: 4,
        op: 'update_item',
        target_id: 123,
        payload: JSON.stringify({ id: 123, is_read: true }),
        client_op_id: 'cid4',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(
        desc.includes('123') || desc.includes('read'),
        'mentions item id or read action'
    )
})

test('describeOp: update_item marking as starred', t => {
    const row:DeadLetterRow = {
        id: 5,
        op: 'update_item',
        target_id: 456,
        payload: JSON.stringify({ id: 456, is_starred: true }),
        client_op_id: 'cid5',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(
        desc.includes('456') || desc.includes('star'),
        'mentions item id or star action'
    )
})

test('describeOp: update_item with multiple fields', t => {
    const row:DeadLetterRow = {
        id: 6,
        op: 'update_item',
        target_id: 789,
        payload: JSON.stringify({
            id: 789,
            is_read: false,
            is_starred: true
        }),
        client_op_id: 'cid6',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
})

test('describeOp: mark_all_read for single feed', t => {
    const row:DeadLetterRow = {
        id: 7,
        op: 'mark_all_read',
        target_id: 10,
        payload: JSON.stringify({ feedId: 10 }),
        client_op_id: 'cid7',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(
        desc.includes('10') || desc.includes('feed'),
        'mentions feed id or feed'
    )
})

test('describeOp: mark_all_read global (all feeds)', t => {
    const row:DeadLetterRow = {
        id: 8,
        op: 'mark_all_read',
        target_id: null,
        payload: JSON.stringify({}),
        client_op_id: 'cid8',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    const desc = describeOp(row)
    t.ok(desc.length > 0, 'produces non-empty string')
    t.ok(desc.includes('all'), 'mentions all')
})

test('describeOp: unknown op does not throw', t => {
    const row:DeadLetterRow = {
        id: 9,
        op: 'frobnicate',
        target_id: null,
        payload: JSON.stringify({ some: 'data' }),
        client_op_id: 'cid9',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    let threw = false
    try {
        const desc = describeOp(row)
        t.ok(desc.length > 0, 'produces non-empty string')
        t.ok(desc.includes('frobnicate'), 'includes op name')
    } catch {
        threw = true
    }
    t.equal(threw, false, 'does not throw')
})

test('describeOp: invalid JSON payload does not throw', t => {
    const row:DeadLetterRow = {
        id: 10,
        op: 'add_feed',
        target_id: 11,
        payload: 'not valid json {]',
        client_op_id: 'cid10',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    }
    let threw = false
    try {
        const desc = describeOp(row)
        t.ok(desc.length > 0, 'produces non-empty string')
    } catch {
        threw = true
    }
    t.equal(threw, false, 'does not throw on invalid JSON')
})

test('describeOp: distinct ops produce distinct descriptions', t => {
    const baseRow = (
        op:string,
        payload:string,
        targetId:number|null = 1
    ):DeadLetterRow => ({
        id: 1,
        op,
        target_id: targetId,
        payload,
        client_op_id: 'cid',
        client_updated_at: '2024-01-01T00:00:00Z',
        attempts: 1,
        last_error: null
    })

    const addDesc = describeOp(
        baseRow('add_feed', JSON.stringify({ url: 'http://a.com' }))
    )
    const deleteDesc = describeOp(
        baseRow('delete_feed', JSON.stringify({}))
    )
    const updateDesc = describeOp(
        baseRow(
            'update_item',
            JSON.stringify({ is_read: true }),
            2
        )
    )
    const markDesc = describeOp(
        baseRow('mark_all_read', JSON.stringify({}), 3)
    )

    const descs = [addDesc, deleteDesc, updateDesc, markDesc]
    const unique = new Set(descs)
    t.equal(unique.size, 4, 'all four op types produce distinct strings')
})

test('fetch-error predicate: true when last_error is set', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: 'Connection timeout',
        last_status: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.ok(isFetchFailed(feed), 'fetch-error predicate true')
})

test('fetch-error predicate: true when status >= 400', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: 500,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.ok(isFetchFailed(feed), 'fetch-error predicate true')
})

test('fetch-error predicate: true when status = 404', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: 404,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.ok(isFetchFailed(feed), 'fetch-error predicate true')
})

test('fetch-error predicate: false when status < 400', t => {
    const feed200:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: 200,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(isFetchFailed(feed200), false, 'fetch-error false for 200')

    const feed304:Feed = {
        id: 2,
        url: 'http://example.com/feed2',
        title: 'Example Feed 2',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: 304,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(isFetchFailed(feed304), false, 'fetch-error false for 304')
})

test('fetch-error predicate: false when no error', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(isFetchFailed(feed), false, 'fetch-error false')
})

test('publish-error predicate: true when set', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        publish_error: 'Could not connect to Bluesky',
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.ok(isPublishFailed(feed), 'publish-error true')
})

test('publish-error predicate: false when null/undefined', t => {
    const feed1:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        publish_error: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(
        isPublishFailed(feed1),
        false,
        'returns false when publish_error=null'
    )

    const feed2:Feed = {
        id: 2,
        url: 'http://example.com/feed2',
        title: 'Example Feed 2',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(
        isPublishFailed(feed2),
        false,
        'returns false when publish_error undefined'
    )
})

test(
    'both predicates: true for feed with all errors',
    t => {
        const feed:Feed = {
            id: 1,
            url: 'http://example.com/feed',
            title: 'Example Feed',
            description: null,
            site_url: null,
            last_fetched: null,
            last_error: 'Fetch error',
            last_status: 500,
            publish_error: 'Publish error',
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }
        t.ok(isFetchFailed(feed), 'both true')
        t.ok(isPublishFailed(feed), 'both true')
    }
)

test('both predicates: false for clean feed', t => {
    const feed:Feed = {
        id: 1,
        url: 'http://example.com/feed',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: '2024-01-01T00:00:00Z',
        last_error: null,
        last_status: 200,
        publish_error: null,
        created_at: '2024-01-01T00:00:00Z',
        updated_at: '2024-01-01T00:00:00Z'
    }
    t.equal(isFetchFailed(feed), false, 'both false')
    t.equal(isPublishFailed(feed), false, 'both false')
})
