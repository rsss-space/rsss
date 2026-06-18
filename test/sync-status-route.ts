import { test } from '@substrate-system/tapzero'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { batch, signal } from '@preact/signals'
import { SyncStatusRoute } from '../src/client/routes/sync-status.js'
import {
    deadLetters,
    failedFeeds,
    loading,
    confirmingKey,
    announcement
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
        confirmingKey.value = null
        announcement.value = ''
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
            payload: JSON.stringify({ url: 'https://example.com/feed' }),
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

test('sync-status-detail.AC9.1: live region present on first render',
    async t => {
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

            const liveRegion = document.querySelector(
                '[role="status"][aria-live="polite"]'
            )
            t.ok(liveRegion, 'role=status aria-live=polite region ' +
                'present')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC8.4: Retry calls handler immediately ' +
    'with no inline-confirm', async t => {
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
            attempts: 1,
            last_error: null
        }

        const retryCallLog:Array<number> = []
        state.retryDeadLetter = async (_s, id) => {
            retryCallLog.push(id)
            batch(() => {
                deadLetters.value = []
                syncDeadLetters.value = 0
            })
        }

        batch(() => {
            deadLetters.value = [dl]
            syncDeadLetters.value = 1
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelector('.retry-btn') !== null,
            50
        )

        const retryBtn = document.querySelector('.retry-btn')
        t.ok(retryBtn, 'Retry button rendered')

        const confirmBefore = document.querySelector(
            '.confirm-prompt'
        )
        t.equal(confirmBefore, null, 'no confirm-prompt before click')

        retryBtn?.dispatchEvent(new MouseEvent('click', {
            bubbles: true
        }))

        await nextTask()

        t.deepEqual(retryCallLog, [42], 'retryDeadLetter called ' +
            'with correct id')

        const confirmAfter = document.querySelector(
            '.confirm-prompt'
        )
        t.equal(confirmAfter, null, 'no confirm-prompt after retry')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC8.1: Discard click sets confirmingKey ' +
    'and DOM reflects confirm-prompt', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const dl:DeadLetterRow = {
            id: 43,
            op: 'delete_feed',
            target_id: 1,
            payload: '{}',
            client_op_id: 'test-op-43',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 2,
            last_error: 'boom-sentinel'
        }

        const discardCallLog:Array<number> = []
        state.discardDeadLetter = async (_s, discardId) => {
            discardCallLog.push(discardId)
        }

        batch(() => {
            deadLetters.value = [dl]
            syncStatus.value = 'idle'
            syncError.value = null
            confirmingKey.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelector('.discard-btn') !== null,
            50
        )

        t.equal(confirmingKey.value, null,
            'confirmingKey initially null')

        const actionsBefore = document.querySelector(
            '.blocked-change .actions'
        )
        t.ok(actionsBefore, 'actions element present before discard')

        const confirmBefore = document.querySelector(
            '.confirm-prompt'
        )
        t.equal(confirmBefore, null, 'no confirm-prompt before click')

        const discardBtn = document.querySelector('.discard-btn')
        t.ok(discardBtn, 'Discard button rendered')

        ;(discardBtn as HTMLButtonElement)?.click()

        await nextTask()

        t.equal(confirmingKey.value, 'dl:' + dl.id,
            'confirmingKey set to dl:<id> after click')

        t.deepEqual(discardCallLog, [],
            'discardDeadLetter not called on Discard click')

        // Check that actions element is gone (indicating conditional
        // rendered differently). This indirectly confirms that the
        // confirm-prompt conditional branch executed.
        const actionsAfter = document.querySelector(
            '.blocked-change .actions'
        )
        t.equal(actionsAfter, null,
            'actions element hidden when confirming is set')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC8.2: Cancel clears confirmingKey',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const dl:DeadLetterRow = {
                id: 44,
                op: 'add_feed',
                target_id: 1,
                payload: JSON.stringify({
                    url: 'https://example.com/feed2'
                }),
                client_op_id: 'test-op-44',
                client_updated_at: '2026-01-01T00:00:00Z',
                attempts: 1,
                last_error: null
            }

            const discardCallLog:Array<number> = []
            state.discardDeadLetter = async (_s, discardId) => {
                discardCallLog.push(discardId)
            }

            batch(() => {
                deadLetters.value = [dl]
                syncStatus.value = 'idle'
                syncError.value = null
                confirmingKey.value = 'dl:' + dl.id
            })

            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await waitFor(
                () => document.querySelector('.cancel-btn') !== null,
                50
            )

            t.equal(confirmingKey.value, 'dl:' + dl.id,
                'confirmingKey initially set')

            const cancelBtn = document.querySelector('.cancel-btn')
            t.ok(cancelBtn, 'Cancel button rendered')

            ;(cancelBtn as HTMLButtonElement)?.click()

            await nextTask()

            t.equal(confirmingKey.value, null,
                'confirmingKey cleared after Cancel')

            t.deepEqual(discardCallLog, [],
                'discardDeadLetter not called on Cancel')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC8.2: Commit button calls ' +
    'discardDeadLetter and clears confirmingKey', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const dl:DeadLetterRow = {
            id: 45,
            op: 'delete_feed',
            target_id: 1,
            payload: '{}',
            client_op_id: 'test-op-45',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        const discardCallLog:Array<number> = []
        state.discardDeadLetter = async (_s, discardId) => {
            discardCallLog.push(discardId)
            batch(() => {
                deadLetters.value = []
                syncDeadLetters.value = 0
                confirmingKey.value = null
            })
        }

        batch(() => {
            deadLetters.value = [dl]
            syncDeadLetters.value = 1
            syncStatus.value = 'idle'
            syncError.value = null
            confirmingKey.value = 'dl:' + dl.id
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelector('.commit-btn') !== null,
            50
        )

        const commitBtn = document.querySelector('.commit-btn')
        t.ok(commitBtn, 'Commit button rendered')

        ;(commitBtn as HTMLButtonElement)?.click()

        await nextTask()

        t.deepEqual(discardCallLog, [45],
            'discardDeadLetter called with row id')

        t.equal(confirmingKey.value, null,
            'confirmingKey cleared after commit')
    } finally {
        resetSignals()
        cleanup()
    }
})

test('sync-status-detail.AC4.2: Retry removes row from rendered list',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const dl:DeadLetterRow = {
                id: 46,
                op: 'add_feed',
                target_id: 1,
                payload: JSON.stringify({
                    url: 'https://example.com/feed3'
                }),
                client_op_id: 'test-op-46',
                client_updated_at: '2026-01-01T00:00:00Z',
                attempts: 2,
                last_error: 'timeout-sentinel'
            }

            state.retryDeadLetter = async (_s, _id) => {
                batch(() => {
                    deadLetters.value = []
                    syncDeadLetters.value = 0
                })
            }

            batch(() => {
                deadLetters.value = [dl]
                syncDeadLetters.value = 1
                syncStatus.value = 'idle'
                syncError.value = null
            })

            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await waitFor(
                () => document.querySelector('.blocked-change') !== null,
                50
            )

            let rows = document.querySelectorAll('.blocked-change')
            t.equal(rows.length, 1, '1 row initially')

            const retryBtn = document.querySelector('.retry-btn')
            ;(retryBtn as HTMLButtonElement)?.click()

            await waitFor(
                () => document.querySelectorAll(
                    '.blocked-change'
                ).length === 0,
                50
            )

            rows = document.querySelectorAll('.blocked-change')
            t.equal(rows.length, 0, 'row removed after Retry')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC9.2: single live region gets announcement',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const dl:DeadLetterRow = {
                id: 47,
                op: 'add_feed',
                target_id: 1,
                payload: JSON.stringify({
                    url: 'https://example.com/feed4'
                }),
                client_op_id: 'test-op-47',
                client_updated_at: '2026-01-01T00:00:00Z',
                attempts: 1,
                last_error: null
            }

            state.retryDeadLetter = async (_s, _id) => {
                batch(() => {
                    deadLetters.value = []
                    syncDeadLetters.value = 0
                })
            }

            batch(() => {
                deadLetters.value = [dl]
                syncDeadLetters.value = 1
                syncStatus.value = 'idle'
                syncError.value = null
                announcement.value = ''
            })

            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await waitFor(
                () => document.querySelector('.retry-btn') !== null,
                50
            )

            const liveRegionsBefore = document.querySelectorAll(
                '[role="status"][aria-live="polite"]'
            )
            t.equal(liveRegionsBefore.length, 1,
                'exactly one live region present')

            const textBefore =
                liveRegionsBefore[0]?.textContent?.trim()
            t.equal(textBefore, '', 'live region text empty before ' +
                'action')

            const retryBtn = document.querySelector('.retry-btn')
            ;(retryBtn as HTMLButtonElement)?.click()

            await nextTask()

            const liveRegionsAfter = document.querySelectorAll(
                '[role="status"][aria-live="polite"]'
            )
            t.equal(liveRegionsAfter.length, 1,
                'still exactly one live region after action')

            const textAfter =
                liveRegionsAfter[0]?.textContent?.trim()
            t.ok(textAfter && textAfter.length > 0,
                'live region text is non-empty after action')
        } finally {
            resetSignals()
            cleanup()
        }
    }
)

