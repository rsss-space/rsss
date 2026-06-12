/**
 * Tests for subscription record canonicalization (AC9.1, AC9.2)
 *
 * Tests that buildFeedSubscriptionRecord stores the canonical URL
 * (matching the rkey derivation), and that reconcile matches records
 * on the canonical form, so raw URL variations still round-trip.
 */
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import {
    canonicalizeFeedUrl,
    subscriptionRkeyForFeedUrl
} from '../src/shared/subscription-rkey.js'
import { feedSubscriptionLexicon } from '../src/shared/lexicons/index.js'

interface Feed {
    id:number
    url:string
    title:string|null
    description:string|null
    site_url:string|null
    last_fetched:string|null
    last_error:string|null
    last_status:number|null
    published:number
    published_rkey:string|null
    published_at:string|null
    publish_error:string|null
    created_at:string
    updated_at:string
}

interface OAuthCredentialRecord {
    did:string
    pdsEndpoint:string
}

interface ListedSubscriptionRecord {
    uri:string
    value:Record<string, unknown>
}

interface RemoteSubscription {
    rkey:string
    createdAt:string|null
}

function makeSuccessResponse (body:unknown):Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

test('AC9.1: buildFeedSubscriptionRecord stores canonical URL',
    async (t) => {
        const originalFetch = globalThis.fetch

        try {
            const userDo = Object.create(
                RsssUserDO.prototype
            ) as unknown as {
                buildFeedSubscriptionRecord(
                    feed:Feed,
                    createdAt:string
                ):{ feedUrl:string; createdAt:string }
            }

            // Test with a raw URL containing fragment, reordered query,
            // and uppercase scheme/host
            const rawUrl = (
                'HTTPS://Example.COM:443/feed.xml?b=2&a=1#section'
            )
            const canonical = canonicalizeFeedUrl(rawUrl)

            // Call the real buildFeedSubscriptionRecord
            const record = userDo.buildFeedSubscriptionRecord(
                {
                    id: 1,
                    url: rawUrl,
                    title: 'Test Feed',
                    description: null,
                    site_url: null,
                    last_fetched: null,
                    last_error: null,
                    last_status: null,
                    published: 0,
                    published_rkey: null,
                    published_at: null,
                    publish_error: null,
                    created_at: '2024-01-01T00:00:00Z',
                    updated_at: '2024-01-01T00:00:00Z'
                },
                '2024-01-01T00:00:00Z'
            )

            t.equal(
                record.feedUrl,
                canonical,
                'record.feedUrl is the canonical URL form'
            )
            t.notEqual(
                record.feedUrl,
                rawUrl,
                'record.feedUrl differs from the raw URL'
            )
            t.equal(
                record.feedUrl,
                'https://example.com/feed.xml?a=1&b=2',
                'canonical URL has lowercase scheme/host, ' +
                'sorted query, no fragment'
            )

            // Verify that the rkey derived from the raw URL matches
            // the rkey derived from the canonical URL
            const rkeyFromRaw = await subscriptionRkeyForFeedUrl(rawUrl)
            const rkeyFromCanonical = await subscriptionRkeyForFeedUrl(
                canonical
            )
            t.equal(
                rkeyFromRaw,
                rkeyFromCanonical,
                'rkey is stable across raw and canonical forms'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('AC9.2: reconcile matches records with canonical URL',
    async (t) => {
        const originalFetch = globalThis.fetch

        try {
            const userDo = Object.create(
                RsssUserDO.prototype
            ) as unknown as {
                listRemoteSubscriptions(
                    creds:OAuthCredentialRecord
                ):Promise<Map<string, RemoteSubscription>>
                listRecordsUrl(
                    creds:OAuthCredentialRecord,
                    cursor?:string
                ):string
                isListedSubscriptionRecord(
                    value:unknown
                ):value is ListedSubscriptionRecord
                subscriptionFromRecord(
                    record:ListedSubscriptionRecord
                ):{ feedUrl:string; subscription:RemoteSubscription }|null
                reconcilePublishedFeeds():Promise<{
                    ok:boolean
                    changed:number
                    error?:string
                }>
            }

            // Set up a mock for listRemoteSubscriptions.
            // The remote record is published with a URL variant
            // (non-canonical form) - this tests that reconcile
            // canonicalizes when building the lookup map.
            const remoteRawUrl = (
                'HTTPS://Example.COM/feed.xml?b=2&a=1#section'
            )
            const remoteRkey = 'feed.' + (
                'abcdef0123456789'
            )

            globalThis.fetch = (async () => {
                // Return a subscription record with a raw URL variant
                // (not the canonical form)
                return makeSuccessResponse({
                    records: [
                        {
                            uri: (
                                'at://did:plc:test/' +
                                `com.example.subscription/${remoteRkey}`
                            ),
                            value: {
                                // Raw URL with different case, query order,
                                // and fragment
                                feedUrl: remoteRawUrl,
                                createdAt: '2024-01-01T00:00:00Z'
                            }
                        }
                    ]
                })
            }) as typeof fetch

            const remoteCanonical = canonicalizeFeedUrl(
                remoteRawUrl
            )

            // Stub collaborator methods
            userDo.listRecordsUrl = (creds, _cursor) => {
                const base = creds.pdsEndpoint.endsWith('/') ?
                    creds.pdsEndpoint :
                    `${creds.pdsEndpoint}/`
                const url = new URL(
                    'xrpc/com.atproto.repo.listRecords',
                    base
                )
                url.searchParams.set('repo', creds.did)
                url.searchParams.set(
                    'collection',
                    feedSubscriptionLexicon.id
                )
                return url.href
            }

            userDo.isListedSubscriptionRecord = (
                value
            ):value is ListedSubscriptionRecord => {
                if (typeof value !== 'object' || value === null) {
                    return false
                }
                if (Array.isArray(value)) return false
                const record = value as Partial<ListedSubscriptionRecord>
                return typeof record.uri === 'string'
            }

            userDo.subscriptionFromRecord = (record) => {
                if (typeof record.value !== 'object' ||
                    record.value === null) {
                    return null
                }
                if (Array.isArray(record.value)) return null
                const value = record.value as {
                    feedUrl?:string; createdAt?:string
                }
                const rkey = record.uri.split('/').pop() || null
                if (!rkey || typeof value.feedUrl !== 'string') {
                    return null
                }
                return {
                    feedUrl: value.feedUrl,
                    subscription: {
                        rkey,
                        createdAt: typeof value.createdAt === 'string' ?
                            value.createdAt :
                            null
                    }
                }
            }

            // Call listRemoteSubscriptions to build the remote map
            const remoteByUrl = await userDo.listRemoteSubscriptions({
                did: 'did:plc:test',
                pdsEndpoint: 'https://pds.example.com/'
            })

            // Test that a different raw URL form of the same feed
            // still matches when looking up by canonical
            const lookupRawUrl = (
                'https://example.com/feed.xml?a=1&b=2'
            )
            const lookupCanonical = canonicalizeFeedUrl(lookupRawUrl)

            t.equal(
                lookupCanonical,
                remoteCanonical,
                'different raw URL variants canonicalize to the ' +
                'same form'
            )

            // The remoteByUrl map should be keyed on canonical form
            // (both the raw remote URL's canonical form, and the
            // lookup URL's canonical form should match the record)
            const foundRecord = remoteByUrl.get(lookupCanonical)
            t.ok(foundRecord, 'lookup on canonical URL finds the record')
            t.equal(
                foundRecord?.rkey,
                remoteRkey,
                'found record has correct rkey'
            )

            // Also verify that a different raw form of the same URL
            // still matches
            const altRawUrl = (
                'HTTPS://EXAMPLE.COM/feed.xml?a=1&b=2'
            )
            const altCanonical = canonicalizeFeedUrl(altRawUrl)
            const altFoundRecord = remoteByUrl.get(altCanonical)
            t.ok(
                altFoundRecord,
                'lookup on alternate canonical form also finds the record'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })
