import { test } from '@substrate-system/tapzero'
import {
    createConstellationClient,
    createSlingshotClient,
    RSSS_USER_AGENT,
    type MicrocosmServiceError
} from '../src/server/microcosm-client.js'

interface CapturedRequest {
    url:string
    method:string
    headers:Record<string, string>
}

function captureRequests (
    responses:Response[]
):{ fetch:typeof fetch; calls:CapturedRequest[] } {
    const calls:CapturedRequest[] = []
    let idx = 0

    const fakeFetch:typeof fetch = (input, init) => {
        const url = typeof input === 'string' ?
            input :
            (input as Request).url
        const headers:Record<string, string> = {}
        const reqHeaders = new Headers(init?.headers)
        reqHeaders.forEach((val, key) => { headers[key] = val })
        calls.push({ url, method: init?.method ?? 'GET', headers })
        const response = responses[idx] ?? responses[responses.length - 1]
        idx++
        return Promise.resolve(response)
    }

    return { fetch: fakeFetch, calls }
}

function jsonResponse (
    body:unknown,
    status = 200
):Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    })
}

function networkError ():typeof fetch {
    return () => Promise.reject(new Error('network error'))
}

// ---- Constellation client ----

test('constellation getBacklinks calls correct URL', async t => {
    const backlinks = [
        { uri: 'at://did:plc:alice/space.rsss.graph.follow/abc', cid: 'baf1', value: {} }
    ]
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ backlinks, cursor: 'next' })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    const result = await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok(!('code' in result), 'no error')
    t.equal(calls.length, 1)
    const url = new URL(calls[0].url)
    t.ok(
        url.pathname.includes('getBacklinks'),
        'path includes getBacklinks'
    )
    t.equal(url.searchParams.get('collection'), 'space.rsss.graph.follow')
    t.equal(url.searchParams.get('path'), '.subject')
    t.equal(url.searchParams.get('subject'), 'did:plc:bob')
})

test('constellation getBacklinks returns backlinks and cursor', async t => {
    const backlinks = [
        { uri: 'at://did:plc:alice/space.rsss.graph.follow/abc', cid: 'baf1', value: {} }
    ]
    const { fetch: fakeFetch } = captureRequests([
        jsonResponse({ backlinks, cursor: 'next' })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    const result = await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    if ('code' in result) {
        t.fail('expected ok result')
        return
    }
    t.equal(result.backlinks.length, 1)
    t.equal(result.cursor, 'next')
})

test('constellation getBacklinks passes limit and cursor params', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ backlinks: [], cursor: undefined })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob',
        limit: 25,
        cursor: 'abc123'
    })

    const url = new URL(calls[0].url)
    t.equal(url.searchParams.get('limit'), '25')
    t.equal(url.searchParams.get('cursor'), 'abc123')
})

test('constellation getBacklinksCount calls correct URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ count: 7 })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    const result = await client.getBacklinksCount({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    if ('code' in result) {
        t.fail('expected ok result')
        return
    }
    t.equal(result.count, 7)
    const url = new URL(calls[0].url)
    t.ok(url.pathname.includes('getBacklinksCount'), 'path includes getBacklinksCount')
})

test('constellation getDistinct calls correct URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ subjects: ['did:plc:alice', 'did:plc:bob'] })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    const result = await client.getDistinct({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:carol'
    })

    if ('code' in result) {
        t.fail('expected ok result')
        return
    }
    t.deepEqual(result.subjects, ['did:plc:alice', 'did:plc:bob'])
    const url = new URL(calls[0].url)
    t.ok(url.pathname.includes('getDistinct'), 'path includes getDistinct')
})

test('constellation sends User-Agent header', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ backlinks: [] })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok(
        calls[0].headers['user-agent']?.includes('rsss'),
        'User-Agent contains rsss'
    )
})

test('constellation uses default base URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ backlinks: [] })
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok(
        calls[0].url.startsWith('https://constellation.microcosm.blue'),
        'uses default constellation URL'
    )
})

test('constellation uses configured base URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ backlinks: [] })
    ])

    const client = createConstellationClient({
        baseUrl: 'https://my-constellation.example',
        fetch: fakeFetch
    })
    await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok(
        calls[0].url.startsWith('https://my-constellation.example'),
        'uses configured URL'
    )
})

