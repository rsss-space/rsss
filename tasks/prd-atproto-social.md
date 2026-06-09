# PRD: Publish Subscriptions & Social Graph on AT Protocol

## Introduction

rsss authenticates users with Bluesky (AT Protocol) OAuth today, but it
deliberately **never** calls the user's PDS — it discards the OAuth
access/refresh tokens and DPoP keys right after login and uses the flow
only to establish a verified `(did, handle)` session
(`src/server/auth/oauth.ts`).

This feature turns rsss into a social, AT-Protocol-native reader, modelled
on grain.social: you log in with an existing Bluesky account, but your
rsss activity does **not** leak into your Bluesky timeline. rsss writes to
its own lexicons in your repo, so the data is portable and yours, but it is
invisible to the `app.bsky.feed` timeline. Three capabilities:

1. **Publish your subscription list** — with per-feed consent, each
   subscribed feed becomes a record (`space.rsss.feed.subscription`) in
   your own PDS repo. Nothing is published until you explicitly toggle it.
2. **An rsss-native follow graph** — following another rsss user writes a
   `space.rsss.graph.follow` record to your repo. This graph is **separate**
   from your Bluesky follows; following someone on rsss does not follow them
   on Bluesky and vice versa.
3. **Recommended follows from your Bluesky graph** — rsss reads your
   existing public Bluesky follows and surfaces "people you already follow
   on Bluesky who also use rsss," without copying that graph or requiring
   write access to it.

The lexicon namespace is the reverse-DNS of the deployment domain
(`rsss.space`): **`space.rsss.*`**.

## Goals

- Let users publish RSS subscriptions to their own PDS repo, one record per
  feed, with explicit per-feed consent and easy revocation.
- Keep rsss activity off the Bluesky timeline by using dedicated lexicons,
  never `app.bsky.*` writes.
- Provide an rsss-native, portable follow graph stored in users' repos and
  independent of their Bluesky social graph.
- Help users find people to follow by intersecting their public Bluesky
  follows with the set of known rsss users — read-only, no write access to
  the Bluesky graph.
- Request the **minimum** OAuth authority: granular per-collection scopes,
  never `transition:generic`.
- Never retain credentials we do not need, and store the credentials we do
  retain (refreshable DPoP-bound tokens) securely, server-side, per user.

## User Stories

Stories are grouped into phases. Phases are ordered by dependency: Phase 0
(auth + lexicons) underpins everything; Phase A (publish) is the core slice;
Phase B (native graph) and Phase C (recommendations) build on it.

---

### Phase 0 — Foundation: write-capable auth & lexicons

#### US-001: Define rsss lexicons
**Description:** As a developer, I need formal lexicon definitions so client
and server agree on the shape of records written to user repos.

**Acceptance Criteria:**
- [ ] Add lexicon JSON for `space.rsss.feed.subscription` (record): fields
      `feedUrl` (uri, required), `title` (string), `siteUrl` (uri, optional),
      `createdAt` (datetime, required). Record key is **deterministic** from
      the canonical feed URL (see FR-9) so writes are idempotent.
- [ ] Add lexicon JSON for `space.rsss.graph.follow` (record): fields
      `subject` (did, required), `createdAt` (datetime, required). Record key
      is a TID.
- [ ] Lexicons stored in a shared location importable by client and server;
      TypeScript types derived from them (no hand-duplicated shapes).
- [ ] Typecheck and lint pass.

#### US-002: Request granular OAuth scopes at login (NOT transition:generic)
**Description:** As a user, I want to grant rsss only the specific
permissions it needs, so logging in cannot let rsss touch the rest of my
repo or my Bluesky posts.

**Acceptance Criteria:**
- [ ] OAuth authorization request includes `atproto` plus
      `repo:space.rsss.feed.subscription` and `repo:space.rsss.graph.follow`.
- [ ] The request does **not** include `transition:generic` or any
      `app.bsky.*` scope.
