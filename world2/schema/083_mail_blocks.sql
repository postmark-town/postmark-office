-- 083 — mail_blocks: a household blocks a household's mail (POS-666, w44)
--
-- RULED (Darko, 2026-10-22 17:12 EDT, POS-666/a–c, in the picker):
--   a · a household blocks a household, mail only. Letters stop in both
--       directions. Walking, marks and say are untouched. The town's own mail
--       (the Worldkeeper, Iris, the founders) is never blocked.
--   b · a silent drop: a stopped letter is not delivered, and its sender is not
--       told.
--   c · private: only the two households and the office know. The blocker lifts
--       it any time with one act, and it never expires.
--
-- ── ONE ROW PER BLOCK, KEPT AFTER IT IS LIFTED ──────────────────────────────
--
-- `household` is the BLOCKING household's key as `householdKeyFor` spells it
-- (world2-claims.mjs) and the row policy compares it; `blocked` is the other
-- household's key, spelled the same way. A lift sets `lifted_at` and
-- `lifted_by` on the standing row rather than deleting it, so the office keeps
-- when each block stood; at most one block stands per pair
-- (`mail_blocks_standing`), and blocking again after a lift is a new row.
-- SELECT + INSERT + UPDATE and no DELETE: nothing here is removed.
--
-- ── PRIVATE: 026's HARNESS-ROW SHAPE, AND ONE QUESTION THE DRAIN MAY ASK ────
--
-- ROW LEVEL SECURITY, and every policy is `TO office_api` and compares
-- `household = ANY(app.household_keys)`: a household reads and lifts its own
-- blocks and nobody else's, and a blocked household cannot learn it was
-- blocked. NO GRANT to `snapshot_reader` or to any role but `office_api`, so no
-- export reads it, and nothing here is ever written to git.
--
-- The crossing must still know whether a letter's two households stand
-- blocked, in either direction, without declaring either house.
-- `mail_block_stands(a, b)` answers exactly that and nothing more: one boolean
-- for two spelling sets, never which side placed it or when. SECURITY DEFINER,
-- owned by `world2_owner`, its search_path `public, pg_temp` with every table
-- qualified (077's rule), EXECUTE for `office_api` only.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/083_mail_blocks.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table and its index, a
-- `pg_policies` check before each CREATE POLICY, CREATE OR REPLACE on the
-- function, `ON CONFLICT DO NOTHING` on the registry row, and GRANT/REVOKE are
-- idempotent. Until it lands, the block door refuses with 503 and the crossing
-- reads "no block stands" (no block can have been placed without the table).
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'mail_blocks';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'mail_blocks' ORDER BY 1, 2;   -- office_api INSERT/SELECT/UPDATE and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'mail_blocks';
--   SELECT proname, prosecdef, proconfig FROM pg_proc WHERE proname = 'mail_block_stands';
--   SELECT * FROM registry WHERE object = 'mail_blocks';
--
-- CONSUMERS, named: src/mail-blocks.mjs (the block, the lift, the read of your
-- own, and the crossing's question), src/town-bridge.mjs (the crossing),
-- test/mail-blocks.test.mjs, test/registry-grants.test.mjs (the grants, read
-- from this file). Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS mail_blocks (
  id         bigserial PRIMARY KEY,
  household  text NOT NULL,                  -- the blocking household's key; the row policy compares it
  blocked    text NOT NULL,                  -- the blocked household's key
  placed_at  timestamptz NOT NULL,
  placed_by  text NOT NULL,                  -- the resident whose key placed it
  lifted_at  timestamptz,
  lifted_by  text,
  CHECK (household <> blocked),
  CHECK ((lifted_at IS NULL) = (lifted_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS mail_blocks_standing ON mail_blocks (household, blocked) WHERE lifted_at IS NULL;

ALTER TABLE mail_blocks ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mail_blocks' AND policyname = 'mail_blocks_read') THEN
    CREATE POLICY mail_blocks_read ON mail_blocks FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mail_blocks' AND policyname = 'mail_blocks_insert') THEN
    CREATE POLICY mail_blocks_insert ON mail_blocks FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'mail_blocks' AND policyname = 'mail_blocks_update') THEN
    CREATE POLICY mail_blocks_update ON mail_blocks FOR UPDATE TO office_api
      USING      (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')))
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ',')));
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON mail_blocks TO office_api;
GRANT USAGE ON SEQUENCE mail_blocks_id_seq TO office_api;

CREATE OR REPLACE FUNCTION mail_block_stands(a text[], b text[])
  RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.mail_blocks m
     WHERE m.lifted_at IS NULL
       AND ((m.household = ANY(a) AND m.blocked = ANY(b))
         OR (m.household = ANY(b) AND m.blocked = ANY(a))))
$$;

REVOKE ALL ON FUNCTION mail_block_stands(text[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION mail_block_stands(text[], text[]) TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('mail_blocks', 'source', 'office_api', '{}',
   'Darko 2026-10-22 (POS-666/a-c): a household blocks a household, mail only, both directions, silent drop, private; lifted by the blocker, never expires; RLS on app.household_keys, office_api only, in no export, never written to git')
ON CONFLICT (object) DO NOTHING;

COMMIT;
