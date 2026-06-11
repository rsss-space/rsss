import { test } from '@substrate-system/tapzero'
import { fakeResult } from './helpers/sql-fake.js'
import app from '../src/server/index.js'
import {
    RsssUserDO
} from '../src/server/durable-objects/index.js'
import {
    generateDPoPKeyPair,
    type OAuthState
} from '../src/server/auth/oauth.js'
import {
    executionCtx,
    jsonResponse,
    makeEnv,
    type FetchHandler
} from './signup-helpers.js'

async function makeOAuthState ():Promise<OAuthState> {
    const keyPair = await generateDPoPKeyPair()
    const privateJwk = await crypto.subtle.exportKey(
        'jwk',
        keyPair.privateKey
    )
    return {
        nonce: 'nonce-123',
        verifier: 'verifier-123',
        returnTo: '/feeds',
        dpopPrivateKeyJwk: privateJwk,
        dpopPublicKeyJwk: keyPair.publicJwk
    }
}

function oauthCallbackFetch ():FetchHandler {
    return (call) => {
        if (call.url === 'https://auth.example' +
            '/.well-known/oauth-authorization-server') {
            return jsonResponse({
                issuer: 'https://auth.example',
                authorization_endpoint: 'https://auth.example/authorize',
                token_endpoint: 'https://auth.example/token'
            })
        }

        if (call.url === 'https://auth.example/token') {
            return jsonResponse({
                sub: 'did:plc:alice',
                access_token: 'access-secret',
                refresh_token: 'refresh-secret',
                token_type: 'DPoP'
            })
        }

        if (call.url === 'https://plc.directory/did:plc:alice') {
            return jsonResponse({
                service: [{
                    id: '#atproto_pds',
                    serviceEndpoint: 'https://pds.example'
                }]
            })
        }

        if (call.url === 'https://public.api.bsky.app/xrpc/' +
            'app.bsky.actor.getProfile?actor=did:plc:alice') {
            return jsonResponse({
                handle: 'alice.example',
                avatar: 'https://cdn.example/avatar.jpg'
            })
        }

        throw new Error(`Unexpected fetch: ${call.url}`)
    }
}

interface RecordedDoCall {
    name:string
    path:string
    method:string
    body:string
}

function makeFakeDo (calls:RecordedDoCall[]) {
    return {
        idFromName: (name:string) => name,
        get: (name:string) => ({
            fetch: async (request:Request) => {
                calls.push({
                    name,
                    method: request.method,
                    path: new URL(request.url).pathname,
                    body: await request.text()
                })
                return new Response(null, { status: 204 })
            }
        })
    }
}

test('OAuth callback persists tokens in the user DO only', async t => {
    const env = makeEnv({
        USER_DO: makeFakeDo([]),
        SESSION_SECRET: 'secret-with-at-least-32-chars'
    })
    const calls:RecordedDoCall[] = []
    env.USER_DO = makeFakeDo(calls)
    const state = await makeOAuthState()
    const stateWithAuthServer = {
        ...state,
        authServer: 'https://auth.example'
    }
    await env.SESSIONS.put(
        `oauth:${state.nonce}`,
        JSON.stringify(stateWithAuthServer)
    )

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (
        input:RequestInfo | URL,
        init?:RequestInit
    ) => {
        const url = typeof input === 'string' ?
            input :
            input.toString()
        const method = init?.method ?? 'GET'
        const body = typeof init?.body === 'string' ?
            init.body :
            null
        return await oauthCallbackFetch()({
            url,
            method,
            body,
            headers: {}
        })
    }) as typeof fetch
    try {
        const response = await app.request(
            'https://rsss.space/api/auth/callback',
            {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                    code: 'auth-code',
                    state: state.nonce,
                    iss: 'https://auth.example'
                })
            },
            env,
            executionCtx
        )
        const body = await response.text()

        t.equal(response.status, 200, 'callback succeeds')
        t.equal(body.includes('access-secret'), false)
        t.equal(body.includes('refresh-secret'), false)
        const sessionKv = Array.from(env.SESSIONS.store.values()).join('\n')
        t.equal(sessionKv.includes('access-secret'), false)
        t.equal(sessionKv.includes('refresh-secret'), false)
        t.equal(calls.length, 1, 'one DO persistence call')
        if (!calls[0]) return
        t.equal(calls[0].name, 'did:plc:alice', 'uses DID as DO name')
        t.equal(calls[0].path, '/internal/oauth/credentials')
        t.equal(calls[0].method, 'PUT')

        const payload = JSON.parse(calls[0].body) as {
            did:string
            accessToken:string
            refreshToken:string
            tokenEndpoint:string
            pdsEndpoint:string
            dpopPrivateKeyJwk:JsonWebKey
        }
        t.equal(payload.did, 'did:plc:alice')
        t.equal(payload.accessToken, 'access-secret')
        t.equal(payload.refreshToken, 'refresh-secret')
        t.equal(payload.tokenEndpoint, 'https://auth.example/token')
        t.equal(payload.pdsEndpoint, 'https://pds.example')
        t.equal(typeof payload.dpopPrivateKeyJwk.d, 'string')
    } finally {
        globalThis.fetch = originalFetch
    }
})