- [ ] Client metadata document advertises the same scopes.
- [ ] Existing logged-in users are prompted to re-consent on next login
      because the scope set changed (documented, not silently broken).
- [ ] Typecheck and lint pass.

#### US-003: Persist refreshable DPoP-bound tokens per user
**Description:** As a developer, I need to retain and refresh the user's
OAuth tokens and DPoP key pair so the server can write to their PDS later,
reversing the current discard-everything design.

**Acceptance Criteria:**
- [ ] On successful OAuth exchange, persist access token, refresh token,
      token endpoint, PDS service endpoint, and the DPoP private key (as
      JWK) in the user's Durable Object, scoped to that DID.
- [ ] Tokens are stored only server-side; never sent to the browser.
- [ ] A refresh routine exchanges an expired access token using the refresh
      token + DPoP proof, and persists the rotated tokens.
- [ ] The `OAuthSession`/comment in `src/server/auth/oauth.ts` is updated to
      reflect that we now call the PDS, including the security rationale.
- [ ] No tokens or DPoP keys are ever logged.
- [ ] Typecheck and lint pass.

#### US-004: PDS write client (create / put / delete record)
**Description:** As a developer, I need a server-side helper that performs
authenticated, DPoP-signed record writes against a user's PDS, refreshing
tokens transparently on 401.

**Acceptance Criteria:**
- [ ] Helper supports `com.atproto.repo.putRecord`,
      `com.atproto.repo.createRecord`, and `com.atproto.repo.deleteRecord`
      with DPoP proofs bound to the stored key.
- [ ] On a `401` / `use_dpop_nonce` / expired-token response, it refreshes
      (or retries with the server nonce) once and replays the write.
- [ ] On unrecoverable auth failure it surfaces a typed error the caller can
      map to "reconnect your account" UX.
- [ ] Errors are reported via the existing `reportError` path without
      leaking token material.
- [ ] Typecheck and lint pass.

---

### Phase A — Publish the subscription list (per-feed consent)

#### US-A1: Track per-feed publish state
**Description:** As a developer, I need to know which feeds a user has
published so the UI can reflect it and writes stay idempotent.

**Acceptance Criteria:**
- [ ] Per-feed publish state persisted in the user's DO: `published`
      (bool), `rkey`, `publishedAt`, last sync error (nullable).
- [ ] State is exposed to the client through the existing sync path
      (server-authoritative, mirrored locally) — no new ad-hoc channel.
- [ ] Adding the column(s) does not break existing sync/migration.
- [ ] Typecheck and lint pass.

#### US-A2: "Share on Bluesky" toggle per feed
**Description:** As a user, I want a clear per-feed control to publish or
unpublish that single subscription, so nothing is shared without a
deliberate action.

**Acceptance Criteria:**
- [ ] Each feed in the feeds view has a toggle/affordance labelled for
      sharing to Bluesky (copy reviewed in US-A6).
- [ ] Toggle reflects current published state on load (on = published).
- [ ] Toggling shows an in-progress state and a published/failed result.
- [ ] Toggle uses an `<a href>`-driven action only where navigation is
      involved; in-place state changes use the existing signals pattern
      (see project memory: links not buttons for navigation).
- [ ] Sequentially updated signals are wrapped in `batch`.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-A3: Publish a subscription record on toggle-on
**Description:** As a user, when I enable sharing for a feed, that feed
appears as a record in my PDS repo.

**Acceptance Criteria:**
- [ ] Toggling on calls a server endpoint that writes a
      `space.rsss.feed.subscription` record via `putRecord` with the
      deterministic rkey.
- [ ] Re-publishing the same feed updates rather than duplicates (idempotent
      on rkey).
- [ ] On success, `published`/`rkey`/`publishedAt` are persisted and synced.
- [ ] On failure, state stays unpublished and a user-visible error is shown;
      a re-auth-required error routes the user to reconnect.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-A4: Unpublish on toggle-off or unsubscribe
