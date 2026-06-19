# Scheduled-drain ingestion

How to build and maintain rsss's own index of `space.rsss.*` records by
periodically draining Jetstream, instead of holding an always-on firehose
consumer.

This is the "own your index" path. The alternative — covered in
[`README.md`](./README.md) under "The App View" — is to rent the index from
microcosm (Constellation for backlinks, Slingshot for identity/records) and
run no consumer at all. Pick this path when you want queries Constellation's
link model can't serve, or independence from best-effort third-party infra.

It also sidesteps the WebSocket-hibernation dead end: a Durable Object cannot
hibernate an *outbound* socket, so a 24/7 consumer in a DO would stay pinned in
memory and bill duration the whole time. A scheduled drain opens the socket
only for a short, bounded burst, so hibernation never enters the picture.


## How it works

One global singleton actor wakes on an interval and runs a bounded drain:

1. Read the saved `cursor` (a Jetstream `time_us`, in microseconds).
2. Open a WebSocket to a Jetstream instance, filtered to `space.rsss.*`, with
   `cursor=<saved>` so it replays everything since the last run.
3. Apply each event to the local index (upsert on create/update, delete on
   delete), validating record shape first.
4. Advance the cursor past the events that were durably persisted.
5. Close the socket and go back to sleep until the next tick.

```
   alarm (≈ every 60s)
        │
        ▼
   Indexer DO ──── ws (cursor=…) ────►  Jetstream  (wantedCollections=space.rsss.*)
        │  ◄─────── replay since cursor ──────────┘
        │
        ├─ validate + upsert/delete  ──►  local SQLite index
        ├─ advance cursor
        └─ close socket, reschedule alarm

   Frontend ──── HTTP read ───►  Indexer DO  (serves the feed from its index)
```

Because the firehose never ends, "drained" means "reached the live edge or hit
a budget," not "consumed everything" — see [Stop conditions](#stop-conditions).


## Scheduling mechanism

Use a **Durable Object alarm**, not a Wrangler cron trigger. rsss already
drives periodic work with DO alarms (the feed-refresh alarm), and the existing
alarm contract is exactly what this needs:

- **Reschedule before the fallible work.** The alarm arms the next tick first,
  then runs the drain inside try/catch (swallow-and-log, no re-throw). A throw
  in the drain must never leave the DO without a future alarm. This mirrors the
  feed-refresh `alarm()` invariant already documented in `CLAUDE.md`.
- **Self-heal an overdue alarm.** Arm a fresh alarm on cold start, and re-arm a
  stored overdue alarm promptly — the same `ensureFeedRefreshArmed` pattern.
- **Single-flight for free.** A DO is single-threaded, so two ticks can never
  drain concurrently. If a drain overruns the interval, the next alarm simply
  serializes behind it.

```ts
// Inside the Indexer DO.
async alarm ():Promise<void> {
    // Reschedule first: a throw in the drain must not strand the alarm.
    await this.scheduleNextDrain()
    try {
        await this.runDrain()
    } catch (err) {
        // Next tick retries from the saved cursor; upserts are idempotent.
        console.error('indexer drain failed', err)
    }
}
```

A Wrangler cron trigger (`[triggers] crons = ["* * * * *"]`, 1-minute floor)
calling an internal DO route is the platform-agnostic equivalent. Prefer the
alarm so there is one scheduling mechanism in the codebase, not two.


## The drain

The DO opens the socket itself. It is short-lived, so being pinned in memory
for the burst is fine.

```ts
// One prefix wildcard covers the whole namespace and auto-includes
// collections you add later. Use an explicit list instead if you want only
// the collections you index today (then drop unknown ones in applyCommit).
const WANTED:string[] = ['space.rsss.*']

function jetstreamUrl (cursor:number|null):string {
    const base = 'wss://jetstream.fire.hose.cam/subscribe'
    const params = new URLSearchParams()
    for (const c of WANTED) params.append('wantedCollections', c)
    if (cursor !== null) params.set('cursor', String(cursor))
    return `${base}?${params.toString()}`
}
```

`wantedCollections` matching, verified against the Jetstream docs: it accepts
complete NSID prefixes followed by `.*` (e.g. `space.rsss.*`); the prefix
before the `.*` must itself pass NSID validation, and partial-segment
wildcards (`space.rsss.po*`) are rejected. Up to 100 collections/prefixes
combined; an empty list receives every collection. The `space.rsss` prefix is
a valid authority, so the single wildcard above is enough.

