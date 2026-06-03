import { test } from '@substrate-system/tapzero'
import {
    liveChannelSocketUrl,
    parseLiveMessage
} from '../src/client/live-channel.js'

test('liveChannelSocketUrl maps http->ws and https->wss', t => {
    t.equal(
        liveChannelSocketUrl({ protocol: 'https:', host: 'rsss.space' }),
        'wss://rsss.space/api/ws',
        'https yields a wss URL'
    )
    t.equal(
        liveChannelSocketUrl({ protocol: 'http:', host: 'localhost:8888' }),
        'ws://localhost:8888/api/ws',
        'http yields a ws URL'
    )
})

test('parseLiveMessage returns the envelope for a valid message', t => {
    const parsed = parseLiveMessage(
        JSON.stringify({ event: 'feed-updated', data: { feedId: 3 } })
    )
    t.deepEqual(
        parsed,
        { event: 'feed-updated', data: { feedId: 3 } },
        'a well-formed envelope is returned as-is'
    )
})

test('parseLiveMessage ignores pongs and malformed input', t => {
    t.equal(
        parseLiveMessage(JSON.stringify({ type: 'pong' })),
        null,
        'keepalive pongs are ignored'
    )
    t.equal(parseLiveMessage('not json'), null, 'invalid JSON is ignored')
    t.equal(
        parseLiveMessage(JSON.stringify({ data: {} })),
        null,
        'a message with no event is ignored'
    )
})
