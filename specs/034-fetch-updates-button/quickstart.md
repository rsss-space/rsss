# Quickstart: Fetch Updates Button

## What you are building

A "fetch updates" button next to the header "N updates" indicator. It is a
second entry point to the existing `State.refreshFeeds` action — no new
fetch logic, state, or server change.

## Files to touch

- `src/client/components/feed-status.ts` — render the button in the
  `'updates'` branch.
- `src/client/components/feed-status.css` — layout + responsive hide.
- `test/feed-status.ts` (and optionally a new
  `test/fetch-updates-button.ts`) — behavior tests.

## Implementation sketch

In `feed-status.ts`, import the shared `Button` and `State`, then in the
non-error return (when `status === 'updates'`) render the button as a
sibling of the `role="status"` span, wrapped in a container so the live
region announcement stays clean:

```ts
import { Button } from './button.js'
import { State, type AppState } from '../state.js'
// ...
const showFetch = status === 'updates'
return html`
    <span class="feed-status-wrap">
        <span
            key=${status}
            class=${wrapperClass}
            role="status"
            aria-live="polite"
            aria-label=${legend.ariaLabel}
        >
            ${legend.label ?
                html`<span class="feed-status-legend">${legend.label}</span>` :
                ''}
            <${Dot} color=${color} />
        </span>
        ${showFetch ?
            html`<${Button}
                className="fetch-updates-btn btn-small"
                onClick=${() => State.refreshFeeds(state)}
                isSpinning=${state.refreshInProgress}
            >fetch updates<//>` :
            ''}
    </span>
`
```

In `feed-status.css`, give `.feed-status-wrap` an inline-flex layout with
a small gap, style `.fetch-updates-btn` using existing button/color
variables (reuse `--color-primary`; do not invent colors), and mirror the
legend's responsive hide:

```css
.feed-status-wrap {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
}

@media (680px <= width < 1000px) {
    .feed-status-wrap .fetch-updates-btn {
        display: none;
    }
}
```

(Keep lines ≤80 cols; do not modify unrelated CSS.)

## Verify

1. `npm test` — unit/component tests pass, including new cases:
   - button present when `feedSyncStatus='updates'` (count 1 and N);
   - button absent for `synced`, `syncing`, `error`, `inactive`;
   - a click dispatches exactly one `feeds/refresh` POST (reuse the
     `withStubbedFetch`/SSE helpers from `test/sidebar-footer-refresh.ts`);
   - a click while `refreshInProgress` is true dispatches no second fetch.
2. `npm run lint` — clean.
3. `npm start` and exercise in a browser (constitution: UI changes must be
   verified in a browser):
   - put a feed into the "N updates" state; confirm the button shows to
     the right of the text;
   - click it; confirm it fetches like "Refresh Feeds" and the indicator
     transitions to "updating" then to "up to date" / new count;
   - confirm the button is gone in the `synced`/`syncing`/`error` states;
   - confirm keyboard activation works.

## Guardrails

- Do not add a separate fetch path — reuse `State.refreshFeeds`.
- Do not embed a count in the label; it is exactly "fetch updates".
- Do not change the existing "Refresh Feeds" sidebar control.
- Tests assert behavior, not brittle HTML text (one accessible-name check
  for the required label is acceptable).
