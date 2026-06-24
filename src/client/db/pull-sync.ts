import {
    classifyLocalDbError,
    describeLocalDbError
} from './sqlite-init.js'
import {
    execDb,
    queryDb,
    ensureFeedTerminalStateColumns
} from './local-db.js'
import { cacheItemImages } from './image-cache.js'
import {
    getFeedCachePolicy,
    isContentCachedForPolicy,
    ensureFeedCachePolicyColumns,
    type FeedCachePolicyRow
} from './feed-cache-policy.js'
import {
    setSyncSyncing,
    setSyncDone,
    setSyncError,
    isLocalFirstActive
} from './sync-status.js'
import type { Sqlite3Db } from './sqlite-init.js'

export class SyncBillingError extends Error {
    constructor () {
        super('Sync requires an active subscription')
        this.name = 'SyncBillingError'
    }
}

export class PullSyncAuthError extends Error {
    constructor () {
        super('pullSync: 401 unauthorized -- re-auth required')
        this.name = 'PullSyncAuthError'
    }
}

export interface SyncResponse {
    feeds:Record<string, unknown>[]
    items:Record<string, unknown>[]
    syncedAt:string
    latestUpdatedAt:string
    isFullSync:boolean
    hasMore?:boolean
    nextCursor?:string|null
}

interface PendingOutboxRefs {
    feedIds:Set<number>
    itemIds:Set<number>
    markAllReadFeedIds:Set<number>
    markAllReadAll:boolean
    urls:Set<string>
}

async function getLastPullAt (db:Sqlite3Db):Promise<string|null> {
    await ensureSyncCursorColumn(db)
    const rows = await queryDb<{ last_pull_at:string|null }>(
        db,
        'SELECT last_pull_at FROM sync_meta WHERE id = 1'
    )
    return rows[0]?.last_pull_at ?? null
}

async function setLastPullAt (db:Sqlite3Db, value:string):Promise<void> {
    await ensureSyncCursorColumn(db)
    await execDb(db, {
        sql: `UPDATE sync_meta
              SET last_pull_at = ?, pull_cursor = NULL
              WHERE id = 1`,
        bind: [value]
    })
}

async function getPullCursor (db:Sqlite3Db):Promise<string|null> {
    await ensureSyncCursorColumn(db)
    const rows = await queryDb<{ pull_cursor:string|null }>(
        db,
        'SELECT pull_cursor FROM sync_meta WHERE id = 1'
    )
    return rows[0]?.pull_cursor ?? null
}

async function setPullCursor (
    db:Sqlite3Db,
    value:string|null
):Promise<void> {
    await ensureSyncCursorColumn(db)
    await execDb(db, {
        sql: 'UPDATE sync_meta SET pull_cursor = ? WHERE id = 1',
        bind: [value]
    })
}

const syncCursorColumnReady = new WeakSet<Sqlite3Db>()

async function ensureSyncCursorColumn (db:Sqlite3Db):Promise<void> {
    if (syncCursorColumnReady.has(db)) return

    const cols = await queryDb<{ name:string }>(
        db,
        'PRAGMA table_info(sync_meta)'
    )
    if (!cols.some((col) => col.name === 'pull_cursor')) {
        await execDb(db, 'ALTER TABLE sync_meta ADD COLUMN pull_cursor TEXT')
    }
    syncCursorColumnReady.add(db)
}

const itemFullContentColumnsReady = new WeakSet<Sqlite3Db>()

const itemImageMetadataColumns = [
    ['og_image_url', 'TEXT'],
    ['blurhash', 'TEXT'],
    ['image_width', 'INTEGER'],
    ['image_height', 'INTEGER']
]

export async function ensureItemFullContentColumns (
    db:Sqlite3Db
):Promise<void> {
    if (itemFullContentColumnsReady.has(db)) return

    const cols = await queryDb<{ name:string }>(
        db,
        'PRAGMA table_info(items)'
    )
    const has = (name:string) => cols.some((col) => col.name === name)
    if (!has('full_content')) {
        await execDb(db, 'ALTER TABLE items ADD COLUMN full_content TEXT')
    }
    if (!has('full_content_fetched_at')) {
        await execDb(
            db,
            'ALTER TABLE items ADD COLUMN full_content_fetched_at TEXT'
        )
    }
    if (!has('full_content_status')) {
        await execDb(
            db,
            'ALTER TABLE items ADD COLUMN full_content_status TEXT'
        )
    }
    if (!has('full_content_images')) {
        await execDb(
            db,
            'ALTER TABLE items ADD COLUMN full_content_images TEXT'
        )
    }
    for (const [name, type] of itemImageMetadataColumns) {
        if (!has(name)) {
            await execDb(
                db,
                `ALTER TABLE items ADD COLUMN ${name} ${type}`
            )
        }
    }
    itemFullContentColumnsReady.add(db)
}

