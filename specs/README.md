# RSSS

Complete specification for RSSS (Really Simple Syndication Service).

This app is a lexicon and frontend logic. It uses
[the PDS](https://atproto.wiki/en/wiki/reference/core-architecture/pds)
as storage -- that means whichever PDS the given user already has is used to
store records.


## AT Protocol Integration

* login is via AT protocol (Bluesky, "web handle")
* This app has its own social feed. That means a `space.rsss.*` lexicon,
  and the social graph in this app is divorced from the Bluesky social graph
  or any other app's social graph.

### Authentication + Writes

The App View is read-only.

the write flow per record is:

1. User logs in via OAuth. As part of that, you resolved their handle → DID →
   DID document → their PDS endpoint + auth server. The OAuth client remembers
   that endpoint.
2. Frontend builds a space.rsss.* record and calls
   `com.atproto.repo.createRecord` (or `applyWrites`) against that user's PDS 
   endpoint, with the `DPoP`-bound token.
3. That PDS validates the session, signs the commit, stores it, emits it to
   the firehose.


```
          (1) OAuth login (handle → DID → PDS → auth server)
    Frontend ───────────────────────────────►  User's PDS
       │  ▲                                        │  (stores + signs
  space.rsss.* records)                            |
       │  │  (2) write records                     │
       │  │      authed XRPC (createRecord)        │ (3) firehose: signed repo commits
       │  │                                        ▼
       │  │                                      Relay / Jetstream
       │  │  (4) read aggregated views              │
       │  └──────────────  App View  ◄──────────────┘
       └────────────────►  (your index of space.rsss.* from the firehose)
```

### Validation

For a custom lexicon, the PDS mostly doesn't validate it.

The PDS always does validate

* the record is valid DAG-CBOR
* it has a syntactically valid `$type` field
* Is under the size limit
* blob references resolve
* `rkey` is well-formed

On the PDS, `com.atproto.repo.createRecord` takes a `validate` parameter with
three possible values: `true` -- require lexicon validation, `false` --
skip schema validation entirely, and unset, which means "validate only for
known lexicons."

The reference PDS (Bluesky) only "knows" the lexicons compiled into it --
`app.bsky.*` and `com.atproto.*`.

Records from this app are an "unknown lexicon" to the PDS, so it skips schema
validation and stores any structurally-valid CBOR.

That pushes lexicon enforcement onto us, in two places:

1. Frontend, before writing -- validate against the `space.rsss.*` lexicon
   (generated types, or an `@atproto/lexicon` `Lexicons` instance with our
   schemas loaded) so we never write a malformed record into the user's repo.
   This is optimistic: it keeps our own client honest, but it is not a
   security boundary.
2. App View, on every firehose record -- validate defensively. This one is
   the real boundary.

#### The App View

The App View is the real validation boundary.

Anyone can write any `space.rsss.*` record to their own PDS with any shape --
the PDS won't stop them. So the App View must treat every ingested record as
untrusted input: validate it against our lexicon and drop or quarantine
anything that doesn't conform.


#### Two ways to ingest

(should start with the second)

- Raw relay (com.atproto.sync.subscribeRepos): binary CAR/MST data, you verify
  signatures and handle repo diffs yourself. Heavy. This is the "real" path.
- Jetstream (start here): Bluesky runs a service that turns the binary
  firehose into filtered JSON over WebSocket. You connect with
  wantedCollections=space.rsss.* and receive only your records, already decoded.
  You give up doing your own signature verification (you're trusting Jetstream
  did it) in exchange for vastly less code. Most small App Views begin here and
  only graduate to a raw relay if they need trustless verification or
  independence from Bluesky's infra.

---

### Microcosm

