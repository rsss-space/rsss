import { DurableObject } from 'cloudflare:workers'
import { XMLParser } from 'fast-xml-parser'
import { Hono } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import {
    TABLES_SQL,
    INDEXES_SQL,
    TRIGGERS_SQL,
    DEAD_LETTER_OUTBOX_SQL,
    USER_STATE_SQL,
    GRAPH_FOLLOWS_SQL,
    ALL_FULL_CONTENT_STATUSES,
    type FullContentStatus,
    isSuccessStatus,
    FETCH_FULL_MIN_INTERVAL_MS
} from '../../shared/schema.js'
import { itemRouteCandidates } from '../../shared/item-route.js'
import {
    clampClientUpdatedAt,
    resolveLwwWrite
} from '../../shared/lww.js'
import {
    FeedFetchError,
    fetchFeedText,
    fetchOgImage,
    validateFeedUrl
} from '../feed-fetch.js'
import {
    deleteRecord,
    putRecord,
    createRecord
} from '../auth/pds-write-client.js'
import { reportError } from '../lib/report-error.js'
import {
    feedSubscriptionLexicon,
    graphFollowLexicon,
    type FeedSubscriptionRecord,
    type GraphFollowRecord
} from '../../shared/lexicons/index.js'
import {
    subscriptionRkeyForFeedUrl,
    canonicalizeFeedUrl
} from '../../shared/subscription-rkey.js'
import { fetchFullArticle } from '../article-fetch.js'
import {
    blurhashCacheKey,
    parseBlurhashCacheEntry,
    type BlurhashJob
} from '../blurhash.js'
import { isPrefetchEligible } from '../article-prefetch-eligible.js'
import { type ArticleFetchJob } from '../article-fetch-job.js'
import {
    mergeFullContentImage,
    parseImageMap
} from '../full-content-images.js'
import { enqueueBodyBlurJobs } from '../blurhash-body-enqueue.js'
import type {
    OAuthCredentialRecord
} from '../auth/oauth.js'

export interface Env {
    USER:DurableObjectNamespace<RsssUserDO>
    SESSIONS:KVNamespace
    BLURHASH_KV:KVNamespace
    BLURHASH_QUEUE:Queue
    ARTICLE_FETCH_QUEUE:Queue
    ASSETS:Fetcher
    AUTUMN_SECRET_KEY?:string
    AUTUMN_DISABLED?:string
    NODE_ENV?:string
    SENTRY_DSN?:string
}

interface Feed {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_error:string|null
    last_status:number|null
    published:number
    published_rkey:string|null
    published_at:string|null
    publish_error:string|null
    created_at:string
    updated_at:string
}

type XmlValue = string | number | boolean | null | XmlObject | XmlValue[]

interface XmlObject {
    [key:string]:XmlValue
}

interface ParsedFeedItem {
    guid:string | null
    title:string | null
    link:string | null
    description:string | null
    content:string | null
    author:string | null
    pubDate:string | null
    imageUrl:string | null
}

interface ParsedFeed {
    title:string | null
    description:string | null
    link:string | null
    isTooLarge:boolean
    items:ParsedFeedItem[]
}

interface NewFeedItem {
    id:number
    link:string | null
    imageUrl:string | null
}

interface ListedSubscriptionRecord {
    uri:string
    value:unknown
}

interface ListedSubscriptionResponse {
    cursor?:unknown
    records?:unknown
}

interface RemoteSubscription {
    rkey:string
    createdAt:string|null
}

const FEED_XML_PARSER = new XMLParser({
    attributeNamePrefix: '@_',
    cdataPropName: '#cdata',
    ignoreAttributes: false,
    textNodeName: '#text',
    trimValues: true
})
const FEED_REFRESH_CONCURRENCY = 8
const MAX_RECORD_PAGES = 50 // cap pagination to prevent stalled cursors
const OG_IMAGE_FETCH_CONCURRENCY = 4
const OG_IMAGE_FETCH_BUDGET_MS = 10_000
const FEED_REFRESH_INTERVAL_MS = 60 * 60 * 1000
// Application-level WebSocket keepalive. The client sends LIVE_PING on a
// timer; the runtime answers LIVE_PONG via setWebSocketAutoResponse
// WITHOUT waking the hibernated DO, refreshing the idle timer so
// Cloudflare does not reap the connection.
const LIVE_PING = JSON.stringify({ type: 'ping' })
const LIVE_PONG = JSON.stringify({ type: 'pong' })
const FEED_BACKOFF_MULTIPLIER = 2
const FEED_BACKOFF_CEILING_MS = 24 * 60 * 60 * 1000
const ACCOUNT_INACTIVITY_THRESHOLD_MS = 3 * 24 * 60 * 60 * 1000
const ACTIVITY_MARKER_COALESCE_MS = 60 * 1000
const MANUAL_REFRESH_LIMIT_MS = 60 * 1000
const MANUAL_REFRESH_STORAGE_PREFIX = 'manual_refresh:'
const PUBLISH_RECONCILE_INTERVAL_MS = 15 * 60 * 1000
const PUBLISH_RECONCILE_LAST_KEY = 'publish_reconcile:last_attempt'
const ALARM_REFRESH_CURSOR_KEY = 'alarm_refresh_cursor'
const PENDING_DELETION_KEY = 'pending_deletion'
const MIGRATION_STATE_KEY = 'schema_migration'
const USER_DO_MIGRATION_VERSION = 8
const FEEDS_UPDATED_AT_BUMP_KEY = 'feeds_updated_at_bump_for_last_pulled_at'
const SYNC_PAGE_LIMIT = 500
const FETCH_FULL_THROTTLE_PREFIX = 'fetch_full:'
const OAUTH_CREDENTIALS_KEY = 'oauth:credentials'
const MAX_PARSED_FEED_ITEMS = 1000
const MAX_FEED_TITLE_LENGTH = 8 * 1024
const MAX_FEED_DESCRIPTION_LENGTH = 64 * 1024
const MAX_FEED_CONTENT_LENGTH = 1024 * 1024
const FEED_TOO_LARGE_ERROR = 'feed too large'
const FEED_TOO_LARGE_STATUS = 413
export const RESOLVE_WINDOW_MS = 30_000
export const POST_HYBRID_WAIT_MS = 3000
export const RESOLVE_TIMEOUT_ERROR = 'Initial fetch did not complete'
const FEED_SYNC_COLUMNS = `
    id, url, title, description, site_url, last_fetched, last_pulled_at,
    last_error, last_status, published, published_rkey, published_at,
    publish_error, created_at, updated_at
`
const ITEM_COLUMNS = `
    items.id, items.feed_id, items.guid, items.title, items.link,
    items.description, items.content, items.author, items.pub_date,
    items.thumbnail_url, items.og_image_url, items.blurhash,
    items.image_width, items.image_height, items.is_read,
    items.is_starred, items.created_at, items.updated_at,
    items.full_content, items.full_content_fetched_at,
    items.full_content_status,
    items.full_content_images
`
const ITEM_SYNC_COLUMNS = `
    ${ITEM_COLUMNS},
    feeds.title AS feed_title
`

// True when the stored body blur map already holds at least one entry.
// Reuses parseImageMap so a null/whitespace/malformed/`{}` value counts as
// empty and lazy-fill proceeds; any real entry makes lazy-fill skip.
function hasBodyBlurMap (value:unknown):boolean {
    if (typeof value !== 'string') return false
    return Object.keys(parseImageMap(value)).length > 0
}

function errorMessage (err:unknown):string {
    return err instanceof Error ? err.message : String(err)
}

function isDuplicateInsertError (err:unknown):boolean {
    const message = errorMessage(err).toLowerCase()

    return message.includes('sqlite_constraint_unique') ||
        message.includes('unique constraint failed')
}

function isObjectRecord (value:unknown):value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function isOAuthCredentialRecord (
    value:unknown
):value is OAuthCredentialRecord {
    if (!isObjectRecord(value)) return false
    if (typeof value.did !== 'string') return false
    if (typeof value.accessToken !== 'string') return false
    if (typeof value.refreshToken !== 'string') return false
    if (typeof value.tokenEndpoint !== 'string') return false
    if (typeof value.pdsEndpoint !== 'string') return false
    if (typeof value.updatedAt !== 'string') return false
    if (!isObjectRecord(value.dpopPrivateKeyJwk)) return false
    if (
        value.tokenType !== undefined &&
        typeof value.tokenType !== 'string'
    ) {
        return false
    }
    if (
        value.accessTokenExpiresAt !== undefined &&
        typeof value.accessTokenExpiresAt !== 'number'
    ) {
        return false
    }

    return true
}

interface MigrationState {
    migration_v?:number
}

interface AlarmRefreshCursor {
    last_feed_id?:number
}

interface PendingDeletion {
    scheduledFor:number
    did:string
}

interface ManualRefreshState {
    last_manual_refresh_at?:number
}

interface ManualRefreshLimit {
    retryAfterSeconds:number
}

interface FetchFullThrottleState {
    last_attempt_at?:number
}

interface FetchFullThrottleLimit {
    retryAfterSeconds:number
}

const POLL_FEED_KEY_PREFIX = 'poll:feed:'
const POLL_ACCOUNT_LAST_ACTIVE_AT_KEY = 'poll:account:last_active_at'
const POLL_ACCOUNT_LAST_ANY_SUCCESS_AT_KEY =
    'poll:account:last_any_success_at'

interface PollerFeedState {
    etag?:string
    lastModified?:string
    consecutiveFailures:number
    lastAttemptAt?:number
    lastSuccessfulAt?:number
    nextDueAt:number
}

interface AccountActivityMarker {
    lastActiveAt:number
}

function pollFeedKey (feedId:number):string {
    return `${POLL_FEED_KEY_PREFIX}${feedId}`
}

function fetchFullThrottleKey (itemId:number):string {
    return `${FETCH_FULL_THROTTLE_PREFIX}${itemId}`
}

function fetchFullRetryAfterSeconds (
    attemptedAt:number,
    now:number
):number {
    const remainingMs = FETCH_FULL_MIN_INTERVAL_MS - (now - attemptedAt)
    return Math.max(1, Math.ceil(remainingMs / 1000))
}

type SyncRowKind = 'feed' | 'item'

interface SyncCursor {
    updated_at:string
    id:number
    kind:SyncRowKind
}

interface SyncRow {
    kind:SyncRowKind
    row:Record<string, unknown>
    updated_at:string
    id:number
}

function encodeSyncCursor (row:SyncRow):string {
    return JSON.stringify({
        updated_at: row.updated_at,
        id: row.id,
        kind: row.kind
    })
}

function parseSyncCursor (value:string|undefined):SyncCursor|null {
    if (!value) return null

    try {
        const parsed = JSON.parse(value) as Partial<SyncCursor>
        if (
            typeof parsed.updated_at === 'string' &&
            typeof parsed.id === 'number' &&
            (parsed.kind === 'feed' || parsed.kind === 'item')
        ) {
            return {
                updated_at: parsed.updated_at,
                id: parsed.id,
                kind: parsed.kind
            }
        }
    } catch {
        return null
    }

    return null
}

function normalizeSyncLimit (value:string|undefined):number {
    const parsed = value ? Number(value) : SYNC_PAGE_LIMIT
    if (!Number.isFinite(parsed) || parsed < 1) return SYNC_PAGE_LIMIT
    return Math.min(Math.floor(parsed), SYNC_PAGE_LIMIT)
}

function syncRowCompare (a:SyncRow, b:SyncRow):number {
    if (a.updated_at !== b.updated_at) {
        return a.updated_at < b.updated_at ? -1 : 1
    }
    if (a.id !== b.id) return a.id - b.id
    return a.kind.localeCompare(b.kind)
}

function syncCursorWhere (
    cursor:SyncCursor|null,
    since:string|undefined,
    tableName:string,
    kind:SyncRowKind
):{ sql:string; bind:unknown[] } {
    const conditions:string[] = []
    const bind:unknown[] = []

    if (since) {
        conditions.push(`${tableName}.updated_at > ?`)
        bind.push(since)
    }

    if (cursor) {
        conditions.push(`(
            ${tableName}.updated_at > ? OR (
                ${tableName}.updated_at = ? AND (
                    ${tableName}.id > ? OR (
                        ${tableName}.id = ? AND ? > ?
                    )
                )
            )
        )`)
        bind.push(
            cursor.updated_at,
            cursor.updated_at,
            cursor.id,
            cursor.id,
            kind,
            cursor.kind
        )
    }

    return {
        sql: conditions.length > 0
            ? `WHERE ${conditions.join(' AND ')}`
            : 'WHERE 1 = 1',
        bind
    }
}

function lwwClientUpdatedAt (value:string|undefined):string|undefined {
    if (value === undefined) return undefined

    const result = clampClientUpdatedAt(value)
    if (result.wasClamped) {
        console.warn('[DO] Clamped client_updated_at', {
            client_updated_at: value,
            clamped_client_updated_at: result.clientUpdatedAt
        })
    }

    return result.clientUpdatedAt
}

function manualRefreshStorageKey (feedId:number):string {
    return `${MANUAL_REFRESH_STORAGE_PREFIX}${feedId}`
}

function isRecentManualRefresh (
    refreshedAt:number|undefined,
    now:number
):boolean {
    return typeof refreshedAt === 'number' &&
        Number.isFinite(refreshedAt) &&
        now - refreshedAt < MANUAL_REFRESH_LIMIT_MS
}

function manualRefreshRetryAfterSeconds (
    refreshedAt:number,
    now:number
):number {
    const remainingMs = MANUAL_REFRESH_LIMIT_MS - (now - refreshedAt)
    return Math.max(1, Math.ceil(remainingMs / 1000))
}