async function upsertFeed (
    db:Sqlite3Db,
    feed:Record<string, unknown>
):Promise<void> {
    await ensureFeedTerminalStateColumns(db)
    await execDb(db, {
        sql: `INSERT INTO feeds
            (id, url, title, description, site_url, last_fetched,
             last_pulled_at, last_error, last_status,
             published, published_rkey, published_at, publish_error,
             created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                url = excluded.url,
                title = excluded.title,
                description = excluded.description,
                site_url = excluded.site_url,
                last_fetched = excluded.last_fetched,
                last_pulled_at = excluded.last_pulled_at,
                last_error = excluded.last_error,
                last_status = excluded.last_status,
                published = excluded.published,
                published_rkey = excluded.published_rkey,
                published_at = excluded.published_at,
                publish_error = excluded.publish_error,
                updated_at = excluded.updated_at`,
        bind: [
            feed.id as number,
            feed.url as string,
            (feed.title as string|null) ?? null,
            (feed.description as string|null) ?? null,
            (feed.site_url as string|null) ?? null,
            (feed.last_fetched as string|null) ?? null,
            (feed.last_pulled_at as string|null) ?? null,
            (feed.last_error as string|null) ?? null,
            (feed.last_status as number|null) ?? null,
            (feed.published as number) ?? 0,
            (feed.published_rkey as string|null) ?? null,
            (feed.published_at as string|null) ?? null,
            (feed.publish_error as string|null) ?? null,
            feed.created_at as string,
            feed.updated_at as string
        ]
    })
}

export async function upsertItem (
    db:Sqlite3Db,
    item:Record<string, unknown>,
    keepContent:boolean
):Promise<void> {
    await ensureItemFullContentColumns(db)

    const content = keepContent
        ? (item.content as string|null) ?? null
        : null
    const description = keepContent
        ? (item.description as string|null) ?? null
        : null
    const fullContent = keepContent
        ? (item.full_content as string|null) ?? null
        : null

    const bodySetClause = keepContent ?
        `description = excluded.description,
                content = excluded.content,
                full_content = excluded.full_content,
                full_content_fetched_at = excluded.full_content_fetched_at,
                full_content_status = excluded.full_content_status,
                full_content_images = excluded.full_content_images` :
        `description = COALESCE(description, excluded.description),
                content = COALESCE(content, excluded.content),
                full_content = COALESCE(full_content, excluded.full_content),
                full_content_fetched_at = COALESCE(
                    full_content_fetched_at,
                    excluded.full_content_fetched_at
                ),
                full_content_status = COALESCE(
                    full_content_status,
                    excluded.full_content_status
                ),
                full_content_images = excluded.full_content_images`

    await execDb(db, {
        sql: `INSERT INTO items
            (id, feed_id, guid, title, link, description, content,
             author, pub_date, thumbnail_url, og_image_url, blurhash,
             image_width, image_height, is_read, is_starred, created_at,
             updated_at,
             full_content, full_content_fetched_at, full_content_status,
             full_content_images)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
                    ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                feed_id = excluded.feed_id,
                guid = excluded.guid,
                title = excluded.title,
                link = excluded.link,
                ${bodySetClause},
                author = excluded.author,
                pub_date = excluded.pub_date,
                thumbnail_url = excluded.thumbnail_url,
                og_image_url = excluded.og_image_url,
                blurhash = excluded.blurhash,
                image_width = excluded.image_width,
                image_height = excluded.image_height,
                is_read = excluded.is_read,
                is_starred = excluded.is_starred,
                updated_at = excluded.updated_at`,
        bind: [
            item.id as number,
            item.feed_id as number,
            item.guid as string,
            (item.title as string|null) ?? null,
            (item.link as string|null) ?? null,
            description,
            content,
            (item.author as string|null) ?? null,
            (item.pub_date as string|null) ?? null,
            (item.thumbnail_url as string|null) ?? null,
            (item.og_image_url as string|null) ?? null,
            (item.blurhash as string|null) ?? null,
            (item.image_width as number|null) ?? null,
            (item.image_height as number|null) ?? null,
            (item.is_read as number) ?? 0,
            (item.is_starred as number) ?? 0,
            item.created_at as string,
            item.updated_at as string,
            fullContent,
            (item.full_content_fetched_at as string|null) ?? null,
            (item.full_content_status as string|null) ?? null,
            (item.full_content_images as string|null) ?? null
        ]
    })
}

