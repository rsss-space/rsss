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

test('Share toggle lives inside each feed\'s subscription card (AC2.1)',
    async t => {
        const state = makeState([feed(1)])
        const root = mount(state)

        try {
            await nextTick()
            const item = root.querySelector(
                '.settings-feeds-list .settings-feed-item'
            )
            t.ok(item, 'subscription feed card exists')
            t.ok(
                item?.querySelector('check-box[name="share-feed-1"]'),
                'share toggle is nested within its own feed card'
            )
            t.equal(
                root.querySelector('.share-section'),
                null,
                'standalone share section no longer exists'
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
            const items = Array.from(root.querySelectorAll(
                '.settings-feeds-list .settings-feed-item'
            ))
            t.equal(items.length, 2, 'one subscription card per feed')

            // Scope each lookup to its own card so the test fails if a
            // toggle is detached from the feed it controls.
            const first = items[0]?.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            const second = items[1]?.querySelector(
                'check-box[name="share-feed-2"]'
            ) as TestCheckBox|null

            t.ok(first, 'feed 1 card owns the share-feed-1 toggle')
            t.ok(second, 'feed 2 card owns the share-feed-2 toggle')
            t.equal(first?.checked, false, 'unpublished feed is unchecked')
            t.equal(second?.checked, true, 'published feed is checked')
        } finally {
            unmount(root)
        }
    }
)

test('Settings shows no share toggles when there are no feeds (AC2.3)',
    async t => {
        const state = makeState([])
        const root = mount(state)

        try {
            await nextTick()
            const toggles = root.querySelectorAll(
                'check-box[name^="share-feed-"]'
            )
            t.equal(toggles.length, 0, 'no share toggles without feeds')

            const subscriptions = Array.from(
                root.querySelectorAll('.settings-section')
            ).find(s => s.querySelector('.settings-feeds-list'))
            t.ok(
                subscriptions?.querySelector('.empty-state'),
                'subscriptions empty state is shown'
            )
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
            const item = root.querySelector(
                '.settings-feeds-list .settings-feed-item'
            )
            const box = item?.querySelector(
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
            const statusEl = item?.querySelector(
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

            const item = root.querySelector(
                '.settings-feeds-list .settings-feed-item'
            )
            const statusEl = item?.querySelector(
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
