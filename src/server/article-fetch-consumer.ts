import { isArticleFetchJob } from './article-fetch-job.js'
import type { ArticleFetchJob } from './article-fetch-job.js'
import { fetchFullArticle, type FetchFullArticleResult } from './article-fetch.js'
import { enqueueBodyBlurJobs } from './blurhash-body-enqueue.js'

export type { ArticleFetchJob }

export interface ArticleFetchConsumerDeps {
    fetchArticle:(link:string)=> Promise<FetchFullArticleResult>
}

export interface ArticleFetchConsumerEnv {
    USER_DO:{
        idFromString:(id:string)=> DurableObjectId
        get:(id:DurableObjectId)=> { fetch:(request:Request)=>
            Promise<Response> }
    }
    BLURHASH_QUEUE:{
        send:(message:unknown)=> Promise<unknown>
    }
}

interface QueueMessageLike {
    body:unknown
    ack:()=> void
}

interface QueueBatchLike {
    messages:readonly QueueMessageLike[]
}

async function writeFullContent (
    env:ArticleFetchConsumerEnv,
    job:ArticleFetchJob,
    result:FetchFullArticleResult
):Promise<void> {
    const id = env.USER_DO.idFromString(job.objectId)
    const stub = env.USER_DO.get(id)
    const response = await stub.fetch(new Request(
        `http://do/internal/full-content/items/${job.itemId}`,
        {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(result)
        }
    ))

    if (!response.ok) {
        throw new Error(
            `Full content write failed: ${response.status}`
        )
    }
}

async function handleArticleFetchMessage (
    message:QueueMessageLike,
    env:ArticleFetchConsumerEnv,
    deps:ArticleFetchConsumerDeps
):Promise<void> {
    if (!isArticleFetchJob(message.body)) {
        message.ack()
        return
    }

    const job = message.body
    const result = await deps.fetchArticle(job.link)

    await writeFullContent(env, job, result)

    if ('html' in result && result.html) {
        await enqueueBodyBlurJobs(
            env.BLURHASH_QUEUE,
            result.html,
            job.itemId,
            job.objectId
        )
    }

    message.ack()
}

export async function handleArticleFetchQueueBatch (
    batch:QueueBatchLike,
    env:ArticleFetchConsumerEnv,
    deps:ArticleFetchConsumerDeps
):Promise<void> {
    for (const message of batch.messages) {
        await handleArticleFetchMessage(message, env, deps)
    }
}

export function createArticleFetchConsumerDeps ():ArticleFetchConsumerDeps {
    return {
        fetchArticle: (link) => fetchFullArticle(link)
    }
}
