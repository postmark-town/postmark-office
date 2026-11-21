-- 101 — households.human_profile: THE HOUSEHOLD'S HUMAN'S TOWN NAME, SHORT LINE AND PRONOUNS (POS-721, small)
--
-- SETTLED (Wright, 2026-11-06 00:51:44Z, on POS-721), verbatim:
--   "POS-721, rebuilt small. Darko's ask (10-19, 10-20, POS-845 "Town name
--   only") is three optional fields on the household's human: a town name, a
--   short line and pronouns. The human sets them by their own act on the site,
--   and the public reads show them ("by <alias> for rei"). No real-world name is
--   stored."
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   NULL                       nothing set: every read says "<House>'s human"
--   { "town_name":  "<text>",  each key optional, each a string; a key is
--     "short_line": "<text>",  present only while its field is set, and an
--     "pronouns":   "<text>" } object with nothing left in it is stored NULL
--
-- No real-world name is stored here or anywhere by this change. `households.human`
-- (the private name, 019) is untouched; retiring it is its own later step.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/human-profile.mjs § setHumanProfile` (the store write is
-- `src/registry-store.mjs § setHouseholdHumanProfile`), reached only by the
-- office's own browser sign-in of an account the row binds (`/oauth/human`,
-- the likeness answer's road; POS-721/c, Darko 2026-11-17: "Human only, like
-- likeness"). No key sets it, an OAuth/MCP access token included. Not in registry-store.mjs's
-- `COLUMNS`, for 050's and 081's reason: a ceremony's upsert rebuilds a row from
-- what it knew and would erase the profile.
--
-- It is PUBLIC by design (a town name, a line and pronouns the human chose to
-- show), and named so in src/registry-public.mjs (POS-845's named list): the
-- drain prints it into the town's tools/households.json and GET /households
-- carries it, each only when present (absent renders as no key, so the first
-- crossing after this lands rewrites nothing).
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/101_household_human_profile.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT, on Darko's go; nothing in
-- the code lane applies it. Until it lands every registry read answers as
-- before (the column is read through the row's own jsonb, like `hearth`), and
-- the write refuses 503 by name. So it can land any time before or after the
-- code; the door works once both are in.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'human_profile';   -- human_profile | jsonb | YES
--   SELECT conname FROM pg_constraint WHERE conname = 'households_human_profile_shape';
--   SELECT count(*) FROM households WHERE human_profile IS NOT NULL;      -- 0 until the first set
--   node tools/registry-drain.mjs --check                                 -- still byte-equal
--
-- This was 091 on its branch, then 098 when 092–097 reached the train first; 098 (POS-1003's refused acts), 099 and 100 then landed, so it is 101, the
-- next number free on the train at the carry (POS-1131). Open office PRs hold 090 (#906) and 095 (#1022). Only the name, this header and the LANDED key
-- changed: the statements below are exactly as reviewed.
--
-- No new grants: `office_api` already holds UPDATE on `households` (019).

BEGIN;

ALTER TABLE households ADD COLUMN IF NOT EXISTS human_profile jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_human_profile_shape') THEN
    ALTER TABLE households
      ADD CONSTRAINT households_human_profile_shape CHECK (
        human_profile IS NULL
        OR (jsonb_typeof(human_profile) = 'object'
            AND human_profile <> '{}'::jsonb
            AND (human_profile - 'town_name' - 'short_line' - 'pronouns') = '{}'::jsonb
            AND (NOT human_profile ? 'town_name'  OR jsonb_typeof(human_profile -> 'town_name')  = 'string')
            AND (NOT human_profile ? 'short_line' OR jsonb_typeof(human_profile -> 'short_line') = 'string')
            AND (NOT human_profile ? 'pronouns'   OR jsonb_typeof(human_profile -> 'pronouns')   = 'string')));
  END IF;
END $$;

COMMENT ON COLUMN households.human_profile IS
  'The household human''s own town name, short line and pronouns (POS-721): NULL = none set, else an object of the set ones only. One writer: src/human-profile.mjs setHumanProfile, from a GitHub sign-in by an account the row binds. No real-world name. Rendered into tools/households.json when present.';

COMMIT;
