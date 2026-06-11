/**
 * Tests for US-020: Compute recommendations
 *
 * Covers intersection logic and exclusion of already-followed users.
 */
import { test } from '@substrate-system/tapzero'
import {
    computeRecommendations,
    type RecommendationsDeps,
    type RegistryUser
} from '../src/server/recommendations.js'

function makeDeps (opts:{
    blueskyFollows?:Array<{ did:string; handle:string }>
    registryUsers?:RegistryUser[]
    rsssFollowing?:string[]
} = {}):RecommendationsDeps {
    const blueskyFollows = opts.blueskyFollows ?? []
    const registryUsers = opts.registryUsers ?? []
    const rsssFollowing = opts.rsssFollowing ?? []

    return {
        getBlueskyFollows: async (_did:string) => blueskyFollows,
        batchLookupRegistry: async (_dids:string[]) => registryUsers,
        listRsssFollowing: async () => rsssFollowing
    }
}

test('returns empty array when user has no Bluesky follows', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [],
        registryUsers: [],
        rsssFollowing: []
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 0, 'no recommendations when no Bluesky follows')
})

test('returns empty array when no Bluesky follows are rsss users', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social' },
            { did: 'did:plc:bob', handle: 'bob.bsky.social' }
        ],
        registryUsers: [],
        rsssFollowing: []
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 0, 'no recommendations when no overlap with registry')
})

test('returns users in the intersection of Bluesky follows and registry', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social' },
            { did: 'did:plc:bob', handle: 'bob.bsky.social' },
            { did: 'did:plc:carol', handle: 'carol.bsky.social' }
        ],
        registryUsers: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social', avatar: null },
            { did: 'did:plc:carol', handle: 'carol.bsky.social', avatar: 'https://example.com/carol.jpg' }
        ],
        rsssFollowing: []
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 2, 'returns 2 users from intersection')
    const dids = result.map(r => r.did).sort()
    t.deepEqual(dids, ['did:plc:alice', 'did:plc:carol'], 'correct DIDs')
})

test('excludes users the caller already follows on rsss', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social' },
            { did: 'did:plc:bob', handle: 'bob.bsky.social' }
        ],
        registryUsers: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social', avatar: null },
            { did: 'did:plc:bob', handle: 'bob.bsky.social', avatar: null }
        ],
        rsssFollowing: ['did:plc:alice']
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 1, 'alice excluded because already followed')
    t.equal(result[0].did, 'did:plc:bob', 'only bob remains')
})

test('excludes the user themselves from recommendations', async (t) => {
    const userDid = 'did:plc:me'
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:me', handle: 'me.bsky.social' },
            { did: 'did:plc:alice', handle: 'alice.bsky.social' }
        ],
        registryUsers: [
            { did: 'did:plc:me', handle: 'me.bsky.social', avatar: null },
            { did: 'did:plc:alice', handle: 'alice.bsky.social', avatar: null }
        ],
        rsssFollowing: []
    })
    const result = await computeRecommendations(userDid, deps)
    t.equal(result.length, 1, 'self excluded')
    t.equal(result[0].did, 'did:plc:alice', 'only alice remains')
})

test('result includes handle and avatar from registry', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:alice', handle: 'alice-old.bsky.social' }
        ],
        registryUsers: [
            {
                did: 'did:plc:alice',
                handle: 'alice.bsky.social',
                avatar: 'https://example.com/alice.jpg'
            }
        ],
        rsssFollowing: []
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 1)
    t.equal(result[0].did, 'did:plc:alice', 'did correct')
    t.equal(result[0].handle, 'alice.bsky.social', 'handle from registry')
    t.equal(result[0].avatar, 'https://example.com/alice.jpg', 'avatar from registry')
})

test('displayName is null when not available', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social' }
        ],
        registryUsers: [
            { did: 'did:plc:alice', handle: 'alice.bsky.social', avatar: null }
        ],
        rsssFollowing: []
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 1)
    t.equal(result[0].displayName, null, 'displayName is null')
})

test('excludes all already-followed users', async (t) => {
    const deps = makeDeps({
        blueskyFollows: [
            { did: 'did:plc:a', handle: 'a.test' },
            { did: 'did:plc:b', handle: 'b.test' },
            { did: 'did:plc:c', handle: 'c.test' }
        ],
        registryUsers: [
            { did: 'did:plc:a', handle: 'a.test', avatar: null },
            { did: 'did:plc:b', handle: 'b.test', avatar: null },
            { did: 'did:plc:c', handle: 'c.test', avatar: null }
        ],
        rsssFollowing: ['did:plc:a', 'did:plc:b', 'did:plc:c']
    })
    const result = await computeRecommendations('did:plc:user', deps)
    t.equal(result.length, 0, 'all excluded because all already followed')
})

test('passes only Bluesky follow DIDs to batchLookupRegistry', async (t) => {
    let lookupDids:string[] = []
    const deps:RecommendationsDeps = {
        getBlueskyFollows: async () => [
            { did: 'did:plc:x', handle: 'x.test' },
            { did: 'did:plc:y', handle: 'y.test' }
        ],
        batchLookupRegistry: async (dids:string[]) => {
            lookupDids = dids
            return []
        },
        listRsssFollowing: async () => []
    }
    await computeRecommendations('did:plc:user', deps)
    t.ok(lookupDids.includes('did:plc:x'), 'x passed to registry')
    t.ok(lookupDids.includes('did:plc:y'), 'y passed to registry')
    t.equal(lookupDids.length, 2, 'exactly 2 DIDs passed')
})

test('skips registry call when Bluesky follows list is empty', async (t) => {
    let registryCalled = false
    const deps:RecommendationsDeps = {
        getBlueskyFollows: async () => [],
        batchLookupRegistry: async () => {
            registryCalled = true
            return []
        },
        listRsssFollowing: async () => []
    }
    await computeRecommendations('did:plc:user', deps)
    t.equal(registryCalled, false, 'registry not called for empty follows')
})
