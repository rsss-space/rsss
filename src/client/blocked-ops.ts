import type {DeadLetterRow} from './db/push-sync.js'
import type {Feed, Item} from './db/types.js'

export type FeedRowState = 'blocked'|'failed'|'resolving'|'none'

export function mapBlockedOpsByFeed (
    _rows:DeadLetterRow[],
    _feeds:Feed[],
    _items:Item[]
):Map<number, DeadLetterRow[]> {
    return new Map()
}

export function feedRowState (
    _feed:Feed,
    _blockedOps:DeadLetterRow[]
):FeedRowState {
    return 'none'
}
