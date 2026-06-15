import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'

interface PollerFeedState {
    etag?:string
    lastModified?:string
    consecutiveFailures:number
    lastAttemptAt?:number
    lastSuccessfulAt?:number
    nextDueAt:number
}

interface AccountActivityMarker {
    lastActiveAt:number
}

interface LastAnySuccessRecord {
    lastAnySuccessAt:number
}

function createPollDo () {
    const storage = new Map<string, unknown>()
    let alarmTime:number|null = null
    const alarmTimes:number[] = []
    const userDo = Object.create(RsssUserDO.prototype) as {
        ctx:{
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:<T>(key:string, value:T) => Promise<void>
                delete:(key:string) => Promise<void>
                getAlarm:() => Promise<number|null>
                setAlarm:(time:number) => Promise<void>
            }
        }
        readPollerFeedState:(feedId:number) => Promise<PollerFeedState|undefined>
        writePollerFeedState:(feedId:number, state:PollerFeedState) => Promise<void>
        deletePollerFeedState:(feedId:number) => Promise<void>
        readAccountActivity:() => Promise<AccountActivityMarker|undefined>
        writeAccountActivity:(now:number) => Promise<void>
        readLastAnySuccess:() => Promise<number|undefined>
        writeLastAnySuccess:(now:number) => Promise<void>
        ensureFeedRefreshArmed:() => Promise<void>
        maybeKickCatchUp:(now:number) => Promise<void>
    }

    userDo.ctx = {
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put<T> (key:string, value:T) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            },
            async getAlarm () {
                return alarmTime
            },
            async setAlarm (time:number) {
                alarmTime = time
                alarmTimes.push(time)
            }
        }
    }

    return {
        userDo,
        storage,
        alarmTimes,
        // Seed an existing alarm without recording it as a new arm.
        seedAlarm (time:number) {
            alarmTime = time
        }
    }
}

test('readPollerFeedState returns undefined when no record exists', async t => {
    const { userDo } = createPollDo()
    const state = await userDo.readPollerFeedState(1)
    t.equal(state, undefined, 'no record yet returns undefined')
})

test('writePollerFeedState round-trips a record', async t => {
    const { userDo } = createPollDo()
    const written:PollerFeedState = {
        etag: '"abc"',
        lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
        consecutiveFailures: 0,
        lastAttemptAt: 1700000000000,
        lastSuccessfulAt: 1700000000000,
        nextDueAt: 1700000600000
    }
    await userDo.writePollerFeedState(7, written)
    const readBack = await userDo.readPollerFeedState(7)
    t.deepEqual(readBack, written, 'round trip preserves all fields')
})

test('deletePollerFeedState removes the record', async t => {
    const { userDo } = createPollDo()
    await userDo.writePollerFeedState(2, {
        consecutiveFailures: 0,
        nextDueAt: 0
    })
    await userDo.deletePollerFeedState(2)
    const readBack = await userDo.readPollerFeedState(2)
    t.equal(readBack, undefined, 'record is gone after delete')
})

test('writePollerFeedState clears etag when undefined', async t => {
    const { userDo } = createPollDo()
    await userDo.writePollerFeedState(5, {
        etag: '"abc"',
        lastModified: 'Wed, 01 Jan 2025 00:00:00 GMT',
        consecutiveFailures: 0,
        nextDueAt: 1700000600000
    })
    await userDo.writePollerFeedState(5, {
        consecutiveFailures: 0,
        nextDueAt: 1700001200000
    })
    const readBack = await userDo.readPollerFeedState(5)
    t.ok(readBack, 'record exists')
    t.equal(readBack?.etag, undefined, 'stale etag is not retained')
    t.equal(
        readBack?.lastModified,
        undefined,
        'stale lastModified is not retained'
    )
})

test(
    'writeAccountActivity coalesces writes within 60 seconds',
    async t => {
        const { userDo, storage } = createPollDo()
        const t0 = 1_700_000_000_000
        await userDo.writeAccountActivity(t0)
        const first = storage
            .get('poll:account:last_active_at') as AccountActivityMarker
        t.equal(first.lastActiveAt, t0, 'first write stores the timestamp')

        await userDo.writeAccountActivity(t0 + 30_000)
        const second = storage
            .get('poll:account:last_active_at') as AccountActivityMarker
        t.equal(
            second.lastActiveAt,
            t0,
            '30s-later write is coalesced (skipped)'
        )

        await userDo.writeAccountActivity(t0 + 60_001)
        const third = storage
            .get('poll:account:last_active_at') as AccountActivityMarker
        t.equal(
            third.lastActiveAt,
            t0 + 60_001,
            'past-60s write advances the timestamp'
        )
    }
)

