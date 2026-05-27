// pattern: Functional Core
import { test } from '@substrate-system/tapzero'
import { signal } from '@preact/signals'
import {
    _acquireRefreshForTest,
    _releaseRefreshForTest,
    _resetRefreshRefCountForTest,
    _registerRefreshSignalForTest
} from '../src/client/state.js'
import type { AppState } from '../src/client/state.js'

function makeMinimalState ():AppState {
    // Minimal stub: only the fields these tests read.
    const refreshInProgress = signal<boolean>(false)
    const state = {
        refreshInProgress
    } as AppState
    _registerRefreshSignalForTest(state, refreshInProgress)
    return state
}

test('refcount: single acquire toggles signal true; single release toggles false',
    (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        t.equal(
            state.refreshInProgress.value,
            false,
            'initial state is false'
        )

        _acquireRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            true,
            'after acquire, signal is true'
        )

        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'after release, signal is false'
        )
    }
)

test('AC3.1: nested acquires (sequential) keep signal true until both release',
    (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        // First acquire
        _acquireRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            true,
            'after first acquire, signal is true'
        )

        // Second acquire
        _acquireRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            true,
            'after second acquire, signal still true'
        )

        // First release
        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            true,
            'after first release, signal still true'
        )

        // Second release
        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'after second release, signal is false'
        )
    }
)

test('AC3.2: extra release is a no-op (no underflow)',
    (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        // Acquire once, release once
        _acquireRefreshForTest(state)
        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'after acquire+release, signal is false'
        )

        // Release a second time (extra release)
        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'extra release is no-op, signal stays false'
        )

        // Acquire again - proves counter started at 0, not -1
        _acquireRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            true,
            'after extra release and acquire, signal transitions to true'
        )

        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'after release, signal is false'
        )
    }
)

test('refcount: multiple acquires then drained',
    (t) => {
        const state = makeMinimalState()
        _resetRefreshRefCountForTest(state)

        // Acquire 5 times
        for (let i = 0; i < 5; i++) {
            _acquireRefreshForTest(state)
        }
        t.equal(
            state.refreshInProgress.value,
            true,
            'after 5 acquires, signal is true'
        )

        // Release 5 times
        for (let i = 0; i < 5; i++) {
            _releaseRefreshForTest(state)
        }
        t.equal(
            state.refreshInProgress.value,
            false,
            'after 5 releases, signal is false'
        )

        // Release a 6th time
        _releaseRefreshForTest(state)
        t.equal(
            state.refreshInProgress.value,
            false,
            'after 6th release, signal still false'
        )
    }
)

test('refcount: per-AppState isolation',
    (t) => {
        const stateA = makeMinimalState()
        const stateB = makeMinimalState()

        _resetRefreshRefCountForTest(stateA)
        _resetRefreshRefCountForTest(stateB)

        // Acquire on instance A
        _acquireRefreshForTest(stateA)
        t.equal(
            stateA.refreshInProgress.value,
            true,
            'A\'s signal is true after acquire'
        )
        t.equal(
            stateB.refreshInProgress.value,
            false,
            'B\'s signal is false (isolated)'
        )

        // Release on A
        _releaseRefreshForTest(stateA)
        t.equal(
            stateA.refreshInProgress.value,
            false,
            'A\'s signal is false after release'
        )
        t.equal(
            stateB.refreshInProgress.value,
            false,
            'B\'s signal is false (still isolated)'
        )
    }
)
