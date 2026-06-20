/**
 * Tests for the indexer drain alarm scheduling and runDrain.
 *
 * Tests the RsssIndexerDO alarm scheduling contract:
 * - alarm() reschedules BEFORE running the drain (AC4.1)
 * - ensureDrainArmed cold-start arms at now + DRAIN_INTERVAL_MS (AC4.2)
 * - ensureDrainArmed overdue re-arm at now + OVERDUE_ALARM_REARM_DELAY_MS
 *   (AC4.3)
 * - ensureDrainArmed idempotent when future alarm exists (AC4.4)
 * - runDrain() persists advanced cursor via real drainDeps seam (AC4.5)
 * - dev drain-now route 404s outside development via real router (AC4.6)
 */
import { test } from '@substrate-system/tapzero'
import { RsssIndexerDO } from '../src/server/durable-objects/indexer.js'
import { fakeResult } from './helpers/sql-fake.js'
import type { DrainSocket, DrainDeps } from '../src/server/indexer/drain.js'

// FakeSocket implementing DrainSocket for tests
class FakeSocket implements DrainSocket {
    closed = false
    emittedTime_us:number|null = null

    private listeners:Map<
        'message' | 'close' | 'error',
        Array<(ev:unknown) => void>
    > = new Map()

    addEventListener (
        t:'message',
        cb:(ev:{ data:string }) => void
    ):void

    addEventListener (
        t:'close',
        cb:() => void
    ):void

    addEventListener (
        t:'error',
        cb:(err:unknown) => void
    ):void

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    addEventListener (t:any, cb:any):void {
        if (!this.listeners.has(t)) {
            this.listeners.set(t, [])
        }
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        this.listeners.get(t)!.push(cb)
    }

    close ():void {
        this.closed = true
    }

    emitMessage (data:string):void {
        const cbs = this.listeners.get('message')
        if (cbs) {
            for (const cb of cbs) {
                cb({ data })
            }
        }
    }

    emitClose ():void {
        const cbs = this.listeners.get('close')
        if (cbs) {
            for (const cb of cbs) {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-call
                (cb as (() => void))()
            }
        }
    }
}

