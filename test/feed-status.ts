import { signal, computed } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedStatus, legendFor } from '../src/client/components/feed-status.js'
import { type AppState } from '../src/client/state.js'

type FeedSyncStatus = 'inactive'|'updates'|'syncing'|'error'|'synced'

function feedStatusState (options:{
    feedSyncStatus?:FeedSyncStatus
    feedUpdateCounts?:Record<string, number>
    feedSyncError?:string|null
    refreshInProgress?:boolean
} = {}):AppState {
    const feedSyncStatus = signal<FeedSyncStatus>(
        options.feedSyncStatus ?? 'inactive'
    )
    const refreshInProgress = signal<boolean>(
        options.refreshInProgress ?? false
    )
    const displayedFeedSyncStatus = computed<FeedSyncStatus>(() => (
        refreshInProgress.value ?
            'syncing' :
            feedSyncStatus.value
    ))
    return {
        user: signal({ did: 'did:plc:test', handle: 'test.bsky.social' }),
        feedSyncStatus,
        refreshInProgress,
        displayedFeedSyncStatus,
        feedUpdateCounts: signal<Record<string, number>>(
            options.feedUpdateCounts ?? {}
        ),
        feedSyncError: signal<string|null>(
            options.feedSyncError ?? null
        )
    } as unknown as AppState
}

function renderFeedStatus (state:AppState):{
    root:HTMLElement
    cleanup:() => void
} {
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)
    render(html`<${FeedStatus} state=${state} />`, root)
    return {
        root,
        cleanup () {
            render(null, root)
            root.remove()
        }
    }
}

test('legendFor: synced returns "up to date" for both surfaces', t => {
    const result = legendFor('synced', 0)
    t.equal(result.label, 'up to date', 'visible label for synced')
    t.equal(
        result.ariaLabel,
        'Feed sync status: up to date',
        'aria-label for synced'
    )
})

test('legendFor: updates with count === 1 uses singular', t => {
    const result = legendFor('updates', 1)
    t.equal(result.label, '1 update', 'singular visible label')
    t.equal(
        result.ariaLabel,
        'Feed sync status: 1 update',
        'singular aria-label'
    )
})

test('legendFor: updates with count > 1 uses plural', t => {
    const result = legendFor('updates', 3)
    t.equal(result.label, '3 updates', 'plural visible label')
    t.equal(
        result.ariaLabel,
        'Feed sync status: 3 updates',
        'plural aria-label'
    )
})

test('legendFor: syncing returns "updating"', t => {
    const result = legendFor('syncing', 0)
    t.equal(result.label, 'updating', 'visible label for syncing')
    t.equal(
        result.ariaLabel,
        'Feed sync status: updating',
        'aria-label for syncing'
    )
})

test('legendFor: inactive preserves existing presentation', t => {
    const result = legendFor('inactive', 0)
    t.equal(result.label, '', 'no new visible label for inactive')
    t.equal(
        result.ariaLabel,
        'Feed sync status: inactive',
        'aria-label preserves existing inactive wording'
    )
})

test('legendFor: error preserves existing "sync failed" text', t => {
    const result = legendFor('error', 0)
    t.equal(
        result.label,
        'sync failed',
        'preserves existing error visible text'
    )
})

