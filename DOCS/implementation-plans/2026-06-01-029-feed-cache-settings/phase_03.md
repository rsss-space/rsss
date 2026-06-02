# Feed Cache Settings — Phase 3: Cache Settings panel UI

**Goal:** Rename the reader-route cache disclosure summary to a static
"Cache Settings", and add a "Cache this feed" smart checkbox that reflects
the feed's effective caching state, writes the tri-state override, gates
the mode/size/age controls, and grays out (with a plan hint) when the user
is unentitled — while staying interactive when local storage is merely
off.

**Architecture:** All changes are in
`src/client/components/cache-settings.ts` (rendered by `feed-reader.ts`).
The checkbox shows `isContentCachedForPolicy(policy)` (Phase 1 resolver)
and, on change, writes `null` when the chosen value equals the global
(`storeContent`) or an explicit `0`/`1` otherwise (the "smart checkbox").
The existing mode/size/age controls move inside a `<fieldset
disabled=${!effective}>` so the browser grays them natively when caching
is effectively off. The billing gate copies the `/settings` expression
`(isBillingLoaded && !isEntitled) || !supported`.

**Tech Stack:** TypeScript (browser, ES2022 via Vite) + Preact +
`@preact/signals` + `htm/preact`; `@substrate-system/check-box`
(`CheckBox.TAG`, already a dependency); tests with `@substrate-system/tapzero`
+ Preact render.

**Scope:** Phase 3 of 4. **Depends on Phase 1** (resolver + row field).
This phase does **not** implement the enable-while-storage-off bootstrap —
that is Phase 4. Here, toggling while storage is off updates the in-memory
override only (the DB write no-ops because there is no local DB yet);
Phase 4 adds the bootstrap so it actually persists and caches.

**Codebase verified:** 2026-06-01

---

## Acceptance Criteria Coverage

### 029-feed-cache-settings.AC1: Summary reads a static "Cache Settings"
- **029-feed-cache-settings.AC1.1 Success:** The reader-route cache
  disclosure renders a fixed summary label.
- **029-feed-cache-settings.AC1.2 Success:** The summary label does not
  change when the feed's `cache_mode` changes (invariance).

### 029-feed-cache-settings.AC3: Toggle ON activates controls; mode default
- **029-feed-cache-settings.AC3.1 Success:** When effective-on, the
  mode/size/age controls are enabled.
- **029-feed-cache-settings.AC3.2 Success:** A feed with no `cache_mode`
  override resolves to the global default (`text_images`).
- **029-feed-cache-settings.AC3.3 Success:** Changing mode/size/age while
  on persists to the feed's policy row.

### 029-feed-cache-settings.AC4 (UI portion)
- **029-feed-cache-settings.AC4.3 Success:** When effective-off, the
  mode/size/age controls are disabled.

### 029-feed-cache-settings.AC6: Unentitled → grayed with plan hint
- **029-feed-cache-settings.AC6.1 Failure:** Billing loaded & not entitled
  → checkbox disabled.
- **029-feed-cache-settings.AC6.2 Success:** Unentitled → a "requires a
  paid plan" hint is associated with the control.
- **029-feed-cache-settings.AC6.3 Success:** Entitled but storage off →
  checkbox is interactive (not disabled).

### 029-feed-cache-settings.AC9 (UI portion): smart checkbox
- **029-feed-cache-settings.AC9.1 Success:** Toggling to a value equal to
  the global clears the override (writes `null`).
- **029-feed-cache-settings.AC9.2 Success:** Toggling opposite the global
  writes an explicit override (`0`/`1`).

---

## Verified Codebase Context (read before coding)

**`src/client/components/cache-settings.ts`** (full file, 215 lines, is
the work area):
- Imports: `DetailsSummary` (line 4), `type CacheMode` from
  `../local-first-settings.js` (line 6), `feedPolicies`,
  `loadFeedPolicies`, `upsertFeedCachePolicy`, `resolveEffectivePolicy`,
  `type FeedCachePolicyRow` from `../db/feed-cache-policy.js` (7-13),
  `getBootstrappedDb`, `getLocalDb`, `clearFeedCache`, `type Feed` from
  `../db/index.js` (14-19), `AMP`, `NBSP` from `../constants.js` (21).
