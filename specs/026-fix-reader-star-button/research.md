# Phase 0 Research: Fix Reader Star Button Appearance

The spec contains no `NEEDS CLARIFICATION` markers; it is an appearance-only
fix with explicit assumptions. Research therefore focuses on the small set
of implementation decisions needed to make the reader star match the
home-row star without touching unrelated styling.

## Decision 1: Mirror the home-row star treatment (do not redesign)

- **Decision**: Treat the home feed list star (`item-row.ts` /
  `item-row.css`) as the canonical, correct design and bring the reader
  route's star (`item-reader.ts` / `item-reader.css`) to match it: a plain,
  borderless icon with no box/border/button background at rest; accent color
  on hover; filled glyph + accent color when starred; outline glyph when
  unstarred.
- **Rationale**: The spec names the home-row star as the reference (FR-004,
  SC-003) and explicitly scopes this as making the reader match it rather
  than designing something new. Matching an existing, approved control is
  lower-risk and guarantees cross-route consistency.
- **Alternatives considered**: (a) Design a new borderless star style just
  for the reader — rejected: risks drift from the home-row star and
  re-introduces the inconsistency the spec is fixing. (b) Make the home-row
  star match the reader's boxed style — rejected: the spec declares the
  boxed reader style the defect, not the target.

## Decision 2: Reuse the existing accent color variable

- **Decision**: Use the same CSS variable the home-row star already uses for
  its hover and starred (accent) color. Do not introduce a new color.
- **Rationale**: Constitution and global CSS rules require colors to come
  from existing `_variables.css` / `_vars.css` variables and to reuse
  existing colors before adding new ones. SC-002/SC-003 require the hover and
  starred coloring to be visually identical to the home route, which is only
  guaranteed by using the same variable.
- **Implementation note**: Confirm the exact variable name by reading the
  home-row star rules in `src/client/components/item-row.css` before editing;
  apply that same variable in the reader star rules.

## Decision 3: Reuse the existing shared `.btn-star` class

- **Decision**: Apply the home row's `.btn-star` class to the reader star
  (replacing its current `btn btn-icon` classes). `.btn-star` is defined in
  `src/client/components/item-row.css` and is already bundled app-wide (Vite
  combines all module-imported CSS into one global stylesheet, and the feed
  list that imports `item-row.css` is always part of the app), so the class
  is available on the reader route with no new import. A single rule then
  governs both stars, guaranteeing identical resting/hover/starred treatment.
- **Rationale**: The constitution prefers reuse and avoiding class
  proliferation, and forbids touching unrelated CSS. Reusing the existing
  global class is the minimal diff and structurally guarantees SC-003
  (no perceptible difference) because both controls share one definition.
- **Alternatives considered**: (a) Replicating the `.btn-star` rules into a
  reader-scoped selector — rejected: duplicates a definition and invites
  future drift. (b) Extracting a shared `<StarButton>` Preact component or
  promoting `.btn-star` into a dedicated shared stylesheet — reasonable
  cleanliness follow-ups, but larger than this appearance fix needs; noted as
  optional future work.

## Decision 4: Keep a real, focusable, labeled control

- **Decision**: Keep the star as an interactive element with an accessible
  name and a visible focus indicator. Removing the resting box must not
  remove the focus ring or the accessible name; only the resting-state
  border/box/background is removed.
- **Rationale**: FR-005 and FR-006 require keyboard focus/activation with
  visible focus and a retained accessible name/hover label. Edge cases in the
  spec call this out explicitly. Borderless does not mean unfocusable.
- **Implementation note**: Mirror whatever focusable element and
  `aria-label`/title the home-row star uses. Ensure `:focus-visible` (or the
  project's existing focus convention) still produces a visible ring on the
  reader star.

## Decision 5: Do not touch the adjacent read/unread control

- **Decision**: The "Mark read" / "Mark unread" button on the reader keeps
  its existing boxed-button appearance. Only the star control's selectors
  change.
- **Rationale**: FR-007 and the spec's Edge Cases scope the change to the
  star alone; the two controls becoming visually distinct is the intended
  outcome, not a regression.

## Resolved against source

The open items have been confirmed by reading the source:

- **Accent variable**: `--color-accent` (`#f59e0b`), defined in
  `src/client/_variables.css`. The home-row star uses it for both `:hover`
  and `.starred`; the reader will reuse it via `.btn-star`.
- **Home-row star markup** (`item-row.ts`): a `<button class="btn-star
  ${starred ? 'starred' : ''}">` containing the glyph (`★` filled /
  `☆` outline), a `<span class="visually-hidden">star</span>`, and a
  `title` of `Star`/`Unstar`. `.btn-star` (item-row.css):
  `border:none; background:none; padding:0; font-size:1.25rem;
  color:var(--color-text-secondary)`, with `:hover` and `.starred` ->
  `var(--color-accent)`.
- **Reader star defect** (`item-reader.ts`): `<button class="btn btn-icon
  ${starred ? 'starred' : ''}">` — the `btn`/`btn-icon` classes apply the
  boxed treatment; `item-reader.css` adds only `& .reader-actions .starred {
  color: var(--color-accent) }` (no hover change). Swapping the classes to
  `btn-star` removes the box and adds the hover behavior; the redundant
  `.starred` rule under `.reader-actions` is then removed.
- **Focus indicator** (FR-005): a global `button` focus style
  (`outline: 2px solid var(--color-primary)` in `style.css`) already applies
  and is preserved by the class swap — `.btn-star` adds no focus override.
- **Adjacent read/unread button**: `<button class="btn btn-small">`, a
  different class set, so it is unaffected by the star change (FR-007).

None of these change the approach above.
