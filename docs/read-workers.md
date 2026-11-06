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
| `GET /world/conversations` | Two RAMs, both main-thread only. WITHOUT the store: `voices.mjs`, the voices window (a worker's copy hydrates the log once and never re-reads it; teaching the window to take a message is a change to voices.mjs, which belongs to O1), answered as `incomplete_legacy`. WITH the store engaged (POS-779): `world2/tools/convo-door.mjs`, which reads the public voices of the settlements a request needs from `acts` through one pooled client in ONE read-only repeatable-read snapshot per request (the live epoch and up to three closed ones are one picture; the snapshot is held until the request's answer is built, and a build another request has under way is joined only by a request whose own snapshot read the same fingerprint) and keeps the last views of up to four epochs in `convo-memo.mjs` (an accounted 64 MB estimate, per process, served only under an equal fingerprint). That memo is why it stays on the main thread: a worker would hold its own copy and rebuild it. The exact-component build yields to the event loop every few milliseconds of work, so the main thread is not held for a settlement's build. |
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
