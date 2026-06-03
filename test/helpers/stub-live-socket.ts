type EventListenerFn = (ev:MessageEvent|Event) => void

/**
 * Test double for the browser WebSocket the live channel now uses.
 * `fire(event, data)` translates a logical server event into the
 * on-the-wire frame the client receives: lifecycle events
 * ('open'/'error'/'close') dispatch as-is; anything else is delivered
 * as a single 'message' event carrying JSON.stringify({ event, data }),
 * matching the server's broadcast envelope.
 */
export class StubWebSocket {
    static instances:StubWebSocket[] = []
    static OPEN = 1

    url:string
    readyState = 0
    listeners:Record<string, EventListenerFn[]> = {}
    sent:string[] = []
    closed = false

    constructor (url:string) {
        this.url = url
        StubWebSocket.instances.push(this)
    }

    addEventListener (event:string, listener:EventListenerFn) {
        (this.listeners[event] ??= []).push(listener)
    }

    removeEventListener (event:string, listener:EventListenerFn) {
        const list = this.listeners[event]
        if (!list) return
        this.listeners[event] = list.filter(fn => fn !== listener)
    }

    send (data:string) {
        this.sent.push(data)
    }

    close () {
        this.closed = true
    }

    fire (event:string, data?:unknown) {
        if (
            event === 'open' ||
            event === 'error' ||
            event === 'close'
        ) {
            if (event === 'open') this.readyState = StubWebSocket.OPEN
            const ev = new Event(event)
            for (const fn of this.listeners[event] ?? []) fn(ev)
            return
        }
        const payload = JSON.stringify({ event, data })
        const ev = new MessageEvent('message', { data: payload })
        for (const fn of this.listeners.message ?? []) fn(ev)
    }
}

/** Install the stub for the duration of `fn`, then restore. */
export function withStubbedWebSocket<T> (
    fn:() => Promise<T>
):Promise<T> {
    const restore = stubWebSocket()
    return fn().finally(restore)
}

/** Install the stub and return a restore function. */
export function stubWebSocket ():() => void {
    const g = globalThis as { WebSocket?:typeof WebSocket }
    const original = g.WebSocket
    StubWebSocket.instances = []
    ;(globalThis as { WebSocket:unknown })
        .WebSocket = StubWebSocket as unknown as typeof WebSocket
    return () => {
        g.WebSocket = original
        StubWebSocket.instances = []
    }
}
