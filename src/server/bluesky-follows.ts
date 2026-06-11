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

export interface BlueskyFollow {
    did:string
    handle:string
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
):Promise<BlueskyFollow[]> {
    const key = cacheKey(did)
    const cached = await deps.getCache(key)
    if (cached) {
        try {
            return JSON.parse(cached) as BlueskyFollow[]
        } catch {
            // fall through to fetch
        }
    }

    const follows:BlueskyFollow[] = []
    let cursor:string|undefined

    try {
        do {
            let url = `${APPVIEW_BASE}/xrpc/app.bsky.graph.getFollows` +
                `?actor=${did}&limit=${PAGE_LIMIT}`
            if (cursor) url += `&cursor=${encodeURIComponent(cursor)}`

            const response = await deps.fetch(url, {
                headers: { 'user-agent': RSSS_USER_AGENT }
            })

            if (!response.ok) return []

            const body = await response.json() as {
                follows?:Array<{ did:string; handle:string }>
                cursor?:string
            }

            const page = body.follows ?? []
            for (const f of page) {
                follows.push({ did: f.did, handle: f.handle })
            }

            cursor = body.cursor
        } while (cursor)
    } catch {
        return []
    }

    await deps.putCache(key, JSON.stringify(follows), FOLLOWS_CACHE_TTL)
    return follows
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