/**
 * Store feeds and items for a single user.
 * Each user gets their own DO with its own SQLite database.
 *
 * Uses the Hibernation API:
 * - DO hibernates between requests to minimize cost
 * - Uses alarms for periodic feed polling (every 60 min); the alarm
 *   stops re-arming once the account is idle past
 *   ACCOUNT_INACTIVITY_THRESHOLD_MS so an idle DO incurs zero request
 *   cost, and is re-armed on the user's next request.
 * - State persists in SQLite across hibernation cycles
 */

// Parse and validate a numeric id parameter.
// Returns null if the id is not finite, <= 0, or noncanonical.
function parseIdParam (raw:string):number|null {
    const id = Number.parseInt(raw, 10)
    if (!Number.isFinite(id) || id <= 0 || String(id) !== raw) return null
    return id
}

// Parse and validate a query param (e.g., limit, offset).
// Returns null if the param is not finite or negative.
function parseNonNegativeInt (raw:string):number|null {
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0 || String(n) !== raw) return null
    return n
}

export class RsssUserDO extends DurableObject<Env> {
    private app: Hono
    private sql: SqlStorage
    private manualRefreshClaims?:Map<number, number>

    constructor (ctx: DurableObjectState, env: Env) {
        super(ctx, env)
        this.sql = ctx.storage.sql
        this.app = this.createRouter()

        // Keepalive handled entirely by the runtime: matching pings are
        // answered without dispatching to webSocketMessage, so the DO
        // can stay hibernated while clients are connected.
        ctx.setWebSocketAutoResponse(
            new WebSocketRequestResponsePair(LIVE_PING, LIVE_PONG)
        )

        ctx.blockConcurrencyWhile(async () => {
            await this.initDatabase()

            // Schedule initial alarm if none exists
            // This wakes the DO periodically to refresh feeds
            const currentAlarm = await ctx.storage.getAlarm()
            if (!currentAlarm) {
                // Set first alarm one refresh interval from now
                await ctx.storage.setAlarm(
                    Date.now() + FEED_REFRESH_INTERVAL_MS
                )
            }
        })
    }

    private async initDatabase () {
        this.sql.exec('PRAGMA foreign_keys = ON;')

        // 1. Create tables (shared schema)
        this.sql.exec(TABLES_SQL)

        // 2. Server-only migrations: backfill columns on rows that existed
        // before those columns were added.
        // Must run after table creation but before updated_at indexes.
        const migrationState = await this.ctx.storage.get<MigrationState>(
            MIGRATION_STATE_KEY
        )
        if (migrationState?.migration_v !== USER_DO_MIGRATION_VERSION) {
            this.migrateAddUpdatedAt()
            this.migrateAddFeedFailureColumns()
            this.migrateAddItemThumbnail()
            this.migrateAddItemImageMetadata()
            this.migrateAddLastPulledAt()
            this.migrateAddFeedPublishState()
            this.migrateAddItemFullContent()
            this.migrateAddFullContentImages()
            await this.ctx.storage.put(MIGRATION_STATE_KEY, {
                migration_v: USER_DO_MIGRATION_VERSION
            })
        }

        // One-time bump: re-emit every feed row to clients so they
        // pick up the newly-projected `last_pulled_at` column.
        // Guarded by its own storage key so it runs at most once
        // per RsssUserDO regardless of the schema migration version.
        // Persist the guard flag BEFORE the UPDATE: if the DO cold-starts
        // between the UPDATE and put, the flag is already set, so the
        // UPDATE will not re-run on the next instantiation. This trades
        // a missed one-time bump (harmless: feeds were already bumped once)
        // for never re-bumping (the harmful case, which forces spurious
        // full resyncs on every cold start until redeployed).
        const feedsBumpDone = await this.ctx.storage.get<boolean>(
            FEEDS_UPDATED_AT_BUMP_KEY
        )
        if (!feedsBumpDone) {
            await this.ctx.storage.put(FEEDS_UPDATED_AT_BUMP_KEY, true)
            this.sql.exec(
                "UPDATE feeds SET updated_at = datetime('now')"
            )
        }

        // 3. Create indexes and triggers (shared schema) - idempotent
        this.sql.exec(INDEXES_SQL)
        this.sql.exec(TRIGGERS_SQL)
        this.sql.exec(DEAD_LETTER_OUTBOX_SQL)
        this.sql.exec(USER_STATE_SQL)
        this.sql.exec(GRAPH_FOLLOWS_SQL)
    }

    /**
     * Migration: Add updated_at column to existing tables
     */
    private migrateAddUpdatedAt () {
        // Check if feeds has updated_at
        const feedsCols = this.sql.exec('PRAGMA table_info(feeds)').toArray()
        const feedsHasUpdatedAt = feedsCols.some((col: unknown) =>
            (col as { name: string }).name === 'updated_at'
        )
        if (!feedsHasUpdatedAt) {
            // SQLite doesn't allow non-constant defaults in ALTER TABLE
            this.sql.exec('ALTER TABLE feeds ADD COLUMN updated_at TEXT')
            this.sql.exec('UPDATE feeds SET updated_at = ' +
                "COALESCE(created_at, datetime('now'))")
        }

        // Check if items has updated_at
        const itemsCols = this.sql.exec('PRAGMA table_info(items)').toArray()
        const itemsHasUpdatedAt = itemsCols.some((col: unknown) =>
            (col as { name: string }).name === 'updated_at'
        )
        if (!itemsHasUpdatedAt) {
            // SQLite doesn't allow non-constant defaults in ALTER TABLE
            this.sql.exec('ALTER TABLE items ADD COLUMN updated_at TEXT')
            this.sql.exec('UPDATE items SET updated_at = COALESCE(created_at, ' +
                " datetime('now'))")
        }
    }

    private migrateAddFeedFailureColumns () {
        const columns = this.sql.exec('PRAGMA table_info(feeds)').toArray()
        const hasLastError = columns.some((col: unknown) =>
            (col as { name:string }).name === 'last_error'
        )
        const hasLastStatus = columns.some((col: unknown) =>
            (col as { name:string }).name === 'last_status'
        )

        if (!hasLastError) {
            this.sql.exec('ALTER TABLE feeds ADD COLUMN last_error TEXT')
        }
        if (!hasLastStatus) {
            this.sql.exec('ALTER TABLE feeds ADD COLUMN last_status INTEGER')
        }
    }

    private migrateAddItemThumbnail () {
        const columns = this.sql.exec('PRAGMA table_info(items)').toArray()
        const hasThumbnailUrl = columns.some((col: unknown) =>
            (col as { name:string }).name === 'thumbnail_url'
        )

        if (!hasThumbnailUrl) {
            this.sql.exec('ALTER TABLE items ADD COLUMN thumbnail_url TEXT')
        }
    }

    private migrateAddItemFullContent () {
        const cols = this.sql.exec('PRAGMA table_info(items)').toArray()
        const has = (name:string) => cols.some(
            (col:unknown) => (col as { name:string }).name === name
        )
        if (!has('full_content')) {
            this.sql.exec(
                'ALTER TABLE items ADD COLUMN full_content TEXT'
            )
        }
        if (!has('full_content_fetched_at')) {
            this.sql.exec(
                'ALTER TABLE items ADD COLUMN full_content_fetched_at TEXT'
            )
        }
        if (!has('full_content_status')) {
            this.sql.exec(
                'ALTER TABLE items ADD COLUMN full_content_status TEXT'
            )
        }
    }

    private migrateAddFullContentImages () {
        const cols = this.sql.exec('PRAGMA table_info(items)').toArray()
        const has = (name:string) => cols.some(
            (col:unknown) => (col as { name:string }).name === name
        )
        if (!has('full_content_images')) {
            this.sql.exec(
                'ALTER TABLE items ADD COLUMN full_content_images TEXT'
            )
        }
    }

    private migrateAddItemImageMetadata () {
        const cols = this.sql.exec('PRAGMA table_info(items)').toArray()
        const has = (name:string) => cols.some(
            (col:unknown) => (col as { name:string }).name === name
        )
        const columns = [
            ['og_image_url', 'TEXT'],
            ['blurhash', 'TEXT'],
            ['image_width', 'INTEGER'],
            ['image_height', 'INTEGER']
        ]

        for (const [name, type] of columns) {
            if (!has(name)) {
                this.sql.exec(
                    `ALTER TABLE items ADD COLUMN ${name} ${type}`
                )
            }
        }
    }

    private migrateAddLastPulledAt () {
        const columns = this.sql.exec(
            'PRAGMA table_info(feeds)'
        ).toArray()
        const hasLastPulledAt = columns.some((col: unknown) =>
            (col as { name:string }).name === 'last_pulled_at'
        )

        if (!hasLastPulledAt) {
            this.sql.exec(
                'ALTER TABLE feeds ADD COLUMN last_pulled_at TEXT'
            )
            this.sql.exec(`
                UPDATE feeds SET last_pulled_at = (
                    SELECT MAX(pub_date) FROM items
                    WHERE items.feed_id = feeds.id
                    AND pub_date IS NOT NULL
                )
            `)
        }
    }

    private migrateAddFeedPublishState () {
        const cols = this.sql.exec('PRAGMA table_info(feeds)').toArray()
        const has = (name:string) => cols.some(
            (col:unknown) => (col as { name:string }).name === name
        )
        const columns = [
            ['published', 'INTEGER NOT NULL DEFAULT 0'],
            ['published_rkey', 'TEXT'],
            ['published_at', 'TEXT'],
            ['publish_error', 'TEXT']
        ]

        for (const [name, type] of columns) {
            if (!has(name)) {
                this.sql.exec(
                    `ALTER TABLE feeds ADD COLUMN ${name} ${type}`
                )
            }
        }
    }

    getFeedsWithUpdates ():string[] {
        const rows = this.sql.exec(`
            SELECT feeds.id FROM feeds
            WHERE EXISTS (
                SELECT 1 FROM items
                WHERE items.feed_id = feeds.id
                AND (
                    feeds.last_pulled_at IS NULL
                    OR items.pub_date > feeds.last_pulled_at
                )
            )
        `).toArray() as Array<{ id:number }>
        return rows.map(r => String(r.id))
    }

    getFeedUpdateCounts ():Record<string, number> {
        const rows = this.sql.exec(`
            SELECT
                feeds.id AS id,
                COUNT(items.id) AS pending_count
            FROM feeds
            LEFT JOIN items
                ON items.feed_id = feeds.id
                AND items.pub_date IS NOT NULL
                AND (
                    feeds.last_pulled_at IS NULL
                    OR items.pub_date > feeds.last_pulled_at
                )
            GROUP BY feeds.id
        `).toArray() as Array<{
            id:number|string
            pending_count:number|string|null
        }>

        return rows.reduce<Record<string, number>>((counts, row) => {
            counts[String(row.id)] = Number(row.pending_count ?? 0)
            return counts
        }, {})
    }

    private advanceFeedCursor (feedId:number):void {
        this.sql.exec(
            `UPDATE feeds SET last_pulled_at = (
                SELECT MAX(pub_date) FROM items
                WHERE feed_id = ? AND pub_date IS NOT NULL
            ) WHERE id = ?`,
            feedId,
            feedId
        )
        const stillUnsynced = this.getFeedsWithUpdates()
            .includes(String(feedId))
        if (!stillUnsynced) {
            this.broadcast('feed-updates-cleared', {
                feedIds: [String(feedId)]
            })
        }
    }

    private async getOAuthCredentials ():
        Promise<OAuthCredentialRecord | null> {
        const credentials = await this.ctx.storage.get<unknown>(
            OAUTH_CREDENTIALS_KEY
        )

        return isOAuthCredentialRecord(credentials) ? credentials : null
    }

    private async persistOAuthCredentials (
        credentials:OAuthCredentialRecord
    ):Promise<void> {
        await this.ctx.storage.put(OAUTH_CREDENTIALS_KEY, credentials)
    }

    private buildFeedSubscriptionRecord (
        feed:Feed,
        createdAt:string
    ):FeedSubscriptionRecord {
        return {
            feedUrl: canonicalizeFeedUrl(feed.url),
            createdAt,
            ...(feed.title ? { title: feed.title } : {}),
            ...(feed.site_url ? { siteUrl: feed.site_url } : {})
        }
    }

    private async shouldRunPublishReconcile ():Promise<boolean> {
        const last = await this.ctx.storage.get<number>(
            PUBLISH_RECONCILE_LAST_KEY
        )
        const now = Date.now()

        if (
            typeof last === 'number' &&
            now - last < PUBLISH_RECONCILE_INTERVAL_MS
        ) {
            return false
        }

        await this.ctx.storage.put(PUBLISH_RECONCILE_LAST_KEY, now)
        return true
    }

    private listRecordsUrl (
        credentials:OAuthCredentialRecord,
        cursor?:string
    ):string {
        const base = credentials.pdsEndpoint.endsWith('/') ?
            credentials.pdsEndpoint :
            `${credentials.pdsEndpoint}/`
        const url = new URL('xrpc/com.atproto.repo.listRecords', base)

        url.searchParams.set('repo', credentials.did)
        url.searchParams.set('collection', feedSubscriptionLexicon.id)
        url.searchParams.set('limit', '100')
        if (cursor) url.searchParams.set('cursor', cursor)

        return url.href
    }

    private parseSubscriptionRkey (uri:string):string|null {
        const parts = uri.split('/')
        return parts.length > 0 ? parts[parts.length - 1] || null : null
    }

    private isListedSubscriptionRecord (
        value:unknown
    ):value is ListedSubscriptionRecord {
        if (typeof value !== 'object' || value === null) return false
        if (Array.isArray(value)) return false

        const record = value as Partial<ListedSubscriptionRecord>
        return typeof record.uri === 'string'
    }