test('sync-status-detail.AC9.3: page h1 has tabindex=-1 ' +
    'for focus-restore fallback', async t => {
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

        const pageHeading = document.querySelector(
            'h1[tabindex="-1"]'
        )
        t.ok(pageHeading, 'page h1 has tabindex="-1"')
        t.ok(pageHeading?.textContent?.includes('Sync Status'),
            'h1 is page heading')
    } finally {
        resetSignals()
        cleanup()
    }
}
)

test('sync-status-detail.AC9.3: focus-restore in component ' +
    'can target page heading', async t => {
    const { root, cleanup } = mountRoot()
    try {
        const { state } = createTestState(true)
        const dl:DeadLetterRow = {
            id: 53,
            op: 'add_feed',
            target_id: 1,
            payload: JSON.stringify({
                url: 'https://example.com/feed7'
            }),
            client_op_id: 'test-op-53',
            client_updated_at: '2026-01-01T00:00:00Z',
            attempts: 1,
            last_error: null
        }

        state.retryDeadLetter = async (_s, _id) => {
            batch(() => {
                deadLetters.value = []
                syncDeadLetters.value = 0
            })
        }

        batch(() => {
            deadLetters.value = [dl]
            syncDeadLetters.value = 1
            syncStatus.value = 'idle'
            syncError.value = null
        })

        render(html`<${SyncStatusRoute} state=${state} />`, root)
        await waitFor(
            () => document.querySelector('.retry-btn') !== null,
            50
        )

        const pageHeading = document.querySelector(
            'h1[tabindex="-1"]'
        )
        t.ok(pageHeading, 'page h1 present with tabindex=-1')

        const retryBtn = document.querySelector('.retry-btn')
        t.ok(retryBtn, 'retry button present')

        ;(retryBtn as HTMLButtonElement)?.click()

        await nextTask()

        // After retry (which empties the list), the focus code
        // should have targeted the page heading
        const h1Focus = document.activeElement === pageHeading
        const someButtonFocus = (
            document.activeElement as HTMLElement
        )?.className?.includes('btn')
        t.ok(
            h1Focus || someButtonFocus,
            'focus set to page heading or button'
        )
    } finally {
        resetSignals()
        cleanup()
    }
}
)