test(
    'writeLastAnySuccess uses max(prev, now)',
    async t => {
        const { userDo, storage } = createPollDo()
        const t0 = 1_700_000_000_000
        await userDo.writeLastAnySuccess(t0)
        let stored = storage
            .get('poll:account:last_any_success_at') as LastAnySuccessRecord
        t.equal(stored.lastAnySuccessAt, t0, 'first write stores t0')

        await userDo.writeLastAnySuccess(t0 - 5_000)
        stored = storage
            .get('poll:account:last_any_success_at') as LastAnySuccessRecord
        t.equal(
            stored.lastAnySuccessAt,
            t0,
            'out-of-order earlier write does not regress'
        )

        await userDo.writeLastAnySuccess(t0 + 1_000)
        stored = storage
            .get('poll:account:last_any_success_at') as LastAnySuccessRecord
        t.equal(
            stored.lastAnySuccessAt,
            t0 + 1_000,
            'later write advances'
        )

        const readBack = await userDo.readLastAnySuccess()
        t.equal(readBack, t0 + 1_000, 'read returns the stored value')
    }
)

test('ensureFeedRefreshArmed arms an alarm when none is set', async t => {
    const { userDo, alarmTimes } = createPollDo()
    const before = Date.now()

    await userDo.ensureFeedRefreshArmed()

    t.equal(alarmTimes.length, 1, 'an alarm was armed')
    const delta = alarmTimes[0] - before
    t.ok(
        delta >= 60 * 60 * 1000 && delta < 61 * 60 * 1000,
        'armed ~60 minutes out'
    )
})

test('ensureFeedRefreshArmed is a no-op when an alarm exists', async t => {
    const { userDo, alarmTimes, seedAlarm } = createPollDo()
    seedAlarm(Date.now() + 5 * 60 * 1000)

    await userDo.ensureFeedRefreshArmed()

    t.equal(alarmTimes.length, 0, 'existing alarm is left untouched')
})

test(
    'ensureFeedRefreshArmed re-arms when alarm is in the past',
    async t => {
        const { userDo, alarmTimes, seedAlarm } = createPollDo()
        const now = Date.now()
        const pastTime = now - 60000 // 1 minute ago

        seedAlarm(pastTime)
        await userDo.ensureFeedRefreshArmed()

        t.equal(alarmTimes.length, 1, 'overdue alarm triggers a re-arm')
        const rearmedTime = alarmTimes[0]
        const delta = rearmedTime - now
        // OVERDUE_ALARM_REARM_DELAY_MS is 5 seconds; assert near-immediate
        // (within ~2x that value), clearly far below 60 min interval.
        const expectedRearmedDelayMs = 5 * 1000
        const normalIntervalMs = 60 * 60 * 1000
        t.ok(
            delta <= 2 * expectedRearmedDelayMs,
            'overdue re-arm is near-immediate'
        )
        t.ok(
            delta < normalIntervalMs,
            'overdue re-arm is far below normal 60 min interval'
        )
    }
)

test('maybeKickCatchUp re-arms the alarm for a returning user', async t => {
    const { userDo, storage, alarmTimes } = createPollDo()
    const now = 1_700_000_000_000
    // Recent activity + recent success -> catch-up NOT triggered, so
    // refreshFeedBatches/waitUntil are never referenced; we isolate the
    // alarm-arming behaviour. No alarm is currently set.
    storage.set('poll:account:last_active_at', { lastActiveAt: now - 1_000 })
    storage.set('poll:account:last_any_success_at', {
        lastAnySuccessAt: now - 1_000
    })

    await userDo.maybeKickCatchUp(now)

    t.equal(
        alarmTimes.length,
        1,
        'activity ensures a polling alarm is armed'
    )
})

test('poll-state tests done', () => {
    if (window) {
        // @ts-expect-error tests
        window.testsFinished = true
    }
})