function createIndexerDo (initial:{
    existingAlarm:number|null;
    cursorValue:number|null;
}|null) {
    const setAlarms:number[] = []
    const stored = new Map<string, unknown>()
    let cursorValue = initial?.cursorValue ?? null
    let existingAlarm = initial?.existingAlarm ?? null
    let drainDepsOverride:DrainDeps|null = null

    // Create a subclass so we can access protected methods
    class TestableIndexerDO extends RsssIndexerDO {
        getSetAlarms ():number[] {
            return setAlarms
        }

        setExistingAlarm (t:number|null):void {
            existingAlarm = t
        }

        setDrainDeps (deps:DrainDeps):void {
            drainDepsOverride = deps
        }

        // Override protected method to inject test deps
        protected override drainDeps ():DrainDeps {
            if (drainDepsOverride) return drainDepsOverride
            return { open: async () => new FakeSocket() }
        }
    }

    const indexerDo = Object.create(TestableIndexerDO.prototype) as {
        sql:{ exec:(query:string, ...params:unknown[]) => ReturnType<typeof fakeResult> }
        ctx:{ storage:{
            get:<T>(key:string) => Promise<T | undefined>
            put:(key:string, value:unknown) => Promise<void>
            setAlarm:(time:number) => Promise<void>
            getAlarm:() => Promise<number|null>
        } }
        env:{ NODE_ENV?:string } & Record<string, unknown>
        alarm:() => Promise<void>
        runDrain:() => Promise<void>
        drainDeps:() => DrainDeps
        getCursor:() => Promise<number|null>
        setCursor:(v:number) => Promise<void>
        scheduleNextDrain:() => Promise<void>
        ensureDrainArmed:() => Promise<void>
        fetch:(req:Request) => Promise<Response>
        getSetAlarms:() => number[]
        setExistingAlarm:(t:number|null) => void
        setDrainDeps:(deps:DrainDeps) => void
    }

    indexerDo.sql = {
        exec (query:string) {
            // Return a result with a count of 0 for SELECT count queries
            if (query.includes('SELECT count(*)')) {
                return fakeResult([{ c: 0 }])
            }
            return fakeResult([])
        }
    }

    indexerDo.ctx = {
        storage: {
            get: async <T>(key:string) => {
                if (key === 'cursor') {
                    return cursorValue as unknown as T
                }
                return stored.get(key) as T | undefined
            },
            put: async (key:string, value:unknown) => {
                if (key === 'cursor') {
                    cursorValue = value as number
                } else {
                    stored.set(key, value)
                }
            },
            setAlarm: async (time:number) => {
                setAlarms.push(time)
            },
            getAlarm: async () => {
                return existingAlarm
            }
        }
    }

    indexerDo.env = {
        NODE_ENV: 'test'
    }

    // Bind all the real methods from the prototype
    indexerDo.alarm = RsssIndexerDO.prototype.alarm.bind(indexerDo)
    indexerDo.scheduleNextDrain = (
        RsssIndexerDO.prototype as unknown as Record<string, unknown>
    ).scheduleNextDrain as () => Promise<void>
    indexerDo.scheduleNextDrain = indexerDo.scheduleNextDrain.bind(indexerDo)
    indexerDo.ensureDrainArmed = (
        RsssIndexerDO.prototype as unknown as Record<string, unknown>
    ).ensureDrainArmed as () => Promise<void>
    indexerDo.ensureDrainArmed = indexerDo.ensureDrainArmed.bind(indexerDo)
    indexerDo.runDrain = (
        RsssIndexerDO.prototype as unknown as Record<string, unknown>
    ).runDrain as () => Promise<void>
    indexerDo.runDrain = indexerDo.runDrain.bind(indexerDo)

    // Bind the test helper methods
    indexerDo.getSetAlarms = TestableIndexerDO.prototype.getSetAlarms.bind(indexerDo)
    indexerDo.setExistingAlarm = TestableIndexerDO.prototype
        .setExistingAlarm.bind(indexerDo)
    indexerDo.setDrainDeps = TestableIndexerDO.prototype.setDrainDeps.bind(indexerDo)

    // Override drainDeps via prototype chain
    Object.defineProperty(indexerDo, 'drainDeps', {
        value: function ():DrainDeps {
            if (drainDepsOverride) return drainDepsOverride
            return { open: async () => new FakeSocket() }
        },
        writable: true,
        configurable: true
    })

    Object.defineProperty(indexerDo, 'getCursor', {
        value: async function () {
            return cursorValue
        },
        writable: true,
        configurable: true
    })

    Object.defineProperty(indexerDo, 'setCursor', {
        value: async function (v:number) {
            cursorValue = v
        },
        writable: true,
        configurable: true
    })

    // Manually build the router for fetch
    // Since createRouter is private, we need to get it via bracket access
    const createRouterMethod = (
        RsssIndexerDO.prototype as unknown as Record<string, unknown>
        // eslint-disable-next-line dot-notation
    )['createRouter'] as (this:unknown) => { fetch:(r:Request) => Promise<Response> }

    let app:{ fetch:(r:Request) => Promise<Response> }
    if (createRouterMethod) {
        app = createRouterMethod.call(indexerDo)
    } else {
        // Fallback: basic router that just returns 404
        app = {
            fetch: async () => new Response(null, { status: 404 })
        }
    }

    Object.defineProperty(indexerDo, 'fetch', {
        value: async function (req:Request) {
            // Use the real router for real gate testing
            return app.fetch(req)
        },
        writable: true,
        configurable: true
    })

    return {
        indexerDo,
        setAlarms,
        getCursorValue: () => cursorValue,
        setExistingAlarm: (t:number|null) => { existingAlarm = t },
        setDrainDeps: (deps:DrainDeps) => { drainDepsOverride = deps }
    }
}

test(
    'AC4.1: alarm reschedules before runDrain, swallows errors',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: null
        })
        const callOrder:number[] = []

        // Override runDrain to throw
        Object.defineProperty(harness.indexerDo, 'runDrain', {
            value: async function () {
                callOrder.push(1)
                throw new Error('drain failed')
            },
            writable: true,
            configurable: true
        })

        // Spy on console.error
        const originalError = console.error
        let errorCalled = false
        let errorMessage = ''
        console.error = ((msg:string) => {
            errorCalled = true
            errorMessage = msg
        }) as typeof console.error

        try {
            // Override setAlarm to track order
            const origSetAlarm = harness.indexerDo.ctx.storage.setAlarm
            harness.indexerDo.ctx.storage.setAlarm = async (time:number) => {
                callOrder.push(0)
                await origSetAlarm.call(harness.indexerDo.ctx.storage, time)
            }

            // Should not throw even though runDrain throws
            await harness.indexerDo.alarm()

            t.ok(
                harness.setAlarms.length > 0,
                'alarm was rescheduled via setAlarm'
            )
            t.ok(
                callOrder[0] === 0 && callOrder[1] === 1,
                'reschedule (0) happens before runDrain (1)'
            )
            t.ok(
                errorCalled,
                'console.error was called'
            )
            t.equal(
                errorMessage,
                'indexer drain failed',
                'console.error message matches'
            )
        } finally {
            console.error = originalError
        }
    }
)

