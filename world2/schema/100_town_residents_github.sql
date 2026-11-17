-- 100 — town_residents.github_top / github_address: the residents' GitHub fields, stored (POS-1095 b, w48)
--
-- WHY IT WAS FILED (Darko, 2026-11-17 12:55 EST, the picker, POS-1095/b "Store
-- migrations"): "Yes, both". Asked: two stored columns for the residents' GitHub
-- fields, because every resident's whole JSON (54 MB, 53 MB of it inboxes) is converted
-- on each of the 4 office threads at every index reload, 1.5 to 2.4 s each, holding a
-- connection.
--
-- THE READ (src/town-index-store.mjs § probeRows), before:
--
--   SELECT handle, json::jsonb -> 'github' AS g1,
--          json::jsonb -> 'address' -> 'data' -> 'github' AS g2 FROM town_residents ...
--
-- THE TWO COLUMNS are those two expressions, generated and STORED, so the cast runs
-- once at write time and the read touches two small columns. Both stay `jsonb`, so a
-- JSON null, a missing key, a missing `address` and a missing `address.data` read exactly
-- as they do through the casts (a JSON null is jsonb 'null'; a missing path is SQL NULL).
--
-- THE INGEST SURVIVES THEM (read before building, POS-1095's stop condition):
-- world2/tools/town-index-ingest.mjs § insertRows names its columns
-- (`INSERT INTO town_residents (handle, json, digest) ...`) and § deleteKeys deletes by
-- key; law_ingester holds INSERT and DELETE only (033), never UPDATE, and nothing
-- recreates, truncates or copies the table positionally. A generated column cannot be
-- written, and nothing writes it.
--
-- ONE COST: adding a stored generated column REWRITES THE TABLE once (48 MB), under an
-- ACCESS EXCLUSIVE lock, a few seconds. It rides the restart's maintenance switch.
--
-- THE READER WORKS BEFORE THIS LANDS: probeRows asks pg_attribute whether the table has
-- the two columns and falls back to the two casts when it doesn't (the office ships with
-- w48, the columns arrive at the restart after it).
--
-- IDEMPOTENT. APPLY AS `world2_owner`, the runbook's step-1 idiom:
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/100_town_residents_github.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane applies it.
--
-- HOW TO PROVE IT LANDED:
--
--   SELECT column_name, data_type, is_generated FROM information_schema.columns
--    WHERE table_name = 'town_residents' AND column_name IN ('github_top', 'github_address');  -- 2 rows, jsonb, ALWAYS
--
-- ROLLBACK: ALTER TABLE town_residents DROP COLUMN github_top, DROP COLUMN github_address;
-- (probeRows falls back to the casts at its next read.)
--
-- CONSUMERS, named: src/town-index-store.mjs § probeRows; test/pos-1095-store-migrations.test.mjs.

BEGIN;

ALTER TABLE town_residents
  ADD COLUMN IF NOT EXISTS github_top     jsonb GENERATED ALWAYS AS ((json::jsonb) -> 'github') STORED,
  ADD COLUMN IF NOT EXISTS github_address jsonb GENERATED ALWAYS AS ((json::jsonb) -> 'address' -> 'data' -> 'github') STORED;

COMMIT;
