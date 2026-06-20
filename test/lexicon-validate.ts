import { test } from '@substrate-system/tapzero'
import { isValidRecord } from '../src/shared/lexicons/validate.js'

test('scheduled-drain.AC1.1: valid subscription record', (t) => {
    const record = {
        feedUrl: 'https://example.com/feed',
        createdAt: '2024-01-01T00:00:00Z'
    }
    const result = isValidRecord('space.rsss.feed.subscription', record)
    t.ok(result, 'Valid subscription with feedUrl and createdAt')
})

test('scheduled-drain.AC1.2: valid follow record', (t) => {
    const record = {
        subject: 'did:plc:example',
        createdAt: '2024-01-01T00:00:00Z'
    }
    const result = isValidRecord('space.rsss.graph.follow', record)
    t.ok(result, 'Valid follow with subject and createdAt')
})

test('scheduled-drain.AC1.3: unknown collection', (t) => {
    const record = { some: 'data' }
    const result = isValidRecord('space.rsss.post', record)
    t.ok(!result, 'Unknown collection should be invalid')
})

test('scheduled-drain.AC1.4: missing required field', (t) => {
    const record = {
        feedUrl: 'https://example.com/feed'
        // missing createdAt
    }
    const result = isValidRecord('space.rsss.feed.subscription', record)
    t.ok(!result, 'Missing required createdAt should be invalid')
})

test('scheduled-drain.AC1.5: $type mismatch', (t) => {
    const record = {
        feedUrl: 'https://example.com/feed',
        createdAt: '2024-01-01T00:00:00Z',
        $type: 'space.rsss.graph.follow'  // wrong type
    }
    const result = isValidRecord('space.rsss.feed.subscription', record)
    t.ok(!result, 'Mismatched $type should be invalid')
})

test('scheduled-drain.AC1.6: non-object record', (t) => {
    t.ok(
        !isValidRecord('space.rsss.feed.subscription', null),
        'null should be invalid'
    )
    t.ok(
        !isValidRecord('space.rsss.feed.subscription', []),
        'array should be invalid'
    )
    t.ok(
        !isValidRecord('space.rsss.feed.subscription', 'string'),
        'string should be invalid'
    )
    t.ok(
        !isValidRecord('space.rsss.feed.subscription', 42),
        'number should be invalid'
    )
})

test('scheduled-drain.AC1.7: declared property with wrong type', (t) => {
    const record = {
        feedUrl: 123,  // should be string
        createdAt: '2024-01-01T00:00:00Z'
    }
    const result = isValidRecord('space.rsss.feed.subscription', record)
    t.ok(!result, 'Non-string feedUrl should be invalid')
})

test('scheduled-drain.AC1.8: extra undeclared keys', (t) => {
    const record = {
        feedUrl: 'https://example.com/feed',
        createdAt: '2024-01-01T00:00:00Z',
        note: 'hi'  // extra undeclared key
    }
    const result = isValidRecord('space.rsss.feed.subscription', record)
    t.ok(result, 'Extra undeclared keys should be tolerated')
})

test('scheduled-drain.AC1.9: optional property', (t) => {
    // Valid optional property
    const recordWithValidOptional = {
        feedUrl: 'https://example.com/feed',
        createdAt: '2024-01-01T00:00:00Z',
        title: 'My feed'
    }
    const resultValid = isValidRecord(
        'space.rsss.feed.subscription',
        recordWithValidOptional
    )
    t.ok(resultValid, 'Valid optional title should be accepted')

    // Invalid optional property (wrong type)
    const recordWithInvalidOptional = {
        feedUrl: 'https://example.com/feed',
        createdAt: '2024-01-01T00:00:00Z',
        title: 123  // should be string
    }
    const resultInvalid = isValidRecord(
        'space.rsss.feed.subscription',
        recordWithInvalidOptional
    )
    t.ok(!resultInvalid, 'Invalid optional title type should be rejected')
})
