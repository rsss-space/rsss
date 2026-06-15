# Quickstart: Show concrete default in per-feed cache labels

A presentation-only frontend change. Three files touched, all under
`src/client/`.

## What changes

1. `src/client/local-first-settings.ts` — add a small pure helper that formats
   an account-default value into a hint string (`default, <N> MB` /
   `default, <N> days`; bare `default` for non-finite input). See
   `contracts/ui-cache-hint.md`.
2. `src/client/components/cache-settings.ts` — import the account-default
   signals + helper; replace the two labels at lines ~295 (`Max size (MB,
   blank = default)`) and ~306 (`Keep for (days, blank = default)`) with the
   helper-built hint.
3. `src/client/routes/settings.ts` — same label replacement at lines ~924 /
   ~937 (signals already imported here).

No CSS change. No schema, sync, worker, or DO change.

## Manual verification (constitution: UI exercised in a browser)

Run the app:

```sh
npm start
```

Then, with at least one subscribed feed:

1. Open a feed's "Cache Settings" → enable caching → confirm the two field
   hints read `Max size (default, 50 MB)` and `Keep for (default, 30 days)`
   (or whatever the current account defaults are), not "blank = default".
   (FR-001, FR-002, SC-002)
2. Open Settings → change the account-level retention default (e.g. 30 → 14
   days) and the account max-size default. Reopen the feed's cache settings →
   the per-feed hints now show the updated values and match the numbers shown
   in the account editor. (FR-003, FR-004, SC-003, US2)
3. Enter an explicit per-feed override, save, reopen → the hint still
   describes the account default (it describes the fallback, independent of
   the entered value), and saving/clearing the override still works exactly as
   before. (US1 scenario 3, FR-008, SC-004)
4. Confirm the per-feed list shown in the Subscriptions section uses the same
   wording (FR-007).

## Automated checks

```sh
npm test && npm run lint
```

Test guidance (per project rules — no brittle tests): unit-test the pure
helper's behavior (rounding parity with the account editor, the non-finite
degrade to `default`) rather than asserting exact rendered HTML/label strings.
