# Phase 3: Debounced derived signal `displayedRefreshInProgress`

**Goal:** Introduce a derived `ReadonlySignal<boolean>` that wraps the
raw refcount-backed `refreshInProgress` with a 300 ms show-delay
(debounce — prevents flicker on fast operations) and a 500 ms
minimum-visible floor (prevents flicker when the raw signal
oscillates). Route the existing `displayedFeedSyncStatus` computed
through this derived signal so UI components need no change.

**Architecture:** A new standalone module
`src/client/displayed-refresh-in-progress.ts` owns the derived signal,
the two threshold constants, internal timer state, and a
`_resetForTest()` helper. The module subscribes to the raw
`refreshInProgress` Signal (passed in once at module load via a
small `init(state)` call from `state.ts`, OR via a setter pattern —
see implementation notes). It uses real `setTimeout` /
`clearTimeout` to drive the debounce + min-visible state machine.

**Tech Stack:** TypeScript, `@preact/signals` (`signal`, `computed`,
`effect`, `ReadonlySignal`).

**Scope:** Phase 3 of 5.

**Codebase verified:** 2026-05-27. Findings:

- `displayedFeedSyncStatus` lives at `src/client/state.ts:427-433`:
  ```ts
  displayedFeedSyncStatus: computed<
      'inactive'|'updates'|'syncing'|'error'|'synced'
  >(() => (
      state.refreshInProgress.value ?
          'syncing' :
          state.feedSyncStatus.value
  )),
  ```
  Phase 3 swaps line 430's `state.refreshInProgress.value` for the
  new derived signal's `.value`.
- Only one UI consumer reads `displayedFeedSyncStatus`:
  `src/client/components/feed-status.ts` (single
  `state.displayedFeedSyncStatus.value` read). Phase 3 changes NO
  components.
- The codebase has no fake-timer library (no vitest/jest). Tests for
  this phase use real `setTimeout` waits with small constants
  (300 ms + 500 ms = ~1 s per timing test). Acceptable.
- The existing standalone module to model the new one after is
  `src/client/paint-cache.ts`. It does NOT export `_resetForTest()`
  (it exports public `clearPaintCache()` / `clearStoredDid()`
  instead). The new `displayed-refresh-in-progress.ts` will follow
  the design's stated pattern and export `_resetForTest()`
  because its only test-relevant state is the internal debounce/
  min-visible timers, which are not public.

**Wiring approach (decision required at implementation time):** The
derived signal needs to observe the raw `refreshInProgress` Signal.
Two options:

- **Option A (recommended): Lazy init via `init(state)` from
  `state.ts`'s factory.** The new module exports `init(state)`
  that's called once when the AppState is constructed; it captures
  `state.refreshInProgress` and starts the `effect()` that drives
  the state machine. Subsequent calls are no-ops (or re-init for
  tests).
- **Option B: Pass the signal in at module-construction time via a
  setter.** Less idiomatic.

Option A is consistent with the rest of `state.ts`, which sets up
its `effect()`s in the factory function. Use Option A.

**Coding style:** Same as Phases 1-2.

**Skills the implementer should activate:**
- `ed3d-house-style:howto-code-in-typescript`
- `ed3d-house-style:writing-good-tests`
- `ed3d-house-style:howto-functional-vs-imperative` (this module is
  the imperative shell — timers + side effects — for a tiny
  state machine; structure it cleanly)

---

## Acceptance Criteria Coverage

### fix-silent-update-gap.AC2: Debounce and minimum-visible behavior

- **fix-silent-update-gap.AC2.1 Success:** If the raw signal stays
  `true` continuously for at least `SHOW_DELAY_MS` (300 ms),
  `displayedRefreshInProgress` becomes `true`.
- **fix-silent-update-gap.AC2.2 Success:** If the raw signal flips
  `true -> false` before `SHOW_DELAY_MS` elapses,
  `displayedRefreshInProgress` never becomes `true` (no flicker on
  fast operations).
- **fix-silent-update-gap.AC2.3 Success:** Once
  `displayedRefreshInProgress` becomes `true`, it stays `true` for
  at least `MIN_VISIBLE_MS` (500 ms) even if the raw signal clears
  sooner.
