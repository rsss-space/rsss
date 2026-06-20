import { DurableObject } from 'cloudflare:workers'
import { Hono } from 'hono'
import {
    drainOnce,
    openJetstreamSocketWithFailover,
    type DrainDeps
} from '../indexer/drain.js'
import { applyCommit } from '../indexer/apply-commit.js'
import type { JetstreamEvent } from '../indexer/types.js'

/**
 * RsssIndexerDO: Global singleton ingestion indexer (read-only on the client side).
 *
 * Freshness and retention contract:
 * - The index trails the live network by up to one alarm interval
 *   (DRAIN_INTERVAL_MS, ~60s) plus firehose propagation. The feed does not need
 *   sub-second freshness; if it ever does, this is the wrong design.
 * - First run with no saved cursor starts **live-from-now** (approved cold-start),
 *   so records committed before the singleton's first construction are not indexed.
 * - Jetstream retains only a bounded replay window (the server's `event-ttl`,
 *   **~24h by default**, operator-configurable). If the indexer is down longer
 *   than that window, cursor replay cannot fill the gap and those records are
 *   permanently missed.
 * - Full history (older than the replay window) is NOT a Jetstream job and is out
 *   of scope here — backfill via `com.atproto.repo.listRecords` per DID or a
 *   Hubble mirror is a separate, one-shot process (deferred per the spec).
 */

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
const DRAIN_INTERVAL_MS = 60_000           // 60s (spec default)
const OVERDUE_ALARM_REARM_DELAY_MS = 5_000

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
            await this.ensureDrainArmed()
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

    async alarm ():Promise<void> {
        // Reschedule first: a throw in the drain must not strand the alarm.
        await this.scheduleNextDrain()
        try {
            await this.runDrain()
        } catch (err) {
            // Next tick retries from the saved cursor; writes are idempotent.
            console.error('indexer drain failed', err)
        }
    }

    private async scheduleNextDrain ():Promise<void> {
        await this.ctx.storage.setAlarm(Date.now() + DRAIN_INTERVAL_MS)
    }

    private async ensureDrainArmed ():Promise<void> {
        const existing = await this.ctx.storage.getAlarm()
        if (existing == null) {
            await this.ctx.storage.setAlarm(Date.now() + DRAIN_INTERVAL_MS)
            return
        }
        if (existing <= Date.now()) {
            await this.ctx.storage.setAlarm(
                Date.now() + OVERDUE_ALARM_REARM_DELAY_MS
            )
        }
    }

    // Injectable for tests; production uses the failover opener — primary
    // host, then secondary on an open failure (Phase 4 drain.ts).
    protected drainDeps ():DrainDeps {
        return { open: openJetstreamSocketWithFailover }
    }

    protected async runDrain ():Promise<void> {
        const cursor = await this.getCursor()        // null => live-from-now
        const next = await drainOnce(
            this.drainDeps(),
            (evt:JetstreamEvent) => applyCommit(this.sql, evt),
            cursor
        )
        if (next > (cursor ?? 0)) await this.setCursor(next)
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

        app.post('/internal/dev/drain-now', async (c) => {
            if (this.env?.NODE_ENV !== 'development') return c.notFound()
            const before = Number((this.sql.exec(
                'SELECT count(*) AS c FROM items').one() as { c:number }).c)
            await this.runDrain()
            const after = Number((this.sql.exec(
                'SELECT count(*) AS c FROM items').one() as { c:number }).c)
            return c.json({
                before,
                after,
                newItems: after - before,
                cursor: await this.getCursor()
            })
        })

        return app
    }
}
