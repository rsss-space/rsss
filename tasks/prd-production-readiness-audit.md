# PRD: Production-Readiness Audit Remediation (P0 + P1)

## Introduction

`AUDIT.md` (2026-05-18) graded the codebase 13/20 across accessibility,
performance, responsive design, theming, and anti-patterns. The single
largest production-readiness gap is the complete absence of Stripe/Autumn
webhook handling: entitlement state is cached in KV for 600s and only
refreshed by user-initiated round-trips, so a chargeback, externally
cancelled subscription, failed renewal, refund, or dispute leaves paid
access intact until the cache TTL expires — and indefinitely if user
activity keeps refreshing the still-active Autumn record. Deployment
safety is the second material gap: `wrangler.jsonc` has a single
environment block with `NODE_ENV: "development"` committed, so any
`wrangler deploy` without `--var NODE_ENV:production` ships
`/api/auth/dev-login` and `canUseDevBillingShortcut` to production.

This PRD consolidates the audit's P0 (must-fix before production) and P1
(first hardening pass) findings into actionable user stories. P2 and P3
items are deliberately deferred.

## Goals

- Eliminate every P0 finding before production payment processing goes
  live (no entitlement leakage, no destructive deploy, no PII routing
  abuse, no irreversible account deletion).
- Resolve every P1 finding before public launch (no unbounded edge fan-out,
  no swallowed errors, no missing security headers, no PII in logs).
- Restore green CI on the `staging` branch (currently failing lint).
- Add regression tests for each fix so the same class of bug cannot recur
  silently.
- Keep all card-data flows inside Stripe Elements; do not expand PCI scope.

## User Stories

User stories are grouped by priority (P0s first, then P1s). Each fix
story requires a regression test that fails before the fix and passes
after, unless the change is configuration-only.

---

### P0 — fix before any production payment goes live

#### US-001: Add Stripe webhook endpoint
**Description:** As the billing system, I need a signature-verified webhook
endpoint so external Stripe state changes can drive entitlement updates
without waiting for the next user round-trip.

**Source:** Audit P0-1.

**Acceptance Criteria:**
- [ ] `POST /api/billing/webhook` route exists in `src/server/index.ts`.
- [ ] Endpoint reads the raw request body (no JSON pre-parse) and verifies
      via `stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)`.
- [ ] Endpoint is exempt from CSRF middleware and session auth (added to
      `isCsrfExemptPath` and bypasses session lookup).
- [ ] Signature failures return 400 with no body; success returns 200.
- [ ] `STRIPE_WEBHOOK_SECRET` added to `.dev.vars.example` and documented
      as a required wrangler secret in `README.md`.
- [ ] Regression test: valid signed event returns 200; tampered body
      returns 400; missing `Stripe-Signature` header returns 400.
- [ ] Typecheck and lint pass.

#### US-002: Invalidate entitlement cache on subscription/payment events
**Description:** As a paying user whose subscription is cancelled, refunded,
or disputed, I want my entitlement to flip within seconds of the Stripe
event so the system never serves paid features after I have stopped paying.

**Source:** Audit P0-2.

**Acceptance Criteria:**
- [ ] Webhook handler routes
      `customer.subscription.updated`,
      `customer.subscription.deleted`,
      `invoice.payment_failed`,
      `charge.dispute.created`,
      `charge.refunded`,
      `payment_method.attached`,
      `payment_method.detached`.
- [ ] A durable lookup from Stripe customer id → DID exists and is used by
      the handler to resolve the affected `did`. The lookup mechanism is
      decided during implementation: investigate first whether the
      existing Autumn customer record or any DO/KV write at checkout time
      already persists this mapping; if not, write a new KV index
      (`stripe-cust:<customerId>` → `did`, no TTL) at checkout-completion
      time and document the choice in `src/server/CLAUDE.md`.
- [ ] After resolving the `did`, the handler calls
      `SESSIONS.delete(billingCacheKey(did))`.
- [ ] After delete, the next `requireEntitlement` call refetches from
      Autumn and returns the current state.
