# Payment Method Modal — Phase 1: Stripe SDK Boundary

**Goal:** Add the Stripe Node SDK to the Cloudflare Worker and provide a
typed per-request handle plus an Autumn pull-through customer resolver. No
new HTTP routes — only the library/plumbing.

**Architecture:** A new module `src/server/stripe-billing.ts` mirrors the
shape of `src/server/autumn-billing.ts`: a private per-request `getStripe()`
function instantiates the SDK with `Stripe.createFetchHttpClient()` for the
Cloudflare Workers runtime; a `stripeUseLive(env)` env-gate function reports
whether `STRIPE_SECRET_KEY` is set; and a `getStripeCustomerId(env, did)`
helper performs a pull-through to Autumn on every request (no local
caching of `cus_*` IDs).

**Tech Stack:** TypeScript ES2022, Cloudflare Workers runtime, Stripe Node
SDK (`stripe` npm package), Hono, tapzero for tests, esbuild as the test
bundler.

**Scope:** 1 of 6 phases from the design plan
(`DOCS/design-plans/2026-05-17-payment-method-modal.md`).

**Codebase verified:** 2026-05-17. Findings of note (differ from design):
- Test files live at `/Users/nick/code/rsss/test/`, NOT `src/test/`.
- Tests are wired in `test/run-all-tests.mjs` and bundled with esbuild
  piped to `tapout`.
- `.dev.vars` already contains `STRIPE_SECRET_KEY` and `STRIPE_PUBLIC_KEY`
  (existing key uses `_PUBLIC_` naming). This phase RENAMES the public key
  to `STRIPE_PUBLISHABLE_KEY` to align with Stripe's official terminology
  and with the design.
- `Env` interface lives in `src/server/index.ts:45-63`.
- Autumn customer body returns a `stripe_id` field (see
  `test/signup-helpers.ts:247`), which is what `getStripeCustomerId()`
  reads.

---

## Acceptance Criteria Coverage

**Verifies: None** — this is an infrastructure phase. The design phase
explicitly states "No acceptance-criteria coverage in this phase
(infrastructure only)." Verification is operational: build succeeds,
type-check passes, lint passes, and a trivial unit test imports the module
and confirms `stripeUseLive()` reads the env var.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `stripe` npm dependency

