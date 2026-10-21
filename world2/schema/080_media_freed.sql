-- 080 — office_media: a file can be FREED (POS-737, w44)
--
-- RULED (Darko, 2026-10-21 08:26 EDT, "737 agreed"): a daily office sweep
-- deletes an upload no current surface references (marks, profiles, home
-- pictures, posts, events) after a 30-day grace, with its -96/-256 copies. The
-- ledger row moves to a deleted state and its bytes leave the household's wall.
-- It runs report-only first. An operator takedown (immediate, with a receipt)
-- ships with it. The replay gap is accepted: old records keep the pointer,
-- never the bytes. LOGOS `the-media` ("append-only") is amended in the same law
-- pass.
--
-- 032 granted office_api SELECT and INSERT only on office_media, on purpose:
-- "append-only: nothing here deletes". This is the change that ends that, so it
-- grants UPDATE and nothing more. A row is never deleted: a freed file keeps
-- its row, and the row is the receipt.
--
-- ── THE STATES (src/media.mjs § THE LEDGER'S STATES) ─────────────────────────
--
--   unreferenced_since  epoch ms: the first sweep that found nothing hanging
--                       the file. Cleared when a sweep or a hanging door finds
--                       it hung. The grace counts from here.
--   deleted_at          epoch ms: the row is claimed for deletion. No longer
--                       held; its bytes no longer count against the wall.
--   deleted_cause       'sweep' | 'takedown'
--   deleted_by          the sweep ('media-sweep') or the operator's handle
--   deleted_reason      the takedown's stated reason; the sweep's grace
--   purged_at           epoch ms: storage answered the DELETE for the original
--                       and its copies. Claimed without it = retried next run.
--
-- A freed file that is uploaded again lives again: the door clears every state
-- column on its row. A taken-down file is refused at the door in every
-- household, so its row keeps its receipt for good.
--
-- An office on this code runs unchanged against a store that has not taken
-- 080 (media.mjs § mediaLedgerHasStates): every row reads live, and the sweep
-- and the takedown refuse to run.
--
-- ⚑ IDEMPOTENT, because it is applied by hand (025's reason). Apply as
-- `world2_owner` by the runbook's step-1 idiom, BEFORE the deploy that carries
-- the sweep:
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/080_media_freed.sql
--
-- ── HOW TO PROVE IT LANDED ───────────────────────────────────────────────────
--
--   SELECT count(*) FROM information_schema.columns WHERE table_name = 'office_media'
--      AND column_name IN ('unreferenced_since','deleted_at','deleted_cause','deleted_by','deleted_reason','purged_at');  -- 6
--   SELECT has_table_privilege('office_api', 'office_media', 'UPDATE');                                                  -- t
--   SELECT count(*) FROM office_media WHERE deleted_at IS NOT NULL;                                                      -- 0 until the first live run

BEGIN;

ALTER TABLE office_media ADD COLUMN IF NOT EXISTS unreferenced_since bigint;
ALTER TABLE office_media ADD COLUMN IF NOT EXISTS deleted_at bigint;
ALTER TABLE office_media ADD COLUMN IF NOT EXISTS deleted_cause text;
ALTER TABLE office_media ADD COLUMN IF NOT EXISTS deleted_by text;
ALTER TABLE office_media ADD COLUMN IF NOT EXISTS deleted_reason text;
ALTER TABLE office_media ADD COLUMN IF NOT EXISTS purged_at bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_media_deleted_cause_known') THEN
    ALTER TABLE office_media ADD CONSTRAINT office_media_deleted_cause_known
      CHECK (deleted_cause IS NULL OR deleted_cause IN ('sweep', 'takedown'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'office_media_purged_after_claim') THEN
    ALTER TABLE office_media ADD CONSTRAINT office_media_purged_after_claim
      CHECK (purged_at IS NULL OR deleted_at IS NOT NULL);
  END IF;
END $$;

-- the takedown block reads by sha across households
CREATE INDEX IF NOT EXISTS office_media_taken_down ON office_media (sha) WHERE deleted_cause = 'takedown';

GRANT UPDATE ON office_media TO office_api;

UPDATE registry SET ruling = 'POS-271 (2026-09-29): oauth.db moves into the store; the media quota ledger, byte-accounting, never record. POS-737 (2026-10-21, 080): a file nothing hangs is freed after a 30-day grace, or taken down by an operator; the row stays as the receipt'
 WHERE object = 'office_media';

COMMIT;
