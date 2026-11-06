-- 091 — households.human_profile: THE HOUSEHOLD'S HUMAN'S TOWN NAME, SHORT LINE AND PRONOUNS (POS-721, small)
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
-- `src/registry-store.mjs § setHouseholdHumanProfile`), reached only by a
-- GitHub sign-in of an account the row binds (`PATCH /households/{slug}/human`,
-- the site's signed-in session; no agent-held key). Not in registry-store.mjs's
-- `COLUMNS`, for 050's and 081's reason: a ceremony's upsert rebuilds a row from
-- what it knew and would erase the profile.
--
-- The drain renders it into the town's tools/households.json when present
-- (`registry-rows.mjs`: absent renders as no key, so the first crossing after
-- this lands rewrites nothing). The fields are public by design: a town name,
-- a line and pronouns the human chose to show.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/091_household_human_profile.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'human_profile';   -- human_profile | jsonb | YES
--   SELECT conname FROM pg_constraint WHERE conname = 'households_human_profile_shape';
--   SELECT count(*) FROM households WHERE human_profile IS NOT NULL;      -- 0 until the first set
--   node tools/registry-drain.mjs --check                                 -- still byte-equal
--
-- 088, 089 and 090 are held by open PRs (#896, #769, #906); this is 091 on purpose.
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