- [ ] `invoice.payment_failed` triggers `sendPaymentFailed` mail (subject
      to the existing dedupe rules in `src/server/email.ts`).
- [ ] Regression test: simulated `customer.subscription.deleted` event
      removes the cache entry; subsequent `requireEntitlement` call sees
      the updated Autumn state and denies access.
- [ ] Regression test: webhook with an unknown customer id returns 200
      (Stripe must not retry) but logs at warn level via `reportError`.
- [ ] Typecheck and lint pass.

#### US-003: De-duplicate webhook events
**Description:** As the webhook handler, I need to ignore Stripe retries so
duplicate events do not double-process cache invalidation or mail.

**Source:** Audit P0-3.

**Acceptance Criteria:**
- [ ] Webhook handler stores `event.id` in KV under
      `stripe-event:<event.id>` with 7-day TTL after first successful
      handling.
- [ ] If the key already exists, handler short-circuits and returns 200
      without re-running side effects.
- [ ] KV write is the last step of the handler so a mid-handler failure
      does not poison the dedupe set.
- [ ] Regression test: same `event.id` posted twice → second response is
      200 with no second `SESSIONS.delete` call.
- [ ] Typecheck and lint pass.

#### US-004: Stop trusting client-supplied `email` in checkout
**Description:** As a logged-in attacker, I must not be able to route
`sendSubscriptionStarted` or `sendPaymentFailed` mail from this domain to
an arbitrary recipient by passing a chosen `email` field.

**Source:** Audit P0-7.

**Acceptance Criteria:**
- [ ] `/api/billing/checkout` (`src/server/index.ts:1252-1336`) no longer
      reads `email` from request body or persists it to the Autumn
      customer record.
- [ ] Mail destinations are sourced from a server-side verified email
      stored against the DID (the session's resolved handle/PDS email or
      an `email_verified` claim). Request input is never used.
- [ ] If no verified email is available for the DID, checkout is gated
      behind an in-app email-verification flow: the user is prompted to
      enter their email, a verification code is sent (via Resend), and
      the address is persisted server-side only after the code is
      confirmed.
- [ ] The verified email is stored in the per-user DO (new column on the
      user/profile table, or a new `verified_emails` table — pick one and
      migrate). Storage is keyed by DID and never client-writable.
- [ ] Regression test: POST to `/api/billing/checkout` with
      `{ email: "attacker@example.com" }` does not result in any outbound
      mail to `attacker@example.com`.
- [ ] Regression test: a DID without a verified email cannot reach Stripe
      checkout — the response routes the user to the verification flow
      instead.
- [ ] Typecheck and lint pass.

#### US-005: Split wrangler environments
**Description:** As an operator, I want a `wrangler deploy` to a given
environment to ship the correct config so a production deploy can never
accidentally enable dev-login or dev-billing.

**Source:** Audit P0-5.

**Acceptance Criteria:**
- [ ] `wrangler.jsonc` defines `[env.staging]` and `[env.production]`
      blocks with separate KV namespace ids and separate Durable Object
      bindings (or documented shared bindings if intentional).
- [ ] `NODE_ENV: "development"` is removed from the top-level `vars` block;
      each env block sets its own `NODE_ENV`.
- [ ] `package.json` deploy scripts use `wrangler deploy --env staging` /
      `--env production`; the bare `wrangler deploy` is either removed or
      errors out.
- [ ] A predeploy check (script or CI step) asserts `NODE_ENV=production`
      when deploying the production env and fails the deploy otherwise.
- [ ] `canUseDevBillingShortcut` and `/api/auth/dev-login` verifiably
      return 404 in the production env (manual smoke test documented).
- [ ] Typecheck and lint pass.

#### US-006: R2-back account deletion
**Description:** As a paying user whose account was deleted in error, I want
my data to be recoverable for a bounded window so a bad alarm or operator
mistake is not catastrophic.

**Source:** Audit P0-4.

