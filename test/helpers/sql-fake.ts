/**
 * Shared test fake for Cloudflare SqlStorage query results.
 * This fake correctly models the real .one() semantics: throws if result
 * set is not exactly one row. This matches Cloudflare's SqlStorageCursor
 * behavior and allows DO tests to catch optional-row sites that still call
 * .one() directly instead of using the null-safe .toArray()[0] ?? null
 * pattern.
 */

export interface FakeQueryResult<T = Record<string, unknown>> {
    toArray():T[]
    one():T
}

export function fakeResult<T = Record<string, unknown>> (
    rows:T[]
):FakeQueryResult<T> {
    return {
        toArray () {
            return rows
        },

        one () {
            // Match Cloudflare SqlStorage: throws unless exactly one row.
            if (rows.length !== 1) {
                throw new Error(
                    'SqlStorageCursor.one(): expected exactly one row, got ' +
                    rows.length
                )
            }
            return rows[0]!
        }
    }
}