One tradeoff of the wildcard: you receive every `space.rsss.*` collection,
including ones you do not yet handle, so `applyCommit` must ignore collections
it has no validator for (it already drops anything `isValidRecord` rejects).

Pick a Jetstream host and keep a failover. Bluesky runs
`jetstream1.us-east.bsky.network` / `jetstream2.us-west.bsky.network`;
microcosm runs `jetstream.fire.hose.cam` / `jetstream2.fr.hose.cam`. They are
interchangeable — the cursor is host-independent.

### Stop conditions

A live firehose never ends, so the drain stops on the first of:

```ts
const MAX_WALL_MS = 20_000      // stay well under the Worker budget
const IDLE_MS = 2_000           // no event => replay buffer is drained
const CAUGHT_UP_US = 5_000_000  // within 5s of now => at the live edge
```

- **Idle** — no message for `IDLE_MS`. The replay buffer is empty and live is
  quiet; you are caught up.
- **Live edge** — an event whose `time_us` is within `CAUGHT_UP_US` of now
  (`Date.now() * 1000`). You have reached the present.
- **Budget** — `MAX_WALL_MS` elapsed. A backstop so one tick can never run away;
  the next alarm resumes from the saved cursor.

```ts
async function drainOnce (
    apply:(evt:JetstreamEvent) => Promise<void>,
    cursor:number|null
):Promise<number> {
    const resp = await fetch(jetstreamUrl(cursor), {
        headers: { Upgrade: 'websocket' },
    })
    const ws = resp.webSocket
    if (!ws) throw new Error('jetstream: no websocket in response')
    ws.accept()

    let last = cursor ?? 0
    const deadline = Date.now() + MAX_WALL_MS

    return await new Promise<number>((resolve, reject) => {
        let idle:ReturnType<typeof setTimeout>
        let chain:Promise<void> = Promise.resolve()

        const stop = () => {
            clearTimeout(idle)
            try { ws.close() } catch {}
            resolve(last)
        }
        const bumpIdle = () => {
            clearTimeout(idle)
            idle = setTimeout(stop, IDLE_MS)
        }

        ws.addEventListener('message', (ev) => {
            bumpIdle()
            const evt = JSON.parse(ev.data as string) as JetstreamEvent
            // Serialize: persist in order, advance cursor only after persist.
            chain = chain.then(async () => {
                if (evt.kind === 'commit') await apply(evt)
                last = evt.time_us
                const stale = Date.now() * 1000 - evt.time_us
                if (Date.now() > deadline || stale < CAUGHT_UP_US) stop()
            })
        })
        ws.addEventListener('close', stop)
        ws.addEventListener('error', (e) => {
            clearTimeout(idle)
            reject(e)
        })
        bumpIdle()
    })
}
```

This is illustrative. The load-bearing detail is the `chain`: events must be
persisted strictly in order and the cursor advanced only *after* the event is
durable, or a crash mid-batch could skip records.

### Per-event handling

Jetstream commit events look like:

```json
{
    "did": "did:plc:...",
    "time_us": 1725911162329308,
    "kind": "commit",
    "commit": {
        "operation": "create",
        "collection": "space.rsss.post",
        "rkey": "3l...",
        "cid": "bafy...",
        "record": { "$type": "space.rsss.post" }
    }
}
```

`kind` is `commit` | `identity` | `account`; index only `commit`. `operation`
is `create` | `update` | `delete` (`record` and `cid` are absent on delete).