**Files:**
- Modify: `/Users/nick/code/rsss/package.json` (insert into `dependencies`
  alphabetically; today the dependencies block runs from line 50 down to
  line ~95 — find the correct alphabetical position before `wrangler` and
  after `redis-style` packages; verify with `npm view stripe version` that
  you're pinning the current stable major)

**Step 1: Install Stripe**

```bash
npm install stripe@^17.0.0
```

`stripe@^17.x` is the current stable major as of 2026-05 and supports
Cloudflare Workers via `Stripe.createFetchHttpClient()` without requiring
`nodejs_compat` (the worker has `nodejs_compat` enabled anyway). The
package is self-typed — do NOT add `@types/stripe`.

If the installed version differs from `17.x` (e.g., the registry has moved
to `18.x` by the time of execution), use whatever the current stable major
is at the time. Pin to a major (`^X.0.0`), not exactly.

**Step 2: Verify install**

```bash
ls node_modules/stripe/package.json && \
  node -e "console.log(require('stripe/package.json').version)"
```

Expected: prints a version number `17.x.x` (or later major).

**Step 3: Verify there are no peer-dep warnings**

```bash
npm install 2>&1 | grep -i "WARN\|ERR" || echo "clean"
```

Expected: no `peer dep` warnings related to stripe.

**Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(billing): add stripe sdk dependency"
```
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Extend `Env` interface for Stripe secrets

**Files:**
- Modify: `/Users/nick/code/rsss/src/server/index.ts:45-63` — add two
  optional fields to the `Env` interface

**Step 1: Edit the Env interface**

Add `STRIPE_SECRET_KEY?:string` and `STRIPE_PUBLISHABLE_KEY?:string`
immediately after the `AUTUMN_DISABLED?:string` line (line 55). Order:
group with other billing-related env vars.

Final `Env` interface (the diff is two new lines after
`AUTUMN_DISABLED?:string;`):

```typescript
export interface Env {
    USER_DO:DurableObjectNamespace<RsssUserDOBase>;
    SESSIONS:KVNamespace;
    BLURHASH_KV:KVNamespace;
    HTML_KV?:KVNamespace;
    BLURHASH_QUEUE:Queue;
    ASSETS:Fetcher;
    SESSION_SECRET:string;
    OAUTH_CLIENT_ID?:string;
    AUTUMN_SECRET_KEY?:string;
    AUTUMN_DISABLED?:string;
    STRIPE_SECRET_KEY?:string;
    STRIPE_PUBLISHABLE_KEY?:string;
    RESEND_API_KEY?:string;
    RESEND_DISABLED?:string;
    RESEND_FROM?:string;
    ADMIN_TOKEN?:string;
    APP_ORIGIN?:string;
    NODE_ENV:string;
    SENTRY_DSN?:string;
}
```

Keep the existing 80-column rule and the no-space-after-colon convention.

**Step 2: Verify type-check passes**

```bash
npm run typecheck
```

Expected: no errors. The new fields are optional so they don't break
existing code paths.

**Step 3: Commit**

```bash
git add src/server/index.ts
git commit -m "feat(billing): add stripe env bindings to worker Env type"
```
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Update `.dev.vars` and `.dev.vars.example` (rename to STRIPE_PUBLISHABLE_KEY)

**Files:**
- Modify: `/Users/nick/code/rsss/.dev.vars` (rename
  `STRIPE_PUBLIC_KEY` -> `STRIPE_PUBLISHABLE_KEY`, keep value)
- Modify: `/Users/nick/code/rsss/.dev.vars.example` (add documentation
  entries for `STRIPE_SECRET_KEY` and `STRIPE_PUBLISHABLE_KEY`)

**Why rename:** The existing `.dev.vars` uses `STRIPE_PUBLIC_KEY` from
prior experimentation, but Stripe's official terminology is "publishable
key" and the design plan specifies `STRIPE_PUBLISHABLE_KEY`. Standardizing
now avoids two parallel names and matches the Env interface added in
Task 2. `.dev.vars` is git-ignored so the rename is local-only.

**Step 1: Rename the variable in `.dev.vars`**

Open `/Users/nick/code/rsss/.dev.vars`. Find the line:

```
STRIPE_PUBLIC_KEY="pk_test_..."
```

Replace with:

```
STRIPE_PUBLISHABLE_KEY="pk_test_..."
```

Keep the existing value. If there is also a line `STRIPE_ACCT=...`, leave
it untouched (unrelated).

**Step 2: Add documentation lines to `.dev.vars.example`**

Open `/Users/nick/code/rsss/.dev.vars.example`. Append after the existing
content (after the `SENTRY_DSN=""` line):

```
# Stripe test-mode credentials. Get these from your Stripe dashboard
# (https://dashboard.stripe.com/test/apikeys). Both must be set for the
# payment-method modal to function; leave unset for dev work that
# doesn't touch billing.
STRIPE_SECRET_KEY=""
STRIPE_PUBLISHABLE_KEY=""
```

**Step 3: Verify `.dev.vars` is still git-ignored**

```bash
git check-ignore -v .dev.vars
```

Expected: output indicates `.gitignore` is ignoring it. If it's NOT
ignored, STOP — do NOT commit it.

**Step 4: Commit `.dev.vars.example` only (NOT `.dev.vars`)**

```bash
git add .dev.vars.example
git commit -m "docs(billing): document Stripe env vars in .dev.vars.example"
```
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->

<!-- START_SUBCOMPONENT_B (tasks 4-5) -->

<!-- START_TASK_4 -->
### Task 4: Create `src/server/stripe-billing.ts`

**Files:**
- Create: `/Users/nick/code/rsss/src/server/stripe-billing.ts`

**Reference patterns:**
- `/Users/nick/code/rsss/src/server/autumn-billing.ts` — mirror this
  module's shape: env interface, env-gate function, private `client()`
  factory, narrow exported helpers.
- `/Users/nick/code/rsss/src/server/autumn-billing.ts:36-38` — DID-to-id
  normalization is reused for the Autumn customerId lookup. Import
  `didToCustomerId` rather than re-implementing.

**Step 1: Write the module**

Create the file with this exact content:

```typescript
/**
 * Stripe SDK boundary for the Cloudflare Worker.
 *
 * Pairs with autumn-billing.ts: Autumn owns the canonical customer
 * record (keyed by Bluesky DID, exposing `stripe_id`); this module
 * uses the `stripe_id` to talk to Stripe directly for PaymentMethod
 * and Customer.invoice_settings operations that Autumn does not
 * expose.
 *
 * When `stripeUseLive(env)` is false (no `STRIPE_SECRET_KEY`), every
 * route that depends on this module should return 503 — there is
 * deliberately no dev-mode stub. The Autumn pull-through means we
 * never store the Stripe customer id locally; the source of truth
 * for the DID -> cus_* mapping is the Autumn customer record itself.
 */
import Stripe from 'stripe'
import { Autumn } from 'autumn-js'
import {
    didToCustomerId,
    type BillingEnv as AutumnEnv
} from './autumn-billing.js'

export interface StripeEnv extends AutumnEnv {
    STRIPE_SECRET_KEY?:string;
    STRIPE_PUBLISHABLE_KEY?:string;
}

export function stripeUseLive (env:StripeEnv):boolean {
    return Boolean(env.STRIPE_SECRET_KEY)
}

/**
 * Per-request Stripe SDK handle. Throws when the secret key is not
 * configured; callers are expected to check `stripeUseLive(env)`
 * first and return 503 to clients in that case.
 *
 * Uses `Stripe.createFetchHttpClient()` so the SDK runs on the
 * Cloudflare Workers fetch runtime (no Node `http` module).
 */
export function getStripe (env:StripeEnv):Stripe {
    if (!env.STRIPE_SECRET_KEY) {
        throw new Error(
            'stripe-billing: STRIPE_SECRET_KEY is not configured'
        )
    }
    return new Stripe(env.STRIPE_SECRET_KEY, {
        httpClient: Stripe.createFetchHttpClient()
    })
}

/**
 * Resolve the Stripe customer id (`cus_*`) for a Bluesky DID by
 * asking Autumn on every request. The Autumn customer record's
 * `stripe_id` field is the source of truth.
 *
 * Throws if Autumn isn't configured, if the Autumn customer record
 * has no `stripe_id`, or if the lookup fails. Callers should catch
 * and surface a 503 / 502.
 */
export async function getStripeCustomerId (
    env:StripeEnv,
    did:string
):Promise<string> {
    if (!env.AUTUMN_SECRET_KEY) {
        throw new Error(
            'stripe-billing: AUTUMN_SECRET_KEY is not configured'
        )
    }
    const autumn = new Autumn({ secretKey: env.AUTUMN_SECRET_KEY })
    const customer = await (autumn as unknown as {
        customers:{
            getOrCreate:(args:{ customerId:string }) =>
                Promise<{ stripe_id?:string|null }>;
        };
    }).customers.getOrCreate({
        customerId: didToCustomerId(did)
    })
    const stripeId = customer.stripe_id
    if (!stripeId) {
        throw new Error(
            'stripe-billing: autumn customer has no stripe_id'
        )
    }
    return stripeId
}
```

**Notes on the code:**

- `StripeEnv extends AutumnEnv` so handlers can pass a single `env`
  object that satisfies both. AutumnEnv already includes
  `AUTUMN_SECRET_KEY?:string`, `AUTUMN_DISABLED?:string`, and
  `NODE_ENV?:string`.
- The `as unknown as { customers: { ... } }` cast is a defensive
  narrow: `autumn-js`' type for `customers.getOrCreate` doesn't expose
  the raw `stripe_id` field, but the underlying HTTP response always
  includes it (verified in `test/signup-helpers.ts:247` and
  `test/autumn-billing.ts:20`). Future versions of `autumn-js` may
  surface `stripeId`/`stripe_id` officially — at that point the cast
  can be removed.
- No `apiVersion` is pinned. The default API version (account-level)
  is used so we follow whatever pin is configured on the Stripe
  account. If a specific pin becomes necessary in a later phase, it
  is a one-line addition here.
- Per-request instantiation is required: Cloudflare Worker isolates do
  NOT preserve sockets between requests, so a long-lived
  `const stripe = new Stripe(...)` at module scope is wrong.

**Step 2: Verify type-check passes**

```bash
npm run typecheck
```

Expected: zero errors. If `tsc` reports that `Stripe` cannot be
imported, re-run `npm install` and confirm `node_modules/stripe/index.d.ts`
exists.

**Step 3: Verify lint passes**

```bash
npm run lint
```

Expected: zero errors. The file should respect the 80-column rule and
the no-space-after-colon style.

**Step 4: Commit**

```bash
git add src/server/stripe-billing.ts
git commit -m "feat(billing): add stripe-billing module"
```
<!-- END_TASK_4 -->

<!-- START_TASK_5 -->
### Task 5: Create unit test and wire it into the runner

**Files:**
- Create: `/Users/nick/code/rsss/test/stripe-billing.ts`
- Modify: `/Users/nick/code/rsss/test/run-all-tests.mjs` (append the new
  test entry alongside the existing `billing-management.ts` entry near
  line 124)

**Pattern reference:**
- `/Users/nick/code/rsss/test/autumn-billing.ts` — same module-level
  test style, uses `globalThis.fetch` override to intercept Autumn HTTP
  calls without any extra harness.
- `/Users/nick/code/rsss/test/run-all-tests.mjs:124` — existing entry
  for `billing-management.ts` shows the esbuild + tapout command shape.

**Step 1: Create the test file**

Create `/Users/nick/code/rsss/test/stripe-billing.ts` with this content:

```typescript
import { test } from '@substrate-system/tapzero'
import {
    stripeUseLive,
    getStripe,
    getStripeCustomerId
} from '../src/server/stripe-billing.js'

test('stripeUseLive is false when STRIPE_SECRET_KEY is unset', t => {
    t.equal(
        stripeUseLive({}),
        false,
        'returns false for empty env'
    )
    t.equal(
        stripeUseLive({ STRIPE_SECRET_KEY: '' }),
        false,
        'returns false for empty-string key'
    )
})

test('stripeUseLive is true when STRIPE_SECRET_KEY is set', t => {
    t.equal(
        stripeUseLive({ STRIPE_SECRET_KEY: 'sk_test_x' }),
        true,
        'returns true when key is present'
    )
})

test('getStripe throws when STRIPE_SECRET_KEY is unset', t => {
    let threw = false
    try {
        getStripe({})
    } catch (err) {
        threw = true
        const msg = err instanceof Error ? err.message : String(err)
        t.ok(
            msg.includes('STRIPE_SECRET_KEY'),
            'error message mentions the missing key name'
        )
    }
    t.ok(threw, 'getStripe throws when unconfigured')
})

test('getStripe returns a Stripe instance when configured', t => {
    const s = getStripe({ STRIPE_SECRET_KEY: 'sk_test_x' })
    t.ok(s, 'returns a truthy SDK handle')
    t.equal(
        typeof (s as { paymentMethods?:unknown }).paymentMethods,
        'object',
        'SDK has paymentMethods namespace'
    )
})

test('getStripeCustomerId returns stripe_id from Autumn', async t => {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
        return new Response(JSON.stringify({
            id: 'did_plc_alice',
            stripe_id: 'cus_test_abc',
            email: null,
            subscriptions: []
        }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        })
    }) as typeof fetch
    try {
        const id = await getStripeCustomerId(
            {
                STRIPE_SECRET_KEY: 'sk_test_x',
                AUTUMN_SECRET_KEY: 'am_test'
            },
            'did:plc:alice'
        )
        t.equal(id, 'cus_test_abc', 'returns the stripe_id from Autumn')
    } finally {
        globalThis.fetch = originalFetch
    }
})

