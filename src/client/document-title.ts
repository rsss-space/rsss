/**
 * Mirror the count of pending feed updates into the document title,
 * e.g. "(6) RSSS - RSS Reader".
 *
 * Matches the header's "N updates" indicator (see
 * `components/feed-status.ts`): the count is the sum of
 * `feedUpdateCounts` and is shown only while updates are available
 * (`displayedFeedSyncStatus === 'updates'`). Any other status -- in
 * particular `syncing`, while a refresh is in progress -- restores the
 * plain title, so the tab title stays consistent with what is on screen.
 *
 * The base title is captured once from the current document title, so
 * the static `<title>` in `index.html` remains the single source of
 * truth. Returns a dispose function (used for HMR teardown).
 */

import { type ReadonlySignal, effect } from '@preact/signals'

type FeedSyncStatus =
    | 'inactive'
    | 'updates'
    | 'syncing'
    | 'error'
    | 'synced'

export function initDocumentTitle (
    displayedStatus:ReadonlySignal<FeedSyncStatus>,
    feedUpdateCounts:ReadonlySignal<Record<string, number>>
):() => void {
    const baseTitle = document.title

    return effect(() => {
        const count = displayedStatus.value === 'updates' ?
            Object.values(feedUpdateCounts.value)
                .reduce((sum, n) => sum + n, 0) :
            0

        document.title = count > 0 ?
            `(${count}) ${baseTitle}` :
            baseTitle
    })
}
