import { extractImageUrls } from './extract-image-urls.js'
import type { BlurhashJob } from './blurhash.js'

export const MAX_BODY_BLUR_IMAGES = 30

export interface BlurhashQueueLike {
    send:(message:unknown) => Promise<unknown>
}

export async function enqueueBodyBlurJobs (
    queue:BlurhashQueueLike,
    html:string,
    itemId:number,
    objectId:string
):Promise<number> {
    const urls = extractImageUrls(html).slice(0, MAX_BODY_BLUR_IMAGES)
    for (const imageUrl of urls) {
        await queue.send({
            imageUrl,
            itemId,
            objectId,
            target: 'body'
        } satisfies BlurhashJob)
    }
    return urls.length
}
