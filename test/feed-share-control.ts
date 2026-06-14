import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { FeedShareControl } from '../src/client/components/feed-share-control.js'
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

function makeState (overrides:Partial<{
    feedPublishInProgress:Record<string, boolean>
    feedPublishErrors:Record<string, string>
}> = {}):AppState {
    return {
        feedPublishInProgress: signal(
            overrides.feedPublishInProgress ?? {}
        ),
        feedPublishErrors: signal(
            overrides.feedPublishErrors ?? {}
        )
    } as unknown as AppState
}

function mount (
    state:AppState,
    testFeed:Feed,
    onToggleSpy:(feedId:number, checked:boolean) => void
):HTMLElement {
    const root = document.createElement('div')
    document.body.appendChild(root)
    render(html`<${FeedShareControl}
        state=${state}
        feed=${testFeed}
        onToggle=${onToggleSpy}
    />`, root)
    return root
}

function unmount (root:HTMLElement):void {
    render(null, root)
    root.remove()
}

function nextTick ():Promise<void> {
    return new Promise(resolve => setTimeout(resolve, 0))
}

test('FeedShareControl AC1.1: unpublished feed renders unchecked,' +
    ' enabled checkbox with empty status', async t => {
    const state = makeState()
    const testFeed = feed(1)
    const onToggleSpy = () => {}
    const root = mount(state, testFeed, onToggleSpy)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        const status = root.querySelector(
            '#share-feed-1-status'
        ) as HTMLElement|null

        t.ok(box, 'checkbox exists')
        t.equal(box?.checked, false, 'unpublished feed is unchecked')
        t.equal(box?.disabled, false, 'checkbox is enabled')
        t.equal(status?.textContent?.trim(), '', 'status is empty')
    } finally {
        unmount(root)
    }
})

test('FeedShareControl AC1.2: published feed renders checked checkbox' +
    ' with Published status', async t => {
    const state = makeState()
    const testFeed = feed(1, { published: 1 })
    const onToggleSpy = () => {}
    const root = mount(state, testFeed, onToggleSpy)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        const status = root.querySelector(
            '#share-feed-1-status'
        ) as HTMLElement|null

        t.ok(box, 'checkbox exists')
        t.equal(box?.checked, true, 'published feed is checked')
        t.ok(status?.textContent?.includes('Published'),
            'status includes Published')
    } finally {
        unmount(root)
    }
})

test('FeedShareControl AC1.3: feed with publish in progress renders' +
    ' disabled checkbox with Sharing... status', async t => {
    const state = makeState({
        feedPublishInProgress: { '1': true }
    })
    const testFeed = feed(1)
    const onToggleSpy = () => {}
    const root = mount(state, testFeed, onToggleSpy)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null
        const status = root.querySelector(
            '#share-feed-1-status'
        ) as HTMLElement|null

        t.ok(box, 'checkbox exists')
        t.equal(box?.disabled, true, 'checkbox is disabled')
        t.ok(status?.textContent?.includes('Sharing...'),
            'status includes Sharing...')
    } finally {
        unmount(root)
    }
})

test('FeedShareControl AC1.4: feed with publish error renders failure' +
    ' status with error styling', async t => {
    const state = makeState({
        feedPublishErrors: { '1': 'boom' }
    })
    const testFeed = feed(1)
    const onToggleSpy = () => {}
    const root = mount(state, testFeed, onToggleSpy)

    try {
        await nextTick()
        const status = root.querySelector(
            '#share-feed-1-status'
        ) as HTMLElement|null

        t.ok(status?.textContent?.includes('Failed: boom'),
            'status includes Failed: boom')
        t.ok(status?.className?.includes('error'),
            'status has error class')
    } finally {
        unmount(root)
    }
})

test('FeedShareControl AC1.5: toggling checkbox invokes onToggle with' +
    ' (feed.id, checked)', async t => {
    const state = makeState()
    const testFeed = feed(1)
    let toggleCalls:(number[]|boolean[])[] = []
    const onToggleSpy = (
        feedId:number,
        checked:boolean
    ):void => {
        toggleCalls.push([feedId, checked])
    }
    const root = mount(state, testFeed, onToggleSpy)

    try {
        await nextTick()
        const box = root.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null

        t.ok(box, 'checkbox exists')

        // Test toggling from unchecked to checked
        box!.checked = true
        box!.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        t.equal(toggleCalls.length, 1, 'onToggle called once')
        t.deepEqual(toggleCalls[0], [1, true],
            'onToggle called with (feed.id, true)')

        // Test toggling from checked to unchecked with published feed
        toggleCalls = []
        const root2 = document.createElement('div')
        document.body.appendChild(root2)
        const testFeed2 = feed(1, { published: 1 })
        render(html`<${FeedShareControl}
            state=${state}
            feed=${testFeed2}
            onToggle=${onToggleSpy}
        />`, root2)

        await nextTick()
        const box2 = root2.querySelector(
            'check-box[name="share-feed-1"]'
        ) as TestCheckBox|null

        box2!.checked = false
        box2!.dispatchEvent(new Event('change', { bubbles: true }))
        await nextTick()

        t.equal(toggleCalls.length, 1, 'onToggle called once for unchecked')
        t.deepEqual(toggleCalls[0], [1, false],
            'onToggle called with (feed.id, false)')

        render(null, root2)
        root2.remove()
    } finally {
        unmount(root)
    }
})
