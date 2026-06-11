# Correctness Audit — Phase 2: Bind OAuth `iss` to the flow's authorization server

**Goal:** Prevent the OAuth authorization-server mix-up attack (RFC 9207) by
persisting the resolved authorization server in the OAuth state and asserting
the callback's client-supplied `iss` matches it before exchanging the code.

**Architecture:** During `startOAuthFlow`, the server resolves the user's
authorization server (`resolveHandle` → `getAuthServerMetadata`). Today that
value is **not** stored in `OAuthState`, which is persisted to KV under
`oauth:${nonce}`. At callback, the server reads `body.iss` (sent by the
browser) and passes it verbatim to `exchangeCode`, which fetches
`${iss}/.well-known/oauth-authorization-server` and POSTs the code + PKCE
verifier to whatever `token_endpoint` it returns. An attacker who controls the
returned `iss` can capture the code + verifier. The fix: add `authServer` to
`OAuthState`, populate it before persisting, and at callback reject when
`body.iss !== storedState.authServer`.

**Tech Stack:** TypeScript (Cloudflare Workers, ES2022 lib), Hono,
AT Protocol OAuth, DPoP, KV (`oauth:${nonce}`, TTL 600s).

**Scope:** Phase 2 of 8. Derived from audit finding **P1 #2**.

**Codebase verified:** 2026-06-11 (codebase-investigator). Confirmed:
`OAuthState` at `src/server/auth/oauth.ts:50–56` has fields `nonce`,
`verifier`, `returnTo`, `dpopPrivateKeyJwk`, `dpopPublicKeyJwk` — **no
`authServer`**. `authServer` is resolved at `oauth.ts:346–347`; the state
object is built at `oauth.ts:359–365`; persisted at `src/server/index.ts:667–670`;
read back at `index.ts:724–743`; `exchangeCode` signature at `oauth.ts:486–492`
takes `authServer`; callback passes `body.iss` at `index.ts:756–761` with only
a presence check at `745–749` and **no equality check**.

---

## Acceptance Criteria Coverage

