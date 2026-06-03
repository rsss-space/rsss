# Quickstart: Verify Animated Cache Settings Disclosure

**Feature**: 031-animate-cache-settings

This feature is a client-only UI motion change. Per the constitution's
Local-verification gate, UI changes MUST be exercised in a real browser —
type-check and tests alone are not sufficient evidence.

## Prerequisites

- Logged in (Bluesky OAuth) with at least one subscribed feed.
- Local-first caching active (so the disclosure is enabled). If the
  disclosure is greyed/disabled, enable local storage / caching first on
  the Settings page.

## Run the app

```sh
npm start
```

Open the app, then navigate to **Settings** and scroll to the
**Subscribed Feeds** section.

## Automated checks

```sh
npm test        # includes test/settings-route.ts (DOM assertions)
npm run lint
```

Both must pass.

## Manual verification (the part that matters)

### 1. Open animates smoothly (P1 — FR-001, FR-003, FR-005; SC-001/3)

1. On a feed card, click **Cache settings**.
2. Confirm the panel **grows open over a short, smooth height
   transition** (~200 ms) — no instant jump, no flicker, no overshoot of
   the content below.
3. When it finishes, all controls (Cache mode, Max size, Keep for, Clear
   cache) are fully visible and immediately usable.

Tip: in DevTools, throttle nothing but watch the Performance/Rendering
panel — the transition should hold a steady frame rate.

### 2. Close animates smoothly (P2 — FR-002)

1. Click **Cache settings** again on the open panel.
2. Confirm it **shrinks closed** with the mirrored motion; only the
   summary row remains and the card returns to its collapsed height.

### 3. Reduced motion toggles instantly (P3 — FR-006, SC-004)

1. Enable the OS "Reduce motion" setting (macOS: System Settings →
   Accessibility → Display → Reduce motion). Or emulate in DevTools:
   Rendering → "Emulate CSS prefers-reduced-motion: reduce".
2. Open and close the disclosure.
3. Confirm it appears/disappears **instantly with no animation**, and the
   controls are fully usable (identical end state to the animated case).

### 4. Rapid toggling resolves cleanly (FR-008, SC-005)

1. Click **Cache settings** several times quickly (open/close/open…).
2. Confirm the panel ends in the state matching your **last** click — no
   stuck half-open state, no clipped content, no flicker.

### 5. Independence (FR-009)

1. With two or more feeds, open one feed's **Cache settings**.
2. Confirm **no other feed's** disclosure animates, shifts, or
   re-renders.

### 6. Keyboard / a11y (FR-007)

1. Tab to a feed's **Cache settings** summary and press **Enter** (or
   **Space**).
2. Confirm the same smooth animation runs and the expanded/collapsed
   state is announced correctly (the visually-hidden label flips between
   "expand" and "collapse").

### 7. Disabled disclosure (edge case)

1. Make caching unavailable (turn off local storage / caching) so the
   Subscribed-Feeds section is greyed.
2. Confirm clicking a greyed **Cache settings** summary does **nothing** —
   no animation, no expansion — and it stays collapsed.
3. If a panel was open when you disabled caching, confirm it collapses.

## Pass criteria

All seven scenarios behave as described, `npm test` and `npm run lint`
pass, and the set of cache controls / their values / behavior are
unchanged from before (FR-010, SC-006).
