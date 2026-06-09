import { test } from '@substrate-system/tapzero'
import {
    feedSubscriptionLexicon,
    graphFollowLexicon,
    rsssLexicons,
    type FeedSubscriptionRecord,
    type GraphFollowRecord
} from '../src/shared/lexicons/index.js'

const subscriptionRecord = {
    feedUrl: 'https://example.com/feed.xml',
    title: 'Example Feed',
    siteUrl: 'https://example.com/',
    createdAt: '2026-06-09T12:00:00.000Z'
} satisfies FeedSubscriptionRecord

const followRecord = {
    subject: 'did:plc:example',
    createdAt: '2026-06-09T12:00:00.000Z'
} satisfies GraphFollowRecord

test('rsss lexicons export both AT Protocol records', t => {
    t.equal(
        rsssLexicons.length,
        2,
        'exports exactly the two rsss lexicons'
    )
    t.equal(
        feedSubscriptionLexicon.id,
        'space.rsss.feed.subscription',
        'subscription lexicon has the expected NSID'
    )
    t.equal(
        graphFollowLexicon.id,
        'space.rsss.graph.follow',
        'follow lexicon has the expected NSID'
    )
})

test('feed subscription lexicon defines required record fields', t => {
    const main = feedSubscriptionLexicon.defs.main

    t.equal(main.type, 'record', 'main definition is a record')
    t.deepEqual(
        main.record.required,
        ['feedUrl', 'createdAt'],
        'required fields match the subscription contract'
    )
    t.equal(main.record.properties.feedUrl.type, 'string', 'feedUrl string')
    t.equal(main.record.properties.feedUrl.format, 'uri', 'feedUrl uri')
    t.equal(main.record.properties.title.type, 'string', 'title string')
    t.equal(main.record.properties.siteUrl.type, 'string', 'siteUrl string')
    t.equal(main.record.properties.siteUrl.format, 'uri', 'siteUrl uri')
    t.equal(
        main.record.properties.createdAt.type,
        'string',
        'createdAt string'
    )
    t.equal(
        main.record.properties.createdAt.format,
        'datetime',
        'createdAt datetime'
    )
    t.equal(
        subscriptionRecord.feedUrl,
        'https://example.com/feed.xml',
        'derived subscription type accepts lexicon fields'
    )
})

test('graph follow lexicon defines required record fields', t => {
    const main = graphFollowLexicon.defs.main

    t.equal(main.type, 'record', 'main definition is a record')
    t.deepEqual(
        main.record.required,
        ['subject', 'createdAt'],
        'required fields match the follow contract'
    )
    t.equal(main.record.properties.subject.type, 'string', 'subject string')
    t.equal(main.record.properties.subject.format, 'did', 'subject did')
    t.equal(
        main.record.properties.createdAt.type,
        'string',
        'createdAt string'
    )
    t.equal(
        main.record.properties.createdAt.format,
        'datetime',
        'createdAt datetime'
    )
    t.equal(
        followRecord.subject,
        'did:plc:example',
        'derived follow type accepts lexicon fields'
    )
})