test('constellation degrades gracefully on network error', async t => {
    const client = createConstellationClient({ fetch: networkError() })
    const result = await client.getBacklinks({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok('code' in result, 'returns error shape')
    const err = result as MicrocosmServiceError
    t.equal(err.code, 'service_unavailable')
})

test('constellation degrades gracefully on non-200 response', async t => {
    const { fetch: fakeFetch } = captureRequests([
        jsonResponse({ error: 'ServiceUnavailable' }, 503)
    ])

    const client = createConstellationClient({ fetch: fakeFetch })
    const result = await client.getBacklinksCount({
        collection: 'space.rsss.graph.follow',
        path: '.subject',
        subject: 'did:plc:bob'
    })

    t.ok('code' in result, 'returns error shape')
    const err = result as MicrocosmServiceError
    t.equal(err.code, 'service_unavailable')
    t.equal(err.status, 503)
})

// ---- Slingshot client ----

test('slingshot getRecord calls correct URL', async t => {
    const record = { $type: 'space.rsss.feed.subscription', feedUrl: 'https://example.com/feed' }
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ uri: 'at://did:plc:alice/space.rsss.feed.subscription/abc', cid: 'baf1', value: record })
    ])

    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok(!('code' in result), 'no error')
    const url = new URL(calls[0].url)
    t.ok(url.pathname.includes('getRecord'), 'path includes getRecord')
    t.equal(url.searchParams.get('repo'), 'did:plc:alice')
    t.equal(url.searchParams.get('collection'), 'space.rsss.feed.subscription')
    t.equal(url.searchParams.get('rkey'), 'abc')
})

test('slingshot resolveIdentity calls correct URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ did: 'did:plc:alice', handle: 'alice.bsky.social' })
    ])

    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.resolveIdentity({ did: 'did:plc:alice' })

    t.ok(!('code' in result), 'no error')
    const url = new URL(calls[0].url)
    t.ok(url.pathname.includes('resolveIdentity'), 'path includes resolveIdentity')
    t.equal(url.searchParams.get('did'), 'did:plc:alice')
})

test('slingshot sends User-Agent header', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ uri: 'at://x', cid: 'y', value: {} })
    ])

    const client = createSlingshotClient({ fetch: fakeFetch })
    await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok(
        calls[0].headers['user-agent']?.includes('rsss'),
        'User-Agent contains rsss'
    )
})

test('slingshot uses default base URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ uri: 'at://x', cid: 'y', value: {} })
    ])

    const client = createSlingshotClient({ fetch: fakeFetch })
    await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok(
        calls[0].url.startsWith('https://slingshot.microcosm.blue'),
        'uses default slingshot URL'
    )
})

test('slingshot uses configured base URL', async t => {
    const { fetch: fakeFetch, calls } = captureRequests([
        jsonResponse({ uri: 'at://x', cid: 'y', value: {} })
    ])

    const client = createSlingshotClient({
        baseUrl: 'https://my-slingshot.example',
        fetch: fakeFetch
    })
    await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok(
        calls[0].url.startsWith('https://my-slingshot.example'),
        'uses configured URL'
    )
})

test('slingshot degrades gracefully on network error', async t => {
    const client = createSlingshotClient({ fetch: networkError() })
    const result = await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok('code' in result, 'returns error shape')
    const err = result as MicrocosmServiceError
    t.equal(err.code, 'service_unavailable')
})

test('slingshot degrades gracefully on non-200 response', async t => {
    const { fetch: fakeFetch } = captureRequests([
        jsonResponse({ error: 'NotFound' }, 404)
    ])

    const client = createSlingshotClient({ fetch: fakeFetch })
    const result = await client.getRecord({
        repo: 'did:plc:alice',
        collection: 'space.rsss.feed.subscription',
        rkey: 'abc'
    })

    t.ok('code' in result, 'returns error shape')
    const err = result as MicrocosmServiceError
    t.equal(err.code, 'service_unavailable')
    t.equal(err.status, 404)
})

test('RSSS_USER_AGENT is exported and contains rsss', t => {
    t.ok(typeof RSSS_USER_AGENT === 'string', 'is a string')
    t.ok(RSSS_USER_AGENT.toLowerCase().includes('rsss'), 'includes rsss')
})
