import { signal, computed, batch } from '@preact/signals'
import { test } from '@substrate-system/tapzero'
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import {
    State,
    type AppState,
    _registerRefreshSignalForTest,
    _resetRefreshRefCountForTest,
    _setRunResolveConvergenceDepsForTest,
    _resetRunResolveConvergenceDepsForTest,
} from '../src/client/state.js'
import {
    openLocalDb,
    setTestMode
} from '../src/client/db/sqlite-init.js'
import {
    syncStatus,
    syncError,
    syncPending,
    syncDeadLetters
} from '../src/client/db/sync-status.js'
import type { Sqlite3Db } from '../src/client/db/sqlite-init.js'

setTestMode(true, wasmUrl as string)

type SqlValue = unknown
function queryOne<T> (
    db:Sqlite3Db,
    sql:string,
    bind?:unknown[]
):T|undefined {
    const rows:T[] = []
    db.exec({
        sql,
        bind: bind as Parameters<typeof db.exec>[0]['bind'],
        rowMode: 'object',
        resultRows: rows as Record<string, SqlValue>[]
    })
    return rows[0]
}

function seedFeed (db:Sqlite3Db):number {
    db.exec({
        sql: `INSERT INTO feeds (url, created_at, updated_at)
              VALUES ('https://example.com/feed',
                '2026-01-01 00:00:00', '2026-01-01 00:00:00')`
    })
    const row = queryOne<{ id:number }>(
        db,
        'SELECT id FROM feeds ORDER BY id DESC LIMIT 1'
    )
    return row!.id
}

function seedItem (db:Sqlite3Db, feedId:number):number {
    db.exec({
        sql: `INSERT INTO items
            (feed_id, guid, title, link, is_read, is_starred,
             created_at, updated_at)
            VALUES (?, 'guid-1', 'Item 1', 'https://example.com/1',
                0, 0, '2026-01-01 00:00:00', '2026-01-01 00:00:00')`,
        bind: [feedId]
    })
    const row = queryOne<{ id:number }>(
        db,
        'SELECT id FROM items ORDER BY id DESC LIMIT 1'
    )
    return row!.id
}

function makeTestState ():AppState {
    const refreshInProgress = signal(false)
    const feedSyncStatus = signal<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    >('inactive')
    const displayedFeedSyncStatus = computed<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    >(() => (
        refreshInProgress.value ?
            'syncing' :
            feedSyncStatus.value
    ))
    const state = {
        _setRoute: () => {},
        route: signal('/'),
        routeItem: signal(null),
        routeItemLoading: signal(false),
        user: signal({
            did: 'did:plc:test-dead-letter',
            handle: 'test.bsky.social'
        }),
        authLoading: signal(false),
        authError: signal<string|null>(null),
        oauthInFlight: signal(false),
        isAuthenticated: signal(true),
        feeds: signal<any[]>([]),
        feedsLoading: signal(false),
        feedsError: signal<string|null>(null),
        refreshInProgress,
        feedSyncStatus,
        displayedFeedSyncStatus,
        feedSyncError: signal<string|null>(null),
        feedUpdateCounts: signal<Record<string, number>>({}),
        feedUpdateStatus: computed(() => 'synced' as const),
        feedsWithUpdates: computed(() => [] as string[]),
        items: signal([]),
        itemsLoading: signal(false),
        itemsTotal: signal(0),
        itemsOffset: signal(0),
        counts: signal({
            unread: 0,
            starred: 0,
            total: 0,
            perFeed: {}
        }),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        pageSize: signal(20),
        selectedFeedId: signal<number|null>(null),
        viewItemsCache: new Map(),
        cleanup: () => {}
    } as unknown as AppState

    _registerRefreshSignalForTest(state, refreshInProgress)

    return state
}

