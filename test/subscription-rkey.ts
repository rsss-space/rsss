import { test } from '@substrate-system/tapzero'
import {
    canonicalizeFeedUrl,
    isAtprotoRecordKey,
    subscriptionRkeyForFeedUrl
} from '../src/shared/subscription-rkey.js'

test('canonicalizeFeedUrl normalizes equivalent feed URLs', t => {
    t.equal(
        canonicalizeFeedUrl(
            'HTTPS://Example.COM:443/feeds/../rss.xml?b=2&a=1#section'
        ),
        'https://example.com/rss.xml?a=1&b=2',
        'normalizes scheme, host, path, query order, and hash'
    )
    t.equal(
        canonicalizeFeedUrl('http://example.com:80/feed.xml'),
        'http://example.com/feed.xml',
        'removes default ports'
    )
})

test('subscriptionRkeyForFeedUrl is stable for canonical URL variants',
    async t => {
        const first = await subscriptionRkeyForFeedUrl(
            'HTTPS://Example.COM:443/rss.xml?b=2&a=1#fragment'
        )
        const second = await subscriptionRkeyForFeedUrl(
            'https://example.com/rss.xml?a=1&b=2'
        )

        t.equal(first, second, 'canonical URL variants produce same rkey')
    })

test('subscriptionRkeyForFeedUrl differs for different feed URLs',
    async t => {
        const first = await subscriptionRkeyForFeedUrl(
            'https://example.com/rss.xml'
        )
        const second = await subscriptionRkeyForFeedUrl(
            'https://example.com/atom.xml'
        )

        t.ok(first !== second, 'different feed URLs produce different rkeys')
    })

test('subscriptionRkeyForFeedUrl returns a valid AT Protocol rkey',
    async t => {
        const rkey = await subscriptionRkeyForFeedUrl(
            'https://example.com/feed.xml'
        )

        t.equal(isAtprotoRecordKey(rkey), true, 'rkey passes syntax check')
        t.equal(rkey, rkey.toLowerCase(), 'rkey is lower-case')
        t.ok(rkey.length < 80, 'rkey stays under the spec recommendation')
    })

test('isAtprotoRecordKey validates baseline AT Protocol rkey syntax', t => {
    t.equal(isAtprotoRecordKey('feed.abc-123_:~'), true, 'allows safe chars')
    t.equal(isAtprotoRecordKey('.'), false, 'rejects single dot')
    t.equal(isAtprotoRecordKey('..'), false, 'rejects double dot')
    t.equal(isAtprotoRecordKey('feed/abc'), false, 'rejects slash')
    t.equal(isAtprotoRecordKey('feed abc'), false, 'rejects space')
    t.equal(isAtprotoRecordKey(''), false, 'rejects empty string')
})

test('canonicalizeFeedUrl rejects invalid URLs', t => {
    t.throws(
        () => canonicalizeFeedUrl('not a url'),
        /Invalid feed URL/,
        'invalid feed URLs throw a clear error'
    )
})
