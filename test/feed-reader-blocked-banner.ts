/**
 * Route render test for FeedReader with blocked banner integration.
 *
 * Tests the conditional branches for rendering the blocked-banner
 * above the items-list and suppressing the empty-state when present.
 * Verifies AC3.4, AC4.1 (integrated), and clean-feed rendering.
 */
import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedReader } from '../src/client/routes/feed-reader.js'
import {
    type AppState,
    type Feed,
    type Item,
    paintCacheHydratedOnBootstrap,
    State,
} from '../src/client/state.js'
import { type DeadLetterRow } from '../src/client/db/push-sync.js'
import {
    bootstrapInProgress,
} from '../src/client/db/bootstrap.js'

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

function deadLetter (
    id:number,
    overrides:Partial<DeadLetterRow> = {}
):DeadLetterRow {
    return {
        id,
        op: 'add_feed',
        target_id: 1,
        payload: '{}',
        client_op_id: `op-${id}`,
        client_updated_at: '2026-06-10 00:00:00',
        attempts: 1,
        last_error: 'Test error',
        ...overrides
    }
}

interface FakeStateInput {
    feeds:Feed[]
    items:Item[]
    blockedByFeed:Record<number, DeadLetterRow[]>
}

function makeState (input:FakeStateInput):AppState {
    const calls:{ name:string; args:unknown[] }[] = []

    return {
        feeds: signal(input.feeds),
        items: signal(input.items),
        itemsLoading: signal(false),
        itemsOffset: signal(0),
        itemsTotal: signal(0),
        feedsLoading: signal(false),
        feedsError: signal(null),
        feedPublishInProgress: signal({}),
        feedPublishErrors: signal({}),
        route: signal('/'),
        _setRoute: () => {},
        user: signal(null),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        counts: signal({
            unread: 0,
            starred: 0,
            total: 0,
            perFeed: {}
        }),
        pageSize: signal(10),
        selectedFeedId: signal(null),
        feedUpdateCounts: signal({}),
        viewItemsCache: new Map(),
        blockedOpsForFeed: (id:number) =>
            input.blockedByFeed[id] ?? [],
        retryDeadLetter: (...a:unknown[]) => {
            calls.push({ name: 'retryDeadLetter', args: a })
        },
        discardDeadLetter: (...a:unknown[]) => {
            calls.push({ name: 'discardDeadLetter', args: a })
        },
        discardBlockedFeedAdd: (...a:unknown[]) => {
            calls.push({ name: 'discardBlockedFeedAdd', args: a })
        },
        retryResolveFeed: (...a:unknown[]) => {
            calls.push({ name: 'retryResolveFeed', args: a })
        },
    } as unknown as AppState
}

function mount (state:AppState, splats:string[]):HTMLElement {
    // Ensure bootstrap signals are off so empty state renders
    bootstrapInProgress.value = false
    paintCacheHydratedOnBootstrap.value = true

    const root = document.createElement('div')
    document.body.appendChild(root)
    render(
        html`<${FeedReader} state=${state} splats=${splats} />`,
        root
    )
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

// Save original State.loadItems before tests
const originalLoadItems = State.loadItems

test('AC3.4: blocked feed renders banner and hides empty state',
    async t => {
        // Stub State.loadItems to prevent flaky async state updates
        State.loadItems = async () => {}

        try {
            const f1 = feed(1)
            const blockedOp = deadLetter(100, {
                target_id: 1,
                op: 'add_feed'
            })

            const state = makeState({
                feeds: [f1],
                items: [],
                blockedByFeed: {
                    1: [blockedOp]
                }
            })

            const root = mount(state, ['example.com/feed-1.xml'])

            try {
                await nextTick()

                const banner = root.querySelector(
                    '.feed-blocked-banner'
                )
                const emptyState = root.querySelector(
                    '.empty-state'
                )
                const itemsList = root.querySelector(
                    '.items-list'
                )

                t.ok(banner, 'blocked banner renders')
                t.equal(emptyState, null,
                    'empty state is null when banner present')
                t.ok(itemsList, 'items-list element exists')

                // Verify banner is above items-list by checking
                // they are siblings and banner comes first
                if (banner && itemsList) {
                    const bannerParent = banner.parentElement
                    const itemsParent = itemsList.parentElement
                    t.equal(bannerParent, itemsParent,
                        'banner and items-list share parent')
                    // Check banner comes before items-list
                    const bannerIndex = Array.from(
                        bannerParent?.children ?? []
                    ).indexOf(banner)
                    const listIndex = Array.from(
                        itemsParent?.children ?? []
                    ).indexOf(itemsList)
                    t.ok(
                        bannerIndex < listIndex,
                        'banner renders before items-list'
                    )
                }
            } finally {
                unmount(root)
            }
        } finally {
            State.loadItems = originalLoadItems
        }
    }
)

test('AC4.1 (integrated): failed-fetch feed renders Retry-only banner',
    async t => {
        // Stub State.loadItems to prevent flaky async state updates
        State.loadItems = async () => {}

        try {
            const f1 = feed(1, {
                last_fetched: null,
                last_error: 'Connection timeout'
            })

            const state = makeState({
                feeds: [f1],
                items: [],
                blockedByFeed: {}
            })

            const root = mount(state, ['example.com/feed-1.xml'])

            try {
                await nextTick()

                const banner = root.querySelector(
                    '.feed-blocked-banner'
                )
                const retryBtn = root.querySelector(
                    '.feed-blocked-retry'
                )
                const discardBtn = root.querySelector(
                    '.feed-blocked-discard'
                )

                t.ok(banner, 'failed-fetch banner renders')
                t.ok(retryBtn, 'retry button present')
                t.equal(discardBtn, null,
                    'no discard button in failed-fetch case')
            } finally {
                unmount(root)
            }
        } finally {
            State.loadItems = originalLoadItems
        }
    }
)

test('clean feed (no blocked, resolved): no banner, normal empty state',
    async t => {
        // Stub State.loadItems to prevent flaky async state updates
        State.loadItems = async () => {}

        try {
            const f1 = feed(1, {
                last_fetched: '2026-06-10 00:00:00',
                last_error: null
            })

            const state = makeState({
                feeds: [f1],
                items: [],
                blockedByFeed: {}
            })

            const root = mount(state, ['example.com/feed-1.xml'])

            try {
                await nextTick()

                const banner = root.querySelector(
                    '.feed-blocked-banner'
                )
                const emptyState = root.querySelector(
                    '.empty-state'
                )

                t.equal(banner, null,
                    'no banner for clean feed')
                t.ok(emptyState,
                    'empty state renders for clean feed')
            } finally {
                unmount(root)
            }
        } finally {
            State.loadItems = originalLoadItems
        }
    }
)
