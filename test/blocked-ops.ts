import { test } from '@substrate-system/tapzero'
import { mapBlockedOpsByFeed, feedRowState } from
    '../src/client/blocked-ops.js'
import type { DeadLetterRow } from
    '../src/client/db/push-sync.js'
import type { Feed, Item } from
    '../src/client/db/types.js'

test(
    'mapBlockedOpsByFeed: add_feed with target_id maps to feed',
    t => {
        const row:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 7,
            payload: '{}',
            client_op_id: 'cid1',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [])

        t.ok(map.has(7), 'maps to feed id 7')
        t.equal(map.get(7)?.length, 1, 'contains one row')
        t.equal(map.get(7)?.[0].id, 1, 'row has correct id')
    }
)

test(
    'mapBlockedOpsByFeed: delete_feed with target_id maps to feed',
    t => {
        const row:DeadLetterRow = {
            id: 2,
            op: 'delete_feed',
            target_id: 7,
            payload: '{}',
            client_op_id: 'cid2',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [])

        t.ok(map.has(7), 'maps to feed id 7')
        t.equal(map.get(7)?.length, 1, 'contains one row')
    }
)

test(
    'mapBlockedOpsByFeed: per-feed mark_all_read with target_id ' +
    'maps to feed',
    t => {
        const row:DeadLetterRow = {
            id: 3,
            op: 'mark_all_read',
            target_id: 7,
            payload: '{}',
            client_op_id: 'cid3',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [])

        t.ok(map.has(7), 'maps to feed id 7')
        t.equal(map.get(7)?.length, 1, 'contains one row')
    }
)

test(
    'mapBlockedOpsByFeed: global mark_all_read with null ' +
    'target_id excluded',
    t => {
        const row:DeadLetterRow = {
            id: 4,
            op: 'mark_all_read',
            target_id: null,
            payload: '{}',
            client_op_id: 'cid4',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [])

        t.equal(map.size, 0, 'no feeds in map')
    }
)

test(
    'mapBlockedOpsByFeed: update_item maps via item feed_id',
    t => {
        const item:Item = {
            id: 100,
            feed_id: 7,
            guid: 'guid1',
            title: null,
            link: null,
            description: null,
            content: null,
            author: null,
            pub_date: null,
            thumbnail_url: null,
            is_read: 0,
            is_starred: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const row:DeadLetterRow = {
            id: 5,
            op: 'update_item',
            target_id: 100,
            payload: '{}',
            client_op_id: 'cid5',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [item])

        t.ok(map.has(7), 'maps to feed id 7')
        t.equal(map.get(7)?.length, 1, 'contains one row')
    }
)

test(
    'mapBlockedOpsByFeed: update_item with missing item ' +
    'excluded',
    t => {
        const row:DeadLetterRow = {
            id: 6,
            op: 'update_item',
            target_id: 999,
            payload: '{}',
            client_op_id: 'cid6',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const map = mapBlockedOpsByFeed([row], [], [])

        t.equal(map.size, 0, 'no feeds in map')
    }
)

test(
    'mapBlockedOpsByFeed: multiple ops for same feed collected',
    t => {
        const rows:DeadLetterRow[] = [
            {
                id: 1,
                op: 'add_feed',
                target_id: 7,
                payload: '{}',
                client_op_id: 'cid1',
                client_updated_at: '2024-01-01T00:00:00Z',
                attempts: 1,
                last_error: null
            },
            {
                id: 2,
                op: 'update_item',
                target_id: 100,
                payload: '{}',
                client_op_id: 'cid2',
                client_updated_at: '2024-01-01T00:00:00Z',
                attempts: 1,
                last_error: null
            }
        ]

        const item:Item = {
            id: 100,
            feed_id: 7,
            guid: 'guid1',
            title: null,
            link: null,
            description: null,
            content: null,
            author: null,
            pub_date: null,
            thumbnail_url: null,
            is_read: 0,
            is_starred: 0,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const map = mapBlockedOpsByFeed(rows, [], [item])

        t.equal(map.size, 1, 'one feed in map')
        t.equal(map.get(7)?.length, 2, 'contains two rows')
    }
)

test(
    'feedRowState: blocked when ops present',
    t => {
        const feed:Feed = {
            id: 7,
            url: 'http://example.com',
            title: 'Example',
            description: null,
            site_url: null,
            last_fetched: '2024-01-01T00:00:00Z',
            last_error: null,
            last_status: 200,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const blockedOp:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 7,
            payload: '{}',
            client_op_id: 'cid1',
            client_updated_at: '2024-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const state = feedRowState(feed, [blockedOp])

        t.equal(state, 'blocked', 'blocked beats resolved')
    }
)

test(
    'feedRowState: failed when last_fetched null and error set',
    t => {
        const feed:Feed = {
            id: 7,
            url: 'http://example.com',
            title: 'Example',
            description: null,
            site_url: null,
            last_fetched: null,
            last_error: 'connection timeout',
            last_status: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const state = feedRowState(feed, [])

        t.equal(state, 'failed', 'failed when error set')
    }
)

test(
    'feedRowState: resolving when last_fetched null and no error',
    t => {
        const feed:Feed = {
            id: 7,
            url: 'http://example.com',
            title: 'Example',
            description: null,
            site_url: null,
            last_fetched: null,
            last_error: null,
            last_status: null,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const state = feedRowState(feed, [])

        t.equal(state, 'resolving', 'resolving when no error')
    }
)

test(
    'feedRowState: none when resolved and no blocked ops',
    t => {
        const feed:Feed = {
            id: 7,
            url: 'http://example.com',
            title: 'Example',
            description: null,
            site_url: null,
            last_fetched: '2024-01-01T00:00:00Z',
            last_error: null,
            last_status: 200,
            created_at: '2024-01-01T00:00:00Z',
            updated_at: '2024-01-01T00:00:00Z'
        }

        const state = feedRowState(feed, [])

        t.equal(state, 'none', 'none when resolved and clean')
    }
)
