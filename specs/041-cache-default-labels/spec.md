# Feature Specification: Show concrete default in per-feed cache labels

**Feature Branch**: `041-cache-default-labels`  
**Created**: 2026-06-15  
**Status**: Draft  
**Input**: User description: "The per-feed cache settings -- should not say
\"blank = default\", should say \"default, <x days>\""

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See the actual default I'll get if I leave a field blank (Priority: P1)

A reader opens the cache settings for one of their feeds. The per-feed
"Max size" and "Keep for" fields are optional — leaving them blank makes the
feed fall back to the account-wide default. Today the field hints read
"blank = default", which tells the reader *that* a default exists but not
*what it is*. The reader wants to know the concrete value they will get
(for example, "30 days") without leaving the panel to go hunt for it in the
account-level cache settings.

**Why this priority**: This is the entire feature. The hint text is the only
thing changing, and it directly answers the reader's question ("how long will
this feed be kept / how big can it get if I do nothing?") at the point of
decision.

**Independent Test**: Open a feed's cache settings while the per-feed fields
are blank and confirm the field hints state the concrete current default
value and unit (e.g. "default, 30 days" and "default, 50 MB") rather than the
generic phrase "blank = default".

**Acceptance Scenarios**:

1. **Given** a feed whose per-feed cache fields are blank and the account
   retention default is 30 days, **When** the reader opens that feed's cache
   settings, **Then** the "Keep for" field hint communicates the concrete
   default of 30 days (not "blank = default").
2. **Given** a feed whose per-feed cache fields are blank and the account
   max-size default is 50 MB, **When** the reader opens that feed's cache
   settings, **Then** the "Max size" field hint communicates the concrete
   default of 50 MB (not "blank = default").
3. **Given** a feed whose per-feed cache fields already hold explicit
   overrides, **When** the reader opens that feed's cache settings, **Then**
   the field hints still communicate the account default value (the hint
   describes the fallback, independent of the current entered value).

---

### User Story 2 - The shown default reflects my account-level setting (Priority: P2)

A reader has changed their account-wide cache defaults (for example, set
retention to 14 days instead of the built-in 30). When they look at a feed's
per-feed cache fields, the default shown in the hint matches the value they
chose, so the hint is never stale or misleading.

**Why this priority**: Without this, the hint could display a hardcoded value
that contradicts the reader's own account settings, which is worse than the
vague "blank = default" it replaces. It is P2 because it only matters for
readers who have customized their account defaults.

**Independent Test**: Change the account-level cache default, return to a
feed's cache settings, and confirm the per-feed field hint shows the updated
default value.

**Acceptance Scenarios**:

1. **Given** the account retention default is changed from 30 to 14 days,
   **When** the reader views a feed's per-feed cache settings, **Then** the
   "Keep for" hint reflects 14 days.
2. **Given** the account max-size default is changed to 200 MB, **When** the
   reader views a feed's per-feed cache settings, **Then** the "Max size"
   hint reflects 200 MB.

---

### Edge Cases

- **Non-whole default values**: account defaults are stored in finer units
  (bytes / seconds) than the labels display (MB / days). The hint MUST show a
  human-friendly whole-number value consistent with how the account-level
  editor already renders the same setting, so the per-feed hint and the
  account editor never disagree.
- **Singular vs plural unit**: a default of 1 day / 1 MB should read
  naturally; the wording must not produce an obviously broken string. (A
  fixed unit label such as "days"/"MB" is acceptable — see Assumptions.)
- **Default unavailable at render time**: if the current default value cannot
  be determined when the panel renders, the hint MUST degrade to a safe,
  non-misleading form rather than show a blank, "NaN", or "undefined" value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The per-feed cache "Max size" field hint MUST display the
  concrete current default size and its unit instead of the phrase
  "blank = default".
- **FR-002**: The per-feed cache "Keep for" field hint MUST display the
  concrete current default retention and its unit instead of the phrase
  "blank = default".
- **FR-003**: The default value shown in each hint MUST be the same value the
  feed actually falls back to when its corresponding field is left blank
  (i.e. the current account-level default), not an unrelated or hardcoded
  constant.
- **FR-004**: The displayed default MUST reflect the reader's current
  account-level default settings; if those settings change, a subsequently
  rendered per-feed hint MUST show the updated value.
- **FR-005**: The hint MUST continue to convey that leaving the field blank
  applies the default (the change replaces *how* the default is described,
  not the fact that blank means default).
- **FR-006**: The default values MUST be presented in the same units already
  used by the field (megabytes for size, days for retention) and rounded the
  same way the account-level cache editor rounds them.
- **FR-007**: The change MUST apply to every place the per-feed cache "Max
  size" / "Keep for" fields are shown, so the wording is consistent across
  the application.
- **FR-008**: Apart from the hint wording, the per-feed cache fields MUST
  retain their existing behavior (a blank field still means "use default", an
  entered value still overrides the default).

### Key Entities *(include if feature involves data)*

- **Account-level cache default**: the reader's configured fallback for cache
  size and retention. Already exists and is editable elsewhere; this feature
  only *reads* it to display in the per-feed hint. Key attributes: default max
  size (shown in MB) and default retention (shown in days).
- **Per-feed cache field**: an optional per-feed override for size or
  retention. A blank field inherits the account-level default; this feature
  changes only the descriptive hint shown beside it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A reader can determine the concrete default cache retention and
  size for a feed directly from the per-feed cache panel, without navigating
  to any other screen.
- **SC-002**: The phrase "blank = default" no longer appears in the per-feed
  cache size or retention field hints anywhere in the application.
- **SC-003**: The default value shown in the per-feed hint matches the value
  displayed in the account-level cache settings editor for the same setting
  100% of the time, including after the reader changes that account default.
- **SC-004**: No change in the behavior of saving, clearing, or overriding a
  per-feed cache value (existing flows continue to pass).

## Assumptions

- **Wording format**: the hint follows the form the user gave — "default,
  <value> <unit>" (e.g. "Keep for (default, 30 days)" and "Max size
  (default, 50 MB)"). The exact punctuation/casing is an implementation
  detail and may be adjusted for readability so long as it states the word
  "default" and the concrete value with its unit.
- **Unit label is fixed (not pluralized)**: the unit text ("days", "MB") is
  shown as-is regardless of whether the value is 1 or many. Building a
  grammatically pluralized string is out of scope.
- **"Default" means the account-level default**, which is the existing
  fallback when a per-feed field is blank. The built-in starting values are
  50 MB for size and 30 days for retention, but the displayed value tracks
  whatever the reader has currently configured.
- **Scope is the per-feed cache panel only.** The account-level cache settings
  editor (where the defaults themselves are entered) is unchanged — its
  inputs already show concrete numeric values and never carried the
  "blank = default" hint.
- **The "Cache mode" select ("Use default") is out of scope.** Only the two
  numeric field hints that read "blank = default" are affected.
- **The input placeholder text is out of scope** unless trivially consistent;
  this feature targets the field hint/label wording specifically.
