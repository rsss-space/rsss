import { test } from '@substrate-system/tapzero'
import {
    isArticleFetchJob
} from '../src/server/article-fetch-job.js'

test('isArticleFetchJob - valid job passes', t => {
    const job = { itemId: 1, link: 'https://example.com', objectId: 'abc123' }
    t.ok(isArticleFetchJob(job), 'valid job returns true')
})

test('isArticleFetchJob - null is rejected', t => {
    t.equal(isArticleFetchJob(null), false, 'null is rejected')
})

test('isArticleFetchJob - empty object is rejected', t => {
    t.equal(isArticleFetchJob({}), false, 'empty object is rejected')
})

test('isArticleFetchJob - non-number itemId is rejected', t => {
    const job = { itemId: '1', link: 'https://example.com', objectId: 'abc' }
    t.equal(isArticleFetchJob(job), false, 'string itemId is rejected')
})

test('isArticleFetchJob - float itemId is rejected', t => {
    const job = { itemId: 1.5, link: 'https://example.com', objectId: 'abc' }
    t.equal(isArticleFetchJob(job), false, 'non-integer itemId is rejected')
})

test('isArticleFetchJob - non-string link is rejected', t => {
    const job = { itemId: 1, link: 42, objectId: 'abc' }
    t.equal(isArticleFetchJob(job), false, 'non-string link is rejected')
})

test('isArticleFetchJob - missing objectId is rejected', t => {
    const job = { itemId: 1, link: 'https://example.com' }
    t.equal(isArticleFetchJob(job), false, 'missing objectId is rejected')
})

test('isArticleFetchJob - non-string objectId is rejected', t => {
    const job = { itemId: 1, link: 'https://example.com', objectId: 99 }
    t.equal(isArticleFetchJob(job), false, 'non-string objectId is rejected')
})