**Description:** As a user, when I disable sharing or unsubscribe from a
feed, its record is removed from my PDS repo.

**Acceptance Criteria:**
- [ ] Toggling off calls `deleteRecord` for that feed's rkey and clears
      publish state.
- [ ] Unsubscribing from a feed that was published also deletes its record
      (no orphaned records in the repo).
- [ ] Deleting an already-absent record is treated as success (idempotent).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-A5: Reconcile published state with the repo
**Description:** As a user, I want the share indicators to reflect what's
actually in my repo even if a write previously failed or I used another
client.

**Acceptance Criteria:**
- [ ] A reconcile routine lists `space.rsss.feed.subscription` records via
      `com.atproto.repo.listRecords` and aligns local publish state to it.
- [ ] Drift (record exists but state says unpublished, or vice versa) is
      corrected without losing the user's intent where it is unambiguous.
- [ ] Reconcile runs on a sensible trigger (e.g. opening the feeds view
      after reconnect) and is rate-limited.
- [ ] Typecheck and lint pass.

#### US-A6: Consent & privacy copy for publishing
**Description:** As a user, I want to understand that publishing puts my
subscription on the public AT Protocol network before I do it.

**Acceptance Criteria:**
- [ ] First publish (or a nearby info affordance) explains: records are
      written to your own PDS, are public on the AT Protocol network, do not
      appear in your Bluesky timeline, and can be removed.
- [ ] Copy follows the clarify/UX-writing conventions; no font below 1rem;
      colors use existing CSS variables.
- [ ] CSS changes are scoped to this feature only.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

---

### Phase B — rsss-native follow graph

#### US-B1: Known-rsss-user registry
**Description:** As a developer, I need a registry of DIDs that use rsss so
the app can offer follows and discovery.

**Acceptance Criteria:**
- [ ] On successful login, the user's `(did, handle)` is recorded in a small
      login-derived registry (we already see every login; this is the
      authoritative source for our own user base — see Technical
      Considerations).
- [ ] Registry lookups can answer "is DID X an rsss user?" and "give me the
      rsss users among this set of DIDs."
- [ ] No PII beyond DID/handle/avatar is stored in the registry.
- [ ] Typecheck and lint pass.

#### US-B2: Follow / unfollow an rsss user
**Description:** As a user, I want to follow another rsss user so I can see
their published subscriptions, without affecting my Bluesky follows.

**Acceptance Criteria:**
- [ ] Following writes a `space.rsss.graph.follow` record (subject = target
      DID) to my repo; unfollowing deletes it.
- [ ] The write does **not** create or modify any `app.bsky.graph.follow`
      record.
- [ ] Reverse ("followers") lookups are served by Constellation backlinks,
      not a home-grown edge index (see US-B4). The server may optimistically
      reflect a new follow before Constellation indexes it.
- [ ] Follow state is idempotent (re-follow does not duplicate).
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-B3: View an rsss user's published subscription list
**Description:** As a user, I want to view another user's shared
subscriptions so I can decide whether to follow or subscribe to the same
feeds.

**Acceptance Criteria:**
- [ ] A profile/list view reads the target's
      `space.rsss.feed.subscription` records — preferably through the
      Slingshot record cache, falling back to public `listRecords` against
      the target PDS (no auth required to read public data).
- [ ] Each listed feed offers a one-action subscribe-for-myself affordance.
- [ ] Handles/DIDs resolve to a display name + avatar.
- [ ] Empty and error states are handled.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

#### US-B4: View my following / followers
**Description:** As a user, I want to see who I follow on rsss and who
follows me.

**Acceptance Criteria:**
- [ ] "Following" lists subjects of my `space.rsss.graph.follow` records.
- [ ] "Followers" is answered via Constellation backlinks targeting my DID
      (`getBacklinks`/`getDistinct`, collection `space.rsss.graph.follow`,
      path `.subject`); counts use `getBacklinksCount`.