    private subscriptionFromRecord (
        record:ListedSubscriptionRecord
    ): { feedUrl:string; subscription:RemoteSubscription } | null {
        if (typeof record.value !== 'object' || record.value === null) {
            return null
        }
        if (Array.isArray(record.value)) return null

        const value = record.value as Partial<FeedSubscriptionRecord>
        const rkey = this.parseSubscriptionRkey(record.uri)
        if (!rkey || typeof value.feedUrl !== 'string') return null

        return {
            feedUrl: value.feedUrl,
            subscription: {
                rkey,
                createdAt: typeof value.createdAt === 'string' ?
                    value.createdAt :
                    null
            }
        }
    }

    private async listRemoteSubscriptions (
        credentials:OAuthCredentialRecord
    ):Promise<Map<string, RemoteSubscription>> {
        const subscriptions = new Map<string, RemoteSubscription>()
        let cursor:string|undefined
        let pageCount = 0

        do {
            // Cap pagination to prevent stalled cursors (AC7.5)
            if (pageCount >= MAX_RECORD_PAGES) {
                reportError(
                    new Error(
                        'Pagination cap reached while listing AT Protocol records'
                    ),
                    'list-remote-subscriptions-max-pages',
                    { did: credentials.did, pageCount }
                )
                break
            }

            const response = await fetch(this.listRecordsUrl(
                credentials,
                cursor
            ))
            if (!response.ok) {
                throw new Error('Could not list AT Protocol records')
            }

            const body = await response.json<ListedSubscriptionResponse>()
            const records = Array.isArray(body.records) ?
                body.records :
                []

            pageCount++

            const newCursor = typeof body.cursor === 'string' ?
                body.cursor :
                undefined

            // Cursor-stall detection: bail if cursor unchanged (AC7.5)
            if (newCursor && newCursor === cursor) {
                reportError(
                    new Error('Cursor stall detected in listRemoteSubscriptions'),
                    'list-remote-subscriptions-cursor-stall',
                    { did: credentials.did, cursor: newCursor }
                )
                break
            }

            for (const rawRecord of records) {
                if (!this.isListedSubscriptionRecord(rawRecord)) continue

                const remote = this.subscriptionFromRecord(rawRecord)
                if (remote) {
                    subscriptions.set(
                        canonicalizeFeedUrl(remote.feedUrl),
                        remote.subscription
                    )
                }
            }

            cursor = newCursor
        } while (cursor)

        return subscriptions
    }

    private async reconcilePublishedFeeds ():Promise<{
        ok:true
        changed:number
        skipped?:string
    } | {
        ok:false
        error:string
    }> {
        const credentials = await this.getOAuthCredentials()
        if (!credentials) {
            return {
                ok: true,
                changed: 0,
                skipped: 'missing_credentials'
            }
        }

        if (!await this.shouldRunPublishReconcile()) {
            return {
                ok: true,
                changed: 0,
                skipped: 'rate_limited'
            }
        }

        let remoteByUrl:Map<string, RemoteSubscription>
        try {
            remoteByUrl = await this.listRemoteSubscriptions(credentials)
        } catch {
            return {
                ok: false,
                error: 'pds_list_failed'
            }
        }

        const feeds = this.sql.exec(
            'SELECT * FROM feeds'
        ).toArray() as unknown as Feed[]
        let changed = 0

        for (const feed of feeds) {
            const remote = remoteByUrl.get(canonicalizeFeedUrl(feed.url))

            if (remote) {
                const publishedAt = remote.createdAt ??
                    feed.published_at ??
                    new Date().toISOString()
                if (
                    !feed.published ||
                    feed.published_rkey !== remote.rkey ||
                    feed.published_at !== publishedAt ||
                    feed.publish_error
                ) {
                    this.sql.exec(
                        `UPDATE feeds SET
                            published = 1,
                            published_rkey = ?,
                            published_at = ?,
                            publish_error = NULL
                        WHERE id = ?`,
                        remote.rkey,
                        publishedAt,
                        feed.id
                    )
                    changed += 1
                }
                continue
            }

            if (feed.published || feed.published_rkey) {
                this.sql.exec(
                    `UPDATE feeds SET
                        published = 0,
                        published_rkey = NULL,
                        published_at = NULL,
                        publish_error = NULL
                    WHERE id = ?`,
                    feed.id
                )
                changed += 1
            }
        }

        if (changed > 0) this.bumpFeedVersion()

        return { ok: true, changed }
    }

    private async publishFeed (feed:Feed):Promise<
        | { ok:true; feed:Record<string, unknown> | null }
        | { ok:false; status:ContentfulStatusCode; error:string }
    > {
        const credentials = await this.getOAuthCredentials()
        if (!credentials) {
            return {
                ok: false,
                status: 401,
                error: 'reauth_required'
            }
        }

        const rkey = feed.published_rkey ??
            await subscriptionRkeyForFeedUrl(feed.url)
        const publishedAt = feed.published_at ?? new Date().toISOString()
        const record = this.buildFeedSubscriptionRecord(feed, publishedAt)
        const result = await putRecord(credentials, {
            collection: feedSubscriptionLexicon.id,
            rkey,
            record,
            validate: true
        }, {
            persistCredentials: async nextCredentials => {
                await this.persistOAuthCredentials(nextCredentials)
            }
        })

        if (!result.ok) {
            this.sql.exec(
                `UPDATE feeds SET
                    publish_error = ?
                WHERE id = ?`,
                result.error.code,
                feed.id
            )
            this.bumpFeedVersion()
            return {
                ok: false,
                status: result.error.code === 'reauth_required' ?
                    401 :
                    502,
                error: result.error.code
            }
        }

        this.sql.exec(
            `UPDATE feeds SET
                published = 1,
                published_rkey = ?,
                published_at = ?,
                publish_error = NULL
            WHERE id = ?`,
            rkey,
            publishedAt,
            feed.id
        )
        this.bumpFeedVersion()

        const updated = this.sql.exec(
            `SELECT ${FEED_SYNC_COLUMNS}
             FROM feeds WHERE id = ?`,
            feed.id
        ).toArray()[0] as Record<string, unknown> | undefined ?? null

        return { ok: true, feed: updated }
    }

    private async unpublishFeed (feed:Feed):Promise<
        | { ok:true; feed:Record<string, unknown> | null }
        | { ok:false; status:ContentfulStatusCode; error:string }
    > {
        if (!feed.published && !feed.published_rkey) {
            return {
                ok: true,
                feed: this.sql.exec(
                    `SELECT ${FEED_SYNC_COLUMNS}
                     FROM feeds WHERE id = ?`,
                    feed.id
                ).toArray()[0] as Record<string, unknown> | undefined ?? null
            }
        }

        const credentials = await this.getOAuthCredentials()
        if (!credentials) {
            return {
                ok: false,
                status: 401,
                error: 'reauth_required'
            }
        }

        const rkey = feed.published_rkey ??
            await subscriptionRkeyForFeedUrl(feed.url)
        const result = await deleteRecord(credentials, {
            collection: feedSubscriptionLexicon.id,
            rkey
        }, {
            persistCredentials: async nextCredentials => {
                await this.persistOAuthCredentials(nextCredentials)
            }
        })

        if (!result.ok) {
            this.sql.exec(
                `UPDATE feeds SET
                    publish_error = ?
                WHERE id = ?`,
                result.error.code,
                feed.id
            )
            this.bumpFeedVersion()
            return {
                ok: false,
                status: result.error.code === 'reauth_required' ?
                    401 :
                    502,
                error: result.error.code
            }
        }

        this.sql.exec(
            `UPDATE feeds SET
                published = 0,
                published_rkey = NULL,
                published_at = NULL,
                publish_error = NULL
            WHERE id = ?`,
            feed.id
        )
        this.bumpFeedVersion()

        const updated = this.sql.exec(
            `SELECT ${FEED_SYNC_COLUMNS}
             FROM feeds WHERE id = ?`,
            feed.id
        ).toArray()[0] as Record<string, unknown> | undefined ?? null

        return { ok: true, feed: updated }
    }

    private async followUser (targetDid:string):Promise<
        | { ok:true; alreadyFollowing:boolean }
        | { ok:false; status:ContentfulStatusCode; error:string }
    > {
        const existing = this.sql.exec(
            'SELECT rkey FROM graph_follows WHERE subject_did = ?',
            targetDid
        ).toArray()[0] as { rkey:string } | undefined ?? null

        if (existing) {
            return { ok: true, alreadyFollowing: true }
        }

        const credentials = await this.getOAuthCredentials()
        if (!credentials) {
            return { ok: false, status: 401, error: 'reauth_required' }
        }

        const record:GraphFollowRecord = {
            subject: targetDid,
            createdAt: new Date().toISOString()
        }

        const result = await createRecord(credentials, {
            collection: graphFollowLexicon.id,
            record
        }, {
            persistCredentials: async nextCredentials => {
                await this.persistOAuthCredentials(nextCredentials)
            }
        })

        if (!result.ok) {
            return {
                ok: false,
                status: result.error.code === 'reauth_required' ?
                    401 :
                    502,
                error: result.error.code
            }
        }

        const body = result.body as Record<string, unknown>
        const uri = typeof body.uri === 'string' ? body.uri : ''
        const rkey = uri.split('/').pop() ?? ''

        this.sql.exec(
            `INSERT INTO graph_follows (subject_did, rkey)
             VALUES (?, ?)`,
            targetDid,
            rkey
        )

        return { ok: true, alreadyFollowing: false }
    }

    private async unfollowUser (targetDid:string):Promise<
        | { ok:true }
        | { ok:false; status:ContentfulStatusCode; error:string }
    > {
        const existing = this.sql.exec(
            'SELECT rkey FROM graph_follows WHERE subject_did = ?',
            targetDid
        ).toArray()[0] as { rkey:string } | undefined ?? null

        if (!existing) {
            return { ok: true }
        }

        const credentials = await this.getOAuthCredentials()
        if (!credentials) {
            return { ok: false, status: 401, error: 'reauth_required' }
        }

        const result = await deleteRecord(credentials, {
            collection: graphFollowLexicon.id,
            rkey: existing.rkey
        }, {
            persistCredentials: async nextCredentials => {
                await this.persistOAuthCredentials(nextCredentials)
            }
        })

        if (!result.ok) {
            return {
                ok: false,
                status: result.error.code === 'reauth_required' ?
                    401 :
                    502,
                error: result.error.code
            }
        }

        this.sql.exec(
            'DELETE FROM graph_follows WHERE subject_did = ?',
            targetDid
        )

        return { ok: true }
    }