- Props: `{ state:AppState; selectedFeed:Feed }` (23-26).
- `getDb()` (47-52): `state.user.value?.did ? (getBootstrappedDb() ??
  getLocalDb(did)) : null`.
- `saveFeedPolicy(patch)` (54-77): merges `patch` over the current row,
  optimistically sets `feedPolicies.value`, and writes via
  `upsertFeedCachePolicy` **only if `getDb()` is non-null** (line 68
  early-returns otherwise).
- `handleCacheModeChange` / `handleMaxSizeChange` / `handleMaxAgeChange`
  (79-103) each call `saveFeedPolicy({...})`.
- `handleClearCache` (105-125): the "Clear cache" button handler.
- Render reads `const policy = feedPolicies.value[selectedFeed.id] ?? null`
  (127), `const eff = resolveEffectivePolicy(policy)` (128), `modeLabel`
  (129-131), `sizeVal`/`ageVal` (132-137).
- The dynamic summary is **lines 146-150**:
  `Cache:${NBSP}${modeLabel}${eff.isDefault.cacheMode ? ' (default)' : ''}`.
- The mode `<select>` (155-179), max-size `<input>` (183-190), max-age
  `<input>` (194-201) live in a `<div class="feed-cache-form">` (152-203);
  the "Clear cache" `<button>` is 204-209.

**`/settings` patterns to copy (do NOT modify settings.ts):**
- CheckBox: `import { CheckBox } from '@substrate-system/check-box'`; usage
  `<${CheckBox.TAG} name=… checked=${v || undefined} disabled=${d ||
  undefined} aria-describedby=… onChange=${h}>label<//>`
  (settings.ts:575-584). Change handler reads
  `(ev.target as HTMLInputElement).checked` (settings.ts:443).
- Billing signals (settings.ts:119-126): `const supported =
  localFirstSupported.value` (`localFirstSupported` is exported from
  `../db/index.js`); `const billing = billingStatus.value` (`billingStatus`
  from `../billing-status.js`); `const isEntitled =
  Boolean(billing?.entitled)`; `const isBillingLoaded = billing !== null`.
- Disable expression (settings.ts:579-580):
  `(isBillingLoaded && !isEntitled) || !supported`.
- `<fieldset disabled=${cacheDisabled.value}>` native gray-out
  (settings.ts:660-679).

**Tests:** `test/feed-reader-cache-disclosure.ts` (already exists, renders
`FeedReader` with a mock `AppState`, imports `feedPolicies`,
`_resetFeedPolicies`, `defaultCacheMode`, etc.; wired via `test/index.ts`).
Set signals with `batch()`. Query the checkbox by its `name` attribute,
not by text. Honor global CLAUDE.md (≤80 cols, `x:Type`, ternary style,
`batch()`); **do not assert specific HTML text** and **do not change CSS
unrelated to this task**.

---

## Design Decisions (read)

1. **Effective state source:** compute
   `const effectiveContent = isContentCachedForPolicy(policy)` in render
   (reuses the already-read `policy`; subscribes the component to
   `feedPolicies` and `storeContent`). Import `isContentCachedForPolicy`
   from `../db/feed-cache-policy.js`.
2. **Smart write:** on toggle, `const override = (checked ===
   storeContent.value) ? null : (checked ? 1 : 0)`; then
   `saveFeedPolicy({ content_enabled: override })`. Writing `null` plus
   the existing null mode/size/age collapses the row to inherit (Phase 1
   DELETE rule); writing `0`/`1` persists an explicit override.
3. **Fieldset, not the Clear-cache button:** wrap only the mode/size/age
   `<div class="feed-cache-form">` in `<fieldset disabled=${!
   effectiveContent}>`. Keep "Clear cache" **outside** the fieldset so a
   user can still purge content that was retained after disabling
   (preserve-on-disable means disabling never auto-purges).
4. **Plan hint + ARIA:** render a hint element
   (`id="feed-cache-plan-hint-${selectedFeed.id}"`) only when
   `isBillingLoaded && !isEntitled`; set the checkbox's `aria-describedby`
   to that id in the unentitled case. Give the fieldset
   `id="feed-cache-fields-${selectedFeed.id}"` and set the checkbox's
   `aria-controls` to it.
5. **`saveFeedPolicy` must carry `content_enabled`:** add
   `content_enabled: current?.content_enabled ?? null` to the `updated`
   object so editing mode/size/age never drops the override and vice
   versa.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Static summary + carry `content_enabled` in `saveFeedPolicy`