- [ ] UI tolerates Constellation indexing latency (eventual consistency) and
      degrades gracefully if the service is unavailable.
- [ ] Counts and lists paginate or cap sensibly for large graphs.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

---

### Phase C — Recommended follows from Bluesky graph

#### US-C1: Read the user's public Bluesky follows
**Description:** As a developer, I need the user's existing Bluesky follows
to compute recommendations, using only public data.

**Acceptance Criteria:**
- [ ] Server fetches the user's follows via the public appview
      (`app.bsky.graph.getFollows`) by DID, paginating as needed.
- [ ] No `app.bsky.*` OAuth scope is requested and no write to the Bluesky
      graph occurs.
- [ ] Results are cached briefly to avoid hammering the appview.
- [ ] Typecheck and lint pass.

#### US-C2: Compute recommendations
**Description:** As a user, I want suggestions of people I already follow on
Bluesky who also use rsss.

**Acceptance Criteria:**
- [ ] Recommendations = (Bluesky follows of the user) ∩ (rsss registry)
      minus people the user already follows on rsss.
- [ ] Result includes handle, display name, avatar, and (optionally) a count
      of their shared feeds.
- [ ] Typecheck and lint pass.

#### US-C3: Recommended-follows UI
**Description:** As a user, I want to act on recommendations easily.

**Acceptance Criteria:**
- [ ] A discovery surface lists recommended rsss users with a follow action
      (reuses US-B2).
- [ ] Clear empty state ("none of your Bluesky follows use rsss yet").
- [ ] Messaging makes clear rsss is not reading your posts or writing to
      your Bluesky graph.
- [ ] Colors use existing variables; CSS scoped to this feature.
- [ ] Typecheck and lint pass.
- [ ] Verify in browser using dev-browser skill.

## Functional Requirements

- FR-1: The system must use the lexicon namespace `space.rsss.*` (reverse
  DNS of `rsss.space`).
- FR-2: The OAuth authorization and client metadata must request exactly
  `atproto`, `repo:space.rsss.feed.subscription`, and
  `repo:space.rsss.graph.follow`. The system must **not** request
  `transition:generic` or any `app.bsky.*` scope.
- FR-3: On a successful OAuth exchange, the system must persist the access
  token, refresh token, token endpoint, PDS endpoint, and DPoP private key
  per-DID, server-side only, and must refresh tokens with a DPoP proof when
  they expire.
- FR-4: The system must never send OAuth tokens or DPoP private keys to the
  browser and must never log them.
- FR-5: Publishing must be per-feed and opt-in; no subscription record may
  be written without an explicit user action on that feed.
- FR-6: Enabling sharing for a feed must `putRecord` a
  `space.rsss.feed.subscription` record to the user's repo; disabling
  sharing or unsubscribing must `deleteRecord` it.
- FR-7: All record writes/deletes must be idempotent: re-publishing updates
  in place, deleting an absent record succeeds.
- FR-8: The system must never write `app.bsky.*` records (no leaking rsss
  activity into the Bluesky timeline or follow graph).
- FR-9: Subscription record keys must be deterministically derived from the
  canonical feed URL so a feed maps to exactly one record per repo.
- FR-10: The system must track per-feed publish state (`published`, `rkey`,
  `publishedAt`, last error) in the user's DO and expose it via the existing
  sync mechanism.
- FR-11: Following another rsss user must `createRecord` a
  `space.rsss.graph.follow` record; unfollowing must `deleteRecord` it.
- FR-12: A small login-derived registry must record known rsss DIDs so the
  app can answer "is X an rsss user?" and intersect with a set of DIDs.
  Reverse follow queries ("who follows X?") must be served by the
  Constellation backlink index rather than a home-grown follow-edge index.
