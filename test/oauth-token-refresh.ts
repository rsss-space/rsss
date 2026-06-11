import { test } from '@substrate-system/tapzero'
import {
    generateDPoPKeyPair,
    type OAuthCredentialRecord
} from '../src/server/auth/oauth.js'
import {
    refreshOAuthCredentials
} from '../src/server/auth/token-refresh.js'

interface JwtPayload {
    htm:string
    htu:string
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
        accessToken: 'old-access-token',
        refreshToken: 'old-refresh-token',
        tokenEndpoint: 'https://auth.example/token?ignored=true',
        pdsEndpoint: 'https://pds.example',
        dpopPrivateKeyJwk: privateJwk,
        tokenType: 'DPoP',
        accessTokenExpiresAt: 100,
        updatedAt: '2026-06-09T20:00:00.000Z'
    }
}

function tokenResponse (
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

test('refreshOAuthCredentials exchanges refresh token and persists rotation',
    async t => {
        const credentials = await makeCredentials()
        const calls:FetchCall[] = []
        const persisted:OAuthCredentialRecord[] = []

        const result = await refreshOAuthCredentials(credentials, {
            now: () => 1_000,
            persistCredentials: async record => {
                persisted.push(record)
            },
            fetch: async (input, init) => {
                calls.push({
                    url: String(input),
                    method: init?.method ?? 'GET',
                    headers: new Headers(init?.headers),
                    body: String(init?.body)
                })

                return tokenResponse({
                    access_token: 'new-access-token',
                    refresh_token: 'new-refresh-token',
                    token_type: 'DPoP',
                    expires_in: 60
                })
            }
        })

        t.equal(result.ok, true, 'refresh succeeds')
        t.equal(calls.length, 1, 'one token request')
        const call = calls[0]
        const persistedRecord = persisted[0]
        if (!call || !persistedRecord) return

        t.equal(call.url, credentials.tokenEndpoint)
        t.equal(call.method, 'POST')
        t.equal(
            call.headers.get('content-type'),
            'application/x-www-form-urlencoded'
        )
        t.equal(
            new URLSearchParams(call.body).get('grant_type'),
            'refresh_token'
        )
        t.equal(
            new URLSearchParams(call.body).get('refresh_token'),
            'old-refresh-token'
        )

        const proof = call.headers.get('DPoP')
        t.equal(typeof proof, 'string')
        if (!proof) return
        const payload = decodeJwtPayload(proof)
        t.equal(payload.htm, 'POST')
        t.equal(payload.htu, 'https://auth.example/token')

        t.equal(persistedRecord.did, credentials.did)
        t.equal(persistedRecord.pdsEndpoint, credentials.pdsEndpoint)
        t.equal(persistedRecord.accessToken, 'new-access-token')
        t.equal(persistedRecord.refreshToken, 'new-refresh-token')
        t.equal(persistedRecord.tokenType, 'DPoP')
        t.equal(persistedRecord.accessTokenExpiresAt, 61_000)
        t.equal(persistedRecord.updatedAt, '1970-01-01T00:00:01.000Z')
        t.equal(
            persistedRecord.dpopPrivateKeyJwk.d,
            credentials.dpopPrivateKeyJwk.d
        )
    })

test('refreshOAuthCredentials retries once with a DPoP nonce challenge',
    async t => {
        const credentials = await makeCredentials()
        const proofs:string[] = []
        const persisted:OAuthCredentialRecord[] = []

        const result = await refreshOAuthCredentials(credentials, {
            now: () => 2_000,
            persistCredentials: async record => {
                persisted.push(record)
            },
            fetch: async (_input, init) => {
                const headers = new Headers(init?.headers)
                proofs.push(headers.get('DPoP') ?? '')

                if (proofs.length === 1) {
                    return tokenResponse(
                        { error: 'use_dpop_nonce' },
                        {
                            status: 400,
                            headers: { 'DPoP-Nonce': 'server-nonce' }
                        }
                    )
                }

                return tokenResponse({
                    access_token: 'nonce-access-token',
                    refresh_token: 'nonce-refresh-token',
                    token_type: 'DPoP',
                    expires_in: 120
                })
            }
        })

        t.equal(result.ok, true, 'nonce retry succeeds')
        t.equal(proofs.length, 2, 'request retried once')
        t.equal(decodeJwtPayload(proofs[0] ?? '').nonce, undefined)
        t.equal(decodeJwtPayload(proofs[1] ?? '').nonce, 'server-nonce')
        t.equal(persisted[0]?.accessToken, 'nonce-access-token')
        t.equal(persisted[0]?.refreshToken, 'nonce-refresh-token')
    })

test('refreshOAuthCredentials returns reauth_required on auth failure',
    async t => {
        const credentials = await makeCredentials()
        let persistCount = 0

        const result = await refreshOAuthCredentials(credentials, {
            persistCredentials: async () => {
                persistCount += 1
            },
            fetch: async () => tokenResponse(
                { error: 'invalid_grant' },
                { status: 400 }
            )
        })

        t.equal(result.ok, false, 'refresh fails')
        if (result.ok) return
        t.equal(result.error.code, 'reauth_required')
        t.equal(result.error.status, 400)
        t.equal(persistCount, 0, 'failed refresh is not persisted')
    })
