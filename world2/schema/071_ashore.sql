-- 071 — ashore: the store's record that a handle came ashore (POS-444)
--
-- RULED (Darko, 2026-10-08, A): "The store holds the fact that a handle came
-- ashore: an append-only record written in the same act as the ADDRESS, by
-- every road that lands one (declare-exec, join-bind, the drain's settle), with
-- one backfill from the copy. Sign-in's harbor stamp (oauth.mjs householdFor)
-- and the send door's recipient check read it on a copy miss."
--
-- ── WHY IT IS NEEDED ─────────────────────────────────────────────────────────
--
-- Until this file the only answer to "does this handle stand ashore" was the
-- town index, a COPY of the town repo that the ingest refreshes at
-- :05/:20/:35/:50 UTC. A house the declaration door answered `settled: true`
-- was refused mail as a harbor act until that copy caught up (POS-354's
-- rehearsal, every run). The registry (019) could not answer instead: a harbor
-- house and a settled one have the same rows (`member_of` is `the-harbor`
-- either way; declare.mjs says there is no settled value).
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
-- One row per handle, the first time it came ashore:
--
--   handle   the resident's handle (the WHITE_PAGES directory).
--   at       when: the commit's committer date for a road that landed one; for
--            the backfill, the date of the commit that ADDED the handle's
--            ADDRESS.md in the copy's own history, NULL when the copy holds no
--            such commit (its history begins after it).
--   sha      that commit, or NULL under the same backfill condition.
--   road     declare · join-bind · drain · backfill.
--
-- The row is written AFTER the address's commit has landed, under the same
-- town lock, by the same process (declare-exec.mjs, join-bind.mjs). A row whose
-- write fails leaves the handle where it stood before this file: in the copy at
-- the next ingest. A row is never written ahead of its address, so the gate it
-- opens never opens for a house that is not ashore.
--
-- A RETIRED handle keeps its row; the readers filter on the pin's `retired`.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only; 002's `forbid_mutation` refuses UPDATE and DELETE.
-- The backfill (world2/tools/ashore-backfill.mjs) runs as `office_api` too and
-- inserts only the handles the table lacks.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ──────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/071_ashore.sql
--
-- Proof it landed (world2/tools/migrations-landed.mjs):
--   SELECT to_regclass('public.ashore') IS NOT NULL
--      AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'ashore_append_only');
--
-- CONSUMERS: src/ashore.mjs (the writer every road calls, and the read),
-- src/oauth.mjs § householdFor (the harbor stamp), src/send-at-door.mjs
-- § recipientProbe (the recipient check), world2/tools/ashore-backfill.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS ashore (
  handle       text PRIMARY KEY CHECK (handle ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'),
  at           timestamptz,
  sha          text CHECK (sha IS NULL OR sha ~ '^[0-9a-f]{40}$'),
  road         text NOT NULL CHECK (road IN ('declare', 'join-bind', 'drain', 'backfill')),
  recorded_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (road = 'backfill' OR (at IS NOT NULL AND sha IS NOT NULL))
);

DROP TRIGGER IF EXISTS ashore_append_only ON ashore;
CREATE TRIGGER ashore_append_only
  BEFORE UPDATE OR DELETE ON ashore
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

GRANT SELECT ON ashore TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON ashore TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('ashore', 'source', 'office_api', '{office_api}',
   'Darko 2026-10-08 (POS-444, A): the store holds the fact that a handle came ashore, written after the address''s commit lands by every road that lands one, with one backfill from the town index')
ON CONFLICT (object) DO NOTHING;

COMMIT;
