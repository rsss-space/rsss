/**
 * Paint cache — a best-effort, capped, per-DID localStorage snapshot
 * of the current feed list, item list, counts, and selected feed.
 *
 * Read synchronously at bootstrap (before Preact mounts) to seed
 * signals so the shell paints from real data without a network
 * round-trip. Written debounced after each successful load.
 *
 * Storage is best-effort: read/write errors are swallowed. The cache
 * is never the source of truth; OPFS-SQLite (paid users) and the
 * remote HTTP API (free users) remain authoritative.
 */

import type {
    Feed,
    Item,
    CountsResponse
} from './db/types.js'

const PAINT_CACHE_KEY_PREFIX = 'rsss.paintCache.v1.'
const LAST_SESSION_DID_KEY = 'rsss.lastSessionDid'

const SCHEMA_VERSION = 1 as const

const MAX_FEEDS = 100
const MAX_ITEMS = 200
const MAX_BYTES = 1_000_000

/**
 * FeedSummary is a superset of the design plan's "narrow" shape,
 * intentionally mirroring the full `Feed` interface so direct signal
 * assignment works at hydration without per-record padding logic.
 */
export interface FeedSummary {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_error:string|null
    last_status:number|null
    created_at:string
    updated_at:string
}

/**
 * ItemSummary is a superset of the design plan's "narrow" shape,
 * intentionally mirroring the full `Item` interface so direct signal
 * assignment works at hydration without per-record padding logic.
 * Heavy text fields (description, content, full_content*) are set to `null`.
 */
export interface ItemSummary {
    id:number
    feed_id:number
    guid:string
    title:string|null
    link:string|null
    description:null
    content:null
    author:string|null
    pub_date:string|null
    thumbnail_url:string|null
    og_image_url?:string|null
    blurhash?:string|null
    image_width?:number|null
    image_height?:number|null
    is_read:number
    is_starred:number
    created_at:string
    updated_at:string
    feed_title?:string
    full_content?:null
    full_content_fetched_at?:null
    full_content_status?:null
}

export interface PaintCacheV1 {
    schemaVersion:1
    writtenAt:number
    feeds:FeedSummary[]
    items:ItemSummary[]
    counts:CountsResponse
    selectedFeedId:number|null
}

export type PaintCacheSnapshotInput = Omit<
    PaintCacheV1,
    'schemaVersion'|'writtenAt'
>

function storageKey (did:string):string {
    return PAINT_CACHE_KEY_PREFIX + did
}

function toFeedSummary (feed:Feed):FeedSummary {
    return {
        id: feed.id,
        url: feed.url,
        title: feed.title,
        description: feed.description,
        site_url: feed.site_url,
        last_fetched: feed.last_fetched,
        last_error: feed.last_error,
        last_status: feed.last_status,
        created_at: feed.created_at,
        updated_at: feed.updated_at
    }
}

function toItemSummary (item:Item):ItemSummary {
    return {
        id: item.id,
        feed_id: item.feed_id,
        guid: item.guid,
        title: item.title,
        link: item.link,
        description: null,
        content: null,
        author: item.author,
        pub_date: item.pub_date,
        thumbnail_url: item.thumbnail_url,
        og_image_url: item.og_image_url,
        blurhash: item.blurhash,
        image_width: item.image_width,
        image_height: item.image_height,
        is_read: item.is_read,
        is_starred: item.is_starred,
        created_at: item.created_at,
        updated_at: item.updated_at,
        feed_title: item.feed_title,
        full_content: null,
        full_content_fetched_at: null,
        full_content_status: null
    }
}

/**
 * Convert full Feed[] / Item[] into the narrow summary shapes used by
 * the paint cache. Callers in state.ts produce these from signals.
 */
export function snapshotFromState (
    feeds:Feed[],
    items:Item[],
    counts:CountsResponse,
    selectedFeedId:number|null
):PaintCacheSnapshotInput {
    return {
        feeds: feeds.map(toFeedSummary),
        items: items.map(toItemSummary),
        counts,
        selectedFeedId
    }
}

