// pattern: Functional Core
import { test } from '@substrate-system/tapzero'
import { signal, effect, computed } from '@preact/signals'
import {
    trackRefresh,
    _resetRefreshRefCountForTest,
    _registerRefreshSignalForTest,
} from '../src/client/state.js'
import type { AppState } from '../src/client/state.js'

type SyncStatus =
    | 'inactive'
    | 'updates'
    | 'syncing'
    | 'error'
    | 'synced'

function makeMinimalState ():AppState {
    const refreshInProgress = signal<boolean>(false)
    const feedSyncStatus = signal<SyncStatus>('inactive')
    const displayedFeedSyncStatus = computed<SyncStatus>(() => (
        refreshInProgress.value ?
            'syncing' :
            feedSyncStatus.value
    ))
    const state = {
        refreshInProgress,
        feedSyncStatus,
        displayedFeedSyncStatus,
    } as AppState
    _registerRefreshSignalForTest(state, refreshInProgress)
    return state
}

test(
    'trackRefresh resolve path: holds signal true during fn, ' +
    'releases on settle',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        state.feedSyncStatus.value = 'synced'

        let duringCallCheck = false
        const result = await trackRefresh(
            state,
            'add-feed',
            async () => {
                // While the fn is awaiting, the signal should be true
                duringCallCheck = state.refreshInProgress.value
                await new Promise(resolve => setTimeout(resolve, 5))
                return 'test-result'
            },
        )

        t.equal(
            duringCallCheck,
            true,
            'refreshInProgress is true while fn is awaiting'
        )
        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress is false after settle'
        )
        t.equal(
            state.feedSyncStatus.value,
            'synced',
            'feedSyncStatus is unchanged (not touched by helper)'
        )
        t.equal(
            result,
            'test-result',
            'result is returned'
        )
    }
)

test(
    'AC4.1: reject path sets feedSyncStatus to error in same batch, ' +
    'no intermediate state',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        state.feedSyncStatus.value = 'synced'

        const observed:SyncStatus[] = []

        // Set up the effect BEFORE trackRefresh so we observe from the
        // beginning. The initial subscription will see 'synced'.
        const disposeEffect = effect(() => {
            observed.push(state.displayedFeedSyncStatus.value)
        })

        // Yield to allow the effect to run and record initial 'synced'
        await new Promise(resolve => setTimeout(resolve, 0))
        observed.length = 0 // Clear the initial 'synced' we captured

        let threwCorrectly = false
        try {
            await trackRefresh(
                state,
                'add-feed',
                async () => {
                    throw new Error('boom')
                },
            )
        } catch (err) {
            if (err instanceof Error && err.message === 'boom') {
                threwCorrectly = true
            }
        }

        disposeEffect()

        t.equal(
            threwCorrectly,
            true,
            'original error was rethrown'
        )
        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress is false after reject'
        )
        t.equal(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus is set to error'
        )
        // The observed sequence after clearing initial should be:
        // ['syncing', 'error'] with NO intermediate 'synced'/'inactive'
        t.equal(
            JSON.stringify(observed),
            JSON.stringify(['syncing', 'error']),
            'displayedFeedSyncStatus observes syncing->error, ' +
            'no intermediate'
        )
    }
)

test(
    'trackRefresh reject: feedSyncStatus is overwritten ' +
    'regardless of prior value',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        state.feedSyncStatus.value = 'updates'

        let threwCorrectly = false
        try {
            await trackRefresh(
                state,
                'add-feed',
                async () => {
                    throw new Error('boom')
                },
            )
        } catch (_err) {
            if (_err instanceof Error && _err.message === 'boom') {
                threwCorrectly = true
            }
        }

        t.equal(
            threwCorrectly,
            true,
            'original error was rethrown'
        )
        t.equal(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus was overwritten to error from updates'
        )
    }
)

test(
    'AC4.2 corollary: resolve path does NOT touch feedSyncStatus',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        state.feedSyncStatus.value = 'updates'

        const result = await trackRefresh(
            state,
            'add-feed',
            async () => {
                await new Promise(resolve => setTimeout(resolve, 5))
                return 'resolved'
            },
        )

        t.equal(
            state.feedSyncStatus.value,
            'updates',
            'feedSyncStatus is unchanged on resolve'
        )
        t.equal(
            result,
            'resolved',
            'result is returned'
        )
    }
)

test(
    'AC3.1: concurrent trackRefresh calls keep signal true until both settle',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        let resolve1:(value:void) => void = () => {}
        let resolve2:(value:void) => void = () => {}

        const p1 = new Promise<void>((resolve) => { resolve1 = resolve })
        const p2 = new Promise<void>((resolve) => { resolve2 = resolve })

        // Start both without awaiting
        const _promise1 = trackRefresh(state, 'add-feed', () => p1)
        const promise2 = trackRefresh(
            state,
            'sse-feed-updated',
            () => p2,
        )

        // Yield to event loop so both have reached their await fn()
        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress is true after both acquire'
        )

        // Resolve first promise
        resolve1()
        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress still true after first resolves'
        )

        // Resolve second promise
        resolve2()
        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress false after both resolve'
        )

        // Verify both completed
        await _promise1
        await promise2
        t.equal(
            state.refreshInProgress.value,
            false,
            'signal is false after both trackRefresh calls settle',
        )
    }
)

test(
    'mixed concurrent: one resolves, one rejects',
    async (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        state.feedSyncStatus.value = 'synced'

        let resolve2:(value:void) => void = () => {}
        const p2 = new Promise<void>((resolve) => { resolve2 = resolve })

        // Start first with rejection, second with a deferred promise,
        // both without awaiting. Immediately attach a catch to the first
        // to prevent unhandled rejection.
        const _promise1 = trackRefresh(
            state,
            'add-feed',
            async () => {
                throw new Error('operation failed')
            },
        ).catch(() => {}) // Suppress unhandled rejection

        const promise2 = trackRefresh(
            state,
            'online-recovery',
            () => p2,
        )

        // Yield to event loop so both have been started
        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress is true while both in flight'
        )

        // Wait a bit for the first to settle
        await _promise1
        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            true,
            'refreshInProgress still true (second still in flight)'
        )

        t.equal(
            state.feedSyncStatus.value,
            'error',
            'feedSyncStatus was set to error by the rejection'
        )

        // Resolve the second promise
        resolve2()

        await promise2

        await new Promise(resolve => setTimeout(resolve, 0))

        t.equal(
            state.refreshInProgress.value,
            false,
            'refreshInProgress is false after both settle'
        )
    }
)
