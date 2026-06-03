---
description: "Task list for Show Article Source URL"
---

# Tasks: Show Article Source URL

**Input**: Design documents from `/specs/030-article-source-url/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md,
quickstart.md

**Tests**: INCLUDED. The plan (research Decision 7) and quickstart
explicitly request extending `test/item-row.ts` with present/absent
cases, so test tasks are generated and ordered before implementation
(TDD) within each story.

**Organization**: Tasks are grouped by user story. This is a
client-only UI change confined to three files
(`src/client/components/item-row.ts`,
`src/client/components/item-row.css`, `test/item-row.ts`). There is no
new entity, schema, migration, server, or sync work (see data-model.md
"Schema / sync impact: None"), so there is **no Foundational phase**.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2)
- Exact file paths are included in each description

## Path Conventions

This is a Web app (Cloudflare Worker + Durable Object backend + Preact
client). This feature touches the **client only**. Paths are repo-root
relative: `src/client/...` for source, `test/...` for tests.

---

## Phase 1: Setup (Shared)

**Purpose**: Establish a green baseline before changing anything. No
project initialization is required (existing project, existing branch
`030-article-source-url`).

- [ ] T001 Run `npm test` to confirm the existing `test/item-row.ts`
  suite passes before any change, establishing a baseline to compare
  against.

**Checkpoint**: Baseline green — implementation can begin.

---

## Phase 2: User Story 1 - Identify where each article comes from (Priority: P1) 🎯 MVP

**Goal**: On the signed-in home-page list, each item with a link shows
its full post URL (`item.link`) as a plain, non-interactive line
beneath the feed title in the item's meta area, constrained so long
URLs never overflow the list horizontally.

**Independent Test**: Render the home-page list with articles from at
least two different sites; confirm each item displays its full post URL
beneath the feed title and the host is visible (per
spec Acceptance Scenarios 1-3).

### Tests for User Story 1 (write first, must FAIL before T003) ⚠️

- [ ] T002 [P] [US1] In `test/item-row.ts`, add a "URL present" case:
  render an `ItemRow` whose `item.link` is a non-empty URL (e.g.
  `https://example.com/a/b`), assert `root.querySelector('.item-url')`
  exists and its `textContent` reflects `item.link`. Keep the assertion
  structural (presence + bound value); do not assert layout geometry or
  static copy. Run it and confirm it FAILS.

### Implementation for User Story 1

- [ ] T003 [US1] In `src/client/components/item-row.ts`, near the other
  derived fields (around `const imageUrl = item.og_image_url?.trim()`),
  compute `const sourceUrl = item.link?.trim()`. Inside the
  `.item-meta` block, render `<span class="item-url" title=${sourceUrl}>
  ${sourceUrl}</span>` guarded by `sourceUrl &&`, placed as the FIRST
  child of `.item-meta` (before `.item-feed`) so the existing
  `column-reverse` layout renders it beneath the feed title (research
  Decision 5). This makes T002 pass.
- [ ] T004 [P] [US1] In `src/client/components/item-row.css`, inside the
  existing `.item-row { ... }` nested block near `.item-meta`, add an
  `& .item-url` rule: `color: var(--color-muted); max-width: 100%;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;`
  (research Decisions 4 & 6). Use only existing variables; do not change
  any unrelated selector. Font-size is inherited (>= 1rem).

**Checkpoint**: Items with a link show their full URL beneath the feed
title, truncated with an ellipsis and never overflowing horizontally.
User Story 1 is fully functional and shippable as the MVP.

---

## Phase 3: User Story 2 - Items without a usable link stay clean (Priority: P2)

**Goal**: An item with no usable link (null, empty, or whitespace-only)
renders no `.item-url` line and no empty placeholder, so the list stays
visually consistent whether or not an item has a link.

**Independent Test**: Render the list with at least one item whose
`link` is `null` and confirm no `.item-url` element (and no blank line)
appears for it, while linked items still show their URL.

### Tests for User Story 2 (write first) ⚠️