- **fix-silent-update-gap.AC2.4 Success:** If the raw signal
  re-acquires while inside the min-visible window,
  `displayedRefreshInProgress` stays continuously `true` (no gap)
  until the raw signal eventually clears and the min-visible
  window elapses.

### fix-silent-update-gap.AC5: Visual contract preserved

- **fix-silent-update-gap.AC5.1 Success:** `displayedFeedSyncStatus`
  returns `'syncing'` whenever `displayedRefreshInProgress.value ===
  true`, matching the existing UI binding semantics.
- **fix-silent-update-gap.AC5.2 Success:** When
  `displayedRefreshInProgress` is `false` and no in-flight error has
  been raised, the dot reflects the existing `feedSyncStatus` value
  (`'inactive'` / `'updates'` / `'synced'`). End-state for a
  successful add-feed is unchanged.

---

## Implementation Tasks

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Create `src/client/displayed-refresh-in-progress.ts`

**Files:**
- Create: `/Users/nick/code/rsss/src/client/displayed-refresh-in-progress.ts`

**Implementation:**

The module owns these pieces:

1. Public exported constants:
   ```ts
   export const SHOW_DELAY_MS = 300
   export const MIN_VISIBLE_MS = 500
   ```

2. A module-private writable `signal<boolean>(false)` —
   `_internalSignal` — that the state machine flips.

3. A public `ReadonlySignal<boolean>` exposed to consumers:
   `export const displayedRefreshInProgress: ReadonlySignal<boolean>
   = computed(() => _internalSignal.value)`.
   The `computed()` wrapper enforces the read-only contract; the
   writable backing signal stays inside the module.

4. A module-private state machine that, driven by an
   `effect(() => rawSignal.value)`, runs the debounce + min-visible
   logic. The state machine has these transitions:

   - **State: IDLE** — raw goes `true`. Schedule
     `showTimer = setTimeout(transitionToShown, SHOW_DELAY_MS)`.
     Move to PENDING-SHOW.
   - **State: PENDING-SHOW** — raw goes `false`. Clear
     `showTimer`. Move back to IDLE. Displayed stays `false`. (AC2.2)
   - **State: PENDING-SHOW** — `showTimer` fires. Set
     `_internalSignal.value = true`. Move to SHOWN-MIN-VISIBLE.
     Schedule `minVisibleTimer = setTimeout(onMinVisibleElapsed,
     MIN_VISIBLE_MS)`. (AC2.1, AC2.3 begin)
   - **State: SHOWN-MIN-VISIBLE** — raw goes `false`. Note that
     raw is now `false`, but do NOT clear displayed yet. Wait for
     `minVisibleTimer`. Move to SHOWN-MIN-PENDING-CLEAR.
   - **State: SHOWN-MIN-VISIBLE** — raw goes `true` again. No-op
     (already showing). Stay. (AC2.4 part 1)
   - **State: SHOWN-MIN-VISIBLE** — `minVisibleTimer` fires. If raw
     is still `true`, move to SHOWN (no timer). If raw is now
     `false`, set `_internalSignal.value = false`; move to IDLE.
   - **State: SHOWN-MIN-PENDING-CLEAR** — `minVisibleTimer` fires.
     Set `_internalSignal.value = false`. Move to IDLE.
   - **State: SHOWN-MIN-PENDING-CLEAR** — raw goes `true` again.
     Move back to SHOWN-MIN-VISIBLE (or directly to SHOWN if
     min-visible window has elapsed). Effectively: displayed stays
     `true` continuously. (AC2.4 part 2)
   - **State: SHOWN** (post-min-visible, raw still `true`) — raw
     goes `false`. Set `_internalSignal.value = false` immediately
     (min-visible already satisfied). Move to IDLE.
   - **State: SHOWN** — raw goes `true` again. No-op.

   This can be implemented either as an explicit state-machine
   variable or as two boolean flags (`_showTimer`/`_minVisibleTimer`
   plus tracking `_isShown`). The explicit-state version is more
   readable. Pick the approach the implementer finds clearest, but
   ensure every transition above is exercised by Task 3's tests.