**Acceptance Criteria:**
- [ ] `executeAccountDeletion`
      (`src/server/durable-objects/index.ts:2661-2669`) dumps `items`,
      `feeds`, and `dead_letter_outbox` to R2 at
      `deleted/<did>/<iso-timestamp>.json` *before* `DROP TABLE` /
      `storage.deleteAll()`.
- [ ] R2 bucket binding added to `wrangler.jsonc` (per env).
- [ ] Lifecycle rule on the bucket retains exports for 30 days then deletes
      them.
- [ ] Restore procedure documented in `README.md`: bucket + key naming,
      restore command, expected duration.
- [ ] Regression test: account deletion produces an R2 object at the
      expected key; export contains non-zero `items` rows when the account
      had items.
- [ ] Typecheck and lint pass.

#### US-007: Add `aria-labelledby` to payment-method modal
**Description:** As a screen-reader user, I want the payment-method dialog
to announce its title so I know what dialog has opened.

**Source:** Audit P0 (a11y).

**Acceptance Criteria:**
- [ ] `<modal-window>` in
      `src/client/components/payment-method-modal.ts:303` has
      `aria-labelledby="payment-method-modal-title"` (the `TITLE_ID`
      constant defined at line 51 is reused).
- [ ] The element referenced by `TITLE_ID` exists in the rendered tree and
      contains the dialog title.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: VoiceOver (or equivalent)
      announces the title when the modal opens.

#### US-008: Lazy-load `PaymentMethodModal`
**Description:** As a Settings visitor who never opens the payment-method
modal, I want Stripe.js and the dialog component to not be in my initial
JS bundle so the page loads faster.

**Source:** Audit P0 (perf).

**Acceptance Criteria:**
- [ ] `PaymentMethodModal` is no longer statically imported in
      `src/client/routes/settings.ts:55-56`.
- [ ] `handleOpenPaymentMethods` performs a dynamic `import()` of
      `payment-method-modal` on first invocation and caches the resolved
      module for subsequent opens.
- [ ] The modal element is only rendered into the DOM after the dynamic
      import resolves (no eager `<PaymentMethodModal />` at
      `settings.ts:875-878`).
- [ ] Build output: a separate chunk exists for the payment-method modal;
      Stripe.js is not in the Settings entry chunk.
- [ ] Regression test or build assertion: chunk-name match for the
      lazy-loaded module; absence of `js.stripe.com` references in the
      Settings entry chunk.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: Settings page network
      tab shows no Stripe.js request until the modal is opened.

---

### P1 — first hardening pass

#### US-009: Pin Stripe SDK and set explicit API version
**Description:** As an operator, I want Stripe SDK upgrades to be deliberate
so a minor version bump cannot ship behavior changes without code review.

**Source:** Audit P1 (billing).

**Acceptance Criteria:**
- [ ] `package.json` pins `stripe` to an exact version (no `^`).
- [ ] `getStripe()` in `src/server/stripe-billing.ts` passes an explicit
      `apiVersion` in the constructor options.
- [ ] Typecheck and lint pass.

#### US-010: Add idempotency keys to all Stripe mutations
**Description:** As a user clicking a button twice, I want my second
duplicate request to not produce a second Stripe-side mutation.

**Source:** Audit P1 (billing).

**Acceptance Criteria:**
- [ ] `paymentMethods.detach`, `customers.update`, `subscriptions.update`,
      `setupIntents.create` (the four mutation sites at
      `src/server/index.ts:988, 1033, 1060, 1729`) each pass
      `{ idempotencyKey: '<did>:<op>:<resource-id>' }` as the second
      argument.
- [ ] Idempotency key is deterministic for the same logical request and
      varies for distinct logical requests (the resource id is the
      payment-method id or subscription id, not a random nonce).
- [ ] Regression test: same logical request issued twice produces a single
      Stripe-side effect (mocked via test fixture).
- [ ] Typecheck and lint pass.

#### US-011: Rate limiting on sensitive endpoints
**Description:** As an operator, I need rate limits on billing, auth,
feed-refresh, full-fetch, and admin endpoints so a single user (or
unauthenticated caller) cannot fan out unbounded outbound calls or mail
at the edge.

