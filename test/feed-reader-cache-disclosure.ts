import { test } from '@substrate-system/tapzero'
import {
    type ReadonlySignal,
    signal,
    computed,
    batch
} from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import '@substrate-system/details-summary'
import { FeedReader } from '../src/client/routes/feed-reader.js'
import { type AppState, State } from '../src/client/state.js'
import {
    feedPolicies,
    _resetFeedPolicies,
    resolveEffectivePolicy
} from '../src/client/db/feed-cache-policy.js'
import {
    defaultCacheMode,
    defaultMaxSizeBytes,
    defaultMaxAgeSeconds,
    storeContent,
    syncSubscriptions,
    pendingSyncSubscriptions
} from '../src/client/local-first-settings.js'
import {
    billingStatus
} from '../src/client/billing-status.js'
import {
    localFirstSupported,
    bootstrapInProgress,
    bootstrapError
} from '../src/client/db/index.js'
import { isLocalFirstActive } from '../src/client/db/sync-status.js'
import type {
    CountsResponse,
    Feed,
    Item
} from '../src/client/db/types.js'

const noopLoadItems = async () => {}
const originalLoadItems = State.loadItems
const originalMarkAllRead = State.markAllRead

function waitFor (
    condition:()=> boolean,
    desc:string,
    timeoutMs = 5000
):Promise<void> {
    const startTime = Date.now()
    return new Promise((resolve, reject) => {
        const check = () => {
            if (condition()) {
                resolve()
                return
            }
            if (Date.now() - startTime > timeoutMs) {
                reject(
                    new Error(
                        `waitFor timeout: ${desc} ` +
                        `(${timeoutMs}ms exceeded)`
                    )
                )
                return
            }
            setTimeout(check, 10)
        }
        check()
    })
}

function makeFeed (overrides:Partial<Feed> = {}):Feed {
    return {
        id: 1,
        url: 'https://example.com/feed.rss',
        title: 'Example Feed',
        description: null,
        site_url: null,
        last_fetched: null,
        last_error: null,
        last_status: null,
        created_at: '2026-01-01',
        updated_at: '2026-01-01',
        ...overrides
    }
}

function makeState ():AppState {
    const state = {
        _setRoute: (_r:string) => {},
        route: signal('/'),
        routeItem: signal<Item|null>(null),
        routeItemLoading: signal(false),
        user: signal(null),
        authLoading: signal(false),
        authError: signal<string|null>(null),
        feeds: signal<Feed[]>([]),
        feedsLoading: signal(false),
        feedsError: signal<string|null>(null),
        feedSyncStatus: signal<
            'inactive'|'updates'|'syncing'|'error'|'synced'
        >('inactive'),
        feedSyncError: signal<string|null>(null),
        feedUpdateCounts: signal<Record<string, number>>({}),
        items: signal<Item[]>([]),
        itemsLoading: signal(false),
        itemsTotal: signal(0),
        itemsOffset: signal(0),
        counts: signal<CountsResponse>(
            { unread: 0, starred: 0, total: 0, perFeed: {} }
        ),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        pageSize: signal(20),
        selectedFeedId: signal<number|null>(null),
        cleanup: () => {}
    } as unknown as AppState
    ;(state as unknown as {
        feedUpdateStatus:ReadonlySignal<'synced'|'updates'>
    }).feedUpdateStatus = computed(() => 'synced')
    ;(state as unknown as {
        feedsWithUpdates:ReadonlySignal<string[]>
    }).feedsWithUpdates = computed(() => [])
    ;(state as unknown as {
        isAuthenticated:ReadonlySignal<boolean>
    }).isAuthenticated = computed(() => false)
    return state
}