    private createRouter (): Hono {
        const app = new Hono()

        // Health check
        app.get('/health', (c) => {
            return c.json({ status: 'ok', service: 'do' })
        })

        app.put('/internal/oauth/credentials', async (c) => {
            const body = await c.req.json<unknown>()
            if (!isOAuthCredentialRecord(body)) {
                return c.json({ error: 'Invalid OAuth credentials' }, 400)
            }

            await this.ctx.storage.put(OAUTH_CREDENTIALS_KEY, body)

            return new Response(null, { status: 204 })
        })

        app.post('/internal/blurhash/items/:id', async (c) => {
            const id = Number(c.req.param('id'))
            const body = await c.req.json<{
                blurhash?:unknown
                image_width?:unknown
                image_height?:unknown
            }>()

            if (!Number.isInteger(id) || id < 1) {
                return c.json({ error: 'Invalid item id' }, 400)
            }
            if (
                typeof body.blurhash !== 'string' ||
                typeof body.image_width !== 'number' ||
                typeof body.image_height !== 'number'
            ) {
                return c.json({ error: 'Invalid blurhash metadata' }, 400)
            }

            this.sql.exec(
                `UPDATE items SET
                    blurhash = ?,
                    image_width = ?,
                    image_height = ?
                WHERE id = ?`,
                body.blurhash,
                body.image_width,
                body.image_height,
                id
            )
            this.bumpFeedVersion()

            return new Response(null, { status: 204 })
        })

        app.post('/internal/full-content/items/:id', async (c) => {
            const id = Number(c.req.param('id'))
            if (!Number.isInteger(id) || id < 1) {
                return c.json({ error: 'Invalid item id' }, 400)
            }

            const body = await c.req.json<{
                html?:unknown
                fetchedAt?:unknown
                status?:unknown
            }>()

            if (
                typeof body.status !== 'string' ||
                !ALL_FULL_CONTENT_STATUSES.includes(
                    body.status as FullContentStatus
                )
            ) {
                return c.json({ error: 'Invalid status' }, 400)
            }

            if (
                typeof body.html === 'string' &&
                body.html.length > 0
            ) {
                const fetchedAt = typeof body.fetchedAt === 'string' ?
                    body.fetchedAt :
                    new Date().toISOString()
                this.sql.exec(
                    'UPDATE items SET full_content = ?, ' +
                    'full_content_fetched_at = ?, ' +
                    'full_content_status = ? WHERE id = ?',
                    body.html,
                    fetchedAt,
                    body.status,
                    id
                )
            } else {
                this.sql.exec(
                    'UPDATE items SET ' +
                    "full_content_fetched_at = datetime('now'), " +
                    'full_content_status = ? WHERE id = ?',
                    body.status,
                    id
                )
            }
            this.bumpFeedVersion()

            return new Response(null, { status: 204 })
        })

        app.post('/internal/blurhash/body-items/:id', async (c) => {
            const id = Number(c.req.param('id'))
            if (!Number.isInteger(id) || id < 1) {
                return c.json({ error: 'Invalid item id' }, 400)
            }

            const body = await c.req.json<{
                url?:unknown
                blurhash?:unknown
                width?:unknown
                height?:unknown
            }>()

            if (
                typeof body.url !== 'string' ||
                typeof body.blurhash !== 'string' ||
                typeof body.width !== 'number' ||
                typeof body.height !== 'number'
            ) {
                return c.json({ error: 'Invalid body image metadata' }, 400)
            }

            const row = this.sql.exec(
                'SELECT full_content_images FROM items WHERE id = ?',
                id
            ).toArray()[0] as { full_content_images:string|null } | undefined ?? null

            if (!row) {
                return c.json({ error: 'Item not found' }, 404)
            }

            const merged = mergeFullContentImage(
                row.full_content_images,
                body.url,
                {
                    blurhash: body.blurhash,
                    width: body.width,
                    height: body.height
                }
            )

            this.sql.exec(
                'UPDATE items SET full_content_images = ? WHERE id = ?',
                merged,
                id
            )
            this.bumpFeedVersion()

            return new Response(null, { status: 204 })
        })

        app.get('/internal/feed-version', (c) => {
            return c.json({ version: this.getFeedVersion() })
        })

        app.get('/internal/lazy-html-data', (c) => {
            const version = this.getFeedVersion()
            const items = this.sql.exec(
                `SELECT ${ITEM_SYNC_COLUMNS} ` +
                'FROM items JOIN feeds ON items.feed_id = feeds.id ' +
                'ORDER BY items.pub_date DESC, items.id DESC LIMIT 50'
            ).toArray()

            const feeds = this.sql.exec(
                'SELECT * FROM feeds ORDER BY title ASC'
            ).toArray()

            const unreadRow = this.sql.exec(
                'SELECT COUNT(*) as count FROM items WHERE is_read = 0'
            ).one() as { count:number } // guaranteed single row: COUNT(*)
            const starredRow = this.sql.exec(
                'SELECT COUNT(*) as count FROM items WHERE is_starred = 1'
            ).one() as { count:number } // guaranteed single row: COUNT(*)
            const totalRow = this.sql.exec(
                'SELECT COUNT(*) as count FROM items'
            ).one() as { count:number } // guaranteed single row: COUNT(*)
            const perFeedRows = this.sql.exec(
                'SELECT feed_id, COUNT(*) as unread FROM items' +
                ' WHERE is_read = 0 GROUP BY feed_id'
            ).toArray() as { feed_id:number; unread:number }[]
            const perFeed:Record<string, number> = {}
            for (const row of perFeedRows) {
                perFeed[String(row.feed_id)] = row.unread
            }

            const counts = {
                unread: unreadRow.count,
                starred: starredRow.count,
                total: totalRow.count,
                perFeed
            }

            return c.json({ version, items, feeds, counts })
        })

        // Hibernatable WebSocket live channel. Replaces SSE: the DO can
        // hibernate between broadcasts because getWebSockets() (not an
        // in-memory Set) tracks live connections. Auth is enforced by
        // the Worker proxy (requireAuth) before the upgrade reaches here.
        app.get('/ws', (c) => {
            if (c.req.header('Upgrade') !== 'websocket') {
                return c.text('Expected WebSocket upgrade', 426)
            }
            const pair = new WebSocketPair()
            const client = pair[0]
            const server = pair[1]
            this.ctx.acceptWebSocket(server)
            return new Response(null, { status: 101, webSocket: client })
        })

        // Server-vs-client divergence indicator. Single round-trip
        // source for the header "n updates / up to date" pill (see
        // specs/008-fix-up-to-date-dot/contracts/feed-status-endpoint.md).
        // Mounted under the same `/api` proxy as `/feeds`, so it
        // inherits `requireAuth` from `dataRouter` without
        // `requireEntitlement` — free users must reach this endpoint.
        app.get('/feed-status', async (c) => {
            const feedUpdateCounts = this.getFeedUpdateCounts()
            const totalPending = Object.values(feedUpdateCounts)
                .reduce((sum, count) => sum + count, 0)
            await this.maybeKickCatchUp(Date.now())
            return c.json({ feedUpdateCounts, totalPending })
        })

        // List all feeds
        app.get('/feeds', (c) => {
            this.ctx.waitUntil(
                this.reconcilePublishedFeeds().catch(() => undefined)
            )
            const feeds = this.sql.exec(
                'SELECT * FROM feeds ORDER BY title ASC'
            ).toArray()
            const feedsWithUpdates = this.getFeedsWithUpdates()
            const feedUpdateStatus = feedsWithUpdates.length > 0 ?
                'updates' :
                'synced'
            const feedUpdateCounts = this.getFeedUpdateCounts()
            return c.json({
                feeds,
                feedUpdateStatus,
                feedsWithUpdates,
                feedUpdateCounts
            })
        })

        app.post('/feeds/reconcile-published', async (c) => {
            const result = await this.reconcilePublishedFeeds()
            if (!result.ok) {
                return c.json({ error: result.error }, 502)
            }

            return c.json({
                changed: result.changed,
                skipped: result.skipped
            })
        })

        // Add a new feed
        app.post('/feeds', async (c) => {
            const body = await c.req.json<{
                url:string
                client_op_id?:string
                client_updated_at?:string
            }>()
            const clientUpdatedAt = lwwClientUpdatedAt(
                body.client_updated_at
            )
            console.log('[DO] POST /feeds', body.url)

            if (!body.url) {
                return c.json(
                    { error: 'URL is required' },
                    400
                )
            }

            try {
                body.url = await validateFeedUrl(body.url)
            } catch (_err) {
                const err = _err as FeedFetchError
                return c.json(
                    { error: err.message },
                    err.status as ContentfulStatusCode
                )
            }

            try {
                // Check if feed already exists
                const existing = this.sql.exec(
                    'SELECT id FROM feeds WHERE url = ?',
                    body.url
                ).toArray()

                if (existing.length > 0) {
                    console.log(
                        '[DO] Feed already exists:',
                        body.url
                    )
                    const existingFeed = this.sql.exec(
                        'SELECT * FROM feeds WHERE url = ?',
                        body.url
                    ).toArray()[0] as Record<string, unknown> | undefined ?? null
                    if (
                        clientUpdatedAt !== undefined &&
                        existingFeed
                    ) {
                        if (body.client_op_id !== undefined) {
                            return c.json({ feed: existingFeed })
                        }
                        const serverTs = existingFeed.updated_at as string|null
                        if (
                            resolveLwwWrite(serverTs, clientUpdatedAt) ===
                            'conflict'
                        ) {
                            return c.json({ feed: existingFeed }, 409)
                        }
                    }
                    return c.json(
                        { error: 'Feed already exists' },
                        409
                    )
                }

                // Insert the feed
                this.sql.exec(
                    'INSERT INTO feeds (url) VALUES (?)',
                    body.url
                )
                console.log(
                    '[DO] Inserted feed:',
                    body.url
                )

                const feed = this.sql.exec(
                    'SELECT * FROM feeds WHERE url = ?',
                    body.url
                ).toArray()[0] ?? null
                console.log(
                    '[DO] Feed row:',
                    JSON.stringify(feed)
                )

                // Pull the alarm forward so the sweep runs within
                // RESOLVE_WINDOW_MS even if the waitUntil fetch is
                // dropped (research Decision 4).
                const targetAt = Date.now() + RESOLVE_WINDOW_MS
                const existingAlarm = await this.ctx.storage.getAlarm()
                const newAlarm = existingAlarm == null ?
                    targetAt :
                    Math.min(existingAlarm, targetAt)
                await this.ctx.storage.setAlarm(newAlarm)

                // Race fetch against a 3s window via the awaitFetchOrTimeout
                // helper. Both outcomes converge on "re-read the row +
                // compute unread + respond". On timeout we also push the in-
                // flight promise to waitUntil so the fetch completes in the
                // background.

                const fetchPromise = this.fetchFeed(feed as unknown as Feed)
                const winner = await this.awaitFetchOrTimeout(
                    fetchPromise,
                    POST_HYBRID_WAIT_MS
                )

                let respondedFeed = feed
                if (winner === 'done') {
                    const updated = this.sql.exec(
                        'SELECT * FROM feeds WHERE id = ?',
                        (feed as { id:number }).id
                    ).toArray()[0] ?? null
                    if (updated) {
                        respondedFeed = updated
                    }
                } else {
                    // 3s elapsed; let the fetch finish in the background so the
                    // alarm + live channel + Phase 1 convergence pipeline can
                    // deliver terminal state to the client.
                    this.ctx.waitUntil(fetchPromise.catch(() => undefined))
                }

                const unread = this.getFeedUnreadCount(
                    (respondedFeed as { id:number }).id
                )

                return c.json({ feed: respondedFeed, unread }, 201)
            } catch (_err) {
                const err = _err as Error
                console.error(
                    '[DO] Error adding feed:',
                    err.message,
                    err.stack
                )
                return c.json(
                    { error: 'Failed to add feed' },
                    500
                )
            }
        })

        // Get a specific feed
        app.get('/feeds/:id', (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const feed = this.sql.exec('SELECT * FROM feeds WHERE id = ?', id).toArray()[0] ?? null

            if (!feed) {
                return c.json({ error: 'Feed not found' }, 404)
            }

            return c.json({ feed })
        })

        // Pending items for a feed (not yet pulled past last_pulled_at)
        app.get('/feeds/:id/pending', (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const rows = this.sql.exec(
                `SELECT CAST(id AS TEXT) AS id,
                    COALESCE(title, '') AS title,
                    pub_date AS published_at
                FROM items
                WHERE feed_id = ?
                  AND pub_date IS NOT NULL
                  AND pub_date > COALESCE(
                    (SELECT last_pulled_at FROM feeds WHERE id = ?),
                    '1970-01-01'
                  )
                ORDER BY pub_date DESC
                LIMIT 50`,
                id,
                id
            ).toArray() as Array<{
                id:string
                title:string
                published_at:string
            }>
            return c.json({ items: rows })
        })

        app.post('/feeds/:id/publish', async (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const feed = this.sql.exec(
                'SELECT * FROM feeds WHERE id = ?',
                id
            ).toArray()[0] as unknown as Feed | undefined ?? null

            if (!feed) {
                return c.json({ error: 'Feed not found' }, 404)
            }

            const result = await this.publishFeed(feed)
            if (!result.ok) {
                return c.json(
                    { error: result.error },
                    result.status
                )
            }

            return c.json({ feed: result.feed })
        })

        app.delete('/feeds/:id/publish', async (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const feed = this.sql.exec(
                'SELECT * FROM feeds WHERE id = ?',
                id
            ).toArray()[0] as unknown as Feed | undefined ?? null

            if (!feed) {
                return c.json({ error: 'Feed not found' }, 404)
            }

            const result = await this.unpublishFeed(feed)
            if (!result.ok) {
                return c.json(
                    { error: result.error },
                    result.status
                )
            }

            return c.json({ feed: result.feed })
        })

        // Delete a feed
        app.delete('/feeds/:id', async (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const body:{
                client_op_id?:string
                client_updated_at?:string
            } = await c.req.json<{
                client_op_id?:string
                client_updated_at?:string
            }>().catch(() => ({}))
            const clientUpdatedAt = lwwClientUpdatedAt(
                body.client_updated_at
            )

            const feed = this.sql.exec(
                'SELECT * FROM feeds WHERE id = ?', id
            ).toArray()[0] as unknown as Feed | undefined ?? null
            if (!feed) {
                if (body.client_op_id !== undefined) {
                    return c.json({ success: true })
                }
                return c.json({ error: 'Feed not found' }, 404)
            }

            if (clientUpdatedAt !== undefined) {
                const serverTs = feed.updated_at
                if (
                    resolveLwwWrite(serverTs, clientUpdatedAt) ===
                    'conflict'
                ) {
                    return c.json({ feed }, 409)
                }
            }

            const unpublish = await this.unpublishFeed(feed)
            if (!unpublish.ok) {
                return c.json(
                    { error: unpublish.error },
                    unpublish.status
                )
            }

            this.sql.exec('DELETE FROM feeds WHERE id = ?', id)
            await this.deletePollerFeedState(id)
            return c.json({ success: true })
        })

        // Refresh a specific feed
        app.post('/feeds/:id/refresh', async (c) => {
            const id = parseInt(c.req.param('id'), 10)
            const feed = this.sql.exec('SELECT * FROM feeds WHERE id = ?', id).toArray()[0] as unknown as Feed | undefined ?? null

            if (!feed) {
                return c.json({ error: 'Feed not found' }, 404)
            }

            const limit = await this.claimManualFeedRefresh(feed.id)
            if (limit) {
                const response = c.json({
                    error: 'Feed refresh rate limited'
                }, 429)
                response.headers.set(
                    'Retry-After',
                    String(limit.retryAfterSeconds)
                )
                return response
            }

            try {
                await validateFeedUrl(feed.url)
                await this.fetchFeed(feed)
                this.advanceFeedCursor(feed.id)
            } catch (_err) {
                const err = _err as FeedFetchError
                return c.json(
                    { error: err.message },
                    err.status as ContentfulStatusCode
                )
            }
            const refreshed = this.sql.exec(
                `SELECT ${FEED_SYNC_COLUMNS}
                 FROM feeds WHERE id = ?`,
                feed.id
            ).toArray()[0] as Record<string, unknown> | undefined ?? null
            return c.json({ feed: refreshed })
        })

        // Refresh all feeds. Kick fetches off in waitUntil and
        // return immediately - clients see per-feed completion via
        // the live channel (`feed-updated`) and the whole-batch
        // completion via `refresh-complete`.
        app.post('/feeds/refresh', (c) => {
            const feeds = this.sql.exec('SELECT * FROM feeds')
                .toArray() as unknown as Feed[]

            this.ctx.waitUntil((async () => {
                await this.runFeedPool(feeds, async feed => {
                    await this.fetchFeed(feed)
                    this.advanceFeedCursor(feed.id)
                })
                this.broadcast('refresh-complete', {
                    refreshed: feeds.length
                })
            })())

            return c.json({ success: true, queued: feeds.length })
        })

        // List items with optional filters
        app.get('/items', (c) => {
            const feedId = c.req.query('feed_id')
            const isRead = c.req.query('is_read')
            const isStarred = c.req.query('is_starred')
            const limitParam = c.req.query('limit') || '50'
            const offsetParam = c.req.query('offset') || '0'
            const limit = parseNonNegativeInt(limitParam)
            const offset = parseNonNegativeInt(offsetParam)
            if (limit === null || offset === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }

            // Reading-list cursor filter: only items whose feed has been
            // refreshed at least once and whose pub_date is at-or-before
            // that cursor are visible. Items with NULL pub_date are
            // admitted unconditionally so they cannot become invisible.
            const cursorPredicate =
                ' AND (' +
                ' items.pub_date IS NULL' +
                ' OR (' +
                ' feeds.last_pulled_at IS NOT NULL' +
                ' AND items.pub_date <= feeds.last_pulled_at' +
                ' )' +
                ' )'

            let query = `SELECT ${ITEM_SYNC_COLUMNS} ` +
                'FROM items JOIN feeds ON items.feed_id = feeds.id WHERE 1=1' +
                cursorPredicate
            const params: (string | number)[] = []

            if (feedId) {
                const parsedFeedId = parseIdParam(feedId)
                if (parsedFeedId === null) {
                    return c.json({ error: 'invalid_id' }, 400)
                }
                query += ' AND items.feed_id = ?'
                params.push(parsedFeedId)
            }

            if (isRead !== undefined) {
                query += ' AND items.is_read = ?'
                params.push(isRead === 'true' ? 1 : 0)
            }

            if (isStarred !== undefined) {
                query += ' AND items.is_starred = ?'
                params.push(isStarred === 'true' ? 1 : 0)
            }

            query += ' ORDER BY items.pub_date DESC, items.created_at DESC' +
                ' LIMIT ? OFFSET ?'
            params.push(limit, offset)

            const items = this.sql.exec(query, ...params).toArray()

            // Get total count -- mirror the cursor predicate so
            // pagination totals match the visible page.
            let countQuery = 'SELECT COUNT(*) as count FROM items' +
                ' JOIN feeds ON items.feed_id = feeds.id WHERE 1=1' +
                cursorPredicate
            const countParams: (string | number)[] = []

            if (feedId) {
                // feedId already validated above; reuse result if present
                countQuery += ' AND items.feed_id = ?'
                // We already validated feedId above in the first feedId block
                const parsedFeedId = parseIdParam(feedId)
                if (parsedFeedId === null) {
                    return c.json({ error: 'invalid_id' }, 400)
                }
                countParams.push(parsedFeedId)
            }
            if (isRead !== undefined) {
                countQuery += ' AND items.is_read = ?'
                countParams.push(isRead === 'true' ? 1 : 0)
            }
            if (isStarred !== undefined) {
                countQuery += ' AND items.is_starred = ?'
                countParams.push(isStarred === 'true' ? 1 : 0)
            }

            const countResult = this.sql.exec(countQuery, ...countParams).one() as { count: number } // guaranteed single row: COUNT(*)

            return c.json({
                items,
                total: countResult.count,
                limit,
                offset
            })
        })

        // Get unread count
        app.get('/items/by-route', (c) => {
            const route = c.req.query('route')
            if (!route) {
                return c.json(
                    { error: 'Route is required' },
                    400
                )
            }

            const routeCandidates = itemRouteCandidates(route)
            if (routeCandidates.length === 0) {
                return c.json(
                    { error: 'Route is required' },
                    400
                )
            }

            const routeQuery = routeCandidates
                .map(() => 'items.link = ?')
                .join(' OR ')

            const item = this.sql.exec(
                `SELECT ${ITEM_SYNC_COLUMNS}
                 FROM items
                 JOIN feeds ON items.feed_id = feeds.id
                 WHERE items.link IS NOT NULL
                 AND (${routeQuery})
                 ORDER BY items.pub_date DESC, items.created_at DESC
                 LIMIT 1`,
                ...routeCandidates
            ).toArray()[0] ?? null

            if (!item) {
                return c.json({ error: 'Item not found' }, 404)
            }

            return c.json({ item })
        })

        app.get('/items/count', (c) => {
            const unread = this.sql.exec('SELECT COUNT(*) as count FROM items WHERE is_read = 0').one() as { count: number } // guaranteed single row: COUNT(*)
            const starred = this.sql.exec('SELECT COUNT(*) as count FROM items WHERE is_starred = 1').one() as { count: number } // guaranteed single row: COUNT(*)
            const total = this.sql.exec('SELECT COUNT(*) as count FROM items').one() as { count: number } // guaranteed single row: COUNT(*)
            const perFeedRows = this.sql.exec(
                'SELECT feed_id, COUNT(*) as unread FROM items' +
                ' WHERE is_read = 0 GROUP BY feed_id'
            ).toArray() as { feed_id:number; unread:number }[]
            const perFeed:Record<string, number> = {}
            for (const row of perFeedRows) {
                perFeed[String(row.feed_id)] = row.unread
            }

            return c.json({
                unread: unread.count,
                starred: starred.count,
                total: total.count,
                perFeed
            })
        })

        // Mark item as read/unread
        app.patch('/items/:id', async (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }
            const body = await c.req.json<{
                is_read?:boolean
                is_starred?:boolean
                client_updated_at?:string
            }>()
            const clientUpdatedAt = lwwClientUpdatedAt(
                body.client_updated_at
            )

            const item = this.sql.exec(
                `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, id
            ).toArray()[0] as Record<string, unknown> | undefined ?? null
            if (!item) {
                return c.json({ error: 'Item not found' }, 404)
            }

            if (clientUpdatedAt !== undefined) {
                const serverTs = item.updated_at as string | null
                if (
                    resolveLwwWrite(serverTs, clientUpdatedAt) ===
                    'conflict'
                ) {
                    return c.json({ item }, 409)
                }
            }

            if (body.is_read !== undefined) {
                this.sql.exec(
                    'UPDATE items SET is_read = ? WHERE id = ?',
                    body.is_read ? 1 : 0, id
                )
            }

            if (body.is_starred !== undefined) {
                this.sql.exec(
                    'UPDATE items SET is_starred = ? WHERE id = ?',
                    body.is_starred ? 1 : 0, id
                )
            }

            const updated = this.sql.exec(
                `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, id
            ).toArray()[0] ?? null
            return c.json({ item: updated })
        })

