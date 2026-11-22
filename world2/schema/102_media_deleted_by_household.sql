-- 102 — office_media: a household may delete its own upload that nothing uses (POS-737/c, w49)
--
-- RULED (Darko, 2026-11-21 21:18 EST, POS-737/c, "Yes, both"), on the call
-- "give a household a delete for its own pictures that nothing uses, with a
-- receipt. Deletion is permanent; a picture still in use can't be deleted."
--
-- 080 gave the ledger its states and admitted two causes, 'sweep' and
-- 'takedown' (office_media_deleted_cause_known). The household's own delete
-- (src/media-sweep.mjs § THE HOUSEHOLD'S OWN DELETE) records a third,
-- 'household', with the resident who asked in `deleted_by`: this widens that
-- check and does nothing else. No new column, no new grant (080 granted
-- office_api UPDATE), and a row is still never deleted: it is the receipt.
--
-- The office on this code runs against a store without 102 unchanged, except
-- that the household's delete refuses (503, "the store has not taken
-- 102_media_deleted_by_household.sql; nothing was deleted"): the check refuses
-- its claim, the claim is one UPDATE, and nothing else was written.
--
-- ⚑ IDEMPOTENT, because it is applied by hand (025's reason): the check is
-- dropped and re-added in one transaction. Apply as `world2_owner` by the
-- runbook's step-1 idiom (deploy/DEPLOY.md § 102).
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'office_media_deleted_cause_known';
--     -- CHECK (((deleted_cause IS NULL) OR (deleted_cause = ANY (ARRAY['sweep'::text, 'takedown'::text, 'household'::text]))))

BEGIN;

ALTER TABLE office_media DROP CONSTRAINT IF EXISTS office_media_deleted_cause_known;
ALTER TABLE office_media ADD CONSTRAINT office_media_deleted_cause_known
  CHECK (deleted_cause IS NULL OR deleted_cause IN ('sweep', 'takedown', 'household'));

COMMIT;
