-- 098 — refused_acts: the private record of an act a door refused (POS-1003, w48)
--
-- WHY IT WAS FILED (Darko, 2026-11-11 13:41 EST): "I think probably refusals should
-- be written down somewhere. If not publicly, then just in telemetry so that we can
-- see." Reading Halloween week, the town's record could not say whether a resident had
-- tried to give sweets back and been refused before the give that worked, because a
-- refused act writes nothing to the record.
--
-- RULED (Darko, 2026-11-13 15:0x EST, batch 2): "Private log, own refusals visible".
-- When a door refuses a resident's act, it records who tried which act, on what,
-- when, and the refusal's code and words. The record is kept privately for 90 days
-- and never goes on the public record. A resident can read their own refusals through
-- their household read, and nobody else's.
--
-- ── WHAT A ROW HOLDS ────────────────────────────────────────────────────────
--
--   household  the acting household's key as `householdKeyFor` spells it (`hh:<slug>`)
--   handle     the resident who tried, when the call named one or the key holds one
--   door       `mcp` or `rest`: which door refused
--   act        which act, by name: `world:give`, `household:send`, `POST /letters`
--   target     "on what": the call's identifying fields only (an id, a handle, a
--              place), each cut to 80 characters and never a body, a text or a note
--              (src/refusal-log.mjs § TARGET_FIELDS)
--   code       the refusal's own number, when it carried one
--   defect     the refusal's words, as the door said them (cut to 400 characters)
--   hint       the door's hint (cut to 600 characters)
--   at         when
--
-- ── PRIVATE: 088's ROW-POLICY SHAPE ─────────────────────────────────────────
--
-- ROW LEVEL SECURITY, every policy `TO office_api`. A household reads and writes
-- only the rows that name it (`household = ANY(app.household_keys)`); a transaction
-- that has not declared a household sees no row and can write none. No grant to
-- `snapshot_reader` or any other role: no export reads it, and the refusal writes
-- nothing to `acts`, so none of it reaches the public record.
--
-- ── NINETY DAYS ─────────────────────────────────────────────────────────────
--
-- A row older than 90 days is never read (the read says `at > now() - 90 days`) and
-- is deleted by the office: the writer calls `refused_acts_prune()` (below), which
-- deletes every expired row, any household's, at most once an hour per process.
-- `office_api` holds no DELETE on the table: the function names expiry and nothing else.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/098_refused_acts.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane
-- applies it. ORDER: code first is safe. Until 098 lands the writer finds no table,
-- says so once in the log and records nothing, and the read says refusals are not
-- kept on this office yet; no act is ever delayed or changed by the record.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('public.refused_acts') IS NOT NULL;                         -- t
--   SELECT has_table_privilege('office_api', 'refused_acts', 'INSERT');            -- t
--   SELECT has_table_privilege('office_api', 'refused_acts', 'UPDATE');            -- f
--   SELECT has_table_privilege('snapshot_reader', 'refused_acts', 'SELECT');       -- f
--   SELECT has_function_privilege('office_api', 'refused_acts_prune()', 'EXECUTE'); -- t
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- Code: revert the office; the table is then written and read by nothing. Schema,
-- as `world2_owner`, in one transaction: DROP FUNCTION refused_acts_prune();
-- DROP TABLE refused_acts; DELETE FROM registry WHERE object = 'refused_acts'.
--
-- CONSUMERS, named: src/refusal-log.mjs (the writer and the household's read),
-- test/refusal-log.test.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS refused_acts (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  household  text NOT NULL,
  handle     text,
  door       text NOT NULL CHECK (door IN ('mcp', 'rest')),
  act        text NOT NULL CHECK (char_length(act) BETWEEN 1 AND 80),
  target     jsonb NOT NULL DEFAULT '{}'::jsonb,
  code       integer,
  defect     text CHECK (defect IS NULL OR char_length(defect) <= 400),
  hint       text CHECK (hint IS NULL OR char_length(hint) <= 600),
  at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS refused_acts_household_at ON refused_acts (household, at DESC);
CREATE INDEX IF NOT EXISTS refused_acts_at ON refused_acts (at);

ALTER TABLE refused_acts ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refused_acts' AND policyname = 'refused_acts_read') THEN
    CREATE POLICY refused_acts_read ON refused_acts FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'refused_acts' AND policyname = 'refused_acts_insert') THEN
    CREATE POLICY refused_acts_insert ON refused_acts FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT ON refused_acts TO office_api;

-- The expiry, as a definer function: a DELETE under the row policies would see only
-- the declared household's rows, and `office_api` holds no DELETE on the table. The
-- function removes expired rows and nothing else, and answers how many.
CREATE OR REPLACE FUNCTION refused_acts_prune()
  RETURNS bigint LANGUAGE sql SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH gone AS (DELETE FROM public.refused_acts WHERE at < now() - interval '90 days' RETURNING 1)
  SELECT count(*) FROM gone
$$;

REVOKE ALL ON FUNCTION refused_acts_prune() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION refused_acts_prune() TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('refused_acts', 'source', 'office_api', '{}',
   'Darko 2026-11-13 (POS-1003, "Private log, own refusals visible"): who tried which act, on what, when, and the refusal''s code and words; kept privately 90 days, never on the public record; a household reads its own; RLS on app.household_keys, office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