        // Mark all items as read
        app.post('/items/mark-all-read', async (c) => {
            const body:{
                feed_id?:number
                client_updated_at?:string
            } = await c.req.json<{
                feed_id?:number
                client_updated_at?:string
            }>().catch(() => ({ feed_id: undefined }))
            const clientUpdatedAt = lwwClientUpdatedAt(
                body.client_updated_at
            )

            if (clientUpdatedAt !== undefined) {
                // LWW: check if any items in scope are newer than client
                let newerItems:unknown[]
                if (body.feed_id !== undefined) {
                    newerItems = this.sql.exec(
                        `SELECT ${ITEM_COLUMNS} FROM items ` +
                        'WHERE feed_id = ?' +
                        ' AND updated_at > ?',
                        body.feed_id,
                        clientUpdatedAt
                    ).toArray()
                } else {
                    newerItems = this.sql.exec(
                        `SELECT ${ITEM_COLUMNS} FROM items ` +
                        'WHERE updated_at > ?',
                        clientUpdatedAt
                    ).toArray()
                }
                if (newerItems.length > 0) {
                    return c.json({ items: newerItems }, 409)
                }
            }

            if (body.feed_id !== undefined) {
                this.sql.exec(
                    'UPDATE items SET is_read = 1 WHERE feed_id = ?',
                    body.feed_id
                )
            } else {
                this.sql.exec('UPDATE items SET is_read = 1')
            }

            return c.json({ success: true })
        })

        // Sync endpoint - returns all data changed since a timestamp
        app.get('/sync', (c) => {
            const since = c.req.query('since')
            const cursor = parseSyncCursor(c.req.query('cursor'))
            const limit = normalizeSyncLimit(c.req.query('limit'))
            const feedWhere = syncCursorWhere(cursor, since, 'feeds', 'feed')
            const itemWhere = syncCursorWhere(cursor, since, 'items', 'item')

            const feedsPage = this.sql.exec(
                `SELECT ${FEED_SYNC_COLUMNS}
                 FROM feeds
                 ${feedWhere.sql}
                 ORDER BY updated_at ASC, id ASC
                 LIMIT ?`,
                ...feedWhere.bind,
                limit + 1
            ).toArray() as Record<string, unknown>[]

            const itemsPage = this.sql.exec(
                `SELECT ${ITEM_SYNC_COLUMNS}
                 FROM items
                 JOIN feeds ON items.feed_id = feeds.id
                 ${itemWhere.sql}
                 ORDER BY items.updated_at ASC, items.id ASC
                 LIMIT ?`,
                ...itemWhere.bind,
                limit + 1
            ).toArray() as Record<string, unknown>[]

            const combinedRows:SyncRow[] = [
                ...feedsPage.map((row) => ({
                    kind: 'feed' as const,
                    row,
                    updated_at: row.updated_at as string,
                    id: row.id as number
                })),
                ...itemsPage.map((row) => ({
                    kind: 'item' as const,
                    row,
                    updated_at: row.updated_at as string,
                    id: row.id as number
                }))
            ].sort(syncRowCompare)

            const pageRows = combinedRows.slice(0, limit)
            const hasMore = combinedRows.length > limit
            const nextCursor = hasMore && pageRows.length > 0
                ? encodeSyncCursor(pageRows[pageRows.length - 1])
                : null
            const feeds = pageRows
                .filter((row) => row.kind === 'feed')
                .map((row) => row.row)
            const items = pageRows
                .filter((row) => row.kind === 'item')
                .map((row) => row.row)

            // Get the latest updated_at timestamp for the client to store
            const latestFeed = this.sql.exec(
                'SELECT MAX(updated_at) as latest FROM feeds'
            ).one() as { latest: string | null } // guaranteed single row: MAX()
            const latestItem = this.sql.exec(
                'SELECT MAX(updated_at) as latest FROM items'
            ).one() as { latest: string | null } // guaranteed single row: MAX()

            // Use SQLite-compatible format so string
            // comparisons work for incremental sync.
            // SQLite datetime('now') => '2026-02-10 00:08:00'
            // JS toISOString()       => '2026-02-10T00:08:00.000Z'
            // Space < 'T' in ASCII, which breaks `>` queries.
            const syncedAt = new Date()
                .toISOString()
                .replace('T', ' ')
                .replace('Z', '')
                .split('.')[0]
            const latestUpdatedAt = [
                latestFeed?.latest,
                latestItem?.latest
            ]
                .filter(Boolean)
                .sort()
                .pop() || syncedAt

            return c.json({
                feeds,
                items,
                hasMore,
                nextCursor,
                syncedAt,
                latestUpdatedAt,
                isFullSync: !since
            })
        })

