# Production-Readiness Audit — rsss

_Generated 2026-05-18. Scope: full repo with focus on payment processing._

## Anti-Patterns Verdict

**Pass.** No AI-slop tells. No cyan-on-dark, no purple→blue gradients, no
`background-clip: text`, no glassmorphism, no card-grid hero-metric template,
no >1px decorative side-stripes on cards. The 3px border-left on blockquotes
in `item-reader.css` is a typographic convention, not a card accent. Frontend
has a coherent point of view.

## Audit Health Score

| # | Dimension | Score | Key Finding |
|---|-----------|------:|-------------|
| 1 | Accessibility | 2 | Payment-method modal missing `aria-labelledby`; native `confirm()`/`alert()` in billing & destructive flows; sidebar `Add feed` input has no label |
| 2 | Performance | 2 | `PaymentMethodModal` (with Stripe.js + dialog component) eagerly bundled into Settings even when closed; no `preconnect` to `js.stripe.com` |
| 3 | Responsive Design | 3 | `.route.settings { width: 60rem }` causes horizontal scroll under 960px; otherwise solid breakpoints |
| 4 | Theming | 2 | `--color-border-subtle` referenced but undefined; hex literals leak (`#2563eb1a`, `#fef2f2`); no dark mode |
| 5 | Anti-Patterns | 4 | Genuinely distinctive; no AI tells |
| **Total** | | **13 / 20** | **Acceptable — significant work needed in billing + ops** |

## Executive Summary

The codebase has unusually strong foundations for a personal-scale product:
SSRF defenses (DoH-resolved IPs, redirect revalidation, byte caps, protocol
allowlist), HMAC-signed session cookies anchored in KV, CSRF middleware
combining token + origin checks, per-DID Durable Objects giving free tenant
isolation, and a Stripe boundary that never lets card data touch the Worker
(PCI SAQ A scope). 114 test files. Sentry on client, server, and DO.

**The single largest production-readiness gap is the complete absence of
Stripe (or Autumn) webhook handling.** Entitlement state is cached in KV for
600s and only refreshed by user-initiated round-trips, so a chargeback,
externally-cancelled subscription, failed renewal, refund, or dispute leaves
paid access intact until the cache TTL expires — and indefinitely if user
activity keeps refreshing the (still active) Autumn record. Compounding this:
no idempotency keys on Stripe mutations, no rate limiting on any billing
endpoint, no audit trail of charges/PM changes, `email` accepted from the
client and stored as the Autumn customer email (lets a logged-in attacker
target arbitrary recipients with your transactional mail).

**Deployment safety is the second material gap.** `wrangler.jsonc` has a
single environment block with KV ids and `NODE_ENV: "development"` committed
at the top level, so any `wrangler deploy` without `--var NODE_ENV:production`
ships `/api/auth/dev-login` and `canUseDevBillingShortcut` to production. CI
runs only on `main`; `staging` (current branch) silently has a failing lint
(`'waitFor' is defined but never used` in `test/feed-create.ts:81`).

**Counts: 7 P0 · 19 P1 · 24 P2 · 14 P3.**

## Critical Issues (P0)

1. **No Stripe/Autumn webhook handler** (server-wide; no
   `/api/billing/webhook`) — entitlement can persist 10 min after
   chargeback/cancel/refund.
2. **Entitlement cache (`billing:<did>`, TTL 600s) has no event-driven
   invalidation** (`src/server/index.ts:96, 177-187, 203-235`).
3. **Single wrangler environment with `NODE_ENV: "development"` baked into
   committed vars** (`wrangler.jsonc:93-95`) — production deploy without
   explicit override exposes dev-login and dev-billing-shortcut.
4. **`executeAccountDeletion` runs `DROP TABLE` + `storage.deleteAll()` with
   no backup / soft-delete** (`src/server/durable-objects/index.ts:2661-2669`)
   — one bad alarm and a paying user is unrecoverable.
5. **`<modal-window>` payment modal missing `aria-labelledby`**
   (`src/client/components/payment-method-modal.ts:303`) — screen readers
   announce "dialog" with no name.
