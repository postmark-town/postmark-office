-- 099 — acts(action, id) where not _ledger: the enter/exit count stops scanning the table (POS-1095 b, w48)
--
-- WHY IT WAS FILED (Darko, 2026-11-17 12:55 EST, the picker, POS-1095/b "Store
-- migrations"): "Yes, both". Asked: an index on acts for the enter/exit count, 52 ms a
-- run and a scan of all 54,632 acts, the most frequent statement in the store sessions
-- during a doorstep phase.
--
-- THE READ (src/enter-exit-ledger.mjs § passageMark), unchanged by this file:
--
--   SELECT max(id) AS hw, count(*) AS n FROM acts
--    WHERE action = ANY($1) AND payload->>'_ledger' IS NULL
--
-- It is the key of the occupancy memo, so it runs on every read that needs occupancy.
-- Its `max(id)` plus `count(*)` shape is deliberate and stays; only the plan changes.
--
-- THE INDEX is partial on the statement's own second clause, spelled the way the
-- statement spells it, so Postgres can prove the clause and use the index. `id` is the
-- second column so the statement is answered from the index alone (an index-only scan).
-- The founding era's backfilled rows carry `_ledger` and are left out of it. No
-- registry row: an index has no pen of its own (015_marks_locked_window.sql says why).
--
-- COST: one more index for each new act to maintain; about 2 MB at 54,632 acts. Building
-- it takes a fraction of a second at that size (it blocks writes to `acts` while it
-- builds, which is why it rides the restart's maintenance switch).
--
-- IDEMPOTENT. APPLY AS `world2_owner`, the runbook's step-1 idiom:
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/099_acts_passage_idx.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane applies
-- it. ORDER: either way is safe; no code reads the index by name.
--
-- HOW TO PROVE IT LANDED:
--
--   SELECT indexdef FROM pg_indexes WHERE tablename = 'acts' AND indexname = 'acts_passage_idx';
--   EXPLAIN SELECT max(id), count(*) FROM acts
--    WHERE action = ANY('{legacy:enter,legacy:exit,enter,exit}') AND payload->>'_ledger' IS NULL;
--     -- an Index Only Scan using acts_passage_idx, and no Seq Scan on acts
--
-- ROLLBACK: DROP INDEX IF EXISTS acts_passage_idx;  (the statement reads as before)
--
-- CONSUMERS, named: src/enter-exit-ledger.mjs § passageMark; test/pos-1095-store-migrations.test.mjs.

BEGIN;

CREATE INDEX IF NOT EXISTS acts_passage_idx ON acts (action, id) WHERE (payload->>'_ledger') IS NULL;

COMMIT;
