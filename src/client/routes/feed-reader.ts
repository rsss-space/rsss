import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import { useCallback, useEffect, useMemo } from 'preact/hooks'
import { CheckBox } from '@substrate-system/check-box'
import {
    State,
    type AppState,
    stripProtocol,
} from '../state.js'
import { ItemRow } from '../components/item-row.js'
import { Sidebar } from '../components/sidebar.js'
import { CacheSettings } from '../components/cache-settings.js'
import { EmptyState } from '../components/empty-state.js'
import { Pagination } from '../components/pagination.js'
import { FeedBlockedBanner } from '../components/feed-blocked-banner.js'
import { feedRowState } from '../blocked-ops.js'
import Debug from '@substrate-system/debug'
import { ELLIPSIS } from '../constants.js'
const debug = Debug('rsss:view:feed-reader')

/**
 * This is the home route.
 */
export const FeedReader:FunctionComponent<{
    state:AppState;
    splats:string[];
}> = function FeedReader ({ state, splats }) {
    const {
        feeds,
        items,
        counts,
        itemsLoading,
        showUnreadOnly,
        pageSize,
    } = state

    debug('rendering feed reader...', feeds)

    // Extract feed URL from splats (everything after /feed/)
    const feedUrl = useMemo(() => splats.join('/'), [splats.join('/')])

    // Find the feed by URL
    const selectedFeed = useMemo(() => {
        if (!feedUrl) return null
        return feeds.value.find(f => stripProtocol(f.url) === feedUrl) || null
    }, [feedUrl, feeds.value])

    const blockedOps = selectedFeed ?
        state.blockedOpsForFeed(selectedFeed.id) :
        []
    const rowState = selectedFeed ?
        feedRowState(selectedFeed, blockedOps) :
        'none'
    const showBanner = selectedFeed !== null &&
        (rowState === 'blocked' || rowState === 'failed')

    const pendingCount = (() => {
        const updateCounts = state.feedUpdateCounts.value
        if (state.selectedFeedId.value !== null) {
            return updateCounts[String(state.selectedFeedId.value)] ?? 0
        }
        return Object.values(updateCounts).reduce((a, b) => a + b, 0)
    })()

    const handleRefreshPending = useCallback(
        async ():Promise<void> => {
            const feedId = state.selectedFeedId.value
            if (feedId !== null) {
                await State.refreshFeed(state, String(feedId))
            } else {
                await State.refreshFeeds(state)
            }
        },
        []
    )

    // Sync selected feed into state so loadItems
    // filters at the query level
    useEffect(() => {
        const newId = selectedFeed?.id ?? null
        if (state.selectedFeedId.value !== newId) {
            state.selectedFeedId.value = newId
            state.itemsOffset.value = 0
            State.loadItems(state)
        }

        return () => {
            // Clear feed filter when leaving this view
            if (state.selectedFeedId.value !== null) {
                state.selectedFeedId.value = null
                state.itemsOffset.value = 0
                State.loadItems(state)
            }
        }
    }, [selectedFeed?.id])

    const handleToggleUnread = useCallback(() => {
        state.showUnreadOnly.value = !state.showUnreadOnly.value
        state.itemsOffset.value = 0
        State.loadItems(state)
    }, [])

    const handleMarkAllRead = useCallback(async () => {
        await State.markAllRead(state, selectedFeed?.id)
    }, [])

    const handlePrevPage = useCallback(() => {
        state.itemsOffset.value = Math.max(
            0,
            state.itemsOffset.value - pageSize.value
        )
        State.loadItems(state)
    }, [])

    const handleNextPage = useCallback(() => {
        state.itemsOffset.value =
            state.itemsOffset.value + pageSize.value
        State.loadItems(state)
    }, [])

    const handlePageSizeChange = useCallback((ev:Event) => {
        const target = ev.target as HTMLSelectElement
        state.pageSize.value = parseInt(target.value, 10)
        state.itemsOffset.value = 0
        State.loadItems(state)
    }, [])

    // Get the feed title for display
    const feedTitle = selectedFeed?.title || feedUrl || 'All Feeds'

    return html`
        <div class="route feed-reader">
            <div class="app-body">
                <${Sidebar} state=${state} />

                <main class="content">
                    <div class="items-header">
                        ${selectedFeed && html`
                            <h2 class="feed-title">${feedTitle}</h2>
                            <${CacheSettings}
                                state=${state}
                                selectedFeed=${selectedFeed}
                            />
                        `}
                        <div class="items-filters unread">
                            <${CheckBox.TAG}
                                name="unread"
                                id="unread-check"
                                class="filter-checkbox"
                                checked=${showUnreadOnly.value}
                                onChange=${handleToggleUnread}
                            >
                                Unread only
                            <//>
                        </div>
                        <${Pagination}
                            state=${state}
                            variant="pagination-header"
                            onPrevPage=${handlePrevPage}
                            onNextPage=${handleNextPage}
                            onPageSizeChange=${handlePageSizeChange}
                        />
                        <button
                            class="btn btn-small"
                            onClick=${handleMarkAllRead}
                            disabled=${counts.value.unread === 0}
                        >
                            Mark all read
                        </button>
                    </div>

                    ${showBanner && html`
                        <${FeedBlockedBanner}
                            state=${state}
                            feed=${selectedFeed}
                            blockedOps=${blockedOps}
                        />
                    `}

                    <ul class="items-list">
                        ${itemsLoading.value &&
                            items.value.length === 0 && html`
                            <div class="loading-text">
                                Loading items${ELLIPSIS}
                            </div>
                        `}

                        ${items.value.map(item => html`
                            <li key=${item.id}>
                                <${ItemRow}
                                    item=${item}
                                    state=${state}
                                />
                            </li>
                        `)}

                        ${!itemsLoading.value && items.value.length === 0 &&
                            !showBanner && html`
                            <${EmptyState}
                                state=${state}
                                pendingCount=${pendingCount}
                                selectedFeed=${selectedFeed}
                                onRefreshPending=${handleRefreshPending}
                            />
                        `}
                    </ul>

                    <${Pagination}
                        state=${state}
                        onPrevPage=${handlePrevPage}
                        onNextPage=${handleNextPage}
                        onPageSizeChange=${handlePageSizeChange}
                    />
                </main>
            </div>
        </div>
    `
}
