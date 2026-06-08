import { isSummaryOnly } from '../shared/article-detect.js'

export function isPrefetchEligible (item:{
    link?:string|null
    content?:string|null
    description?:string|null
    full_content?:string|null
}):boolean {
    if (item.full_content) return false
    return isSummaryOnly({
        link: item.link,
        content: item.content,
        description: item.description
    })
}
