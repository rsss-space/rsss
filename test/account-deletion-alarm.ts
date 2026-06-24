/**
 * Tests for the account-deletion path inside RsssUserDO.alarm().
 *
 * When the DO storage holds a `pending_deletion` record whose
 * scheduledFor timestamp has passed, alarm() must drop the user
 * data tables, clear the user's KV entries, and skip the normal
 * feed-refresh path.
 */
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import { fakeResult } from './helpers/sql-fake.js'

interface FakeStorage {
    get:<T>(key:string)=> Promise<T | undefined>
    put:(key:string, value:unknown)=> Promise<void>
    delete:(key:string)=> Promise<void>
    setAlarm:(time:number)=> Promise<void>
    deleteAll:()=> Promise<void>
}

interface FakeKv {
    get:(key:string)=> Promise<string|null>
    delete:(key:string)=> Promise<void>
}

function createDeletionDo (initial:{
    scheduledFor:number;
    did:string
}|null) {
    const sqlExecutions:string[] = []
    const kvDeletions:string[] = []
    const setAlarms:number[] = []
    const stored = new Map<string, unknown>()
    if (initial) stored.set('pending_deletion', initial)
    let deletedAll = false
    let scheduledRefresh = false
    let refreshedFeeds = false
    let sweepError:unknown = null
    let activityError:unknown = null
    let refreshError:unknown = null

    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:{ exec:(query:string, ...params:unknown[])=> ReturnType<typeof fakeResult> }
        ctx:{ storage:FakeStorage }
        env:{ SESSIONS:FakeKv } & Record<string, unknown>
        alarm:()=> Promise<void>
        sweepStuckResolvingFeeds:()=> void
        readAccountActivity:()=> Promise<{ lastActiveAt:number }|undefined>
        refreshFeedBatches:()=> Promise<void>
        executeAccountDeletion:(did:string)=> Promise<void>
    }

    userDo.sql = {
        exec (query:string) {
            sqlExecutions.push(query)
            return fakeResult([])
        }
    }

    userDo.ctx = {
        storage: {
            get: async <T>(key:string) =>
                stored.get(key) as T | undefined,
            put: async (key:string, value:unknown) => {
                stored.set(key, value)
            },
            delete: async (key:string) => {
                stored.delete(key)
            },
            setAlarm: async (time:number) => {
                scheduledRefresh = true
                setAlarms.push(time)
            },
            deleteAll: async () => {
                deletedAll = true
                stored.clear()
            }
        }
    }

    userDo.env = {
        SESSIONS: {
            get: async () => null,
            delete: async (key:string) => {
                kvDeletions.push(key)
            }
        }
    }

    // Set up default method overrides. Tests can customize these.
    Object.defineProperty(userDo, 'sweepStuckResolvingFeeds', {
        value: () => {
            if (sweepError) throw sweepError
        },
        writable: true,
        configurable: true
    })

    Object.defineProperty(userDo, 'readAccountActivity', {
        value: async () => {
            if (activityError) throw activityError
            return undefined
        },
        writable: true,
        configurable: true
    })

    Object.defineProperty(userDo, 'refreshFeedBatches', {
        value: async () => {
            if (refreshError) throw refreshError
            refreshedFeeds = true
        },
        writable: true,
        configurable: true
    })

    return {
        userDo,
        sqlExecutions,
        kvDeletions,
        setAlarms,
        wasDeletedAll: () => deletedAll,
        wasRescheduled: () => scheduledRefresh,
        wasFeedRefresh: () => refreshedFeeds,
        setSweepError: (err:unknown) => { sweepError = err },
        setActivityError: (err:unknown) => { activityError = err },
        setRefreshError: (err:unknown) => { refreshError = err }
    }
}

test('alarm runs deletion when pending_deletion is due', async t => {
    const did = 'did:plc:alice'
    const harness = createDeletionDo({
        scheduledFor: Date.now() - 1000,
        did
    })

    await harness.userDo.alarm()

    t.ok(
        harness.sqlExecutions.some(q =>
            q.includes('DROP TABLE') && q.includes('feeds')),
        'drops the feeds table'
    )
    t.ok(
        harness.sqlExecutions.some(q =>
            q.includes('DROP TABLE') && q.includes('items')),
        'drops the items table'
    )
    t.ok(
        harness.sqlExecutions.some(q =>
            q.includes('DROP TABLE') && q.includes('dead_letter_outbox')),
        'drops the dead_letter_outbox table'
    )

    t.ok(
        harness.kvDeletions.includes(`user:${did}`),
        'deletes user KV entry'
    )
    t.ok(
        harness.kvDeletions.includes(`billing:${did}`),
        'deletes billing KV entry'
    )
    t.ok(
        harness.kvDeletions.includes(`billing_pending_email:${did}`),
        'deletes pending email KV entry'
    )
    t.ok(
        harness.kvDeletions.includes(`billing_contact_email:${did}`),
        'deletes contact email KV entry'
    )

    t.ok(harness.wasDeletedAll(), 'wipes DO storage via deleteAll()')
    t.equal(
        harness.wasFeedRefresh(),
        false,
        'does not run the feed-refresh path'
    )
    t.equal(
        harness.wasRescheduled(),
        false,
        'does not reschedule the alarm'
    )
})

