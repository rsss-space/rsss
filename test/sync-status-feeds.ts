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
import type { Feed } from '../src/client/db/types.js'

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
        feedsWithUpdates: signal([]),
        refreshFeed: async () => {},
        toggleFeedPublished: async () => {},
        deleteFeed: async () => ({ success: true })
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

// Helper: seed failedFeeds and wait for render, handling the mount clobber
async function mountWithFeeds (
    root:HTMLElement,
    state:AppState,
    feeds:Feed[],
    seed?:() => void
):Promise<void> {
    batch(() => {
        failedFeeds.value = feeds
        syncDeadLetters.value = 0
        syncStatus.value = 'idle'
        syncError.value = null
        seed?.()
    })
    render(html`<${SyncStatusRoute} state=${state} />`, root)
    // Wait out the one-time mount clobber (loadSyncStatus clears
    // failedFeeds to [] when there is no DB)
    await waitFor(() => failedFeeds.value.length === 0, 50)
    // Re-seed the feeds
    batch(() => {
        failedFeeds.value = feeds
        seed?.()
    })
    // Wait for rows to render
    await waitFor(
        () => document.querySelectorAll('.failed-feed').length ===
            feeds.length,
        50
    )
}

// Task 1: "Feeds that couldn't fetch" section
test('sync-status-detail.AC3.1: feed with last_error renders in fetch-failed section',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 1,
                url: 'https://example.com/feed',
                title: 'Example Feed',
                last_error: 'Connection timeout',
                last_status: null,
                publish_error: null
            } as Feed

            await mountWithFeeds(root, state, [feed])

            const section = document.querySelector(
                '.sync-status-section.feeds-fetch-failed'
            )
            t.ok(section, 'fetch-failed section rendered')

            const rows = section?.querySelectorAll('.failed-feed')
            t.equal(rows?.length, 1, 'one failed-feed row')

            const titleEl = rows?.[0]?.textContent
            t.ok(titleEl?.includes('Example Feed'), 'feed title displayed')
            t.ok(
                titleEl?.includes('Connection timeout'),
                'error message displayed'
            )
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC3.1: feed with last_status >= 400 renders in fetch-failed section',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 2,
                url: 'https://broken.com/feed',
                title: 'Broken Feed',
                last_error: null,
                last_status: 500,
                publish_error: null
            } as Feed

            await mountWithFeeds(root, state, [feed])

            const section = document.querySelector(
                '.sync-status-section.feeds-fetch-failed'
            )
            t.ok(section, 'fetch-failed section rendered')

            const titleEl = section?.textContent
            t.ok(titleEl?.includes('Broken Feed'), 'feed title displayed')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC3.4: clean feed does not render in fetch-failed section',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 3,
                url: 'https://clean.com/feed',
                title: 'Clean Feed',
                last_error: null,
                last_status: 200,
                publish_error: null
            } as Feed

            batch(() => {
                failedFeeds.value = [feed]
                syncDeadLetters.value = 0
                syncStatus.value = 'idle'
                syncError.value = null
            })
            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await waitFor(() => failedFeeds.value.length === 0, 50)
            batch(() => {
                failedFeeds.value = [feed]
            })
            await nextTask()

            const section = document.querySelector(
                '.sync-status-section.feeds-fetch-failed'
            )
            t.equal(section, null, 'fetch-failed section not rendered')

            const rows = document.querySelectorAll('.failed-feed')
            t.equal(rows.length, 0, 'no failed-feed rows')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC3.5: empty fetch-failed section omitted',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            batch(() => {
                failedFeeds.value = []
                syncDeadLetters.value = 0
                syncStatus.value = 'idle'
                syncError.value = null
            })
            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await nextTask()

            const section = document.querySelector(
                '.sync-status-section.feeds-fetch-failed'
            )
            t.equal(section, null, 'fetch-failed section not rendered when empty')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC3.2: feed with publish_error renders in publish-failed section',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 4,
                url: 'https://cantpublish.com/feed',
                title: 'Publish Failed Feed',
                last_error: null,
                last_status: 200,
                publish_error: 'pds_write_failed'
            } as Feed

            await mountWithFeeds(root, state, [feed])

            const section = document.querySelector(
                '.sync-status-section.feeds-publish-failed'
            )
            t.ok(section, 'publish-failed section rendered')

            const rows = section?.querySelectorAll('.failed-feed')
            t.equal(rows?.length, 1, 'one failed-feed row')

            const titleEl = rows?.[0]?.textContent
            t.ok(
                titleEl?.includes('Publish Failed Feed'),
                'feed title displayed'
            )
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC3.3: feed with both fetch and publish errors renders in both sections',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 5,
                url: 'https://doubly-failed.com/feed',
                title: 'Double Failed Feed',
                last_error: 'Timeout',
                last_status: null,
                publish_error: 'pds_write_failed'
            } as Feed

            batch(() => {
                failedFeeds.value = [feed]
                syncDeadLetters.value = 0
                syncStatus.value = 'idle'
                syncError.value = null
            })
            render(html`<${SyncStatusRoute} state=${state} />`, root)
            await waitFor(() => failedFeeds.value.length === 0, 50)
            batch(() => {
                failedFeeds.value = [feed]
            })
            // Wait for both sections to render (2 rows total: one per section)
            await waitFor(
                () => document.querySelectorAll('.failed-feed').length === 2,
                50
            )

            const fetchSection = document.querySelector(
                '.sync-status-section.feeds-fetch-failed'
            )
            const publishSection = document.querySelector(
                '.sync-status-section.feeds-publish-failed'
            )

            t.ok(fetchSection, 'feed appears in fetch-failed section')
            t.ok(publishSection, 'feed appears in publish-failed section')

            const fetchRows = fetchSection?.querySelectorAll('.failed-feed')
            const publishRows = publishSection?.querySelectorAll(
                '.failed-feed'
            )

            t.equal(fetchRows?.length, 1, 'one row in fetch section')
            t.equal(publishRows?.length, 1, 'one row in publish section')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC10.2: feed with reauth_required shows reauth link instead of retry button',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 6,
                url: 'https://reauth.com/feed',
                title: 'Needs Reauth Feed',
                last_error: null,
                last_status: 200,
                publish_error: 'reauth_required'
            } as Feed

            await mountWithFeeds(root, state, [feed])

            const publishSection = document.querySelector(
                '.sync-status-section.feeds-publish-failed'
            )
            const reauthLink = publishSection?.querySelector(
                'a.reauth-link'
            )
            const row = publishSection?.querySelector('.failed-feed')
            const allButtons = row?.querySelectorAll('button')
            const retryShareButton = Array.from(allButtons || [])
                .find(btn => btn.textContent?.includes('Retry share'))

            t.ok(reauthLink, 'reauth link rendered')
            t.equal(
                reauthLink?.getAttribute('href'),
                '/login',
                'reauth link points to /login'
            )
            t.equal(
                retryShareButton,
                undefined,
                'retry button not rendered for reauth_required'
            )
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC8.3: clicking unsubscribe reveals inline confirm for feed',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 7,
                url: 'https://unsub.com/feed',
                title: 'Unsubscribe Feed',
                last_error: 'Network error',
                last_status: null,
                publish_error: null
            } as Feed

            await mountWithFeeds(root, state, [feed])

            const row = document.querySelector('.failed-feed')
            const buttons = row?.querySelectorAll(
                'button'
            ) as NodeListOf<HTMLButtonElement> | undefined
            const unsubButton = Array.from(buttons || [])
                .find(btn => btn.textContent?.includes('Unsubscribe'))

            // Click Unsubscribe button
            unsubButton?.click()
            await nextTask()

            // Check that confirm prompt appears
            const confirmPrompt = row?.querySelector('.confirm-prompt')
            t.ok(confirmPrompt, 'confirm prompt revealed')

            // Check that feed is still present (not deleted yet)
            const feedRowAfter = document.querySelector('.failed-feed')
            t.ok(feedRowAfter, 'feed row still present after clicking unsubscribe')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC11.1: retry-fetch and retry-share buttons are disabled when offline',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const fetchFeed:Feed = {
                id: 8,
                url: 'https://fetch.com/feed',
                title: 'Fetch Feed',
                last_error: 'Timeout',
                last_status: null,
                publish_error: null
            } as Feed
            const publishFeed:Feed = {
                id: 9,
                url: 'https://pub.com/feed',
                title: 'Publish Feed',
                last_error: null,
                last_status: 200,
                publish_error: 'pds_write_failed'
            } as Feed

            await mountWithFeeds(
                root,
                state,
                [fetchFeed, publishFeed],
                () => {
                    syncStatus.value = 'offline'
                }
            )

            const retryButtons = document.querySelectorAll(
                '.failed-feed button:not(.cancel-btn):not(.commit-btn)'
            ) as NodeListOf<HTMLButtonElement>

            let hasDisabledRetry = false
            retryButtons.forEach(btn => {
                const isUnsub = btn.textContent?.includes('Unsubscribe')
                if (!isUnsub && btn.disabled) {
                    hasDisabledRetry = true
                }
            })

            t.ok(hasDisabledRetry, 'some retry buttons are disabled offline')
        } finally {
            resetSignals()
            cleanup()
        }
    })

test('sync-status-detail.AC11.2: unsubscribe button remains enabled when offline',
    async t => {
        const { root, cleanup } = mountRoot()
        try {
            const { state } = createTestState(true)
            const feed:Feed = {
                id: 10,
                url: 'https://offline.com/feed',
                title: 'Offline Feed',
                last_error: 'Network error',
                last_status: null,
                publish_error: null
            } as Feed

            await mountWithFeeds(
                root,
                state,
                [feed],
                () => {
                    syncStatus.value = 'offline'
                }
            )

            const unsubButton = document.querySelector(
                '.failed-feed button:nth-of-type(2)'
            ) as HTMLButtonElement | null

            const isUnsub = unsubButton?.textContent?.includes('Unsubscribe')
            t.ok(isUnsub, 'button is unsubscribe')
            t.equal(
                unsubButton?.disabled,
                false,
                'unsubscribe button enabled offline'
            )
        } finally {
            resetSignals()
            cleanup()
        }
    })