/**
 * Apply caps (feeds, items, total bytes) before serialization. Items
 * are assumed to be in newest-first order; truncation drops from the
 * tail. Returns the capped snapshot.
 */
function capSnapshot (
    snap:PaintCacheV1
):PaintCacheV1 {
    const cappedFeeds = (
        snap.feeds.length > MAX_FEEDS ?
            snap.feeds.slice(0, MAX_FEEDS) :
            snap.feeds
    )
    let cappedItems = (
        snap.items.length > MAX_ITEMS ?
            snap.items.slice(0, MAX_ITEMS) :
            snap.items
    )

    let candidate:PaintCacheV1 = {
        ...snap,
        feeds: cappedFeeds,
        items: cappedItems
    }
    let serialized = JSON.stringify(candidate)

    // Tail-drop items until we fit under MAX_BYTES. Feeds/counts are
    // small enough that we never need to truncate them, but if the
    // byte cap is exceeded with zero items, the snapshot is written
    // empty rather than skipped.
    while (serialized.length > MAX_BYTES && cappedItems.length > 0) {
        cappedItems = cappedItems.slice(0, cappedItems.length - 1)
        candidate = { ...candidate, items: cappedItems }
        serialized = JSON.stringify(candidate)
    }

    return candidate
}

export function readPaintCache (did:string):PaintCacheV1|null {
    try {
        const raw = localStorage.getItem(storageKey(did))
        if (!raw) return null  // AC2.5: missing key returns null
        const parsed = JSON.parse(raw) as unknown
        if (!isPaintCacheV1(parsed)) return null  // AC2.7 / AC2.6
        return parsed
    } catch {
        return null  // AC2.6: malformed JSON returns null
    }
}

export function writePaintCache (
    did:string,
    snapshot:PaintCacheSnapshotInput
):void {
    try {
        const full:PaintCacheV1 = {
            schemaVersion: SCHEMA_VERSION,
            writtenAt: Date.now(),
            ...snapshot
        }
        const capped = capSnapshot(full)
        localStorage.setItem(
            storageKey(did),
            JSON.stringify(capped)
        )
    } catch {
        // best-effort: swallow quota / serialization errors
    }
}

/**
 * Clear paint cache entries.
 *
 * - `clearPaintCache(did)` removes only that DID's entry. Other DIDs'
 *   entries are preserved (AC6.4).
 * - `clearPaintCache()` removes every `rsss.paintCache.v1.*` key.
 *   Used for migration / forced invalidation.
 */
export function clearPaintCache (did?:string):void {
    try {
        if (did !== undefined) {
            localStorage.removeItem(storageKey(did))
            return
        }
        const toRemove:string[] = []
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i)
            if (k && k.startsWith(PAINT_CACHE_KEY_PREFIX)) {
                toRemove.push(k)
            }
        }
        for (const k of toRemove) localStorage.removeItem(k)
    } catch {
        // best-effort
    }
}

export function getStoredDid ():string|null {
    try {
        return localStorage.getItem(LAST_SESSION_DID_KEY)
    } catch {
        return null
    }
}

export function setStoredDid (did:string):void {
    try {
        localStorage.setItem(LAST_SESSION_DID_KEY, did)
    } catch {
        // best-effort
    }
}

export function clearStoredDid ():void {
    try {
        localStorage.removeItem(LAST_SESSION_DID_KEY)
    } catch {
        // best-effort
    }
}

function isPaintCacheV1 (v:unknown):v is PaintCacheV1 {
    if (typeof v !== 'object' || v === null) return false
    const o = v as Record<string, unknown>
    if (o.schemaVersion !== SCHEMA_VERSION) return false  // AC2.7
    if (typeof o.writtenAt !== 'number') return false
    if (!Array.isArray(o.feeds)) return false
    if (!Array.isArray(o.items)) return false
    if (typeof o.counts !== 'object' || o.counts === null) return false
    if (
        o.selectedFeedId !== null &&
        typeof o.selectedFeedId !== 'number'
    ) {
        return false
    }
    return true
}
