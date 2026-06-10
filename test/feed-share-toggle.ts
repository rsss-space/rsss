import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedNav } from '../src/client/components/feed-nav.js'
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

test('FeedNav renders per-feed Bluesky share toggles from publish state',
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
            const first = root.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            const second = root.querySelector(
                'check-box[name="share-feed-2"]'
            ) as TestCheckBox|null

            t.ok(first, 'first feed has a share toggle')
            t.ok(second, 'second feed has a share toggle')
            t.equal(first?.textContent?.includes('Share to Bluesky'), true)
            t.equal(first?.checked, false, 'unpublished feed is unchecked')
            t.equal(second?.checked, true, 'published feed is checked')
        } finally {
            unmount(root)
        }
    }
)

test('FeedNav share toggle shows progress and stores returned feed row',
    async t => {
        let release:() => void = () => {}
        const fetchStarted = new Promise<void>(resolve => {
            const originalFetch = globalThis.fetch
            globalThis.fetch = (async (input, init) => {
                resolve()
                await new Promise<void>(resolve => {
                    release = resolve
                })
                globalThis.fetch = originalFetch
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
            const box = root.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            t.ok(box, 'share toggle is present')
            if (!box) return

            box.checked = true
            box.dispatchEvent(new Event('change', { bubbles: true }))
            await fetchStarted
            await nextTick()

            t.equal(box.disabled, true, 'toggle is disabled while saving')
            t.equal(
                root.textContent?.includes('Sharing...'),
                true,
                'pending status is visible'
            )

            release()
            await nextTick()
            await nextTick()

            t.equal(state.feeds.value[0]?.published, 1)
            t.equal(state.feeds.value[0]?.published_rkey, 'feed.abc')
            t.equal(box.checked, true, 'toggle remains checked')
            t.equal(
                root.textContent?.includes('Published'),
                true,
                'published status is visible'
            )
        } finally {
            unmount(root)
        }
    }
)
