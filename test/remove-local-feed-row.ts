import { test } from '@substrate-system/tapzero'
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import type { SqlValue } from '@sqlite.org/sqlite-wasm'
import {
    openLocalDb,
    setTestMode
} from '../src/client/db/sqlite-init.js'
import { removeLocalFeedRow } from '../src/client/db/local-adapter.js'
import type { Sqlite3Db } from '../src/client/db/sqlite-init.js'

setTestMode(true, wasmUrl as string)

function queryCount<T extends Record<string, SqlValue>> (
    db:Sqlite3Db,
    sql:string,
    bind?:unknown[]
):number {
    const rows:T[] = []
    db.exec({
        sql,
        bind: bind as Parameters<typeof db.exec>[0]['bind'],
        rowMode: 'object',
        resultRows: rows as Record<string, SqlValue>[]
    })
    return rows.length > 0 ? (rows[0].count as number) : 0
}

test(
    'removeLocalFeedRow deletes feed and items ' +
    'without enqueuing outbox op',
    async (t) => {
        const db = await openLocalDb(
            'did:plc:test-remove-feed-row'
        )
        try {
            // Seed a feed
            db.exec(`
                INSERT INTO feeds
                    (url, created_at, updated_at)
                VALUES
                    ('https://example.com/feed',
                     '2026-01-01 00:00:00',
                     '2026-01-01 00:00:00')
            `)

            // Get the feed id
            const feedRow:{ id:number }[] = []
            db.exec({
                sql: 'SELECT id FROM feeds ORDER BY id DESC LIMIT 1',
                rowMode: 'object',
                resultRows: feedRow as Record<string, SqlValue>[]
            })
            const feedId = feedRow[0].id

            // Seed two items for this feed
            db.exec({
                sql: `INSERT INTO items
                    (feed_id, guid, title, link, is_read,
                     is_starred, created_at, updated_at)
                VALUES (?, 'guid-1', 'Item One',
                 'https://example.com/item-one', 0, 0,
                 '2026-01-01 00:00:00',
                 '2026-01-01 00:00:00')`,
                bind: [feedId]
            })
            db.exec({
                sql: `INSERT INTO items
                    (feed_id, guid, title, link, is_read,
                     is_starred, created_at, updated_at)
                VALUES (?, 'guid-2', 'Item Two',
                 'https://example.com/item-two', 0, 0,
                 '2026-01-02 00:00:00',
                 '2026-01-02 00:00:00')`,
                bind: [feedId]
            })

            // Seed an unrelated outbox row (update_item op)
            db.exec(`
                INSERT INTO outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at)
                VALUES
                    ('update_item', 999,
                     '{"id": 999, "is_read": true}',
                     'op-uuid-unrelated',
                     '2026-01-01 10:00:00')
            `)

            // Call removeLocalFeedRow
            await removeLocalFeedRow(db, feedId)

            // AC5.1: Feed row should be deleted
            const feedCount = queryCount(
                db,
                'SELECT COUNT(*) as count FROM feeds WHERE id = ?',
                [feedId]
            )
            t.equal(
                feedCount,
                0,
                'feed row is deleted'
            )

            // AC5.1: Items for the feed should be deleted
            const itemCount = queryCount(
                db,
                'SELECT COUNT(*) as count FROM items ' +
                'WHERE feed_id = ?',
                [feedId]
            )
            t.equal(
                itemCount,
                0,
                'items for feed are deleted'
            )

            // AC5.2: No delete_feed op in outbox
            const deleteOpCount = queryCount(
                db,
                'SELECT COUNT(*) as count FROM outbox ' +
                'WHERE op = ?',
                ['delete_feed']
            )
            t.equal(
                deleteOpCount,
                0,
                'no delete_feed op in outbox'
            )

            // AC5.2: Unrelated outbox row is untouched
            const totalOutboxCount = queryCount(
                db,
                'SELECT COUNT(*) as count FROM outbox'
            )
            t.equal(
                totalOutboxCount,
                1,
                'outbox count unchanged (unrelated row ' +
                'still exists)'
            )

            const unrelatedRow:{ op:string }[] = []
            db.exec({
                sql: 'SELECT op FROM outbox WHERE id = 1',
                rowMode: 'object',
                resultRows: unrelatedRow as
                    Record<string, SqlValue>[]
            })
            t.equal(
                unrelatedRow[0].op,
                'update_item',
                'unrelated outbox row preserved'
            )
        } finally {
            db.close()
        }
    }
)