**Verifies:** AC1.1, AC1.2 (summary); supports AC3.3/AC9 (merge keeps the
override).

**Files:**
- Modify: `src/client/components/cache-settings.ts`

**Implementation:**
1. Replace the dynamic `<summary>` (lines 146-150) with a static label:
   `<summary>Cache Settings</summary>`.
2. Remove the now-unused `const eff = resolveEffectivePolicy(policy)`
   (128) and `const modeLabel = …` (129-131). Remove
   `resolveEffectivePolicy` from the import on line 11. Keep `policy`,
   `sizeVal`, `ageVal`, and the `AMP` import (still used by the mode
   option label on line 177).
3. In `saveFeedPolicy` (54-77), add
   `content_enabled: current?.content_enabled ?? null` to the `updated`
   object literal (so it round-trips through the merge).

**Verification:**
Run: `npm run lint`
Expected: passes (no unused imports/vars).

**Commit:** `feat: static Cache Settings summary; carry content_enabled`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Add the "Cache this feed" smart checkbox + billing gate

**Verifies:** AC6.1, AC6.2, AC6.3, AC9.1, AC9.2.

**Files:**
- Modify: `src/client/components/cache-settings.ts`

**Implementation:**
1. Add imports: `CheckBox` from `@substrate-system/check-box`;
   `isContentCachedForPolicy` from `../db/feed-cache-policy.js`;
   `storeContent` from `../local-first-settings.js` (extend the existing
   `type CacheMode` import); `billingStatus` from `../billing-status.js`;
   `localFirstSupported` (add to the existing `../db/index.js` import).
2. In render, compute:
   ```ts
   const effectiveContent = isContentCachedForPolicy(policy)
   const billing = billingStatus.value
   const isEntitled = Boolean(billing?.entitled)
   const isBillingLoaded = billing !== null
   const supported = localFirstSupported.value
   const unentitled = isBillingLoaded && !isEntitled
   const contentDisabled = unentitled || !supported
   const fieldsId = `feed-cache-fields-${selectedFeed.id}`
   const planHintId = `feed-cache-plan-hint-${selectedFeed.id}`
   ```
3. Add the change handler (Phase 3 version; Phase 4 extends it):
   ```ts
   function handleContentToggle (ev:Event) {
       const checked = (ev.target as HTMLInputElement).checked
       const override = (checked === storeContent.value) ?
           null :
           (checked ? 1 : 0)
       saveFeedPolicy({ content_enabled: override })
   }
   ```
4. Render the checkbox as the first child inside `.details-content`,
   above the form:
   ```ts
   <${CheckBox.TAG}
       name=${`feed-cache-content-${selectedFeed.id}`}
       checked=${effectiveContent || undefined}
       disabled=${contentDisabled || undefined}
       aria-controls=${fieldsId}
       aria-describedby=${unentitled ? planHintId : undefined}
       onChange=${handleContentToggle}
   >
       Cache this feed
   <//>
   ${unentitled ? html`
       <p id=${planHintId} class="cache-plan-hint">
           Caching to this device requires a paid plan.
       </p>
   ` : null}
   ```
   (If a `.cache-plan-hint` style does not exist, a minimal addition to
   `cache-settings.css` is acceptable; do not touch unrelated CSS.)

**Testing:** covered by Task 3.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: add per-feed Cache this feed smart checkbox`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Gate the mode/size/age controls behind a `<fieldset>`

**Verifies:** AC3.1, AC4.3, AC3.2 (resolver default), AC3.3 (persist still
works).

**Files:**
- Modify: `src/client/components/cache-settings.ts`

**Implementation:**
Wrap the existing `<div class="feed-cache-form">` (mode/size/age, lines
152-203) in:
```ts
<fieldset id=${fieldsId} disabled=${!effectiveContent}>
    <div class="feed-cache-form"> … existing controls … </div>