        // Fetch the full article body for an item (on-demand). Returns
        // the row after the attempt completed; the caller distinguishes
        // success vs failure by inspecting full_content_status.
        app.post('/items/:id/fetch-full', async (c) => {
            const id = parseIdParam(c.req.param('id'))
            if (id === null) {
                return c.json({ error: 'invalid_id' }, 400)
            }

            let body:{ force?:boolean } = {}
            const text = await c.req.text()
            if (text) {
                try {
                    body = JSON.parse(text) as { force?:boolean }
                    if (typeof body !== 'object' || body === null) {
                        return c.json({ error: 'invalid_body' }, 400)
                    }
                } catch {
                    return c.json({ error: 'invalid_body' }, 400)
                }
            }
            const force = body.force === true

            const item = this.sql.exec(
                `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, id
            ).toArray()[0] as Record<string, unknown> | undefined ?? null
            if (!item) {
                return c.json({ error: 'Item not found' }, 404)
            }

            const link = (item.link as string|null) || ''
            if (!link) {
                return c.json({ error: 'item_has_no_link' }, 409)
            }

            // Cache hit: row already has content (succeeded or partial) and
            // force not set.
            if (
                !force &&
                isSuccessStatus(item.full_content_status as string|null) &&
                typeof item.full_content === 'string' &&
                item.full_content.length > 0
            ) {
                // Lazy-fill: a previously-fetched body whose blur map is
                // still empty enqueues body blur jobs from the stored HTML
                // on this open. Best-effort — never fail the cache-hit
                // response. Self-limiting: once the consumer writes any map
                // entry back, later opens see a non-empty map and skip.
                const fullContent = item.full_content
                const env:Env|undefined = this.env
                if (
                    env?.BLURHASH_QUEUE &&
                    !hasBodyBlurMap(item.full_content_images)
                ) {
                    try {
                        await enqueueBodyBlurJobs(
                            env.BLURHASH_QUEUE,
                            fullContent,
                            id,
                            this.ctx.id.toString()
                        )
                    } catch (err) {
                        console.error(
                            'body blur enqueue failed (lazy):', err
                        )
                    }
                }
                return c.json({ item })
            }

            if (!force) {
                const limit = await this.claimFetchFullAttempt(id)
                if (limit) {
                    const response = c.json({
                        error: 'fetch_full_throttled'
                    }, 429)
                    response.headers.set(
                        'Retry-After',
                        String(limit.retryAfterSeconds)
                    )
                    return response
                }
            }

            const result = await this.doFetchFullArticle(link)
            if (!ALL_FULL_CONTENT_STATUSES.includes(result.status)) {
                // Defensive: should never happen.
                return c.json({ error: 'invalid_status' }, 500)
            }

            if ('html' in result) {
                this.sql.exec(
                    'UPDATE items SET full_content = ?, ' +
                    'full_content_fetched_at = ?, ' +
                    'full_content_status = ? WHERE id = ?',
                    result.html,
                    result.fetchedAt,
                    result.status,
                    id
                )

                // Fresh fetch: enqueue body blur jobs for the newly-stored
                // HTML. Best-effort — a queue failure must never fail the
                // fetch-full response.
                if (result.html) {
                    const env:Env|undefined = this.env
                    if (env?.BLURHASH_QUEUE) {
                        try {
                            await enqueueBodyBlurJobs(
                                env.BLURHASH_QUEUE,
                                result.html,
                                id,
                                this.ctx.id.toString()
                            )
                        } catch (err) {
                            console.error(
                                'body blur enqueue failed (fetch):', err
                            )
                        }
                    }
                }
            } else {
                // Preserve any prior full_content on failure.
                this.sql.exec(
                    'UPDATE items SET ' +
                    "full_content_fetched_at = datetime('now'), " +
                    'full_content_status = ? WHERE id = ?',
                    result.status,
                    id
                )
            }

            const updated = this.sql.exec(
                `SELECT ${ITEM_COLUMNS} FROM items WHERE id = ?`, id
            ).toArray()[0] ?? null
            return c.json({ item: updated })
        })

        app.get('/internal/account/deletion', async (c) => {
            const pending = await this.ctx.storage.get<PendingDeletion>(
                PENDING_DELETION_KEY
            )
            return c.json({
                pendingDeletion: pending ?
                    { scheduledFor: pending.scheduledFor } :
                    null
            })
        })

        app.post('/internal/account/deletion', async (c) => {
            const body = await c.req.json<{
                scheduledFor?:number;
                did?:string
            }>().catch(() => ({} as {
                scheduledFor?:number;
                did?:string
            }))
            const scheduledFor = Number(body.scheduledFor)
            const did = typeof body.did === 'string' ? body.did : ''
            if (!Number.isFinite(scheduledFor) || !did) {
                return c.json({ error: 'invalid_body' }, 400)
            }

            const record:PendingDeletion = { scheduledFor, did }
            await this.ctx.storage.put(PENDING_DELETION_KEY, record)

            // If the deletion is already due, run it on the next alarm
            // tick by setting an immediate alarm.
            if (scheduledFor <= Date.now()) {
                await this.ctx.storage.setAlarm(Date.now())
            }

            return c.json({ scheduledFor })
        })

        app.delete('/internal/account/deletion', async (c) => {
            await this.ctx.storage.delete(PENDING_DELETION_KEY)
            return c.json({ ok: true })
        })

        app.get('/graph/following', (c) => {
            const rows = this.sql.exec(
                'SELECT subject_did FROM graph_follows ORDER BY rowid'
            ).toArray() as Array<{ subject_did:string }>
            return c.json({ dids: rows.map(r => r.subject_did) })
        })

        app.get('/graph/follow/:targetDid', (c) => {
            const targetDid = c.req.param('targetDid')
            const row = this.sql.exec(
                'SELECT rkey FROM graph_follows WHERE subject_did = ?',
                targetDid
            ).toArray()[0] ?? null
            return c.json({ following: row !== null })
        })

        app.post('/graph/follow', async (c) => {
            const body = await c.req.json<{
                targetDid?:unknown
            }>().catch(() => ({ targetDid: undefined }))
            const targetDid = body.targetDid
            if (typeof targetDid !== 'string' || !targetDid) {
                return c.json({ error: 'invalid_body' }, 400)
            }

            const result = await this.followUser(targetDid)
            if (!result.ok) {
                return c.json({ error: result.error }, result.status)
            }

            return c.json({ ok: true }, result.alreadyFollowing ? 200 : 201)
        })

        app.delete('/graph/follow/:targetDid', async (c) => {
            const targetDid = c.req.param('targetDid')
            if (!targetDid) {
                return c.json({ error: 'invalid_target' }, 400)
            }

            const result = await this.unfollowUser(targetDid)
            if (!result.ok) {
                return c.json({ error: result.error }, result.status)
            }

            return c.json({ ok: true })
        })

        return app
    }

    /**
     * Send a live-channel event to every connected WebSocket for this
     * user. Enumerates ctx.getWebSockets() so it works across DO
     * hibernation/eviction (no in-memory subscriber list to lose).
     */
    private broadcast (event:string, data:unknown):void {
        const sockets = this.ctx.getWebSockets()
        if (sockets.length === 0) return

        const payload = JSON.stringify({ event, data })
        for (const ws of sockets) {
            try {
                ws.send(payload)
            } catch {
                // Socket is closing; broadcast() re-reads getWebSockets()
                // on the next call, so no bookkeeping is needed here.
            }
        }
    }

    // The live channel is server-push only; client pings are handled by
    // setWebSocketAutoResponse and never arrive here. Defined so future
    // client->server messages have a home and to satisfy the hibernation
    // contract.
    webSocketMessage (_ws:WebSocket, _message:string|ArrayBuffer):void {
        // no-op
    }

    webSocketClose (
        ws:WebSocket,
        _code:number,
        _reason:string,
        _wasClean:boolean
    ):void {
        // Close the server side without forwarding the peer's code:
        // reserved codes (e.g. 1005/1006) throw if passed to close().
        // No bookkeeping needed because broadcast() reads
        // ctx.getWebSockets() fresh each time.
        try {
            ws.close()
        } catch {
            // already closing/closed
        }
    }

    webSocketError (_ws:WebSocket, error:unknown):void {
        console.error('[DO] webSocketError', error)
    }

    private getFeedUnreadCount (feedId:number):number {
        const row = this.sql.exec(
            'SELECT COUNT(*) as unread FROM items ' +
            'WHERE feed_id = ? AND is_read = 0',
            feedId
        ).one() as { unread:number } // guaranteed single row: COUNT(*)
        return row.unread
    }

    private async awaitFetchOrTimeout (
        fetchPromise:Promise<void>,
        waitMs:number
    ):Promise<'done'|'timeout'> {
        let timeoutHandle:ReturnType<typeof setTimeout>|undefined
        const winner = await Promise.race([
            fetchPromise
                .then(() => 'done' as const)
                .catch(() => 'done' as const),
            new Promise<'timeout'>((resolve) => {
                timeoutHandle = setTimeout(
                    () => resolve('timeout'),
                    waitMs
                )
            })
        ])
        if (timeoutHandle !== undefined) {
            clearTimeout(timeoutHandle)
        }
        return winner
    }

    protected async doFetchFeedText (
        url:string,
        validators?:{ etag?:string; lastModified?:string }
    ):Promise<{
        text:string
        url:string
        notModified:boolean
        etag?:string
        lastModified?:string
    }> {
        return fetchFeedText(url, validators ? { validators } : {})
    }

    protected async doFetchFullArticle (link:string) {
        return fetchFullArticle(link)
    }

    /**
     * Fetch and parse an RSS/Atom feed
     */
    private async fetchFeed (feed: Feed): Promise<void> {
        console.log(
            '[DO] fetchFeed:',
            feed.url
        )
        const priorState = await this.readPollerFeedState(feed.id)
        const startedAt = Date.now()
        try {
            const fetched = await this.doFetchFeedText(
                feed.url,
                priorState ?
                    {
                        etag: priorState.etag,
                        lastModified: priorState.lastModified
                    } :
                    undefined
            )

            if (fetched.notModified) {
                // 304: feed has not changed. Do NOT parse, do NOT
                // insert, do NOT broadcast feed-updates-available
                // (FR-005, FR-010). Refresh per-account success
                // bookkeeping and reset the per-feed backoff. The
                // `finally` block below still emits feed-updated so
                // dashboards see a heartbeat.
                this.sql.exec(
                    `UPDATE feeds SET
                        last_fetched = datetime('now'),
                        last_error = NULL,
                        last_status = NULL
                    WHERE id = ?`,
                    feed.id
                )
                await this.writePollerFeedState(feed.id, {
                    etag: priorState?.etag,
                    lastModified: priorState?.lastModified,
                    consecutiveFailures: 0,
                    lastAttemptAt: startedAt,
                    lastSuccessfulAt: startedAt,
                    nextDueAt: startedAt + FEED_REFRESH_INTERVAL_MS
                })
                await this.writeLastAnySuccess(startedAt)
                return
            }

            console.log(
                '[DO] Feed response length:',
                fetched.text.length
            )
            const parsedFeed = this.parseFeed(fetched.text)
            console.log(
                '[DO] Parsed items:',
                parsedFeed.items.length,
                'title:',
                parsedFeed.title
            )

            // Update feed metadata. Run on every parsed response so
            // the row reaches RESOLVED even when title/description/link
            // are all empty (FR-004). COALESCE keeps prior metadata
            // sticky when fields are null.
            this.sql.exec(
                `UPDATE feeds SET
                    title = COALESCE(?, title),
                    description = COALESCE(?, description),
                    site_url = COALESCE(?, site_url),
                    last_fetched = datetime('now'),
                    last_error = NULL,
                    last_status = NULL
                WHERE id = ?`,
                parsedFeed.title,
                parsedFeed.description,
                parsedFeed.link,
                feed.id
            )

            // Persist the canonical URL when the server redirected us. Skip
            // when another row already owns the resolved URL (UNIQUE
            // constraint would fail) — the redirect still works correctly,
            // we just don't optimize that row.
            if (fetched.url !== feed.url) {
                const collision = this.sql.exec(
                    'SELECT id FROM feeds WHERE url = ? AND id != ?',
                    fetched.url,
                    feed.id
                ).toArray()
                if (collision.length === 0) {
                    this.sql.exec(
                        `UPDATE feeds SET
                            url = ?,
                            updated_at = datetime('now')
                        WHERE id = ?`,
                        fetched.url,
                        feed.id
                    )
                }
            }

            // Insert new items
            const newItems:NewFeedItem[] = []
            for (const item of parsedFeed.items) {
                const guid = item.guid || item.link || item.title || ''
                if (!guid) continue

                try {
                    const result = this.sql.exec(
                        `INSERT OR IGNORE INTO items
                            (
                                feed_id, guid, title, link, description,
                                content, author, pub_date
                            )
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                        feed.id,
                        guid,
                        item.title,
                        item.link,
                        item.description,
                        item.content,
                        item.author,
                        item.pubDate
                    )

                    if (this.rowsWritten(result) > 0) {
                        const row = this.sql.exec(
                            `SELECT id FROM items
                            WHERE feed_id = ? AND guid = ?`,
                            feed.id,
                            guid
                        ).toArray()[0] as { id:number } | undefined ?? null

                        if (row) {
                            newItems.push({
                                id: row.id,
                                link: item.link,
                                imageUrl: item.imageUrl
                            })
                        }
                    }
                } catch (err) {
                    if (isDuplicateInsertError(err)) continue

                    const message = errorMessage(err)

                    console.error(
                        `Error inserting feed item for ${feed.url}:`,
                        err
                    )
                    this.sql.exec(
                        `UPDATE feeds SET
                            last_error = ?,
                            last_status = ?
                        WHERE id = ?`,
                        message,
                        500,
                        feed.id
                    )
                    return
                }
            }

            await this.updateNewItemThumbnails(newItems)
            await this.enqueueArticleFetches(newItems)

            if (newItems.length > 0) {
                this.bumpFeedVersion()

                // Send canonical pending count for the touched feed so
                // the client is a passive renderer of state. Re-broadcast
                // even when the feed was already in the unsynced set
                // (Acceptance 2.2): the displayed count must keep up
                // with the server.
                const allCounts = this.getFeedUpdateCounts()
                const feedIdStr = String(feed.id)
                this.broadcast('feed-updates-available', {
                    feedUpdateCounts: {
                        [feedIdStr]: allCounts[feedIdStr] ?? 0
                    }
                })
            }

            if (parsedFeed.isTooLarge) {
                this.sql.exec(
                    `UPDATE feeds SET
                        last_error = ?,
                        last_status = ?
                    WHERE id = ?`,
                    FEED_TOO_LARGE_ERROR,
                    FEED_TOO_LARGE_STATUS,
                    feed.id
                )
            }

