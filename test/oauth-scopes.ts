import { test } from '@substrate-system/tapzero'
import { startOAuthFlow } from '../src/server/auth/oauth.js'
import app from '../src/server/index.js'
import {
    executionCtx,
    makeEnv,
    type FetchHandler,
    withFetch
} from './signup-helpers.js'

const EXPECTED_SCOPE =
    'atproto repo:space.rsss.feed.subscription ' +
    'repo:space.rsss.graph.follow'

function oauthFetchHandler ():FetchHandler {
    return (call) => {
        if (call.url === 'https://dns.google/resolve?name=' +
            '_atproto.alice.example&type=TXT') {
            return new Response(JSON.stringify({
                Answer: [{ data: '"did=did:plc:alice"' }]
            }), {
                headers: { 'content-type': 'application/json' }
            })
        }

        if (call.url === 'https://plc.directory/did:plc:alice') {
            return new Response(JSON.stringify({
                service: [{
                    id: '#atproto_pds',
                    serviceEndpoint: 'https://pds.example'
                }]
            }), {
                headers: { 'content-type': 'application/json' }
            })
        }

        if (call.url === 'https://pds.example' +
            '/.well-known/oauth-protected-resource') {
            return new Response(JSON.stringify({
                authorization_servers: ['https://auth.example']
            }), {
                headers: { 'content-type': 'application/json' }
            })
        }

        if (call.url === 'https://auth.example' +
            '/.well-known/oauth-authorization-server') {
            return new Response(JSON.stringify({
                issuer: 'https://auth.example',
                authorization_endpoint: 'https://auth.example/authorize',
                token_endpoint: 'https://auth.example/token',
                pushed_authorization_request_endpoint:
                    'https://auth.example/par'
            }), {
                headers: { 'content-type': 'application/json' }
            })
        }

        if (call.url === 'https://auth.example/par') {
            return new Response(JSON.stringify({
                request_uri: 'urn:ietf:params:oauth:request_uri:test'
            }), {
                headers: { 'content-type': 'application/json' }
            })
        }

        throw new Error(`Unexpected fetch: ${call.url}`)
    }
}

test('OAuth start request uses rsss granular repo scopes', async (t) => {
    await withFetch(oauthFetchHandler(), async (calls) => {
        await startOAuthFlow(
            'alice.example',
            'https://rsss.space/oauth/client-metadata.json',
            'https://rsss.space/oauth/callback'
        )

        const parCall = calls.find(call => {
            return call.url === 'https://auth.example/par'
        })
        const params = new URLSearchParams(String(parCall?.body ?? ''))
        const scope = params.get('scope')

        t.equal(scope, EXPECTED_SCOPE)
        t.equal(scope?.includes('transition:generic'), false)
        t.equal(scope?.includes('app.bsky.'), false)
    })
})

test('OAuth client metadata advertises rsss granular repo scopes',
    async (t) => {
        const response = await app.request(
            'https://rsss.space/oauth/client-metadata.json',
            {},
            makeEnv(),
            executionCtx
        )
        const metadata = await response.json() as { scope?:string }

        t.equal(response.status, 200)
        t.equal(metadata.scope, EXPECTED_SCOPE)
        t.equal(metadata.scope?.includes('transition:generic'), false)
        t.equal(metadata.scope?.includes('app.bsky.'), false)
    })