function createHarness () {
    const storage = new Map<string, unknown>()
    const userDo = Object.create(RsssUserDO.prototype) as {
        sql:{ exec:() => QueryResult }
        ctx:{
            storage:{
                put:(key:string, value:unknown) => Promise<void>
            }
        }
        createRouter:() => {
            request:(path:string, init?:RequestInit) => Promise<Response>
        }
    }
    userDo.sql = { exec: () => fakeResult([]) }
    userDo.ctx = {
        storage: {
            async put (key:string, value:unknown) {
                storage.set(key, value)
            }
        }
    }
    return {
        app: userDo.createRouter(),
        storage
    }
}

test('user DO stores OAuth credentials server-side', async t => {
    const { app, storage } = createHarness()
    const response = await app.request(
        '/internal/oauth/credentials',
        {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
                did: 'did:plc:alice',
                accessToken: 'access-secret',
                refreshToken: 'refresh-secret',
                tokenEndpoint: 'https://auth.example/token',
                pdsEndpoint: 'https://pds.example',
                updatedAt: '2026-06-09T20:00:00.000Z',
                dpopPrivateKeyJwk: {
                    kty: 'EC',
                    crv: 'P-256',
                    x: 'x',
                    y: 'y',
                    d: 'private'
                }
            })
        }
    )

    t.equal(response.status, 204)
    const stored = storage.get('oauth:credentials') as {
        did:string
        accessToken:string
        refreshToken:string
        tokenEndpoint:string
        pdsEndpoint:string
        dpopPrivateKeyJwk:JsonWebKey
    } | undefined
    t.equal(stored?.did, 'did:plc:alice')
    t.equal(stored?.accessToken, 'access-secret')
    t.equal(stored?.refreshToken, 'refresh-secret')
    t.equal(stored?.tokenEndpoint, 'https://auth.example/token')
    t.equal(stored?.pdsEndpoint, 'https://pds.example')
    t.equal(stored?.dpopPrivateKeyJwk.d, 'private')
})

test('AC3.3: OAuthState persists resolved authServer through KV round-trip',
    async t => {
        const env = makeEnv()
        const state = await makeOAuthState()
        const authServer = 'https://auth.example'

        // Simulate what startOAuthFlow does: store state with authServer
        const stateWithAuthServer = {
            ...state,
            authServer
        }
        await env.SESSIONS.put(
        `oauth:${state.nonce}`,
        JSON.stringify(stateWithAuthServer)
        )

        // Read back from KV and verify authServer is present
        const storedJson = await env.SESSIONS.get(`oauth:${state.nonce}`)
        t.ok(storedJson, 'state stored in KV')
        const parsed = JSON.parse(storedJson!) as typeof stateWithAuthServer
        t.equal(parsed.authServer, authServer, 'authServer persists in KV')
    })

