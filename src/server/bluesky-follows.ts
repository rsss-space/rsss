/**
 * US-019: Read the user's public Bluesky follows.
 *
 * Fetches app.bsky.graph.getFollows from the public Bluesky AppView
 * (no auth required). Paginates to collect all follows and caches
 * results briefly via injectable deps.
 */
import { RSSS_USER_AGENT } from './microcosm-client.js'

const APPVIEW_BASE = 'https://public.api.bsky.app'
const FOLLOWS_CACHE_TTL = 300 // 5 minutes
const PAGE_LIMIT = 100
const MAX_FOLLOW_PAGES = 50 // 50 pages * 100 per page = 5000 follows cap

export interface BlueskyFollow {
    did:string
    handle:string
}

export interface BlueskyFollowsResult {
    follows:BlueskyFollow[]
    ok:boolean // false => fetch error / cap / cursor-stall truncated it
}

export interface BlueskyFollowsDeps {
    fetch:typeof fetch
    getCache(key:string):Promise<string|null>
    putCache(key:string, value:string, ttlSeconds:number):Promise<void>
}

function cacheKey (did:string):string {
    return `bluesky-follows:${did}`
}

export async function getBlueskyFollows (
    did:string,
    deps:BlueskyFollowsDeps
):Promise<BlueskyFollowsResult> {
    const key = cacheKey(did)
    const cached = await deps.getCache(key)
    if (cached) {
        try {
            const follows = JSON.parse(cached) as BlueskyFollow[]
            return { follows, ok: true }
        } catch {
            // fall through to fetch
        }
    }

    const follows:BlueskyFollow[] = []
    let cursor:string|undefined
    let pageCount = 0

    try {
        do {
            // Check page count cap (AC7.1)
            if (pageCount >= MAX_FOLLOW_PAGES) {
                return { follows, ok: false }
            }

            let url = `${APPVIEW_BASE}/xrpc/app.bsky.graph.getFollows` +
                `?actor=${did}&limit=${PAGE_LIMIT}`
            if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

            const response = await deps.fetch(url, {
                headers: { 'user-agent': RSSS_USER_AGENT }
            })

            // On !ok mid-pagination, return partial (AC7.3)
            if (!response.ok) {
                return { follows, ok: false }
            }

            const body = await response.json() as {
                follows?:Array<{ did:string; handle:string }>
                cursor?:string
            }

            pageCount++
            const newCursor = body.cursor

            // Cursor unchanged detection (AC7.2) — bail before accumulating
            if (newCursor && newCursor === cursor) {
                return { follows, ok: false }
            }

            // Accumulate follows from this page after cursor-stall check
            const page = body.follows ?? []
            for (const f of page) {
                follows.push({ did: f.did, handle: f.handle })
            }

            cursor = newCursor
        } while (cursor)

        // Natural termination (falsy cursor, no error)
        await deps.putCache(key, JSON.stringify(follows),
            FOLLOWS_CACHE_TTL)
        return { follows, ok: true }
    } catch {
        // Outer error (AC7.4) — return partial, ok:false
        return { follows, ok: false }
    }
}

/**
 * Build BlueskyFollowsDeps from a Cloudflare Workers KV namespace.
 */
export function makeBlueskyFollowsDeps (
    kv:KVNamespace,
    fetcher:typeof fetch = fetch
):BlueskyFollowsDeps {
    return {
        fetch: fetcher,
        getCache: (key) => kv.get(key),
        putCache: (key, value, ttl) =>
            kv.put(key, value, { expirationTtl: ttl })
    }
}
