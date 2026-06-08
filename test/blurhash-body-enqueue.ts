import { test } from '@substrate-system/tapzero'
import {
    enqueueBodyBlurJobs,
    MAX_BODY_BLUR_IMAGES
} from '../src/server/blurhash-body-enqueue.js'

function fakeQueue () {
    const sent:unknown[] = []
    return {
        sent,
        async send (message:unknown) {
            sent.push(message)
        }
    }
}

test('enqueueBodyBlurJobs sends one body job per image', async t => {
    const queue = fakeQueue()
    const html =
        '<img src="https://img.example.com/a.jpg">' +
        '<img src="https://img.example.com/b.png">'

    const count = await enqueueBodyBlurJobs(queue, html, 42, 'do-id')

    t.equal(count, 2, 'returns number of jobs enqueued')
    t.equal(queue.sent.length, 2, 'one job per image')
    const first = queue.sent[0] as {
        imageUrl:string
        itemId:number
        objectId:string
        target:string
    }
    t.equal(first.imageUrl, 'https://img.example.com/a.jpg', 'imageUrl set')
    t.equal(first.itemId, 42, 'itemId matches')
    t.equal(first.objectId, 'do-id', 'objectId matches')
    t.equal(first.target, 'body', 'target is body')
})

test('enqueueBodyBlurJobs caps at MAX_BODY_BLUR_IMAGES', async t => {
    const queue = fakeQueue()
    const imgs:string[] = []
    for (let i = 0; i < MAX_BODY_BLUR_IMAGES + 10; i++) {
        imgs.push(`<img src="https://img.example.com/${i}.jpg">`)
    }

    const count = await enqueueBodyBlurJobs(queue, imgs.join(''), 1, 'do-id')

    t.equal(count, MAX_BODY_BLUR_IMAGES, 'caps the returned count')
    t.equal(queue.sent.length, MAX_BODY_BLUR_IMAGES, 'caps jobs enqueued')
})

test('enqueueBodyBlurJobs sends nothing when html has no images', async t => {
    const queue = fakeQueue()

    const count = await enqueueBodyBlurJobs(queue, '<p>no images</p>', 1, 'd')

    t.equal(count, 0, 'returns 0')
    t.equal(queue.sent.length, 0, 'no jobs enqueued')
})
