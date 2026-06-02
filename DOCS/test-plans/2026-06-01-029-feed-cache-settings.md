# Test Plan: 029 Feed Cache Settings (per-feed opt-in caching)

Generated from automated test-coverage analysis of feature
`029-feed-cache-settings` (commits `91c2ff7..2ec6753`).

Automated coverage result: **PASS** — 29/29 automated acceptance
criteria covered; 2 sub-cases designated for human verification (AC5.2
real-OPFS-bootstrap persistence; AC9.3 on-demand `fetchFullArticle`
gate).

## Prerequisites

- Run the app locally: `npm run dev` (Cloudflare Vite dev server).
- Full automated suite green: `npm test && npm run lint`.
- One entitled (paid-plan) account with at least two subscribed feeds:
  **Feed A** and **Feed B**.
- A second un-entitled (free) account for the AC6 spot-check (optional;
  AC6 is automated).
- Browser DevTools open (Application -> OPFS / IndexedDB presence;
  Network tab to watch `/api/sync`).
- Controls live on a feed's reader route: expand the **Cache Settings**
  disclosure (the `<details>` inside `.feed-cache-controls`).

## Phase 1: Resolver and toggle behavior (effective state)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in as the entitled account. On `/settings`, turn the global **Store article content locally** toggle ON; confirm local storage is active. | Global storage on. |
| 2 | Open Feed A reader route, expand **Cache Settings**. Do not set any per-feed override. | The mode/size/age fieldset is enabled (not grayed); the "Cache this feed" checkbox reflects effective-on (checked). |
| 3 | Uncheck "Cache this feed" for Feed A. | Fieldset grays out (disabled). Checkbox reflects off. |
| 4 | Re-check "Cache this feed" for Feed A. | Override clears back to inherit (checkbox returns to the global value); fieldset re-enables. |
| 5 | On `/settings`, turn global storage OFF. Return to Feed A reader route. | Cache Settings fieldset is grayed (effective-off via inherit); checkbox shows off. |

## Phase 2: Force-on caching while global storage is OFF

| Step | Action | Expected |
|------|--------|----------|
| 1 | Global storage OFF. On Feed A reader route, check "Cache this feed". | Checkbox briefly disables while bootstrap runs, then re-enables checked. Network tab shows a `/api/sync` request (bootstrap). The `/settings` global toggle stays OFF. |
| 2 | Open several Feed A articles, then reload the page and revisit Feed A. | Feed A article bodies are present from local cache. Feed A "Cache this feed" remains checked after reload. |
| 3 | Open Feed B (untouched, inheriting global-off) articles, reload, revisit. | Feed B bodies are NOT persisted locally; they render from in-memory/live fetch only. Feed B checkbox still reflects off. |

## Phase 3: Force-off behavior (preserve existing, no new)

| Step | Action | Expected |
|------|--------|----------|
| 1 | With global storage ON and Feed A previously cached (has bodies in local DB), set Feed A "Cache this feed" to OFF (explicit force-off). | Fieldset grays. |
| 2 | Trigger a sync that updates an already-cached Feed A item and brings in a brand-new Feed A item. | The previously-cached item keeps its body (preserve-on-disable). The brand-new item lands metadata-only (no body, no images persisted). |

## Phase 4: Entitlement gating (spot-check; automated by AC6)

| Step | Action | Expected |
|------|--------|----------|
| 1 | Sign in as the un-entitled (free) account. Open any feed reader route, expand Cache Settings. | "Cache this feed" checkbox is disabled. A plan-hint element is shown and is associated with the checkbox (screen reader announces it). |

## End-to-End HV-1: Override persists after a real OPFS bootstrap (AC5.2)

Purpose: confirm the optimistic `content_enabled=1` override is durably
written to the local SQLite `feed_cache_policy` table after a real
OPFS-backed bootstrap, surviving a reload.

