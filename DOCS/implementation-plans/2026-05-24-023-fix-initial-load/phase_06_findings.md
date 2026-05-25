# Phase 6 Audit: loadBillingStatus Not on Critical Path

**Date:** 2026-05-25
**AC Verified:** 023-fix-initial-load.AC7.2

## Summary

Verified that `loadBillingStatus()` is NOT awaited on the render critical path.
All awaits are in user-initiated action handlers.

## Audit Results

### Fire-and-Forget Calls (OK - not blocking)

1. **src/client/routes/signup.ts:33** - In `useEffect` during signup mount
   - Context: Effect hook, fire-and-forget
   - Status: OK ✓

2. **src/client/routes/settings.ts:82** - In `useEffect` when settings mounts
   - Context: Effect hook with `shouldApply` gate, fire-and-forget
   - Status: OK ✓

3. **src/client/state.ts:558** - In `runSync().catch()` error handler for SyncBillingError
   - Context: Fire-and-forget error recovery for lapsed billing
   - Status: OK ✓

4. **src/client/state.ts:581** - In `queueMicrotask()` inside user effect
   - Context: Queued after user identity resolves, before sync starts
   - Status: OK ✓

5. **src/client/state.ts:638** - In online-recovery error handler for SyncBillingError
   - Context: Fire-and-forget error recovery for lapsed billing
   - Status: OK ✓

### Awaited Calls (User-Initiated Actions Only - OK)

6. **src/client/state.ts:1570** - `State.startCheckout()`
   - Context: User-initiated checkout flow
   - Calls: `await State.loadBillingStatus()`
   - Status: OK ✓ (not on paint path)

7. **src/client/state.ts:1614** - `State.finalizeCheckout()`
   - Context: User-initiated checkout completion
   - Calls: `await State.loadBillingStatus()`
   - Status: OK ✓ (not on paint path)

8. **src/client/state.ts:1682** - `State.scheduleAccountDeletion()`
   - Context: User initiates account deletion
   - Calls: `await State.loadBillingStatus()`
   - Status: OK ✓ (not on paint path)

9. **src/client/state.ts:1702** - `State.cancelAccountDeletion()`
   - Context: User cancels pending deletion
   - Calls: `await State.loadBillingStatus()`
   - Status: OK ✓ (not on paint path)

10. **src/client/state.ts:1751** - `State.cancelSubscription()`
    - Context: User cancels their subscription
    - Calls: `await State.loadBillingStatus()`
    - Status: OK ✓ (not on paint path)

11. **src/client/state.ts:1777** - `State.resumeSubscription()`
    - Context: User resumes a canceled subscription
    - Calls: `await State.loadBillingStatus()`
    - Status: OK ✓ (not on paint path)

## Conclusion

**AC7.2 Satisfied:** All `await State.loadBillingStatus()` calls are in user-initiated
action handlers (checkout, account deletion, subscription management), NOT on the
render critical path. The render path only has fire-and-forget calls that do not
block paint.

**Critical Path Calls:** 0 (verified clean)
