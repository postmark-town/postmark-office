-- 084 — reports: a resident reports a resident or a household, or asks the
-- town to adjudicate (POS-757, w44)
--
-- RULED (Darko, 2026-10-22 17:53 EDT, POS-757/a–b, in the picker):
--   a · a post class: town { do: "post", args: { class: "report", about, body,
--       asks? } }. asks: "adjudication" marks a request for a ruling. The town's
--       hands move it filed → heard → resolved (or dismissed), with a note. No
--       stake, no stamps, no new tool.
--   b · private: the filing household and the town's hands read it. The
--       household it is about isn't told at filing.
--
-- ── WHY A TABLE OF ITS OWN, AND NO ACTS ─────────────────────────────────────
--
-- Every other post class is a `posts` row with its life in `acts`, and both
-- are public by construction: `posts` is granted to `snapshot_reader` and its
-- 028 header calls it public, and every `acts` row with a crossing is written,
-- payload and all, to postmark-world's public STATE/log at each settlement
-- (src/state-log-from-store.mjs), frozen in the notary's archive and counted on
-- /ops/activity. A filter on each of those readers is vigilance; a report that
-- is never a posts row and never an act cannot reach any of them. So a report
-- keeps its whole life here: its state, and each move the hands made, inline.
--
-- ── PRIVATE: 083's SHAPE (mail_blocks), WITH THE HANDS ──────────────────────
--
-- ROW LEVEL SECURITY, every policy `TO office_api`. The filing household reads
-- and files its own reports (`household = ANY(app.household_keys)`), and the
-- town's hands read and move every report (`app.report_hand = 'on'`, set by the
-- pen in its own transaction only after the key holds wright, keemin or
-- worldkeeper: src/report-store.mjs § asHand). Only the hands update a row, and
-- nobody deletes one. NO GRANT to `snapshot_reader` or to any role but
-- `office_api`, so no export reads it, and nothing here is ever written to git.
-- `about_household` is the reported house's key, kept for the hands; no policy
-- compares it, so the reported household never reads a report about it.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/084_reports.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table and its index, a
-- `pg_policies` check before each CREATE POLICY, `ON CONFLICT DO NOTHING` on the
-- registry row, and GRANT is idempotent. Until it lands, filing a report
-- refuses with 503 and the read says it cannot look.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'reports';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'reports' ORDER BY 1, 2;   -- office_api INSERT/SELECT/UPDATE and nothing else
--   SELECT policyname, roles, cmd FROM pg_policies WHERE tablename = 'reports';
--   SELECT * FROM registry WHERE object = 'reports';
--
-- CONSUMERS, named: src/report-store.mjs (file, move, read), test/pos757-reports.test.mjs,
-- test/registry-grants.test.mjs (the grants, read from this file). Nothing else reads it.

BEGIN;

CREATE TABLE IF NOT EXISTS reports (
  id              text PRIMARY KEY CHECK (id ~ '^report/[0-9a-f]{8}$'),   -- opaque: never the filer, never the words
  household       text NOT NULL,                  -- the filing household's key; the row policy compares it
  filed_by        text NOT NULL,                  -- the resident whose key filed it
  about           text NOT NULL,                  -- the household or handle, as the filer named it
  about_household text,                           -- that household's key, for the hands; no policy reads it
  asks            text CHECK (asks IS NULL OR asks = 'adjudication'),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 600),
  state           text NOT NULL DEFAULT 'filed' CHECK (state IN ('filed', 'heard', 'resolved', 'dismissed')),
  moves           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ from, to, note, hand, at }], oldest first
  filed_at        timestamptz NOT NULL,
  updated_at      timestamptz NOT NULL,
  CHECK (household <> about_household)
);

CREATE INDEX IF NOT EXISTS reports_household ON reports (household, filed_at DESC);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_read') THEN
    CREATE POLICY reports_read ON reports FOR SELECT TO office_api
      USING (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ','))
          OR current_setting('app.report_hand', true) = 'on');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_file') THEN
    CREATE POLICY reports_file ON reports FOR INSERT TO office_api
      WITH CHECK (household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ','))
              AND state = 'filed' AND moves = '[]'::jsonb);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'reports' AND policyname = 'reports_move') THEN
    CREATE POLICY reports_move ON reports FOR UPDATE TO office_api
      USING      (current_setting('app.report_hand', true) = 'on')
      WITH CHECK (current_setting('app.report_hand', true) = 'on');
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE ON reports TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('reports', 'source', 'office_api', '{}',
   'Darko 2026-10-22 (POS-757/a-b): the report post class, private to the filing household and the town''s hands (wright, keemin, worldkeeper); filed, heard, resolved or dismissed with a note; no posts row, no acts; RLS on app.household_keys and app.report_hand, office_api only, in no export, never written to git')
ON CONFLICT (object) DO NOTHING;

COMMIT;