- FR-13: Viewing another user's published list must read public records
  (preferring the Slingshot cache, falling back to
  `com.atproto.repo.listRecords`) and require no elevated authority.
- FR-14: Recommendations must be computed as the intersection of the user's
  public Bluesky follows (`app.bsky.graph.getFollows`) with the rsss
  registry, excluding existing rsss follows.
- FR-15: When a write fails because authority was revoked/expired and cannot
  be refreshed, the system must surface a "reconnect your account" path
  rather than silently failing.
- FR-16: A reconcile routine must align local publish state with the actual
  contents of the user's repo.
- FR-17: Aggregation/cache reads must use the hosted Constellation and
  Slingshot services, with their base URLs read from configuration (env /
  `wrangler.jsonc` vars) so a self-hosted `microcosm-rs` can be substituted
  without code changes. A descriptive `User-Agent` identifying rsss must be
  sent on these requests.

## Non-Goals (Out of Scope)

- No writing to `app.bsky.*` collections; rsss activity never appears in the
  Bluesky timeline or Bluesky follow graph.
- No use of `transition:generic` or app passwords.
- No importing the user's Bluesky follow graph into the rsss follow graph
  (recommendations are read-only suggestions, not a migration).
- No running our own AT Protocol appview / firehose (Jetstream) ingestion
  service in this iteration; network-wide aggregation (followers, backlinks,
  record caching) relies on the microcosm services — Constellation,
  Slingshot, and optionally Spacedust (see Technical Considerations).
- No publishing of article reads, stars, or reading activity — only the
  subscription list and the follow graph.
- No DMs, comments, likes, or reposts.
- No cross-instance federation of the rsss index (single deployment assumed).

## Design Considerations

- Reuse existing components: feeds view (`src/client/routes/feeds.ts`),
  `@substrate-system/check-box`/`button`/`dialog`, and the settings
  disclosure patterns already in the app.
- Per-feed share control lives in the feeds list; profile/discovery surfaces
  are new routes under `src/client/routes/`.
- Follow project CSS rules: nested selectors over class proliferation, all
  colors from `_variables.css`/`_vars.css`, no font size below 1rem, and
  never touch CSS unrelated to this feature.
- Navigation uses `<a href>` (route-event handles link clicks globally), not
  `onClick` handlers that set the URL.
- Use `@preact/signals` for state and wrap sequential signal writes in
  `batch`.
- Be explicit in copy that publishing is public and reversible, and that
  rsss does not post to Bluesky.

## Technical Considerations

- **Reversing the token-discard design:** `src/server/auth/oauth.ts` is
  currently written around *not* retaining tokens. US-003 changes this; the
  module comment must be updated and the DPoP key pair persisted alongside
  tokens (the code already anticipates this in `restoreDPoPKeyPair`).
- **Granular scopes maturity:** AT Protocol granular OAuth scopes
  (`repo:<nsid>`) are newer than `transition:generic`. Confirm the target
  PDS implementations honor per-collection scopes; if a PDS rejects them,
  that is a blocker to resolve with the AT Proto team rather than a reason
  to fall back to `transition:generic`. Track in Open Questions.