test(
    'FeedStatus renders red sync-failed pill when feedSyncStatus = error',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'error',
            feedSyncError: 'fetch failed'
        }))

        try {
            const dot = root.querySelector('svg.dot')
            t.ok(dot, 'renders the dot indicator')
            t.ok(
                dot?.classList.contains('red'),
                'dot is red on error (page-load failure path FR-012)'
            )

            const wrapper = root.querySelector('.feed-status')
            t.ok(wrapper, 'renders the feed-status wrapper')
            t.equal(
                wrapper?.textContent?.includes('sync failed'),
                true,
                'shows the "sync failed" label so the pill is never silently green'
            )
            t.equal(
                wrapper?.getAttribute('title'),
                'fetch failed',
                'tooltip carries the error message'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus error state links to the /sync-status detail page',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'error',
            feedSyncError: 'fetch failed'
        }))

        try {
            const link = root.querySelector('a')
            t.ok(link, 'error state renders a link')
            t.equal(
                link?.getAttribute('href'),
                '/sync-status',
                'link points at the sync-status detail page'
            )
            // The status pill stays nested inside the link so its
            // existing role/aria/title semantics are preserved.
            t.ok(
                link?.querySelector('.feed-status'),
                'status pill is nested inside the link'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus renders green "up to date" pill when synced and zero pending',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'synced',
            feedUpdateCounts: {}
        }))

        try {
            const dot = root.querySelector('svg.dot')
            t.ok(
                dot?.classList.contains('green'),
                'dot is green when synced'
            )
            t.equal(
                root.textContent?.trim(),
                'up to date',
                'pill reads "up to date" after refresh sequence (US3)'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus renders blue "n updates" pill when totalPending > 0',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'updates',
            feedUpdateCounts: { 1: 2, 2: 3 }
        }))

        try {
            const dot = root.querySelector('svg.dot')
            t.ok(
                dot?.classList.contains('blue'),
                'dot is blue when updates are pending'
            )
            t.ok(
                root.textContent?.includes('5 updates'),
                'pill reads "5 updates" using the summed counts'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus renders yellow "updating" pill when refreshInProgress=true ' +
    'regardless of underlying feedSyncStatus (FR-002 / FR-003)',
    t => {
        // Underlying status is 'updates' with a non-zero count; the
        // displayed pill must still be yellow + 'updating' because
        // refreshInProgress is true.
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'updates',
            feedUpdateCounts: { 1: 4 },
            refreshInProgress: true
        }))

        try {
            const dot = root.querySelector('svg.dot')
            t.ok(
                dot?.classList.contains('yellow'),
                'dot is yellow during manual refresh'
            )
            const wrapper = root.querySelector('.feed-status')
            t.equal(
                wrapper?.getAttribute('aria-label'),
                'Feed sync status: updating',
                'aria-label reads "updating" during manual refresh'
            )
            t.ok(
                root.textContent?.includes('updating'),
                'pill text reads "updating" during manual refresh'
            )
            t.equal(
                root.textContent?.includes('4 updates'),
                false,
                'pill does NOT show the underlying "n updates" text ' +
                'while refreshInProgress is true'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus renders yellow "updating" pill when refreshInProgress=true ' +
    'over a synced underlying status',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'synced',
            refreshInProgress: true
        }))

        try {
            const dot = root.querySelector('svg.dot')
            t.ok(
                dot?.classList.contains('yellow'),
                'dot is yellow during manual refresh over synced'
            )
            t.ok(
                root.textContent?.includes('updating'),
                'pill text reads "updating" during manual refresh ' +
                'over synced'
            )
            t.equal(
                root.textContent?.includes('up to date'),
                false,
                'pill does NOT show "up to date" while ' +
                'refreshInProgress is true'
            )
        } finally {
            cleanup()
        }
    }
)

// US1 - T004: the "fetch updates" button is present only in the
// 'updates' state, for both singular and plural counts, with the exact
// accessible name "fetch updates" (FR-001, FR-004, FR-008).
test(
    'FeedStatus shows the "fetch updates" button with a single update ' +
    'and exposes the exact accessible name (FR-004 / FR-008)',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'updates',
            feedUpdateCounts: { 1: 1 }
        }))

        try {
            const btn = root.querySelector('.fetch-updates-btn')
            t.ok(btn, 'button is present for a single update (FR-004)')
            t.equal(
                btn?.textContent?.trim(),
                'fetch updates',
                'accessible name is exactly "fetch updates" (FR-008)'
            )
        } finally {
            cleanup()
        }
    }
)

test(
    'FeedStatus shows the "fetch updates" button for a multi-feed ' +
    'update count (FR-001)',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'updates',
            feedUpdateCounts: { 1: 2, 2: 3 }
        }))

        try {
            t.ok(
                root.querySelector('.fetch-updates-btn'),
                'button is present for a multi-feed update count'
            )
        } finally {
            cleanup()
        }
    }
)

// US1 - T004: the button is absent for every non-'updates' displayed
// status (FR-002).
test(
    'FeedStatus hides the "fetch updates" button for synced, error, ' +
    'and inactive (FR-002)',
    t => {
        for (const status of ['synced', 'error', 'inactive'] as const) {
            const { root, cleanup } = renderFeedStatus(feedStatusState({
                feedSyncStatus: status
            }))

            try {
                t.equal(
                    root.querySelector('.fetch-updates-btn'),
                    null,
                    `button is absent for ${status}`
                )
            } finally {
                cleanup()
            }
        }
    }
)

test(
    'FeedStatus hides the "fetch updates" button while refreshing, when ' +
    'displayed status resolves to syncing (FR-002)',
    t => {
        const { root, cleanup } = renderFeedStatus(feedStatusState({
            feedSyncStatus: 'updates',
            feedUpdateCounts: { 1: 4 },
            refreshInProgress: true
        }))

        try {
            t.equal(
                root.querySelector('.fetch-updates-btn'),
                null,
                'button is absent once refreshInProgress flips the ' +
                'displayed status to syncing'
            )
        } finally {
            cleanup()
        }
    }
)