- [ ] T005 [P] [US2] In `test/item-row.ts`, add a "URL absent" case:
  render an `ItemRow` whose `item.link` is `null`, assert
  `root.querySelector('.item-url')` is `null` (FR-004 — no placeholder).
  Optionally add a whitespace-only case (`link: '   '`) asserting the
  same omission. Run it.

### Implementation for User Story 2

- [ ] T006 [US2] In `src/client/components/item-row.ts`, ensure the
  `.item-meta` guard uses the trimmed value (`item.link?.trim()` from
  T003) so that `null`, empty, and whitespace-only links all omit the
  `.item-url` element entirely — mirroring how `imageUrl` already guards
  the thumbnail. If T003 already used the trimmed guard, this task is a
  verification that T005 passes with no additional production code.

**Checkpoint**: Items with and without links both render cleanly; the
list reads uniformly with no empty URL lines. User Stories 1 and 2 both
work independently.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Final quality pass and manual verification.

- [ ] T007 Run `npm run lint` and fix any violations in the changed
  files (80-column lines, no space after the annotation colon, ternary
  line breaks, nested CSS selectors).
- [ ] T008 Manual in-browser verification per `quickstart.md`: `npm
  start`, sign in, open the home page with articles from at least two
  sites; confirm the URL shows beneath "culture latest" with the host
  visible (FR-001/FR-002/SC-001), a no-link item shows no URL line and
  no gap (FR-004/US2), a very long URL truncates with an ellipsis and
  the list does not scroll horizontally at desktop and mobile widths
  (FR-005/SC-003), and two items sharing a feed title are
  distinguishable by their URLs (US1 scenario 3 / SC-004).
- [ ] T009 Run `npm test && npm run lint` to confirm the full suite and
  linter are green before considering the feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **User Story 1 (Phase 2)**: Depends on Setup baseline.
- **User Story 2 (Phase 3)**: Logically builds on the same guard
  introduced in US1 (T003), but is independently testable. If staffed
  separately, US2's guard hardening (T006) can be written directly.
- **Polish (Phase 4)**: Depends on the desired user stories being
  complete.

### User Story Dependencies

- **User Story 1 (P1)**: The MVP. Delivers the entire reported value on
  its own — no dependency on US2.
- **User Story 2 (P2)**: Protects US1's quality by guaranteeing clean
  omission. Shares the single render guard in `item-row.ts`; verified by
  its own absent-case test.

### Within Each User Story

- The test (T002 for US1, T005 for US2) is written first and must fail
  before the implementation task makes it pass.
- T003 (markup) and T004 (CSS) are different files — T004 is `[P]`
  relative to T003. The jsdom test (T002) depends only on T003.

### Parallel Opportunities

- T002 (US1 test) and T005 (US2 test) edit the same file
  (`test/item-row.ts`); treat as sequential if one engineer, or
  coordinate edits if split. They are marked `[P]` only in the sense of
  being independent in intent.
- T004 (`item-row.css`) is `[P]` with T003 (`item-row.ts`) — different
  files, no shared state.

---

## Parallel Example: User Story 1

```bash
# After T002 fails, implement markup and CSS in parallel (diff files):
Task: "Render .item-url span in src/client/components/item-row.ts"
Task: "Add .item-url truncation rule in src/client/components/item-row.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: confirm baseline (T001).
2. Phase 2: write the present-case test (T002 → fails), add the markup
   (T003), add the CSS (T004).
3. **STOP and VALIDATE**: linked items show their URL beneath the feed
   title, truncated and non-overflowing. This alone resolves the
   reported problem — ship it.

### Incremental Delivery

1. US1 → test independently → demo (MVP).
2. US2 → absent-case test + guard verification → demo. The list now
   stays clean for link-less items.
3. Polish: lint, in-browser verification, full green run.

---

## Notes

- `[P]` tasks = different files, no dependencies.
- `[Story]` label maps each task to its user story for traceability.
- No schema, migration, server, or `/api/sync` change (data-model.md):
  the feature renders the pre-existing `Item.link` field.
- Keep tests structural (presence/absence + bound value) — do not assert
  static copy or layout geometry (no brittle tests).
- Visual ordering from `column-reverse` is a CSS concern verified
  in-browser (T008), not in jsdom where layout does not run.
