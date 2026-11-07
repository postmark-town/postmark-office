-- 088 — letter_notes: a household's private note on an inbound letter (POS-730)
--
-- THE RULING (Darko, 2026-11-06 14:32 EDT, POS-730/a, "Build that shape"; his go
-- "good to go" at 18:45 EST): a household can mark a letter it received "no reply
-- needed" or "waiting on <condition>". The mark is private to the household,
-- stays until the household clears it (POS-845 call 7, 2026-11-01: "a waiting mark
-- stays until the household removes it, and shows its age"), and a reply does not
-- clear it. The act is household { do: "letter-note", args: { letter, state:
-- "no-reply" | "waiting" | "clear", on? } }; any resident of the household may set
-- or clear it. `to_answer` skips a marked letter; the awaiting view still lists it
-- with its mark, condition and age.
--
-- ── ONE ROW PER (HOUSEHOLD, LETTER) ─────────────────────────────────────────
--
-- The household keys it, not the resident: "any resident of the receiving
-- household may set or clear its common disposition", so two housemates see one
-- note, and a second resident's `clear` clears it. (`letter_opens`, 029, is keyed
-- by recipient because a letter is opened by a person; a disposition is the
-- house's judgment about what the house owes.) `household` is the recipient's
-- household key as `householdKeyFor` spells it; the row policy compares it.
--
-- `marked_at` is when the mark was made, and the age runs from it. A mark set
-- again with the same state and condition keeps its `marked_at`; a changed state
-- or condition is a new mark and starts a new age. `clear` DELETES the row:
-- nothing about a cleared note is kept (the condition's bytes are private), and
-- the correspondence the town records is untouched, because this table is not
-- that record.
--
-- ── PRIVATE: 029's and 026's ROW-POLICY SHAPE ───────────────────────────────
--
-- ROW LEVEL SECURITY, every policy `TO office_api`, comparing
-- `household = ANY(app.household_keys)` (024's spelling set). A transaction that
-- has not declared this household sees no row and can write none. NO GRANT to
-- `snapshot_reader` or any role but `office_api`: no export reads it (the notary
-- reads `acts`, `windows` and `marks`), and the act writes no row in `acts`: a
-- household's judgment of its own mail never enters the public record.
--
-- `waiting_on` is at most 140 characters and is present exactly when the state is
-- `waiting`; the table says so itself, below the door's own check.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/088_letter_notes.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table, a `pg_policies` check
-- before each CREATE POLICY, `ON CONFLICT DO NOTHING` on the registry row, and a
-- GRANT is idempotent. THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT, on
-- Darko's go; nothing in the code lane applies it.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'letter_notes';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'letter_notes' ORDER BY 1, 2;   -- office_api DELETE/INSERT/SELECT/UPDATE and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'letter_notes';
--   SELECT * FROM registry WHERE object = 'letter_notes';
--
-- A STORE WITHOUT THIS TABLE: the door says so (503, "the office's private note
-- table is not there yet") and writes nothing; every read that carries notes says
-- the notes could not be read rather than showing none. Neither falls back to a
-- file or a public copy.
--
-- CONSUMERS, named: src/letter-notes.mjs (the act, the household's notes, the
-- awaiting overlay and the to_answer skip), test/letter-notes.test.mjs,
-- test/registry-grants.test.mjs (the grants and policies, read from this file).
-- Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS letter_notes (
  household   text NOT NULL,                  -- the recipient's household key; the row policy compares it
  letter      text NOT NULL,                  -- the letter's id, as its delivery row names it
  state       text NOT NULL CHECK (state IN ('no-reply','waiting')),
  waiting_on  text CHECK (waiting_on IS NULL OR char_length(waiting_on) <= 140),
  marked_at   timestamptz NOT NULL,           -- when this mark was made: the age runs from it
  marked_by   text NOT NULL,                  -- the resident who made it
  PRIMARY KEY (household, letter),
  CONSTRAINT letter_notes_waiting_names_its_condition
    CHECK ((state = 'waiting') = (waiting_on IS NOT NULL AND char_length(btrim(waiting_on)) > 0))
);

ALTER TABLE letter_notes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_notes' AND policyname = 'letter_notes_read') THEN
    CREATE POLICY letter_notes_read ON letter_notes FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_notes' AND policyname = 'letter_notes_insert') THEN
    CREATE POLICY letter_notes_insert ON letter_notes FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_notes' AND policyname = 'letter_notes_update') THEN
    CREATE POLICY letter_notes_update ON letter_notes FOR UPDATE TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')))
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'letter_notes' AND policyname = 'letter_notes_delete') THEN
    CREATE POLICY letter_notes_delete ON letter_notes FOR DELETE TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON letter_notes TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('letter_notes', 'source', 'office_api', '{}',
   'Darko 2026-11-06 (POS-730/a, POS-845 call 7): a household-private note on an inbound letter, no-reply or waiting on a condition; one row per (household, letter); stays until cleared; RLS on app.household_keys, office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
