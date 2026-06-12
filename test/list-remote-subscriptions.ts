/**
 * Tests for listRemoteSubscriptions pagination bounds (AC7.5)
 *
 * Tests the pagination cap and cursor-stall detection by calling
 * the real listRemoteSubscriptions method with mocked fetch and
 * collaborator methods.
 */
import { test } from '@substrate-system/tapzero'
import { RsssUserDO } from '../src/server/durable-objects/index.js'
import { feedSubscriptionLexicon } from '../src/shared/lexicons/index.js'

interface OAuthCredentialRecord {
    did:string
    pdsEndpoint:string
}

interface ListedSubscriptionRecord {
    uri:string
    value:Record<string, unknown>
}

interface ListedSubscriptionResponse {
    records:ListedSubscriptionRecord[]
    cursor?:string
}

interface RemoteSubscription {
    rkey:string
    createdAt:string|null
}

function makeListRecordsPage (
    recordCount:number,
    cursor?:string
):ListedSubscriptionResponse {
    const records:ListedSubscriptionRecord[] = []
    for (let i = 0; i < recordCount; i++) {
        records.push({
            uri: `at://did:plc:example/com.example.record/${i}`,
            value: { feedUrl: `https://example.com/feed${i}.xml` }
        })
    }
    return {
        records,
        ...(cursor ? { cursor } : {})
    }
}

function makeSuccessResponse (body:unknown):Response {
    return new Response(JSON.stringify(body), {
        status: 200,
        headers: { 'content-type': 'application/json' }
    })
}

test('listRemoteSubscriptions stops at MAX_RECORD_PAGES cap (AC7.5)',
    async (t) => {
        // Create a real DO instance and call the real listRemoteSubscriptions
        let fetchCount = 0
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
            }

            // Mock globalThis.fetch to return unique cursors
            globalThis.fetch = (async () => {
                fetchCount++
                return makeSuccessResponse(
                    makeListRecordsPage(5, `cursor-${fetchCount}`)
                )
            }) as typeof fetch

            // Stub the collaborator methods from the DO
            userDo.listRecordsUrl = (creds, cursor) => {
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
                url.searchParams.set('limit', '100')
                if (cursor) url.searchParams.set('cursor', cursor)
                return url.href
            }

            userDo.isListedSubscriptionRecord = (
                value
            ):value is ListedSubscriptionRecord => {
                if (typeof value !== 'object' || value === null) return false
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
                if (!rkey || typeof value.feedUrl !== 'string') return null
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

            // Call the real method
            const result = await userDo.listRemoteSubscriptions({
                did: 'did:plc:test',
                pdsEndpoint: 'https://example.com/'
            })

            t.equal(
                fetchCount,
                50,
                'should make 50 requests up to MAX_RECORD_PAGES'
            )
            t.ok(
                result.size > 0,
                'should return collected subscriptions'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })

test('listRemoteSubscriptions bails on cursor stall (AC7.5)',
    async (t) => {
        // When the PDS returns the same cursor twice, bail immediately
        let fetchCount = 0
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
            }

            // Mock to always return the same cursor
            globalThis.fetch = (async () => {
                fetchCount++
                return makeSuccessResponse(
                    makeListRecordsPage(5, 'cursor-1')
                )
            }) as typeof fetch

            userDo.listRecordsUrl = (creds, cursor) => {
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
                url.searchParams.set('limit', '100')
                if (cursor) url.searchParams.set('cursor', cursor)
                return url.href
            }

            userDo.isListedSubscriptionRecord = (
                value
            ):value is ListedSubscriptionRecord => {
                if (typeof value !== 'object' || value === null) return false
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
                if (!rkey || typeof value.feedUrl !== 'string') return null
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

            const result = await userDo.listRemoteSubscriptions({
                did: 'did:plc:test',
                pdsEndpoint: 'https://example.com/'
            })

            t.equal(
                fetchCount,
                2,
                'should make 2 requests before detecting stall'
            )
            t.ok(
                result.size > 0,
                'should return collected subscriptions'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
    })
