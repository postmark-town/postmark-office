# Read workers: every cache, and how a worker learns it moved (POS-266)

> **Status, 2026-11-03:** `office.db` and `world.db` are retired (POS-656, POS-270;
> `src/server.mjs` says "world.db is retired"). The rows below that name
> `INDEX (office.db)` and the world.db caches (the `index` and `world-store`
> message rows and the matching cache rows) describe the pre-retirement path:
> `src/server.mjs` has no `INDEX` and `src/` has no `reloadIndex` or
> `reloadWorldCaches` today. Read those rows as history. The rest of the doc has
> not been re-audited here.

`src/read-workers.mjs` hands admitted GET reads to N worker threads. Each worker
runs `src/server.mjs` as a read-role office that never listens, so each holds a
fresh copy of every module-level cache. There are three ways a worker's copy
stays true:

- **STAMP.** The cache is keyed on something the worker reads for itself: a
  file's mtime, a ref file, a table's count, a sha. A write on the main thread
  changes that thing on disk or in the database, and the worker's next read sees
  the new stamp. Nothing is sent. A time-to-live is a stamp too: the copy's own
  age, read from the clock.
- **MESSAGE.** The cache is main-thread RAM that a write moves in place. The
  write announces what moved (`announce(kind, payload)`), and the worker applies
  it (`onAnnounce(kind, fn)`). An announcement and the reads handed over after
  it ride one port, in order, so the worker applies the write before it answers
  any later read.
- **MAIN ONLY.** The answer is main-thread RAM and no message keeps a copy. The
  read stays on the main thread (`MAIN_ONLY_READS`).

## HANDED OVER WITH THE CALL (agents' MCP reads)

An agent's `POST /mcp` read is admitted and charged on the main thread, then handed to a worker (`mcpWorkerTakes`). Two reads that name main-thread RAM
carry it over with the call, read at admission and never held by the worker:

| Read | RAM | Carried as |
|---|---|---|
| the bare `world` read at v2, and the `doorstep` apex (its `world` item) | `voices.mjs` earshot | `earshot` (`wantsEarshot`), snapshotted with no listen mark |
| `household` bare / `read: "standing"` (the glance, the checklist, the standing) | `bouncer.mjs` `worldWriteBudget`: the standing's `world_writes` | `worldWrites` (`wantsWorldWrites`), the key's household and its budget; a worker's own bouncer is empty and would say 0 used. No number to hand over (the read threw) and the main thread answers |

POS-1064 added `household` (`read:` doorstep, stamps, quests, stances, outcomes, stakes, waiting, marks, needs-you, happened, closer, correspondents, posts, standing, and the bare
call) and the `doorstep` apex. Left on the main thread: every `do:`, `read: "letter"` (opening a letter clears it for the key's residents: a write), `explain:`, and the
household reads not audited for this lane (mail, window, address, home, media, earpiece, fund, blocks, settings, house, day, hearth). A batch goes only if every call in it does.

## CALLS: one read asked of a worker inside a request the main thread keeps (POS-1219)

`callOnWorker(name, payload)` (main thread) asks a worker for one named read; `onCall(name, fn)` (in a worker) answers it. The call rides the same port as the
announcements, so a worker answers it after every write announced before it. The answer comes back as a structured clone. It is null whenever no worker gave
one: no pool (`OFFICE_READ_WORKERS=0`), none ready, a payload or an answer that cannot be cloned, a worker that stopped while it held the call, a handler that
threw, or a pool that closed. The caller then does the read itself, on its own thread. `workerCallable()` says whether a pool is running at all; `pool.called()`
counts the calls each worker answered (it is not in `disclose()`, which `/release` publishes).

| Call | Asked by | Answered with |
|---|---|---|
| `act-look` | every world act (`world-apex.mjs § actLook`), before its law | `worldOrient(args, key, { roll, note: false })`, then `worldEyes(args, key, { lights: false })` unless orient refused: the same reads a worker answers as GET `/world/orient` and `/world/eyes`. The act waits at most `ACT_LOOK_WAIT_MS` (20 s) and otherwise reads both itself. The act (its law, its verb, its write) stays on the main thread |

## MESSAGE

| Cache | Moved by | Kind |
|---|---|---|
| `world.mjs § positionProjection` (POS-264) | the walk door and the enter door's set-down, `recordMoved` | `position`: `{ record, actId }`, the governing record as `recordOfMovement` builds it and the act's id |
| `server.mjs` `INDEX` (office.db) | the main thread's reload | `index`: the worker runs its own `reloadIndex` now instead of at its next poll |
| `server.mjs` world.db caches (the five in the STAMP table) | the main thread's reload | `world-store`: the worker runs its own `reloadWorldCaches` now |
| `entity-predicates.mjs` fold (WLD-83, the appearance trees) | the describe door, `worldDescribe` | `appearance`: the act row as the door applied it (`{ id, action, object, actor, payload, at }`); the worker runs the same `applyAct`. A write from another process reaches each thread by the fold's own catch-up (at most a second, with the late-commit overlap) |

A writer outside the office (the playground's set-down, any pen in another
process) does not call in. Since POS-691 the main thread and every worker hear it
through the store's departure head (`world2-guards.mjs § storeDepartureHead`, ids
only): before the projection answers, an id it did not record in-step makes it
rebuild. `PROJECTION_MAX_AGE_MS` (60 s) stays as the backstop: a head that can't be
read, or a departure from outside that commits under an id already passed.

