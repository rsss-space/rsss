import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

export interface RegistryEnv {
    NODE_ENV?:string
    SENTRY_DSN?:string
}

export interface KnownUser {
    did:string
    handle:string
    avatar:string|null
}

const REGISTRY_SQL = `
    CREATE TABLE IF NOT EXISTS known_users (
        did TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        avatar TEXT,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
`

export class RsssRegistryDO extends DurableObject<RegistryEnv> {
    private sql:SqlStorage
    private app:Hono

    constructor (ctx:DurableObjectState, env:RegistryEnv) {
        super(ctx, env)
        this.sql = ctx.storage.sql
        ctx.blockConcurrencyWhile(async () => {
            this.sql.exec(REGISTRY_SQL)
        })
        this.app = this.createRouter()
    }

    async fetch (request:Request):Promise<Response> {
        return this.app.fetch(request)
    }

    private createRouter ():Hono {
        const app = new Hono()

        app.post('/upsert', async (c) => {
            const body = await c.req.json<{
                did?:unknown
                handle?:unknown
                avatar?:unknown
            }>()

            if (typeof body.did !== 'string' || !body.did) {
                return c.json({ error: 'did is required' }, 400)
            }
            if (typeof body.handle !== 'string' || !body.handle) {
                return c.json({ error: 'handle is required' }, 400)
            }
            const avatar = typeof body.avatar === 'string' ?
                body.avatar : null

            this.sql.exec(
                `INSERT INTO known_users (did, handle, avatar, updated_at)
                VALUES (?, ?, ?, datetime('now'))
                ON CONFLICT(did) DO UPDATE SET
                    handle = excluded.handle,
                    avatar = excluded.avatar,
                    updated_at = excluded.updated_at`,
                body.did,
                body.handle,
                avatar
            )

            return new Response(null, { status: 204 })
        })

        app.get('/lookup/:did', (c) => {
            const did = c.req.param('did')
            const row = this.sql.exec(
                'SELECT did, handle, avatar FROM known_users WHERE did = ?',
                did
            ).toArray()[0] as unknown as KnownUser | undefined ?? null

            if (!row) {
                return c.json({ known: false }, 200)
            }

            return c.json({ known: true, ...row }, 200)
        })

        app.post('/batch-lookup', async (c) => {
            const body = await c.req.json<{ dids?:unknown }>()
            if (!Array.isArray(body.dids)) {
                return c.json({ error: 'dids must be an array' }, 400)
            }

            const dids = body.dids.filter(
                (d):d is string => typeof d === 'string'
            )

            if (dids.length === 0) {
                return c.json({ users: [] }, 200)
            }

            const placeholders = dids.map(() => '?').join(', ')
            const rows = this.sql.exec(
                `SELECT did, handle, avatar FROM known_users
                WHERE did IN (${placeholders})`,
                ...dids
            ).toArray() as unknown as KnownUser[]

            return c.json({ users: rows }, 200)
        })

        return app
    }
}
