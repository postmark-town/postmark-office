-- 085 — households.invited_by: WHO INVITED THIS HOUSEHOLD, A PUBLIC CREDIT (POS-576, w44)
--
-- RULED (Darko):
--   2026-10-11 09:53  the join gains one optional field: "Did a resident or
--                     household bring you here?" It takes a handle and is a
--                     public credit; the form says so. A referral to your own
--                     household refuses; households and residents can be
--                     named, meeps can't.
--   2026-10-22 20:40  the link is `postmark.town/join/?invite=<handle>`. An
--                     invited household's join bundle is 10 (5 more), the
--                     inviter gets 10 when the new household is real (its
--                     first letter or a home within 30 days), at most 10 paid
--                     invitations per household per month. This weekend only
--                     the join REMEMBERS the invite; Wright mints by hand at
--                     each settlement (tools/invites.mjs is his read).
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   NULL                                   not invited, or the invite named
--                                          nobody the town would credit
--   { "by":    "<the inviting household's slug>",
--     "named": "<the handle or slug the join named, as normalised>",
--     "at":    "<ISO instant of the declaration>" }
--
-- `by` is the household the credit goes to: naming a resident credits their
-- house, because a household is what joins and what is paid. `named` keeps
-- the word the link or the form carried, so the record says who was named as
-- well as whose house that was on the day.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/registry-store.mjs § setHouseholdInvitedBy`, called once, by
-- the declaration's writing half (`src/declare-exec.mjs`), under the town
-- flock, after the house's row is minted and BEFORE the drain that prints it.
-- So the credit lands in the same town commit as the household it credits.
-- Written only while NULL: a credit is a fact about the arrival, never edited.
-- Not in registry-store.mjs's `COLUMNS`, for 050's and 081's reason: a
-- ceremony's upsert rebuilds a row from what it knew and would erase it.
--
-- The drain renders it into the town's tools/households.json when present
-- (`registry-rows.mjs`: absent renders as no key, so the first crossing after
-- this lands rewrites nothing). That is the public credit.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/085_household_invited_by.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT column_name, data_type, is_nullable FROM information_schema.columns
--    WHERE table_name = 'households' AND column_name = 'invited_by';  -- invited_by | jsonb | YES
--   SELECT count(*) FROM households WHERE invited_by IS NOT NULL;     -- 0 until the first invited join
--   node tools/registry-drain.mjs --check                             -- still byte-equal
--
-- No new grants: `office_api` already holds UPDATE on `households` (019).
BEGIN;
ALTER TABLE households ADD COLUMN IF NOT EXISTS invited_by jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'households_invited_by_shape') THEN
    ALTER TABLE households
      ADD CONSTRAINT households_invited_by_shape CHECK (
        invited_by IS NULL
        OR (jsonb_typeof(invited_by) = 'object'
            AND jsonb_typeof(invited_by->'by') = 'string'
            AND invited_by->>'by' <> slug));
  END IF;
END $$;
COMMENT ON COLUMN households.invited_by IS
  'Who invited this household (POS-576), a public credit: NULL = not invited, else {by: the inviting household slug, named: the handle the join named, at}. One writer: src/registry-store.mjs setHouseholdInvitedBy, from the declaration, only while NULL. Rendered into tools/households.json when present.';
COMMIT;
