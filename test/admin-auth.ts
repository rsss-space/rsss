/**
 * AC16.1: Constant-time admin token comparison (no length leak).
 *
 * Drives the REAL exported constantTimeEqual. The security property — always
 * hashing both inputs, never short-circuiting on length — is not behaviourally
 * observable (a plain `a === b` accepts/rejects identically). So we also spy on
 * the real crypto.subtle.digest while calling the real function and assert it
 * hashes both inputs regardless of length. A length-branching implementation
 * would short-circuit and never hash, failing the digest-count assertion.
 */
import { test } from '@substrate-system/tapzero'
import { constantTimeEqual } from '../src/server/index.js'

test('AC16.1: equal tokens compare equal', async (t) => {
    t.equal(
        await constantTimeEqual('secret-token-abc', 'secret-token-abc'),
        true,
        'equal tokens accept'
    )
})

test('AC16.1: unequal same-length tokens reject', async (t) => {
    t.equal(
        await constantTimeEqual('secret-token-abc', 'secret-token-xyz'),
        false,
        'unequal same-length tokens reject'
    )
})

test('AC16.1: unequal different-length tokens reject', async (t) => {
    t.equal(
        await constantTimeEqual('short', 'a-much-longer-token'),
        false,
        'unequal different-length tokens reject'
    )
})

test('AC16.1: always hashes both inputs (no length short-circuit)',
    async (t) => {
        const subtle = globalThis.crypto.subtle
        const original = subtle.digest.bind(subtle)
        let digestCalls = 0
        subtle.digest = ((
            algo:AlgorithmIdentifier,
            data:BufferSource
        ):Promise<ArrayBuffer> => {
            digestCalls++
            return original(algo, data)
        }) as typeof subtle.digest

        try {
            // Different-length inputs: a length-branching impl short-circuits
            // and never hashes. The constant-time impl hashes both.
            const result = await constantTimeEqual('a', 'much-longer-token')
            t.equal(result, false, 'different-length inputs reject')
            t.equal(
                digestCalls,
                2,
                'both inputs hashed via the real impl (no early length return)'
            )
        } finally {
            subtle.digest = original as typeof subtle.digest
        }
    })
