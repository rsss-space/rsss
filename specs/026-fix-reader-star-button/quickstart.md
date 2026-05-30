# Quickstart: Verify the Reader Star Button Appearance

This feature is verified visually and by interaction. Type-check and tests
alone are not sufficient evidence (constitution: "Local verification").

## Prerequisites

- `npm start` runs cleanly.
- You are signed in and have at least one feed with at least one article.

## Steps

1. Start the app: `npm start`.
2. Open the home feed list. Note the star control on a feed item row: it is a
   plain, borderless icon. Hover it — the icon changes to the accent color.
   Toggle it — starred shows a filled accent glyph; unstarred shows an
   outline glyph. This is the reference behavior.
3. Open an individual article (the feed item / reader route).
4. Locate the star control in the reader's action area.

## Acceptance checks (map to spec)

- SC-001 / FR-001: At rest, the reader star shows **no** border, box, or
  button background — just an icon.
- SC-002 / FR-002: Hovering the reader star changes its color to the accent
  color, matching the home-row star's hover.
- FR-003: Activating the star fills the glyph and applies the accent color;
  activating again returns it to the outline, unstarred look.
- SC-003 / FR-004: Place the home feed list and the reader side by side; the
  two star controls show no perceptible difference in resting, hover, and
  starred treatment.
- SC-004 / FR-005: Tab to the reader star with the keyboard — it receives a
  visible focus indicator and can be activated with Enter/Space; the starred
  state still toggles.
- FR-006: The star still exposes an accessible name / hover label conveying
  its star/unstar purpose (check the tooltip and the accessibility tree).
- FR-007: The adjacent "Mark read" / "Mark unread" button is unchanged and
  keeps its boxed-button appearance; the rest of the reader header is
  unchanged.

## Regression checks

- No layout shift in the reader header when the star changes between
  unstarred and starred.
- Starring from the reader still reflects on the home feed list (and vice
  versa) after navigating between them — behavior is unchanged.
- Lint passes (`npm run lint`) and the build is clean.
