-- 074 — arrival_entries: a walk's "enter on arrival", queued until the walker arrives (WLD-5, POS-618)
--
-- RULED (Darko, 2026-10-14 10:20 EDT, and the gaps at 11:27): "delaying the row
-- on the ledger until they actually arrive at the thing, while still affording
-- residents the convenience of being able to say: I want to enter at the time I
-- arrive." Wright closed the shape the same morning: the intent and its outcome
-- live in a table of their own, keyed to the walk act (G1 a).
--
-- ── WHY IT IS NEEDED ─────────────────────────────────────────────────────────
--
-- Until this file `walk { mark_id, enter_on_arrival: true }` wrote the entry's
-- rows at DEPARTURE and stamped them with the arrival crossing. 49 of the
-- ledger's 52 backward ferry steps were those rows (POS-618), 10 of 111 were
-- overtaken before the walker got there, and a portal's landing could not be
-- written ahead of time without dating a departure in the future (office #529,
-- blocked). Now the walk door writes nothing on the enter/exit ledger. It
-- queues one row here, and the office's arrival tick (src/arrival-entries.mjs)
-- runs the ordinary enter when the walk arrives, stamped now.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per walk that asked to enter on arrival and whose pre-check would
-- enter (a pre-check that refuses, asks for terms or asks for a pick queues
-- nothing; Darko, G2):
--
--   walk_act_id  the walk's own act (acts.id). The intent stands while that
--                act is the walker's current departure; any later departure
--                overtakes it (Darko, G4).
--   handle       the walker.  household  their household on the walk's key,
--                which the tick acts with (it has no request key of its own).
--   mark         the mark to enter.  accept  the walker's word for a mark that
--                asks for terms.  into_mark  the pick for a portal that leads
--                more than one way.
--   due_at       when the walk arrives, from the whole-metre remainder.
--   settled_at, outcome, enter_act_id, words — written once, by the tick:
--                entered · refused · already · overtaken · expired. `words`
--                is the refusal (or the expiry: a row that could not be
--                decided a day after it fell due) as the walker reads it on
--                their own standpoint (Darko, G3), and nowhere else.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`: INSERT (the walk door) and UPDATE (the tick's settle). A row is
-- settled once: the trigger refuses an UPDATE of a settled row, an UPDATE that
-- touches the intent's own columns, and every DELETE.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, BEFORE THE CODE ─────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f /srv/postmark-office/world2/schema/074_arrival_entries.sql
--
-- An office without this file still walks: the queue's INSERT fails, the walk
-- stands, and its answer says the entry was not queued.
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.arrival_entries') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'arrival_entries_settle_once');
--
-- CONSUMERS: src/arrival-entries.mjs (the queue at the walk door, the tick, the
-- standpoint's line), src/world.mjs § walkViaOffice, src/crossing-exec.mjs
-- (an enter carrying `arrival_of` is written once per walk).

BEGIN;

CREATE TABLE IF NOT EXISTS arrival_entries (
  walk_act_id   bigint PRIMARY KEY,
  handle        text NOT NULL,
  household     text,
  mark          text NOT NULL,
  accept        boolean NOT NULL DEFAULT false,
  into_mark     text,
  due_at        timestamptz NOT NULL,
  queued_at     timestamptz NOT NULL DEFAULT now(),
  settled_at    timestamptz,
  outcome       text CHECK (outcome IN ('entered', 'refused', 'already', 'overtaken', 'expired')),
  enter_act_id  bigint,
  words         text CHECK (words IS NULL OR char_length(words) <= 600),
  CHECK ((settled_at IS NULL) = (outcome IS NULL))
);

-- the tick's one probe: the unsettled rows, oldest due first
CREATE INDEX IF NOT EXISTS arrival_entries_due_idx ON arrival_entries (due_at) WHERE settled_at IS NULL;
-- the standpoint's read: a walker's newest rows
CREATE INDEX IF NOT EXISTS arrival_entries_handle_idx ON arrival_entries (handle, walk_act_id DESC);

CREATE OR REPLACE FUNCTION arrival_entries_settle_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'arrival_entries: a row is settled, never deleted';
  END IF;
  IF OLD.settled_at IS NOT NULL THEN
    RAISE EXCEPTION 'arrival_entries: walk act % is already settled (%)', OLD.walk_act_id, OLD.outcome;
  END IF;
  IF NEW.walk_act_id IS DISTINCT FROM OLD.walk_act_id OR NEW.handle IS DISTINCT FROM OLD.handle
     OR NEW.household IS DISTINCT FROM OLD.household OR NEW.mark IS DISTINCT FROM OLD.mark
     OR NEW.accept IS DISTINCT FROM OLD.accept OR NEW.into_mark IS DISTINCT FROM OLD.into_mark
     OR NEW.due_at IS DISTINCT FROM OLD.due_at OR NEW.queued_at IS DISTINCT FROM OLD.queued_at THEN
    RAISE EXCEPTION 'arrival_entries: only the settle columns may change';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS arrival_entries_settle_once ON arrival_entries;
CREATE TRIGGER arrival_entries_settle_once
  BEFORE UPDATE OR DELETE ON arrival_entries
  FOR EACH ROW EXECUTE FUNCTION arrival_entries_settle_once();

GRANT SELECT, INSERT, UPDATE ON arrival_entries TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('arrival_entries', 'source', 'office_api', '{office_api}',
   'Darko 2026-10-14 (WLD-5/POS-618, option b): enter_on_arrival writes its entry at arrival; the walk door queues the intent here and the office tick runs the ordinary enter, settling the row once')
ON CONFLICT (object) DO NOTHING;

COMMIT;
