import type { Context, MiddlewareHandler } from 'hono'

export interface RateLimitBindings {
    SESSIONS:KVNamespace;
}

export interface RateLimitOptions<
    Bindings extends RateLimitBindings,
    Variables extends object
> {
    bucketSize:number;
    windowSeconds:number;
    key:(c:Context<{
        Bindings:Bindings;
        Variables:Variables;
    }>)=> string|null|Promise<string|null>;
    prefix?:string;
    now?:()=> number;
}

interface RateLimitState {
    tokens:number;
    updatedAt:number;
}

const encoder = new TextEncoder()

function toHex (buffer:ArrayBuffer):string {
    return Array.from(new Uint8Array(buffer))
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')
}

async function hashKey (value:string):Promise<string> {
    const digest = await crypto.subtle.digest(
        'SHA-256',
        encoder.encode(value)
    )
    return toHex(digest)
}

function parseState (raw:string|null):RateLimitState|null {
    if (!raw) return null

    try {
        const parsed = JSON.parse(raw) as Partial<RateLimitState>
        if (
            typeof parsed.tokens !== 'number' ||
            typeof parsed.updatedAt !== 'number'
        ) {
            return null
        }
        return {
            tokens: parsed.tokens,
            updatedAt: parsed.updatedAt
        }
    } catch {
        return null
    }
}

export function createRateLimitMiddleware<
    Bindings extends RateLimitBindings,
    Variables extends object
> (
    options:RateLimitOptions<Bindings, Variables>
):MiddlewareHandler<{
    Bindings:Bindings;
    Variables:Variables;
}> {
    if (options.bucketSize < 1 || options.windowSeconds < 1) {
        throw new Error('rate limit bucketSize and windowSeconds must be > 0')
    }

    return async (c, next) => {
        const key = await options.key(c)
        if (!key) {
            await next()
            return
        }

        const now = options.now ? options.now() : Date.now()
        const refillPerMs = options.bucketSize /
            (options.windowSeconds * 1000)
        const prefix = options.prefix ?? 'rate-limit'
        const storageKey = `${prefix}:${await hashKey(key)}`
        const raw = await c.env.SESSIONS.get(storageKey)
        const stored = parseState(raw)
        const elapsedMs = stored ?
            Math.max(0, now - stored.updatedAt) :
            0
        const available = stored ?
            Math.min(
                options.bucketSize,
                stored.tokens + elapsedMs * refillPerMs
            ) :
            options.bucketSize

        if (available < 1) {
            const retryAfter = Math.max(
                1,
                Math.ceil((1 - available) / (refillPerMs * 1000))
            )
            const state:RateLimitState = {
                tokens: available,
                updatedAt: now
            }
            await c.env.SESSIONS.put(
                storageKey,
                JSON.stringify(state),
                { expirationTtl: options.windowSeconds }
            )
            c.header('Retry-After', String(retryAfter))
            return c.json({ error: 'rate_limited' }, 429)
        }

        const state:RateLimitState = {
            tokens: available - 1,
            updatedAt: now
        }
        await c.env.SESSIONS.put(
            storageKey,
            JSON.stringify(state),
            { expirationTtl: options.windowSeconds }
        )

        await next()
    }
}