- **Aggregation via microcosm services (instead of our own index):** the
  microcosm.blue building blocks index the raw firehose and work with *every*
  lexicon, including our custom `space.rsss.*`, so we avoid building and
  running a cross-user index:
  - **Constellation** — global backlink index. Answers "who follows me?" by
    querying backlinks to a DID:
    `GET /xrpc/blue.microcosm.links.getBacklinks?target=<did>`
    `&collection=space.rsss.graph.follow&path=.subject`; also `getDistinct`
    (unique DIDs) and `getBacklinksCount` (count). Replaces a home-grown
    follow-edge index for reverse lookups.
  - **Slingshot** — record + identity cache for fast, resilient reads of
    other users' records (e.g. their published subscription list) and
    DID/handle resolution.
  - **Spacedust** — generic backlink notification webhooks; the path to
    real-time "new follower" notifications later. Out of MVP scope.
  **Decision:** use the **hosted** Constellation and Slingshot instances at
  `constellation.microcosm.blue` / `slingshot.microcosm.blue`. Service
  base URLs must be configurable (env/`wrangler.jsonc` vars) so we can point
  at a self-hosted `microcosm-rs` later without code changes — that is the
  documented fallback if the hosted services prove unreliable, since
  `microcosm-rs` is open source and cheap to run ("<2 GiB/day, runs on a
  Raspberry Pi"). Tradeoffs to design around regardless of host: there is
  **indexing latency**, so use optimistic UI plus reconcile and degrade
  gracefully when a service is down; identify rsss in a descriptive
  `User-Agent` per their politeness guidance. The PDS records remain the
  canonical, portable source of truth; these services are read/index caches.
- **Login-derived registry only:** the one bit of state we keep centrally is
  a registry of DIDs that have logged into rsss, used to answer "is X an
  rsss user?" for recommendations. It is small and authoritative for our own
  user base; store it where convenient (singleton DO SQLite or D1).
- **Reads are public:** viewing lists and computing Bluesky-follow
  recommendations use public, unauthenticated endpoints (Slingshot /
  `listRecords`, `app.bsky.graph.getFollows`), so they need neither the
  user's tokens nor any scope.
- **Library choice:** OAuth is currently hand-rolled (no `@atproto/*` dep).
  Decide whether to add `@atproto/api` / an OAuth client lib for
  DPoP-signed writes and token refresh, or extend the existing hand-rolled
  code. Either way it must run on the Cloudflare Workers runtime.
- **Rate limits & retries:** PDS writes and appview reads are rate-limited;
  reuse/extend the existing `src/server/middleware/rate-limit.ts` and add
  backoff for `use_dpop_nonce` retries.
- **Deterministic rkeys:** Derive the subscription rkey from the canonical
  feed URL (e.g. a stable hash encoded to a valid record-key charset) so the
  feed↔record mapping is 1:1 and idempotent.

## Success Metrics

- A user can publish a feed to their PDS in one action and confirm the
  record exists in their repo.
- Published records are readable by other AT Protocol clients but never
  appear in the user's Bluesky timeline or follow graph.
- Unpublishing/unsubscribing leaves zero orphaned records in the repo.
- rsss requests only the three intended scopes (verifiable in the auth
  request) and never `transition:generic`.
- Recommendations correctly surface rsss users among a test account's
  Bluesky follows, with no write to the Bluesky graph.

## Open Questions

- Do the PDS implementations we target fully support granular
  `repo:<nsid>` OAuth scopes today? What is the contingency if a major PDS
  does not (without resorting to `transition:generic`)?
- What's the acceptable staleness window for Constellation-backed follower
  data, and do we need Spacedust webhooks for real-time updates sooner than
  planned? (Decision settled: use the hosted Constellation/Slingshot, with
  configurable base URLs so a self-hosted `microcosm-rs` is a drop-in
  fallback.)
- Where does the small login-derived registry live (singleton DO SQLite vs
  D1), given the existing deployment and migration tooling?
- Should the lexicon NSIDs nest further (e.g.
  `space.rsss.feed.subscription` vs `space.rsss.subscription`)? Confirm the
  exact NSIDs before publishing records, since changing them later orphans
  data.
- Adopt `@atproto/api`/OAuth client lib, or extend the hand-rolled
  Workers-native implementation?
- Should we provide a one-time "publish my whole list" convenience action in
  addition to per-feed toggles, or keep publishing strictly per-feed?
- How should we handle a user who revokes the rsss app grant from their PDS
  (records remain, but we lose write access) — surface a reconnect prompt,
  and what happens to the central index in the meantime?
- For very large Bluesky follow lists, what's the cap/pagination strategy
  for recommendations to stay within appview rate limits?
