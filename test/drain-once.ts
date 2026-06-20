import { test } from '@substrate-system/tapzero'
import {
    drainOnce,
    jetstreamUrl,
    openJetstreamSocketWithFailover,
    CAUGHT_UP_US,
    type DrainSocket,
    type JetstreamEvent
} from '../src/server/indexer/drain.js'

// FakeSocket implementing DrainSocket for tests
class FakeSocket implements DrainSocket {
    closed = false

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

    emitError (err:unknown):void {
        const cbs = this.listeners.get('error')
        if (cbs) {
            for (const cb of cbs) {
                cb(err)
            }
        }
    }
}

test('scheduled-drain.AC3.1: idle', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 15,
        caughtUpUs: CAUGHT_UP_US
    }

    const applied:number[] = []
    const apply = async (evt:JetstreamEvent) => {
        if (evt.kind === 'commit') {
            applied.push(evt.time_us)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Emit 2 stale events (well before live-edge, no budget hit)
    const staleTime = nowValue * 1000 - 100 * CAUGHT_UP_US
    const msg1 = JSON.stringify({
        did: 'did:1',
        time_us: staleTime,
        kind: 'commit'
    })
    const msg2 = JSON.stringify({
        did: 'did:2',
        time_us: staleTime + 1000,
        kind: 'commit'
    })

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    fakeSocket.emitMessage(msg1)
    fakeSocket.emitMessage(msg2)

    // Wait for the promise to resolve (idle timer should fire)
    const start = Date.now()
    const cursor = await promise
    const elapsed = Date.now() - start

    // Should resolve with the 2nd event's time_us
    t.equal(cursor, staleTime + 1000, 'cursor matches 2nd event')

    // Should wait at least idleMs (15ms), proving idle timer worked
    t.ok(elapsed >= 10, 'idle timer delay works')
})

test('scheduled-drain.AC3.2: live-edge', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 100,  // long idle to show we don't wait for it
        caughtUpUs: CAUGHT_UP_US
    }

    const apply = async () => { /* no-op */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    // Emit 1 event with time_us within caughtUpUs of now()
    // stale = now() * 1000 - time_us < caughtUpUs => live edge
    const liveTime = nowValue * 1000 - CAUGHT_UP_US / 2
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: liveTime,
        kind: 'commit'
    }))

    const start = Date.now()
    const cursor = await promise
    const elapsed = Date.now() - start

    // Should resolve with the event's time_us
    t.equal(cursor, liveTime, 'cursor matches live-edge event')

    // Should resolve well before idleMs (100ms), proving live-edge stops it
    t.ok(elapsed < 50, 'live-edge stops before idle timeout')
})

test('scheduled-drain.AC3.3: budget', async (t) => {
    const fakeSocket = new FakeSocket()
    let nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        maxWallMs: 5,
        idleMs: 100,
        caughtUpUs: CAUGHT_UP_US
    }

    const apply = async () => { /* no-op */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    // Emit a stale event
    const staleTime = nowValue * 1000 - 100 * CAUGHT_UP_US
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: staleTime,
        kind: 'commit'
    }))

    // Simulate time passing: now() will return > deadline on next check
    nowValue = 1006

    // Trigger chain processing by emitting another event
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:2',
        time_us: staleTime + 1000,
        kind: 'commit'
    }))

    // Should resolve due to budget timeout
    const cursor = await promise

    // Should resolve with an event's time_us
    t.ok(
        cursor === staleTime || cursor === staleTime + 1000,
        'cursor matches one of the events'
    )
})

test('scheduled-drain.AC3.4: in-order persist', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 15,
        caughtUpUs: CAUGHT_UP_US
    }

    const applied:number[] = []
    const apply = async (evt:JetstreamEvent) => {
        if (evt.kind === 'commit') {
            applied.push(evt.time_us)
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    // Emit 3 events in order
    const time1 = nowValue * 1000 - 100 * CAUGHT_UP_US
    const time2 = time1 + 1000
    const time3 = time2 + 1000

    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: time1,
        kind: 'commit'
    }))
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:2',
        time_us: time2,
        kind: 'commit'
    }))
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:3',
        time_us: time3,
        kind: 'commit'
    }))

    const cursor = await promise

    // Apply should have been called with all 3 in order
    t.equal(applied.length, 3, '3 events applied')
    t.deepEqual(applied, [time1, time2, time3], 'events in order')

    // Cursor should be the last event's time_us
    t.equal(cursor, time3, 'cursor is last event')
})

