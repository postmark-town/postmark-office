-- 093 — households.hearth: THE HEARTH A HOUSEHOLD CHOSE (POS-962, main hotfix)
--
-- RULED. Darko 2026-10-22 23:04 EDT, in the picker (POS-684/c "Choice kept"): "An office setting", set by a site act, read on every load,
-- changeable any time. Darko 2026-11-09 14:34/14:51 (the sitting): one household page; the household's design draws the house FOR EVERYONE,
-- and the site draws its own band for the signed-in human. Wright 2026-11-09 16:0x EST: the saved choice decides what /households/<slug>/
-- draws for everyone, the picker lives there for the signed-in human, the page asks ONE function which design to draw.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   NULL       the household has chosen nothing: every reader gets the default Hearth.
--   '<id>'     the id of a REGISTERED entry (a folder on the town repo's PROJECTS/household-hearths/, registered by merge), e.g. 'ledger'.
--
-- It holds an ID, never markup or a URL: the site resolves the id against the entries it built, and an id it does not know draws the default.
-- The CHECK keeps the column an id's own spelling (lowercase letters, digits and hyphens, at most 40: the site's ENTRY_ID); WHICH ids are
-- registered is the town repo's, checked by the writer against the town clone at the write, not by the schema.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/registry-store.mjs § setHouseholdHearth`, reached ONLY from `src/household-hearth.mjs § chooseHearth`, which is
-- `PATCH /households/<slug>/hearth`: a GitHub-signed-in credential (the account stands behind the key) that the household's own record
-- BINDS (`accounts`), the same test as 081's likeness answer. The store statement repeats the binding. No resident key, no Iris delegation
-- and no preview ever writes it; a preview is the site's own page state and makes no request.
--
-- Not in registry-store.mjs's `COLUMNS`, for 050's, 081's and 085's reason: a ceremony's upsert rebuilds a row from what it knew and would
-- reset it. It is PUBLIC (the choice is the house's public face): the drain prints it into the town's tools/households.json as `hearth`
-- and GET /households carries it (src/registry-public.mjs), and a NULL prints no key, so nothing moves on the first crossing after this lands.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/093_household_hearth.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane applies it. Until it lands every registry read answers as
-- before (the column is read through the row's own jsonb, like `likeness`), and the write refuses 503 by name.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'hearth';           -- hearth | text | YES
--   SELECT count(*) FROM households WHERE hearth IS NOT NULL;              -- 0 until a household chooses
--   node tools/registry-drain.mjs --check                                   -- still byte-equal
--
-- No new grants: `office_api` already holds UPDATE on `households` (019).

BEGIN;

ALTER TABLE households ADD COLUMN IF NOT EXISTS hearth text
  CONSTRAINT households_hearth_id CHECK (hearth ~ '^[a-z0-9][a-z0-9-]{0,39}$');

COMMIT;
