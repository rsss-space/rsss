import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { batch, signal } from '@preact/signals'
import { SyncStatusRoute } from '../src/client/routes/sync-status.js'
import {
    deadLetters,
    failedFeeds,
    loading
} from '../src/client/routes/sync-status-state.js'
import {
    syncStatus,
    syncError,
    syncDeadLetters
} from '../src/client/db/sync-status.js'
import type { AppState } from '../src/client/state.js'
import type { DeadLetterRow } from '../src/client/db/push-sync.js'

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

function waitFor (
    predicate:() => unknown,
    maxTurns:number = 200
):Promise<void> {
    let turns = 0
    return new Promise((resolve, reject) => {
        const check = async () => {
            if (predicate()) {
                resolve()
                return
            }
            turns++
            if (turns >= maxTurns) {
                reject(new Error(
                    `waitFor: condition not met after ${maxTurns} turns`
                ))
                return
            }
            await nextTask()
            check()
        }
        check()
    })
}

function mountRoot () {
    const root = document.createElement('div')
    document.body.appendChild(root)
    return {
        root,
        cleanup () {
            render(null, root)
            root.remove()
        }
    }
}

function createTestState (
    isAuthenticated:boolean = true
):{
    state:AppState
    setRouteCallbacks:Array<string>
} {
    const user = isAuthenticated ?
        { did: 'did:test:alice', email: 'alice@test.com' } :
        null

    const setRouteCallbacks:Array<string> = []

    const state = {
        authLoading: signal(false),
        isAuthenticated: signal(isAuthenticated),
        user: signal(user),
        _setRoute: (route:string) => {
            setRouteCallbacks.push(route)
        },
        feeds: signal([]),
        feedsWithUpdates: signal([])
    } as unknown as AppState

    return { state, setRouteCallbacks }
}

function resetSignals ():void {
    batch(() => {
        deadLetters.value = []
        failedFeeds.value = []
        loading.value = false
        syncStatus.value = 'idle'
        syncError.value = null
        syncDeadLetters.value = 0
    })
}

test('sync-status-detail.AC1.4: authenticated user renders the route',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state, setRouteCallbacks } = createTestState(true)
            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await nextTask()

            const routeEl = document.querySelector('.route.sync-status')
            t.ok(routeEl, 'route container rendered')
            t.equal(
                setRouteCallbacks.length,
                0,
                'no redirect to login'
            )
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC1.5: unauthenticated user redirects to login',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state, setRouteCallbacks } = createTestState(false)
            render(html`<${SyncStatusRoute} state=${state} />`, root)

            await waitFor(() => setRouteCallbacks.includes('/login'), 50)

            t.ok(
                setRouteCallbacks.includes('/login'),
                '_setRoute called with /login'
            )

            const routeEl = document.querySelector('.route.sync-status')
            t.equal(routeEl, null, 'route not rendered')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC5.1: empty state renders when no problems',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            batch(() => {
                deadLetters.value = []
                failedFeeds.value = []
                syncStatus.value = 'idle'
                syncError.value = null
            })

            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await nextTask()

            const emptyState = document.querySelector('.empty-state')
            t.ok(emptyState, 'empty-state element rendered')

            const currentError = document.querySelector('.current-error')
            t.equal(currentError, null, 'current-error section not rendered')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC5.2: empty state transitions ' +
    'when problems are resolved', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const testDeadLetter:DeadLetterRow = {
            id: 1,
            op: 'create',
            target_id: 1,
            payload: '{}',
            client_op_id: 'test-op-1',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        batch(() => {
            deadLetters.value = [testDeadLetter]
            syncDeadLetters.value = 1
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await nextTask()

        let emptyState = document.querySelector('.empty-state')
        t.equal(emptyState, null, 'empty-state not initially rendered')

        // Transition: resolve all problems
        batch(() => {
            deadLetters.value = []
            syncDeadLetters.value = 0
        })

        await nextTask()

        emptyState = document.querySelector('.empty-state')
        t.ok(emptyState, 'empty-state now rendered after resolution')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC7.1: current-error section shows ' +
    'syncError message when syncStatus is error', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const testError = 'sentinel-sync-failure'

        batch(() => {
            syncStatus.value = 'error'
            syncError.value = testError
            deadLetters.value = []
            failedFeeds.value = []
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await nextTask()

        const currentErrorSection = document.querySelector('.current-error')
        t.ok(currentErrorSection, 'current-error section rendered')

        t.ok(
            currentErrorSection?.textContent?.includes(testError),
            `section contains sentinel string: ${testError}`
        )
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC7.2: current-error section omitted ' +
    'when syncStatus is not error', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        batch(() => {
            syncStatus.value = 'idle'
            syncError.value = 'this-error-should-not-appear'
            deadLetters.value = []
            failedFeeds.value = []
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await nextTask()

        const currentErrorSection = document.querySelector(
            '.current-error'
        )
        t.equal(currentErrorSection, null, 'current-error section ' +
            'not rendered')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC2.1: deadLetters renders as ' +
    'blocked-change rows', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const dl1:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 1,
            payload: JSON.stringify({url: 'https://example.com/feed'}),
            client_op_id: 'test-op-1',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 2,
            last_error: 'timeout-sentinel'
        }
        const dl2:DeadLetterRow = {
            id: 2,
            op: 'delete_feed',
            target_id: 1,
            payload: '{}',
            client_op_id: 'test-op-2',
            client_updated_at: '2026-01-01T00:00:01Z',
            attempts: 1,
            last_error: null
        }

        batch(() => {
            deadLetters.value = [dl1, dl2]
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelectorAll(
                '.blocked-change'
            ).length === 2,
            50
        )

        const rows = document.querySelectorAll('.blocked-change')
        t.equal(rows.length, 2, 'exactly 2 blocked-change rows ' +
            'rendered')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC2.2: blocked-change row shows ' +
    'description, attempts, and last_error', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const dl:DeadLetterRow = {
            id: 42,
            op: 'add_feed',
            target_id: 1,
            payload: JSON.stringify({
                url: 'https://example.com/feed1'
            }),
            client_op_id: 'test-op-42',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 3,
            last_error: 'connection-broken-sentinel'
        }

        batch(() => {
            deadLetters.value = [dl]
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelector('.blocked-change') !== null,
            50
        )

        const row = document.querySelector('.blocked-change')
        t.ok(row, 'blocked-change row rendered')

        const descEl = row?.querySelector('.op-description')
        t.ok(descEl, 'op-description element present')
        t.ok(descEl?.textContent?.includes('Add feed'),
            'description contains op type')

        const attemptsEl = row?.querySelector('.attempts .value')
        t.equal(attemptsEl?.textContent?.trim(), '3',
            'attempts value shows 3')

        const errorEl = row?.querySelector('.last-error .error-text')
        t.equal(errorEl?.textContent?.trim(),
            'connection-broken-sentinel',
            'last_error text present')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC2.3: blocked-changes section ' +
    'omitted when deadLetters empty', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)

        batch(() => {
            deadLetters.value = []
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await nextTask()

        const section = document.querySelector('.blocked-changes')
        t.equal(section, null, 'blocked-changes section not ' +
            'rendered when empty')
    } finally {
        resetSignals()
        cleanup()
    }
})
