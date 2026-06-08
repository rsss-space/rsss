/**
 * Workers-safe regex extractor for absolute http(s) image URLs from HTML.
 * No DOMParser — Cloudflare Workers runtime has no DOM.
 */

const IMG_SRC_RE = /<img\b[^>]+\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]*))/gi

export function extractImageUrls (html:string):string[] {
    if (!html) return []

    const seen = new Set<string>()
    const results:string[] = []
    let match:RegExpExecArray|null

    IMG_SRC_RE.lastIndex = 0
    while ((match = IMG_SRC_RE.exec(html)) !== null) {
        const src = match[1] ?? match[2] ?? match[3] ?? ''
        if (/^https?:\/\//i.test(src) && !seen.has(src)) {
            seen.add(src)
            results.push(src)
        }
    }

    return results
}
