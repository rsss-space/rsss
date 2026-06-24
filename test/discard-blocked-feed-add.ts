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

function makeTestState (
    onSetRoute?:(r:string)=> void,
    initialRoute:string = '/'
):AppState {
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
        _setRoute: (r:string) => {
            if (onSetRoute) onSetRoute(r)
        },
        route: signal(initialRoute),
        routeItem: signal(null),
        routeItemLoading: signal(false),
        user: signal({
            did: 'did:plc:test-discard-add',
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

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type FetchHandler = (
    input:FetchInput,
    init?:FetchInit
)=> Promise<Response>

function withStubbedFetch<T> (
    handler:FetchHandler,
    fn:()=> Promise<T>
):Promise<T> {
    const original = globalThis.fetch
    globalThis.fetch = handler as typeof fetch
    return fn().finally(() => {
        globalThis.fetch = original
    })
}

function jsonResponse (body:unknown, status = 200):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' }
    })
}

test(
    'discardBlockedFeedAdd removes dead-letter and feed, navigates',
    async (t) => {
        let lastRoute:string|null = null
        const feedId = 999
        const state = makeTestState(
            (r) => { lastRoute = r },
            `/reader/${feedId}`
        )
        const db = await openLocalDb('did:plc:test-discard-add')

        try {
            const actualFeedId = seedFeed(db)
            seedItem(db, actualFeedId)

            // Seed a dead-letter add_feed row with target_id =
            // actualFeedId
            db.exec({
                sql: `INSERT INTO dead_letter_outbox
                    (op, target_id, payload, client_op_id,
                     client_updated_at, attempts, last_error)
                    VALUES (?, ?, ?, ?, ?, ?, ?)`,
                bind: [
                    'add_feed',
                    actualFeedId,
                    JSON.stringify({
                        url: 'https://example.com/feed'
                    }),
                    'op-uuid-discard-add-1',
                    '2026-01-01 10:00:00',
                    10,
                    'HTTP 410'
                ]
            })

            const deadRow = queryOne<{ id:number }>(
                db,
                'SELECT id FROM dead_letter_outbox WHERE' +
                ' client_op_id = ?',
                ['op-uuid-discard-add-1']
            )
            const deadId = deadRow!.id

            // Set up signals
            batch(() => {
                syncDeadLetters.value = 1
            })

            // Stub fetch for reload trio
            const handler:FetchHandler = async () => {
                return jsonResponse({
                    feeds: [],
                    items: [],
                    total: 0,
                    unread: 0,
                    starred: 0,
                    perFeed: {}
                })
            }

            _setRunResolveConvergenceDepsForTest({
                runSync: async () => {},
                getLocalDb: (did) => {
                    return did === state.user.value?.did ?
                        db :
                        null
                }
            })

            try {
                await withStubbedFetch(
                    handler,
                    async () => {
                        await State.discardBlockedFeedAdd(
                            state,
                            actualFeedId,
                            deadId
                        )
                    }
                )

                // AC5.1: dead-letter row gone
                const removedDead = queryOne(
                    db,
                    'SELECT id FROM dead_letter_outbox WHERE id = ?',
                    [deadId]
                )
                t.equal(
                    removedDead,
                    undefined,
                    'dead-letter row removed'
                )

                // AC5.1: feed gone
                const removedFeed = queryOne<{ cnt:number }>(
                    db,
                    'SELECT COUNT(*) as cnt FROM feeds WHERE id = ?',
                    [actualFeedId]
                )
                t.equal(
                    removedFeed?.cnt,
                    0,
                    'feed row removed'
                )

                // AC5.1: items gone
                const removedItems = queryOne<{ cnt:number }>(
                    db,
                    'SELECT COUNT(*) as cnt FROM items WHERE' +
                    ' feed_id = ?',
                    [actualFeedId]
                )
                t.equal(
                    removedItems?.cnt,
                    0,
                    'feed items removed'
                )

                // AC5.1: navigated to '/'
                t.equal(
                    lastRoute,
                    '/',
                    'navigated to /'
                )

                // AC5.4: syncDeadLetters refreshed to 0
                t.equal(
                    syncDeadLetters.value,
                    0,
                    'syncDeadLetters refreshed to 0'
                )
            } finally {
                _resetRunResolveConvergenceDepsForTest()
            }
        } finally {
            db.close()
        }
    }
)