async function getPendingOutboxRefs (
    db:Sqlite3Db
):Promise<PendingOutboxRefs> {
    const rows = await queryDb<{
        op:string
        target_id:number|null
        payload:string
    }>(
        db,
        `SELECT op, target_id, payload
         FROM outbox
         WHERE op IN (
            'add_feed',
            'delete_feed',
            'update_item',
            'mark_all_read'
         )`
    )

    const refs:PendingOutboxRefs = {
        feedIds: new Set(),
        itemIds: new Set(),
        markAllReadFeedIds: new Set(),
        markAllReadAll: false,
        urls: new Set()
    }

    for (const row of rows) {
        if (
            (row.op === 'add_feed' || row.op === 'delete_feed') &&
            row.target_id !== null
        ) {
            refs.feedIds.add(row.target_id)
        }
        if (row.op === 'add_feed') {
            try {
                const parsed = JSON.parse(row.payload) as {
                    url?:string
                }
                if (parsed.url) {
                    refs.urls.add(parsed.url)
                }
            } catch {
                // ignore malformed payload
            }
        }
        if (row.op === 'update_item' && row.target_id !== null) {
            refs.itemIds.add(row.target_id)
        } else if (row.op === 'mark_all_read') {
            if (row.target_id === null) {
                refs.markAllReadAll = true
            } else {
                refs.markAllReadFeedIds.add(row.target_id)
            }
        }
    }

    return refs
}

function shouldSkipFeed (
    feed:Record<string, unknown>,
    refs:PendingOutboxRefs
):boolean {
    return refs.feedIds.has(feed.id as number) ||
        refs.urls.has(feed.url as string)
}

function shouldSkipItem (
    item:Record<string, unknown>,
    refs:PendingOutboxRefs
):boolean {
    const id = item.id as number
    const feedId = item.feed_id as number
    return (
        refs.itemIds.has(id) ||
        refs.feedIds.has(feedId) ||
        refs.markAllReadAll ||
        refs.markAllReadFeedIds.has(feedId)
    )
}

export interface PullSyncOptions {
    onFeedUpserted?:(count:number)=> void
    onItemUpserted?:(count:number)=> void
    onFeedPage?:(count:number)=> void
    onItemPage?:(count:number)=> void
    trackStatus?:boolean
}

/**
 * Pull changes from the server into the local DB.
 * Reads `lastPullAt` from `sync_meta`; first call omits `since`
 * and treats the response as a full snapshot.
 */