test(
    'alarm skips deletion when scheduledFor is in the future',
    async t => {
        const harness = createDeletionDo({
            scheduledFor: Date.now() + 60_000,
            did: 'did:plc:alice'
        })

        await harness.userDo.alarm()

        t.equal(
            harness.wasDeletedAll(),
            false,
            'does not wipe DO storage'
        )
        t.equal(
            harness.kvDeletions.length,
            0,
            'does not delete KV entries'
        )
        t.ok(
            harness.wasRescheduled(),
            'reschedules the next alarm'
        )
    }
)

test(
    'alarm runs normally when no pending_deletion exists',
    async t => {
        const harness = createDeletionDo(null)

        await harness.userDo.alarm()

        t.equal(
            harness.wasDeletedAll(),
            false,
            'no deletion runs'
        )
        t.ok(harness.wasRescheduled(), 'reschedules the next alarm')
    }
)

test(
    'AC2.2: alarm reschedules even when sweepStuckResolvingFeeds throws',
    async t => {
        const harness = createDeletionDo(null)
        harness.setSweepError(new Error('sweep failed'))

        await harness.userDo.alarm()

        t.ok(
            harness.wasRescheduled(),
            'setAlarm was called despite sweep error'
        )
        t.ok(
            harness.setAlarms.length > 0,
            'reschedule was actually set'
        )
    }
)

test(
    'AC2.2: alarm reschedules even when readAccountActivity rejects',
    async t => {
        const harness = createDeletionDo(null)
        harness.setActivityError(new Error('activity read failed'))

        await harness.userDo.alarm()

        t.ok(
            harness.wasRescheduled(),
            'setAlarm was called despite activity error'
        )
        t.ok(
            harness.setAlarms.length > 0,
            'reschedule was actually set'
        )
    }
)

test(
    'AC2.2: alarm reschedules BEFORE fallible refreshFeedBatches',
    async t => {
        const harness = createDeletionDo(null)
        const setAlarmOrder:number[] = []
        const refreshOrder:number[] = []

        // Track order: setAlarm calls get marked with 0, refreshFeedBatches
        // gets marked with 1. If reschedule happens first, 0 appears before 1.
        const origSetAlarm = harness.userDo.ctx.storage.setAlarm
        harness.userDo.ctx.storage.setAlarm = async (time:number) => {
            setAlarmOrder.push(0)
            await origSetAlarm.call(harness.userDo.ctx.storage, time)
        }

        harness.setRefreshError(new Error('refresh failed'))
        Object.defineProperty(harness.userDo, 'refreshFeedBatches', {
            value: async () => {
                refreshOrder.push(1)
                throw new Error('refresh failed')
            },
            writable: true,
            configurable: true
        })

        try {
            await harness.userDo.alarm()
        } catch {
            // Expected: refreshFeedBatches throws
        }

        t.ok(
            harness.setAlarms.length > 0,
            'alarm was rescheduled'
        )
        t.ok(
            setAlarmOrder[0] === 0 && refreshOrder[0] === 1,
            'setAlarm call happened before refreshFeedBatches'
        )
    }
)

test(
    'AC2.3: inactivity gate prevents reschedule when idle',
    async t => {
        const harness = createDeletionDo(null)
        const veryOldTime = Date.now() - (4 * 24 * 60 * 60 * 1000)

        Object.defineProperty(harness.userDo, 'readAccountActivity', {
            value: async () => ({
                lastActiveAt: veryOldTime
            }),
            writable: true,
            configurable: true
        })

        await harness.userDo.alarm()

        t.equal(
            harness.setAlarms.length,
            0,
            'no reschedule when idle past threshold (stays dormant)'
        )
    }
)

test(
    'AC2.3: deletion path still prevents reschedule when due',
    async t => {
        const did = 'did:plc:alice'
        const harness = createDeletionDo({
            scheduledFor: Date.now() - 1000,
            did
        })

        await harness.userDo.alarm()

        t.equal(
            harness.setAlarms.length,
            0,
            'deletion due: no reschedule'
        )
    }
)

test(
    'AC2.3: not-yet-due deletion keeps polling armed',
    async t => {
        const harness = createDeletionDo({
            scheduledFor: Date.now() + 60_000,
            did: 'did:plc:alice'
        })

        await harness.userDo.alarm()

        t.ok(
            harness.wasRescheduled(),
            'pending but not-yet-due deletion keeps alarm ticking'
        )
    }
)
