import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'

export interface IndexerEnv {
    NODE_ENV?:string
    SENTRY_DSN?:string
}

export interface IndexItem {
    uri:string
    did:string
    collection:string
    rkey:string
    cid:string
    record:string
    time_us:number
    indexed_at:number
}

const CURSOR_KEY = 'cursor'

export class RsssIndexerDO extends DurableObject<IndexerEnv> {
    private sql:SqlStorage
    private app:Hono

    constructor (ctx:DurableObjectState, env:IndexerEnv) {
        super(ctx, env)
        this.sql = ctx.storage.sql
        ctx.blockConcurrencyWhile(async () => {
            this.sql.exec(
                `CREATE TABLE IF NOT EXISTS items (
                    uri        TEXT PRIMARY KEY,
                    did        TEXT NOT NULL,
                    collection TEXT NOT NULL,
                    rkey       TEXT NOT NULL,
                    cid        TEXT NOT NULL,
                    record     TEXT NOT NULL,
                    time_us    INTEGER NOT NULL,
                    indexed_at INTEGER NOT NULL
                )`
            )
            this.sql.exec(
                'CREATE INDEX IF NOT EXISTS items_by_did ON items(did)'
            )
            this.sql.exec(
                `CREATE INDEX IF NOT EXISTS items_by_coll
                    ON items(collection, time_us)`
            )
        })
        this.app = this.createRouter()
    }

    async fetch (request:Request):Promise<Response> {
        return this.app.fetch(request)
    }

    private async getCursor ():Promise<number|null> {
        return (await this.ctx.storage.get<number>(CURSOR_KEY)) ?? null
    }

    private async setCursor (next:number):Promise<void> {
        await this.ctx.storage.put(CURSOR_KEY, next)
    }

    private createRouter ():Hono {
        const app = new Hono()

        // Scaffolding route used by later dev verification (Phases 5–6).
        // Its behavioral test lands with the Phase 6 read API.
        app.get('/internal/index/stats', async (c) => {
            const count = Number(
                (this.sql.exec('SELECT count(*) AS c FROM items')
                    .one() as { c:number|string }).c
            )
            const cursor = await this.getCursor()
            return c.json({ items: count, cursor })
        })

        return app
    }
}
