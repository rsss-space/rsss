import { test } from '@substrate-system/tapzero'
import {
    createAccessTokenHash
} from '../src/server/auth/dpop-proof.js'
import { putRecord, createRecord, deleteRecord } from
    '../src/server/auth/pds-write-client.js'
import {
    generateDPoPKeyPair,
    type OAuthCredentialRecord
} from '../src/server/auth/oauth.js'

interface JwtPayload {
    htm:string
    htu:string
    ath?:string
    nonce?:string
}

interface FetchCall {
    url:string
    method:string
    headers:Headers
    body:string
}

function base64UrlDecode (value:string):Uint8Array<ArrayBuffer> {
    const padded = value + '='.repeat((4 - value.length % 4) % 4)
    const base64 = padded.replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)

    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i)
    }

    return bytes
}

function decodeJwtPayload (jwt:string):JwtPayload {
    const payload = jwt.split('.')[1]
    if (!payload) throw new Error('Missing JWT payload')

    return JSON.parse(
        new TextDecoder().decode(base64UrlDecode(payload))
    ) as JwtPayload
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
        pdsEndpoint: 'https://pds.example/',
        dpopPrivateKeyJwk: privateJwk,
        tokenType: 'DPoP',
        accessTokenExpiresAt: 100,
        updatedAt: '2026-06-09T20:00:00.000Z'
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

test('putRecord sends a DPoP-bound request to the user PDS', async t => {
    const credentials = await makeCredentials()
    const calls:FetchCall[] = []

    const result = await putRecord(credentials, {
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123',
        record: {
            feedUrl: 'https://example.com/feed.xml',
            createdAt: '2026-06-09T20:00:00.000Z'
        },
        validate: true
    }, {
        persistCredentials: async () => undefined,
        fetch: async (input, init) => {
            calls.push({
                url: String(input),
                method: init?.method ?? 'GET',
                headers: new Headers(init?.headers),
                body: String(init?.body)
            })

            return jsonResponse({ uri: 'at://did:plc:alice/record' })
        }
    })

    t.equal(result.ok, true, 'write succeeds')
    t.equal(calls.length, 1, 'one PDS request')

    const call = calls[0]
    if (!call) return

    t.equal(
        call.url,
        'https://pds.example/xrpc/com.atproto.repo.putRecord'
    )
    t.equal(call.method, 'POST')
    t.equal(call.headers.get('authorization'), 'DPoP access-token-secret')
    t.equal(call.headers.get('content-type'), 'application/json')

    const proof = call.headers.get('DPoP')
    t.equal(typeof proof, 'string')
    if (!proof) return

    const payload = decodeJwtPayload(proof)
    t.equal(payload.htm, 'POST')
    t.equal(
        payload.htu,
        'https://pds.example/xrpc/com.atproto.repo.putRecord'
    )
    t.equal(
        payload.ath,
        await createAccessTokenHash(credentials.accessToken)
    )

    t.deepEqual(JSON.parse(call.body), {
        repo: credentials.did,
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123',
        record: {
            feedUrl: 'https://example.com/feed.xml',
            createdAt: '2026-06-09T20:00:00.000Z'
        },
        validate: true
    })
})

test('putRecord retries once with a server DPoP nonce', async t => {
    const credentials = await makeCredentials()
    const proofs:string[] = []

    const result = await putRecord(credentials, {
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123',
        record: { feedUrl: 'https://example.com/feed.xml' }
    }, {
        persistCredentials: async () => undefined,
        fetch: async (_input, init) => {
            const headers = new Headers(init?.headers)
            proofs.push(headers.get('DPoP') ?? '')

            if (proofs.length === 1) {
                return jsonResponse(
                    { error: 'use_dpop_nonce' },
                    {
                        status: 400,
                        headers: { 'DPoP-Nonce': 'pds-nonce' }
                    }
                )
            }

            return jsonResponse({ uri: 'at://did:plc:alice/record' })
        }
    })

    t.equal(result.ok, true, 'nonce retry succeeds')
    t.equal(proofs.length, 2, 'request retried once')
    t.equal(decodeJwtPayload(proofs[0] ?? '').nonce, undefined)
    t.equal(decodeJwtPayload(proofs[1] ?? '').nonce, 'pds-nonce')
})

test('deleteRecord refreshes expired tokens and replays the write', async t => {
    const credentials = await makeCredentials()
    const calls:FetchCall[] = []
    const persisted:OAuthCredentialRecord[] = []

    const result = await deleteRecord(credentials, {
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123'
    }, {
        now: () => 1_000,
        persistCredentials: async record => {
            persisted.push(record)
        },
        fetch: async (input, init) => {
            const call = {
                url: String(input),
                method: init?.method ?? 'GET',
                headers: new Headers(init?.headers),
                body: String(init?.body)
            }
            calls.push(call)

            if (call.url === credentials.tokenEndpoint) {
                return jsonResponse({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    token_type: 'DPoP',
                    expires_in: 60
                })
            }

            if (calls.length === 1) {
                return jsonResponse(
                    { error: 'ExpiredToken' },
                    { status: 401 }
                )
            }

            return jsonResponse({ uri: 'at://did:plc:alice/record' })
        }
    })

    t.equal(result.ok, true, 'replayed write succeeds')
    t.equal(persisted[0]?.accessToken, 'new-access-token')
    t.equal(persisted[0]?.refreshToken, 'new-refresh-token')

    const replay = calls.find(call => {
        return call.headers.get('authorization') ===
            'DPoP new-access-token'
    })

    t.equal(Boolean(replay), true, 'replay uses rotated access token')
    if (!replay) return

    t.deepEqual(JSON.parse(replay.body), {
        repo: credentials.did,
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123'
    })
})

test('deleteRecord treats RecordNotFound as idempotent success', async t => {
    const credentials = await makeCredentials()

    const result = await deleteRecord(credentials, {
        collection: 'space.rsss.feed.subscription',
        rkey: 'feed.abc123'
    }, {
        persistCredentials: async () => undefined,
        fetch: async () => {
            return jsonResponse({ error: 'RecordNotFound' }, { status: 400 })
        }
    })

    t.equal(result.ok, true, 'absent record is a successful delete')
})

test('createRecord reports reauth_required without token material', async t => {
    const credentials = await makeCredentials()
    const reported:Array<{
        err:unknown
        area:string
        context?:Record<string, unknown>
    }> = []

    const result = await createRecord(credentials, {
        collection: 'space.rsss.graph.follow',
        record: {
            subject: 'did:plc:bob',
            createdAt: '2026-06-09T20:00:00.000Z'
        }
    }, {
        persistCredentials: async () => undefined,
        reportError: (err, area, context) => {
            reported.push({ err, area, context })
        },
        fetch: async (input) => {
            if (String(input) === credentials.tokenEndpoint) {
                return jsonResponse(
                    { error: 'invalid_grant' },
                    { status: 400 }
                )
            }

            return jsonResponse(
                { error: 'ExpiredToken' },
                { status: 401 }
            )
        }
    })

    t.equal(result.ok, false, 'write fails')
    if (result.ok) return
    t.equal(result.error.code, 'reauth_required')
    t.equal(reported.length, 1, 'reports the failure')
    t.equal(reported[0]?.area, 'atproto')
    const serialized = JSON.stringify(reported[0]?.context)
    t.equal(serialized.includes(credentials.accessToken), false)
    t.equal(serialized.includes(credentials.refreshToken), false)
})
