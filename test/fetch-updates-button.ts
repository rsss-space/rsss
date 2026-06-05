import { signal, computed } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedStatus } from '../src/client/components/feed-status.js'
import {
    State,
    type AppState,
    _registerRefreshSignalForTest
} from '../src/client/state.js'
import {
    withStubbedWebSocket
} from './helpers/stub-live-socket.js'

type FetchInput = Parameters<typeof fetch>[0]
type FetchInit = Parameters<typeof fetch>[1]
type FetchHandler = (
    input:FetchInput,
    init?:FetchInit
) => Promise<Response>

function withStubbedFetch<T> (
    handler:FetchHandler,
    fn:() => Promise<T>
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

type FeedSyncStatus = 'inactive'|'updates'|'syncing'|'error'|'synced'

function buildPartialState ():AppState {
    const refreshInProgress = signal(false)
    const feedSyncStatus = signal<FeedSyncStatus>('inactive')
    const displayedFeedSyncStatus = computed<FeedSyncStatus>(() => (
        refreshInProgress.value ?
            'syncing' :
            feedSyncStatus.value
    ))
    const state = {
        _setRoute: () => {},
        route: signal('/'),
        user: signal({
            did: 'did:plc:test',
            handle: 'test.bsky.social'
        }),
        authError: signal<string|null>(null),
        feeds: signal([]),
        feedsLoading: signal(false),
        refreshInProgress,
        feedSyncStatus,
        displayedFeedSyncStatus,
        feedSyncError: signal<string|null>(null),
        feedUpdateCounts: signal<Record<string, number>>({}),
        isAuthenticated: signal(true)
    } as unknown as AppState

    _registerRefreshSignalForTest(state, refreshInProgress)

    return state
}

function mount (state:AppState):HTMLDivElement {
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)
    render(html`<${FeedStatus} state=${state}/>`, root)
    return root
}

function unmount (root:HTMLDivElement):void {
    render(null, root)
    root.remove()
}

function fetchUpdatesButton (root:HTMLElement):HTMLButtonElement {
    const btn = root.querySelector(
        '.fetch-updates-btn'
    ) as HTMLButtonElement|null
    if (!btn) {
        throw new Error('fetch-updates button not found in mounted output')
    }
    return btn
}

function nextTask ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

async function settle (count = 4):Promise<void> {
    for (let i = 0; i < count; i++) {
        await nextTask()
    }
}

function refreshUrl (input:FetchInput):string {
    return typeof input === 'string' ?
        input :
        input instanceof URL ?
            input.toString() :
            input.url
}

// US1 - T005: a single click on the header "fetch updates" button
// dispatches exactly one POST /api/feeds/refresh — the same action as
// the sidebar "Refresh Feeds" control (FR-003, SC-003).
test('clicking the "fetch updates" button dispatches exactly one ' +
    'POST /api/feeds/refresh (SC-003)',
async t => {
    const state = buildPartialState()
    state.feedUpdateCounts.value = { 1: 4 }
    state.feedSyncStatus.value = 'updates'

    const originalReconcileAfterRefresh = State.reconcileAfterRefresh
    State.reconcileAfterRefresh = async () => {}

    let postCalls = 0
    let resolvePost:((r:Response) => void)|null = null
    const postGate = new Promise<Response>(resolve => {
        resolvePost = resolve
    })

    const root = mount(state)
    try {
        await withStubbedWebSocket(async () => {
            await withStubbedFetch(async (input) => {
                if (refreshUrl(input).endsWith('/api/feeds/refresh')) {
                    postCalls += 1
                    return postGate
                }
                return jsonResponse({})
            }, async () => {
                State.openEventStream(state)

                const btn = fetchUpdatesButton(root)
                btn.dispatchEvent(new MouseEvent('click', {
                    bubbles: true
                }))

                // Yield once so refreshFeeds enters its click-setup
                // batch and dispatches the POST.
                await nextTask()

                t.equal(
                    postCalls,
                    1,
                    'click dispatches exactly one POST /api/feeds/refresh'
                )

                resolvePost!(jsonResponse({ success: true, queued: 4 }))
                await settle()
            })
        })
    } finally {
        unmount(root)
        State.reconcileAfterRefresh = originalReconcileAfterRefresh
        State.closeEventStream()
    }
})

// US2 - T008: while a refresh is in flight, the button reflects the
// busy state (disabled + aria-busy) the same way the sidebar control
// does (FR-005). The displayed status normally flips to 'syncing' and
// the button unmounts; the ~300ms SHOW_DELAY_MS window before that flip
// is what isSpinning covers. The test pins the displayed status to
// 'updates' so the busy button stays observable, and sets
// refreshInProgress before mount so the initial render reflects it.
test('the "fetch updates" button is disabled with aria-busy="true" ' +
    'while a refresh is in progress (FR-005)',
t => {
    const state = buildPartialState()
    state.feedUpdateCounts.value = { 1: 4 }
    state.feedSyncStatus.value = 'updates'
    ;(state as unknown as {
        displayedFeedSyncStatus:typeof state.displayedFeedSyncStatus
    }).displayedFeedSyncStatus = computed(() => 'updates')
    ;(state.refreshInProgress as unknown as { value:boolean })
        .value = true

    const root = mount(state)
    try {
        const btn = fetchUpdatesButton(root)
        t.ok(
            btn.disabled,
            'button is disabled while refreshInProgress is true'
        )
        t.equal(
            btn.getAttribute('aria-busy'),
            'true',
            'button exposes aria-busy="true" while refreshing'
        )
    } finally {
        unmount(root)
    }
})

// US2 - T008: a click while a fetch is already in flight (from either
// entry point) dispatches no second POST (FR-006, SC-005).
test('a click while a refresh is already in progress dispatches no ' +
    'additional POST (FR-006 / SC-005)',
async t => {
    const state = buildPartialState()
    state.feedUpdateCounts.value = { 1: 4 }
    state.feedSyncStatus.value = 'updates'

    // Pin the displayed status to 'updates' so the button stays
    // mounted even though refreshInProgress is true, letting us drive a
    // click against an already-in-flight refresh.
    ;(state as unknown as {
        displayedFeedSyncStatus:typeof state.displayedFeedSyncStatus
    }).displayedFeedSyncStatus = computed(() => 'updates')
    // Simulate an in-flight refresh started from either entry point.
    ;(state.refreshInProgress as unknown as { value:boolean })
        .value = true

    let postCalls = 0
    const root = mount(state)
    try {
        await withStubbedFetch(async (input) => {
            if (refreshUrl(input).endsWith('/api/feeds/refresh')) {
                postCalls += 1
                return jsonResponse({ success: true, queued: 4 })
            }
            return jsonResponse({})
        }, async () => {
            const btn = fetchUpdatesButton(root)
            btn.dispatchEvent(new MouseEvent('click', {
                bubbles: true
            }))
            await settle()

            t.equal(
                postCalls,
                0,
                'no POST is dispatched while a refresh is already ' +
                'in progress'
            )
        })
    } finally {
        unmount(root)
    }
})
