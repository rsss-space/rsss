/**
 * US-020: Compute recommendations.
 *
 * Recommendations = Bluesky follows (US-019) ∩ rsss registry (US-014),
 * minus the user themselves and people they already follow on rsss.
 */

export interface RegistryUser {
    did:string
    handle:string
    avatar:string|null
}

export interface RecommendedUser {
    did:string
    handle:string
    displayName:string|null
    avatar:string|null
    sharedFeedsCount?:number
}

export interface BlueskyFollowsResult {
    follows:Array<{ did:string; handle:string }>
    ok:boolean
}

export interface RecommendationsDeps {
    getBlueskyFollows(did:string):Promise<BlueskyFollowsResult>
    batchLookupRegistry(dids:string[]):Promise<RegistryUser[]>
    listRsssFollowing():Promise<string[]>
}

export async function computeRecommendations (
    userDid:string,
    deps:RecommendationsDeps
):Promise<RecommendedUser[]> {
    const result = await deps.getBlueskyFollows(userDid)
    // Phase 8: surface result.ok distinctly (e.g. 503)
    const blueskyFollows = result.follows
    if (blueskyFollows.length === 0) return []

    const followDids = blueskyFollows.map(f => f.did)

    const [registryUsers, rsssFollowing] = await Promise.all([
        deps.batchLookupRegistry(followDids),
        deps.listRsssFollowing()
    ])

    const excludeSet = new Set<string>([userDid, ...rsssFollowing])

    return registryUsers
        .filter(u => !excludeSet.has(u.did))
        .map(u => ({
            did: u.did,
            handle: u.handle,
            displayName: null,
            avatar: u.avatar
        }))
}
