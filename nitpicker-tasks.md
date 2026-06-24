# Nitpicker Follow-up Tasks

Reviewed against the current tree on 2026-06-24. The original
`nitpicker.md` checklist is now partly stale: most unchecked P0 and P1
findings have already been fixed or superseded by newer code and tests.

## Active Tasks

1. Update `nitpicker.md` to mark fixed items complete.

   The current code appears to address these original unchecked findings:
   `#5-12`, `#14-20`, `#22-26`, `#28-39`, `#43`, `#46`,
   and `#48-50`.

2. Decide whether `POST /feeds` must be strictly non-blocking.

   Current behavior waits up to 3 seconds for the initial feed fetch, then
   falls back to `ctx.waitUntil`. If strict nitpicker compliance is the goal,
   return `201` immediately after inserting the feed and run the initial
   fetch fully in the background.

   Location:
   `src/server/durable-objects/index.ts`

3. Fix stale README session wording.

   Sessions now live in KV behind a random session id carried in a signed
   cookie. The README still says "encrypted cookies" and says rotating
   `SESSION_SECRET` means old cookies cannot be decrypted. Update the wording
   to "signed session-id cookies" and explain that rotation invalidates
   existing signed cookie values.

   Location:
   `README.md`

4. Stop stomping the `DEBUG` localStorage key on every load.

   Dev and staging currently overwrite `DEBUG` with `rsss,rsss:*` every time
   the app loads, while production removes it. Seed the default only when no
   value exists, and avoid deleting a user-customized value.

   Location:
   `src/client/index.ts`

5. Choose and enforce the TypeScript colon-spacing style.

   The project convention prefers no space before `:` in types. Add or adjust
   linting for this, then run a mechanical cleanup pass so the repo is
   consistent.

6. Treat commit message quality as a process task.

   This cannot be fixed in code for prior commits, but future commits should
   use descriptive messages so bisecting and auditing remain useful.

7. Defer item-list virtualization unless the page-size cap increases.

   The UI currently paginates and caps page size at 100 items, so the original
   virtualization concern is not an active production issue. Revisit this if
   the app starts rendering much larger pages.

## Fixed Or Superseded Findings

- Feed fetch now validates schemes and hosts, follows bounded redirects, uses
  timeouts, and caps response body size.
- OPFS local-first mode now has tab coordination and a remote-adapter fallback.
- API routing now uses `dataRouter` with explicit auth and entitlement gates.
- Sync now pushes before pulling and has a single orchestrator.
- Optimistic feed inserts now reconcile local ids with server ids.
- SQLite foreign keys are enabled on both local and Durable Object databases.
- The outbox now has an attempt cap and dead-letter handling.
- Feed parsing now uses `fast-xml-parser` instead of regex parsing.
- Feed refresh concurrency is bounded, and alarm scheduling is awaited.
- CORS is restricted to `APP_ORIGIN`, and state-changing requests have CSRF
  protection.
- COEP now uses `credentialless`, and the old GitHub sponsor iframes are gone.
- Billing subscription status is narrowed to typed verified states.
- Email dedupe includes an epoch, transient send retries exist, and settings
  links are absolute.
- Route-to-item matching now uses exact link candidates instead of substring
  matching.
- Deploy docs now include the previously missing secrets and modern Wrangler
  KV command.
- Durable Object migration introspection is guarded by a migration version.
- Legacy user localStorage persistence is no longer used as auth state.
- Frontend `Feed` and `Item` types are consolidated in `src/client/db/types.ts`.
- Pull-sync now throws a dedicated 401 auth error.
- `getOrCreateCustomer` now returns the customer contact record.
- Session cookies now use URL-safe base64 for both payload and signature.
- OAuth/session, billing, email, CSRF, route matching, dead-letter, and DO
  handler coverage have been expanded.
- CI now exists in `.github/workflows/nodejs.yml`.
- State event listeners now have a cleanup path.
- Reset and disable local-first now abort when pending writes cannot sync,
  unless explicit data-loss confirmation is passed.
- Dead-code findings from the original review are covered by
  `test/dead-code.mjs`.
- Routing helpers were moved into `src/client/routing.ts`.
- README no longer uses the deprecated `wrangler kv:namespace` command.
- OAuth callback route comments now document the async boot handoff.

## Verification Not Run

This pass was a source audit against current files. The full test suite was not
run as part of writing these conclusions.
