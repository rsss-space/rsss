import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedNav } from '../src/client/components/feed-nav.js'
import { type AppState, type Feed } from '../src/client/state.js'

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

test('FeedNav renders no share checkbox (AC4.1)',
    async t => {
        const state = makeState([feed(1), feed(2, {
            published: 1
        })])
        const root = mount(state)

        try {
            await nextTick()
            const checkbox = root.querySelector('check-box')
            const shareCheckbox = root.querySelector(
                'check-box[name^="share-feed-"]'
            )

            t.equal(checkbox, null, 'no check-box element found')
            t.equal(
                shareCheckbox,
                null,
                'no share-feed-* check-box found'
            )
        } finally {
            unmount(root)
        }
    }
)

test('FeedNav renders no consent modal (AC4.2)',
    async t => {
        const state = makeState([feed(1), feed(2, {
            published: 1
        })])
        const root = mount(state)

        try {
            await nextTick()
            const modal = root.querySelector(
                'modal-window.publish-consent-modal'
            )

            t.equal(modal, null, 'no consent modal found')
        } finally {
            unmount(root)
        }
    }
)

test('FeedNav still renders feed navigation (AC4.3)',
    async t => {
        const state = makeState([feed(1), feed(2, {
            published: 1
        })])
        const root = mount(state)

        try {
            await nextTick()
            const unreadCount = root.querySelector(
                '.feed-unread-count'
            )
            const feedLink = root.querySelector('a.feed-select')
            const deleteBtn = root.querySelector('.btn-delete')

            t.ok(
                unreadCount,
                'feed-unread-count badge is rendered'
            )
            t.ok(feedLink, 'feed title link is rendered')
            t.ok(deleteBtn, 'delete button is rendered')
        } finally {
            unmount(root)
        }
    }
)
