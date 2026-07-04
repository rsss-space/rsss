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

/**
 * Structural shape of a Cloudflare SqlStorageCursor as consumed by DO test
 * harnesses. Broad enough that any `FakeQueryResult<T>` is assignable to it,
 * so a fake `sql.exec` can be annotated with this return type.
 */
export interface QueryResult {
    toArray:()=> unknown[]
    one?:()=> unknown
    rowsWritten?:number
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