test(
    'AC4.2: ensureDrainArmed cold-start arms at now + DRAIN_INTERVAL_MS',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: null
        })

        await harness.indexerDo.ensureDrainArmed()

        t.ok(
            harness.setAlarms.length > 0,
            'setAlarm was called'
        )
        const alarm = harness.setAlarms[0]!
        const now = Date.now()
        const expectedMin = now + 60_000 - 2_000
        const expectedMax = now + 60_000 + 2_000

        t.ok(
            alarm >= expectedMin && alarm <= expectedMax,
            `alarm time ${alarm} is within ±2s of now + 60s`
        )
    }
)

test(
    'AC4.3: ensureDrainArmed re-arms overdue at now + '
        + 'OVERDUE_ALARM_REARM_DELAY_MS',
    async t => {
        const pastTime = Date.now() - 5_000
        const harness = createIndexerDo({
            existingAlarm: pastTime,
            cursorValue: null
        })

        await harness.indexerDo.ensureDrainArmed()

        t.ok(
            harness.setAlarms.length > 0,
            'setAlarm was called for overdue alarm'
        )
        const alarm = harness.setAlarms[0]!
        const now = Date.now()
        const expectedMin = now + 5_000 - 2_000
        const expectedMax = now + 5_000 + 2_000

        t.ok(
            alarm >= expectedMin && alarm <= expectedMax,
            `overdue alarm time ${alarm} is within ±2s of now + 5s`
        )
    }
)

test(
    'AC4.4: ensureDrainArmed idempotent when future alarm exists',
    async t => {
        const futureTime = Date.now() + 100_000
        const harness = createIndexerDo({
            existingAlarm: futureTime,
            cursorValue: null
        })

        await harness.indexerDo.ensureDrainArmed()

        t.equal(
            harness.setAlarms.length,
            0,
            'no setAlarm call when future alarm exists'
        )
    }
)

test(
    'AC4.5: runDrain persists advanced cursor via real drainDeps seam',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: 1000  // Start with an existing cursor
        })

        let setCursorCalled = false
        let setCursorValue:number|null = null
        let drainDepsWasCalled = false
        let drainOnceWasNotCalled = true

        // Spy directly on setCursor
        const origSetCursor = harness.indexerDo.setCursor
        harness.indexerDo.setCursor = async function (v:number) {
            setCursorCalled = true
            setCursorValue = v
            await origSetCursor.call(this, v)
        }

        // Also spy on storage.put to track writes
        const origPut = harness.indexerDo.ctx.storage.put
        harness.indexerDo.ctx.storage.put = async (key:string, value:unknown) => {
            if (key === 'cursor') {
                t.comment(`storage.put('cursor', ${value})`)
            }
            await origPut.call(harness.indexerDo.ctx.storage, key, value)
        }

        // Override drainDeps to return a socket that emits 2 commit events
        // then idles. This exercises the real runDrain body via drainDeps.
        const now = Date.now()
        let capturedUrl:string|null = null

        harness.setDrainDeps({
            open: async (url:string) => {
                drainDepsWasCalled = true
                drainOnceWasNotCalled = false
                capturedUrl = url
                const fakeSocket = new FakeSocket()
                // Delay emits so event listeners are attached first
                setTimeout(() => {
                    // Emit first event that is 10s old (not caught-up yet)
                    fakeSocket.emitMessage(JSON.stringify({
                        kind: 'commit',
                        time_us: (now - 10_000) * 1000
                    }))
                    // Emit second event that is 6s old (still not caught-up)
                    fakeSocket.emitMessage(JSON.stringify({
                        kind: 'commit',
                        time_us: (now - 6_000) * 1000
                    }))
                }, 1)
                // Close to trigger end (after idle timeout)
                setTimeout(() => fakeSocket.emitClose(), 50)
                return fakeSocket
            },
            idleMs: 20,
            now: () => now
        })

        try {
            await harness.indexerDo.runDrain()
        } catch (err) {
            t.comment(`runDrain threw: ${err instanceof Error ? err.message : String(err)}`)
        }

        t.ok(
            drainDepsWasCalled,
            'drainDeps.open was called'
        )
        t.ok(
            !drainOnceWasNotCalled,
            'drainOnce was called (drainDeps.open called)'
        )
        t.ok(
            setCursorCalled,
            'setCursor was called'
        )
        t.equal(
            setCursorValue,
            (now - 6_000) * 1000,
            'cursor advanced to 2nd event time_us (6s old)'
        )
        t.ok(
            (capturedUrl as string | null)?.includes('cursor=1000'),
            'URL includes cursor=1000 (advancing from existing cursor)'
        )
    }
)

