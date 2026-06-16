import { html } from 'htm/preact'
import { type FunctionComponent } from 'preact'
import {
    type AppState,
    type Feed,
    paintCacheHydratedOnBootstrap,
} from '../state.js'
import {
    bootstrapInProgress,
    bootstrapFeedsCount,
    bootstrapItemsCount
} from '../db/bootstrap.js'
import { PendingUpdateEmptyState } from './pending-update-empty-state.js'
import './empty-state.css'

export const BOOTSTRAP_CARD_TITLE = 'Setting up your local cache'

export const EmptyState:FunctionComponent<{
    state:AppState;
    pendingCount:number;
    selectedFeed:Feed|null;
    onRefreshPending:()=>Promise<void>;
}> = function EmptyState (props) {
    const { state, pendingCount, selectedFeed, onRefreshPending } = props
    const { feeds } = state

    // First-ever device bootstrap: show explicit progress card
    // instead of "Maybe add some feeds" while OPFS pulls the
    // initial dataset.
    if (
        bootstrapInProgress.value &&
        !paintCacheHydratedOnBootstrap.value
    ) {
        return html`
            <div class="bootstrap-card" role="status" aria-live="polite">
                <h3 class="bootstrap-card-title">
                    ${BOOTSTRAP_CARD_TITLE}
                </h3>
                <p class="bootstrap-card-body">
                    This only happens once on this device.
                </p>
                <p class="bootstrap-card-progress">
                    ${bootstrapFeedsCount.value} feeds &middot;
                    ${bootstrapItemsCount.value} items
                </p>
            </div>
        `
    }

    if (feeds.value.length === 0) {
        return html`<div class="empty-state">
            Maybe add some feeds to start reading.
        </div>`
    }
    if (pendingCount > 0) {
        return html`<${PendingUpdateEmptyState}
            count=${pendingCount}
            onRefresh=${onRefreshPending}
        />`
    }
    if (selectedFeed) {
        return html`<div class="empty-state">
            No items in ${selectedFeed.title || selectedFeed.url}
        </div>`
    }
    return html`<div class="empty-state">
        No items to show.
    </div>`
}
