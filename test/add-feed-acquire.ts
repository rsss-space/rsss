import { signal, computed, effect } from '@preact/signals'
import { test } from '@substrate-system/tapzero'
import {
    State,
    type AppState,
    _registerRefreshSignalForTest,
    _resetRefreshRefCountForTest,
    _resetPendingAddFeedAcquiresForTest,
    _setAddFeedHardTimeoutForTest,
    _setAddFeedAdapterForTest,
} from '../src/client/state.js'
import type { DbAdapter } from '../src/client/db/types.js'
import {
    init as initDisplayedRefresh,
    _resetForTest as resetDisplayedRefresh,
} from '../src/client/displayed-refresh-in-progress.js'
import {
    StubWebSocket,
    withStubbedWebSocket
} from './helpers/stub-live-socket.js'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type FetchHandler = (
    input:FetchInput,
    init?:FetchInit
)=> Promise<Response>

function withStubbedFetch<T> (
    handler:FetchHandler,
    fn:()=> Promise<T>,
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

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

async function settle (count = 4):Promise<void> {
    for (let i = 0; i < count; i++) {
        await nextTask()
    }
}

function makeStubAdapter (options:{
    addFeed?:(url:string)=> Promise<void>,
}):(did?:string)=> Promise<DbAdapter> {
    const addFeed = options.addFeed ?? (async () => {})
    return async () => ({ addFeed } as unknown as DbAdapter)
}

function makeMinimalState ():AppState {
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
            did: 'did:plc:test',
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

// AC1.1: acquire is synchronous (signal `true` before POST resolves)
test('AC1.1: acquire is synchronous', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    const _origLoadFeeds = State.loadFeeds
    const _origLoadCounts = State.loadCounts

    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: () => new Promise(() => {}), // Never resolve
        })
    )

    try {
        // Stub to keep addFeed hanging
        State.loadFeeds = async (_s:AppState) => {
            await new Promise(() => {}) // Never resolve
        }
        State.loadCounts = async () => {}

        const _addFeedPromise = State.addFeed(state, 'http://example.com')

        // Synchronously, refreshInProgress should be true
        await settle()

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress is true (AC1.1)',
        )

        // Clean up
        _resetRefreshRefCountForTest(state)
        _resetPendingAddFeedAcquiresForTest()
    } finally {
        State.loadFeeds = _origLoadFeeds
        State.loadCounts = _origLoadCounts
        _setAddFeedAdapterForTest(undefined)
    }
})

// AC1.2: SSE event releases the acquire
test('AC1.2: SSE event releases the acquire', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    const _origLoadFeeds = State.loadFeeds
    const _origLoadCounts = State.loadCounts

    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: async () => {},
        })
    )

    await withStubbedWebSocket(async () => {
        await withStubbedFetch(async () => {
            return jsonResponse({})
        }, async () => {
            State.openEventStream(state)
            const source = StubWebSocket.instances[0]

            // Mock to populate the feed
            State.loadFeeds = async (s:AppState) => {
                s.feeds.value = [
                    {
                        id: 42,
                        url: 'http://example.com',
                        title: null,
                        description: null,
                        site_url: null,
                        last_fetched: null,
                        last_error: null,
                        last_status: null,
                        created_at: '2025-01-01T00:00:00.000Z',
                        updated_at: '2025-01-01T00:00:00.000Z',
                    }
                ]
            }
            State.loadCounts = async () => {}

            try {
                const _promise = State.addFeed(
                    state,
                    'http://example.com',
                )

                // Microtask
                await settle()

                t.equal(
                    state.refreshInProgress.value,
                    true,
                    'refreshInProgress is true after call',
                )

                // Fire SSE with the feed id
                source.fire('feed-updates-available', {
                    feedUpdateCounts: { 42: 3 }
                })

                // Wait for the promise
                await _promise
                await settle()

                t.equal(
                    state.refreshInProgress.value,
                    false,
                    'refreshInProgress is false after SSE release (AC1.2)',
                )
            } finally {
                State.loadFeeds = _origLoadFeeds
                State.loadCounts = _origLoadCounts
                State.closeEventStream()
                _resetPendingAddFeedAcquiresForTest()
                _setAddFeedAdapterForTest(undefined)
            }
        })
    })
})

// AC1.5: hard-timeout force-release
test('AC1.5: hard-timeout force-release', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    const origLoadFeeds = State.loadFeeds
    const origLoadCounts = State.loadCounts

    _setAddFeedHardTimeoutForTest(50)
    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: async () => {},
        })
    )

    try {
        State.loadFeeds = async (s:AppState) => {
            s.feeds.value = [
                {
                    id: 42,
                    url: 'http://example.com',
                    title: null,
                    description: null,
                    site_url: null,
                    last_fetched: null,
                    last_error: null,
                    last_status: null,
                    created_at: '2025-01-01T00:00:00.000Z',
                    updated_at: '2025-01-01T00:00:00.000Z',
                }
            ]
        }
        State.loadCounts = async () => {}

        const _promise = State.addFeed(
            state,
            'http://example.com',
        )

        // Microtask
        await settle()

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress is true initially',
        )

        // Wait 100ms (50ms timeout + 50ms slack)
        await new Promise(_resolve => setTimeout(_resolve, 100))

        // Await addFeed
        await _promise
        await settle()

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress is false after hard timeout (AC1.5)',
        )
    } finally {
        State.loadFeeds = origLoadFeeds
        State.loadCounts = origLoadCounts
        _setAddFeedHardTimeoutForTest(undefined)
        _setAddFeedAdapterForTest(undefined)
        _resetPendingAddFeedAcquiresForTest()
    }
})

