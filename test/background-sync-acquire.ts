import { signal, computed, effect } from '@preact/signals'
import { test } from '@substrate-system/tapzero'
import {
    State,
    type AppState,
    _registerRefreshSignalForTest,
    _resetRefreshRefCountForTest,
    _onlineRecoverySyncForTest,
    _setRunResolveConvergenceDepsForTest,
    _resetRunResolveConvergenceDepsForTest,
    _setIsLocalFirstActiveForTest,
    _resetIsLocalFirstActiveForTest,
} from '../src/client/state.js'
import {
    init as initDisplayedRefresh,
    _resetForTest as resetDisplayedRefresh,
} from '../src/client/displayed-refresh-in-progress.js'
import {
    StubWebSocket,
    withStubbedWebSocket
} from './helpers/stub-live-socket.js'

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
        items: signal<any[]>([]),
        itemsLoading: signal(false),
        itemsTotal: signal(0),
        itemsOffset: signal(0),
        counts: signal({ unread: 0, starred: 0, total: 0, perFeed: {} }),
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

function nextTask ():Promise<void> {
    return new Promise(_resolve => setTimeout(_resolve, 0))
}

async function settle (count = 4):Promise<void> {
    for (let i = 0; i < count; i++) {
        await nextTask()
    }
}

// Group A: SSE feed-updated tests

test('AC1.3.1: feed-updated fires -> debounce elapses -> ' +
    'refreshAfterSync runs under trackRefresh',
async t => {
    const state = makeMinimalState()

    const refreshCompleted:boolean[] = []
    const originalRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async (_s:AppState) => {
        await new Promise(_resolve => setTimeout(_resolve, 30))
        refreshCompleted.push(true)
    }

    try {
        await withStubbedWebSocket(async () => {
            State.openEventStream(state)
            const source = StubWebSocket.instances[0]

            t.equal(
                state.refreshInProgress.value,
                false,
                'pre-event refreshInProgress is false'
            )

            source.fire('feed-updated')
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'immediately after feed-updated is still false (debounced)'
            )

            // Production SSE_REFRESH_DEBOUNCE_MS = 250; wait for it to elapse
            await new Promise(_resolve => setTimeout(_resolve, 250 + 5))
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                true,
                'after debounce, refreshInProgress is true'
            )

            // Wait for refreshAfterSync to finish
            await new Promise(_resolve => setTimeout(_resolve, 50))
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'after refreshAfterSync completes, refreshInProgress is false'
            )

            t.equal(
                refreshCompleted.length,
                1,
                'refreshAfterSync was called once'
            )

            State.closeEventStream()
        })
    } finally {
        State.refreshAfterSync = originalRefreshAfterSync
    }
})

test('AC1.3.2: multiple feed-updated events coalesce ' +
    '(single false->true->false cycle)',
async t => {
    const state = makeMinimalState()

    const refreshAfterSyncCalls:number[] = []
    const originalRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {
        refreshAfterSyncCalls.push(Date.now())
        await new Promise(_resolve => setTimeout(_resolve, 30))
    }

    const transitions:boolean[] = []
    const dispose = effect(() => {
        transitions.push(state.refreshInProgress.value)
    })

    try {
        await withStubbedWebSocket(async () => {
            State.openEventStream(state)
            const source = StubWebSocket.instances[0]

            // Fire three events in quick succession
            source.fire('feed-updated')
            await nextTask()
            source.fire('feed-updated')
            await nextTask()
            source.fire('feed-updated')
            await nextTask()

            // Wait for debounce + completion
            await new Promise(_resolve => setTimeout(_resolve,
                250 + 50))
            await settle()

            // Count false->true and true->false transitions
            let falseToTrue = 0
            let trueToFalse = 0
            for (let i = 1; i < transitions.length; i++) {
                if (!transitions[i - 1] && transitions[i]) falseToTrue++
                if (transitions[i - 1] && !transitions[i]) trueToFalse++
            }

            t.equal(
                falseToTrue,
                1,
                'exactly one false->true transition'
            )
            t.equal(
                trueToFalse,
                1,
                'exactly one true->false transition'
            )
            t.equal(
                refreshAfterSyncCalls.length,
                1,
                'refreshAfterSync called exactly once'
            )

            State.closeEventStream()
        })
    } finally {
        State.refreshAfterSync = originalRefreshAfterSync
        dispose()
    }
})