5. A clock-injection seam for tests:
   ```ts
   type ClockHooks = {
       setTimeout: (cb:() => void, ms:number) => ReturnType<typeof setTimeout>
       clearTimeout: (handle:ReturnType<typeof setTimeout>) => void
   }
   let _clock:ClockHooks = {
       setTimeout: (cb, ms) => setTimeout(cb, ms),
       clearTimeout: (handle) => clearTimeout(handle),
   }
   export function _setClockForTest (clock?:ClockHooks):void {
       _clock = clock ?? {
           setTimeout: (cb, ms) => setTimeout(cb, ms),
           clearTimeout: (handle) => clearTimeout(handle),
       }
   }
   ```
   Internal code uses `_clock.setTimeout(...)` /
   `_clock.clearTimeout(...)`. Production uses the defaults; tests
   can inject a controllable fake. **Note:** the existing test
   infrastructure has no fake-timer library, but most of Phase 3's
   tests can use real timers with small `await
   new Promise(r => setTimeout(r, ms))` waits since
   `SHOW_DELAY_MS=300` and `MIN_VISIBLE_MS=500` are small. The
   clock seam is included for completeness and for any future
   tuning of thresholds. Tests in Task 3 may use either approach;
   real timers are recommended for clarity.

6. `init(rawSignal)` function:
   ```ts
   let _initialized = false
   let _disposeEffect:(() => void)|null = null

   export function init (
       rawSignal:Signal<boolean>,
   ):void {
       if (_initialized) return
       _initialized = true
       // Subscribe to raw and drive the state machine.
       _disposeEffect = effect(() => {
           const v = rawSignal.value
           handleRawChange(v)
       })
   }
   ```

7. `_resetForTest()` helper:
   ```ts
   export function _resetForTest ():void {
       if (_disposeEffect) {
           _disposeEffect()
           _disposeEffect = null
       }
       _initialized = false
       if (_showTimer !== null) {
           _clock.clearTimeout(_showTimer)
           _showTimer = null
       }
       if (_minVisibleTimer !== null) {
           _clock.clearTimeout(_minVisibleTimer)
           _minVisibleTimer = null
       }
       _internalSignal.value = false
       _state = 'IDLE'  // or whatever the initial state name is
       _setClockForTest()  // restore real clock
   }
   ```

**Full skeleton (the implementer fills in the state-machine body
per the transitions above):**

```ts
import {
    signal,
    computed,
    effect,
    type Signal,
    type ReadonlySignal,
} from '@preact/signals'

export const SHOW_DELAY_MS = 300
export const MIN_VISIBLE_MS = 500

type ClockHooks = {
    setTimeout: (
        cb:() => void,
        ms:number,
    ) => ReturnType<typeof setTimeout>
    clearTimeout: (
        handle:ReturnType<typeof setTimeout>,
    ) => void
}

let _clock:ClockHooks = {
    setTimeout: (cb, ms) => setTimeout(cb, ms),
    clearTimeout: (handle) => clearTimeout(handle),
}

export function _setClockForTest (clock?:ClockHooks):void {
    _clock = clock ?? {
        setTimeout: (cb, ms) => setTimeout(cb, ms),
        clearTimeout: (handle) => clearTimeout(handle),
    }
}

type State =
    | 'IDLE'
    | 'PENDING_SHOW'
    | 'SHOWN_MIN_VISIBLE'
    | 'SHOWN_MIN_PENDING_CLEAR'
    | 'SHOWN'

let _state:State = 'IDLE'
let _showTimer:ReturnType<typeof setTimeout>|null = null
let _minVisibleTimer:ReturnType<typeof setTimeout>|null = null

const _internalSignal = signal<boolean>(false)

export const displayedRefreshInProgress:ReadonlySignal<boolean> =
    computed<boolean>(() => _internalSignal.value)

function handleRawChange (raw:boolean):void {
    // ...state-machine transitions per the spec above...
}

let _initialized = false
let _disposeEffect:(() => void)|null = null

export function init (rawSignal:Signal<boolean>):void {
    if (_initialized) return
    _initialized = true
    _disposeEffect = effect(() => {
        const v = rawSignal.value
        handleRawChange(v)
    })
}

export function _resetForTest ():void {
    if (_disposeEffect !== null) {
        _disposeEffect()
        _disposeEffect = null
    }
    _initialized = false
    if (_showTimer !== null) {
        _clock.clearTimeout(_showTimer)
        _showTimer = null
    }
    if (_minVisibleTimer !== null) {
        _clock.clearTimeout(_minVisibleTimer)
        _minVisibleTimer = null
    }
    _internalSignal.value = false
    _state = 'IDLE'
    _setClockForTest()
}
```

