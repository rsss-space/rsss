import { test } from '@substrate-system/tapzero'
import { SyncBillingError } from '../src/client/db/pull-sync.js'
import {
    PushSyncBillingError
} from '../src/client/db/push-sync.js'
import { State } from '../src/client/state.js'

// Test for AC4.3: Verify SyncBillingError → loadBillingStatus wiring
//
// The handler State.handleSyncCycleError drives the production logic
// (state.ts:550-560, 635-640) that ensures when a lapsed-billing user
// receives SyncBillingError or PushSyncBillingError, loadBillingStatus()
// is called to re-check entitlement status. This test verifies the
// handler function itself.

test(
    'State.handleSyncCycleError calls loadBillingStatus on '
    + 'SyncBillingError',
    async (t) => {
        const calls:string[] = []

        // Save original
        const originalLoadBillingStatus = State.loadBillingStatus

        // Replace with tracking stub
        State.loadBillingStatus = async () => {
            calls.push('loadBillingStatus')
            return null
        }

        try {
            // Call the production handler with a SyncBillingError
            const error = new SyncBillingError()
            State.handleSyncCycleError(error)

            // Handler calls loadBillingStatus (but may be async)
            await Promise.resolve()

            t.equal(calls.length, 1,
                'loadBillingStatus is called for SyncBillingError')
            t.equal(calls[0], 'loadBillingStatus',
                'calls the right function')
        } finally {
            State.loadBillingStatus = originalLoadBillingStatus
        }
    }
)

test(
    'State.handleSyncCycleError calls loadBillingStatus on '
    + 'PushSyncBillingError',
    async (t) => {
        const calls:string[] = []

        // Save original
        const originalLoadBillingStatus = State.loadBillingStatus

        // Replace with tracking stub
        State.loadBillingStatus = async () => {
            calls.push('loadBillingStatus')
            return null
        }

        try {
            // Call the production handler with a PushSyncBillingError
            const error = new PushSyncBillingError()
            State.handleSyncCycleError(error)

            // Handler calls loadBillingStatus (but may be async)
            await Promise.resolve()

            t.equal(calls.length, 1,
                'loadBillingStatus is called for PushSyncBillingError')
            t.equal(calls[0], 'loadBillingStatus',
                'calls the right function')
        } finally {
            State.loadBillingStatus = originalLoadBillingStatus
        }
    }
)