function mount (
    state:AppState,
    splats:string[]
):HTMLElement {
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

test('feed-reader cache disclosure: <details-summary> wrapper shape',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        defaultCacheMode.value = 'text_images'
        defaultMaxSizeBytes.value = 50_000_000
        defaultMaxAgeSeconds.value = 30 * 86400

        const state = makeState()
        const feed = makeFeed({
            id: 1,
            url: 'https://example.com/feed.rss',
            title: 'Example'
        })
        state.feeds.value = [feed]
        const splats = ['example.com', 'feed.rss']

        const root = mount(state, splats)
        try {
            await nextTick()
            const wrapper = root.querySelector(
                '.feed-cache-controls'
            )
            t.ok(wrapper, '.feed-cache-controls element exists')
            t.equal(
                wrapper?.tagName.toLowerCase(),
                'details-summary',
                'host element is <details-summary>'
            )

            const innerDetails = wrapper?.querySelectorAll(':scope > details')
            t.equal(
                innerDetails?.length,
                1,
                'exactly one direct-child <details>'
            )

            const details = innerDetails?.[0] as HTMLDetailsElement|undefined
            const summaries = details?.querySelectorAll(':scope > summary')
            t.equal(
                summaries?.length,
                1,
                'exactly one direct-child <summary> inside <details>'
            )
            const summary = summaries?.[0] as HTMLElement|undefined
            t.ok(summary, 'summary element exists')

            const contents = details?.querySelectorAll(
                ':scope > .details-content'
            )
            t.equal(
                contents?.length,
                1,
                'exactly one direct-child .details-content inside <details>'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('feed-reader cache disclosure: inner controls present',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        defaultCacheMode.value = 'text_images'
        defaultMaxSizeBytes.value = 50_000_000
        defaultMaxAgeSeconds.value = 30 * 86400

        const state = makeState()
        const feed = makeFeed({
            id: 42,
            url: 'https://controls.example.com/feed.rss',
            title: 'Controls'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['controls.example.com', 'feed.rss'])
        try {
            await nextTick()
            const content = root.querySelector(
                '.feed-cache-controls .details-content'
            )
            t.ok(content, '.details-content present')

            const selects = content?.querySelectorAll(
                'select[name^="feed-cache-mode-"]'
            )
            t.equal(
                selects?.length,
                1,
                'one cache-mode <select> in .details-content'
            )

            const sizes = content?.querySelectorAll(
                'input[type="number"][name^="feed-max-size-"]'
            )
            t.equal(
                sizes?.length,
                1,
                'one max-size <input type="number"> in .details-content'
            )

            const ages = content?.querySelectorAll(
                'input[type="number"][name^="feed-max-age-"]'
            )
            t.equal(
                ages?.length,
                1,
                'one max-age <input type="number"> in .details-content'
            )

            const clears = content?.querySelectorAll(
                'button.btn-clear-cache'
            )
            t.equal(
                clears?.length,
                1,
                'one .btn-clear-cache button in .details-content'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('feed-reader cache disclosure: no carry-over on feed switch',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()

        const state = makeState()
        const feedA = makeFeed({
            id: 10,
            url: 'https://a.example.com/feed.rss',
            title: 'A'
        })
        const feedB = makeFeed({
            id: 20,
            url: 'https://b.example.com/feed.rss',
            title: 'B'
        })
        state.feeds.value = [feedA, feedB]

        const rootA = mount(state, ['a.example.com', 'feed.rss'])
        try {
            await nextTick()
            const detailsA = rootA.querySelector(
                '.feed-cache-controls details'
            ) as HTMLDetailsElement|null
            t.ok(detailsA, 'feed A renders a <details>')
            if (detailsA) detailsA.open = true
            unmount(rootA)

            const rootB = mount(state, ['b.example.com', 'feed.rss'])
            try {
                await nextTick()
                const detailsB = rootB.querySelector(
                    '.feed-cache-controls details'
                ) as HTMLDetailsElement|null
                t.ok(detailsB, 'feed B renders a <details>')
                t.equal(
                    detailsB?.hasAttribute('open'),
                    false,
                    'feed B <details> has no open attribute'
                )
            } finally {
                unmount(rootB)
            }
        } finally {
            _resetFeedPolicies()
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC1.2 + AC1.1: summary is invariant across cache_mode changes',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        defaultCacheMode.value = 'text_images'

        const state = makeState()
        const feed = makeFeed({
            id: 100,
            url: 'https://summary-inv.example.com/feed.rss',
            title: 'Summary Invariance'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['summary-inv.example.com', 'feed.rss'])
        try {
            await nextTick()

            const getSummaryText = ():string => {
                const summary = root.querySelector(
                    '.feed-cache-controls summary'
                )
                return summary?.textContent?.trim() || ''
            }

            // Capture initial summary (no override)
            const initial = getSummaryText()
            t.ok(initial, 'summary has text initially')

            // Set cache_mode to 'text'
            feedPolicies.value = {
                100: {
                    feed_id: 100,
                    cache_mode: 'text',
                    max_size_bytes: null,
                    max_age_seconds: null,
                    content_enabled: null
                }
            }
            await nextTick()
            const withText = getSummaryText()
            t.equal(
                withText,
                initial,
                'summary unchanged when cache_mode becomes text'
            )

            // Set cache_mode to 'text_images'
            feedPolicies.value = {
                100: {
                    feed_id: 100,
                    cache_mode: 'text_images',
                    max_size_bytes: null,
                    max_age_seconds: null,
                    content_enabled: null
                }
            }
            await nextTick()
            const withImages = getSummaryText()
            t.equal(
                withImages,
                initial,
                'summary unchanged when cache_mode becomes text_images'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC3.1: fieldset enabled when effectiveContent is true',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 101,
            url: 'https://en.example.com/feed.rss',
            title: 'Enabled'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['en.example.com', 'feed.rss'])
        try {
            await nextTick()

            const fieldset = root.querySelector(
                'fieldset[id^="feed-cache-fields-"]'
            ) as HTMLFieldSetElement|null
            t.ok(fieldset, 'fieldset exists')
            t.equal(
                fieldset?.disabled,
                false,
                'fieldset is enabled when storeContent=true'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC4.3: fieldset disabled when effectiveContent is false',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = false
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 102,
            url: 'https://dis.example.com/feed.rss',
            title: 'Disabled'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['dis.example.com', 'feed.rss'])
        try {
            await nextTick()

            const fieldset = root.querySelector(
                'fieldset[id^="feed-cache-fields-"]'
            ) as HTMLFieldSetElement|null
            t.ok(fieldset, 'fieldset exists')
            t.equal(
                fieldset?.disabled,
                true,
                'fieldset is disabled when storeContent=false'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC3.2: default cache mode resolves to text_images',
    (t) => {
        _resetFeedPolicies()
        defaultCacheMode.value = 'text_images'

        const policy = feedPolicies.value[999] ?? null
        const eff = resolveEffectivePolicy(policy)
        t.equal(
            eff.cacheMode,
            'text_images',
            'resolveEffectivePolicy returns text_images for null row'
        )
    }
)

test('AC6.1: checkbox disabled when unentitled',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: false,
                planId: 'local-first',
                status: 'none',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 103,
            url: 'https://unent.example.com/feed.rss',
            title: 'Unentitled'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['unent.example.com', 'feed.rss'])
        try {
            await nextTick()

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLElement&{ disabled:boolean }|null
            t.ok(checkbox, 'checkbox exists')
            t.equal(
                checkbox?.disabled,
                true,
                'checkbox is disabled when unentitled'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC6.2: plan hint associated when unentitled',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: false,
                planId: 'local-first',
                status: 'none',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 104,
            url: 'https://hint.example.com/feed.rss',
            title: 'Hint'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['hint.example.com', 'feed.rss'])
        try {
            await nextTick()

            const planHintId = `feed-cache-plan-hint-${feed.id}`
            const hintEl = root.querySelector(
                `#${planHintId}`
            )
            t.ok(
                hintEl,
                'plan hint element exists with correct id'
            )

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLElement&{ getAttribute:(s:string)=>string|null }|null
            const describedBy = checkbox?.getAttribute('aria-describedby')
            t.equal(
                describedBy,
                planHintId,
                'checkbox aria-describedby references the hint'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC6.3: checkbox interactive when entitled + storage off',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = false
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 105,
            url: 'https://inter.example.com/feed.rss',
            title: 'Interactive'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['inter.example.com', 'feed.rss'])
        try {
            await nextTick()

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLElement&{ disabled:boolean }|null
            t.ok(checkbox, 'checkbox exists')
            t.equal(
                checkbox?.disabled,
                false,
                'checkbox not disabled when entitled + storage off'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC9.1: toggle to global clears override',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
            isLocalFirstActive.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 106,
            url: 'https://clear.example.com/feed.rss',
            title: 'Clear'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['clear.example.com', 'feed.rss'])
        try {
            await nextTick()

            // Toggle to false (different from global true)
            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLInputElement|null
            t.ok(checkbox, 'checkbox exists')

            // First toggle: checked false (write override 0)
            if (checkbox) {
                checkbox.checked = false
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                0,
                'toggle to false writes content_enabled = 0'
            )

            // Second toggle: checked true (equals global, clears)
            if (checkbox) {
                checkbox.checked = true
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                null,
                'toggle to true clears override'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
                isLocalFirstActive.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC9.1: toggle with storeContent=false clears override',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = false
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
            isLocalFirstActive.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 107,
            url: 'https://clear2.example.com/feed.rss',
            title: 'Clear2'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['clear2.example.com', 'feed.rss'])
        try {
            await nextTick()

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLInputElement|null
            t.ok(checkbox, 'checkbox exists')

            // First toggle: checked true (write override 1)
            if (checkbox) {
                checkbox.checked = true
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                1,
                'toggle to true writes content_enabled = 1'
            )

            // Second toggle: checked false (equals global, clears)
            if (checkbox) {
                checkbox.checked = false
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                null,
                'toggle to true clears override'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
                isLocalFirstActive.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC9.2: toggle opposite global writes explicit override',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = false
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
            isLocalFirstActive.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 108,
            url: 'https://explicit.example.com/feed.rss',
            title: 'Explicit'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['explicit.example.com', 'feed.rss'])
        try {
            await nextTick()

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLInputElement|null
            t.ok(checkbox, 'checkbox exists')

            // Toggle to true (opposite global false) -> write 1
            if (checkbox) {
                checkbox.checked = true
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                1,
                'toggle to true writes 1 when storeContent=false'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
                isLocalFirstActive.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC9.2: toggle opposite global with storeContent=true',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 109,
            url: 'https://explicit2.example.com/feed.rss',
            title: 'Explicit2'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['explicit2.example.com', 'feed.rss'])
        try {
            await nextTick()

            const checkbox = root.querySelector(
                `check-box[name="feed-cache-content-${feed.id}"]`
            ) as HTMLInputElement|null
            t.ok(checkbox, 'checkbox exists')

            // Toggle to false (opposite global true) -> write 0
            if (checkbox) {
                checkbox.checked = false
                checkbox.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[feed.id]?.content_enabled,
                0,
                'toggle to false writes 0 when storeContent=true'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test('AC3.3: changing cache_mode preserves content_enabled override',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()
        batch(() => {
            defaultCacheMode.value = 'text_images'
            storeContent.value = true
            billingStatus.value = {
                entitled: true,
                planId: 'local-first',
                status: 'active',
                refreshedAt: Date.now(),
                useLive: false
            }
            localFirstSupported.value = true
        })

        const state = makeState()
        const feed = makeFeed({
            id: 110,
            url: 'https://persist.example.com/feed.rss',
            title: 'Persist'
        })
        state.feeds.value = [feed]

        const root = mount(state, ['persist.example.com', 'feed.rss'])
        try {
            await nextTick()

            // Set up a content_enabled override
            feedPolicies.value = {
                110: {
                    feed_id: 110,
                    cache_mode: null,
                    max_size_bytes: null,
                    max_age_seconds: null,
                    content_enabled: 0
                }
            }
            await nextTick()

            t.equal(
                feedPolicies.value[110]?.content_enabled,
                0,
                'initial state has content_enabled = 0'
            )

            // Change cache_mode via the select
            const select = root.querySelector(
                `select[name="feed-cache-mode-${feed.id}"]`
            ) as HTMLSelectElement|null
            t.ok(select, 'cache mode select exists')

            if (select) {
                select.value = 'text'
                select.dispatchEvent(new Event('change'))
            }
            await nextTick()

            t.equal(
                feedPolicies.value[110]?.cache_mode,
                'text',
                'cache_mode changed to text'
            )
            t.equal(
                feedPolicies.value[110]?.content_enabled,
                0,
                'content_enabled override persists after mode change'
            )
        } finally {
            unmount(root)
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
        }
    }
)

test(
    'AC5.1 + AC5.5/AC8.2: enable-while-off optimistic, setSyncSubscriptions,' +
    ' no global flip, bootstrap resolves',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()

        const originalFetch = globalThis.fetch

        try {
            // Stub fetch to resolve with a non-ok response
            // (so bootstrapLocalDb fails without producing a DB)
            ;(globalThis as unknown as { fetch?:typeof fetch }).fetch =
                (async () => {
                    return new Response(JSON.stringify({
                        error: 'simulated bootstrap failure'
                    }), {
                        status: 500,
                        headers: { 'content-type': 'application/json' }
                    })
                }) as typeof fetch

            const state = makeState()
            const feed = makeFeed({
                id: 200,
                url: 'https://enable-off.example.com/feed.rss',
                title: 'Enable Off'
            })
            state.feeds.value = [feed]
            // CRITICAL #2: set state.user so enableWithBootstrap proceeds
            state.user.value = {
                did: 'did:example:test-ac5-1',
                handle: 'test-ac5-1'
            }

            batch(() => {
                defaultCacheMode.value = 'text_images'
                storeContent.value = false
                billingStatus.value = {
                    entitled: true,
                    planId: 'local-first',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                localFirstSupported.value = true
            })

            const root = mount(state, [
                'enable-off.example.com',
                'feed.rss'
            ])
            try {
                await nextTick()

                // Dispatch checkbox change with checked=true
                const checkbox = root.querySelector(
                    `check-box[name="feed-cache-content-${feed.id}"]`
                ) as HTMLInputElement|null
                t.ok(checkbox, 'checkbox exists')

                if (checkbox) {
                    // Capture the bootstrap promise by hooking into
                    // the component's async flow
                    checkbox.checked = true
                    // Dispatch the change event - this triggers
                    // handleContentToggle which calls void
                    // enableWithBootstrap()
                    checkbox.dispatchEvent(new Event('change'))
                }

                // Synchronously assert optimistic state
                // (these are set before the first await in
                // enableWithBootstrap)
                t.equal(
                    storeContent.value,
                    false,
                    'AC5.5/AC8.2: storeContent not flipped to true'
                )

                t.equal(
                    feedPolicies.value[feed.id]?.content_enabled,
                    1,
                    'optimistic in-memory write: content_enabled = 1'
                )

                t.equal(
                    syncSubscriptions.value,
                    true,
                    'AC5.1: setSyncSubscriptions(true) was called'
                )

                // Wait for bootstrap to settle using a polling timeout
                // The bootstrap promise is called with void, so we wait
                // for the effect to complete (bootstrapInProgress goes
                // false or other signals indicate completion)
                await waitFor(
                    () =>
                        bootstrapInProgress.value === false,
                    'bootstrap in progress resolved',
                    10000
                )
            } finally {
                unmount(root)
            }
        } finally {
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                syncSubscriptions.value = false
                pendingSyncSubscriptions.value = false
                bootstrapInProgress.value = false
                bootstrapError.value = null
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
            if (originalFetch === undefined) {
                delete (globalThis as { fetch?:unknown }).fetch
            } else {
                globalThis.fetch = originalFetch
            }
        }
    }
)

test(
    'AC5.4: enable-while-off revert on bootstrap failure',
    async (t) => {
        State.loadItems = noopLoadItems as typeof State.loadItems
        State.markAllRead = (async () => {}) as typeof State.markAllRead
        _resetFeedPolicies()

        const originalFetch = globalThis.fetch

        try {
            // Stub fetch to return non-ok response
            ;(globalThis as unknown as { fetch?:typeof fetch }).fetch =
                (async (_url:string|URL|Request) => new Response(
                    JSON.stringify({ error: 'server error' }),
                    {
                        status: 500,
                        headers: {
                            'content-type': 'application/json'
                        }
                    }
                )) as typeof fetch

            const state = makeState()
            const feed = makeFeed({
                id: 201,
                url: 'https://fail.example.com/feed.rss',
                title: 'Fail'
            })
            state.feeds.value = [feed]
            // CRITICAL #2: set state.user so enableWithBootstrap proceeds
            state.user.value = {
                did: 'did:example:test-ac5-4',
                handle: 'test-ac5-4'
            }

            batch(() => {
                defaultCacheMode.value = 'text_images'
                storeContent.value = false
                billingStatus.value = {
                    entitled: true,
                    planId: 'local-first',
                    status: 'active',
                    refreshedAt: Date.now(),
                    useLive: false
                }
                localFirstSupported.value = true
            })

            const root = mount(state, ['fail.example.com', 'feed.rss'])
            try {
                await nextTick()

                // Dispatch checkbox change with checked=true
                const checkbox = root.querySelector(
                    `check-box[name="feed-cache-content-${feed.id}"]`
                ) as HTMLInputElement|null
                t.ok(checkbox, 'checkbox exists')

                if (checkbox) {
                    checkbox.checked = true
                    checkbox.dispatchEvent(new Event('change'))
                }

                await nextTick()

                // MINOR #2: Replace unbounded setTimeout poll with
                // bounded waitFor. Wait for bootstrap to settle and
                // revert to happen.
                await waitFor(
                    () =>
                        feedPolicies.value[feed.id]
                            ?.content_enabled === null,
                    'content_enabled reverted to null after failure',
                    5000
                )

                // AC5.4: verify revert happened
                t.equal(
                    feedPolicies.value[feed.id]?.content_enabled,
                    null,
                    'reverted to null (prior value)'
                )
                t.equal(
                    storeContent.value,
                    false,
                    'storeContent still false'
                )
            } finally {
                unmount(root)
            }
        } finally {
            _resetFeedPolicies()
            batch(() => {
                storeContent.value = false
                syncSubscriptions.value = false
                pendingSyncSubscriptions.value = false
                bootstrapInProgress.value = false
                bootstrapError.value = null
                billingStatus.value = null
                localFirstSupported.value = false
            })
            State.loadItems = originalLoadItems
            State.markAllRead = originalMarkAllRead
            if (originalFetch === undefined) {
                delete (globalThis as { fetch?:unknown }).fetch
            } else {
                globalThis.fetch = originalFetch
            }
        }
    }
)