test(
    'AC4.5: runDrain from null (live-from-now) no cursor param, persists',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: null  // null means live-from-now
        })

        let setCursorCalled = false
        let setCursorValue:number|null = null

        // Spy directly on setCursor
        const origSetCursor = harness.indexerDo.setCursor
        harness.indexerDo.setCursor = async function (v:number) {
            setCursorCalled = true
            setCursorValue = v
            await origSetCursor.call(this, v)
        }

        // Override drainDeps to return a socket that emits 1 event
        const now = Date.now()
        let capturedUrl:string|null = null

        harness.setDrainDeps({
            open: async (url:string) => {
                capturedUrl = url
                const fakeSocket = new FakeSocket()
                // Delay emits so event listeners are attached first
                setTimeout(() => {
                    // Emit one commit event that is 10s old
                    // (so it's far from caught-up and will be kept)
                    fakeSocket.emitMessage(JSON.stringify({
                        kind: 'commit',
                        time_us: (now - 10_000) * 1000
                    }))
                }, 1)
                // Close to trigger end (after idle timeout)
                setTimeout(() => fakeSocket.emitClose(), 50)
                return fakeSocket
            },
            idleMs: 20,
            now: () => now
        })

        await harness.indexerDo.runDrain()

        t.ok(
            setCursorCalled,
            'setCursor was called when starting from null'
        )
        t.equal(
            setCursorValue,
            (now - 10_000) * 1000,
            'cursor advanced from null to event time_us'
        )
        t.ok(
            !(
                (capturedUrl as string | null)?.includes('cursor=')
            ),
            'URL does not include cursor param (live-from-now)'
        )
    }
)

test(
    'AC4.6: dev drain-now route gate 404s when NODE_ENV !== development',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: null
        })

        // Set NODE_ENV to test (not development)
        harness.indexerDo.env = { NODE_ENV: 'test' }

        // Override drainDeps to verify the gate (no-op so it doesn't open
        // real socket)
        harness.setDrainDeps({
            open: async () => new FakeSocket()
        })

        // Call the REAL fetch (which uses the real router)
        const response = await harness.indexerDo.fetch(
            new Request('http://do/internal/dev/drain-now', { method: 'POST' })
        )

        t.equal(
            response.status,
            404,
            'real router returns 404 when NODE_ENV is test'
        )
    }
)

test(
    'AC4.6: dev drain-now route succeeds when NODE_ENV === development',
    async t => {
        const harness = createIndexerDo({
            existingAlarm: null,
            cursorValue: null
        })

        // Set NODE_ENV to development
        harness.indexerDo.env = { NODE_ENV: 'development' }

        // Override drainDeps to avoid real socket (no-op drain)
        const fakeSocket = new FakeSocket()
        const now = Date.now()
        harness.setDrainDeps({
            open: async () => {
                // Emit and close immediately
                fakeSocket.emitMessage(JSON.stringify({
                    kind: 'commit',
                    time_us: now * 1000
                }))
                setImmediate(() => fakeSocket.emitClose())
                return fakeSocket
            },
            idleMs: 5,
            now: () => now
        })

        // Call the REAL fetch (which uses the real router)
        const response = await harness.indexerDo.fetch(
            new Request('http://do/internal/dev/drain-now', { method: 'POST' })
        )

        t.equal(
            response.status,
            200,
            'real router returns 200 when NODE_ENV is development'
        )
        const body = await response.json<{
            before:number
            after:number
            newItems:number
        }>()
        t.ok(body.before !== undefined, 'response includes before count')
        t.ok(body.after !== undefined, 'response includes after count')
        t.ok(body.newItems !== undefined, 'response includes newItems count')
    }
)
