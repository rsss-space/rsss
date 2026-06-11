import { test } from '@substrate-system/tapzero'
import { fakeResult } from './helpers/sql-fake.js'
// esbuild --loader:.wasm=dataurl inlines the binary as a base64 data URL
// @ts-expect-error -- no type declarations for .wasm imports
import wasmUrl from '@sqlite.org/sqlite-wasm/sqlite3.wasm'
import sqlite3Module from '@sqlite.org/sqlite-wasm'
import {
    RsssRegistryDO,
    type RegistryEnv
} from '../src/server/durable-objects/registry.js'

type Row = Record<string, unknown>
type SqliteExec = (opts:{
    sql:string
    bind:unknown[]
    rowMode:'object'
    resultRows:Row[]
}) => unknown
type MemorySqliteDb = {
    exec:(opts:Parameters<SqliteExec>[0]) => unknown
    close:() => void
}
type SqliteModule = (opts:{
    locateFile:() => string
}) => Promise<{
    oo1:{
        DB:new (filename:string) => MemorySqliteDb
    }
}>

function createFakeSqlStorage (execSql:SqliteExec) {
    return {
        exec (sql:string, ...bind:unknown[]) {
            const rows:Row[] = []
            execSql({
                sql,
                bind,
                rowMode: 'object',
                resultRows: rows
            })
            return fakeResult(rows)
        }
    }
}

async function createRegistryWithMemorySql ():Promise<{
    registryDo:RsssRegistryDO
    close:() => void
}> {
    const initSqlite = sqlite3Module as unknown as SqliteModule
    const sqlite3 = await initSqlite({
        locateFile: () => wasmUrl as string
    })
    const db = new sqlite3.oo1.DB(':memory:')
    const sql = createFakeSqlStorage((opts) => db.exec(opts))
    let barrier:Promise<void> = Promise.resolve()
    const ctx = {
        storage: {
            sql,
            get: async () => null,
            put: async () => {},
            getAlarm: async () => null,
            setAlarm: async () => {}
        },
        blockConcurrencyWhile: (fn:() => Promise<void>) => {
            barrier = fn()
        }
    } as unknown as DurableObjectState
    const registryDo = new RsssRegistryDO(ctx, {} as RegistryEnv)
    await barrier

    return {
        registryDo,
        close: () => { db.close() }
    }
}

test('upsert records a user and lookup returns them', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        const upsertRes = await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:abc123',
                    handle: 'alice.bsky.social',
                    avatar: 'https://example.com/avatar.jpg'
                })
            })
        )
        t.equal(upsertRes.status, 204, 'upsert returns 204')

        const lookupRes = await registryDo.fetch(
            new Request('http://registry/lookup/did:plc:abc123')
        )
        t.equal(lookupRes.status, 200, 'lookup returns 200')
        const body = await lookupRes.json() as {
            known:boolean
            did:string
            handle:string
            avatar:string|null
        }
        t.equal(body.known, true, 'known is true')
        t.equal(body.did, 'did:plc:abc123', 'did matches')
        t.equal(body.handle, 'alice.bsky.social', 'handle matches')
        t.equal(body.avatar, 'https://example.com/avatar.jpg', 'avatar matches')
    } finally {
        close()
    }
})

test('lookup returns known:false for unknown DID', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        const res = await registryDo.fetch(
            new Request('http://registry/lookup/did:plc:unknown')
        )
        t.equal(res.status, 200, 'returns 200')
        const body = await res.json() as { known:boolean }
        t.equal(body.known, false, 'known is false for unknown DID')
    } finally {
        close()
    }
})

test('upsert updates handle and avatar when called again', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:abc123',
                    handle: 'alice.bsky.social',
                    avatar: null
                })
            })
        )

        await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:abc123',
                    handle: 'alice-updated.bsky.social',
                    avatar: 'https://example.com/new-avatar.jpg'
                })
            })
        )

        const res = await registryDo.fetch(
            new Request('http://registry/lookup/did:plc:abc123')
        )
        const body = await res.json() as {
            known:boolean
            handle:string
            avatar:string|null
        }
        t.equal(body.known, true, 'still known after update')
        t.equal(body.handle, 'alice-updated.bsky.social', 'handle updated')
        t.equal(
            body.avatar,
            'https://example.com/new-avatar.jpg',
            'avatar updated'
        )
    } finally {
        close()
    }
})

test('upsert without avatar stores null avatar', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:bob456',
                    handle: 'bob.bsky.social'
                })
            })
        )

        const res = await registryDo.fetch(
            new Request('http://registry/lookup/did:plc:bob456')
        )
        const body = await res.json() as {
            known:boolean
            avatar:string|null
        }
        t.equal(body.known, true, 'bob is known')
        t.equal(body.avatar, null, 'avatar is null when not provided')
    } finally {
        close()
    }
})

test('batch-lookup returns subset of known rsss users', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:user1',
                    handle: 'user1.bsky.social'
                })
            })
        )
        await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    did: 'did:plc:user2',
                    handle: 'user2.bsky.social'
                })
            })
        )

        const batchRes = await registryDo.fetch(
            new Request('http://registry/batch-lookup', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    dids: [
                        'did:plc:user1',
                        'did:plc:user2',
                        'did:plc:not-rsss-user'
                    ]
                })
            })
        )
        t.equal(batchRes.status, 200, 'batch-lookup returns 200')
        const body = await batchRes.json() as {
            users:{ did:string; handle:string; avatar:string|null }[]
        }
        t.equal(body.users.length, 2, 'returns only the 2 known users')
        const dids = body.users.map(u => u.did).sort()
        t.deepEqual(
            dids,
            ['did:plc:user1', 'did:plc:user2'],
            'correct DIDs returned'
        )
    } finally {
        close()
    }
})

test('batch-lookup with empty array returns empty users', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        const res = await registryDo.fetch(
            new Request('http://registry/batch-lookup', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ dids: [] })
            })
        )
        t.equal(res.status, 200, 'returns 200')
        const body = await res.json() as { users:unknown[] }
        t.deepEqual(body.users, [], 'empty users array')
    } finally {
        close()
    }
})

test('upsert rejects missing did', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        const res = await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ handle: 'alice.bsky.social' })
            })
        )
        t.equal(res.status, 400, 'returns 400 for missing did')
    } finally {
        close()
    }
})

test('upsert rejects missing handle', async (t) => {
    const { registryDo, close } = await createRegistryWithMemorySql()
    try {
        const res = await registryDo.fetch(
            new Request('http://registry/upsert', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ did: 'did:plc:abc123' })
            })
        )
        t.equal(res.status, 400, 'returns 400 for missing handle')
    } finally {
        close()
    }
})
