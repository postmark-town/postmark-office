-- 026 — events + event_rsvps: the calendar's current state (POS-207, POS-208, w40)
--
-- THE SHAPE, decided by Wright 2026-09-24 and disclosed to Keemin: "The record
-- is the act log; the table is its projection." Hosting, amending, cancelling
-- and RSVPing are ACTS in `acts` (class `event`; action `host` | `amend-event`
-- | `cancel-event` | `rsvp`; object = the event's id), so every revision stays
-- visible, as Rei's blueprint asks ("Moving, canceling, or shortening an event
-- must remain visible as a revision, never a silent replacement").
--
-- These two tables hold the CURRENT state that the calendar read serves. The
-- office pen writes them in the SAME transaction as the act (src/events-store.mjs),
-- and `world2/tools/events-rebuild.mjs --dry-run` rebuilds them from `acts`
-- alone and says whether the rebuild equals what is stored. Both paths take the
-- row from one pure function (src/events.mjs § applyEventAct), so the pen and
-- the rebuild cannot come to disagree about what an act means.
--
-- ── THE ONE THING THE ACTS DO NOT CARRY ─────────────────────────────────────
--
-- `event_rsvps.address` holds a webhook URL or a Letta conversation. `acts` is
-- the table that leaves the box: the notary exports it into a public git repo,
-- frozen on write (src/world2-pen.mjs § `act: false`). An RSVP's address is a
-- household's private fact, and the public calendar read never carries it
-- either. So the act records the harness KIND and the budget, and the address
-- rides only here. A rebuild restores every column except `address`, and the
-- rebuild tool names that column as the one it cannot restore. Where a
-- household's private harness facts should live (007's RLS territory, beside
-- the webhook secret) is a STOP in the lane's report, and is not decided here.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, because the household door that performs the acts connects as
-- it (the same reason 019 gives). INSERT + UPDATE and no DELETE: an amendment
-- or a cancellation UPDATEs the current row (the history is the act log), and a
-- second RSVP from the same resident replaces their first. Nothing is removed.
-- A cancelled event keeps its row and its id.
--
-- `event_rsvps` is SELECT to `office_api` ONLY, because of `address`. `events`
-- is public, like the read that serves it.
--
-- 003_falsifier_roles.sql's lawful list carries the four matching rows in the
-- same commit, so test/registry-grants.test.mjs stays green.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/026_events.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the tables and the index,
-- `ON CONFLICT DO NOTHING` on the registry rows, and a GRANT is idempotent.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner FROM pg_tables WHERE tablename IN ('events','event_rsvps');
--   SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name IN ('events','event_rsvps') ORDER BY 1, 2, 3;
--   SELECT * FROM registry WHERE object IN ('events','event_rsvps');
--   node world2/tools/events-rebuild.mjs --dry-run   -- "equal"
--
-- CONSUMERS, named: src/events-store.mjs (the pen and the calendar read),
-- world2/tools/events-rebuild.mjs (the rebuild and its equality check),
-- test/events.test.mjs (through a JS stub of these tables; the stub proves the
-- JS, not the store). Nothing else reads them yet. The site's `calendar.json`
-- ingest reads the calendar READ, never these tables.

BEGIN;

CREATE TABLE IF NOT EXISTS events (
  id          text PRIMARY KEY,                -- <host-handle>/<slug>; never reused, a cancelled event keeps it
  title       text NOT NULL,
  invitation  text NOT NULL DEFAULT '',        -- resident-authored, at most 600 chars (the reading law)
  host        text NOT NULL,                   -- the one accountable resident
  household   text,                            -- the host's household key, as insertAct spells it on the act
  place_mark  text,                            -- <owner>/<slug> of a standing mark, or NULL for a bare point
  place_x     double precision NOT NULL,       -- ABSOLUTE world coordinates, always (a mark's centre when place_mark is set)
  place_y     double precision NOT NULL,
  doors_open  timestamptz NOT NULL,
  starts      timestamptz NOT NULL,
  ends        timestamptz NOT NULL,
  revised     integer NOT NULL DEFAULT 0 CHECK (revised >= 0),   -- how many amend-event acts
  cancelled   boolean NOT NULL DEFAULT false,
  hosted_act  bigint NOT NULL,                 -- acts.id of the host act
  last_act    bigint NOT NULL,                 -- acts.id of the newest act that changed this row
  CONSTRAINT events_interval CHECK (ends > starts AND doors_open <= starts)
);
CREATE INDEX IF NOT EXISTS events_ends_idx ON events (ends);

CREATE TABLE IF NOT EXISTS event_rsvps (
  event       text NOT NULL REFERENCES events(id),
  handle      text NOT NULL,                   -- the resident who RSVPed
  household   text,
  harness     text NOT NULL CHECK (harness IN ('letta','webhook','mail')),
  address     text,                            -- PRIVATE: the webhook URL or the Letta conversation; never in acts, never in the public read
  budget      integer NOT NULL CHECK (budget BETWEEN 1 AND 60),  -- wakes per event, the resident's own dial
  fell_back   text,                            -- why a webhook became mail, when it did
  act         bigint NOT NULL,                 -- acts.id of the rsvp act this row reflects
  PRIMARY KEY (event, handle)
);

GRANT SELECT ON events TO office_api, clearing_job, snapshot_reader;
GRANT SELECT ON event_rsvps TO office_api;
GRANT INSERT, UPDATE ON events, event_rsvps TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('events', 'projection', 'office_api', '{clearing_job,snapshot_reader}',
   'Wright 2026-09-24 (POS-207, disclosed to Keemin): the record is the act log (class event), this table its current-state projection, rebuildable by world2/tools/events-rebuild.mjs'),
  ('event_rsvps', 'projection', 'office_api', '{}',
   'Wright 2026-09-24 (POS-207/208): one row per resident per event, the rsvp acts projection; address is private and rides only here')
ON CONFLICT (object) DO NOTHING;

COMMIT;
