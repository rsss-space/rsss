import { test } from '@substrate-system/tapzero'
import {
    scheduleIdle,
    cancelIdle,
    type IdleHandle
} from '../src/client/util/schedule-idle.js'

interface MaybeIdleWindow {
    requestIdleCallback?:unknown
    cancelIdleCallback?:unknown
}

function withIdleStub<T> (
    body:(
        idleCalls:Array<{
            id:number
            fn:()=> void
            timeout:number|undefined
            cancelled:boolean
        }>
    )=> T
):T {
    const w = window as unknown as MaybeIdleWindow
    const prevReq = w.requestIdleCallback
    const prevCancel = w.cancelIdleCallback
    const calls:Array<{
        id:number
        fn:()=> void
        timeout:number|undefined
        cancelled:boolean
    }> = []
    let nextId = 1
    w.requestIdleCallback = (
        fn:()=> void,
        opts?:{ timeout?:number }
    ):number => {
        const id = nextId++
        calls.push({ id, fn, timeout: opts?.timeout, cancelled: false })
        return id
    }
    w.cancelIdleCallback = (id:number):void => {
        const match = calls.find(c => c.id === id)
        if (match) match.cancelled = true
    }
    try {
        return body(calls)
    } finally {
        if (prevReq === undefined) {
            delete w.requestIdleCallback
        } else {
            w.requestIdleCallback = prevReq
        }
        if (prevCancel === undefined) {
            delete w.cancelIdleCallback
        } else {
            w.cancelIdleCallback = prevCancel
        }
    }
}

function withoutIdle<T> (body:()=> T):T {
    const w = window as unknown as MaybeIdleWindow
    const prevReq = w.requestIdleCallback
    const prevCancel = w.cancelIdleCallback
    delete w.requestIdleCallback
    delete w.cancelIdleCallback
    try {
        return body()
    } finally {
        if (prevReq !== undefined) w.requestIdleCallback = prevReq
        if (prevCancel !== undefined) w.cancelIdleCallback = prevCancel
    }
}

test('scheduleIdle returns a {kind,id} token', t => {
    withIdleStub((_calls) => {
        const handle = scheduleIdle(() => {})
        t.ok(
            handle && typeof handle === 'object',
            'handle is an object'
        )
        t.equal(handle.kind, 'idle', 'kind is idle when rIC available')
        t.equal(typeof handle.id, 'number', 'id is a number')
        cancelIdle(handle)
    })
})

test('scheduleIdle uses requestIdleCallback when available', t => {
    withIdleStub((calls) => {
        let called = 0
        const handle = scheduleIdle(() => { called++ }, { timeout: 250 })
        t.equal(handle.kind, 'idle', 'used rIC path')
        t.equal(calls.length, 1, 'one rIC scheduled')
        t.equal(calls[0].timeout, 250, 'timeout forwarded')
        t.equal(called, 0, 'fn not called synchronously')
        calls[0].fn()
        t.equal(called, 1, 'fn ran when rIC fired')
    })
})

test('scheduleIdle defaults timeout to 200ms', t => {
    withIdleStub((calls) => {
        scheduleIdle(() => {})
        t.equal(calls[0].timeout, 200, 'default timeout is 200')
    })
})

test('scheduleIdle falls back to setTimeout when rIC missing', t => {
    return withoutIdle(() => {
        let called = 0
        const handle = scheduleIdle(() => { called++ })
        t.equal(handle.kind, 'timeout', 'kind is timeout fallback')
        t.equal(typeof handle.id, 'number', 'id is a number')
        t.equal(called, 0, 'fn not called synchronously')
        return new Promise<void>(resolve => {
            setTimeout(() => {
                t.equal(called, 1, 'fn ran after a task tick')
                resolve()
            }, 5)
        })
    })
})

test('cancelIdle before fire prevents the call (rIC path)', t => {
    withIdleStub((calls) => {
        let called = 0
        const handle = scheduleIdle(() => { called++ })
        cancelIdle(handle)
        t.equal(calls[0].cancelled, true, 'cancel routed to rIC')
        // Even if we manually invoke the captured fn, our outer
        // bookkeeping should agree it was cancelled.
        t.equal(called, 0, 'fn not called yet')
    })
})

test('cancelIdle before fire prevents the call (timeout path)', t => {
    return withoutIdle(() => {
        let called = 0
        const handle = scheduleIdle(() => { called++ })
        cancelIdle(handle)
        return new Promise<void>(resolve => {
            setTimeout(() => {
                t.equal(called, 0, 'fn never ran after cancel')
                resolve()
            }, 10)
        })
    })
})

test('cancelIdle(null) is a no-op', t => {
    cancelIdle(null)
    t.ok(true, 'no throw')
})

test('cancelIdle is idempotent (double cancel)', t => {
    withIdleStub(() => {
        const handle:IdleHandle = scheduleIdle(() => {})
        cancelIdle(handle)
        cancelIdle(handle)
        t.ok(true, 'no throw on double cancel')
    })
})
