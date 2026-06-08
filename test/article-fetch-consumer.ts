import { test } from '@substrate-system/tapzero'
import {
    handleArticleFetchQueueBatch,
    type ArticleFetchConsumerDeps,
    type ArticleFetchConsumerEnv
} from '../src/server/article-fetch-consumer.js'
import type { ArticleFetchJob } from '../src/server/article-fetch-job.js'

interface FakeMessage {
    body:unknown
    acked:boolean
    ack:() => void
    retry:() => void
}

function fakeMessage (body:unknown):FakeMessage {
    return {
        body,
        acked: false,
        ack () {
            this.acked = true
        },
        retry () {
            throw new Error('unexpected retry')
        }
    }
}

function fakeBatch (messages:FakeMessage[]) {
    return {
        queue: 'article-fetch-jobs',
        messages,
        ackAll () {},
        retryAll () {}
    }
}

function fakeEnv (
    requests:Request[],
    queued:unknown[] = []
):ArticleFetchConsumerEnv {
    return {
        USER_DO: {
            idFromString (id:string) {
                return id as unknown as DurableObjectId
            },
            get () {
                return {
                    async fetch (request:Request) {
                        requests.push(request)
                        return new Response(null, { status: 204 })
                    }
                }
            }
        },
        BLURHASH_QUEUE: {
            async send (message:unknown) {
                queued.push(message)
            }
        }
    }
}

test('article-fetch consumer writes html to DO endpoint', async t => {
    const requests:Request[] = []
    const queued:unknown[] = []
    const job:ArticleFetchJob = {
        itemId: 7,
        link: 'https://example.com/article',
        objectId: 'user-do-id'
    }
    const message = fakeMessage(job)
    const env = fakeEnv(requests, queued)
    const deps:ArticleFetchConsumerDeps = {
        async fetchArticle (_link) {
            return {
                status: 'succeeded',
                html: '<p>hello</p>',
                fetchedAt: '2026-06-07 12:00:00'
            }
        }
    }

    await handleArticleFetchQueueBatch(fakeBatch([message]), env, deps)

    t.equal(requests.length, 1, 'one DO write')
    t.equal(
        new URL(requests[0].url).pathname,
        '/internal/full-content/items/7',
        'writes to correct DO path'
    )
    t.equal(requests[0].method, 'POST', 'uses POST')
    const body = await requests[0].json() as {
        status:string
        html:string
        fetchedAt:string
    }
    t.equal(body.status, 'succeeded', 'status forwarded')
    t.equal(body.html, '<p>hello</p>', 'html forwarded')
    t.equal(message.acked, true, 'message is acked on success')
})

test('article-fetch consumer acks invalid jobs', async t => {
    const requests:Request[] = []
    const message = fakeMessage({ notAJob: true })
    const env = fakeEnv(requests, [])
    const deps:ArticleFetchConsumerDeps = {
        async fetchArticle () {
            throw new Error('should not fetch invalid job')
        }
    }

    await handleArticleFetchQueueBatch(fakeBatch([message]), env, deps)

    t.equal(requests.length, 0, 'no DO write for invalid job')
    t.equal(message.acked, true, 'invalid job is acked')
})

test('article-fetch consumer acks fetch failure results', async t => {
    const requests:Request[] = []
    const queued:unknown[] = []
    const job:ArticleFetchJob = {
        itemId: 8,
        link: 'https://example.com/missing',
        objectId: 'user-do-id'
    }
    const message = fakeMessage(job)
    const env = fakeEnv(requests, queued)
    const deps:ArticleFetchConsumerDeps = {
        async fetchArticle (_link) {
            return { status: 'failed_network' }
        }
    }

    await handleArticleFetchQueueBatch(fakeBatch([message]), env, deps)

    t.equal(requests.length, 1, 'DO write even on failure status')
    const body = await requests[0].json() as { status:string }
    t.equal(body.status, 'failed_network', 'failure status forwarded')
    t.equal(message.acked, true, 'failure result is acked')
    t.equal(queued.length, 0, 'no blur jobs on failed fetch')
})

test('article-fetch consumer enqueues body blur jobs on success', async t => {
    const requests:Request[] = []
    const queued:unknown[] = []
    const job:ArticleFetchJob = {
        itemId: 9,
        link: 'https://example.com/article',
        objectId: 'user-do-id-2'
    }
    const message = fakeMessage(job)
    const env = fakeEnv(requests, queued)
    const deps:ArticleFetchConsumerDeps = {
        async fetchArticle (_link) {
            return {
                status: 'succeeded',
                html: '<img src="https://img.example.com/a.jpg">' +
                    '<img src="https://img.example.com/b.png">',
                fetchedAt: '2026-06-07 12:00:00'
            }
        }
    }

    await handleArticleFetchQueueBatch(fakeBatch([message]), env, deps)

    t.equal(queued.length, 2, 'one blur job per image')
    const first = queued[0] as {
        imageUrl:string
        itemId:number
        objectId:string
        target:string
    }
    t.equal(first.imageUrl, 'https://img.example.com/a.jpg', 'imageUrl set')
    t.equal(first.itemId, 9, 'itemId matches job')
    t.equal(first.objectId, 'user-do-id-2', 'objectId matches job')
    t.equal(first.target, 'body', 'target is body')
})

test('article-fetch consumer does not enqueue blur jobs on failure', async t => {
    const requests:Request[] = []
    const queued:unknown[] = []
    const job:ArticleFetchJob = {
        itemId: 10,
        link: 'https://example.com/broken',
        objectId: 'user-do-id-3'
    }
    const message = fakeMessage(job)
    const env = fakeEnv(requests, queued)
    const deps:ArticleFetchConsumerDeps = {
        async fetchArticle (_link) {
            return { status: 'failed_network' }
        }
    }

    await handleArticleFetchQueueBatch(fakeBatch([message]), env, deps)

    t.equal(queued.length, 0, 'no blur jobs when fetch failed')
})
