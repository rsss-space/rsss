import { RsssUserDO } from '../src/server/durable-objects/index.js'

type WebSocketPairCtor = new (request:string, response:string) => {
    request:string
    response:string
}

const workerGlobal = globalThis as typeof globalThis & {
    WebSocketRequestResponsePair?:WebSocketPairCtor
}

if (typeof workerGlobal.WebSocketRequestResponsePair !== 'function') {
    workerGlobal.WebSocketRequestResponsePair = class {
        request:string
        response:string

        constructor (request:string, response:string) {
            this.request = request
            this.response = response
        }
    }
}

// Test fixture: per-account bookkeeping helpers no-op (writes) /
// return undefined (reads) when a test harness omits `ctx.storage`.
// Production always has `ctx.storage` via the Cloudflare runtime, so
// this only relaxes test-side requirements; tests that want to
// verify the bookkeeping continue to attach their own storage stub
// and observe writes through it.

interface DoCtx {
    storage?:unknown
    getWebSockets?:() => WebSocket[]
}
type ReadHelper<T> = (this:{ ctx:DoCtx }, ...args:unknown[]) =>
    Promise<T|undefined>
type WriteHelper = (this:{ ctx:DoCtx }, ...args:unknown[]) =>
    Promise<void>
// Relax broadcast for harnesses whose ctx lacks getWebSockets: no-op
// in that case, otherwise delegate to the REAL implementation so tests
// that attach a ctx.getWebSockets stub (e.g. do-handlers) still
// exercise the real code path. Mirrors the read/write wrappers below.
const origBroadcast = (RsssUserDO.prototype as unknown as {
    broadcast:(event:string, data:unknown) => void
}).broadcast
;(RsssUserDO.prototype as unknown as {
    broadcast:(event:string, data:unknown) => void
}).broadcast = function (
    this:{ ctx:DoCtx },
    event:string,
    data:unknown
):void {
    if (
        !this.ctx ||
        typeof this.ctx.getWebSockets !== 'function'
    ) return
    origBroadcast.call(this, event, data)
}

const proto = RsssUserDO.prototype as unknown as Record<
    string,
    (...args:unknown[]) => Promise<unknown>
>
const writeKeys = [
    'writeLastAnySuccess',
    'writeAccountActivity',
    'writePollerFeedState',
    'deletePollerFeedState'
]
for (const key of writeKeys) {
    const orig = proto[key] as WriteHelper|undefined
    if (!orig) continue
    proto[key] = async function (
        this:{ ctx:DoCtx },
        ...args:unknown[]
    ) {
        if (!this.ctx || !this.ctx.storage) return
        return orig.call(this, ...args)
    } as unknown as (...args:unknown[]) => Promise<unknown>
}
const readKeys = [
    'readLastAnySuccess',
    'readAccountActivity',
    'readPollerFeedState'
]
for (const key of readKeys) {
    const orig = proto[key] as ReadHelper<unknown>|undefined
    if (!orig) continue
    proto[key] = async function (
        this:{ ctx:DoCtx },
        ...args:unknown[]
    ) {
        if (!this.ctx || !this.ctx.storage) return undefined
        return orig.call(this, ...args)
    } as unknown as (...args:unknown[]) => Promise<unknown>
}