**Source:** Audit P1 (security).

**Acceptance Criteria:**
- [ ] KV-backed token-bucket middleware factory added, parameterized by
      bucket size, window, and key-resolution function.
- [ ] Per-DID bucket (30/min) applied to `/api/billing/*`,
      `/api/feeds/refresh`, `/api/feeds/:id/refresh`,
      `/api/items/:id/fetch-full`, `/admin/*`.
- [ ] `/api/auth/login` gets *two* independent buckets that must both
      pass: per-IP (10/min, keyed off `cf-connecting-ip`) and per-handle
      (10/min, keyed off the lowercased handle from request input).
- [ ] Over-limit responses return 429 with `Retry-After` header and no
      response body that leaks bucket internals.
- [ ] Regression test: 31st billing request inside the window returns 429;
      1st request in the next window returns 200.
- [ ] Regression test: 11th `/api/auth/login` attempt from the same IP
      with different handles returns 429 (per-IP bucket exhausted);
      11th attempt against the same handle from different IPs also
      returns 429 (per-handle bucket exhausted).
- [ ] Typecheck and lint pass.

#### US-012: Extend `withIsolationHeaders` with full security header set
**Description:** As a user loading the app, I want the response headers to
include CSP, XCTO, Referrer-Policy, X-Frame-Options, and Permissions-Policy
so basic browser-level defenses are on by default.

**Source:** Audit P1 (security).

**Acceptance Criteria:**
- [ ] `src/server/isolation-headers.ts` adds:
      `Content-Security-Policy`,
      `X-Content-Type-Options: nosniff`,
      `Referrer-Policy: strict-origin-when-cross-origin`,
      `X-Frame-Options: DENY`,
      `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- [ ] CSP directives:
      `default-src 'self'`;
      `script-src 'self' https://js.stripe.com`;
      `connect-src 'self' https://api.stripe.com <SENTRY_INGEST_HOST>`
      (resolve from `VITE_SENTRY_DSN` at build/start time and inject;
      both client and server DSNs are accounted for);
      `frame-src https://js.stripe.com`;
      `img-src 'self' data: https:` (feed images);
      `style-src 'self' 'unsafe-inline'` (only if inline styles cannot
      be eliminated, otherwise drop `'unsafe-inline'`);
      `base-uri 'none'`;
      `form-action 'self'`;
      `frame-ancestors 'none'`.
- [ ] CSP includes nonces or hashes for any inline scripts, or inline
      scripts are removed.
- [ ] Headers applied to HTML responses from the worker.
- [ ] Regression test: response headers from `/` contain each header with
      expected values; Sentry ingest host appears in `connect-src`.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: Stripe Elements still
      loads, the payment-method modal still works, and Sentry browser SDK
      can still post events (no CSP-violation console errors).

#### US-013: Extend SSRF blocklist
**Description:** As the feed/article fetcher, I need to refuse requests to
CGNAT, benchmark, multicast, and reserved IPv4/IPv6 ranges so I cannot be
used to scan or attack non-public infrastructure.

**Source:** Audit P1 (security).

**Acceptance Criteria:**
- [ ] `isBlockedIpv4` in `src/server/feed-fetch.ts:329-364` adds
      `100.64.0.0/10`, `198.18.0.0/15`, `224.0.0.0/4`, `240.0.0.0/4`.
- [ ] `isBlockedIpv6` adds `ff00::/8` (multicast).
- [ ] Regression test: addresses inside each new range are rejected;
      addresses just outside each range are still accepted (where they
      would have been before).
- [ ] Typecheck and lint pass.

#### US-014: Make DoH the unconditional default in `fetchValidatedResponse`
**Description:** As a feed fetcher, I want to always resolve hostnames via
DoH so a caller passing a custom `fetchFn` cannot accidentally disable
DNS-rebinding protection.

**Source:** Audit P1 (security).