test(
    'AC3.1: callback rejects when body.iss !== storedState.authServer',
    async t => {
        const env = makeEnv({
            USER_DO: makeFakeDo([]),
            SESSION_SECRET: 'secret-with-at-least-32-chars'
        })
        const state = await makeOAuthState()
        const storedAuthServer = 'https://auth.example'

        // Store state with correct authServer
        const stateWithAuthServer = {
            ...state,
            authServer: storedAuthServer
        }
        await env.SESSIONS.put(
        `oauth:${state.nonce}`,
        JSON.stringify(stateWithAuthServer)
        )

        // Mock fetch to track whether exchangeCode is called
        const fetchCalls: Array<{url:string}> = []
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (
            input:RequestInfo | URL,
            _init?:RequestInit
        ) => {
            const url = typeof input === 'string' ? input : input.toString()
            fetchCalls.push({ url })

            if (url === 'https://attacker.example' +
            '/.well-known/oauth-authorization-server') {
                return jsonResponse({
                    issuer: 'https://attacker.example',
                    authorization_endpoint: 'https://attacker.example/authorize',
                    token_endpoint: 'https://attacker.example/token'
                })
            }

            throw new Error(`Unexpected fetch: ${url}`)
        }) as typeof fetch

        try {
        // Call callback with mismatched iss
            const response = await app.request(
                'https://rsss.space/api/auth/callback',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        code: 'auth-code',
                        state: state.nonce,
                        iss: 'https://attacker.example' // Mismatch!
                    })
                },
                env,
                executionCtx
            )

            t.equal(response.status, 400, 'callback rejects with 400')
            const body = await response.json<{error?:string}>()
            t.equal(body.error, 'invalid_iss', 'error is invalid_iss')
            t.equal(
                fetchCalls.length,
                0,
                'no outbound fetch to attacker server'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('AC3.2: callback succeeds when body.iss === storedState.authServer',
    async t => {
        const env = makeEnv({
            USER_DO: makeFakeDo([]),
            SESSION_SECRET: 'secret-with-at-least-32-chars'
        })
        const calls:RecordedDoCall[] = []
        env.USER_DO = makeFakeDo(calls)
        const state = await makeOAuthState()
        const authServer = 'https://auth.example'

        // Store state with authServer
        const stateWithAuthServer = {
            ...state,
            authServer
        }
        await env.SESSIONS.put(
        `oauth:${state.nonce}`,
        JSON.stringify(stateWithAuthServer)
        )

        const originalFetch = globalThis.fetch
        globalThis.fetch = (async (
            input:RequestInfo | URL,
            init?:RequestInit
        ) => {
            const url = typeof input === 'string' ?
                input :
                input.toString()
            const method = init?.method ?? 'GET'
            const body = typeof init?.body === 'string' ?
                init.body :
                null
            return await oauthCallbackFetch()({
                url,
                method,
                body,
                headers: {}
            })
        }) as typeof fetch
        try {
            const response = await app.request(
                'https://rsss.space/api/auth/callback',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        code: 'auth-code',
                        state: state.nonce,
                        iss: authServer // Matches!
                    })
                },
                env,
                executionCtx
            )

            t.equal(response.status, 200, 'callback succeeds')
            const respBody = await response.json<{success?:boolean}>()
            t.equal(respBody.success, true, 'response indicates success')
            t.equal(calls.length, 1, 'credentials persisted to DO')
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test(
    'AC3.3 (fail-closed): callback rejects when stored state lacks authServer',
    async t => {
        const env = makeEnv({
            USER_DO: makeFakeDo([]),
            SESSION_SECRET: 'secret-with-at-least-32-chars'
        })
        const state = await makeOAuthState()

        // Store state WITHOUT authServer (simulating old code)
        await env.SESSIONS.put(
        `oauth:${state.nonce}`,
        JSON.stringify(state)
        )

        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => {
            throw new Error('should not reach fetch')
        }) as typeof fetch

        try {
            const response = await app.request(
                'https://rsss.space/api/auth/callback',
                {
                    method: 'POST',
                    headers: { 'content-type': 'application/json' },
                    body: JSON.stringify({
                        code: 'auth-code',
                        state: state.nonce,
                        iss: 'https://auth.example'
                    })
                },
                env,
                executionCtx
            )

            t.equal(response.status, 400, 'callback rejects with 400')
            const body = await response.json<{error?:string}>()
            t.equal(body.error, 'invalid_iss', 'error is invalid_iss')
        } finally {
            globalThis.fetch = originalFetch
        }
    })