</fieldset>
```
Leave the "Clear cache" `<button>` outside the fieldset. Do not otherwise
change the controls or their handlers. The native `disabled` fieldset
grays/disables all descendant controls when `effectiveContent` is false
(AC4.3) and enables them when true (AC3.1).

**Testing:** covered below.

**Verification:**
Run: `npm run lint`
Expected: passes.

**Commit:** `feat: gray feed cache controls when caching is off`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-4) -->

<!-- START_TASK_4 -->
### Task 4: Tests — summary invariance, gating, billing, smart write

**Verifies:** AC1.1, AC1.2, AC3.1, AC3.2, AC3.3, AC4.3, AC6.1, AC6.2,
AC6.3, AC9.1, AC9.2.

**Files:**
- Modify: `test/feed-reader-cache-disclosure.ts`

**Testing:** Extend the existing render-based suite (mock `AppState`,
real Preact `render`). Set signals via `batch()`; reset `feedPolicies`
with `_resetFeedPolicies()` between cases; restore any global signal
(`storeContent`, `billingStatus`) you mutate. Query the checkbox via
`root.querySelector('check-box[name="feed-cache-content-<id>"]')` or by
its `name`; query the fieldset by `id`. Add cases:

- **AC1.2 (and AC1.1) summary invariance:** render with the feed's
  `cache_mode` unset; capture the `<summary>` `textContent`. Re-render
  with `cache_mode='text'` then `'text_images'` (via `feedPolicies`);
  assert the summary `textContent` is unchanged across all three. (Tests
  invariance, not the literal string — do not assert "Cache Settings".)
- **AC3.1 enabled-when-on:** entitled, `storeContent=true`, no override →
  `effectiveContent` true → the `<fieldset>` has `disabled === false`
  (controls enabled).
- **AC4.3 disabled-when-off:** entitled, `storeContent=false`, no override
  → `effectiveContent` false → the `<fieldset>` is `disabled`.
- **AC3.2 default mode:** with `cache_mode` null, assert
  `resolveEffectivePolicy(feedPolicies.value[id]).cacheMode ===
  'text_images'` (the global default). (Pure resolver assertion.)
- **AC6.1 unentitled disabled:** `billingStatus` loaded with
  `entitled:false` → the checkbox element is `disabled`.
- **AC6.2 plan hint associated:** unentitled → an element with the
  `aria-describedby` id exists and the checkbox's `aria-describedby`
  references it.
- **AC6.3 interactive when storage merely off:** entitled,
  `isLocalFirstActive=false`, `storeContent=false` → the checkbox is
  **not** disabled.
- **AC9.1 clear override:** with `storeContent=true` and the feed
  effective-on, dispatch a `change` with `checked=false`… then
  `checked=true` again; after the second toggle (chosen value equals the
  global `true`) assert `feedPolicies.value[id].content_enabled` is `null`.
  Symmetrically, with `storeContent=false`, toggling to `checked=false`
  (equals global) clears to `null`.
- **AC9.2 explicit override:** with `storeContent=false`, dispatch
  `change` with `checked=true` → `feedPolicies.value[id].content_enabled
  === 1`. With `storeContent=true`, `checked=false` → `=== 0`.
- **AC3.3 persist regression:** changing `cache_mode` via the select while
  a `content_enabled` override is set keeps `content_enabled` intact in
  `feedPolicies.value[id]` (the `saveFeedPolicy` merge).

To dispatch a CheckBox change in tests, follow the existing harness; set
`el.checked` then dispatch a `change`/`input` event the component listens
for (mirror how `test/feed-reader-cache-disclosure.ts` or
`test/cache-status.ts` drive control events).

**Verification:**
Run the aggregate suite (contains this file):
`esbuild ./test/index.ts --bundle
--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts
--alias:@sentry/cloudflare=./test/sentry-cloudflare-stub.ts
--loader:.css=text --loader:.wasm=dataurl | tapout`
Expected: passes.
Run: `npm test && npm run lint`
Expected: full suite + lint pass.

**Commit:** `test: cache settings summary, gating, billing, smart toggle`
<!-- END_TASK_4 -->

<!-- END_SUBCOMPONENT_B -->

---

## Phase 3 Done When

- The disclosure summary is a static "Cache Settings" and does not change
  with `cache_mode`.
- The "Cache this feed" checkbox reflects `override ?? storeContent`,
  writes `null` when the chosen value equals the global and an explicit
  `0`/`1` otherwise.
- The mode/size/age controls gray out (native `<fieldset disabled>`) when
  caching is effectively off and are active when on; "Clear cache" stays
  available.
- The checkbox is disabled with an associated plan hint when unentitled,
  and interactive when entitled even if local storage is off.
- `npm test` and `npm run lint` pass.
