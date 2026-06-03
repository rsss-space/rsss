import { signal } from '@preact/signals'
import { html } from 'htm/preact/index.js'
import { render } from 'preact'
import { test } from '@substrate-system/tapzero'
import { SidebarItem } from '../src/client/components/sidebar-item.js'
import { type AppState } from '../src/client/state.js'

interface StubOpts {
    unread?:number
    starred?:number
    total?:number
    showUnreadOnly?:boolean
    showStarredOnly?:boolean
    route?:string
}

function stubState (opts:StubOpts = {}):AppState {
    return {
        counts: signal({
            unread: opts.unread ?? 0,
            starred: opts.starred ?? 0,
            total: opts.total ?? 0
        }),
        showUnreadOnly: signal(opts.showUnreadOnly ?? false),
        showStarredOnly: signal(opts.showStarredOnly ?? false),
        route: signal(opts.route ?? '/'),
        _setRoute: () => {}
    } as unknown as AppState
}

function mount (state:AppState, starred:boolean):HTMLDivElement {
    const body = document.querySelector('body') as HTMLElement
    const root = document.createElement('div')
    body.appendChild(root)
    render(
        html`<${SidebarItem}
            state=${state}
            starred=${starred}
        >label<//>`,
        root
    )
    return root
}

function badgeText (root:HTMLElement):string {
    const badge = root.querySelector('.badge') as HTMLElement
    return badge.textContent?.trim() ?? ''
}

test(
    'SidebarItem All Items badge shows total when filter is off',
    t => {
        const state = stubState({
            unread: 3, starred: 1, total: 7, showUnreadOnly: false
        })
        const root = mount(state, false)
        try {
            t.equal(
                badgeText(root),
                '7',
                'badge equals counts.total when showUnreadOnly is false'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'SidebarItem All Items badge shows unread when filter is on',
    t => {
        const state = stubState({
            unread: 3, starred: 1, total: 7, showUnreadOnly: true
        })
        const root = mount(state, false)
        try {
            t.equal(
                badgeText(root),
                '3',
                'badge equals counts.unread when showUnreadOnly is true'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'SidebarItem All Items badge flips when showUnreadOnly toggles',
    async t => {
        const state = stubState({
            unread: 3, starred: 1, total: 7, showUnreadOnly: false
        })
        const root = mount(state, false)
        try {
            t.equal(badgeText(root), '7', 'starts at total')

            state.showUnreadOnly.value = true
            await new Promise(resolve => setTimeout(resolve, 0))
            t.equal(
                badgeText(root),
                '3',
                'flips to unread when toggled on'
            )

            state.showUnreadOnly.value = false
            await new Promise(resolve => setTimeout(resolve, 0))
            t.equal(
                badgeText(root),
                '7',
                'flips back to total when toggled off'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test(
    'SidebarItem Starred badge ignores showUnreadOnly',
    t => {
        const state = stubState({
            unread: 3, starred: 1, total: 7, showUnreadOnly: true
        })
        const root = mount(state, true)
        try {
            t.equal(
                badgeText(root),
                '1',
                'starred badge always shows counts.starred'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test('SidebarItem renders an anchor link, not a button', t => {
    const state = stubState({})
    const root = mount(state, false)
    try {
        const link = root.querySelector('.sidebar-item') as HTMLElement
        t.ok(link, 'sidebar-item element renders')
        t.equal(
            link.tagName,
            'A',
            'rendered element is <a>, not <button>'
        )
        t.equal(
            link.getAttribute('href'),
            '/',
            'href attribute equals "/"'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})

test('SidebarItem All Items active class reflects showStarredOnly',
    async t => {
        const state = stubState({ showStarredOnly: false })
        const root = mount(state, false)
        try {
            const link = (
                root.querySelector('.sidebar-item') as HTMLElement
            )
            t.ok(
                link.classList.contains('active'),
                'All Items active when showStarredOnly is false'
            )

            state.showStarredOnly.value = true
            await new Promise(resolve => setTimeout(resolve, 0))
            t.ok(
                !link.classList.contains('active'),
                'All Items inactive when showStarredOnly flips to true'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test('SidebarItem Starred active class reflects showStarredOnly',
    async t => {
        const state = stubState({ showStarredOnly: true })
        const root = mount(state, true)
        try {
            const link = (
                root.querySelector('.sidebar-item') as HTMLElement
            )
            t.ok(
                link.classList.contains('active'),
                'Starred active when showStarredOnly is true'
            )

            state.showStarredOnly.value = false
            await new Promise(resolve => setTimeout(resolve, 0))
            t.ok(
                !link.classList.contains('active'),
                'Starred inactive when showStarredOnly flips to false'
            )
        } finally {
            render(null, root)
            root.remove()
        }
    }
)

test('SidebarItem is not active on feed-specific routes', t => {
    const state = stubState({
        showStarredOnly: false,
        route: '/feed/example.com/feed.rss'
    })
    const root = mount(state, false)
    try {
        const link = root.querySelector('.sidebar-item') as HTMLElement
        t.ok(
            !link.classList.contains('active'),
            'All Items not active on /feed/* route'
        )
    } finally {
        render(null, root)
        root.remove()
    }
})
