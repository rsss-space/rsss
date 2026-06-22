import type { DeadLetterRow } from './db/push-sync.js'
import type { Feed, Item } from './db/types.js'

export type FeedRowState = 'blocked'|'failed'|'resolving'|'none'

export function mapBlockedOpsByFeed (
    rows:DeadLetterRow[],
    _feeds:Feed[],
    items:Item[]
):Map<number, DeadLetterRow[]> {
    const itemIdToFeedId = new Map<number, number>()
    for (const item of items) {
        itemIdToFeedId.set(item.id, item.feed_id)
    }

    const map = new Map<number, DeadLetterRow[]>()

    for (const row of rows) {
        let feedId:number|null = null

        if (
            row.op === 'add_feed' ||
            row.op === 'delete_feed' ||
            row.op === 'mark_all_read'
        ) {
            if (row.target_id !== null) {
                feedId = row.target_id
            }
        } else if (row.op === 'update_item') {
            if (row.target_id !== null) {
                feedId = itemIdToFeedId.get(row.target_id) ?? null
            }
        }

        if (feedId !== null) {
            if (!map.has(feedId)) {
                map.set(feedId, [])
            }
            map.get(feedId)!.push(row)
        }
    }

    return map
}

export function feedRowState (
    feed:Feed,
    blockedOps:DeadLetterRow[]
):FeedRowState {
    if (blockedOps.length > 0) {
        return 'blocked'
    }

    if (feed.last_fetched === null && !!feed.last_error) {
        return 'failed'
    }

    if (feed.last_fetched === null && !feed.last_error) {
        return 'resolving'
    }

    return 'none'
}