test('scheduled-drain.AC3.5: persist-before-advance', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 15,
        caughtUpUs: CAUGHT_UP_US
    }

    let applyCount = 0
    const apply = async (_evt:JetstreamEvent) => {
        applyCount++
        if (applyCount === 2) {
            throw new Error('apply failed on 2nd event')
        }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    const time1 = nowValue * 1000 - 100 * CAUGHT_UP_US
    const time2 = time1 + 1000

    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: time1,
        kind: 'commit'
    }))
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:2',
        time_us: time2,
        kind: 'commit'
    }))

    // drainOnce should reject
    let rejected = false
    try {
        await promise
    } catch (err) {
        if (err instanceof Error && err.message === 'apply failed on 2nd event') {
            rejected = true
        }
    }

    t.ok(rejected, 'drainOnce rejects on apply error')
})

test('scheduled-drain.AC3.6: close', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 15,
        caughtUpUs: CAUGHT_UP_US
    }

    const apply = async () => { /* no-op */ }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    const time1 = nowValue * 1000 - 100 * CAUGHT_UP_US
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: time1,
        kind: 'commit'
    }))

    // Wait for chain to process the message
    await new Promise(resolve => setImmediate(resolve))

    // Close the socket
    fakeSocket.emitClose()

    const cursor = await promise

    // Should resolve with the event's time_us
    t.equal(cursor, time1, 'cursor matches event time')

    // Socket should be marked closed
    t.ok(fakeSocket.closed, 'socket is closed')
})

test('scheduled-drain.AC3.8: non-commit advances cursor', async (t) => {
    const fakeSocket = new FakeSocket()
    const nowValue = 1000
    const deps = {
        open: async () => fakeSocket,
        now: () => nowValue,
        idleMs: 15,
        caughtUpUs: CAUGHT_UP_US
    }

    let applyCalled = false
    const apply = async () => {
        applyCalled = true
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const promise = drainOnce(deps as any, apply, null)

    // Ensure drainOnce has opened the socket and listeners are registered
    await new Promise(resolve => setImmediate(resolve))

    // Emit an identity event (kind !== 'commit')
    const time1 = nowValue * 1000 - 100 * CAUGHT_UP_US
    fakeSocket.emitMessage(JSON.stringify({
        did: 'did:1',
        time_us: time1,
        kind: 'identity'
    }))

    const cursor = await promise

    // apply should NOT have been called
    t.ok(!applyCalled, 'apply not called for non-commit event')

    // Cursor should still be the event's time_us
    t.equal(cursor, time1, 'cursor equals event time')
})

test('scheduled-drain.AC3.9: host failover', async (t) => {
    // Track which URLs were called
    const calledUrls:string[] = []

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const fakeOpen = async (url:string) => {
        calledUrls.push(url)
        const urlObj = new URL(url)
        // Fail on primary host
        if (urlObj.hostname === 'jetstream1.us-east.bsky.network') {
            throw new Error('primary host failed')
        }
        // Succeed on secondary
        return new FakeSocket()
    }

    const url = jetstreamUrl(100)  // URL on primary host
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const socket = await openJetstreamSocketWithFailover(url, fakeOpen as any)

    // Should have called open twice (first failed, second succeeded)
    t.equal(calledUrls.length, 2, '2 open calls (primary + failover)')

    // First call should be the original URL
    t.ok(
        calledUrls[0].includes('jetstream1.us-east.bsky.network'),
        'first call uses primary host'
    )

    // Second call should use secondary host but preserve query string
    t.ok(
        calledUrls[1].includes('jetstream2.us-west.bsky.network'),
        'second call uses secondary host'
    )

    // Both should have the cursor=100 query param
    t.ok(
        calledUrls[1].includes('cursor=100'),
        'failover preserves query string'
    )

    // Should return a socket
    t.ok(socket instanceof FakeSocket, 'returns socket from secondary')
})

test('scheduled-drain.AC3.7: url builder', (t) => {
    // Test jetstreamUrl with no cursor
    const urlNoCursor = jetstreamUrl(null)
    const urlObjNoCursor = new URL(urlNoCursor)

    t.ok(
        urlNoCursor.startsWith('https://'),
        'URL starts with https://'
    )

    const wanted = urlObjNoCursor.searchParams.getAll('wantedCollections')
    t.ok(
        wanted.includes('space.rsss.*'),
        'has wantedCollections=space.rsss.*'
    )

    t.ok(
        !urlObjNoCursor.searchParams.has('cursor'),
        'no cursor param when null'
    )

    // Test jetstreamUrl with cursor
    const urlWithCursor = jetstreamUrl(123)
    const urlObjWithCursor = new URL(urlWithCursor)

    t.equal(
        urlObjWithCursor.searchParams.get('cursor'),
        '123',
        'has cursor=123'
    )

    // wantedCollections should still be there
    const wantedWithCursor = urlObjWithCursor.searchParams.getAll(
        'wantedCollections'
    )
    t.ok(
        wantedWithCursor.includes('space.rsss.*'),
        'still has wantedCollections with cursor'
    )
})
