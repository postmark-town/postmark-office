-- 081 — households.likeness: THE HOUSEHOLD'S HUMAN'S ANSWER TO THE LIKENESS QUESTION (WLD-83, w44)
--
-- RULED (Darko, 2026-10-19, WLD-83):
--   18:24  consent is asked the first time an appearance or picture is set; the
--          default is NO until yes; the answer lives on the record. It is a
--          single yes/no from the human, and the form carries the PG-13 promise.
--   18:30  broad consent ("you may use my likeness") is opposed by default; once
--          given, each depiction defaults to welcomed and may be opposed one by
--          one. Neutral is not a state here.
--   18:59  D1: a "no" stops made media, never display. D2: the human answers
--          through a GitHub sign-in, never through a key.
--   19:04  D9: every household that already has a picture is asked now.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   NULL                                   never answered: reads as NO
--   { "answer": "yes" | "no",
--     "at":     "<ISO instant>",
--     "by":     "<the GitHub login that answered>",
--     "gh_id":  <its id>,
--     "words":  "<the version of the form's words they were shown>" }
--
-- NULLable, unlike 050's map, because "never answered" and "answered no" are
-- two facts the record keeps apart even though they gate alike: the needs-you
-- list asks the first and not the second.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/likeness.mjs § setLikeness` (the store write is
-- `src/registry-store.mjs § setHouseholdLikeness`), reached only from the form
-- the office renders after a GitHub sign-in by an account the row binds
-- (`/oauth/likeness`). No key reaches it. Not in registry-store.mjs's
-- `COLUMNS`, for 050's reason: a ceremony's upsert rebuilds a row from what it
-- knew and would reset the answer.
--
-- The drain renders it into the town's tools/households.json when present
-- (`registry-rows.mjs`: absent renders as no key, so the first crossing after
-- this lands rewrites nothing). Each answer is therefore a commit in the town's
-- history: the public log of who answered what, when, to which words. The
-- login and id are the household's own account, already public in `accounts`.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/081_household_likeness.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'likeness';   -- likeness | jsonb | YES
--   SELECT count(*) FROM households WHERE likeness IS NOT NULL;      -- 0 until the first answer
--   node tools/registry-drain.mjs --check                            -- still byte-equal
--
-- 080 is POS-737's (the media ledger's freed states); this is 081 on purpose.
--
-- No new grants: `office_api` already holds UPDATE on `households` (019).

BEGIN;

ALTER TABLE households ADD COLUMN IF NOT EXISTS likeness jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_likeness_answered') THEN
    ALTER TABLE households
      ADD CONSTRAINT households_likeness_answered CHECK (
        likeness IS NULL
        OR (jsonb_typeof(likeness) = 'object' AND likeness->>'answer' IN ('yes', 'no')));
  END IF;
END $$;

COMMENT ON COLUMN households.likeness IS
  'The household human''s answer to the likeness question (WLD-83): NULL = never answered (reads as no), else {answer: yes|no, at, by, gh_id, words}. One writer: src/likeness.mjs setLikeness, from the signed-in form only. A no stops made media, never display. Rendered into tools/households.json when present.';

COMMIT;