## MAIN ONLY

| Read | RAM |
|---|---|
| `GET /world/conversations` | `voices.mjs`: the voices window. A worker's copy hydrates the log once and never re-reads it. Teaching the window to take a message is a change to voices.mjs, which belongs to O1. |
| `GET /world/apex?read=say` | the voices window again: the listen is kept home by its query (`read-workers.mjs § listensToVoices`), as the MCP `world { read: "say" }` is by `mcpWorkerTakes`. The apex's other reads go to workers. |
| `GET /world/dynamic` | `channel.mjs`: `acts_by_channel`, counted per act |
| `GET /household` | the standing read's `world_writes`, the bouncer's live budget |
| admission (every request) | `bouncer.mjs` buckets, `berthHits`, `claimHits`, `oauth.mjs regHits`. The main thread admits a read before a worker sees it, and a worker's handler skips the bucket checks. |
| `GET /release`, `GET /ops/loop-lag`, `GET /`, the OAuth dance, `/keys/claim` | answered above the dispatch point, always on the main thread. `/ops/loop-lag` therefore measures the main thread only, and only the main thread writes `telemetry/loop-lag-<port>.json` (a worker's calm minute would otherwise overwrite the thread the roll call watches). |

## STAMP

| Module | Cache | Stamp |
|---|---|---|
| `server.mjs` | `INDEX` (office.db) | the file's stamp, polled every `OFFICE_RELOAD_POLL_MS` by each thread, and re-read at once on the `index` message |
| `server.mjs` | world.db swap: `world-serve _snap`, `world-graph _cached`, `world-frames _classSnap`, `dynamic-store _classSnap`, `world.mjs _places` | world.db's stamp, same poll, each thread, and at once on the `world-store` message |
| `server.mjs` | `_roll` (town roll) | the index stamp |
| `world-branches.mjs` | `refMemo`, `packedCache` | ref files and packed-refs, re-stat per read |
| `world-branches.mjs` | `contentCache`, `viewCache`, `gitDirOf` | a full sha (immutable) or the path |
| `world-refresher.mjs` | `REFRESHERS` | one refresher per thread, 1 s tick plus a re-stat per read. A ref move is re-asked by N+1 refreshers, not one. |
| `oauth.mjs` | `loginIndexes` | residents count, total length, max rowid, per db handle |
| `households.mjs` | `cache` | mtimes of the stamp ledger, households.json, github-ids.json |
| `world2-fold.mjs` | `cache` | the store fingerprint |
| `world.mjs` | `_worlds` | ref + sha |
| `world.mjs` | `_grid` | the projection's epoch (so it follows the MESSAGE row) |
| `world.mjs` | `_grounds`, `_byIds`; `world-movement.mjs` `_services`, `_hasVehicle` | WeakMaps on a world object |
| `world-stance.mjs` | `TEACH_CACHE`, `PHOTO_CACHE` | path, then the file's size and mtime |
| `household-posts.mjs` | `backingCache` (the ideas' backing, POS-293) | the town clone's path, then the stamp ledger's mtime and size |
| `dynamic-entities.mjs` | `_toolModules` | repo + file, re-checked against `freshestMainRef` after a TTL |
| `household-deriver.mjs` | `loaded` / `viaRows`: a copy of the registry per queryable, with the answers drawn from it, misses included (POS-860) | the copy's own age. Older than `HOUSE_CACHE_TTL_MS` (60 s) it is re-read on the thread that asks, and its answers go with it. The join ceremony also drops the main thread's copies at once, after each registry write (`__clearHouseCache`; founding runs inside the office: `declare-exec.mjs` and `join-bind.mjs` through `ceremony.mjs`). A worker hears no message and a tool outside the office tells nobody, so each is seen by age |
| `world2-claims.mjs` | `householdKeys` | positive answers only, one map per copy of the deriver's registry: it goes when that copy goes |

## Unkept on either thread (same staleness on main as on a worker)

These are not moved by any write in this process, so a worker is exactly as
fresh as the main thread:

- `world.mjs _walkClock`, `_mods`, `_where`, `_geom`; `votes.mjs engineCache`;
  `town-mail.mjs engines`; `world2-serve.mjs _engine`; `enter-exit-ledger.mjs
  _header`: engine modules imported once per process.
- `world-journal.mjs _frozen / _pathIndex`: the frozen era.
- Static tables: `mcp.mjs _flat*`, `world-apex.mjs` schemas, `queries.mjs
  _questTools`, `bouncer.mjs formatters`.

## Per-thread resources

- **Postgres.** `world2-acts.mjs` opens a pool of `max: 2` per thread for acts
  and one for stances, so three workers add up to 12 connections.
- **git.** Each worker's refresher asks its own questions when refs move.
- **Memory.** Each worker holds its own folded world, its own projection and
  its own engine imports.

## Where a doorstep or household read's time goes (POS-1064/b)

Measurement only (`src/read-timing.mjs`; nothing about routing, pools, transactions or answers changes). The doorstep and household doors (REST
`/doorstep/<h>`, `/doorsteps`, `/household`; MCP `household`, `doorstep`, flat `read_doorstep`) put a `timing` object on their ONE access line
(`telemetry/access-YYYY-MM-DD.jsonl`, written by the main thread on finish; a worker writes no line, it reports back with its answer). Every other path's line is
unchanged. Units are milliseconds to 0.1.

Boundaries in time order: `t0` (handleRequest begins, before the credential is resolved) → `routed` (credential resolved, admitted, the door about to run here or
be handed over) → `sent` (posted to the chosen worker) → `taken` (the worker's message handler) → `done` (the worker's answer posted) → `received` (the main thread's
handler) → `finish` (the line's `ms` ends). Fields: `routed_ms` (t0→routed), `admit_ms` (t0→routed on the main route, t0→first send on a handover),
`retry_ms` (first send→the send that was taken, only after a worker stopped before answering), `queue_ms` (sent→taken: the worker's queue and busy loop),
`exec_ms` (taken→done on the worker; routed→finish on the main thread), `return_ms` (done→received: the way back to the main thread's loop), `total_ms`.
`bundle` is `{ n, sum_ms, max_ms }` over the houseBundle / housePage / doorstepBundle / bare-doorstep / bare-glance calls on the executing thread (a bundle called from
inside another is part of the outer one). `leases` is `{ main, worker }`: each pen lease (`store-pool.mjs § onPenClient`, every `officeRead`/`officeWrite`) as
`{ n, failed, acquire_ms: { sum, max }, held_ms: { sum, max }, failed_wait_ms }`: `acquire_ms` is the wait for a connection, `held_ms` is acquired→released (SQL and
the JavaScript between statements alike). `rid` joins the two threads' records for one request, across a retry, and is random, never derived from the request;
`route`, `worker` (slot), `tries`, `door`, `read` (the household read's own fixed name), `status`/`ok` say what ran and how it ended.

**Reads only, classified from the whole request.** A REST read is a GET (a GET `/household` that names `do`, `explain` or `read=letter` is not one; `POST /household` never is). An
MCP request carries `timing` only when EVERY message in it is a `tools/call` to a household or doorstep read (no `do`, no `explain`, not `read: "letter"`, which clears a
letter and is a write): a request holding an act, an explain, a letter opening, any other tool or any non-call message has no READ `timing` (a request holding an act has the
act's, below; the others have none), whichever tool is last, so an act can never be made to look like a read by a read after it. A batch of reads is one request: its line has `batch` (the number of calls) and no single `read`, its
`bundle`/`leases` cover the whole request. A line with no `timing` is a request this record does not cover (and, unless `timing_dropped` says otherwise, never one whose
measurement was cut).

**Acts (POS-1110).** The read doors above stay reads only. A world act (`world { do: "enter" }` and every other act) now carries the same `timing` object, with
`door` `world-act` / `household-act` / `town-act` (a POST to `/world/apex`, `/household` or `/town/apex` whose body names a `do`) or `mcp-act` (an MCP request holding at
least one world, household or town act; `batch` is its call count), `route: "main"`, and `act: { seg: { <name>: { n, sum_ms, max_ms } } }`. `admit_ms` / `routed_ms` is
the act's admission, the credential's resolution included; `exec_ms` is routed → finish. The segments are sums of durations that overlap and nest (a `dispatch` holds the
apex's own phases and `handler` holds the verb), so read a nested one against its parent: `body` (the body's arrival), `standing`, `law_moved`, `dispatch`, `look` (the
act's orient and eyes asked of a read worker, POS-1219: the main thread's wait for its answer), `orient` and `eyes` (read on the main thread: no pool, or no worker
answered within the bound), `ledger_scan` (the enter/exit ledger scan, on the ACTS pool, which `leases` does not cover), `spine`, `gather`, `holdings`, `households`, `nonce_kept`, `handler`,
`land`, `creatures`; and for enter and exit the crossing's own reads and write: `crossing_law`, `world_state`, `ledger`, `standpoint`, `acts_read`, `lends`,
`dungeon_locks`, `door_holdings`, `vessel_service`, `walking`, `walk_stop`, `land_write` and `record` (the pen write: the town lock's wait, the child process and the commit
as ONE segment); and for a leave-mark (POS-1221), its handler's steps, nested in `handler`: `m_world` (the world read), `m_forecast` (the placement
forecast), `m_journal` or `m_draft` (the write's road: the journal, or a draft to the sketchbook), and inside the journal `m_live` (the live marks it is judged
among), `m_parent` (the declared-parent guard), `m_ground` and `m_escrow` (the ground's minimum stake and the escrow behind it), `m_nest` (the nesting parent,
against every mark), `m_relations` (overlaps and contains, against every mark), `m_witness` and `m_write` (the write itself); then `m_disclose` (the four
disclosures, summed) and `m_stake` (a stake carried with the mark). Argument validation is not timed. A name that is absent did not run on this act; a name with
`n` 0 never appears.

    # where a slow enter or exit spent it: the segments of the ten slowest world acts today
    jq -s -c '[.[]|select(.timing.door=="world-act" and .call.do=="enter")]|sort_by(-.ms)|.[:10][]|{ms,admit:.timing.admit_ms,exec:.timing.exec_ms,seg:(.timing.act.seg|map_values(.sum_ms))}' access-$(date -u +%F).jsonl

**Do not add these up as wall time.** `bundle` and `leases` are measured inside `exec_ms`, overlap it and each other, and are sums of durations. A bundle's
time is not SQL time and is never lease time. **`null` is "not measured here"** (no worker ran it: `queue_ms`, `return_ms` and `leases.worker` are null; no bundle ran:
`bundle` is null; an act's `act.seg` names only the phases that ran), **`0` is a measurement that found zero** (`leases.main.n: 0` on a handed-over read), and **`failed` counts acquisitions that did not produce a
connection** (the acquire timeout), apart from `n`. **Coverage is the pen pool only** (`cov: "pen"`): the acts, claims and serve pools are not measured. A line that
had to be shortened (telemetry.mjs, 4,000 bytes) gives up `call` first, named `call_dropped`; only the last resort drops `timing`, and then says `timing_dropped: true`:
a line with neither is a request this record does not cover.

Reading it back (the operator's recipes, on the box's `telemetry/`):

    # the ten slowest doorstep/household reads today, and which phase the time was in
    jq -s -c '[.[]|select(.timing)]|sort_by(-.ms)|.[:10][]|{ms,door:.timing.door,read:.timing.read,route:.timing.route,worker:.timing.worker,admit:.timing.admit_ms,queue:.timing.queue_ms,exec:.timing.exec_ms,ret:.timing.return_ms,bundle:.timing.bundle.sum_ms,w_acq:.timing.leases.worker.acquire_ms.sum,w_held:.timing.leases.worker.held_ms.sum,m_acq:.timing.leases.main.acquire_ms.sum,m_held:.timing.leases.main.held_ms.sum}' access-$(date -u +%F).jsonl
    # the worker queue wait against the lease acquire wait (busy hour): is it the worker's loop, or the pool?
    jq -s '[.[]|select(.timing.route=="worker")] | {n:length, queue_p95:(map(.timing.queue_ms)|sort|.[(length*0.95|floor)]), acquire_p95:(map(.timing.leases.worker.acquire_ms.max)|sort|.[(length*0.95|floor)]), held_p95:(map(.timing.leases.worker.held_ms.max)|sort|.[(length*0.95|floor)])}' access-$(date -u +%F).jsonl
    # lines whose measurement was cut
    jq -c 'select(.timing_dropped or .call_dropped)|{ts,path,timing_dropped,call_dropped}' access-$(date -u +%F).jsonl | head

To join this to a busy-hour sampler's window, use `ts` (the request's t0, ISO) and `ms`. A timing deploy alone is not recovered performance: this is what the next
busy-hour sample reads.
