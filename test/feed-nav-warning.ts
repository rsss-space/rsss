import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedNav } from '../src/client/components/feed-nav.js'
import {
    type AppState,
    type Feed,
    type DeadLetterRow
} from '../src/client/state.js'

function feed (
    id:number,
    overrides:Partial<Feed> = {}
):Feed {
    return {
        id,
        url: `https://example.com/feed-${id}.xml`,
        title: `Feed ${id}`,
        description: null,
        site_url: null,
        last_fetched: '2026-06-10 00:00:00',
        last_error: null,
        last_status: 200,
        published: 0,
        published_rkey: null,
        published_at: null,
        publish_error: null,
        created_at: '2026-06-10 00:00:00',
        updated_at: '2026-06-10 00:00:00',
        ...overrides
    }
}

function makeState (
    feeds:Feed[],
    blockedByFeed:Record<number, DeadLetterRow[]> = {}
):AppState {
    return {
        feeds: signal(feeds),
        feedsLoading: signal(false),
        feedsError: signal(null),
        feedPublishInProgress: signal({}),
        feedPublishErrors: signal({}),
        route: signal('/'),
        user: signal(null),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        counts: signal({
            unread: 3,
            starred: 0,
            total: 3,
            perFeed: { 1: 3 }
        }),
        feedUpdateCounts: signal({}),
        blockedOpsForFeed: (id:number) => blockedByFeed[id] ?? [],
        _setRoute: () => {}
    } as unknown as AppState
}

function mount (state:AppState):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(html`<${FeedNav} state=${state} />`, root)
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

test(
    'feed with blocked ops renders warning dot (AC1.1)',
    async t => {
        const blockedOp:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 1,
            last_error: null,
            attempts: 0,
            created_at: '2026-06-10 00:00:00'
        } as DeadLetterRow

        const state = makeState(
            [feed(1)],
            { 1: [blockedOp] }
        )
        const root = mount(state)

        try {
            await nextTick()
            const warningDot = root.querySelector('.feed-warning-dot')
            const spinner = root.querySelector('.feed-spinner')

            t.ok(warningDot, 'feed-warning-dot rendered')
            t.equal(spinner, null, 'feed-spinner not rendered')
        } finally {
            unmount(root)
        }
    }
)

test(
    'failed feed renders warning dot and keeps label+retry (AC1.2)',
    async t => {
        const state = makeState(
            [feed(1, {
                last_fetched: null,
                last_error: 'Connection timeout'
            })]
        )
        const root = mount(state)

        try {
            await nextTick()
            const warningDot = root.querySelector('.feed-warning-dot')
            const failedLabel = root.querySelector(
                '.feed-failed-label'
            )
            const retryBtn = root.querySelector('.btn-retry')

            t.ok(warningDot, 'feed-warning-dot rendered')
            t.ok(failedLabel, 'feed-failed-label still rendered')
            t.ok(retryBtn, 'retry button still rendered')
        } finally {
            unmount(root)
        }
    }
)

test(
    'resolving feed renders spinner, not warning dot (AC1.3)',
    async t => {
        const state = makeState(
            [feed(1, {
                last_fetched: null,
                last_error: null
            })]
        )
        const root = mount(state)

        try {
            await nextTick()
            const spinner = root.querySelector('.feed-spinner')
            const warningDot = root.querySelector(
                '.feed-warning-dot'
            )

            t.ok(spinner, 'feed-spinner rendered')
            t.equal(warningDot, null, 'feed-warning-dot not rendered')
        } finally {
            unmount(root)
        }
    }
)

test(
    'clean feed renders neither spinner nor warning dot (clean)',
    async t => {
        const state = makeState(
            [feed(1, {
                last_fetched: '2026-06-10 00:00:00',
                last_error: null
            })]
        )
        const root = mount(state)

        try {
            await nextTick()
            const spinner = root.querySelector('.feed-spinner')
            const warningDot = root.querySelector(
                '.feed-warning-dot'
            )

            t.equal(
                spinner,
                null,
                'feed-spinner not rendered'
            )
            t.equal(
                warningDot,
                null,
                'feed-warning-dot not rendered'
            )
        } finally {
            unmount(root)
        }
    }
)

test(
    'warning dot has img role, aria-label, visually-hidden child (AC1.6)',
    async t => {
        const blockedOp:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 1,
            last_error: null,
            attempts: 0,
            created_at: '2026-06-10 00:00:00'
        } as DeadLetterRow

        const state = makeState(
            [feed(1)],
            { 1: [blockedOp] }
        )
        const root = mount(state)

        try {
            await nextTick()
            const warningDot = root.querySelector(
                '.feed-warning-dot'
            )

            t.ok(warningDot, 'feed-warning-dot exists')
            t.equal(
                warningDot?.getAttribute('role'),
                'img',
                'has role="img"'
            )
            t.ok(
                warningDot?.getAttribute('aria-label'),
                'has non-empty aria-label'
            )
            t.equal(
                warningDot?.getAttribute('role'),
                'img',
                'role is img not status'
            )

            const visuallyHidden = warningDot?.querySelector(
                '.visually-hidden'
            )
            t.ok(
                visuallyHidden,
                'contains .visually-hidden child'
            )

            const tabIndex = (warningDot as HTMLElement)?.tabIndex
            t.equal(
                tabIndex,
                -1,
                'not focusable (tabIndex -1)'
            )
        } finally {
            unmount(root)
        }
    }
)

test(
    'warning dot aria-label changes for failed vs blocked (AC1.6)',
    async t => {
        // Test failed feed aria-label
        const state = makeState(
            [feed(1, {
                last_fetched: null,
                last_error: 'Connection timeout'
            })]
        )
        const root = mount(state)

        try {
            await nextTick()
            const warningDot = root.querySelector(
                '.feed-warning-dot'
            )

            const label = warningDot?.getAttribute('aria-label')
            t.ok(
                label?.includes('Failed'),
                `failed feed has "Failed" in label: ${label}`
            )
        } finally {
            unmount(root)
        }

        // Test blocked feed aria-label
        const blockedOp:DeadLetterRow = {
            id: 1,
            op: 'add_feed',
            target_id: 2,
            last_error: null,
            attempts: 0,
            created_at: '2026-06-10 00:00:00'
        } as DeadLetterRow

        const state2 = makeState(
            [feed(2)],
            { 2: [blockedOp] }
        )
        const root2 = mount(state2)

        try {
            await nextTick()
            const warningDot = root2.querySelector(
                '.feed-warning-dot'
            )

            const label = warningDot?.getAttribute('aria-label')
            t.ok(
                label?.includes('Blocked'),
                `blocked feed has "Blocked" in label: ${label}`
            )
        } finally {
            unmount(root2)
        }
    }
)
