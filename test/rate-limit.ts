import { test } from '@substrate-system/tapzero'
import { Hono } from 'hono'
import {
    createRateLimitMiddleware
} from '../src/server/middleware/rate-limit.js'
import { dataRouter } from '../src/server/index.js'

const TEST_SESSION = {
    did: 'did:plc:rate-reader',
    handle: 'rate-reader.example'
}

class MemoryKv {
    data = new Map<string, string>()
    ttlByKey = new Map<string, number>()

    async get (key:string):Promise<string|null> {
        return this.data.get(key) ?? null
    }

    async put (
        key:string,
        value:string,
        options?:{ expirationTtl?:number }
    ):Promise<void> {
        this.data.set(key, value)
        if (options?.expirationTtl) {
            this.ttlByKey.set(key, options.expirationTtl)
        }
    }

    async delete (key:string):Promise<void> {
        this.data.delete(key)
        this.ttlByKey.delete(key)
    }
}

function authenticatedDataRouter () {
    const router = new Hono<{
        Variables:{ session:typeof TEST_SESSION }
    }>()

    router.use('*', async (c, next) => {
        c.set('session', TEST_SESSION)
        await next()
    })
    router.route('/api', dataRouter)
    return router
}

function makeDataEnv (
    kv:MemoryKv,
    proxyCount:{ value:number }
) {
    return {
        USER_DO: {
            idFromName: () => 'id',
            get: () => ({
                fetch: async () => {
                    proxyCount.value += 1
                    return new Response(null, { status: 200 })
                }
            })
        },
        SESSIONS: kv as unknown as KVNamespace,
        NODE_ENV: 'test'
    }
}

test('rate-limit middleware rejects the 31st request in a minute',
    async (t) => {
        const kv = new MemoryKv()
        let now = 1_000
        let hits = 0
        const app = new Hono<{
            Bindings:{ SESSIONS:KVNamespace }
        }>()

        app.use('*', createRateLimitMiddleware({
            bucketSize: 30,
            windowSeconds: 60,
            key: () => 'did:plc:alice',
            now: () => now
        }))
        app.get('/limited', (c) => {
            hits += 1
            return c.text('ok')
        })

        for (let i = 0; i < 30; i++) {
            const res = await app.request(
                'https://rsss.space/limited',
                {},
                { SESSIONS: kv as unknown as KVNamespace }
            )
            t.equal(res.status, 200, `request ${i + 1} passes`)
        }

        const limited = await app.request(
            'https://rsss.space/limited',
            {},
            { SESSIONS: kv as unknown as KVNamespace }
        )
        const body = await limited.json() as { error?:string }

        t.equal(limited.status, 429, '31st request is rate-limited')
        t.equal(limited.headers.get('Retry-After'), '2')
        t.equal(body.error, 'rate_limited')
        t.equal(hits, 30, 'limited request does not reach handler')
        t.deepEqual(
            Array.from(kv.ttlByKey.values()),
            [60],
            'bucket state uses a window-length TTL'
        )

        now += 60_000
        const nextWindow = await app.request(
            'https://rsss.space/limited',
            {},
            { SESSIONS: kv as unknown as KVNamespace }
        )

        t.equal(
            nextWindow.status,
            200,
            'first request in the next window passes'
        )
    }
)

test('data refresh route uses the per-DID rate limit before proxying',
    async (t) => {
        const kv = new MemoryKv()
        const proxyCount = { value: 0 }
        const router = authenticatedDataRouter()
        const env = makeDataEnv(kv, proxyCount)

        for (let i = 0; i < 30; i++) {
            const res = await router.request(
                'https://rsss.space/api/feeds/refresh',
                { method: 'POST' },
                env
            )
            t.equal(res.status, 200, `refresh ${i + 1} is proxied`)
        }

        const limited = await router.request(
            'https://rsss.space/api/feeds/refresh',
            { method: 'POST' },
            env
        )

        t.equal(limited.status, 429)
        t.equal(
            limited.headers.get('Retry-After'),
            '2',
            'over-limit response includes retry timing'
        )
        t.equal(
            proxyCount.value,
            30,
            'over-limit refresh does not reach the Durable Object'
        )
    }
)