test(
    'getStripeCustomerId throws when Autumn record has no stripe_id',
    async t => {
        const originalFetch = globalThis.fetch
        globalThis.fetch = (async () => {
            return new Response(JSON.stringify({
                id: 'did_plc_alice',
                stripe_id: null,
                email: null,
                subscriptions: []
            }), {
                status: 200,
                headers: { 'content-type': 'application/json' }
            })
        }) as typeof fetch
        let threw = false
        try {
            await getStripeCustomerId(
                {
                    STRIPE_SECRET_KEY: 'sk_test_x',
                    AUTUMN_SECRET_KEY: 'am_test'
                },
                'did:plc:alice'
            )
        } catch (err) {
            threw = true
            const msg = err instanceof Error ? err.message : String(err)
            t.ok(
                msg.includes('stripe_id'),
                'error message mentions stripe_id'
            )
        } finally {
            globalThis.fetch = originalFetch
        }
        t.ok(threw, 'throws when stripe_id is missing')
    }
)

test(
    'getStripeCustomerId throws when AUTUMN_SECRET_KEY is unset',
    async t => {
        let threw = false
        try {
            await getStripeCustomerId(
                { STRIPE_SECRET_KEY: 'sk_test_x' },
                'did:plc:alice'
            )
        } catch (err) {
            threw = true
            const msg = err instanceof Error ? err.message : String(err)
            t.ok(
                msg.includes('AUTUMN_SECRET_KEY'),
                'error message mentions AUTUMN_SECRET_KEY'
            )
        }
        t.ok(threw, 'throws when Autumn is not configured')
    }
)
```

**Step 2: Wire the test into the runner**

Open `/Users/nick/code/rsss/test/run-all-tests.mjs` and locate the line
that runs `billing-management.ts` (around line 124). Add a new entry for
`stripe-billing.ts` immediately after it.

The block is currently shaped like (lines 122-128):

```javascript
    [
        'esbuild ./test/billing-management.ts --bundle',
        '| tapout'
    ].join(' '),