**Acceptance Criteria:**
- [ ] `fetchValidatedResponse` in `src/server/feed-fetch.ts:166-168` always
      defaults `resolveHostname` to `resolveHostnameWithDoh` when a custom
      `fetchFn` is provided.
- [ ] Opting out requires an explicit `resolveHostname: null` flag (used
      only in tests).
- [ ] Regression test: passing a custom `fetchFn` without
      `resolveHostname` results in DoH resolution being attempted.
- [ ] Typecheck and lint pass.

#### US-015: Derive `Secure` cookie flag from `APP_ORIGIN`
**Description:** As an operator, I want cookies to be marked `Secure`
whenever the deployed origin is HTTPS so a misconfigured hostname check
cannot drop the flag in production.

**Source:** Audit P1 (security).

**Acceptance Criteria:**
- [ ] `shouldUseSecureSessionCookie` returns
      `APP_ORIGIN.startsWith('https://')`, replacing the hostname-based
      check at `src/server/index.ts:313-315, 707-713, 887-893`.
- [ ] Local dev (`http://localhost:8888`) still issues non-Secure cookies.
- [ ] Regression test: with `APP_ORIGIN=https://example.com`, the
      `Set-Cookie` header contains `Secure`; with
      `APP_ORIGIN=http://localhost:8888`, it does not.
- [ ] Typecheck and lint pass.

#### US-016: Add `reportError(err, area)` helper and replace bare `console.error(err)` sites
**Description:** As an operator, I want operationally important failures
to reach Sentry so a swallowed error does not cause a silent regression.

**Source:** Audit P1 (ops).

**Acceptance Criteria:**
- [ ] New helper `reportError(err, area: string, context?: Record<string,
      unknown>)` in `src/server/lib/report-error.ts` that calls
      `Sentry.captureException(err, { tags: { area }, extra: context })`
      and `console.error(...)`.
- [ ] The 24+ `console.error(err)` sites in `src/server/*.ts` (billing,
      auth, feed-fetch) are replaced with `reportError(err, '<area>')`.
- [ ] Regression test: a thrown error in a billing handler results in
      `Sentry.captureException` being called (mocked).
- [ ] Typecheck and lint pass.

#### US-017: Scrub PII from server logs
**Description:** As a privacy-conscious user, I want my DID and email
address to not appear in Cloudflare Workers Logs so log access is not
equivalent to PII access.

**Source:** Audit P1 (ops/privacy).

**Acceptance Criteria:**
- [ ] DIDs in `src/server/email.ts:137-141, 160-166` and in `[proxy]` /
      `[DO]` write-path logs are hashed (e.g. first 8 chars of
      `sha256(did)`) before logging.
- [ ] Email addresses are removed from logs entirely (replaced with the
      domain part or omitted).
- [ ] `[proxy]` and `[DO]` write-path logs gated behind `LOG_LEVEL=debug`
      env var; default production log level is `info` or higher.
- [ ] Regression test: a billing failure log line does not contain the raw
      DID or recipient email.
- [ ] Typecheck and lint pass.

#### US-018: Add `/api/health?deep=1`
**Description:** As an operator running uptime checks, I want a deep health
probe that exercises KV, the DO, and Autumn so a half-broken dependency
shows up before users notice.

**Source:** Audit P1 (ops).

**Acceptance Criteria:**
- [ ] `/api/health?deep=1` performs: KV round-trip (write+read+delete on a
      throwaway key), DO ping (a no-op endpoint on a system DO), Autumn
      ping (a read-only call).
- [ ] Returns 200 with per-dependency status only if all dependencies
      respond within a 2s budget; otherwise 503 with the failing
      dependency named.
- [ ] `/api/health` (without `?deep=1`) keeps its current env-presence-only
      behavior.
- [ ] Regression test: with mocked KV failure, deep probe returns 503
      naming `kv`; with all green, returns 200.
- [ ] Typecheck and lint pass.

#### US-019: Fix failing lint on `staging`
**Description:** As a developer, I want `npm run lint` to pass on
`staging` so CI is meaningful again.

**Source:** Audit P1 (ops).

