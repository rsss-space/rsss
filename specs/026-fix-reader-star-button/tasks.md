---
description: "Task list for Fix Reader Star Button Appearance"
---

# Tasks: Fix Reader Star Button Appearance

**Input**: Design documents from `/specs/026-fix-reader-star-button/`
**Prerequisites**: plan.md (required), spec.md (required), research.md,
data-model.md, quickstart.md

**Tests**: No automated test tasks. This is an appearance-only change with
no new logic or interface; the spec and `quickstart.md` specify visual and
interaction verification, and project rules forbid brittle HTML-content
tests. Verification is a lint/build pass plus the manual `quickstart.md`
checklist.

**Organization**: Tasks are grouped by user story. This feature has a single
user story (US1, P1), which is the entire scope.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1)
- Include exact file paths in descriptions

## Path Conventions

Web application. Client code under `src/client/`. This change is client-only;
no backend, shared, or service-worker code is touched.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Ground the change against the canonical home-row star so the
reader star mirrors it exactly.

- [ ] T001 Read the reference star in `src/client/components/item-row.ts`
  (markup at lines ~188-199) and `src/client/components/item-row.css`
  (`.btn-star` at lines ~88-104) to confirm the exact class (`btn-star`),
  accessible-name span (`<span class="visually-hidden">star</span>`), glyphs
  (`★` filled / `☆` outline), `title` (`Star`/`Unstar`), and accent
  variable (`--color-accent`) to mirror. No file edits in this task.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that must exist before user-story work.

No foundational tasks. The shared `.btn-star` class is already defined in
`src/client/components/item-row.css` and bundled app-wide by Vite (the feed
list that imports it is always part of the app), so it is available on the
reader route with no new import, file, schema, or infrastructure work.

**Checkpoint**: Foundation ready — user story implementation can begin.

---

## Phase 3: User Story 1 - Star an article from the reader (Priority: P1) 🎯 MVP

**Goal**: Make the star control on the feed item (reader) route render as a
plain, borderless icon that turns the accent color on hover and shows a
filled accent glyph when starred — visually identical to the home feed list
star — while remaining keyboard-focusable with a visible focus ring and an
accessible name.

**Independent Test**: Open any article on the feed item route and observe the
star: borderless at rest, accent color on hover, filled+accent when starred,
focusable by keyboard with a visible ring, and visually indistinguishable
from the home-row star shown side by side.

### Implementation for User Story 1

- [ ] T002 [US1] Update the star button in
  `src/client/routes/item-reader.ts` (lines ~121-131): change its class from
  `btn btn-icon ${isStarred ? 'starred' : ''}` to
  `btn-star ${isStarred ? 'starred' : ''}`, and add an accessible-name span
  `<span class="visually-hidden">star</span>` after the glyph (mirroring
  `src/client/components/item-row.ts` lines ~195-198). Leave `onClick`
  (`handleStar`) and the `title` (`Unstar`/`Star`) unchanged. Keep lines
  <= 80 columns and the existing TS/markup style.
- [ ] T003 [P] [US1] Remove the now-redundant nested rule
  `& .starred { color: var(--color-accent); }` under `.reader-actions` in
  `src/client/routes/item-reader.css` (lines ~34-36); the shared
  `.btn-star.starred` rule now governs the starred accent color. Leave the
  rest of `.reader-actions` (`display`, `gap`, `align-items`) and all other
  reader CSS untouched (FR-007).

**Checkpoint**: The reader star is borderless, hover-accent, and
filled+accent when starred, matching the home-row star. US1 is fully
functional and independently testable.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Verify the change is correct and introduces no regression.

- [ ] T004 Run `npm run lint` and the build/type-check (`npm test`); fix any
  issues introduced by the edits in T002-T003.
- [ ] T005 Manually verify against `quickstart.md`: at rest the reader star
  has no border/box/background (SC-001/FR-001); hover turns it the accent
  color (SC-002/FR-002); toggling fills/unfills the glyph with the accent
  color (FR-003); it is keyboard-focusable with a visible focus ring and
  toggles via Enter/Space (SC-004/FR-005); it retains its accessible name /
  `title` (FR-006); the adjacent "Mark read"/"Mark unread" button and the
  rest of the reader header are unchanged (FR-007); no layout shift when
  toggling; and side-by-side with the home-row star there is no perceptible
  difference (SC-003/FR-004).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: None (no blocking work).
- **User Story 1 (Phase 3)**: Depends only on T001 grounding.
- **Polish (Phase 4)**: Depends on US1 implementation being complete.

### Within User Story 1

- T002 (TS markup) and T003 (CSS) touch different files and have no ordering
  dependency on each other; T003 is marked [P].

### Parallel Opportunities

- T002 and T003 can run in parallel (different files).

---

## Parallel Example: User Story 1

```bash
# Launch the two US1 edits together (different files):
Task: "Swap reader star classes to btn-star + add label span in
       src/client/routes/item-reader.ts"
Task: "Remove redundant .reader-actions .starred rule in
       src/client/routes/item-reader.css"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: Setup (T001 grounding).
2. Phase 3: User Story 1 (T002-T003) — the entire feature.
3. Phase 4: Polish (T004-T005) — lint/build + manual quickstart verification.
4. **STOP and VALIDATE**: Confirm the reader star matches the home-row star
   side by side; deploy/demo if ready.

User Story 1 is the complete scope; there is no incremental or parallel
multi-story delivery for this feature.

---

## Notes

- [P] tasks = different files, no dependencies.
- [Story] label maps each implementation task to US1 for traceability.
- Reuse the existing `--color-accent` variable and shared `.btn-star` class;
  introduce no new color and modify no unrelated CSS (constitution + global
  rules).
- Lint/build alone is insufficient evidence — the manual quickstart check
  (T005) is required before claiming complete.
