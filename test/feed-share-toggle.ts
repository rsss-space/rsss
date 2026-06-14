import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { SettingsRoute } from '../src/client/routes/settings.js'
import { type AppState, type Feed } from '../src/client/state.js'

type TestCheckBox = HTMLElement & {
    checked:boolean
    disabled:boolean
}

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

function makeState (feeds:Feed[]):AppState {
    return {
        feeds: signal(feeds),
        feedsLoading: signal(false),
        feedsError: signal(null),
        feedPublishInProgress: signal({}),
        feedPublishErrors: signal({}),
        route: signal('/feeds'),
        user: signal(null),
        isAuthenticated: signal(false),
        showUnreadOnly: signal(false),
        showStarredOnly: signal(false),
        counts: signal({
            unread: 0,
            starred: 0,
            total: 0,
            perFeed: {}
        }),
        feedUpdateCounts: signal({}),
        _setRoute: () => {}
    } as unknown as AppState
}

function mount (state:AppState):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(html`<${SettingsRoute} state=${state} />`, root)
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

test('Settings share section position is correct (AC2.1)',
    async t => {
        const state = makeState([feed(1)])
        const root = mount(state)

        try {
            await nextTick()
            const sections = Array.from(
                root.querySelectorAll('.settings-section')
            )
            const shareIndex = sections.findIndex(
                s => s.querySelector('.settings-share-list') != null
            )
            const subscriptionsIndex = sections.findIndex(
                s => s.querySelector('.settings-feeds-list') != null
            )
            const dangerIndex = sections.findIndex(
                s => s.classList.contains('danger-zone')
            )

            t.ok(
                subscriptionsIndex >= 0,
                'subscriptions section exists'
            )
            t.ok(
                shareIndex >= 0,
                'share section exists'
            )
            t.ok(
                dangerIndex >= 0,
                'delete section exists'
            )
            t.ok(
                shareIndex > subscriptionsIndex,
                'share section is after subscriptions'
            )
            t.ok(
                shareIndex < dangerIndex,
                'share section is before delete'
            )
        } finally {
            unmount(root)
        }
    }
)

test('Settings renders per-feed share controls (AC2.2)',
    async t => {
        const state = makeState([
            feed(1),
            feed(2, {
                published: 1,
                published_rkey: 'feed.published',
                published_at: '2026-06-10T20:00:00.000Z'
            })
        ])
        const root = mount(state)

        try {
            await nextTick()
            const shareSection = root.querySelector(
                '.share-section'
            )
            const first = shareSection?.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            const second = shareSection?.querySelector(
                'check-box[name="share-feed-2"]'
            ) as TestCheckBox|null

            t.ok(first, 'first feed has a share toggle')
            t.ok(second, 'second feed has a share toggle')
            t.equal(first?.checked, false, 'unpublished feed is unchecked')
            t.equal(second?.checked, true, 'published feed is checked')
        } finally {
            unmount(root)
        }
    }
)

test('Settings share section shows empty state with no feeds (AC2.3)',
    async t => {
        const state = makeState([])
        const root = mount(state)

        try {
            await nextTick()
            const shareSection = root.querySelector(
                '.share-section'
            )
            const emptyState = shareSection?.querySelector(
                '.empty-state'
            )
            const shareList = shareSection?.querySelector(
                '.settings-share-list'
            )

            t.ok(emptyState, 'empty state is shown')
            t.equal(shareList, null, 'share list is not shown')
        } finally {
            unmount(root)
        }
    }
)

test('Settings share flow shows progress and stores feed row (AC3.2)',
    async t => {
        const origFetch = globalThis.fetch
        let release:() => void = () => {}
        const fetchStarted = new Promise<void>(resolve => {
            globalThis.fetch = (async (input, init) => {
                resolve()
                await new Promise<void>(resolve => {
                    release = resolve
                })
                const request = input instanceof Request ? input : null
                const url = request?.url ?? String(input)
                const method = request?.method ?? init?.method
                t.equal(url.endsWith('/api/feeds/1/publish'), true)
                t.equal(method, 'POST', 'publish uses POST')
                return new Response(JSON.stringify({
                    feed: {
                        ...feed(1),
                        published: 1,
                        published_rkey: 'feed.abc',
                        published_at: '2026-06-10T21:00:00.000Z'
                    }
                }), {
                    status: 200,
                    headers: { 'content-type': 'application/json' }
                })
            }) as typeof fetch
        })
        const state = makeState([feed(1)])
        const root = mount(state)

        try {
            await nextTick()
            const shareSection = root.querySelector(
                '.share-section'
            )
            const box = shareSection?.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            t.ok(box, 'share toggle is present')
            if (!box) return

            box.checked = true
            box.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            const modal = document.querySelector(
                'modal-window.publish-consent-modal'
            )
            t.ok(modal, 'consent modal opens before publishing')
            const confirmBtn = modal?.querySelector(
                'button.consent-confirm'
            ) as HTMLButtonElement|null
            t.ok(confirmBtn, 'confirm button is present')
            if (!confirmBtn) return

            confirmBtn.click()
            await fetchStarted
            await nextTick()

            t.equal(box.disabled, true, 'toggle is disabled while saving')
            const statusEl = shareSection?.querySelector(
                '#share-feed-1-status'
            )
            t.ok(
                statusEl?.textContent?.includes('Sharing...'),
                'pending status is visible in status element'
            )

            release()
            await nextTick()
            await nextTick()

            t.equal(state.feeds.value[0]?.published, 1)
            t.equal(state.feeds.value[0]?.published_rkey, 'feed.abc')
            t.equal(box.checked, true, 'toggle remains checked')
            t.ok(
                statusEl?.textContent?.includes('Published'),
                'published status is visible'
            )
        } finally {
            globalThis.fetch = origFetch
            unmount(root)
        }
    }
)

test('Settings share section surfaces publish errors (AC3.5)',
    async t => {
        const state = makeState([feed(1)])
        const root = mount(state)

        try {
            await nextTick()
            state.feedPublishErrors.value = { 1: 'boom' }
            await nextTick()

            const shareSection = root.querySelector(
                '.share-section'
            )
            const statusEl = shareSection?.querySelector(
                '#share-feed-1-status'
            )
            t.ok(
                statusEl?.textContent?.includes('Failed: boom'),
                'error is displayed in status element'
            )
            t.ok(
                statusEl?.className?.includes('error'),
                'error class is applied'
            )
        } finally {
            unmount(root)
        }
    }
)