**Acceptance Criteria:**
- [ ] `test/feed-create.ts:81` no longer imports `waitFor` (or uses it).
- [ ] `npm run lint` exits 0 on `staging`.

#### US-020: Replace native `confirm()` / `alert()` with `ConfirmDialog`
**Description:** As a user on a screen reader or in a polished UI, I want
destructive actions and billing flows to use the in-app dialog component
instead of native browser modals.

**Source:** Audit P1 (a11y/UX).

**Acceptance Criteria:**
- [ ] New reusable `<ConfirmDialog>` component built on
      `@substrate-system/dialog` with title, message, confirm/cancel
      labels, and async `onConfirm` callback.
- [ ] All `confirm()` / `alert()` call sites in
      `src/client/routes/settings.ts:117, 160, 193, 202, 250, 259, 270,
      435`, `src/client/components/sidebar.ts:38`, and
      `src/client/components/cache-settings.ts:108` are replaced.
- [ ] Dialog is keyboard-dismissable (Escape) and focus is trapped while
      open; focus returns to the trigger on close.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: each replaced flow opens
      the in-app dialog, Escape cancels, confirm runs the destructive
      action.

#### US-021: Add `preconnect` to `js.stripe.com`
**Description:** As a user opening the payment-method modal, I want the
TLS handshake to Stripe to start in parallel with the dynamic import so
the modal opens faster.

**Source:** Audit P1 (perf).

**Acceptance Criteria:**
- [ ] `index.html` includes
      `<link rel="preconnect" href="https://js.stripe.com" crossorigin>`
      and `<link rel="dns-prefetch" href="https://js.stripe.com">`.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: network waterfall shows
      the preconnect firing before the modal is opened.

#### US-022: Clear `rsss_checkout_email` on logout
**Description:** As a user who logs out on a shared device, I want my
checkout email to not persist across sessions in `localStorage`.

**Source:** Audit P1 (privacy).

**Acceptance Criteria:**
- [ ] `rsss_checkout_email` is either moved to `sessionStorage`
      (`src/client/state.ts:86, 236-258`) or cleared inside
      `State.logout()`.
- [ ] Regression test: after `State.logout()`, the storage key is absent.
- [ ] Typecheck and lint pass.

#### US-023: Gate `localStorage.setItem('DEBUG', …)` on a current-value diff
**Description:** As a user, I want my `DEBUG` localStorage value to not
be rewritten on every page load so storage events do not fire spuriously
and other tabs are not nudged.

**Source:** Audit P1 (perf/quality).

**Acceptance Criteria:**
- [ ] `src/client/index.ts:34-40` reads the current value and only writes
      if it differs from the intended value.
- [ ] Typecheck and lint pass.

#### US-024: Label the `Add feed` input
**Description:** As a screen-reader user, I want the sidebar's feed-URL
input to have an accessible name so I know what to type into it.

**Source:** Audit P1 (a11y).

**Acceptance Criteria:**
- [ ] `<input id="new-feed-url">` in
      `src/client/components/sidebar.ts:123-129` is preceded by
      `<label class="visually-hidden" for="new-feed-url">Feed URL</label>`.
- [ ] `.visually-hidden` utility class exists in CSS (verify; add if
      missing).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill: screen reader announces
      the input as "Feed URL".

#### US-025: `aria-label` on the page-size `<select>`
**Description:** As a screen-reader user, I want the items-per-page
selector to have a name.

**Source:** Audit P2 promoted to P1 grouping for this story.

**Acceptance Criteria:**
- [ ] `src/client/routes/feed-reader.ts:225-234` page-size `<select>` has
      `aria-label="Items per page"`.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-026: `type="button"` on header logout buttons
**Description:** As a user, I want logout buttons inside any form context to
not accidentally submit a form.

**Source:** Audit P2 promoted into this PRD with the other small a11y
fixes.

**Acceptance Criteria:**
- [ ] `src/client/components/header.ts:96, 127` logout buttons set
      `type="button"`.
- [ ] Typecheck and lint pass.