            const successAt = Date.now()
            await this.writePollerFeedState(feed.id, {
                etag: fetched.etag,
                lastModified: fetched.lastModified,
                consecutiveFailures: 0,
                lastAttemptAt: startedAt,
                lastSuccessfulAt: successAt,
                nextDueAt: successAt + FEED_REFRESH_INTERVAL_MS
            })
            await this.writeLastAnySuccess(successAt)
        } catch (err) {
            console.error(`Error fetching feed ${feed.url}:`, err)
            this.sql.exec(
                `UPDATE feeds SET
                    last_error = ?,
                    last_status = ?
                WHERE id = ?`,
                errorMessage(err),
                err instanceof FeedFetchError ? err.status : 500,
                feed.id
            )
            try {
                const failures = (priorState?.consecutiveFailures ?? 0) + 1
                const backoffMs = Math.min(
                    FEED_REFRESH_INTERVAL_MS *
                        Math.pow(FEED_BACKOFF_MULTIPLIER, failures),
                    FEED_BACKOFF_CEILING_MS
                )
                await this.writePollerFeedState(feed.id, {
                    etag: priorState?.etag,
                    lastModified: priorState?.lastModified,
                    consecutiveFailures: failures,
                    lastAttemptAt: startedAt,
                    lastSuccessfulAt: priorState?.lastSuccessfulAt,
                    nextDueAt: startedAt + backoffMs
                })
            } catch (writeErr) {
                console.error(
                    '[DO] writePollerFeedState (failure path) failed',
                    writeErr
                )
            }
        } finally {
            this.broadcast('feed-updated', { feedId: feed.id })
        }
    }

    private rowsWritten (result:unknown):number {
        if (!result || typeof result !== 'object') return 0

        const rowsWritten = (result as { rowsWritten?:unknown }).rowsWritten

        return typeof rowsWritten === 'number' ? rowsWritten : 0
    }

    /**
     * Mark any feed that has been resolving longer than RESOLVE_WINDOW_MS
     * as failed with a synthetic 504. Broadcasts feed-updated for each
     * row swept so connected clients converge immediately. Idempotent:
     * runs only against rows that are still in the resolving state.
     */
    private sweepStuckResolvingFeeds ():void {
        const cutoffSeconds = Math.ceil(RESOLVE_WINDOW_MS / 1000)
        this.sql.exec(
            `UPDATE feeds SET
                last_error = ?,
                last_status = 504
             WHERE last_fetched IS NULL
               AND last_error IS NULL
               AND created_at < datetime('now', ?)`,
            RESOLVE_TIMEOUT_ERROR,
            `-${cutoffSeconds} seconds`
        )
        const swept = this.sql.exec(
            `SELECT id FROM feeds
             WHERE last_status = 504
               AND last_error = ?
               AND updated_at >= datetime('now', '-2 seconds')`,
            RESOLVE_TIMEOUT_ERROR
        ).toArray() as Array<{ id:number }>
        for (const row of swept) {
            this.broadcast('feed-updated', { feedId: row.id })
        }
    }

    private bumpFeedVersion ():number {
        const row = this.sql.exec(`
            UPDATE user_state SET feed_version = feed_version + 1
            WHERE id = 1
            RETURNING feed_version
        `).one() as { feed_version:number } // guaranteed single row: UPDATE ... RETURNING (user_state id=1)

        return row.feed_version
    }

    private getFeedVersion ():number {
        const row = this.sql.exec(`
            SELECT feed_version FROM user_state WHERE id = 1
        `).one() as { feed_version:number } // guaranteed single row: user_state id=1

        return row.feed_version
    }

    private async updateNewItemThumbnails (
        items:NewFeedItem[]
    ):Promise<void> {
        if (items.length === 0) return

        let nextItemIndex = 0
        const controller = new AbortController()
        const deadline = Date.now() + OG_IMAGE_FETCH_BUDGET_MS
        const timeout = setTimeout(() => {
            controller.abort()
        }, OG_IMAGE_FETCH_BUDGET_MS)
        const workerCount = Math.min(
            OG_IMAGE_FETCH_CONCURRENCY,
            items.length
        )
        const workers = Array.from({ length: workerCount }, async () => {
            while (Date.now() < deadline) {
                const item = items[nextItemIndex]
                nextItemIndex++
                if (!item) return

                await this.updateNewItemImage(
                    item,
                    deadline,
                    controller.signal
                )
            }
        })
        const results = await Promise.allSettled(workers)

        clearTimeout(timeout)

        for (const result of results) {
            if (result.status === 'rejected') {
                console.error('Error updating item image:', result.reason)
            }
        }
    }

    private async enqueueArticleFetches (
        items:NewFeedItem[]
    ):Promise<void> {
        const env:Env|undefined = this.env
        if (!env?.ARTICLE_FETCH_QUEUE) return
        if (items.length === 0) return

        const objectId = this.ctx.id.toString()

        for (const item of items) {
            if (!item.link) continue

            const row = this.sql.exec(
                `SELECT content, description, full_content
                    FROM items WHERE id = ?`,
                item.id
            ).toArray()[0] as {
                content:string|null
                description:string|null
                full_content:string|null
            } | undefined ?? null

            if (!row) continue

            const eligible = isPrefetchEligible({
                link: item.link,
                content: row.content,
                description: row.description,
                full_content: row.full_content
            })

            if (!eligible) continue

            await env.ARTICLE_FETCH_QUEUE.send({
                itemId: item.id,
                link: item.link,
                objectId
            } satisfies ArticleFetchJob)
        }
    }

    private async updateNewItemImage (
        item:NewFeedItem,
        deadline:number,
        signal:AbortSignal
    ):Promise<void> {
        try {
            const imageUrl = await this.resolveNewItemImage(
                item,
                deadline,
                signal
            )
            if (!imageUrl) return

            this.sql.exec(
                `UPDATE items SET
                    thumbnail_url = COALESCE(thumbnail_url, ?),
                    og_image_url = COALESCE(og_image_url, ?)
                WHERE id = ?`,
                imageUrl,
                imageUrl,
                item.id
            )
            await this.updateBlurhashFromCacheOrQueue(item.id, imageUrl)
        } catch (err) {
            console.error('Error updating item image:', err)
        }
    }

    private async updateBlurhashFromCacheOrQueue (
        itemId:number,
        imageUrl:string
    ):Promise<void> {
        const env:Env|undefined = this.env

        if (!env?.BLURHASH_KV || !env.BLURHASH_QUEUE) return

        const key = await blurhashCacheKey(imageUrl)
        const cached = await env.BLURHASH_KV.get(key)
        const entry = parseBlurhashCacheEntry(cached)

        if (entry) {
            this.sql.exec(
                `UPDATE items SET
                    blurhash = COALESCE(blurhash, ?),
                    image_width = COALESCE(image_width, ?),
                    image_height = COALESCE(image_height, ?)
                WHERE id = ?`,
                entry.blurhash,
                entry.image_width,
                entry.image_height,
                itemId
            )
            this.bumpFeedVersion()
            return
        }

        await env.BLURHASH_QUEUE.send({
            imageUrl,
            itemId,
            objectId: this.ctx.id.toString()
        } satisfies BlurhashJob)
    }

    private async resolveNewItemImage (
        item:NewFeedItem,
        deadline:number,
        signal:AbortSignal
    ):Promise<string | null> {
        if (item.imageUrl) return item.imageUrl
        if (!item.link) return null

        const ogImage = await this.fetchOgImageBeforeDeadline(
            item.link,
            deadline,
            signal
        )

        return ogImage
    }

    private async fetchOgImageBeforeDeadline (
        link:string,
        deadline:number,
        signal:AbortSignal
    ):Promise<string | null> {
        const remainingMs = deadline - Date.now()
        if (remainingMs <= 0) return null

        let timeout:ReturnType<typeof setTimeout>|null = null
        const timedOut = Symbol('og-timeout')
        const timeoutPromise = new Promise<typeof timedOut>((resolve) => {
            timeout = setTimeout(() => {
                resolve(timedOut)
            }, remainingMs)
        })

        try {
            const result = await Promise.race([
                fetchOgImage(link, { signal }),
                timeoutPromise
            ])

            return result === timedOut ? null : result
        } catch (_err) {
            return null
        } finally {
            if (timeout) clearTimeout(timeout)
        }
    }

    /**
     * Parse RSS or Atom feed XML
     */
    private parseFeed (xml: string): ParsedFeed {
        const doc = FEED_XML_PARSER.parse(xml) as XmlObject
        const rss = this.asObject(this.getChild(doc, ['rss', 'rdf:RDF']))
        const channel = rss ?
            this.asObject(this.getChild(rss, ['channel'])) :
            null
        const atom = this.asObject(this.getChild(doc, ['feed']))

        if (channel) return this.parseRss(channel)
        if (atom) return this.parseAtom(atom)

        return {
            title: null,
            description: null,
            link: null,
            isTooLarge: false,
            items: []
        }
    }

    private parseRss (channel: XmlObject) {
        let isTooLarge = false
        const markTooLarge = () => {
            isTooLarge = true
        }
        const title = this.capText(
            this.getText(channel, ['title']),
            MAX_FEED_TITLE_LENGTH,
            markTooLarge
        )
        const description = this.capText(
            this.getText(channel, ['description']),
            MAX_FEED_DESCRIPTION_LENGTH,
            markTooLarge
        )
        const link = this.getText(channel, ['link'])
        const items: ParsedFeedItem[] = []
        const itemNodes = this.asArray(this.getChild(channel, ['item']))
        const cappedItemNodes = itemNodes.slice(0, MAX_PARSED_FEED_ITEMS)

        if (itemNodes.length > MAX_PARSED_FEED_ITEMS) {
            isTooLarge = true
        }

        for (const itemNode of cappedItemNodes) {
            const item = this.asObject(itemNode)
            if (!item) continue

            const itemLink = this.getText(item, ['link'])
            items.push({
                guid: this.getText(item, ['guid', 'id']) ||
                    itemLink,
                title: this.capText(
                    this.getText(item, ['title', 'media:title']),
                    MAX_FEED_TITLE_LENGTH,
                    markTooLarge
                ),
                link: itemLink,
                description: this.capText(
                    this.getText(item, ['description']),
                    MAX_FEED_DESCRIPTION_LENGTH,
                    markTooLarge
                ),
                content: this.capText(
                    this.getText(item, [
                        'content:encoded',
                        'encoded',
                        'content'
                    ]),
                    MAX_FEED_CONTENT_LENGTH,
                    markTooLarge
                ),
                author: this.getText(item, [
                    'author',
                    'dc:creator',
                    'creator'
                ]),
                pubDate: this.parseDate(this.getText(item, ['pubDate'])),
                imageUrl: this.resolveImageUrl(
                    this.getRssItemImage(item),
                    itemLink,
                    link
                )
            })
        }

        return { title, description, link, isTooLarge, items }
    }

    private parseAtom (feed: XmlObject) {
        let isTooLarge = false
        const markTooLarge = () => {
            isTooLarge = true
        }
        const title = this.capText(
            this.getText(feed, ['title']),
            MAX_FEED_TITLE_LENGTH,
            markTooLarge
        )
        const description = this.capText(
            this.getText(feed, ['subtitle']),
            MAX_FEED_DESCRIPTION_LENGTH,
            markTooLarge
        )
        const link = this.getLinkHref(this.getChild(feed, ['link']))
        const items: ParsedFeedItem[] = []
        const entries = this.asArray(this.getChild(feed, ['entry']))
        const cappedEntries = entries.slice(0, MAX_PARSED_FEED_ITEMS)

        if (entries.length > MAX_PARSED_FEED_ITEMS) {
            isTooLarge = true
        }

        for (const entryNode of cappedEntries) {
            const entry = this.asObject(entryNode)
            if (!entry) continue

            const author = this.asObject(this.getChild(entry, ['author']))
            const entryLink = this.getLinkHref(this.getChild(entry, ['link']))

            items.push({
                guid: this.getText(entry, ['id']),
                title: this.capText(
                    this.getText(entry, ['title']),
                    MAX_FEED_TITLE_LENGTH,
                    markTooLarge
                ),
                link: entryLink,
                description: this.capText(
                    this.getText(entry, ['summary']),
                    MAX_FEED_DESCRIPTION_LENGTH,
                    markTooLarge
                ),
                content: this.capText(
                    this.getText(entry, ['content']),
                    MAX_FEED_CONTENT_LENGTH,
                    markTooLarge
                ),
                author: author ? this.getText(author, ['name']) : null,
                pubDate: this.parseDate(
                    this.getText(entry, ['published']) ||
                    this.getText(entry, ['updated'])
                ),
                imageUrl: this.resolveImageUrl(
                    this.getAtomEntryImage(entry),
                    entryLink,
                    link
                )
            })
        }

        return { title, description, link, isTooLarge, items }
    }

    private extractFirstImgSrc (html:string | null):string | null {
        if (!html) return null

        const match = html.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)
        return match?.[1]?.trim() || null
    }

    private resolveImageUrl (
        candidate:string | null,
        itemLink:string | null,
        feedLink:string | null
    ):string | null {
        if (!candidate) return null

        const base = itemLink || feedLink

        try {
            const url = base ? new URL(candidate, base) : new URL(candidate)

            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
                return null
            }

            return url.href
        } catch {
            return null
        }
    }

    private getRssItemImage (item:XmlObject):string | null {
        const thumbnail = this.firstAttr(
            this.getChild(item, ['media:thumbnail']),
            '@_url'
        )
        if (thumbnail) return thumbnail

        const mediaContent = this.firstMediaImageAttr(
            this.getChild(item, ['media:content']),
            '@_url'
        )
        if (mediaContent) return mediaContent

        const enclosure = this.firstMediaImageAttr(
            this.getChild(item, ['enclosure']),
            '@_url'
        )
        if (enclosure) return enclosure

        return this.extractFirstImgSrc(this.getText(item, [
            'content:encoded',
            'encoded',
            'content',
            'description'
        ]))
    }

    private getAtomEntryImage (entry:XmlObject):string | null {
        const thumbnail = this.firstAttr(
            this.getChild(entry, ['media:thumbnail']),
            '@_url'
        )
        if (thumbnail) return thumbnail

        for (const linkValue of this.asArray(this.getChild(entry, ['link']))) {
            const link = this.asObject(linkValue)
            if (!link) continue

            const rel = this.textValue(link['@_rel'])
            const type = this.textValue(link['@_type'])
            const href = this.textValue(link['@_href'])
            if (rel === 'enclosure' && this.isImageType(type) && href) {
                return href
            }
        }

        return this.extractFirstImgSrc(this.getText(entry, [
            'content',
            'summary'
        ]))
    }

    private firstAttr (
        value:XmlValue | undefined,
        attrName:string
    ):string | null {
        for (const candidate of this.asArray(value)) {
            const node = this.asObject(candidate)
            const attr = node ? this.textValue(node[attrName]) : null
            if (attr) return attr
        }

        return null
    }

    private firstMediaImageAttr (
        value:XmlValue | undefined,
        attrName:string
    ):string | null {
        for (const candidate of this.asArray(value)) {
            const node = this.asObject(candidate)
            if (!node) continue

            const medium = this.textValue(node['@_medium'])
            const type = this.textValue(node['@_type'])
            const attr = this.textValue(node[attrName])
            const isImage = medium === 'image' || this.isImageType(type)
            if (isImage && attr) return attr
        }

        return null
    }

    private isImageType (value:string | null):boolean {
        return value?.toLowerCase().startsWith('image/') ?? false
    }

    private capText (
        value:string | null,
        maxLength:number,
        markTooLarge:() => void
    ):string | null {
        if (value === null) return null
        if (value.length <= maxLength) return value

        markTooLarge()
        return value.slice(0, maxLength)
    }

    private getLinkHref (value:XmlValue | undefined):string | null {
        const links = this.asArray(value)
        let fallback:string | null = null

        for (const linkValue of links) {
            const link = this.asObject(linkValue)
            if (!link) {
                fallback = fallback || this.textValue(linkValue)
                continue
            }

            const href = this.textValue(link['@_href'])
            const rel = this.textValue(link['@_rel'])
            if (!href) continue
            if (!rel || rel === 'alternate') return href
            fallback = fallback || href
        }

        return fallback
    }

    private getText (
        node:XmlObject,
        names:string[]
    ):string | null {
        const value = this.getChild(node, names)
        return this.textValue(value)
    }

    private getChild (
        node:XmlObject,
        names:string[]
    ):XmlValue | undefined {
        for (const name of names) {
            if (node[name] !== undefined) return node[name]
        }

        return undefined
    }

    private textValue (value:XmlValue | undefined):string | null {
        if (value === undefined || value === null) return null
        if (typeof value === 'string') return value.trim() || null
        if (typeof value === 'number' || typeof value === 'boolean') {
            return String(value)
        }
        if (Array.isArray(value)) {
            for (const item of value) {
                const text = this.textValue(item)
                if (text) return text
            }

            return null
        }

        return this.textValue(value['#cdata']) ||
            this.textValue(value['#text'])
    }

    private asObject (value:XmlValue | undefined):XmlObject | null {
        if (!value || Array.isArray(value) || typeof value !== 'object') {
            return null
        }

        return value
    }

    private asArray (value:XmlValue | undefined):XmlValue[] {
        if (value === undefined || value === null) return []
        return Array.isArray(value) ? value : [value]
    }

    private parseDate (dateStr: string | null): string | null {
        if (!dateStr) return null

        try {
            const date = new Date(dateStr)
            if (isNaN(date.getTime())) return null
            return date.toISOString()
        } catch {
            return null
        }
    }

    /**
     * Handle incoming requests - routes to internal Hono app
     */
    async fetch (request: Request): Promise<Response> {
        return this.app.fetch(request)
    }

    private getManualRefreshClaims ():Map<number, number> {
        if (!this.manualRefreshClaims) {
            this.manualRefreshClaims = new Map()
        }

        return this.manualRefreshClaims
    }

    private async claimManualFeedRefresh (
        feedId:number,
        now = Date.now()
    ):Promise<ManualRefreshLimit|null> {
        const claims = this.getManualRefreshClaims()
        const claimedAt = claims.get(feedId)

        if (isRecentManualRefresh(claimedAt, now)) {
            return {
                retryAfterSeconds: manualRefreshRetryAfterSeconds(
                    claimedAt as number,
                    now
                )
            }
        }

        claims.set(feedId, now)

        const key = manualRefreshStorageKey(feedId)
        const stored = await this.ctx.storage.get<ManualRefreshState>(key)
        const storedAt = stored?.last_manual_refresh_at

        if (isRecentManualRefresh(storedAt, now)) {
            claims.set(feedId, storedAt as number)
            return {
                retryAfterSeconds: manualRefreshRetryAfterSeconds(
                    storedAt as number,
                    now
                )
            }
        }

        await this.ctx.storage.put(key, {
            last_manual_refresh_at: now
        })

        return null
    }

    private async claimFetchFullAttempt (
        itemId:number,
        now = Date.now()
    ):Promise<FetchFullThrottleLimit|null> {
        const key = fetchFullThrottleKey(itemId)
        const stored = await this.ctx.storage
            .get<FetchFullThrottleState>(key)
        const storedAt = stored?.last_attempt_at

        if (
            typeof storedAt === 'number' &&
            Number.isFinite(storedAt) &&
            now - storedAt < FETCH_FULL_MIN_INTERVAL_MS
        ) {
            return {
                retryAfterSeconds: fetchFullRetryAfterSeconds(storedAt, now)
            }
        }

        await this.ctx.storage.put(key, { last_attempt_at: now })
        return null
    }

    private async readPollerFeedState (
        feedId:number
    ):Promise<PollerFeedState|undefined> {
        return this.ctx.storage.get<PollerFeedState>(pollFeedKey(feedId))
    }

    private async writePollerFeedState (
        feedId:number,
        state:PollerFeedState
    ):Promise<void> {
        const sanitized:PollerFeedState = {
            consecutiveFailures: state.consecutiveFailures,
            nextDueAt: state.nextDueAt
        }
        if (state.etag !== undefined) sanitized.etag = state.etag
        if (state.lastModified !== undefined) {
            sanitized.lastModified = state.lastModified
        }
        if (state.lastAttemptAt !== undefined) {
            sanitized.lastAttemptAt = state.lastAttemptAt
        }
        if (state.lastSuccessfulAt !== undefined) {
            sanitized.lastSuccessfulAt = state.lastSuccessfulAt
        }
        await this.ctx.storage.put(pollFeedKey(feedId), sanitized)
    }

    private async deletePollerFeedState (feedId:number):Promise<void> {
        await this.ctx.storage.delete(pollFeedKey(feedId))
    }

    private async readAccountActivity (
    ):Promise<AccountActivityMarker|undefined> {
        return this.ctx.storage.get<AccountActivityMarker>(
            POLL_ACCOUNT_LAST_ACTIVE_AT_KEY
        )
    }

    private async writeAccountActivity (now:number):Promise<void> {
        const existing = await this.readAccountActivity()
        if (
            existing &&
            typeof existing.lastActiveAt === 'number' &&
            Number.isFinite(existing.lastActiveAt) &&
            now - existing.lastActiveAt < ACTIVITY_MARKER_COALESCE_MS
        ) {
            return
        }
        await this.ctx.storage.put<AccountActivityMarker>(
            POLL_ACCOUNT_LAST_ACTIVE_AT_KEY,
            { lastActiveAt: now }
        )
    }

    private async readLastAnySuccess ():Promise<number|undefined> {
        const stored = await this.ctx.storage.get<{ lastAnySuccessAt:number }>(
            POLL_ACCOUNT_LAST_ANY_SUCCESS_AT_KEY
        )
        const value = stored?.lastAnySuccessAt
        if (typeof value === 'number' && Number.isFinite(value)) {
            return value
        }
        return undefined
    }

    private async writeLastAnySuccess (now:number):Promise<void> {
        const prev = await this.readLastAnySuccess()
        const next = typeof prev === 'number' ? Math.max(prev, now) : now
        await this.ctx.storage.put(
            POLL_ACCOUNT_LAST_ANY_SUCCESS_AT_KEY,
            { lastAnySuccessAt: next }
        )
    }

    private async maybeKickCatchUp (now:number):Promise<void> {
        const prev = await this.readAccountActivity()
        const prevLastActiveAt = prev?.lastActiveAt
        const lastAnySuccessAt = await this.readLastAnySuccess()
        const trigger = (
            prevLastActiveAt === undefined ||
            now - prevLastActiveAt > ACCOUNT_INACTIVITY_THRESHOLD_MS ||
            lastAnySuccessAt === undefined ||
            lastAnySuccessAt < now - FEED_REFRESH_INTERVAL_MS
        )
        await this.writeAccountActivity(now)
        await this.ensureFeedRefreshArmed()
        if (trigger) {
            this.ctx.waitUntil(this.refreshFeedBatches())
        }
    }

    /**
     * Alarm handler for periodic feed refresh
     */
    async alarm (): Promise<void> {
        const pending = await this.ctx.storage.get<PendingDeletion>(
            PENDING_DELETION_KEY
        )
        if (pending && Date.now() >= pending.scheduledFor) {
            await this.executeAccountDeletion(pending.did)
            return
        }

        this.sweepStuckResolvingFeeds()

        // Inactivity gate (FR-008, SC-005): once an account has been
        // idle past the threshold, STOP the polling alarm so the DO
        // goes silent and incurs zero Durable Object request cost.
        // It is re-armed on the user's next request (constructor +
        // maybeKickCatchUp -> ensureFeedRefreshArmed). A pending
        // (not-yet-due) deletion must keep the alarm ticking so it
        // executes when due, so only silence the alarm when no
        // deletion is pending.
        const activity = await this.readAccountActivity()
        const idlePastThreshold = activity != null &&
            Date.now() - activity.lastActiveAt >
                ACCOUNT_INACTIVITY_THRESHOLD_MS
        if (idlePastThreshold && pending == null) {
            return
        }

        await this.scheduleNextFeedRefresh()
        await this.refreshFeedBatches()
    }

    /**
     * Permanently delete the user's data. Wipes the per-user
     * Durable Object storage (SQLite tables and KV-style state),
     * removes their KV entries on the main worker, and best-effort
     * deletes the Autumn customer record.
     */
    private async executeAccountDeletion (did:string):Promise<void> {
        console.log('[DO] executeAccountDeletion', did)

        // Cancel/delete the Autumn customer first so they aren't
        // billed past this point. Best-effort: a missing customer
        // (free tier) is not an error.
        try {
            const { cancelCustomer } = await import(
                '../autumn-billing.js'
            )
            await cancelCustomer(this.env, did)
        } catch (err) {
            console.error('[DO] cancelCustomer failed', err)
        }

        // Remove the user's KV entries on the main worker namespace.
        try {
            await Promise.all([
                this.env.SESSIONS.delete(`user:${did}`),
                this.env.SESSIONS.delete(`billing:${did}`),
                this.env.SESSIONS.delete(`billing_pending_email:${did}`),
                this.env.SESSIONS.delete(`billing_contact_email:${did}`)
            ])
        } catch (err) {
            console.error('[DO] KV cleanup failed', err)
        }

        // Drop SQLite tables for clean slate.
        try {
            this.sql.exec('DROP TABLE IF EXISTS items')
            this.sql.exec('DROP TABLE IF EXISTS feeds')
            this.sql.exec('DROP TABLE IF EXISTS dead_letter_outbox')
        } catch (err) {
            console.error('[DO] DROP TABLE failed', err)
        }

        // Wipe DO state (alarm, cursor, pending deletion, etc.)
        await this.ctx.storage.deleteAll()
    }

    /**
     * Ensure a periodic feed-refresh alarm is armed. Called from the
     * per-request activity hook (maybeKickCatchUp) so a returning user
     * whose alarm was stopped by the inactivity gate resumes polling.
     * Idempotent: a no-op when an alarm is already scheduled.
     */
    private async ensureFeedRefreshArmed ():Promise<void> {
        const existing = await this.ctx.storage.getAlarm()
        if (existing == null) {
            await this.ctx.storage.setAlarm(
                Date.now() + FEED_REFRESH_INTERVAL_MS
            )
        }
    }

    private async scheduleNextFeedRefresh ():Promise<void> {
        await this.ctx.storage.setAlarm(
            Date.now() + FEED_REFRESH_INTERVAL_MS
        )
    }

    private async refreshFeedBatches ():Promise<void> {
        let cursor = await this.getAlarmRefreshCursor()
        const sweepNow = Date.now()
        const manualClaims = this.manualRefreshClaims

        while (true) {
            const batch = this.selectFeedRefreshBatch(cursor)
            if (batch.length === 0) {
                await this.ctx.storage.delete(ALARM_REFRESH_CURSOR_KEY)
                return
            }

            const due:Feed[] = []
            for (const feed of batch) {
                if (manualClaims?.has(feed.id)) continue
                const state = await this.readPollerFeedState(feed.id)
                if (state === undefined || state.nextDueAt <= sweepNow) {
                    due.push(feed)
                }
            }

            if (due.length > 0) {
                await this.refreshFeeds(due)
            }

            const lastFeed = batch[batch.length - 1]
            if (!lastFeed) return

            cursor = lastFeed.id
            await this.ctx.storage.put(ALARM_REFRESH_CURSOR_KEY, {
                last_feed_id: cursor
            })
        }
    }

    private async getAlarmRefreshCursor ():Promise<number> {
        const cursor = await this.ctx.storage.get<AlarmRefreshCursor>(
            ALARM_REFRESH_CURSOR_KEY
        )
        const lastFeedId = cursor?.last_feed_id
        if (
            typeof lastFeedId === 'number' &&
            Number.isFinite(lastFeedId) &&
            lastFeedId > 0
        ) {
            return lastFeedId
        }

        return 0
    }

    private selectFeedRefreshBatch (cursor:number):Feed[] {
        if (cursor > 0) {
            return this.sql.exec(
                `SELECT * FROM feeds
                WHERE id > ?
                ORDER BY id ASC
                LIMIT ?`,
                cursor,
                FEED_REFRESH_CONCURRENCY
            ).toArray() as unknown as Feed[]
        }

        return this.sql.exec(
            `SELECT * FROM feeds
            ORDER BY id ASC
            LIMIT ?`,
            FEED_REFRESH_CONCURRENCY
        ).toArray() as unknown as Feed[]
    }

    private async runFeedPool (
        feeds:Feed[],
        worker:(feed:Feed) => Promise<void>
    ):Promise<void> {
        let next = 0
        const count = Math.min(FEED_REFRESH_CONCURRENCY, feeds.length)
        const runners = Array.from({ length: count }, async () => {
            while (next < feeds.length) {
                const feed = feeds[next++]
                if (!feed) continue
                try {
                    await worker(feed)
                } catch (err) {
                    // Isolate per-feed failure: log, continue pool
                    reportError(err, 'refresh-feed', { feedId: feed.id })
                }
            }
        })

        await Promise.all(runners)
    }

    private async refreshFeeds (feeds:Feed[]):Promise<void> {
        await this.runFeedPool(feeds, f => this.fetchFeed(f))
    }
}
