export interface ArticleFetchJob {
    itemId:number;
    link:string;
    objectId:string;
}

export function isArticleFetchJob (value:unknown):value isArticleFetchJob {
    if (!value || typeof value !== 'object') return false

    const job = value as Partial<ArticleFetchJob>

    return typeof job.itemId === 'number' &&
        Number.isInteger(job.itemId) &&
        typeof job.link === 'string' &&
        typeof job.objectId === 'string'
}
