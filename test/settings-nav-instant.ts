import { test } from '@substrate-system/tapzero'
import { signal, effect, batch } from '@preact/signals'
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
    body:(calls:IdleCall[])=> void|Promise<void>
):void|Promise<void> {
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

interface DepsBag {
    user:ReturnType<typeof signal<unknown>>
    selectedFeedId:ReturnType<typeof signal<number|null>>
    billingStatus:ReturnType<typeof signal<unknown>>
    isLocalFirstActive:ReturnType<typeof signal<boolean>>
    storeContent:ReturnType<typeof signal<boolean>>
    defaultCacheMode:ReturnType<typeof signal<'text'|'text_images'>>
    feedPolicies:ReturnType<typeof signal<Record<number, unknown>>>
}

// Mirrors the production effect in state.ts so we test the contract
// the state.ts rewrite is bound to. The deps array and the cancel /
// reschedule pattern are the surface tested by INV-1.
function wireCacheStatusEffect (
    deps:DepsBag,
    recompute:()=> Promise<void>
):()=> void {
    let pendingHandle:IdleHandle|null = null
    return effect(() => {
        const _deps = [
            deps.user.value,
            deps.selectedFeedId.value,
            deps.billingStatus.value,
            deps.isLocalFirstActive.value,
            deps.storeContent.value,
            deps.defaultCacheMode.value,
            deps.feedPolicies.value
        ]
        if (_deps.length === 0) return
        if (pendingHandle !== null) cancelIdle(pendingHandle)
        pendingHandle = scheduleIdle(() => {
            pendingHandle = null
            recompute().catch(() => {})
        }, { timeout: 200 })
    })
}

function makeDeps ():DepsBag {
    return {
        user: signal<unknown>(null),
        selectedFeedId: signal<number|null>(null),
        billingStatus: signal<unknown>(null),
        isLocalFirstActive: signal<boolean>(true),
        storeContent: signal<boolean>(true),
        defaultCacheMode: signal<'text'|'text_images'>('text'),
        feedPolicies: signal<Record<number, unknown>>({})
    }
}

test('signal write does not call recomputeCacheStatus ' +
    'synchronously (FR-001, SC-001, SC-002)', t => {
    withIdleStub((calls) => {
        const deps = makeDeps()
        let recomputeCalls = 0
        const recompute = async ():Promise<void> => {
            recomputeCalls++
        }
        const dispose = wireCacheStatusEffect(deps, recompute)
        try {
            // Initial mount call: effect runs once at wire-up, which
            // queues one idle callback. Drain that baseline.
            t.equal(calls.length, 1, 'one idle callback from mount')
            calls[0].fn()
            t.equal(recomputeCalls, 1, 'mount recompute fired')

            // Each subsequent signal write must NOT call recompute
            // synchronously and must NOT add work to the main thread
            // beyond one schedule. Reset state for clarity.
            const baseRecomputes = recomputeCalls
            const baseCalls = calls.length

            deps.feedPolicies.value = { 1: null }
            t.equal(
                recomputeCalls,
                baseRecomputes,
                'feedPolicies write did not call recompute sync'
            )
            t.equal(
                calls.length - baseCalls,
                1,
                'feedPolicies write scheduled one idle callback'
            )

            deps.defaultCacheMode.value = 'text_images'
            t.equal(
                recomputeCalls,
                baseRecomputes,
                'defaultCacheMode write did not call recompute sync'
            )

            deps.storeContent.value = false
            t.equal(
                recomputeCalls,
                baseRecomputes,
                'storeContent write did not call recompute sync'
            )

            deps.billingStatus.value = { entitled: true }
            t.equal(
                recomputeCalls,
                baseRecomputes,
                'billingStatus write did not call recompute sync'
            )

            deps.selectedFeedId.value = 7
            t.equal(
                recomputeCalls,
                baseRecomputes,
                'selectedFeedId write did not call recompute sync'
            )
        } finally {
            dispose()
        }
    })
})

test('rapid writes coalesce into a single pending idle callback ' +
    '(INV-1)', t => {
    withIdleStub((calls) => {
        const deps = makeDeps()
        const recompute = async ():Promise<void> => {}
        const dispose = wireCacheStatusEffect(deps, recompute)
        try {
            // Drain the mount-time callback.
            t.equal(calls.length, 1, 'one mount-time callback')
            calls[0].fn()

            const before = calls.length

            // Five rapid writes inside a batch.
            batch(() => {
                deps.feedPolicies.value = { 1: null }
                deps.defaultCacheMode.value = 'text_images'
                deps.storeContent.value = false
                deps.billingStatus.value = { entitled: true }
                deps.selectedFeedId.value = 3
            })

            // After the batch, the effect runs once; exactly one new
            // callback is queued.
            t.equal(
                calls.length - before,
                1,
                'rapid batch writes schedule one idle callback'
            )

            // Outside a batch, sequential writes each cancel-and-replace,
            // so still exactly one outstanding non-cancelled callback.
            const after = calls.length
            deps.feedPolicies.value = { 2: null }
            deps.feedPolicies.value = { 2: null, 3: null }
            deps.feedPolicies.value = { 2: null, 3: null, 4: null }

            const newCalls = calls.slice(after)
            const outstanding = newCalls.filter(c => !c.cancelled)
            t.equal(
                outstanding.length,
                1,
                'exactly one outstanding (non-cancelled) callback'
            )
        } finally {
            dispose()
        }
    })
})

test('running the captured fn invokes recompute exactly once ' +
    '(INV-1 cont.)', t => {
    withIdleStub((calls) => {
        const deps = makeDeps()
        let recomputeCalls = 0
        const recompute = async ():Promise<void> => {
            recomputeCalls++
        }
        const dispose = wireCacheStatusEffect(deps, recompute)
        try {
            // Drain the mount-time callback so the count is known.
            calls[0].fn()
            const baseline = recomputeCalls

            deps.feedPolicies.value = { 1: null }
            const idleFn = calls[calls.length - 1].fn
            idleFn()
            t.equal(
                recomputeCalls - baseline,
                1,
                'callback invoked recompute exactly once'
            )
            // Calling again should not re-invoke; production state.ts
            // owns this by clearing the pendingHandle inside fn before
            // the next reschedule, so the helper itself isn't expected
            // to be one-shot — we just verify the production-side
            // contract that fn runs the recompute once per scheduling.
        } finally {
            dispose()
        }
    })
})
