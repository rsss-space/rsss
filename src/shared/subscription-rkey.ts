const ATPROTO_RKEY_RE = /^[A-Za-z0-9.\-_:~]{1,512}$/
const SUBSCRIPTION_RKEY_PREFIX = 'feed.'

export function canonicalizeFeedUrl (feedUrl:string):string {
    let url:URL

    try {
        url = new URL(feedUrl)
    } catch {
        throw new TypeError(`Invalid feed URL: ${feedUrl}`)
    }

    url.hash = ''
    url.username = ''
    url.password = ''
    url.searchParams.sort()

    return url.href
}

export async function subscriptionRkeyForFeedUrl (
    feedUrl:string
):Promise<string> {
    const canonicalUrl = canonicalizeFeedUrl(feedUrl)
    const digest = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(canonicalUrl)
    )
    const hash = [...new Uint8Array(digest)]
        .map(byte => byte.toString(16).padStart(2, '0'))
        .join('')

    return `${SUBSCRIPTION_RKEY_PREFIX}${hash}`
}

export function isAtprotoRecordKey (value:string):boolean {
    return value !== '.' &&
        value !== '..' &&
        ATPROTO_RKEY_RE.test(value)
}
