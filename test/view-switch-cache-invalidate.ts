import { test } from '@substrate-system/tapzero'
import {
    type ReadonlySignal,
    signal,
    computed
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

function seedCache (cache:ViewItemsCache):void {
    const allEntry:ViewItemsCacheEntry = {
        items: [makeItem(1), makeItem(2)],
        total: 2,
        limit: 20,
        offset: 0
    }
    const starredEntry:ViewItemsCacheEntry = {
        items: [makeItem(3, 1)],
        total: 1,
        limit: 20,
        offset: 0
    }
    cache.set('all', allEntry)
    cache.set('starred', starredEntry)
}

// Suppress any unhandled rejections from the mutations' adapter calls
// (the network call has no backend in this test).
function fireAndSwallow (p:Promise<unknown>):void {
    p.catch(() => {})
}

test('cache invalidate: toggleItemRead clears viewItemsCache', t => {
    const state = makeState()
    seedCache(state.viewItemsCache)
    t.equal(state.viewItemsCache.size, 2, 'cache seeded')

    fireAndSwallow(State.toggleItemRead(state, 1, true))

    t.equal(
        state.viewItemsCache.size,
        0,
        'cache cleared synchronously by toggleItemRead'
    )
})

test('cache invalidate: toggleItemStarred clears viewItemsCache', t => {
    const state = makeState()
    seedCache(state.viewItemsCache)
    t.equal(state.viewItemsCache.size, 2, 'cache seeded')

    fireAndSwallow(State.toggleItemStarred(state, 1, true))

    t.equal(
        state.viewItemsCache.size,
        0,
        'cache cleared synchronously by toggleItemStarred'
    )
})

test('cache invalidate: markAllRead clears viewItemsCache', t => {
    const state = makeState()
    seedCache(state.viewItemsCache)
    t.equal(state.viewItemsCache.size, 2, 'cache seeded')

    fireAndSwallow(State.markAllRead(state))

    t.equal(
        state.viewItemsCache.size,
        0,
        'cache cleared synchronously by markAllRead'
    )
})

test('cache invalidate: reconcileAfterRefresh clears viewItemsCache ' +
    'at entry', t => {
    const state = makeState()
    seedCache(state.viewItemsCache)
    t.equal(state.viewItemsCache.size, 2, 'cache seeded')

    fireAndSwallow(State.reconcileAfterRefresh(state))

    t.equal(
        state.viewItemsCache.size,
        0,
        'cache cleared synchronously at reconcileAfterRefresh entry'
    )
})

test('cache invalidate: loadInitialView clears viewItemsCache ' +
    'at entry', t => {
    const state = makeState()
    seedCache(state.viewItemsCache)
    t.equal(state.viewItemsCache.size, 2, 'cache seeded')

    fireAndSwallow(State.loadInitialView(state))

    t.equal(
        state.viewItemsCache.size,
        0,
        'cache cleared synchronously at loadInitialView entry'
    )
})

// T020 — itemsLoading gate stays false when cache holds an entry,
// even while a background loadItems is still pending.
test('cache invalidate: showAll with cached entry leaves ' +
    'itemsLoading=false while background loadItems is pending', t => {
    const originalLoadItems = State.loadItems
    State.loadItems = (async (_s:AppState):Promise<void> => {
        // Pending forever — simulates a slow background refresh.
        return new Promise<void>(() => {})
    }) as typeof State.loadItems

    try {
        const state = makeState()
        const allItems = [makeItem(1), makeItem(2)]
        state.viewItemsCache.set('all', {
            items: allItems,
            total: allItems.length,
            limit: 20,
            offset: 0
        })
        // Pretend the user is currently on Starred, then clicks All.
        state.showStarredOnly.value = true

        State.showAll(state)

        t.equal(
            state.itemsLoading.value,
            false,
            'itemsLoading stays false while background refresh pending'
        )
        t.equal(
            state.items.value,
            allItems,
            'items reflect the cached entry'
        )
    } finally {
        State.loadItems = originalLoadItems
    }
})
