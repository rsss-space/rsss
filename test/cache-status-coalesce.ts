import { test } from '@substrate-system/tapzero'
import { signal, effect } from '@preact/signals'
import {
    scheduleIdle,
    cancelIdle,
    type IdleHandle
} from '../src/client/util/schedule-idle.js'

interface IdleCall {
    id:number
    fn:()=> void
    cancelled:boolean
}

interface MaybeIdleWindow {
    requestIdleCallback?:unknown
    cancelIdleCallback?:unknown
}

function withIdleStub (
    body:(calls:IdleCall[])=> void
):void {
    const w = window as unknown as MaybeIdleWindow
    const prevReq = w.requestIdleCallback
    const prevCancel = w.cancelIdleCallback
    const calls:IdleCall[] = []
    let nextId = 1
    w.requestIdleCallback = (fn:()=> void):number => {
        const id = nextId++
        calls.push({ id, fn, cancelled: false })
        return id
    }
    w.cancelIdleCallback = (id:number):void => {
        const match = calls.find(c => c.id === id)
        if (match) match.cancelled = true
    }
    try {
        body(calls)
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

// Test INV-2: three rapid writes produce at most one outstanding
// IdleHandle (each write cancels its predecessor), and after the
// captured callback fires, recomputeCacheStatus is invoked exactly
// once.
test('rapid feedPolicies writes coalesce to one recompute (INV-2)',
    t => {
        withIdleStub((calls) => {
            const feedPolicies = signal<Record<number, unknown>>({})
            let recomputeCalls = 0
            const recompute = async ():Promise<void> => {
                recomputeCalls++
            }

            let pendingHandle:IdleHandle|null = null
            const dispose = effect(() => {
                const _deps = [feedPolicies.value]
                if (_deps.length === 0) return
                if (pendingHandle !== null) cancelIdle(pendingHandle)
                pendingHandle = scheduleIdle(() => {
                    pendingHandle = null
                    recompute().catch(() => {})
                }, { timeout: 200 })
            })

            try {
            // Drain the mount callback so we are at a clean baseline.
                t.equal(calls.length, 1, 'mount queued one callback')
                calls[0].fn()
                t.equal(recomputeCalls, 1, 'mount recompute ran')

                const baselineRecomputes = recomputeCalls
                const baselineCalls = calls.length

                feedPolicies.value = { 1: null }
                feedPolicies.value = { 1: null, 2: null }
                feedPolicies.value = { 1: null, 2: null, 3: null }

                const newCalls = calls.slice(baselineCalls)
                t.equal(
                    newCalls.length,
                    3,
                    'three writes scheduled three callbacks'
                )
                const cancelled = newCalls.filter(c => c.cancelled).length
                t.equal(
                    cancelled,
                    2,
                    'first two callbacks were cancelled'
                )
                const outstanding = newCalls.filter(c => !c.cancelled)
                t.equal(
                    outstanding.length,
                    1,
                    'exactly one outstanding callback after rapid writes'
                )

                // Drain the surviving callback; recompute fires once.
                outstanding[0].fn()
                t.equal(
                    recomputeCalls - baselineRecomputes,
                    1,
                    'recompute was called exactly once after coalesce'
                )
            } finally {
                dispose()
            }
        })
    })

test('after a callback fires, the next write schedules a fresh ' +
    'callback (INV-2 cont.)', t => {
    withIdleStub((calls) => {
        const feedPolicies = signal<Record<number, unknown>>({})
        let recomputeCalls = 0
        const recompute = async ():Promise<void> => {
            recomputeCalls++
        }

        let pendingHandle:IdleHandle|null = null
        const dispose = effect(() => {
            const _deps = [feedPolicies.value]
            if (_deps.length === 0) return
            if (pendingHandle !== null) cancelIdle(pendingHandle)
            pendingHandle = scheduleIdle(() => {
                pendingHandle = null
                recompute().catch(() => {})
            }, { timeout: 200 })
        })

        try {
            // Drain mount.
            calls[0].fn()

            feedPolicies.value = { 1: null }
            const cb1 = calls[calls.length - 1]
            cb1.fn()
            t.equal(recomputeCalls, 2, 'first deferred recompute ran')

            feedPolicies.value = { 1: null, 2: null }
            const cb2 = calls[calls.length - 1]
            t.notEqual(cb1.id, cb2.id, 'second callback is a new handle')
            cb2.fn()
            t.equal(recomputeCalls, 3, 'second deferred recompute ran')
        } finally {
            dispose()
        }
    })
})