1. Start clean: entitled account, device local storage OFF (`/settings`
   global "Store article content locally" off, no local DB yet — clear
   OPFS/site data if needed).
2. On Feed A reader route, expand Cache Settings, check "Cache this
   feed".
3. Wait for bootstrap: the checkbox is disabled while bootstrapping,
   then re-enables checked.
4. Reload the page.

Expected: after reload, Feed A "Cache this feed" is still checked
(override `content_enabled=1` survived in local `feed_cache_policy`).
Feed B (untouched/inherit) still reflects the off global. The
`/settings` global "Store article content locally" toggle remains OFF.
(DevTools: a local OPFS SQLite DB now exists.)

## End-to-End HV-2: On-demand fetchFullArticle honors the per-feed resolver (AC9.3 on-demand half)

Purpose: confirm the on-demand full-article fetch path mirrors a body
into the local DB only for caching feeds, agreeing with the pull-sync
and cache-status read paths.

1. Device local storage ON, global "Store article content locally" OFF.
2. Feed A "Cache this feed" ON (override-on); Feed B left inheriting
   (effectively off).
3. Open a Feed A article whose body is not yet cached (missing body);
   let it fetch the full article on demand.
4. Open a Feed B article in the same missing-body condition.
5. Reload / revisit both articles.

Expected: Feed A's just-fetched body is mirrored into the local DB
(reads back as cached on the later visit). Feed B's body is NOT
persisted (the article still displays from in-memory state, but no body
is written for the non-caching feed).

## Human Verification Required

| Criterion | Why Manual | Steps |
|-----------|------------|-------|
| AC5.2 — override persists after real OPFS bootstrap | Full OPFS + WASM + network bootstrap happy path is flaky to drive in the Preact render suite (the failure path is automated via AC5.4). | End-to-End HV-1 |
| AC9.3 — on-demand `fetchFullArticle` gate | Imperative `state.ts` state-flow; an automated test would couple to `state.ts` internals. Pull-sync and cache-status halves are automated. | End-to-End HV-2 |

## Traceability

| Acceptance Criterion | Automated Test | Manual Step |
|----------------------|----------------|-------------|
| AC1.1, AC1.2 | feed-reader-cache-disclosure.ts | Phase 1 step 2 |
| AC2.1-AC2.5 | feed-cache-policy.ts (+ pull-sync.ts for AC2.3) | Phase 1 steps 2-5 |
| AC3.1, AC3.3 | feed-reader-cache-disclosure.ts | Phase 1 steps 2-4 |
| AC3.2 | feed-reader-cache-disclosure.ts | — |
| AC4.1, AC4.2, AC4.4 | pull-sync.ts (+ cache-status.ts) | Phase 3 steps 1-2 |
| AC4.3 | feed-reader-cache-disclosure.ts | Phase 1 step 5 |
| AC5.1, AC5.5 | feed-reader-cache-disclosure.ts | Phase 2 step 1 |
| AC5.2 | best-effort (else HV-1) | End-to-End HV-1 |
| AC5.3 | pull-sync.ts | Phase 2 steps 2-3 |
| AC5.4 | feed-reader-cache-disclosure.ts | — (failure path) |
| AC6.1, AC6.2, AC6.3 | feed-reader-cache-disclosure.ts | Phase 4 step 1 |
| AC7.1-AC7.4 | feed-cache-policy.ts | End-to-End HV-1 (round-trip across reload) |
| AC8.1 | settings-route.ts (regression) | Phase 1 step 5 |
| AC8.2 | feed-reader-cache-disclosure.ts | Phase 2 step 1 |
| AC9.1, AC9.2 | feed-reader-cache-disclosure.ts + feed-cache-policy.ts | Phase 1 steps 3-4 |
| AC9.3 (pull-sync, cache-status) | pull-sync.ts, cache-status.ts | Phase 2 steps 2-3 |
| AC9.3 (on-demand fetch) | HV-2 | End-to-End HV-2 |
