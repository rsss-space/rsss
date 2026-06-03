# Feature Specification: Show Article Source URL

**Feature Branch**: `030-article-source-url`  
**Created**: 2026-06-02  
**Status**: Draft  
**Input**: User description: "On the home page for signed in users, it shows every article, but it is not clear what domain each item comes from. It says 'culture latest'. It should have the full URL for the post underneath the 'culture latest'"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Identify where each article comes from (Priority: P1)

A signed-in reader scrolling the home-page list of articles wants to know
the source of each item at a glance. Today each item shows only the feed's
title (for example, "culture latest"), which does not reveal which site or
domain the article actually comes from. The reader should be able to see the
article's full URL displayed directly beneath the feed title, so the domain
and origin of every item are immediately clear without opening it.

**Why this priority**: This is the entire point of the request. Without it,
readers cannot distinguish sources — especially when several feeds carry
generic titles like "latest" — which undermines trust and makes scanning the
list confusing. Delivering this single change resolves the reported problem
and is a complete, shippable improvement on its own.

**Independent Test**: Sign in, open the home page with a list of articles
from at least two different sites, and confirm each item displays its full
post URL beneath the feed title. Fully testable in isolation and delivers the
core value (knowing each item's source).

**Acceptance Scenarios**:

1. **Given** a signed-in reader on the home page with a list of articles,
   **When** the list renders, **Then** each article shows its full post URL
   directly beneath the feed title.
2. **Given** an article from "culture latest" linking to a specific site,
   **When** the reader looks at that item, **Then** the displayed URL reveals
   the article's domain (for example, the host portion is visibly present in
   the URL).
3. **Given** two articles whose feed titles are identical or generic,
   **When** the reader compares them, **Then** their differing source URLs
   let the reader tell the two sources apart.

---

### User Story 2 - Items without a usable link stay clean (Priority: P2)

Some articles arrive without an associated link. A reader should never see a
blank line, a broken value, or placeholder text where a URL would be. The
list should remain visually consistent whether or not an item has a link.

**Why this priority**: Protects the quality of the primary feature. It is not
required to demonstrate the core value, but without it a subset of items
would look broken once URLs are introduced.

**Independent Test**: View the home page containing at least one article that
has no link and confirm that item renders cleanly with no empty URL line,
while items that do have links still show them.

**Acceptance Scenarios**:

1. **Given** an article with no link, **When** the list renders, **Then** no
   URL line (and no empty placeholder) appears for that item.
2. **Given** a mix of articles with and without links, **When** the list
   renders, **Then** items with links show their URL and items without one do
   not, with no layout disruption between them.

---

### Edge Cases

- **Article has no link**: The URL line is omitted entirely; no blank space,
  dash, or placeholder is shown.
- **Very long URL**: The URL must not break the list layout or push content
  off-screen; it is constrained (e.g. truncated or wrapped) while remaining
  readable.
- **Multiple items from the same feed/domain**: Each item still shows its own
  post URL; the display does not deduplicate or hide repeated sources.
- **URL containing query parameters or tracking tokens**: The stored post URL
  is shown as-is; no rewriting or cleansing is assumed in this feature.
- **Generic feed title (e.g. "latest")**: The URL provides the disambiguation
  the feed title cannot.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The home-page article list (for signed-in readers) MUST display
  each article's full post URL beneath the feed title for that item.
- **FR-002**: The displayed value MUST be the article's own post URL (the
  link the item points to), which inherently contains its domain — not a
  generic site label.
- **FR-003**: The URL MUST be clearly associated with its item and visually
  subordinate to the article title, placed in the item's metadata area near
  the feed title.
- **FR-004**: When an article has no link, the system MUST omit the URL line
  rather than render an empty value or placeholder.
- **FR-005**: The URL display MUST NOT break the list layout; long URLs MUST
  be constrained so the list does not overflow horizontally at standard
  viewport widths.
- **FR-006**: The URL MUST be shown consistently for every item that has a
  link, so the list reads uniformly.

### Key Entities *(include if feature involves data)*

- **Article (feed item)**: A single entry in the home-page list. Relevant
  attributes for this feature: title, feed title (the "culture latest" text),
  publication date, and the post's own URL/link.
- **Feed**: The source a group of articles belongs to. Provides the feed
  title shown on each item; not changed by this feature.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A signed-in reader can identify the source domain of any listed
  article without opening it, at a glance (within ~2 seconds).
- **SC-002**: 100% of listed articles that have a link display that link's
  full URL beneath the feed title.
- **SC-003**: Introducing the URL adds no horizontal scrolling to the list at
  standard desktop and mobile viewport widths.
- **SC-004**: When two listed items share the same feed title, a reader can
  correctly distinguish their sources using only the displayed URLs.

## Assumptions

- "Full URL for the post" is interpreted as the article's own link displayed
  in full (which reveals the domain), rather than only the bare domain/host.
  If a shorter domain-only treatment is preferred, that can be refined during
  clarification.
- The URL is shown as plain, non-interactive text. Visiting the original
  article continues to be handled by the existing per-item action; this
  feature does not add a new clickable link (avoiding nested links inside the
  item row).
- When an article has no link, the URL line is simply omitted. Falling back
  to the parent feed's site URL is out of scope for this iteration.
- Scope is limited to the signed-in home-page article list. The reader view
  and any other lists are unchanged.
- Exact visual treatment of long URLs (truncation vs. wrapping, ellipsis
  style) is an implementation detail, provided the layout-safety requirement
  (FR-005) is met.