test(
    'retryDeadLetter moves row to outbox and decrements count',
    async (t) => {
        const state = makeTestState()
        const db = await openLocalDb('did:plc:test-dead-letter')

        try {
            const feedId = seedFeed(db)
            const itemId = seedItem(db, feedId)

            // Seed a dead-letter row directly
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'update_item',
                    itemId,
                    JSON.stringify({ id: itemId, is_read: true }),
                    'op-uuid-retry-1',
                    '2026-01-01 12:00:00',
                    5,
                    'HTTP 500'
                ]
            })

            // Get the dead-letter row id
            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE client_op_id = ?',
                ['op-uuid-retry-1']
            )
            const deadId = deadRow!.id

            // Set up signals
            batch(() => {
                syncDeadLetters.value = 1
                syncPending.value = 0
            })

            // Track whether runSync was called
            let syncCalled = false
            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {
                    syncCalled = true
                },
                getLocalDb: (did) => {
                    return did === state.user.value?.did ? db : null
                }
            })

            try {
                await State.retryDeadLetter(state, deadId)

                t.equal(syncCalled, true, 'runSync was invoked')

                // Row should now be in outbox
                const requeued = queryOne<{
                    attempts:number
                    last_error:string|null
                    client_op_id:string
                }>(
                    db,
                    'SELECT attempts, last_error, client_op_id' +
                    ' FROM outbox WHERE client_op_id = ?',
                    ['op-uuid-retry-1']
                )
                t.ok(requeued, 'row moved to outbox')
                t.equal(requeued?.attempts, 0, 'attempts reset to 0')
                t.equal(requeued?.last_error, null, 'last_error cleared')

                // Row should be gone from dead-letter
                const stillDead = queryOne(
                    db,
                    'SELECT id FROM dead_letter_outbox WHERE id = ?',
                    [deadId]
                )
                t.equal(
                    stillDead,
                    undefined,
                    'row removed from dead_letter_outbox'
                )

                // Count should be decremented
                t.equal(
                    syncDeadLetters.value,
                    0,
                    'syncDeadLetters decremented'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)

test(
    'discardDeadLetter removes row and decrements count',
    async (t) => {
        const state = makeTestState()
        const db = await openLocalDb('did:plc:test-dead-letter')

        try {
            // Seed a dead-letter row directly
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'add_feed',
                    null,
                    JSON.stringify({ url: 'https://example.com/feed.xml' }),
                    'op-uuid-discard-1',
                    '2026-01-01 10:00:00',
                    10,
                    'HTTP 410'
                ]
            })

            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE client_op_id = ?',
                ['op-uuid-discard-1']
            )
            const deadId = deadRow!.id

            // Set up signals
            batch(() => {
                syncDeadLetters.value = 1
                syncPending.value = 0
            })

            // Track that runSync is NOT called
            let syncCalled = false
            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {
                    syncCalled = true
                },
                getLocalDb: (did) => {
                    return did === state.user.value?.did ? db : null
                }
            })

            try {
                await State.discardDeadLetter(state, deadId)

                t.equal(
                    syncCalled,
                    false,
                    'runSync was NOT invoked'
                )

                // Row should be deleted
                const removed = queryOne(
                    db,
                    'SELECT id FROM dead_letter_outbox WHERE id = ?',
                    [deadId]
                )
                t.equal(removed, undefined, 'row deleted')

                // Count should be decremented
                t.equal(
                    syncDeadLetters.value,
                    0,
                    'syncDeadLetters decremented'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)

test(
    'retryDeadLetter resets attempt budget so retry can happen',
    async (t) => {
        const state = makeTestState()
        const db = await openLocalDb('did:plc:test-dead-letter')

        try {
            const feedId = seedFeed(db)
            const itemId = seedItem(db, feedId)

            // Seed a dead-letter row directly
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'update_item',
                    itemId,
                    JSON.stringify({ id: itemId, is_starred: false }),
                    'op-uuid-budget-1',
                    '2026-01-02 10:00:00',
                    8,
                    'HTTP 500'
                ]
            })

            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE client_op_id = ?',
                ['op-uuid-budget-1']
            )
            const deadId = deadRow!.id

            batch(() => {
                syncDeadLetters.value = 1
                syncPending.value = 0
            })

            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {},
                getLocalDb: (did) => {
                    return did === state.user.value?.did ? db : null
                }
            })

            try {
                await State.retryDeadLetter(state, deadId)

                // After requeue, the row should have attempts=0 so it can be
                // retried in the normal sync cycle without immediately
                // re-dead-lettering
                const retried = queryOne<{ attempts:number }>(
                    db,
                    'SELECT attempts FROM outbox WHERE client_op_id = ?',
                    ['op-uuid-budget-1']
                )
                t.equal(
                    retried?.attempts,
                    0,
                    'fresh attempt budget allows genuine retry'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)

test(
    'discardDeadLetter does not clobber a transient syncError',
    async (t) => {
        const state = makeTestState()
        const db = await openLocalDb('did:plc:test-dead-letter')

        try {
            // Seed a dead-letter row
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'add_feed',
                    null,
                    JSON.stringify({ url: 'https://example.com/feed.xml' }),
                    'op-uuid-ac7-1',
                    '2026-01-01 11:00:00',
                    10,
                    'HTTP 410'
                ]
            })

            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE client_op_id = ?',
                ['op-uuid-ac7-1']
            )
            const deadId = deadRow!.id

            // Set up signals with error state
            batch(() => {
                syncStatus.value = 'error'
                syncError.value = 'Current sync encountered a problem'
                syncDeadLetters.value = 1
                syncPending.value = 0
            })

            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {},
                getLocalDb: (did) => {
                    return did === state.user.value?.did ? db : null
                }
            })

            try {
                await State.discardDeadLetter(state, deadId)

                // syncError should NOT be cleared (AC7 constraint)
                t.equal(
                    syncError.value,
                    'Current sync encountered a problem',
                    'syncError is not clobbered'
                )

                // syncStatus should NOT change from error
                t.equal(
                    syncStatus.value,
                    'error',
                    'error status is preserved'
                )

                // But syncDeadLetters should be updated
                t.equal(
                    syncDeadLetters.value,
                    0,
                    'syncDeadLetters still decremented'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)

test(
    'discardDeadLetter downgrades warning to idle when last dead-letter',
    async (t) => {
        const state = makeTestState()
        const db = await openLocalDb('did:plc:test-dead-letter')

        try {
            // Seed a dead-letter row
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'add_feed',
                    null,
                    JSON.stringify({ url: 'https://example.com/feed.xml' }),
                    'op-uuid-downgrade-1',
                    '2026-01-01 09:00:00',
                    10,
                    'HTTP 410'
                ]
            })

            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE client_op_id = ?',
                ['op-uuid-downgrade-1']
            )
            const deadId = deadRow!.id

            // Set up signals with warning state (dead-letters present)
            batch(() => {
                syncStatus.value = 'warning'
                syncError.value = null
                syncDeadLetters.value = 1
                syncPending.value = 0
            })

            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {},
                getLocalDb: (did) => {
                    return did === state.user.value?.did ? db : null
                }
            })

            try {
                await State.discardDeadLetter(state, deadId)

                // Warning should downgrade to idle when last dead-letter removed
                t.equal(
                    syncStatus.value,
                    navigator.onLine ? 'idle' : 'offline',
                    'warning downgraded to idle/offline'
                )

                // syncDeadLetters should be 0
                t.equal(
                    syncDeadLetters.value,
                    0,
                    'syncDeadLetters is 0'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)
