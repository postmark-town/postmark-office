-- 079 — acts.hand / acts.for_handle / acts.route: WHOSE HAND, FOR WHOM, BY WHICH ROUTE (POS-633 H4, w44)
--
-- LAW-TIER, per 001's discipline note and anti-rebake rule 4 ("Schema DDL is
-- law-tier: it goes through REVIEW like a grant change, because it is one").
--
-- RULED (Darko, 2026-10-19 21:34, D3/D4 at 22:17): every act's record carries
--   hand   who acted: the resident, or the household's human ('human')
--   for    the resident the act is filed under, or none   (`for_handle`: FOR is reserved)
--   route  how it reached the office: mcp | api | site | letter | operator
-- from the build forward. Rows written before this carry what the record
-- already knows, read at read time (the actor; human-of-<slug>; the payload's
-- as_human): no backfill writes a guess, and a route never recorded is NULL,
-- which reads as absent, never "unknown".
--
-- 078 is POS-688's (on the box, its PR unmerged); this is 079 on purpose.
--
-- ── WHY COLUMNS, AND NOT THE PAYLOAD ────────────────────────────────────────
--
-- The payload is the act's own content and leaves the box in the notary's
-- archive (world2/tools/snapshot-export.mjs § ACT_FIELDS, a FIXED list). These
-- three are the door's facts about the act, not the act. As columns they stay
-- off the archive's fixed list, so every frozen window regenerates byte for
-- byte; putting provenance in the public archive is its own change, with its
-- own REFREEZES.json declaration (field-change), when it is ruled.
--
-- ── WHAT WRITES THEM ─────────────────────────────────────────────────────────
--
-- The pen (src/world2-pen.mjs § insertAct → actsInsert), from the door's scope
-- (src/act-provenance.mjs): the route is set once per request where the
-- transport is known (server.mjs § handle). The INSERT names the three columns
-- only when the store has them (act-provenance.mjs § actsHaveProvenance), so an
-- office on this code runs unchanged against a store that has not taken 079.
--
-- `office_api` already holds INSERT on `acts` table-wide (002), which covers new
-- columns. The append-only trigger (002) is untouched: the three are written at
-- INSERT and never after.
--
-- ⚑ IDEMPOTENT, because it is applied by hand (025's reason). Apply as
-- `world2_owner` by the runbook's step-1 idiom:
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/079_act_provenance.sql
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'acts' AND column_name IN ('hand', 'for_handle', 'route');   -- 3 rows
--   SELECT count(*) FROM acts WHERE route IS NOT NULL;   -- 0 at once; rises with the first act after the deploy

ALTER TABLE acts ADD COLUMN IF NOT EXISTS hand text;
ALTER TABLE acts ADD COLUMN IF NOT EXISTS for_handle text;
ALTER TABLE acts ADD COLUMN IF NOT EXISTS route text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'acts_route_known') THEN
    ALTER TABLE acts ADD CONSTRAINT acts_route_known
      CHECK (route IS NULL OR route IN ('mcp', 'api', 'site', 'letter', 'operator')) NOT VALID;
  END IF;
END $$;
