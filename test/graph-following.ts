/**
 * Tests for US-018: Following / followers route
 *  - GET /graph/following on RsssUserDO
 *  - buildGraphResponse helper
 */
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import {
    buildGraphResponse,
    type GraphApiDeps
} from '../src/server/graph-api.js'

// ---- DO harness (mirrors graph-follow.ts pattern) ----

interface FollowRow {
    subject_did:string
    rkey:string
}

interface QueryResult {
    toArray:() => unknown[]
    one:() => unknown | null
}

function result (rows:unknown[]):QueryResult {
    return {
        toArray () { return rows },
        one () { return rows[0] ?? null }
    }
}

function createFollowSql (initialFollows:FollowRow[] = []) {
    const follows:FollowRow[] = [...initialFollows]

    return {
        follows,
        exec (query:string, ...params:unknown[]) {
            if (query.includes(
                'SELECT subject_did FROM graph_follows'
            )) {
                return result(follows)
            }

            if (query.includes(
                'SELECT rkey FROM graph_follows WHERE subject_did = ?'
            )) {
                return result(
                    follows.filter(f => f.subject_did === params[0])
                )
            }

            if (query.includes('INSERT INTO graph_follows')) {
                follows.push({
                    subject_did: params[0] as string,
                    rkey: params[1] as string
                })
                return result([])
            }

            if (query.includes(
                'DELETE FROM graph_follows WHERE subject_did = ?'
            )) {
                const idx = follows.findIndex(
                    f => f.subject_did === params[0]
                )
                if (idx >= 0) follows.splice(idx, 1)
                return result([])
            }

            return result([])
        }
    }
}

function createFollowHarness (options:{
    initialFollows?:FollowRow[]
} = {}) {
    const sql = createFollowSql(options.initialFollows)
    const storage = new Map<string, unknown>()

    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createFollowSql>
        ctx:{
            storage:{
                get:<T>(key:string) => Promise<T|undefined>
                put:(key:string, value:unknown) => Promise<void>
                delete:(key:string) => Promise<void>
                getAlarm:() => Promise<number|null>
                setAlarm:(at:number) => Promise<void>
                deleteAlarm:() => Promise<void>
            }
            waitUntil:(promise:Promise<unknown>) => void
            getWebSockets:() => Array<{ send:(msg:string) => void }>
        }
        fetchFeed:(feed:unknown) => Promise<void>
        refreshFeedBatches:() => Promise<void>
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }

    userDo.sql = sql
    userDo.ctx = {
        storage: {
            async get<T> (key:string) {
                return storage.get(key) as T|undefined
            },
            async put (key:string, value:unknown) {
                storage.set(key, value)
            },
            async delete (key:string) {
                storage.delete(key)
            },
            async getAlarm () { return null },
            async setAlarm () {},
            async deleteAlarm () {}
        },
        waitUntil () {},
        getWebSockets () { return [] }
    }
    userDo.fetchFeed = async () => {}
    userDo.refreshFeedBatches = async () => {}

    return {
        app: userDo.createRouter(),
        sql,
        storage
    }
}

// ---- DO tests ----

test('GET /graph/following returns empty array when no follows', async t => {
    const { app } = createFollowHarness()
    const res = await app.request('/graph/following')
    t.equal(res.status, 200, 'returns 200')
    const body = await res.json() as { dids:string[] }
    t.ok(Array.isArray(body.dids), 'dids is array')
    t.equal(body.dids.length, 0, 'empty array')
})

test('GET /graph/following returns followed DIDs', async t => {
    const { app } = createFollowHarness({
        initialFollows: [
            { subject_did: 'did:plc:alice', rkey: 'rkey1' },
            { subject_did: 'did:plc:bob', rkey: 'rkey2' }
        ]
    })
    const res = await app.request('/graph/following')
    t.equal(res.status, 200, 'returns 200')
    const body = await res.json() as { dids:string[] }
    t.equal(body.dids.length, 2, 'two follows')
    t.ok(body.dids.includes('did:plc:alice'), 'alice in list')
    t.ok(body.dids.includes('did:plc:bob'), 'bob in list')
})

test('GET /graph/following returns only subject_did not rkey', async t => {
    const { app } = createFollowHarness({
        initialFollows: [
            { subject_did: 'did:plc:carol', rkey: 'rkey-abc' }
        ]
    })
    const res = await app.request('/graph/following')
    const body = await res.json() as { dids:unknown[] }
    t.equal(typeof body.dids[0], 'string', 'dids are strings')
    t.equal(body.dids[0], 'did:plc:carol', 'correct DID')
})

// ---- buildGraphResponse tests ----

function makeDeps (opts:{
    following?:string[]
    followers?:string[]
    followersCount?:number
    constellationAvailable?:boolean
}):GraphApiDeps {
    return {
        listFollowing: async () => opts.following ?? [],
        getFollowers: async (_did) => ({
            dids: opts.followers ?? [],
            count: opts.followersCount ?? opts.followers?.length ?? 0,
            available: opts.constellationAvailable ?? true
        })
    }
}

test('buildGraphResponse includes following list', async t => {
    const deps = makeDeps({ following: ['did:plc:a', 'did:plc:b'] })
    const resp = await buildGraphResponse('did:plc:me', deps)
    t.equal(resp.following.length, 2, 'two following')
    t.ok(resp.following.includes('did:plc:a'), 'a in following')
})

test('buildGraphResponse includes followers list', async t => {
    const deps = makeDeps({
        followers: ['did:plc:x', 'did:plc:y'],
        followersCount: 2
    })
    const resp = await buildGraphResponse('did:plc:me', deps)
    t.equal(resp.followers.length, 2, 'two followers')
    t.equal(resp.followersCount, 2, 'correct count')
})

test('buildGraphResponse handles Constellation unavailable', async t => {
    const deps = makeDeps({
        following: ['did:plc:z'],
        followers: [],
        followersCount: 0,
        constellationAvailable: false
    })
    const resp = await buildGraphResponse('did:plc:me', deps)
    t.equal(resp.constellationAvailable, false, 'available is false')
    t.equal(resp.followers.length, 0, 'empty followers')
    t.equal(resp.following.length, 1, 'following still works')
})

test('buildGraphResponse handles empty graph', async t => {
    const deps = makeDeps({})
    const resp = await buildGraphResponse('did:plc:me', deps)
    t.equal(resp.following.length, 0, 'empty following')
    t.equal(resp.followers.length, 0, 'empty followers')
    t.equal(resp.followersCount, 0, 'zero count')
    t.equal(resp.constellationAvailable, true, 'available by default')
})

test('buildGraphResponse uses correct DID for followers lookup', async t => {
    let capturedDid = ''
    const deps:GraphApiDeps = {
        listFollowing: async () => [],
        getFollowers: async (did) => {
            capturedDid = did
            return { dids: [], count: 0, available: true }
        }
    }
    await buildGraphResponse('did:plc:target', deps)
    t.equal(capturedDid, 'did:plc:target', 'correct DID passed')
})
