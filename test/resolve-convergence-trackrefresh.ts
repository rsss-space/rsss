import { signal, computed, effect } from '@preact/signals'
import { test } from '@substrate-system/tapzero'
import {
    State,
    type AppState,
    _registerRefreshSignalForTest,
    _resetRefreshRefCountForTest,
    _runResolveConvergenceForTest,
} from '../src/client/state.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

async function settle (count = 4):Promise<void> {
    for (let i = 0; i < count; i++) {
        await nextTask()
    }
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

// Test 1: Success path acquires and releases
test('success path: acquire and release', async t => {
    const state = makeTestState()

    const origRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {}

    try {
        // Populate feeds with resolving feed
        state.feeds.value = [
            {
                id: 99,
                url: 'http://example.com',
                last_fetched: null,
                last_error: null
            }
        ]

        const _runPromise = _runResolveConvergenceForTest(state, 99)

        // Synchronously or within microtask
        await settle()

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress is true during convergence',
        )

        // Await completion
        await _runPromise
        await settle()

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress is false after convergence success',
        )
        t.notEqual(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus unchanged on success',
        )
    } finally {
        State.refreshAfterSync = origRefreshAfterSync
        _resetRefreshRefCountForTest(state)
    }
})

// Test 2: Failure path -> red
test('failure path -> red', async t => {
    const state = makeTestState()
    state.feedSyncStatus.value = 'inactive'

    const _origRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {}

    const observedStates: Array<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    > = []
    let lastSeen: 'inactive'|'updates'|'syncing'|'error'|'synced'|null =
        null

    const unsubscribe = effect(() => {
        const val = state.displayedFeedSyncStatus.value
        if (val !== lastSeen) {
            observedStates.push(val)
            lastSeen = val
        }
    })

    try {
        // Populate feeds with resolving feed
        state.feeds.value = [
            {
                id: 99,
                url: 'http://example.com',
                last_fetched: null,
                last_error: null
            }
        ]

        const _runPromise = _runResolveConvergenceForTest(state, 99)

        // Wait a bit
        await settle()

        // Promise should reject (runSync fails internally)
        try {
            await _runPromise
            t.fail('Expected promise to reject')
        } catch (_err) {
            t.pass('promise rejected on error')
        }

        await settle()

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress cleared on error',
        )
        t.equal(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus is error (trackRefresh set it)',
        )
    } finally {
        State.refreshAfterSync = _origRefreshAfterSync
        _resetRefreshRefCountForTest(state)
        unsubscribe()
    }
})

// Test 3: isFeedStillResolving === false -> no acquire
test('isFeedStillResolving false: no acquire', async t => {
    const state = makeTestState()

    const _origRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {}

    try {
        // Populate feeds with RESOLVED feed (has last_fetched)
        state.feeds.value = [
            {
                id: 99,
                url: 'http://example.com',
                last_fetched: 1000,
                last_error: null
            }
        ]

        const _runPromise = _runResolveConvergenceForTest(state, 99)

        // Should return immediately without acquiring
        await _runPromise
        await settle()

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress never acquired (feed not resolving)',
        )
    } finally {
        State.refreshAfterSync = _origRefreshAfterSync
        _resetRefreshRefCountForTest(state)
    }
})

// Test 4: No DB -> no acquire
test('no DB: no acquire', async t => {
    const state = makeTestState()
    state.user.value = null

    const _origRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {}

    try {
        // Populate feeds with resolving feed
        state.feeds.value = [
            {
                id: 99,
                url: 'http://example.com',
                last_fetched: null,
                last_error: null
            }
        ]

        const _runPromise = _runResolveConvergenceForTest(state, 99)

        // Should return immediately without acquiring
        await _runPromise
        await settle()

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress never acquired (no DB available)',
        )
    } finally {
        State.refreshAfterSync = _origRefreshAfterSync
        _resetRefreshRefCountForTest(state)
    }
})