6. **`PaymentMethodModal` eagerly rendered & imported in Settings**
   (`src/client/routes/settings.ts:55-56, 875-878`) — Stripe.js + dialog
   component shipped to every Settings visitor whether they ever open the
   modal or not.
7. **`email` accepted from `/api/billing/checkout` body and stored as Autumn
   customer email** (`src/server/index.ts:1252-1336`) — logged-in attacker
   can route `sendSubscriptionStarted` / `sendPaymentFailed` mails to
   arbitrary recipients from your domain.

## Detailed Findings by Severity

### Payments & Billing

| Sev | Finding | Location | Fix |
|---|---|---|---|
| P0 | No webhook endpoint, no `stripe.webhooks.constructEvent` anywhere | absent | Add `POST /api/billing/webhook`, raw-body, signature-verified, CSRF-exempt |
| P0 | 600s entitlement cache, no invalidation on external state change | `src/server/index.ts:96, 203-235` | Delete cache on `customer.subscription.{updated,deleted}`, `invoice.payment_failed`, `charge.dispute.created`, `charge.refunded` |
| P0 | Client-supplied `email` stored on Autumn customer | `src/server/index.ts:1252-1336` | Treat as contact-only display; do not persist to Autumn |
| P1 | No `Stripe-Idempotency-Key` on any mutation | `src/server/index.ts:988, 1033, 1060, 1729` | Pass `{ idempotencyKey: '<did>:<op>:<id>' }` as 2nd arg |
| P1 | No rate limiting on `/api/billing/*` | `src/server/index.ts:903-1743` | Per-DID KV token bucket (start 30/min) |
| P1 | No webhook event de-dup (once added) | n/a yet | Persist `event.id` in KV, 7-day TTL |
| P1 | No audit log of billing mutations | n/a | Append `{ts, did, op, pmId, stripeRequestId, outcome}` to DO table |
| P1 | Refund / dispute lifecycle entirely unhandled | n/a | Webhook handlers must flip entitlement + notify |
| P1 | Stripe SDK floats `^17.7.0`; no explicit `apiVersion` in `getStripe()` | `package.json:82`, `src/server/stripe-billing.ts` | Pin minor; set `apiVersion` |
| P2 | Two-step set-default not transactional (customer.default updated but subscription.default can fail) | `src/server/index.ts:1030-1106` | Document the recovery path; add background reconciliation |
| P2 | `console.error` includes raw Stripe error objects (request_id, customer, pm ids) | 6+ sites in `src/server/index.ts` | Use structured logger, allowlist fields |
| P2 | No tests for webhook handling, cache invalidation on cancel, idempotency-key presence, rate-limit enforcement | `test/` | Add integration tests once webhooks land |

### Server Security

