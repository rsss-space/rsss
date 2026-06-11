/**
 * Profile API helpers for US-017.
 *
 * Keeps I/O behind injected deps so the server route and tests
 * can swap in fakes without spinning up real DOs or HTTP servers.
 */

export interface ProfileSubscription {
    uri:string
    rkey:string
    feedUrl:string
    title:string|null
    siteUrl:string|null
}

export interface ProfileResponse {
    did:string
    handle:string|null
    avatar:string|null
    subscriptions:ProfileSubscription[]
}

export interface ProfileApiDeps {
    resolveIdentity(did:string):Promise<{ did:string; handle?:string }>
    listSubscriptions(did:string):Promise<ProfileSubscription[]>
    lookupAvatar(did:string):Promise<string|null>
}

export async function buildProfileResponse (
    did:string,
    deps:ProfileApiDeps
):Promise<ProfileResponse> {
    const identity = await deps.resolveIdentity(did)
    const [subscriptions, avatar] = await Promise.all([
        deps.listSubscriptions(identity.did),
        deps.lookupAvatar(identity.did)
    ])

    return {
        did: identity.did,
        handle: identity.handle ?? null,
        avatar,
        subscriptions
    }
}

/**
 * Parse space.rsss.feed.subscription record value into a
 * ProfileSubscription, or return null if the record is malformed.
 */
export function parseSubscriptionRecord (
    uri:string,
    value:unknown
):ProfileSubscription | null {
    if (typeof value !== 'object' || value === null) return null
    const v = value as Record<string, unknown>
    if (typeof v.feedUrl !== 'string') return null
    const parts = uri.split('/')
    const rkey = parts[parts.length - 1] ?? ''
    return {
        uri,
        rkey,
        feedUrl: v.feedUrl,
        title: typeof v.title === 'string' ? v.title : null,
        siteUrl: typeof v.siteUrl === 'string' ? v.siteUrl : null
    }
}
