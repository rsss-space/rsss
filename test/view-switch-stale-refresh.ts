import { test } from '@substrate-system/tapzero'
import {
    type ReadonlySignal,
    signal,
    computed
} from '@preact/signals'
import {
    State,
    applyItemsResult,
    currentFilterKey,
    type AppState,
    type FilterKey,
    type ViewItemsCache
} from '../src/client/state.js'
import type {
    CountsResponse,
    Feed,
    Item,
    ItemsResponse
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

function makeResponse (items:Item[]):ItemsResponse {
    return { items, total: items.length, limit: 20, offset: 0 }
}

test('view-switch-stale-refresh: late starred response is discarded ' +
    'after the user switched to all', t => {
    const state = makeState()
    const allItems = [makeItem(1), makeItem(2)]
    state.viewItemsCache.set('all', {
        items: allItems,
        total: allItems.length,
        limit: 20,
        offset: 0
    })

    // 1. User is on All, then clicks Starred.
    State.showStarred(state)
    const starredRequestKey:FilterKey|null = currentFilterKey(state)
    t.equal(
        starredRequestKey,
        'starred',
        'request captures starred key after click'
    )

    // 2. Before the starred fetch resolves, user clicks All.
    State.showAll(state)
    t.equal(
        currentFilterKey(state),
        'all',
        'currentFilterKey now reflects all'
    )
    t.equal(
        state.items.value,
        allItems,
        'items synchronously restored from the all cache'
    )

    // 3. The slow starred refresh finally resolves.
    const lateStarred = [makeItem(99, 1), makeItem(100, 1)]
    applyItemsResult(
        state,
        starredRequestKey,
        makeResponse(lateStarred)
    )

    t.equal(
        state.items.value,
        allItems,
        'late starred response did not overwrite visible all items'
    )
    t.equal(
        state.viewItemsCache.get('starred'),
        undefined,
        'late starred response did not write to cache either'
    )
})

test('view-switch-stale-refresh: matching response still applies ' +
    'and populates the cache', t => {
    const state = makeState()
    state.showStarredOnly.value = true
    const starredRequestKey:FilterKey|null = currentFilterKey(state)

    const freshStarred = [makeItem(5, 1)]
    applyItemsResult(
        state,
        starredRequestKey,
        makeResponse(freshStarred)
    )

    t.equal(
        state.items.value,
        freshStarred,
        'items signal updated when key still matches'
    )
    t.equal(
        state.itemsTotal.value,
        1,
        'itemsTotal updated when key still matches'
    )
    const cached = state.viewItemsCache.get('starred')
    t.ok(
        cached !== undefined,
        'starred cache populated when key still matches'
    )
    t.equal(
        cached?.items,
        freshStarred,
        'cache holds the just-applied items array'
    )
})

test('view-switch-stale-refresh: null result clears itemsLoading ' +
    'without writing to cache', t => {
    const state = makeState()
    state.itemsLoading.value = true
    const requestKey = currentFilterKey(state)

    applyItemsResult(state, requestKey, null)

    t.equal(
        state.itemsLoading.value,
        false,
        'itemsLoading cleared'
    )
    t.equal(
        state.viewItemsCache.size,
        0,
        'cache untouched for null result'
    )
})

test('view-switch-stale-refresh: per-feed route (selectedFeedId set) ' +
    'never writes to cache', t => {
    const state = makeState()
    state.selectedFeedId.value = 7
    const requestKey = currentFilterKey(state)
    t.equal(
        requestKey,
        null,
        'currentFilterKey is null on a per-feed route'
    )

    const feedItems = [makeItem(20)]
    applyItemsResult(state, requestKey, makeResponse(feedItems))

    t.equal(
        state.items.value,
        feedItems,
        'items still written for the per-feed view'
    )
    t.equal(
        state.viewItemsCache.size,
        0,
        'per-feed view never writes to cache'
    )
})
