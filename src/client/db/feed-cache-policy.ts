import { signal } from '@preact/signals'
import type { Sqlite3Db } from './sqlite-init.js'
import { execDb, queryDb, queryOneDb } from './local-db.js'
import {
    type CacheMode,
    defaultCacheMode,
    defaultMaxSizeBytes,
    defaultMaxAgeSeconds,
    storeContent
} from '../local-first-settings.js'

const feedCachePolicyColumnsReady = new WeakSet<Sqlite3Db>()

export async function ensureFeedCachePolicyColumns (
    db:Sqlite3Db
):Promise<void> {
    if (feedCachePolicyColumnsReady.has(db)) return
    const cols = await queryDb<{ name:string }>(
        db,
        'PRAGMA table_info(feed_cache_policy)'
    )
    const has = (name:string) => cols.some((col) => col.name === name)
    if (!has('content_enabled')) {
        await execDb(
            db,
            'ALTER TABLE feed_cache_policy ADD COLUMN content_enabled' +
            ' INTEGER'
        )
    }
    feedCachePolicyColumnsReady.add(db)
}

export interface FeedCachePolicyRow {
    feed_id:number
    cache_mode:CacheMode|null
    max_size_bytes:number|null
    max_age_seconds:number|null
    content_enabled:number|null
}

export interface EffectivePolicy {
    cacheMode:CacheMode
    maxSizeBytes:number
    maxAgeSeconds:number
    isDefault:{
        cacheMode:boolean
        maxSizeBytes:boolean
        maxAgeSeconds:boolean
    }
}

export const feedPolicies = signal<Record<number, FeedCachePolicyRow|null>>({})

export function _resetFeedPolicies ():void {
    feedPolicies.value = {}
}

export function resolveEffectivePolicy (
    row:FeedCachePolicyRow|null|undefined
):EffectivePolicy {
    const mode = row?.cache_mode ?? null
    const size = row?.max_size_bytes ?? null
    const age = row?.max_age_seconds ?? null
    return {
        cacheMode: mode ?? defaultCacheMode.value,
        maxSizeBytes: size ?? defaultMaxSizeBytes.value,
        maxAgeSeconds: age ?? defaultMaxAgeSeconds.value,
        isDefault: {
            cacheMode: mode == null,
            maxSizeBytes: size == null,
            maxAgeSeconds: age == null
        }
    }
}

export async function getFeedCachePolicy (
    db:Sqlite3Db,
    feedId:number
):Promise<FeedCachePolicyRow|null> {
    await ensureFeedCachePolicyColumns(db)
    const row = await queryOneDb<FeedCachePolicyRow>(
        db,
        'SELECT feed_id, cache_mode, max_size_bytes, max_age_seconds,' +
        ' content_enabled FROM feed_cache_policy WHERE feed_id = ?',
        [feedId]
    )
    return row ?? null
}

export async function upsertFeedCachePolicy (
    db:Sqlite3Db,
    feedId:number,
    updates:{
        cache_mode:CacheMode|null
        max_size_bytes:number|null
        max_age_seconds:number|null
        content_enabled?:number|null
    }
):Promise<void> {
    await ensureFeedCachePolicyColumns(db)
    if (
        updates.cache_mode == null &&
        updates.max_size_bytes == null &&
        updates.max_age_seconds == null &&
        updates.content_enabled == null
    ) {
        await execDb(db, {
            sql: 'DELETE FROM feed_cache_policy WHERE feed_id = ?',
            bind: [feedId]
        })
        return
    }
    await execDb(db, {
        sql: 'INSERT INTO feed_cache_policy' +
            ' (feed_id, cache_mode, max_size_bytes, max_age_seconds,' +
            '  content_enabled, updated_at)' +
            ' VALUES (?, ?, ?, ?, ?, datetime(\'now\'))' +
            ' ON CONFLICT(feed_id) DO UPDATE SET' +
            '  cache_mode = excluded.cache_mode,' +
            '  max_size_bytes = excluded.max_size_bytes,' +
            '  max_age_seconds = excluded.max_age_seconds,' +
            '  content_enabled = excluded.content_enabled,' +
            '  updated_at = excluded.updated_at',
        bind: [
            feedId,
            updates.cache_mode,
            updates.max_size_bytes,
            updates.max_age_seconds,
            updates.content_enabled
        ]
    })
}

export async function loadFeedPolicies (
    db:Sqlite3Db,
    feedIds:number[],
    opts?:{ shouldApply?:() => boolean }
):Promise<void> {
    const map:Record<number, FeedCachePolicyRow|null> = {}
    for (const feedId of feedIds) {
        map[feedId] = await getFeedCachePolicy(db, feedId)
    }
    if (opts?.shouldApply && !opts.shouldApply()) return
    feedPolicies.value = map
}

export function isContentCachedForPolicy (
    row:FeedCachePolicyRow|null|undefined
):boolean {
    const o = row?.content_enabled ?? null
    return o == null ?
        storeContent.value :
        o === 1
}

export function isContentCachedForFeed (feedId:number):boolean {
    return isContentCachedForPolicy(
        feedPolicies.value[feedId] ?? null
    )
}