// 409 short-circuit does NOT raise error
test('409 short-circuit does NOT raise error', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    state.feedSyncStatus.value = 'inactive'

    const origLoadFeeds = State.loadFeeds
    const origLoadCounts = State.loadCounts

    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: async () => {
                const err = new Error('Conflict')
                ;(err as any).response = new Response('', { status: 409 })
                throw err
            },
        }) as any,
    )

    try {
        State.loadFeeds = async () => {}
        State.loadCounts = async () => {}

        await State.addFeed(state, 'http://example.com')

        t.ok(
            String(state.feedSyncStatus.value) !== 'error',
            '409 does not set feedSyncStatus to error',
        )
        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress released after 409',
        )
    } finally {
        State.loadFeeds = origLoadFeeds
        State.loadCounts = origLoadCounts
        _setAddFeedAdapterForTest(undefined)
        _resetRefreshRefCountForTest(state)
        _resetPendingAddFeedAcquiresForTest()
    }
})

// AC4.1: non-409 error -> red
test('AC4.1: non-409 error -> red', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    state.feedSyncStatus.value = 'inactive'

    const origLoadFeeds = State.loadFeeds
    const origLoadCounts = State.loadCounts

    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: async () => {
                const err = new Error('Server error')
                ;(err as any).response = new Response('', { status: 500 })
                throw err
            },
        }) as any,
    )

    try {
        State.loadFeeds = async () => {}
        State.loadCounts = async () => {}

        let thrown:unknown = null
        try {
            await State.addFeed(state, 'http://example.com')
        } catch (err) {
            thrown = err
        }

        t.ok(
            thrown instanceof Error,
            'non-409 error re-thrown to caller',
        )
        t.equal(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus is error after non-409 (AC4.1)',
        )
        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress released after error',
        )
    } finally {
        State.loadFeeds = origLoadFeeds
        State.loadCounts = origLoadCounts
        _setAddFeedAdapterForTest(undefined)
        _resetRefreshRefCountForTest(state)
        _resetPendingAddFeedAcquiresForTest()
    }
})

// AC5.2: end-state transition (no intermediate)
test('AC5.2: end-state transition (no intermediate)', async t => {
    resetDisplayedRefresh()
    const state = makeMinimalState()
    _resetRefreshRefCountForTest(state)
    initDisplayedRefresh(state.refreshInProgress)

    state.feedSyncStatus.value = 'inactive'

    const observedStates:Array<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    > = []
    let lastSeen:'inactive'|'updates'|'syncing'|'error'|'synced'|null =
        null

    const unsubscribe = effect(() => {
        const val = state.displayedFeedSyncStatus.value
        if (val !== lastSeen) {
            observedStates.push(val)
            lastSeen = val
        }
    })

    const origLoadFeeds = State.loadFeeds
    const origLoadCounts = State.loadCounts

    _setAddFeedAdapterForTest(
        makeStubAdapter({
            addFeed: async () => {},
        })
    )

    try {
        await withStubbedWebSocket(async () => {
            await withStubbedFetch(async () => {
                return jsonResponse({})
            }, async () => {
                State.openEventStream(state)
                const source = StubWebSocket.instances[0]

                State.loadFeeds = async (s:AppState) => {
                    s.feeds.value = [
                        {
                            id: 42,
                            url: 'http://example.com',
                            title: null,
                            description: null,
                            site_url: null,
                            last_fetched: null,
                            last_error: null,
                            last_status: null,
                            created_at: '2025-01-01T00:00:00.000Z',
                            updated_at: '2025-01-01T00:00:00.000Z',
                        }
                    ]
                }
                State.loadCounts = async () => {}

                const _promise = State.addFeed(
                    state,
                    'http://example.com',
                )

                // Wait for show-delay
                const SHOW_DELAY_MS = 300
                await new Promise(_resolve =>
                    setTimeout(_resolve, SHOW_DELAY_MS + 50)
                )

                // Fire SSE while in flight
                source.fire('feed-updates-available', {
                    feedUpdateCounts: { 42: 3 }
                })

                // Await completion
                await _promise
                await settle()

                // Wait for min-visible
                const MIN_VISIBLE_MS = 500
                await new Promise(_resolve =>
                    setTimeout(_resolve, MIN_VISIBLE_MS + 50)
                )

                // Check final state
                t.equal(
                    lastSeen,
                    'updates',
                    'final state is updates (AC5.2)',
                )

                // Check no intermediate after first syncing
                const firstSyncingIdx =
                    observedStates.indexOf('syncing')
                t.ok(
                    firstSyncingIdx >= 0,
                    'displayed reached syncing during the test',
                )
                if (firstSyncingIdx >= 0) {
                    for (let i = firstSyncingIdx + 1;
                        i < observedStates.length;
                        i++) {
                        const s = observedStates[i]
                        t.ok(
                            s !== 'inactive',
                            'no inactive after syncing',
                        )
                        t.ok(
                            s !== 'synced',
                            'no synced after syncing',
                        )
                    }
                }

                State.closeEventStream()
                _resetPendingAddFeedAcquiresForTest()
            })
        })
    } finally {
        State.loadFeeds = origLoadFeeds
        State.loadCounts = origLoadCounts
        _setAddFeedAdapterForTest(undefined)
        unsubscribe()
    }
})
