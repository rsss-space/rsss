import type { JetstreamEvent } from './types.js'

export type { JetstreamEvent }

export const MAX_WALL_MS = 20_000      // backstop, well under DO limits
export const IDLE_MS = 2_000           // quiet => replay buffer drained
export const CAUGHT_UP_US = 5_000_000  // within 5s of now => live edge

// https:// (not wss://) — Workers fetch upgrades https + Upgrade header.
export const JETSTREAM_HOSTS = [
    'https://jetstream1.us-east.bsky.network/subscribe',
    'https://jetstream2.us-west.bsky.network/subscribe'
]
const WANTED = ['space.rsss.*']

export function jetstreamUrl (
    cursor:number|null,
    base:string = JETSTREAM_HOSTS[0]
):string {
    const url = new URL(base)
    for (const c of WANTED) url.searchParams.append('wantedCollections', c)
    if (cursor !== null) url.searchParams.set('cursor', String(cursor))
    return url.toString()
}

export interface DrainSocket {
    addEventListener(t:'message', cb:(ev:{ data:string }) => void):void
    addEventListener(t:'close', cb:() => void):void
    addEventListener(t:'error', cb:(err:unknown) => void):void
    close():void
}

export interface DrainDeps {
    open:(url:string) => Promise<DrainSocket>
    now?:() => number
    maxWallMs?:number
    idleMs?:number
    caughtUpUs?:number
}

export async function drainOnce (
    deps:DrainDeps,
    apply:(evt:JetstreamEvent) => void | Promise<void>,
    cursor:number|null
):Promise<number> {
    const now = deps.now ?? Date.now
    const maxWallMs = deps.maxWallMs ?? MAX_WALL_MS
    const idleMs = deps.idleMs ?? IDLE_MS
    const caughtUpUs = deps.caughtUpUs ?? CAUGHT_UP_US

    const ws = await deps.open(jetstreamUrl(cursor))
    let last = cursor ?? 0
    const deadline = now() + maxWallMs

    return await new Promise<number>((resolve, reject) => {
        let idle:ReturnType<typeof setTimeout> | undefined
        let chain:Promise<void> = Promise.resolve()
        let stopped = false

        const finish = (fn:() => void) => {
            if (stopped) return
            stopped = true
            if (idle !== undefined) clearTimeout(idle)
            try { ws.close() } catch {}
            fn()
        }
        const stop = () => finish(() => resolve(last))
        const fail = (err:unknown) => finish(() => reject(err))
        const bumpIdle = () => {
            if (idle !== undefined) clearTimeout(idle)
            idle = setTimeout(stop, idleMs)
        }

        ws.addEventListener('message', (ev) => {
            if (stopped) return
            bumpIdle()
            let evt:JetstreamEvent
            try {
                evt = JSON.parse(ev.data) as JetstreamEvent
            } catch {
                return  // skip malformed frame, keep draining
            }
            // Serialize: persist in order; advance cursor only after persist.
            chain = chain.then(async () => {
                if (stopped) return
                if (evt.kind === 'commit') await apply(evt)
                last = evt.time_us
                const stale = now() * 1000 - evt.time_us
                if (now() > deadline || stale < caughtUpUs) stop()
            }).catch(fail) // persist failure => no cursor advance this tick
        })
        ws.addEventListener('close', stop)
        ws.addEventListener('error', fail)
        bumpIdle()
    })
}

export async function openJetstreamSocket (url:string):Promise<DrainSocket> {
    // `Response.webSocket` is the real Cloudflare Workers runtime field — it is
    // only present on the response of an `Upgrade: websocket` fetch in the
    // Workers runtime (not Node). This function runs only on the live edge;
    // tests inject a fake opener and never call it.
    const resp = await fetch(url, { headers: { Upgrade: 'websocket' } })
    const ws = (resp as unknown as { webSocket:DrainSocket | null }).webSocket
    if (!ws) throw new Error('jetstream: no websocket in response')
    ;(ws as unknown as { accept():void }).accept()
    return ws
}

// Try the primary host; on an open failure, retry the secondary, preserving
// the query string. `open` is injectable so this is unit-testable (AC3.9).
export async function openJetstreamSocketWithFailover (
    url:string,
    open:(u:string) => Promise<DrainSocket> = openJetstreamSocket
):Promise<DrainSocket> {
    try {
        return await open(url)
    } catch {
        const alt = new URL(JETSTREAM_HOSTS[1])
        alt.search = new URL(url).search
        return await open(alt.toString())
    }
}
