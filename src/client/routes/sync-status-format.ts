import type { DeadLetterRow } from '../db/push-sync.js'
import type { Feed } from '../db/types.js'

export function describeOp (row:DeadLetterRow):string {
    let payload:Record<string, unknown> = {}
    try {
        const parsed = JSON.parse(row.payload)
        if (parsed && typeof parsed === 'object') {
            payload = parsed
        }
    } catch {
        // Invalid JSON; treat as empty payload
    }

    switch (row.op) {
        case 'add_feed': {
            const url = payload.url
            if (typeof url === 'string' && url.length > 0) {
                return `Add feed: ${url}`
            }
            return `Add feed (id: ${row.target_id})`
        }

        case 'delete_feed': {
            return `Delete feed ${row.target_id}`
        }

        case 'update_item': {
            const fields = []
            if (payload.is_read !== undefined) {
                fields.push('read')
            }
            if (payload.is_starred !== undefined) {
                fields.push('starred')
            }
            const fieldList = fields.length > 0 ?
                fields.join(', ') :
                'item'
            return `Update item ${row.target_id}: ${fieldList}`
        }

        case 'mark_all_read': {
            if (row.target_id !== null) {
                return `Mark feed ${row.target_id} as read`
            }
            return 'Mark all feeds as read'
        }

        default: {
            return `Unknown operation: ${row.op}`
        }
    }
}

export function isFetchFailed (feed:Feed):boolean {
    if (feed.last_error !== null) {
        return true
    }
    if (feed.last_status !== null && feed.last_status >= 400) {
        return true
    }
    return false
}

export function isPublishFailed (feed:Feed):boolean {
    return (feed.publish_error ?? null) !== null
}
