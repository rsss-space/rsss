import { test } from '@substrate-system/tapzero'
import {
    handleBlurhashQueueBatch,
    type BlurhashConsumerDeps,
    type BlurhashConsumerEnv,
    type BlurhashJob
} from '../src/server/blurhash-consumer.js'

const CACHED_ENTRY = JSON.stringify({
    blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
    image_width: 1200,
    image_height: 630
})

function fakeMessage (body:BlurhashJob) {
    return {
        body,
        acked: false,
        ack () { this.acked = true },
        retry () { throw new Error('unexpected retry') }
    }
}

function fakeBatch (messages:ReturnType<typeof fakeMessage>[]) {
    return {
        queue: 'blurhash-jobs',
        messages,
        ackAll () {},
        retryAll () {}
    }
}

function fakeKvHitEnv (requests:Request[]):BlurhashConsumerEnv {
    return {
        BLURHASH_KV: {
            async get () { return CACHED_ENTRY },
            async put () {}
        },
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
        }
    }
}

const noopDeps:BlurhashConsumerDeps = {
    async fetchImage () { throw new Error('cache-hit: must not fetch') },
    decodeImage () { throw new Error('cache-hit: must not decode') },
    resizeImage () { throw new Error('cache-hit: must not resize') },
    encodePixels () { throw new Error('cache-hit: must not encode') }
}

test('writeItemBlurhash routes thumbnail target to /internal/blurhash/items/:id',
    async t => {
        const requests:Request[] = []
        const message = fakeMessage({
            imageUrl: 'https://cdn.example.com/thumb.jpg',
            itemId: 99,
            objectId: 'do-id-thumb'
        })
        const env = fakeKvHitEnv(requests)

        await handleBlurhashQueueBatch(fakeBatch([message]), env, noopDeps)

        t.equal(requests.length, 1, 'exactly one DO request')
        t.equal(
            new URL(requests[0].url).pathname,
            '/internal/blurhash/items/99',
            'thumbnail path used'
        )
        t.deepEqual(await requests[0].json(), {
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            image_width: 1200,
            image_height: 630
        }, 'thumbnail body is the cache entry')
        t.equal(message.acked, true, 'message is acked')
    }
)

test('writeItemBlurhash routes body target to /internal/blurhash/body-items/:id',
    async t => {
        const requests:Request[] = []
        const message = fakeMessage({
            imageUrl: 'https://cdn.example.com/body-image.jpg',
            itemId: 77,
            objectId: 'do-id-body',
            target: 'body'
        })
        const env = fakeKvHitEnv(requests)

        await handleBlurhashQueueBatch(fakeBatch([message]), env, noopDeps)

        t.equal(requests.length, 1, 'exactly one DO request')
        t.equal(
            new URL(requests[0].url).pathname,
            '/internal/blurhash/body-items/77',
            'body path used'
        )
        t.deepEqual(await requests[0].json(), {
            url: 'https://cdn.example.com/body-image.jpg',
            blurhash: 'LEHV6nWB2yk8pyo0adR*.7kCMdnj',
            width: 1200,
            height: 630
        }, 'body payload has url + width + height keys')
        t.equal(message.acked, true, 'message is acked')
    }
)