```ts
async function applyCommit (sql:SqlStorage, evt:JetstreamEvent):Promise<void> {
    const c = evt.commit
    const uri = `at://${evt.did}/${c.collection}/${c.rkey}`

    if (c.operation === 'delete') {
        sql.exec('DELETE FROM items WHERE uri = ?', uri)
        return
    }
    // Defensive validation: the firehose is untrusted input. A signed record
    // is authentic, not necessarily valid. Drop anything off-lexicon.
    if (!isValidRecord(c.collection, c.record)) return

    sql.exec(
        `INSERT INTO items
           (uri, did, collection, rkey, cid, record, time_us, indexed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(uri) DO UPDATE SET
           cid = excluded.cid,
           record = excluded.record,
           time_us = excluded.time_us,
           indexed_at = excluded.indexed_at`,
        uri, evt.did, c.collection, c.rkey, c.cid,
        JSON.stringify(c.record), evt.time_us, Date.now()
    )
}
```

The `isValidRecord` check is the same validation boundary `README.md`
describes: anyone can write any `space.rsss.*` record to their own PDS, so the
index must validate shape on ingest and drop or quarantine non-conformers.


## Storage model

One singleton DO — `idFromName('rsss-indexer')` — owns the cursor, the index,
and the read API. Cursor and index live in the same actor, so a single drain is
one consistent unit of work.

```sql
CREATE TABLE IF NOT EXISTS items (
    uri        TEXT PRIMARY KEY,   -- at://did/collection/rkey
    did        TEXT NOT NULL,
    collection TEXT NOT NULL,
    rkey       TEXT NOT NULL,
    cid        TEXT NOT NULL,
    record     TEXT NOT NULL,      -- validated JSON
    time_us    INTEGER NOT NULL,
    indexed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS items_by_did  ON items(did);
CREATE INDEX IF NOT EXISTS items_by_coll ON items(collection, time_us);
```

```ts
async runDrain ():Promise<void> {
    const cursor = (await this.ctx.storage.get<number>('cursor')) ?? null
    const next = await drainOnce(
        (evt) => applyCommit(this.ctx.storage.sql, evt),
        cursor
    )
    if (next > (cursor ?? 0)) await this.ctx.storage.put('cursor', next)
}
```

If a single DO's SQLite (bounded per object) gets tight as the index grows,
move `items` to D1 and keep only the cursor and lock in the DO.


## Correctness invariants

- **Advance the cursor only after the batch is persisted.** On a crash the next
  tick replays from the last stored cursor. This is at-least-once delivery.
- **Idempotent writes make it effectively-once.** Upsert keyed on `uri` and
  delete-by-`uri` are both no-ops on replay, so re-delivered events are
  harmless.
- **Validate every record on ingest.** Authenticity (the signature) is not
  validity. Off-lexicon records are dropped, never indexed.
- **One scheduling mechanism.** The DO alarm, reschedule-before-fallible-work,
  matching the existing feed-refresh contract.


## Cold start and backfill

`cursor` controls history, and Jetstream only retains a **bounded replay
window**. The server trims events past its `event-ttl`
(`JETSTREAM_EVENT_TTL`), which **defaults to 24 hours**; operators can change
it per instance, so treat 24h as a planning figure, not a guarantee. Plan the
drain interval and your recovery tolerance well inside that window.

- **First run, no cursor.** Omitting `cursor` starts live-from-now and misses
  all history. To capture recent history, seed the cursor at `now - window`
  (up to ~24h back on a default instance).
- **Down longer than the window.** If the indexer is down past the retention
  horizon (≈24h by default), cursor replay cannot fill the gap; you will miss
  records committed while you were down.
- **Full history** (older than the window) is not a Jetstream job. Enumerate
  repos via `com.atproto.repo.listRecords` per DID, or lean on microcosm's
  Hubble mirror once it is generally available. Treat backfill as a separate,
  one-shot process from the steady-state drain.

State the freshness contract plainly: the index trails the live network by up
to one alarm interval plus firehose propagation. The feed does not need
sub-second freshness; if it ever does, this is the wrong design.


## Platform limits to respect

The drain runs in a Durable Object alarm, so these are the binding limits
(verified against the Cloudflare docs, June 2026):

- **Alarm wall-time ceiling: 15 minutes.** The `MAX_WALL_MS` budget (20s) sits
  far under it. Never hold the socket open across ticks.
- **CPU time: 30s default, raisable to 5 min** via `limits.cpu_ms`. Not the
  binding constraint here — the drain is I/O-bound (awaiting WS messages) and
  per-event CPU (one `JSON.parse` plus one SQLite write) is tiny. It only
  matters if a single burst is large.
- **Outbound connections: 6 simultaneous** per invocation (shared across
  `fetch`/KV/sockets, including outbound WebSockets). The drain opens one, so
  this is slack.
- A DO drain bills duration only for the ~20s burst per interval, not 24/7 —
  the point of draining over consuming.

If you take the Wrangler cron-trigger alternative instead of the alarm, the
same 15-min wall-time ceiling and CPU limits apply — but the Free plan caps
CPU at **10 ms**, too low for a drain, so that path effectively requires
Workers Paid.


## Open decisions

- Interval vs. freshness: 60s is a sane default; lower it only if the feed
  visibly lags.
- Index home: DO SQLite (simple, co-located with the read API) vs. D1 (room to
  grow). Start in the DO.
- Backfill: ship steady-state first, decide on history (listRecords vs. Hubble)
  once the live index works.
