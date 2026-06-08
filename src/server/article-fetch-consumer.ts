import { isArticleFetchJob } from './article-fetch-job.js'
import type { ArticleFetchJob } from './article-fetch-job.js'
import { fetchFullArticle, type FetchFullArticleResult } from './article-fetch.js'

export type { ArticleFetchJob }

export interface ArticleFetchConsumerDeps {
    fetchArticle:(link:string) => Promise<FetchFullArticleResult>
}

export interface ArticleFetchConsumerEnv {
    USER_DO:{
        idFromString:(id:string) => DurableObjectId
        get:(id:DurableObjectId) => { fetch:(request:Request) =>
            Promise<Response> }
    }
}

interface QueueMessageLike {
    body:unknown
    ack:() => void
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

    // TODO: US-012 — enqueue body blur jobs when status is succeeded

    await writeFullContent(env, job, result)
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
