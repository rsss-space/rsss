import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import { fakeResult } from './helpers/sql-fake.js'
import {
    generateDPoPKeyPair,
    type OAuthCredentialRecord
} from '../src/server/auth/oauth.js'

interface FollowRow {
    subject_did:string
    rkey:string
}

function createFollowSql (initialFollows:FollowRow[] = []) {
    const follows:FollowRow[] = [...initialFollows]

    return {
        follows,
        inserts: [] as unknown[][],
        deletes: [] as unknown[][],
        exec (query:string, ...params:unknown[]) {
            if (query.includes(
                'SELECT rkey FROM graph_follows WHERE subject_did = ?'
            )) {
                return fakeResult(
                    follows.filter(f => f.subject_did === params[0])
                )
            }

            if (query.includes('INSERT INTO graph_follows')) {
                this.inserts.push(params)
                follows.push({
                    subject_did: params[0] as string,
                    rkey: params[1] as string
                })
                return fakeResult([])
            }

            if (query.includes(
                'DELETE FROM graph_follows WHERE subject_did = ?'
            )) {
                this.deletes.push(params)
                const idx = follows.findIndex(
                    f => f.subject_did === params[0]
                )
                if (idx >= 0) follows.splice(idx, 1)
                return fakeResult([])
            }

            // Absorb any other queries (DDL, other tables)
            return fakeResult([])
        }
    }
}

async function makeCredentials ():Promise<OAuthCredentialRecord> {
    const keyPair = await generateDPoPKeyPair()
    const privateJwk = await crypto.subtle.exportKey(
        'jwk',
        keyPair.privateKey
    )

    return {
        did: 'did:plc:alice',
        accessToken: 'access-token-secret',
        refreshToken: 'refresh-token-secret',
        tokenEndpoint: 'https://auth.example/token',
        pdsEndpoint: 'https://pds.example',
        dpopPrivateKeyJwk: privateJwk,
        tokenType: 'DPoP',
        updatedAt: '2026-06-10T20:00:00.000Z'
    }
}

function createFollowHarness (options:{
    initialFollows?:FollowRow[]
} = {}) {
    const sql = createFollowSql(options.initialFollows)
    const storage = new Map<string, unknown>()
    const waitUntilPromises:Promise<unknown>[] = []

    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:ReturnType<typeof createFollowSql>
        ctx:{
            storage:{
                get:<T>(key:string)=> Promise<T|undefined>
                put:(key:string, value:unknown)=> Promise<void>
                delete:(key:string)=> Promise<void>
                getAlarm:()=> Promise<number|null>
                setAlarm:(at:number)=> Promise<void>
                deleteAlarm:()=> Promise<void>
            }
            waitUntil:(promise:Promise<unknown>)=> void
            getWebSockets:()=> Array<{ send:(msg:string)=> void }>
        }
        fetchFeed:(feed:unknown)=> Promise<void>
        refreshFeedBatches:()=> Promise<void>
        createRouter:()=> {
            request:(path:string, init?:RequestInit)=> Promise<Response>
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
        waitUntil (promise) {
            waitUntilPromises.push(promise)
        },
        getWebSockets () { return [] }
    }
    userDo.fetchFeed = async () => {}
    userDo.refreshFeedBatches = async () => {}

    return {
        app: userDo.createRouter(),
        sql,
        storage,
        waitUntilPromises
    }
}

function jsonResponse (
    body:Record<string, unknown>,
    init:ResponseInit = {}
):Response {
    const headers = new Headers(init.headers)
    headers.set('content-type', 'application/json')
    return new Response(JSON.stringify(body), {
        status: init.status ?? 200,
        headers
    })
}