test('AC1.3.3: refreshAfterSync rejects -> feedSyncStatus ' +
    'becomes error',
async t => {
    const state = makeMinimalState()

    const originalRefreshAfterSync = State.refreshAfterSync
    State.refreshAfterSync = async () => {
        throw new Error('test refresh error')
    }

    try {
        await withStubbedWebSocket(async () => {
            State.openEventStream(state)
            const source = StubWebSocket.instances[0]

            state.feedSyncStatus.value = 'synced'
            source.fire('feed-updated')

            // Production SSE_REFRESH_DEBOUNCE_MS = 250; wait for it
            await new Promise(_resolve => setTimeout(_resolve,
                250 + 10))
            await settle()

            t.equal(
                state.refreshInProgress.value,
                false,
                'refreshInProgress is false after error'
            )
            t.equal(
                state.feedSyncStatus.value,
                'error',
                'feedSyncStatus is error'
            )

            State.closeEventStream()
        })
    } finally {
        State.refreshAfterSync = originalRefreshAfterSync
    }
})

// Group B: online-recovery tests

test('AC1.4.1: _onlineRecoverySyncForTest acquires and releases',
    async t => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)
        resetDisplayedRefresh()
        initDisplayedRefresh(state.refreshInProgress)

        const originalRefreshAfterSync = State.refreshAfterSync
        State.refreshAfterSync = async () => {
            await new Promise(_resolve => setTimeout(_resolve, 30))
        }

        const testDb = {} as any
        _setRunResolveConvergenceDepsForTest({
            runSync: async () => {},
            getLocalDb: (_did?:string) => testDb
        })

        _setIsLocalFirstActiveForTest(() => signal(true))

        try {
            t.equal(
                state.refreshInProgress.value,
                false,
                'pre-call refreshInProgress is false'
            )

            // Call without await to test initial acquire
            const promise = _onlineRecoverySyncForTest(state)
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                true,
                'after call, refreshInProgress is true'
            )

            // Wait for completion
            await promise
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'after completion, refreshInProgress is false'
            )

            t.equal(
                state.feedSyncStatus.value,
                'inactive',
                'feedSyncStatus unchanged (no error)'
            )
        } finally {
            State.refreshAfterSync = originalRefreshAfterSync
            _resetRunResolveConvergenceDepsForTest()
            _resetIsLocalFirstActiveForTest()
        }
    })

test('AC1.4.2: runSync rejects -> feedSyncStatus is error',
    async t => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)
        resetDisplayedRefresh()
        initDisplayedRefresh(state.refreshInProgress)

        const originalRefreshAfterSync = State.refreshAfterSync
        State.refreshAfterSync = async () => {}

        const testDb = {} as any
        _setRunResolveConvergenceDepsForTest({
            runSync: async () => {
                throw new Error('sync failed')
            },
            getLocalDb: (_did?:string) => testDb
        })

        _setIsLocalFirstActiveForTest(() => signal(true))

        // Stub error handlers to not overwrite status
        const originalHandleSyncAuthError = State.handleSyncAuthError
        const originalHandleSyncCycleError = State.handleSyncCycleError
        State.handleSyncAuthError = () => false
        State.handleSyncCycleError = () => {}

        try {
            state.feedSyncStatus.value = 'synced'

            await _onlineRecoverySyncForTest(state)
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'refreshInProgress is false after error'
            )
            t.equal(
                state.feedSyncStatus.value,
                'error',
                'feedSyncStatus is error'
            )
        } finally {
            State.refreshAfterSync = originalRefreshAfterSync
            _resetRunResolveConvergenceDepsForTest()
            _resetIsLocalFirstActiveForTest()
            State.handleSyncAuthError = originalHandleSyncAuthError
            State.handleSyncCycleError = originalHandleSyncCycleError
        }
    })

test('AC1.4.3: isLocalFirstActive === false -> no acquire',
    async t => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        _setIsLocalFirstActiveForTest(() => signal(false))

        try {
            await _onlineRecoverySyncForTest(state)
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'refreshInProgress stays false when isLocalFirstActive is false'
            )
        } finally {
            _resetIsLocalFirstActiveForTest()
        }
    })

test('AC1.4.4: no DB -> no acquire',
    async t => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        _setRunResolveConvergenceDepsForTest({
            runSync: async () => {},
            getLocalDb: (_did?:string) => null
        })

        _setIsLocalFirstActiveForTest(() => signal(true))

        try {
            await _onlineRecoverySyncForTest(state)
            await nextTask()

            t.equal(
                state.refreshInProgress.value,
                false,
                'refreshInProgress stays false when db is null'
            )
        } finally {
            _resetRunResolveConvergenceDepsForTest()
            _resetIsLocalFirstActiveForTest()
        }
    })