| Sev | Finding | Location | Fix |
|---|---|---|---|
| P1 | No rate limit on `/api/auth/login` (OAuth start) — each call triggers 3-4 outbound fetches; unauthenticated handle-enum amplification | `src/server/index.ts:579-612` | Per-IP/per-handle KV bucket (10/min) |
| P1 | No rate limit on `/api/billing/checkout/failed` — triggers Resend mail | `src/server/index.ts:1485-1553` | Per-DID minute bucket |
| P1 | No rate limit on per-feed refresh at the edge (DO has internal throttle, proxy doesn't) | `src/server/index.ts:1782-1818` | KV token bucket across feed-fetch endpoints |
| P1 | Only COOP + COEP set — no CSP, XCTO, Referrer-Policy, X-Frame-Options, Permissions-Policy | `src/server/isolation-headers.ts:1-26` | Add full security header set (CSP must permit `js.stripe.com` and `api.stripe.com`) |
| P1 | SSRF blocklist missing 100.64/10 (CGNAT), 198.18/15 (benchmark), 224/4 (multicast), 240/4 (reserved); IPv6 ff00::/8 multicast | `src/server/feed-fetch.ts:329-364` | Extend `isBlockedIpv4` / `isBlockedIpv6` |
| P1 | DNS-rebinding bypass when caller passes `fetchFn` — `resolveHostname` silently undefined | `src/server/feed-fetch.ts:166-168` | Always default to `resolveHostnameWithDoh`; require explicit opt-out flag |
| P1 | `Set-Cookie` `Secure` flag conditional on hostname not on env | `src/server/index.ts:313-315, 707-713, 887-893` | Use `APP_ORIGIN.startsWith('https://')` |
| P2 | OAuth state KV record (10 min TTL) contains DPoP private JWK — long replay window | `src/server/index.ts:601-603` | Drop to 5 min; bind to `Sec-Fetch-Site` or session pre-cookie |
| P2 | Stack-trace / upstream-error pass-through to client | `src/server/index.ts:606-612, 720-727` | Map to safe codes, log full server-side |
| P2 | DO trust boundary: worker forwards session cookie verbatim to DO; if a future call path uses request-body `did` isolation collapses | `src/server/index.ts:1760-1776` | Defense-in-depth `x-rsss-did` header re-asserted in DO |
| P2 | SSE handler has no `subscribers.size` cap | `src/server/durable-objects/index.ts:705-733` | Cap (e.g. 8), close oldest |
| P3 | `/api/auth/logout` in `isCsrfExemptPath` | `src/server/index.ts:321-326` | Remove |
| P3 | `/api/auth/dev-login` gated only by `NODE_ENV` + loopback | `src/server/index.ts:844-897` | Require `DEV_LOGIN_ENABLED` secret |
| P3 | Single DoH provider (no failover) | `src/server/auth/oauth.ts:214`, `src/server/feed-fetch.ts:6` | Add Google/Cloudflare failover |
| P3 | Server-side article HTML stripper is regex-only | `src/server/article-extract.ts:110-142` | Strengthen or rely fully on client DOMPurify |

### Frontend Quality

| Sev | Finding | Location | Fix |
|---|---|---|---|
| P0 | `<modal-window>` missing `aria-labelledby=${TITLE_ID}` | `src/client/components/payment-method-modal.ts:303` | Add attribute (`TITLE_ID` already defined at line 51) |
| P0 | `PaymentMethodModal` eagerly imported + always rendered | `src/client/routes/settings.ts:55-56, 875-878` | Dynamic `import()` inside `handleOpenPaymentMethods` |
| P1 | Native `alert()` / `confirm()` in 10+ billing & destructive flows | `src/client/routes/settings.ts:117, 160, 193, 202, 250, 259, 270, 435`; `sidebar.ts:38`; `cache-settings.ts:108` | Centralize `<ConfirmDialog>` on `@substrate-system/dialog` |
| P1 | No `preconnect` / `dns-prefetch` to `js.stripe.com` | `index.html` | Add `<link rel="preconnect" href="https://js.stripe.com" crossorigin>` |
| P1 | No CSP, Referrer-Policy, Permissions-Policy on HTML responses | `index.html` + worker | Set headers (CSP must permit Stripe) |
| P1 | `rsss_checkout_email` in `localStorage` survives logout | `src/client/state.ts:86, 236-258` | Move to `sessionStorage` or clear in `State.logout()` |
| P1 | Unconditional `localStorage.setItem('DEBUG', …)` on every page load | `src/client/index.ts:34-40` | Gate on current-value diff |
| P1 | `<input id="new-feed-url">` has no label, only placeholder | `src/client/components/sidebar.ts:123-129` | Add `<label class="visually-hidden" for="new-feed-url">` |
| P2 | Page-size `<select>` lacks `aria-label` | `src/client/routes/feed-reader.ts:225-234` | Add `aria-label="Items per page"` |
| P2 | Logout buttons missing `type="button"` | `src/client/components/header.ts:96, 127` | Add attribute |
| P2 | `--color-border-subtle` referenced but undefined | `src/client/routes/settings.css:50, 51, 228` | Define in `_variables.css` |
| P2 | Hex literal leaks instead of `color-mix()` / variables | `src/client/style.css:136, 176, 188-189`, `sidebar-item.css:16` | Replace |
| P2 | `.route.settings { width: 60rem }` (not `max-width`) — horizontal scroll under 960px | `src/client/routes/settings.css:4` | `max-width: 60rem; width: 100%` |
| P2 | External item link missing `rel="noopener noreferrer"` | `src/client/components/item-row.ts:144-148` | Add attribute (feed-supplied URLs are untrusted) |
| P2 | DOMPurify config does not explicitly forbid `iframe`/`object`/`embed`/`target` | `src/client/util.ts:26-32` (consumed by `item-reader.ts:194`) | `FORBID_TAGS: ['iframe','object','embed']`, `FORBID_ATTR: ['target','style','onerror','onload']` |

### Ops, Testing, Observability

| Sev | Finding | Location | Fix |
|---|---|---|---|
| P0 | Single wrangler env; `NODE_ENV: "development"` committed | `wrangler.jsonc:1-104` | Add `[env.staging]` / `[env.production]` blocks with separate KV ids |
| P0 | `executeAccountDeletion` is destructive + irreversible | `src/server/durable-objects/index.ts:2661-2669` | R2 export keyed by `deleted/<did>/<timestamp>.json` (30-day retention) before `DROP TABLE` |
| P1 | `npm run lint` fails on staging (`'waitFor' is defined but never used`) | `test/feed-create.ts:81` | Remove import |
| P1 | 24+ `console.error(err)` sites swallow errors that never reach Sentry | `src/server/*.ts` | Add `reportError(err, area)` helper wrapping `Sentry.captureException` |
| P1 | PII in Resend logs: `did`, `to`, raw error | `src/server/email.ts:137-141, 160-166` | Hash DIDs; strip email addresses; gate dev-mode body log behind flag |
| P1 | `[proxy]` and `[DO]` write-path logs print DIDs + feed URLs on every request | `src/server/index.ts:1794, 1813`; `src/server/durable-objects/index.ts:777-849` | Gate behind `LOG_LEVEL=debug` |
| P1 | `/api/health` only validates env presence — no KV/DO/Autumn/Stripe probe | `src/server/index.ts:475-488` | Add `?deep=1` mode that round-trips KV + DO + Autumn |
| P1 | No tests for `/api/auth/callback`, live `/checkout/return`, `requireAdmin`, CSRF middleware, Resend retry/dedupe | `test/` | Backfill |
| P2 | Real Sentry DSN in `.env.example` — dev errors land in prod project | `.env.example:4` | Separate Sentry projects per env |
| P2 | Two redundant CI workflows; neither runs build, neither runs on `staging` | `.github/workflows/ci.yml`, `nodejs.yml` | Collapse to one `lint → typecheck → build → test` on `main` + `staging` |
| P2 | `/admin/refresh-all` enumerates every user via `SESSIONS.list({prefix:'user:'})` with no pagination/rate guard | `src/server/index.ts:1826-1909` | Paginate, throttle |
| P2 | Runbook only covers `SESSION_SECRET` rotation | `README.md:286-296` | Add Stripe/Autumn rotation, DLQ inspection, single-user restore, `/api/health` failure modes |
| P3 | `wrangler.jsonc` `observability.enabled:true` without `head_sampling_rate` (defaults to 100%) | `wrangler.jsonc:97-99` | Set `head_sampling_rate: 0.1` |
| P3 | OAuth metadata advertises `/terms` and `/privacy` — confirm routes exist | `src/server/index.ts:544-548` | Verify or remove |

## Systemic Patterns

- **Catch-then-log-then-respond pattern with no Sentry capture** appears
  across 24+ billing/auth sites. The choice of `withSentry` for the worker
  only catches *unhandled* errors; almost every operationally important
  failure is silently swallowed.
- **PII flows freely into logs** in three layers (worker `[proxy]`, DO
  `[DO]`, Resend retry). At scale this is both a privacy issue and a
  Cloudflare Workers Logs cost issue.
- **No rate limiting anywhere at the edge.** Every defense lives inside the
  DO (which has its own per-feed throttle), so anything that fans out from
  the worker before reaching the DO is unbounded.
- **Hard-coded hex colors and missing variables** suggest the theming layer
  was built incrementally; a one-pass audit + `_variables.css` cleanup would
  close most of the P2/P3 theming items.
- **Native `confirm()`/`alert()`** were used as quick stand-ins; the
  `@substrate-system/dialog` dep is already on the project — there's no
  reason to keep them.

## Positive Findings

- SSRF defenses on the feed/article fetcher are unusually thorough (literal
  IP blocklist, DoH pre-resolution, redirect revalidation, byte caps,
  protocol allowlist, timeouts).
- Stripe boundary is correct: secret key never imported client-side; card
  data only flows through Stripe Elements (PCI SAQ A).
- All billing endpoints derive `customerId` server-side from `session.did` →
  Autumn (no client-supplied customer ids).
- DELETE refuses to detach the current default payment method.
- `requireEntitlement` fails closed on Autumn errors (503, not pass-through).
- HMAC-signed session cookies anchored in KV (not JWTs); CSRF combines
  cookie token + origin/sec-fetch-site checks.
- DOMPurify is correctly applied to all feed-derived HTML; client
  `dangerouslySetInnerHTML` is restricted to that one sanitized path.
- `loading="lazy"` + `decoding="async"` on thumbnails;
  `prefers-reduced-motion` honored.
- Status pills have proper `role="status"` + `aria-live="polite"`.
- No tokens, JWTs, or session keys in `localStorage`.
- Sentry source-map upload is gated on `SENTRY_AUTH_TOKEN` (no leaks).
- Zero TODO/FIXME/HACK/XXX in `src/`.

---

## Atomic Task List

### P0 — fix before any production payment goes live

1. **Add `POST /api/billing/webhook`** — raw body,
   `stripe.webhooks.constructEvent(body, sig, env.STRIPE_WEBHOOK_SECRET)`,
   CSRF-exempt, session-auth-exempt; add `STRIPE_WEBHOOK_SECRET` to
   `.dev.vars.example` + wrangler secrets.
2. **Subscribe to `customer.subscription.{updated,deleted}`,
   `invoice.payment_failed`, `charge.dispute.created`, `charge.refunded`,
   `payment_method.{attached,detached}`** — on receipt,
   `SESSIONS.delete(billingCacheKey(did))` and refetch from Autumn; trigger
   `sendPaymentFailed` mail.
3. **Persist `event.id` in KV with 7-day TTL**; return 200 on duplicate.
4. **Stop accepting `email` from `/api/billing/checkout` body**; either
   derive from a verified identity source or treat as display-only.
5. **Split `wrangler.jsonc` into `[env.staging]` and `[env.production]`
   blocks** with separate KV namespace ids; remove top-level
   `NODE_ENV: "development"`; add a predeploy check that asserts
   `NODE_ENV=production` for prod deploys.
6. **R2-back `executeAccountDeletion`** — dump
   `items`/`feeds`/`dead_letter_outbox` to `deleted/<did>/<ts>.json`
   (30-day retention) before `DROP TABLE`.
7. **Add `aria-labelledby="payment-method-modal-title"` to `<modal-window>`**
   in `payment-method-modal.ts:303`.
8. **Lazy-load `PaymentMethodModal`** in `settings.ts` via dynamic
   `import()` inside `handleOpenPaymentMethods`.

### P1 — fix in the first hardening pass

9. Add `{ idempotencyKey: '<did>:<op>:<id>' }` to all four Stripe mutations
   (`paymentMethods.detach`, `customers.update`, `subscriptions.update`,
   `setupIntents.create`).
10. KV-backed per-DID token bucket middleware on `/api/billing/*`,
    `/api/auth/login`, `/api/feeds/refresh`, `/api/feeds/:id/refresh`,
    `/api/items/:id/fetch-full`, `/admin/*` (start 30/min).
11. Extend `withIsolationHeaders` with CSP (allow `js.stripe.com`
    `api.stripe.com`), `X-Content-Type-Options: nosniff`,
    `Referrer-Policy: strict-origin-when-cross-origin`,
    `X-Frame-Options: DENY`, `Permissions-Policy`.
12. Extend SSRF blocklist: `100.64.0.0/10`, `198.18.0.0/15`,
    `224.0.0.0/4`, `240.0.0.0/4`, IPv6 `ff00::/8`.
13. Make `resolveHostnameWithDoh` the unconditional default in
    `fetchValidatedResponse`; require explicit `resolveHostname: null`
    opt-out.
14. Change `shouldUseSecureSessionCookie` to derive from
    `APP_ORIGIN.startsWith('https://')`.
15. Add `reportError(err, area)` helper wrapping `Sentry.captureException` +
    `console.error`; replace the 24+ bare `console.error(err)` sites.
16. Hash DIDs and strip email addresses from logs in `src/server/email.ts`
    and `src/server/index.ts`; gate `[proxy]`/`[DO]` write-path logs behind
    `LOG_LEVEL=debug`.
17. Add `/api/health?deep=1` round-tripping KV + DO + Autumn.
18. Fix `'waitFor' is defined but never used` in `test/feed-create.ts:81`.
19. Replace `confirm()`/`alert()` across `settings.ts`, `sidebar.ts`,
    `cache-settings.ts` with a reusable `<ConfirmDialog>` on
    `@substrate-system/dialog`.
20. Add `<link rel="preconnect" href="https://js.stripe.com" crossorigin>`
    to `index.html`.
21. Move `rsss_checkout_email` to `sessionStorage` or clear in
    `State.logout()`.
22. Add `<label class="visually-hidden" for="new-feed-url">Feed URL</label>`
    in `sidebar.ts`.
23. Add `aria-label="Items per page"` to the page-size `<select>` in
    `feed-reader.ts:225-234`.
24. Add `type="button"` to logout buttons (`header.ts:96, 127`).
25. Gate `localStorage.setItem('DEBUG', …)` on a current-value diff in
    `client/index.ts`.
26. Backfill tests for `/api/auth/callback`, live
    `/api/billing/checkout/return`, `requireAdmin`, CSRF middleware
    (`isCrossOriginStateChange`, `hasValidCsrfToken`), Resend retry/dedupe,
    webhook handler (once added).
27. Add billing audit log table in DO; append on every PM/subscription
    mutation.
28. Pin `stripe@17.7.0` (no `^`); pass explicit `apiVersion` in
    `getStripe()`.

### P2 — second pass

29. Tighten DOMPurify config in `client/util.ts` —
    `FORBID_TAGS: ['iframe','object','embed']`,
    `FORBID_ATTR: ['target','style','onerror','onload']`.
30. Add `rel="noopener noreferrer"` to external item link
    (`item-row.ts:144`).
31. Define `--color-border-subtle` in `_variables.css`; replace
    `#2563eb1a`, `#fef2f2`, `#fecaca`, `#0000001a` with `color-mix()` /
    variables.
32. Change `.route.settings { width: 60rem }` to
    `max-width: 60rem; width: 100%`.
33. Drop OAuth state KV TTL to 300s; bind to `Sec-Fetch-Site` or session
    pre-cookie nonce.
34. Map upstream/Stripe errors to safe codes before returning to client;
    log full message server-side only.
35. Defense-in-depth `x-rsss-did` header set by worker and re-asserted in
    DO.
36. Cap SSE `subscribers.size` (e.g. 8 per DO), close oldest on overflow.
37. Move `VITE_SENTRY_DSN` out of `.env.example`; separate Sentry projects
    per env.
38. Collapse `ci.yml` and `nodejs.yml` into one workflow that runs
    `lint → typecheck → build → test` on `main` + `staging`.
39. Paginate + throttle `/admin/refresh-all`.
40. Two-step set-default reconciliation job for partial Stripe failures.
41. Remove `/api/auth/logout` from `isCsrfExemptPath`.
42. Add `wrangler.jsonc` `observability.head_sampling_rate: 0.1`.

### P3 — polish

43. Add `DEV_LOGIN_ENABLED` secret gate to `/api/auth/dev-login`.
44. Add DoH failover (Google + Cloudflare).
45. Strengthen server-side article-extract HTML stripper (or document that
    defense-in-depth is client-only).
46. Reduce mobile header height
    (`@media (width < 680px) { .app-header { height: 4rem } }`).
47. Remove commented-out CSS in `style.css:29-33, 110-114, 277-283` and
    `_variables.css`.
48. Add incident runbook section to `README.md`: Stripe/Autumn key
    rotation, DLQ inspection, single-user restore, `/api/health` failure
    modes.
49. Map `formatBrand` / Stripe error codes to user-friendly copy in
    `payment-method-modal.ts:353`.
50. Verify (or remove) `/terms` and `/privacy` routes advertised in OAuth
    metadata.
51. **`/polish` final pass** after fixes land.