test('POST /graph/follow writes space.rsss.graph.follow record', async t => {
    const credentials = await makeCredentials()
    const { app, sql, storage } = createFollowHarness()
    storage.set('oauth:credentials', credentials)

    const calls:Array<{ url:string; body:Record<string, unknown> }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
        calls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>
        })
        return jsonResponse({
            uri: 'at://did:plc:alice/space.rsss.graph.follow/3abc123tid'
        })
    }) as typeof fetch

    try {
        const response = await app.request('/graph/follow', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetDid: 'did:plc:bob' })
        })

        t.equal(response.status, 201, 'new follow returns 201')
        t.equal(calls.length, 1, 'one PDS request')
        t.equal(
            calls[0]?.url,
            'https://pds.example/xrpc/com.atproto.repo.createRecord'
        )
        const body = calls[0]?.body
        t.equal(body?.collection, 'space.rsss.graph.follow')
        t.equal(body?.repo, 'did:plc:alice')
        const record = body?.record as Record<string, unknown>
        t.equal(record?.subject, 'did:plc:bob', 'subject is target DID')
        t.equal(typeof record?.createdAt, 'string', 'createdAt is string')
        t.equal(sql.inserts.length, 1, 'follow row inserted')
        t.equal(sql.inserts[0]?.[0], 'did:plc:bob', 'subject_did stored')
        t.equal(sql.inserts[0]?.[1], '3abc123tid', 'rkey extracted from URI')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('POST /graph/follow does not write app.bsky.graph.follow', async t => {
    const credentials = await makeCredentials()
    const { app, storage } = createFollowHarness()
    storage.set('oauth:credentials', credentials)

    const collections:string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        if (typeof body.collection === 'string') {
            collections.push(body.collection)
        }
        return jsonResponse({
            uri: 'at://did:plc:alice/space.rsss.graph.follow/3abc123tid'
        })
    }) as typeof fetch

    try {
        await app.request('/graph/follow', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetDid: 'did:plc:carol' })
        })

        t.ok(
            collections.every(c => !c.startsWith('app.bsky')),
            'no app.bsky collection written'
        )
        t.equal(collections[0], 'space.rsss.graph.follow')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('POST /graph/follow is idempotent (re-follow returns 200)', async t => {
    const credentials = await makeCredentials()
    const { app, sql, storage } = createFollowHarness({
        initialFollows: [{
            subject_did: 'did:plc:bob',
            rkey: 'existing-rkey'
        }]
    })
    storage.set('oauth:credentials', credentials)

    const calls:string[] = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input) => {
        calls.push(String(input))
        return jsonResponse({
            uri: 'at://did:plc:alice/space.rsss.graph.follow/newrkey'
        })
    }) as typeof fetch

    try {
        const response = await app.request('/graph/follow', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ targetDid: 'did:plc:bob' })
        })

        t.equal(response.status, 200, 're-follow returns 200')
        t.equal(calls.length, 0, 'no PDS request for duplicate follow')
        t.equal(sql.inserts.length, 0, 'no new row inserted')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test('DELETE /graph/follow/:targetDid deletes the PDS record', async t => {
    const credentials = await makeCredentials()
    const { app, sql, storage } = createFollowHarness({
        initialFollows: [{
            subject_did: 'did:plc:bob',
            rkey: 'follow-rkey-abc'
        }]
    })
    storage.set('oauth:credentials', credentials)

    const calls:Array<{ url:string; body:Record<string, unknown> }> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (input, init) => {
        calls.push({
            url: String(input),
            body: JSON.parse(String(init?.body)) as Record<string, unknown>
        })
        return jsonResponse({ uri: 'at://did:plc:alice/space.rsss.graph.follow/follow-rkey-abc' })
    }) as typeof fetch

    try {
        const response = await app.request('/graph/follow/did:plc:bob', {
            method: 'DELETE'
        })

        t.equal(response.status, 200, 'unfollow succeeds')
        t.equal(calls.length, 1, 'one PDS delete request')
        t.equal(
            calls[0]?.url,
            'https://pds.example/xrpc/com.atproto.repo.deleteRecord'
        )
        t.equal(
            calls[0]?.body.collection,
            'space.rsss.graph.follow'
        )
        t.equal(calls[0]?.body.rkey, 'follow-rkey-abc')
        t.equal(sql.deletes.length, 1, 'row deleted from graph_follows')
        t.equal(sql.follows.length, 0, 'follow removed from local state')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test(
    'DELETE /graph/follow/:targetDid is idempotent (not-following)', async t => {
        const credentials = await makeCredentials()
        const { app, sql, storage } = createFollowHarness()
        storage.set('oauth:credentials', credentials)

        const calls:string[] = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (input) => {
            calls.push(String(input))
            return jsonResponse({ uri: '' })
        }) as typeof fetch

        try {
            const response = await app.request(
                '/graph/follow/did:plc:nobody',
                { method: 'DELETE' }
            )

            t.equal(response.status, 200, 'unfollow of unknown DID succeeds')
            t.equal(calls.length, 0, 'no PDS request')
            t.equal(sql.deletes.length, 0, 'no delete executed')
        } finally {
            globalThis.fetch = originalFetch
        }
    }
)

test('POST /graph/follow returns 400 for missing targetDid', async t => {
    const { app } = createFollowHarness()

    const response = await app.request('/graph/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
    })

    t.equal(response.status, 400, 'missing targetDid returns 400')
})

test('POST /graph/follow returns 401 when credentials missing', async t => {
    const { app } = createFollowHarness()

    const response = await app.request('/graph/follow', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targetDid: 'did:plc:bob' })
    })

    t.equal(response.status, 401, 'no credentials returns 401')
})