**State-machine pseudocode for `handleRawChange(raw:boolean)`:**

```
if raw === true:
    switch _state:
        case 'IDLE':
            _state = 'PENDING_SHOW'
            _showTimer = _clock.setTimeout(() => {
                _showTimer = null
                _internalSignal.value = true
                _state = 'SHOWN_MIN_VISIBLE'
                _minVisibleTimer = _clock.setTimeout(() => {
                    _minVisibleTimer = null
                    if (_lastObservedRaw === false) {
                        _internalSignal.value = false
                        _state = 'IDLE'
                    } else {
                        _state = 'SHOWN'
                    }
                }, MIN_VISIBLE_MS)
            }, SHOW_DELAY_MS)
        case 'PENDING_SHOW': no-op (timer running)
        case 'SHOWN_MIN_VISIBLE': no-op
        case 'SHOWN_MIN_PENDING_CLEAR':
            _state = 'SHOWN_MIN_VISIBLE'  // re-armed
        case 'SHOWN': no-op

if raw === false:
    switch _state:
        case 'IDLE': no-op
        case 'PENDING_SHOW':
            _clock.clearTimeout(_showTimer)
            _showTimer = null
            _state = 'IDLE'
        case 'SHOWN_MIN_VISIBLE':
            _state = 'SHOWN_MIN_PENDING_CLEAR'
            // wait for minVisibleTimer
        case 'SHOWN_MIN_PENDING_CLEAR': no-op (already pending)
        case 'SHOWN':
            _internalSignal.value = false
            _state = 'IDLE'
```

Track `_lastObservedRaw` as a module-level boolean to disambiguate
in the `SHOWN_MIN_VISIBLE` timer-fire branch.

**Why not just use `computed(() => debounced raw)`:** signals'
`computed` is synchronous and pure — it cannot model the time-
delayed show/min-visible semantics without external timers. An
`effect` driving an internal writable signal is the correct
pattern here.

**Why a writable signal exposed through a `computed`:** The
`ReadonlySignal<boolean>` type tells consumers they cannot write
the value. Using `computed(() => _internalSignal.value)` is the
idiomatic way to expose a write-locked view. Reference:
@preact/signals docs.

**Verification:**
- Type-check: `npm run lint`
- No callers yet; the module compiles but is unreferenced.

**Commit:** `feat(client): add displayed-refresh-in-progress derived signal`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Wire `displayedFeedSyncStatus` through the derived signal

**Verifies:** fix-silent-update-gap.AC5.1, fix-silent-update-gap.AC5.2

**Files:**
- Modify: `/Users/nick/code/rsss/src/client/state.ts` at the
  `displayedFeedSyncStatus` computed (currently lines 427-433) and
  the AppState factory body to call
  `displayedRefreshInProgress.init(state.refreshInProgress)`.

**Changes:**

1. Add an import near the existing imports at the top of `state.ts`:
   ```ts
   import {
       displayedRefreshInProgress,
       init as initDisplayedRefresh,
   } from './displayed-refresh-in-progress.js'
   ```

2. Replace the body of `displayedFeedSyncStatus` (currently at
   `state.ts:427-433`):

   **Before:**
   ```ts
   displayedFeedSyncStatus: computed<
       'inactive'|'updates'|'syncing'|'error'|'synced'
   >(() => (
       state.refreshInProgress.value ?
           'syncing' :
           state.feedSyncStatus.value
   )),
   ```

   **After:**
   ```ts
   displayedFeedSyncStatus: computed<
       'inactive'|'updates'|'syncing'|'error'|'synced'
   >(() => (
       displayedRefreshInProgress.value ?
           'syncing' :
           state.feedSyncStatus.value
   )),
   ```

   Note: `state.refreshInProgress.value` is replaced by
   `displayedRefreshInProgress.value`. The `feedSyncStatus` fallback
   is unchanged. Computation closure capture must reference the
   imported signal (module scope), not `state.*`.