export async function pullSync (
    db:Sqlite3Db,
    fetchFn:typeof fetch = fetch,
    opts:PullSyncOptions = {}
):Promise<void> {
    const trackStatus = opts.trackStatus ?? isLocalFirstActive.value
    if (trackStatus) setSyncSyncing()

    const lastPullAt = await getLastPullAt(db)
    let cursor = await getPullCursor(db)
    // Invariant: getPendingOutboxRefs is called after pushSync resolves.
    const pendingRefs = await getPendingOutboxRefs(db)
    let skippedRows = false
    let done = false

    await ensureFeedCachePolicyColumns(db)

    const policyByFeed = new Map<number, FeedCachePolicyRow|null>()

    async function policyFor (feedId:number):
        Promise<FeedCachePolicyRow|null> {
        if (!policyByFeed.has(feedId)) {
            policyByFeed.set(
                feedId,
                await getFeedCachePolicy(db, feedId)
            )
        }
        return policyByFeed.get(feedId) ?? null
    }

    while (!done) {
        const url = buildSyncUrl(lastPullAt, cursor)
        let res:Response
        try {
            res = await fetchFn(url)
        } catch (err) {
            if (trackStatus) {
                setSyncError(
                    err instanceof Error ? err.message : String(err)
                )
            }
            throw err
        }

        if (res.status === 401) {
            throw new PullSyncAuthError()
        }

        if (res.status === 402) {
            // Subscription required -- swallow silently so the
            // local-only fallback is quiet rather than spammy.
            if (trackStatus) setSyncDone(0)
            throw new SyncBillingError()
        }

        if (!res.ok) {
            const msg = `pullSync: server returned ${res.status}`
            if (trackStatus) setSyncError(msg)
            throw new Error(msg)
        }

        const data = (await res.json()) as SyncResponse

        await execDb(db, 'BEGIN')
        const itemsToCache:Array<Record<string, unknown>> = []
        try {
            let feedCount = 0
            for (const feed of data.feeds) {
                if (shouldSkipFeed(feed, pendingRefs)) {
                    skippedRows = true
                    continue
                }
                let upserted = false
                try {
                    await execDb(db, 'SAVEPOINT feed_upsert')
                    try {
                        await upsertFeed(db, feed)
                        await execDb(db, 'RELEASE feed_upsert')
                        upserted = true
                    } catch (err) {
                        try {
                            await execDb(db, 'ROLLBACK TO feed_upsert')
                        } catch {
                            //  ignore rollback errors
                        }
                        try {
                            await execDb(db, 'RELEASE feed_upsert')
                        } catch {
                            // ignore release errors
                        }
                        // Storage exhaustion is database-wide, not a
                        // per-feed conflict: abort the pull so the quota
                        // failure reaches the sync/bootstrap UI signals.
                        if (classifyLocalDbError(err) === 'quota') {
                            throw err
                        }
                        // url collision (or other per-feed failure): skip this
                        // feed this pull. Mark skippedRows so the cursor is not
                        // advanced — it will be reconciled by push-sync
                        // (optimistic add) or re-pulled next sync.
                        skippedRows = true
                    }
                } catch (err) {
                    // Let the quota rethrow from the inner catch (and
                    // quota failures creating the SAVEPOINT) abort the
                    // pull instead of being skipped like a per-feed
                    // conflict.
                    if (classifyLocalDbError(err) === 'quota') {
                        throw err
                    }
                    // SAVEPOINT creation failed - skip this feed
                    skippedRows = true
                }
                // Run success side-effects only after the savepoint is fully
                // released, so a throwing onFeedUpserted callback is not
                // misattributed to a feed-upsert failure above.
                if (upserted) {
                    feedCount++
                    opts.onFeedUpserted?.(feedCount)
                }
            }
            let itemCount = 0
            for (const item of data.items) {
                if (shouldSkipItem(item, pendingRefs)) {
                    skippedRows = true
                    continue
                }
                const feedId = item.feed_id as number
                const keep = isContentCachedForPolicy(
                    await policyFor(feedId)
                )
                await upsertItem(db, item, keep)
                itemCount++
                opts.onItemUpserted?.(itemCount)
                if (keep) itemsToCache.push(item)
            }

            if (data.hasMore) {
                cursor = data.nextCursor ?? null
                if (!skippedRows) await setPullCursor(db, cursor)
            } else {
                if (skippedRows) {
                    await setPullCursor(db, null)
                } else {
                    await setLastPullAt(db, data.latestUpdatedAt)
                }
                cursor = null
                done = true
            }
            await execDb(db, 'COMMIT')
            opts.onFeedPage?.(feedCount)
            opts.onItemPage?.(itemCount)
        } catch (err) {
            await execDb(db, 'ROLLBACK')
            if (trackStatus) {
                setSyncError(describeLocalDbError(err))
            }
            throw err
        }

        if (itemsToCache.length > 0) {
            for (const item of itemsToCache) {
                const feedId = item.feed_id as number
                const policy = await policyFor(feedId)
                try {
                    await cacheItemImages(
                        db,
                        item as {
                            id?:number|null
                            feed_id:number
                            content?:string|null
                            description?:string|null
                        },
                        policy
                    )
                } catch (err) {
                    console.error(
                        '[pull-sync] image cache error',
                        err instanceof Error ? err.message : ''
                    )
                }
            }
        }
    }

    if (trackStatus) setSyncDone(0)
}

function buildSyncUrl (since:string|null, cursor:string|null):string {
    const params = new URLSearchParams()
    if (since) params.set('since', since)
    if (cursor) params.set('cursor', cursor)

    const qs = params.toString()
    return qs ? `/api/sync?${qs}` : '/api/sync'
}