#### US-027: Backfill server-side test coverage
**Description:** As a developer, I want tests to exist for the highest-risk
unprotected handlers so future regressions surface in CI.

**Source:** Audit P1 (tests).

**Acceptance Criteria:**
- [ ] Tests added for:
      `/api/auth/callback` (success + state-mismatch + replay),
      `/api/billing/checkout/return` (live path),
      `requireAdmin` (allowed/denied),
      CSRF middleware (`isCrossOriginStateChange`,
      `hasValidCsrfToken`),
      Resend retry/dedupe,
      webhook handler (signature ok/bad, dedupe, cache invalidation).
- [ ] `npm test` exits 0.
- [ ] Typecheck and lint pass.

## Functional Requirements

- FR-1: A signature-verified Stripe webhook endpoint exists and is
  CSRF-exempt, session-auth-exempt, and raw-body.
- FR-2: External Stripe state changes invalidate the per-DID entitlement
  cache within seconds.
- FR-3: Duplicate webhook events do not re-trigger side effects.
- FR-4: The billing API never trusts a client-supplied recipient email.
- FR-5: Production deploys cannot accidentally enable dev-login or
  dev-billing shortcuts.
- FR-6: Account deletion is recoverable for 30 days via R2 export.
- FR-7: The payment-method modal is screen-reader-named and lazily loaded.
- FR-8: All Stripe mutations use idempotency keys.
- FR-9: All edge-facing fan-out endpoints are rate-limited (per-DID for
  authenticated routes; per-IP *and* per-handle for `/api/auth/login`).
- FR-10: HTML responses include CSP (allowing Stripe and Sentry hosts),
  XCTO, Referrer-Policy, X-Frame-Options, and Permissions-Policy.
- FR-11: SSRF defenses cover CGNAT, benchmark, multicast, and reserved
  ranges (v4 + v6).
- FR-12: DoH resolution is the default for all worker-side outbound HTTP
  to user-controlled URLs.
- FR-13: Cookie `Secure` flag is set whenever the deployed origin is HTTPS.
- FR-14: Operationally important server errors reach Sentry.
- FR-15: Server logs do not contain raw DIDs or email addresses.
- FR-16: `/api/health?deep=1` exercises KV, DO, and Autumn.
- FR-17: `npm run lint` passes on `staging`.
- FR-18: No native `confirm()` / `alert()` remain in user-facing flows.
- FR-19: The Stripe SDK is pinned and a fixed `apiVersion` is configured.

## Non-Goals (Out of Scope)

- **Billing audit log table** in the per-user DO (audit P1 item).
  Deferred — to be revisited once webhook handling and rate limiting are
  in place. Stripe-side request ids and Sentry events provide a partial
  paper trail in the interim.
- All P2 items in `AUDIT.md`: DOMPurify config tightening,
  `rel="noopener noreferrer"` on item links, `--color-border-subtle`
  definition + hex-literal cleanup, `.route.settings` width fix, OAuth
  state TTL reduction, upstream-error sanitization, DO `x-rsss-did`
  defense-in-depth header, SSE subscriber cap, Sentry DSN split, CI
  workflow consolidation, `/admin/refresh-all` pagination, two-step
  set-default reconciliation, `/api/auth/logout` CSRF exemption removal,
  `observability.head_sampling_rate`.
- All P3 items: `DEV_LOGIN_ENABLED` secret gate, DoH failover, server-side
  HTML stripper hardening, mobile header height tweak, commented-out CSS
  cleanup, README incident runbook expansion, Stripe error-code copy
  mapping, `/terms` / `/privacy` route verification, `/polish` final pass.
- Migration of card-data handling out of Stripe Elements (PCI scope must
  not expand).
- A redesign of the entitlement model (the existing KV-cache + Autumn-as-
  source-of-truth pattern stays; only invalidation behavior changes).
- A dark-mode theme (called out in the audit but out of scope here).
- Feature work unrelated to remediation.

## Design Considerations

