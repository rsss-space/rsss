export interface GraphApiDeps {
    listFollowing:() => Promise<string[]>
    getFollowers:(did:string) => Promise<{
        dids:string[]
        count:number
        available:boolean
    }>
}

export interface GraphApiResponse {
    following:string[]
    followers:string[]
    followersCount:number
    constellationAvailable:boolean
}

export async function buildGraphResponse (
    did:string,
    deps:GraphApiDeps
):Promise<GraphApiResponse> {
    const [following, followerResult] = await Promise.all([
        deps.listFollowing(),
        deps.getFollowers(did)
    ])

    return {
        following,
        followers: followerResult.dids,
        followersCount: followerResult.count,
        constellationAvailable: followerResult.available
    }
}