```

Add this entry immediately after (same indentation):

```javascript
    [
        'esbuild ./test/stripe-billing.ts --bundle',
        '--alias:cloudflare:workers=./test/cloudflare-workers-stub.ts',
        '| tapout'
    ].join(' '),
```

The `--alias:cloudflare:workers` is precautionary in case Stripe's
SDK transitively imports anything that resolves to a Workers-runtime
module under esbuild's Node-platform default. If `npm run test` for
the new file works without it, the alias can be removed in a
follow-up — but the alias is harmless when not needed.

**Step 3: Run the new test in isolation**

```bash
npx esbuild ./test/stripe-billing.ts --bundle \
    --alias:cloudflare:workers=./test/cloudflare-workers-stub.ts \
    | npx tapout
```

Expected: all assertions pass; final line reports `# ok` (or equivalent
tapout success summary).

**Step 4: Run the full test suite**

```bash
npm test
```

Expected: no regressions; the new `stripe-billing.ts` entry passes
alongside everything else.

**Step 5: Commit**

```bash
git add test/stripe-billing.ts test/run-all-tests.mjs
git commit -m "test(billing): unit tests for stripe-billing module"
```
<!-- END_TASK_5 -->

<!-- END_SUBCOMPONENT_B -->

<!-- START_TASK_6 -->
### Task 6: Final verification gate

This task confirms that the design's "Done when" is met before declaring
Phase 1 complete.

**Step 1: Run lint, typecheck, and the full test suite**

```bash
npm run lint && npm run typecheck && npm test
```

Expected: all three succeed with no errors.

**Step 2: Smoke-build the worker**

```bash
npx wrangler deploy --dry-run --outdir=/tmp/wrangler-smoke-1b835f15
```

Expected: dry-run build succeeds. We're not deploying — only verifying
that the worker bundle compiles with the new `stripe` import. If the
dry-run reports any unresolved module, that's a real bug; do NOT
proceed.

**Step 3: Inspect the bundle for the Stripe import**

```bash
grep -c "stripe" /tmp/wrangler-smoke-1b835f15/index.js 2>/dev/null || true
```

Expected: a non-zero count (the SDK code or its symbols are present
in the bundle). This is a sanity check, not an assertion of correctness.

**Step 4: No commit needed**

This task introduces no new files. It's the verification gate.

**Done when:**
- `npm run lint` exits 0
- `npm run typecheck` exits 0
- `npm test` exits 0 (and the new `stripe-billing.ts` test is included)
- `wrangler deploy --dry-run` exits 0
<!-- END_TASK_6 -->
