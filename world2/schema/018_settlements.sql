-- 018 — settlements: the store records a blessing (postmark#2897, POS-104 box 4)
--
-- RULED (Keemin, 2026-09-17 20:2x EDT, on postmark#2897): "I'm fine with a
-- simple settlements table shipped in w39." One row per `settlement/S<n>` tag —
-- number, the sha it blesses, when the crossing published, the window that
-- crossing closed, when the keeper blessed it. The tags stay the git-side
-- receipt; `/world2/settlements` reads this table in 1.0's shape.
--
-- ── WHAT A SETTLEMENT IS, MEASURED BEFORE THIS WAS WRITTEN ───────────────────
--
-- Until this file the store had no settlement anywhere: no table, no `acts`
-- row (18 distinct actions, none of them), and `windows.id` is the CANDLE's
-- window (196 open on 2026-09-18) while the world's tags stand at S71.
-- `/world/settlements` is `git tag --list 'settlement/S*'` plus one
-- `git log -1 --format=%cI` per tag over the office's world clone, nothing else
-- (src/settlements.mjs: "the truth is the world repo's own git TAGS … which
-- exist only when a settlement actually landed").
--
-- The tag is NOT written by the crossing. `deploy/settlement-auto.sh` pushes
-- world main and says so in its own header: "NO TAGS from here: settlement/S<N>
-- blessing stays the Worldkeeper's pen". All 71 tags are ANNOTATED tag objects,
-- 70 by "the Worldkeeper" (two noreply emails over time) and S1 by Keemin, made
-- from the keeper's own clone at his heartbeat ~20 minutes after the crossing
-- (S71: sweep commit 05:46:08Z, tag 06:08:49Z). Not every crossing is blessed:
-- three publishes sit between S70 (09-15 05:46Z) and S71 (09-17 05:46Z), and
-- seven sat between S50 and S51. So the NUMBER is the keeper's, assigned only
-- on a clean judgment, and a row here can exist only once the tag does. The
-- bless IS the tag; there is no second event.
--
-- ── THE COLUMNS, EACH NAMING ITS SOURCE ──────────────────────────────────────
--
--   number        the <n> of `settlement/S<n>` — the keeper's count of blessings,
--                 never of heartbeats (ruled 2026-08-08; a refused gate does not
--                 increment, the next clean judgment takes the next number).
--                 Contiguous today, S1–S71; 1.0's reader tolerates a gap and
--                 so does this table — neither invents a number to fill one.
--   tag_sha       the COMMIT the tag blesses — `settlement/S<n>^{commit}`, 40 hex.
--                 NOT the tag object's own sha: `rev-parse settlement/S49` returns
--                 the tag OBJECT (replay-ingest.mjs:236), a value no log carries.
--                 1.0's `sha` is this commit, abbreviated; the store keeps it whole.
--   published_at  that commit's COMMITTER date — when the crossing pushed world
--                 main. This is what 1.0 serves as `date` (its own header calls
--                 it "when the blessing actually landed", which is the crossing,
--                 not the bless — the two differ by ~20 minutes on every box-era
--                 tag). Kept as the twin's `date` so the two doors agree.
--   window_id     the candle window that crossing closed: the newest `windows`
--                 row whose `closes_at` is at or before `published_at`. Checked
--                 against the crossing's own journal line for S71 ("docket:
--                 window 194 locked at 2026-09-17T05:45:45.550Z" → 194). NULL
--                 for every tag older than the store's first window (id 150,
--                 opened 2026-08-26): S1–S46 closed no window this store holds;
--                 S47 (2026-08-26T05:45:16Z) closed window 150 to the second.
--   blessed_at    the tag OBJECT's tagger date — the keeper's bless. NULL only
--                 for a lightweight tag, which carries no date of its own (none
--                 of the 71 is lightweight today).
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- The brief's rule was "the pen that pushes the tag may INSERT". No office pen
-- pushes the tag (above), so that rule names nothing. The pen granted here is
-- `office_api`, and the choice is written down so it can be overruled in one
-- word before the ship: the row is written from the office's OWN world clone —
-- the one whose fetch already carries the tags to 1.0's read ("tags ride the
-- tick's existing fetch", settlements.mjs) — under the connection that clone's
-- tick already holds (`WORLD2_PG_URL` in /etc/postmark-office.env). Of the three
-- pens it is the only one that can see a new tag without a unit change:
-- `clearing_job` runs BEFORE the crossing, at the window's close, and
-- `law_ingester`'s only units are the clearing (same) and the parked ingest
-- (#2893). INSERT only — no UPDATE, no DELETE, to any pen: a blessing is canon
-- ("a late settlement is recoverable; a bad blessing is canon", the keeper's
-- own standing rule), and a moved tag is a finding for a person, not a row to
-- rewrite. The owner repairs by hand if it ever comes to that.
--
-- 003_falsifier_roles.sql's lawful list carries the matching row in the same
-- commit, so the three-pens falsifier stays green on this grant. (It is RED on
-- prod today for 014's `escrow_projection` grants, which 014 never added to
-- that list — a pre-existing red, named in the lane's report, not touched here.)
--
-- ── WHO WRITES THE ROW, AND WHEN ─────────────────────────────────────────────
--
-- `world2/tools/settlements-backfill.mjs` derives the rows from a checkout and
-- writes the ones the table lacks; run once at the ship it fills S1–S71, run
-- after any bless it adds exactly that tag. The lane stopped on WHICH office
-- step runs it (the brief placed it "in the same script" as the tag push, and
-- no office script pushes the tag); Wright ruled 2026-09-17: the office tick,
-- `deploy/office-tick.sh § settlements-on-tick`, every 15 minutes right after
-- the world fetch that carries the tag in, non-fatal, one receipt line in the
-- tick's journal. So the table is at most one tick behind a bless — the same
-- freshness 1.0's own tag read has always had — and the twin says so.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/018_settlements.sql
--
-- Applied as `postgres` instead, the table's owner diverges and nothing fails
-- (014's lesson; the divergence is silent and permanent). A second run is a
-- no-op: `IF NOT EXISTS` on the table, `ON CONFLICT DO NOTHING` on the registry
-- row, and a GRANT is idempotent by nature.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tableowner FROM pg_tables WHERE tablename = 'settlements';   -- world2_owner
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'settlements' ORDER BY 1, 2;
--     -- clearing_job SELECT · law_ingester SELECT · office_api INSERT ·
--     -- office_api SELECT · snapshot_reader SELECT · world2_owner (all)
--   SELECT * FROM registry WHERE object = 'settlements';
--   psql -f world2/schema/003_falsifier_roles.sql   -- no `settlements` row
--
-- Then the backfill, dry-run first, apply second; the tool's own header carries
-- both lines and the proof that the table equals the clone's tags afterwards.
--
-- CONSUMERS, named: `src/world2-serve.mjs § /world2/settlements` (the twin),
-- `test/world2-settlements-reads.test.mjs` (its fixture falsifier),
-- `world2/tools/settlements-backfill.mjs` (the writer and the live equality
-- check). Nothing else reads it yet; at the standing flip `/world/settlements`
-- will, and that is a later lane's wiring.

BEGIN;

CREATE TABLE IF NOT EXISTS settlements (
  number       integer PRIMARY KEY CHECK (number >= 0),        -- S<number>
  tag_sha      text NOT NULL CHECK (tag_sha ~ '^[0-9a-f]{40}$'), -- the blessed COMMIT, never the tag object
  published_at timestamptz NOT NULL,                             -- the crossing's push (committer date)
  window_id    integer REFERENCES windows(id),                   -- the window that crossing closed; NULL before window 150
  blessed_at   timestamptz                                       -- the keeper's tag (tagger date); NULL for a lightweight tag
);

GRANT SELECT ON settlements TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON settlements TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('settlements', 'source', 'office_api', '{clearing_job,law_ingester,snapshot_reader}',
   'Keemin 2026-09-17 (postmark#2897): a simple settlements table, shipped in w39 — one row per settlement/S<n> tag, written after the tag lands; the tags stay the git-side receipt')
ON CONFLICT (object) DO NOTHING;

COMMIT;