This phase implements and tests (ACs derived from audit P1 #2):

### correctness-audit.AC3: OAuth callback binds `iss` to the stored authorization server
- **correctness-audit.AC3.1 Failure:** when `body.iss` does not equal the
  `authServer` stored in `OAuthState`, the callback rejects with an error
  (e.g. 400) **before** calling `exchangeCode` — no outbound token request is
  made to the attacker-supplied issuer.
- **correctness-audit.AC3.2 Success:** when `body.iss` equals the stored
  `authServer`, the callback proceeds and the code is exchanged.
- **correctness-audit.AC3.3 Success:** `OAuthState` persists the resolved
  `authServer` through the KV write/read round-trip.

---

## Notes for the executor

- This is a **functionality** phase: tests are deliverables.
- The comparison should be an exact string match on the already-normalized
  authorization-server URL the app resolved (do not re-normalize `body.iss`
  in some looser way that could reintroduce the gap). If the app stores the
  issuer with/without a trailing slash, store and compare the same canonical
  form on both sides.
- Existing OAuth tests live in `test/oauth-credential-persistence.ts` (callback
  flow) and pair `iss: 'https://auth.example'` with a mocked
  `.well-known/oauth-authorization-server` at the same URL. Mirror that style.
- Findings: `/tmp/plan-2026-06-11-correctness-audit-12661ed6/phase2-findings.md`.

---

<!-- START_SUBCOMPONENT_A (tasks 1-3) -->

<!-- START_TASK_1 -->
### Task 1: Add `authServer` to `OAuthState` and persist it

**Verifies:** correctness-audit.AC3.3

**Files:**
- Modify: `src/server/auth/oauth.ts`
  - `OAuthState` interface (~50–56): add `authServer:string`.
  - `startOAuthFlow` state construction (~359–365): set
    `authServer` from the value resolved at ~346–347.

**Implementation:**
1. Add the field to the interface (house style: no space after the colon):
   ```ts
   export interface OAuthState {
       nonce:string
       verifier:string
       returnTo:string
       dpopPrivateKeyJwk:JsonWebKey
       dpopPublicKeyJwk:JsonWebKey
       authServer:string
   }
   ```
   (Match the exact existing field types — copy them from the current file.)
2. In `startOAuthFlow`, the variable holding the resolved authorization server
   (from `const { did, authServer } = await resolveHandle(handle)` at ~346) is
   already in scope where the state object is built. Add `authServer` to that
   object literal.

**Testing:**
AC3.3: in the persistence test, after `startOAuthFlow`, read back the KV
record at `oauth:${nonce}` and assert the parsed `OAuthState` includes the
expected `authServer`. (Follow how `test/oauth-credential-persistence.ts`
currently inspects KV / state.)

**Verification:**
Run: `npm run lint` + type-check. Expected: `OAuthState` now requires
`authServer`; the build flags any construction site that doesn't set it
(there should be exactly one — `startOAuthFlow`).

**Commit:** `feat(oauth): persist resolved authServer in OAuthState`
<!-- END_TASK_1 -->

<!-- START_TASK_2 -->
### Task 2: Assert `body.iss === storedState.authServer` at the callback

**Verifies:** correctness-audit.AC3.1, AC3.2

**Files:**
- Modify: `src/server/index.ts` callback handler (~745–761).

**Implementation:**
After the existing presence check on `body.iss` (~745–749) and after
`storedState` has been read back from KV (~724–743), add an equality check
**before** the `exchangeCode` call (~756):

```ts
if (body.iss !== storedState.authServer) {
    // RFC 9207: reject an issuer not bound to this flow's auth server.
    return c.json({ error: 'invalid_iss' }, 400)
}
```

Use the same error-response shape the surrounding callback code uses for its
other rejections (match the existing pattern — JSON body vs redirect). Do not
call `exchangeCode` on the mismatch path.

**Testing:**
- AC3.1: drive the callback with a valid stored state but a mismatched
  `body.iss` (e.g. stored `https://auth.example`, callback
  `iss: 'https://attacker.example'`). Assert the response is the rejection
  (400 / `invalid_iss`) and that **no** outbound token-exchange fetch occurred
  (assert against the fetch mock — `exchangeCode`'s metadata fetch must not be
  called). Reuse the fetch-mock pattern already in the OAuth tests.
- AC3.2: drive the callback with matching `iss` and assert the existing happy
  path still completes (code exchanged, session/credentials persisted as
  today).

**Verification:**
Run: `npm test` (the OAuth callback test file). Expected: both new cases pass
and the pre-existing callback tests still pass.

**Commit:** `fix(oauth): reject callback iss not bound to stored authServer`
<!-- END_TASK_2 -->

<!-- START_TASK_3 -->
### Task 3: Backward-compatibility check for in-flight states (no behavior gap)

**Verifies:** (robustness for AC3 — no new AC)

**Files:**
- Read/Modify (only if needed): `src/server/index.ts` callback,
  `src/server/auth/oauth.ts` state parse.

**Implementation:**
`OAuthState` records live in KV for at most 600s (TTL). A record written by
the old code (no `authServer`) could in principle be read by new code during a
deploy. Decide and implement the safe behavior: an `OAuthState` missing
`authServer` (or with empty `authServer`) must **fail closed** (reject the
callback), never pass the equality check by coincidence. Confirm
`body.iss !== undefined`-vs-`authServer === undefined` cannot both be falsy in
a way that passes; if the parsed state can have `authServer === undefined`,
the strict `!==` against a defined `body.iss` already rejects — verify this
and add an explicit guard/comment so it is intentional, not accidental.

**Testing:**
Add a case: stored state with `authServer` absent/empty → callback rejects
(fails closed). This protects the deploy window.

**Verification:**
Run: `npm test`. Expected: the fail-closed case passes.

**Commit:** `test(oauth): fail closed when stored state lacks authServer`
<!-- END_TASK_3 -->

<!-- END_SUBCOMPONENT_A -->
