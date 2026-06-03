# Implementation Plan: Show Article Source URL

**Branch**: `030-article-source-url` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/030-article-source-url/spec.md`

## Summary

On the signed-in home-page article list, each item shows only its feed
title (e.g. "culture latest"), which does not reveal the article's
source domain. This feature renders the article's own post URL as a
plain, non-interactive line beneath the feed title in each item's meta
area, omitting it when the item has no link and constraining long URLs
so the list never overflows horizontally.

**Technical approach**: Pure client-side UI change. The post URL is
already present on every rendered item as `Item.link` (already consumed
by the row's "open in new tab" action), so **no DO schema, `/api/sync`
payload, local SQLite schema, or sync-flow change is required**. The
change is confined to `src/client/components/item-row.ts` (add a
`.item-url` element inside `.item-meta`) and `item-row.css` (truncation
+ subordinate styling).

## Technical Context

**Language/Version**: TypeScript (browser, ES2022 lib via Vite)
**Primary Dependencies**: Preact, `@preact/signals`, `htm/preact`
**Storage**: N/A for this feature. Reuses existing `Item.link` already
present in the local OPFS-SQLite mirror and the remote adapter payload;
no column added, no migration.
**Testing**: `@substrate-system/tapzero` browser DOM tests
(`test/item-row.ts`), `npm test`
**Target Platform**: Modern browsers (signed-in home page / feed-reader
route)
**Project Type**: Web (Cloudflare Worker + Durable Object backend +
Preact client). This feature touches the **client only**.
**Performance Goals**: No measurable render regression; one extra text
node per row, no new network calls, no new decode/layout work.
**Constraints**: No horizontal overflow at standard desktop/mobile
widths (FR-005); URL omitted entirely when absent (FR-004); font-size
>= 1rem (global CSS rule); colors from `_variables.css` only.
**Scale/Scope**: Single component (`item-row.ts`) + its CSS, exercised
by the existing `test/item-row.ts` suite.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- **I. Local-First Reads** — PASS. No new read is introduced. The URL
  is `Item.link`, already loaded by `loadItems()` through whichever
  adapter is active. Renders identically online and offline because it
  reads only already-materialized item state.
- **II. Idempotent, Outbox-Backed Sync** — PASS / N/A. No mutation, no
  outbox entry, no `/api/sync` change. Critically, this is **not** a
  "schema change that adds a column the client renders": `link` is an
  existing column already in the DO schema, the sync payload,
  `bootstrapLocalDb`, the local schema, and `pullSync`. The coupled-
  change rule does not trigger.
- **III. Edge-Native Topology** — PASS / N/A. No server, Worker, or
  Durable Object code is touched.
- **IV. Capability-Gated Progressive Enhancement** — PASS. The row
  renders from `item` state regardless of which adapter
  (`localAdapter` vs `remoteAdapter`) produced it, so the feature works
  in both local-first and fallback modes with no branching.
- **V. Bluesky-Anchored Identity** — PASS / N/A. No auth surface.

**TypeScript / CSS standards**: 80-column lines, no space after the
type-annotation colon, ternary line breaks, nested CSS selectors,
colors from `_variables.css`, font-size >= 1rem — all honored (see
research.md decisions). No unrelated CSS is modified.

**Result**: No violations. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/030-article-source-url/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── checklists/          # Pre-existing
└── tasks.md             # Phase 2 output (/speckit.tasks - NOT this command)
```

Note: no `contracts/` directory. This feature exposes no new external
interface (no endpoint, no public API, no CLI). The only "contract" is
the existing in-process `Item` shape, documented in data-model.md.

### Source Code (repository root)

```text
src/client/
├── components/
│   ├── item-row.ts       # CHANGE: render .item-url inside .item-meta
│   └── item-row.css      # CHANGE: .item-url truncation + muted color
├── routes/
│   ├── feed-reader.ts    # (unchanged) renders <ItemRow> in items-list
│   └── feed-reader.css   # (unchanged) .item-meta is column-reverse flex
└── db/
    └── types.ts          # (unchanged) Item.link already exists

test/
└── item-row.ts           # CHANGE: add cases for URL present / absent
```

**Structure Decision**: Web app with a Preact client under `src/client`.
The article list is rendered by `ItemRow`
(`src/client/components/item-row.ts`), used only in the signed-in
feed-reader route (`src/client/routes/feed-reader.ts`,
`<div class="route feed-reader">`). The change is isolated to that
component and its stylesheet; the route file and data layer are
untouched.

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.
