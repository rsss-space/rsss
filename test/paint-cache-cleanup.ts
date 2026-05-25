import { test } from '@substrate-system/tapzero'
import {
    clearPaintCache,
    clearStoredDid,
    writePaintCache,
    snapshotFromState
} from '../src/client/paint-cache.js'
import type { CountsResponse } from '../src/client/db/types.js'

const PAINT_CACHE_PREFIX = 'rsss.paintCache.v1.'
const LAST_SESSION_KEY = 'rsss.lastSessionDid'

function makeTestSnapshot () {
    const snap = snapshotFromState([], [], {
        unread: 0,
        starred: 0,
        total: 0,
        perFeed: {}
    } as CountsResponse, null)
    return snap
}

test('AC6.1: clearPaintCache removes the paint cache for a specific DID',
    t => {
        const did = 'did:plc:alice'
        const snap = makeTestSnapshot()

        // Pre-populate cache for the test DID
        writePaintCache(did, snap)
        const key = PAINT_CACHE_PREFIX + did
        const before = localStorage.getItem(key)
        t.ok(before !== null, 'paint cache exists before cleanup')

        // Clear it
        clearPaintCache(did)

        // Verify it's gone
        const after = localStorage.getItem(key)
        t.equal(after, null, 'paint cache removed for target DID')
    }
)

test('AC6.2: clearStoredDid removes the lastSessionDid',
    t => {
        const did = 'did:plc:alice'

        // Pre-populate lastSessionDid
        localStorage.setItem(LAST_SESSION_KEY, did)
        const before = localStorage.getItem(LAST_SESSION_KEY)
        t.equal(before, did, 'lastSessionDid stored before cleanup')

        // Clear it
        clearStoredDid()

        // Verify it's gone
        const after = localStorage.getItem(LAST_SESSION_KEY)
        t.equal(after, null, 'lastSessionDid removed after cleanup')
    }
)

test('AC6.4: clearing one DID\'s paint cache leaves other DIDs intact',
    t => {
        const didA = 'did:plc:alice'
        const didB = 'did:plc:bob'
        const snap = makeTestSnapshot()

        // Pre-populate caches for both DIDs
        writePaintCache(didA, snap)
        writePaintCache(didB, snap)

        const keyA = PAINT_CACHE_PREFIX + didA
        const keyB = PAINT_CACHE_PREFIX + didB
        const beforeA = localStorage.getItem(keyA)
        const beforeB = localStorage.getItem(keyB)

        t.ok(beforeA !== null, 'cache exists for DID A before cleanup')
        t.ok(beforeB !== null, 'cache exists for DID B before cleanup')

        // Clear only DID A
        clearPaintCache(didA)

        // Verify A is gone but B remains
        const afterA = localStorage.getItem(keyA)
        const afterB = localStorage.getItem(keyB)

        t.equal(afterA, null, 'cache removed for DID A')
        t.equal(afterB, beforeB, 'cache for DID B unchanged')
    }
)
