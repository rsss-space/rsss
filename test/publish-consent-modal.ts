import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { SettingsRoute } from '../src/client/routes/settings.js'
import { ModalWindow } from '@substrate-system/dialog'
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
        route: signal('/settings'),
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

test('Share toggle shows consent modal before publishing', async t => {
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
        await nextTick()

        const modal = document.querySelector(
            'modal-window.publish-consent-modal'
        )
        t.ok(modal, 'consent modal is present in the DOM')
        t.equal(
            modal?.getAttribute('active'),
            'true',
            'consent modal is active'
        )
    } finally {
        unmount(root)
    }
})

test('Consent modal contains required privacy copy', async t => {
    const state = makeState([feed(1)])
    const root = mount(state)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        if (!box) { t.fail('share toggle not found'); return }

        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        const modal = document.querySelector(
            'modal-window.publish-consent-modal'
        )
        if (!modal) { t.fail('consent modal not found'); return }

        const text = modal.textContent ?? ''
        t.ok(
            text.toLowerCase().includes('pds') ||
            text.toLowerCase().includes('personal data server'),
            'copy mentions PDS / personal data server'
        )
        t.ok(
            text.toLowerCase().includes('at protocol'),
            'copy mentions AT Protocol network'
        )
        t.ok(
            text.toLowerCase().includes('timeline') ||
            text.toLowerCase().includes('bluesky feed'),
            'copy notes records do not appear in Bluesky timeline'
        )
        t.ok(
            text.toLowerCase().includes('remov'),
            'copy notes records can be removed'
        )
    } finally {
        unmount(root)
    }
})

test('Canceling consent modal does not publish', async t => {
    let publishCalled = false
    const origFetch = globalThis.fetch
    globalThis.fetch = (async () => {
        publishCalled = true
        return new Response('{}', { status: 200 })
    }) as typeof fetch

    const state = makeState([feed(1)])
    const root = mount(state)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        if (!box) { t.fail('share toggle not found'); return }

        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        const modal = document.querySelector(
            'modal-window.publish-consent-modal'
        )
        if (!modal) { t.fail('consent modal not found'); return }

        const cancelBtn = modal.querySelector(
            'button.consent-cancel'
        ) as HTMLButtonElement|null
        t.ok(cancelBtn, 'cancel button is present')
        cancelBtn?.click()
        await nextTick()

        t.equal(publishCalled, false, 'publish was not called after cancel')
        t.equal(
            document.querySelector('modal-window.publish-consent-modal')
                ?.getAttribute('active'),
            null,
            'modal is closed after cancel'
        )
    } finally {
        globalThis.fetch = origFetch
        unmount(root)
    }
})

test('Confirming consent modal proceeds with publish', async t => {
    const captured = {
        url: null as string|null,
        method: null as string|null
    }
    const origFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
        const req = input instanceof Request ? input : null
        captured.url = req?.url ?? String(input)
        captured.method = req?.method ?? init?.method ?? 'GET'
        return new Response(JSON.stringify({
            feed: {
                ...feed(1),
                published: 1,
                published_rkey: 'consent.test',
                published_at: '2026-06-10T22:00:00.000Z'
            }
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    }) as typeof fetch

    const state = makeState([feed(1)])
    const root = mount(state)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        if (!box) { t.fail('share toggle not found'); return }

        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        const modal = document.querySelector(
            'modal-window.publish-consent-modal'
        )
        if (!modal) { t.fail('consent modal not found'); return }

        const confirmBtn = modal.querySelector(
            'button.consent-confirm'
        ) as HTMLButtonElement|null
        t.ok(confirmBtn, 'confirm button is present')
        confirmBtn?.click()
        await nextTick()
        await nextTick()

        t.ok(
            captured.url?.endsWith('/api/feeds/1/publish'),
            'publish endpoint called'
        )
        t.equal(captured.method, 'POST', 'publish uses POST')
    } finally {
        globalThis.fetch = origFetch
        unmount(root)
    }
})

test('Disabling published feed unpublishes immediately, no modal (AC3.4)',
    async t => {
        const captured = {
            url: null as string|null,
            method: null as string|null
        }
        const origFetch = globalThis.fetch
        globalThis.fetch = (async (input, init) => {
            const req = input instanceof Request ? input : null
            captured.url = req?.url ?? String(input)
            captured.method = req?.method ?? init?.method ?? 'GET'
            return new Response(JSON.stringify({
                feed: {
                    ...feed(1, { published: 1 }),
                    published: 0
                }
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch

        const state = makeState([
            feed(1, {
                published: 1,
                published_rkey: 'existing.pub',
                published_at: '2026-06-10T20:00:00.000Z'
            })
        ])
        const root = mount(state)

        try {
            await nextTick()
            const box = root.querySelector(
                'check-box[name="share-feed-1"]'
            ) as TestCheckBox|null
            t.ok(box, 'share toggle is present')
            if (!box) return

            box.checked = false
            box.dispatchEvent(new Event('change', { bubbles: true }))
            await nextTick()

            const modal = document.querySelector(
                'modal-window.publish-consent-modal'
            )
            t.equal(
                modal,
                null,
                'no consent modal appears for unpublish'
            )
            t.ok(
                captured.url?.endsWith('/api/feeds/1/publish'),
                'DELETE endpoint called'
            )
            t.equal(captured.method, 'DELETE', 'unpublish uses DELETE')
        } finally {
            globalThis.fetch = origFetch
            unmount(root)
        }
    }
)

test('Modal close event resets consent state (AC3.6)', async t => {
    const state = makeState([feed(1)])
    const root = mount(state)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        if (!box) { t.fail('share toggle not found'); return }

        box.checked = true
        box.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        const modal = document.querySelector(
            'modal-window.publish-consent-modal'
        ) as HTMLElement|null
        t.ok(modal, 'consent modal is present')
        if (!modal) return

        modal.dispatchEvent(
            new Event(ModalWindow.event('close'))
        )
        await nextTick()
        await nextTick()

        const modalAfter = document.querySelector(
            'modal-window.publish-consent-modal'
        )
        t.equal(
            modalAfter,
            null,
            'modal is removed from DOM after close event'
        )
    } finally {
        unmount(root)
    }
})