3. After the AppState object is constructed in the factory (and
   before it's returned), call:
   ```ts
   initDisplayedRefresh(state.refreshInProgress)
   ```
   This subscribes the derived signal's state machine to the raw
   signal exactly once per AppState construction.

   **Test-isolation note:** If the same module is loaded across
   multiple test files that each create an AppState, the
   `_initialized` guard in `init()` means only the FIRST AppState's
   `refreshInProgress` drives the derived signal. Tests that need
   to swap AppStates must call
   `displayedRefreshInProgress`'s `_resetForTest()` between
   AppState constructions. Task 3's tests rely on this.

**Verification:**
- Type-check: `npm run lint`
- Run existing tests: `npm test`. Pay attention to:
  - `test/updating-pill-lifecycle.ts` — this test exercises the
    chain `refreshInProgress -> displayedFeedSyncStatus`. After
    Phase 3, the chain becomes `refreshInProgress -> (300 ms
    debounce + 500 ms min-visible) -> displayedRefreshInProgress
    -> displayedFeedSyncStatus`. Tests that flip
    `refreshInProgress` and immediately assert
    `displayedFeedSyncStatus === 'syncing'` will FAIL because of
    the 300 ms show-delay. These tests need adjustment — either
    wait for the debounce (`await new Promise(r =>
    setTimeout(r, SHOW_DELAY_MS + 50))`) or call
    `displayedRefreshInProgress._setClockForTest({...})` with a
    fake clock to skip the wait, or update assertions to expect
    a delay.
  - `test/state-refresh-audit.ts` — likely fine, but read it to
    confirm.
  - `test/feed-status.ts` — likely fine; only reads
    `displayedFeedSyncStatus`.

  Where existing tests break because of the new debounce, fix
  them in this task. Do NOT delete behavior coverage — adapt the
  tests to the new contract.

**Commit:** `feat(client): route displayedFeedSyncStatus through debounced derived signal`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Unit tests for debounce + min-visible behavior

**Verifies:** fix-silent-update-gap.AC2.1, fix-silent-update-gap.AC2.2,
fix-silent-update-gap.AC2.3, fix-silent-update-gap.AC2.4

**Files:**
- Create: `/Users/nick/code/rsss/test/displayed-refresh-in-progress.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` — register
  the new file.

**Test cases:**

Each test:
1. Calls `_resetForTest()` first (idempotent reset).
2. Creates a fresh `signal<boolean>(false)` as the raw signal.
3. Calls `init(rawSignal)`.
4. Drives `rawSignal.value = ...` to simulate the scenario.
5. Uses `await new Promise(r => setTimeout(r, ms))` to advance
   real time.
6. Asserts on `displayedRefreshInProgress.value`.
7. Final `_resetForTest()` for cleanup.

**Case AC2.1: raw stays `true` past show-delay -> displayed becomes
`true`.**
- `rawSignal.value = true`
- After ~50 ms: `displayedRefreshInProgress.value === false`
- After `SHOW_DELAY_MS + 50` ms total:
  `displayedRefreshInProgress.value === true`

**Case AC2.2: raw flips `true -> false` before show-delay ->
displayed never becomes `true`.**
- `rawSignal.value = true`
- After ~100 ms (< SHOW_DELAY_MS=300):
  `displayedRefreshInProgress.value === false`
- `rawSignal.value = false`
- After ~`SHOW_DELAY_MS + 50` ms (= 350 ms total from start, well
  past where displayed would have flipped if it were going to):
  `displayedRefreshInProgress.value === false`

**Case AC2.3: once displayed becomes `true`, it stays `true` for
at least `MIN_VISIBLE_MS` even if raw clears sooner.**
- `rawSignal.value = true`
- Wait `SHOW_DELAY_MS + 50` ms (350 ms). Assert displayed `true`.
- Wait additional 100 ms (total 450 ms from start, 100 ms into
  min-visible). `rawSignal.value = false`.
- Immediately assert displayed still `true`.
- Wait additional 100 ms (200 ms into min-visible, 200 ms total
  since raw cleared, but only 100 ms since raw cleared because
  min-visible started at the show transition).
  Actually: min-visible started at 350 ms (when displayed became
  `true`) so it expires at 350 + 500 = 850 ms total from start.
  At 550 ms total (200 ms into min-visible), displayed still
  `true`.
- Wait until 900 ms total. Displayed `false` (min-visible elapsed
  AND raw has been false).

**Case AC2.4: raw re-acquires inside the min-visible window ->
displayed stays continuously `true`.**
- `rawSignal.value = true`. Wait `SHOW_DELAY_MS + 50` ms (350 ms).
  Displayed `true`.
- `rawSignal.value = false`. Wait 50 ms (400 ms total, 50 ms into
  min-visible). Displayed still `true`.
- `rawSignal.value = true` again. Wait until 900 ms (past
  min-visible expiry). Displayed still `true` (raw is `true`,
  so SHOWN state).
- `rawSignal.value = false`. Min-visible already elapsed.
  Displayed `false` immediately (or at most within a microtask).

**Sub-cases the implementer should also cover** (not strictly in
the AC list, but valuable for confidence):

- **Sequence of rapid raw flips** (e.g., true/false/true/false in
  100 ms intervals, all within SHOW_DELAY_MS): displayed should
  never go `true` (each `false` cancels the show timer).
- **After full cycle, raw goes true again**: displayed correctly
  re-enters the PENDING_SHOW state.

**Real-timer caveat:** Using real `setTimeout` means these tests
take ~1 s each. The test file might total ~5 s. This is
acceptable for a one-off run of `npm test`. If tests become
flaky on slow CI, switch to the `_setClockForTest()` injection
seam (see Task 1) to drive time deterministically.

**Test scaffolding:**

```ts
import { test } from '@substrate-system/tapzero'
import { signal } from '@preact/signals'
import {
    displayedRefreshInProgress,
    init,
    SHOW_DELAY_MS,
    MIN_VISIBLE_MS,
    _resetForTest,
} from '../src/client/displayed-refresh-in-progress.js'

function sleep (ms:number):Promise<void> {
    return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

test('AC2.1: raw stays true past show-delay -> displayed becomes true',
    async (t) => {
        _resetForTest()
        const raw = signal<boolean>(false)
        init(raw)
        raw.value = true
        await sleep(50)
        t.equal(
            displayedRefreshInProgress.value,
            false,
            'displayed still false at 50ms (before show-delay)',
        )
        await sleep(SHOW_DELAY_MS)
        t.equal(
            displayedRefreshInProgress.value,
            true,
            'displayed true after show-delay elapsed',
        )
        _resetForTest()
    })
```

**Verification:**
- Standalone: `npx esbuild ./test/displayed-refresh-in-progress.ts
  --bundle | npx tapout`
- Full suite: `npm test && npm run lint`

**Commit:** `test(client): displayed-refresh-in-progress debounce + min-visible`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

---

## Phase Completion Checklist

- [ ] `src/client/displayed-refresh-in-progress.ts` exists and
  exports `SHOW_DELAY_MS`, `MIN_VISIBLE_MS`,
  `displayedRefreshInProgress` (read-only),
  `init(rawSignal)`, `_setClockForTest`, `_resetForTest`.
- [ ] `displayedFeedSyncStatus` in `state.ts` reads
  `displayedRefreshInProgress.value` (not
  `state.refreshInProgress.value`).
- [ ] `initDisplayedRefresh(state.refreshInProgress)` is invoked
  from the AppState factory.
- [ ] `test/displayed-refresh-in-progress.ts` registered and
  passing.
- [ ] Pre-existing tests that assert immediate
  `displayedFeedSyncStatus === 'syncing'` after a raw refresh
  start are updated to await the show-delay where appropriate
  (or are confirmed unaffected if they already wait).
- [ ] `npm test && npm run lint` passes.
- [ ] No new colors, no new components, no new text strings — only
  the existing `displayedFeedSyncStatus` -> header-dot binding.
