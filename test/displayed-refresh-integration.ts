import { test } from '@substrate-system/tapzero'
import { signal, computed, batch } from '@preact/signals'
import {
    displayedRefreshInProgress,
    init as initDisplayedRefresh,
    SHOW_DELAY_MS,
    MIN_VISIBLE_MS,
    _resetForTest as resetDisplayedRefresh,
} from '../src/client/displayed-refresh-in-progress.js'
import type { AppState } from '../src/client/state.js'
import {
    _acquireRefreshForTest,
    _releaseRefreshForTest,
    _resetRefreshRefCountForTest,
    _registerRefreshSignalForTest,
} from '../src/client/state.js'

function sleep (ms:number):Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function makeMinimalStateWithDisplayed ():AppState {
    const refreshInProgress = signal<boolean>(false)
    const feedSyncStatus = signal<
        'inactive'|'updates'|'syncing'|'error'|'synced'
    >('inactive')
    const state = {
        refreshInProgress,
        feedSyncStatus,
        displayedFeedSyncStatus: computed<
            'inactive'|'updates'|'syncing'|'error'|'synced'
        >(() => (
            displayedRefreshInProgress.value ?
                'syncing' :
                feedSyncStatus.value
        )),
    } as AppState
    _registerRefreshSignalForTest(state, refreshInProgress)
    return state
}

test(
    'integration: real State() displayedFeedSyncStatus tracks ' +
    'displayedRefreshInProgress through debounce + min-visible',
    async (t) => {
        resetDisplayedRefresh()
        const state = makeMinimalStateWithDisplayed()
        _resetRefreshRefCountForTest(state)

        // Initialize the debounce system with the state's refresh signal
        initDisplayedRefresh(state.refreshInProgress)

        // Baseline: displayed matches feedSyncStatus when raw is false
        t.equal(
            state.displayedFeedSyncStatus.value,
            state.feedSyncStatus.value,
            'baseline: displayed matches feedSyncStatus when raw is false',
        )

        // Acquire raw — flips refreshInProgress.value to true
        _acquireRefreshForTest(state)

        // Pre-debounce: still NOT syncing (inside show-delay window)
        await sleep(50)
        t.notEqual(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'before show-delay: not syncing',
        )

        // Post-debounce: syncing (show-delay has elapsed)
        await sleep(SHOW_DELAY_MS)
        t.equal(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'after show-delay: syncing',
        )

        // Release raw — flips refreshInProgress.value to false
        _releaseRefreshForTest(state)

        // Inside min-visible window: still syncing
        await sleep(50)
        t.equal(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'inside min-visible: still syncing',
        )

        // After min-visible: back to feedSyncStatus
        await sleep(MIN_VISIBLE_MS)
        t.notEqual(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'after min-visible: not syncing anymore',
        )

        resetDisplayedRefresh()
    }
)

test(
    'integration: feedSyncStatus changes are masked by displayed signal',
    async (t) => {
        resetDisplayedRefresh()
        const state = makeMinimalStateWithDisplayed()
        _resetRefreshRefCountForTest(state)

        initDisplayedRefresh(state.refreshInProgress)

        // Baseline
        t.equal(
            state.displayedFeedSyncStatus.value,
            'inactive',
            'baseline: inactive',
        )

        // Acquire and let show-delay elapse
        _acquireRefreshForTest(state)
        await sleep(SHOW_DELAY_MS + 50)

        t.equal(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'after show-delay: syncing',
        )

        // Change feedSyncStatus while displayed is showing syncing
        batch(() => {
            state.feedSyncStatus.value = 'updates'
        })

        // displayed should still be syncing because raw is still true
        t.equal(
            state.displayedFeedSyncStatus.value,
            'syncing',
            'feedSyncStatus change masked by displayed syncing',
        )

        // Release and wait for min-visible to elapse
        _releaseRefreshForTest(state)
        await sleep(MIN_VISIBLE_MS + 50)

        // Now displayed should reflect the feedSyncStatus change
        t.equal(
            state.displayedFeedSyncStatus.value,
            'updates',
            'after min-visible: displays updated feedSyncStatus',
        )

        resetDisplayedRefresh()
    }
)