- Reuse the existing `@substrate-system/dialog` dep for `ConfirmDialog`;
  do not introduce a second dialog primitive.
- `reportError(err, area)` should be a one-liner replacement for
  `console.error(err)` so the diff stays small.
- CSP should be authored as a constant array of directives, not a string
  literal, so future additions (e.g. a CDN) do not require careful
  re-quoting.
- The rate-limit middleware should be a single Hono middleware factory
  parameterized by bucket size, window, and key fn — not 6 copies.
- Webhook handler should live next to other billing handlers in
  `src/server/index.ts`, with the event-router function in a separate
  module under `src/server/billing/webhook.ts` so it can be unit-tested
  without a full app instance.

## Technical Considerations

- Stripe signature verification needs the raw request body; if Hono's
  JSON parsing has already consumed the body, the webhook route must be
  declared before any JSON-parsing middleware (or use a route-specific
  `c.req.raw.text()` read).
- R2 binding must be added to *both* env blocks in `wrangler.jsonc` once
  US-005 lands; account-deletion in US-006 depends on that binding.
- `reportError` must not double-log in tests (Sentry SDK should be mocked
  to a no-op in the test harness).
- Rate-limit KV writes are eventually consistent across Cloudflare edges.
  Treat the limit as advisory; a small over-shoot is acceptable.
- The webhook → DID mapping (US-002) is unresolved. Implementation begins
  with a short investigation: (a) does the Autumn customer record already
  carry a DID we can read back? (b) does any existing DO/KV write at
  checkout-completion time persist this mapping? If both are no, write a
  new KV index (`stripe-cust:<customerId>` → `did`, no TTL) at the
  checkout-completion point and document the choice in
  `src/server/CLAUDE.md`. Webhook handler must tolerate an unknown
  customer id gracefully (return 200, log via `reportError`) so Stripe
  does not retry indefinitely.
- The email-verification flow (US-004) needs a storage location for the
  verified email. Reusing the per-user DO is the cheapest path; the
  verification code can ride on the existing Resend integration with a
  short-lived KV entry (`verify-email:<did>` → `{code, expiresAt}`,
  10-minute TTL).

## Success Metrics

- Zero P0 findings open against the audit's P0 list (US-001 → US-008).
- Zero P1 findings open against the P1 user stories listed in this PRD
  (US-009 → US-027). The audit's billing-audit-log P1 is intentionally
  deferred and tracked in Non-Goals.
- Time from a Stripe `customer.subscription.deleted` event to
  entitlement-revoked-for-next-request is under 10 seconds in staging.
- `npm run lint && npm run typecheck && npm test` passes on `staging` and
  `main`.
- No raw DIDs or email addresses appear in production logs over a 7-day
  audit window after rollout.
- Settings entry chunk size drops by the size of Stripe.js + dialog
  component (verify with `vite build --report` before/after).

## Resolved Decisions

- **Webhook → DID mapping** — to be determined during US-002
  implementation. Start with a short investigation of existing Autumn /
  DO / KV state; if no durable mapping exists, write a new KV index at
  checkout-completion time. See Technical Considerations.
- **R2 binding cost** — acceptable. R2 bucket already provisioned;
  US-006 may use it with 30-day retention.
- **CSP and Sentry** — Sentry ingest host must appear in `connect-src`.
  Resolve from `VITE_SENTRY_DSN` at build/start time. See US-012
  acceptance criteria.
- **Rate-limit key for `/api/auth/login`** — apply both per-IP and
  per-handle buckets (10/min each). Both must pass for the request to
  proceed. See US-011 acceptance criteria.
- **Billing audit log** — deferred (moved to Non-Goals); revisit after
  webhook handling and rate limiting are in place.
- **Email source of truth for US-004** — when no verified email is on
  file for the DID, prompt the user to verify an email via an in-app
  verification-code flow (delivered through Resend); persist the
  verified address server-side only after the code is confirmed. See
  US-004 acceptance criteria.

## Open Questions

- None at this time. Implementation may surface follow-ups; capture them
  in `src/server/CLAUDE.md` as they arise.
