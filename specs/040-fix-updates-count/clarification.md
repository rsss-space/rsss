# 040 — "N updates" count accuracy + freshness — Clarification

Status: clarified, ready for brainstorming / design
Date: 2026-06-14
Source command: `/ed3d-plan-and-execute:flesh-it-out`

This document is the output of the clarification phase. It captures the
problem, the verified current behavior, the confirmed Definition of Done,
and the key open question to resolve first. It is NOT a design or plan.

## Problem (as clarified)

The header "N updates" text has shown "6" for several days in **local dev
(`127.0.0.1`)**. The user suspects the count value is too low — "it feels
like there'd be more after several days."

Diagnostics established this is **not** a stale-tab display bug:

- A hard reload re-queries the server (`GET /api/feed-status`) and still
  returns 6 — so the server genuinely only *has* 6 pending.
- Clicking "Refresh Feeds" / "fetch updates" correctly clears it to 0 and
  pulls the items into view — so the pull + `last_pulled_at` bump work.

Conclusion: the gap is **discovery** (are new items being found?), not
**delivery**. The originally-proposed "fix the SSE push" is necessary for
live updates but cannot raise the number — only the discovery loop can.

Environment scope (confirmed): **observed in local dev only.**

## How it works today (verified in code)

- **Count source:** `getFeedUpdateCounts()`
  (`src/server/durable-objects/index.ts:736`) counts items where
  `pub_date > feeds.last_pulled_at` (or `last_pulled_at IS NULL`). Summed
  client-side in `src/client/components/feed-status.ts:74`; the same source
  drives the per-feed `(N)` badges in `src/client/components/feed-nav.ts`.
- **`last_pulled_at`** is written in exactly one place,
  `advanceFeedCursor()` (`index.ts:761`), called only by the two manual
  refresh endpoints (`index.ts:1853`, `1880`). It sets `last_pulled_at` to
  `MAX(pub_date)` of the feed's items, so a successful refresh zeroes the
  pending count.
- **Discovery** is a per-user Durable Object **alarm**, 60-min interval
  (`FEED_REFRESH_INTERVAL_MS`, `index.ts:149`; `alarm()` at `index.ts:3591`
  → `refreshFeedBatches()` → `fetchFeed()`). This is the *only* background
  discovery path. `fetchFeed()` inserts new items with `pub_date` set but
  does **not** bump `last_pulled_at`, so polled items correctly count as
  pending. The pending math is sound.
- **Live delivery** is the `feed-updates-available` SSE broadcast
  (`index.ts:2729`), fired by both polling and refresh when new items land.
  The client re-fetches/updates the count only on: initial load, after a
  refresh completes, the `online` event, WS reconnect, and that SSE event.
  There is **no periodic polling** of the count.

## Definition of Done (confirmed by user)

1. **Verify correctness first (diagnose, don't assume a bug).** Confirm "6"
   is genuinely the server's current truth in the local dev DB — per-feed
   counts sum to the header value, and `getFeedUpdateCounts()` computes what
   it should. "It is correct" is an acceptable outcome for this strand.

2. **Discovery reliability.** Empirically determine whether the per-DO
   alarm fires *and reschedules itself* under `wrangler dev`. If it doesn't
   run / dies silently / fails to reschedule / swallows errors, make
   background discovery reliable — and give local dev a usable way to
   exercise discovery so the count can grow without a manual click.

3. **Live count delivery (SSE).** Make the `feed-updates-available` push
   reliable so an already-open tab's "N updates" text updates without a hard
   reload, with a fallback (refresh-on-focus or light polling) for when the
   socket is down.

## Explicitly out of scope

- Redefining what "pending / available" means — the current
  "fetched-but-not-yet-pulled" semantics stay.
- Cache-policy changes.
- Reworking the fact that "fetch updates" and "Refresh Feeds" are the same
  content-pull action — that is fine. Only the passive "N updates" text
  needs to auto-update.

## Key open question to resolve FIRST in design

**Does the DO alarm actually fire under `wrangler dev`?**

An earlier "alarms don't fire locally" claim is **unverified and likely
wrong** for modern Miniflare (wrangler dev generally supports DO alarms).
Verify empirically before deciding how much of strand 2 is a real bug vs.
expected dev behavior — it forks the whole approach. Suggested checks:

- Inspect `.wrangler/state` DO storage for the scheduled alarm / item rows.
- Add temporary logging in `alarm()` / `refreshFeedBatches()` and observe.
- Manually invoke the alarm path; confirm `scheduleNextFeedRefresh()` runs
  even when `refreshFeedBatches()` throws.
- Check whether feeds are short-circuiting on `304 Not Modified`
  (`index.ts:2586`), which would mean "no new content," not "broken poll."

## Key files

- `src/server/durable-objects/index.ts` — `getFeedUpdateCounts` (736),
  `advanceFeedCursor` (761), refresh endpoints (1853, 1880), `alarm` (3591),
  `refreshFeedBatches` (3689), `fetchFeed` (2566), SSE broadcast (2729).
- `src/client/components/feed-status.ts` — header count + button (74, 106).
- `src/client/components/feed-nav.ts` — per-feed `(N)` badges (167).
- `src/client/components/sidebar-footer.ts` — "Refresh Feeds" button (13).
- `src/client/state.ts` — `loadFeedStatus`, SSE handlers, refresh flow.
- `specs/034-fetch-updates-button/` — prior feature that added the button.
