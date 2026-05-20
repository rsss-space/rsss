import { test } from '@substrate-system/tapzero'
import {
    type ReadonlySignal,
    signal,
    computed,
    effect
} from '@preact/signals'
import {
    State,
    type AppState,
    type ViewItemsCache,
    type ViewItemsCacheEntry
} from '../src/client/state.js'
import type {
    CountsResponse,
    Feed,
    Item
} from '../src/client/db/types.js'

const originalLoadItems = State.loadItems

function makeState ():AppState {
    const state = {
        _setRoute: (_r:string) => {},
        route: signal('/'),
        routeItem: signal<Item|null>(null),
        routeItemLoading: signal(false),
        user: signal(null),
        authLoading: signal(false),
        authError: signal<string|null>(null),
        oauthInFlight: signal(false),
        feeds: signal<Feed[]>([]),
        feedsLoading: signal(false),
        feedsError: signal<string|null>(null),
        refreshInProgress: signal(false),
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
        viewItemsCache: new Map() as ViewItemsCache,
        initialLoadComplete: signal<boolean>(false),
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
    ;(state as unknown as {
        displayedFeedSyncStatus:ReadonlySignal<string>
    }).displayedFeedSyncStatus = computed(() => 'synced')
    return state
}

function makeItem (id:number, isStarred:0|1 = 0):Item {
    return {
        id,
        feed_id: 1,
        guid: `g-${id}`,
        title: null,
        link: null,
        description: null,
        content: null,
        author: null,
        pub_date: null,
        thumbnail_url: null,
        is_read: 0,
        is_starred: isStarred,
        created_at: '2026-01-01',
        updated_at: '2026-01-01'
    }
}

function makeEntry (items:Item[]):ViewItemsCacheEntry {
    return { items, total: items.length, limit: 20, offset: 0 }
}

test('view-switch-instant: showAll applies cached entry ' +
    'synchronously', t => {
    let loadItemsCalled = false
    State.loadItems = (async (_s:AppState):Promise<void> => {
        loadItemsCalled = true
        // Never resolves during this test — the synchronous path must
        // not depend on this promise resolving.
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        state.showStarredOnly.value = true
        const allItems = [makeItem(1), makeItem(2), makeItem(3)]
        state.viewItemsCache.set('all', makeEntry(allItems))

        State.showAll(state)

        t.equal(
            state.showStarredOnly.value,
            false,
            'showStarredOnly flipped to false synchronously'
        )
        t.equal(
            state.items.value,
            allItems,
            'items.value points at the cached array synchronously'
        )
        t.equal(
            state.itemsTotal.value,
            3,
            'itemsTotal matches cached total'
        )
        t.equal(
            state.itemsLoading.value,
            false,
            'itemsLoading is false on a cache hit'
        )
        t.ok(
            loadItemsCalled,
            'background loadItems was kicked off'
        )
    } finally {
        State.loadItems = originalLoadItems
    }
})

test('view-switch-instant: showStarred applies cached entry ' +
    'synchronously', t => {
    State.loadItems = (async (_s:AppState):Promise<void> => {
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        const starredItems = [makeItem(10, 1), makeItem(11, 1)]
        state.viewItemsCache.set('starred', makeEntry(starredItems))

        State.showStarred(state)

        t.equal(
            state.showStarredOnly.value,
            true,
            'showStarredOnly flipped to true synchronously'
        )
        t.equal(
            state.items.value,
            starredItems,
            'items.value points at the cached starred array'
        )
        t.equal(
            state.itemsTotal.value,
            2,
            'itemsTotal matches cached total'
        )
        t.equal(
            state.itemsLoading.value,
            false,
            'itemsLoading stays false on a cache hit'
        )
    } finally {
        State.loadItems = originalLoadItems
    }
})

test('view-switch-instant: cache miss leaves itemsLoading false ' +
    'when items array is non-empty', t => {
    State.loadItems = (async (_s:AppState):Promise<void> => {
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        const previousItems = [makeItem(1), makeItem(2)]
        state.items.value = previousItems
        state.itemsTotal.value = previousItems.length
        // No cache entry for 'starred'
        state.showStarredOnly.value = false

        State.showStarred(state)

        t.equal(
            state.showStarredOnly.value,
            true,
            'filter signal still flipped'
        )
        t.equal(
            state.items.value,
            previousItems,
            'previous items remain visible (no clear to empty)'
        )
        t.equal(
            state.itemsLoading.value,
            false,
            'no loading placeholder when previous items remain'
        )
    } finally {
        State.loadItems = originalLoadItems
    }
})

test('view-switch-instant: filter flip and items write happen in ' +
    'a single signal-effect tick', t => {
    State.loadItems = (async (_s:AppState):Promise<void> => {
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        state.showStarredOnly.value = true
        const allItems = [makeItem(1), makeItem(2)]
        state.viewItemsCache.set('all', makeEntry(allItems))

        let combinedTicks = 0
        const stop = effect(() => {
            // Subscribe to both signals so the effect depends on each.
            const _flip = state.showStarredOnly.value
            const _items = state.items.value
            if (_flip || _items) { /* read */ }
            combinedTicks++
        })
        // The initial run is one tick; reset counter to count only
        // the deltas triggered by showAll.
        const initialTicks = combinedTicks

        State.showAll(state)

        t.equal(
            combinedTicks - initialTicks,
            1,
            'showStarredOnly + items writes fire one combined effect ' +
                'tick (i.e. they batch)'
        )
        stop()
    } finally {
        State.loadItems = originalLoadItems
    }
})

test('view-switch-instant: showAll on cache miss with empty items ' +
    'sets itemsLoading=true', t => {
    State.loadItems = (async (_s:AppState):Promise<void> => {
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        state.showStarredOnly.value = true
        // No cache entry; items already empty.
        state.items.value = []

        State.showAll(state)

        t.equal(
            state.itemsLoading.value,
            true,
            'cache miss + empty items raises the loading placeholder'
        )
    } finally {
        State.loadItems = originalLoadItems
    }
})
