-- 069 — the snapshot keeps how far the town's words had reached at its seal
-- (POS-362; follows 054_world_snapshots.sql, 064_snapshot_register.sql).
--
-- RULED (Darko, 2026-10-08, POS-362 option A): a settlement is every cleared
-- mark minus every opposed one (R5), and the opposed half is a SOURCE of the
-- settlement like the marks and the register: "the settlement's World folds its
-- sources plus the words up to stance_through, so --verify reproduces it". An
-- asked ?settlement=S<n> shows only the words standing at its seal; the newest
-- World keeps subtracting today's opposition at once (R16, POS-359's read).
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
--   world_snapshots.stance_through   the newest stance act's id (`acts.id` of
--                              class 'stance') when the seal ran. The words of
--                              the settlement are every stance act up to it, on
--                              the versions that stood at the seal's window.
--                              Nothing derived is stored: which words stand is
--                              the stance read's own derivation (town-stance.mjs,
--                              world-stance.mjs), re-run from the acts.
--                              NULL: no word was read at this seal (a snapshot
--                              sealed before this file, the back-filled S1–S93,
--                              or a store with no stance act yet). Such a
--                              settlement folds with no words, which is what it
--                              published.
--
-- THE SNAPSHOT DIGEST COVERS IT WHEN IT IS SET. world_snapshots.digest =
-- sha256("<marks_digest> <law_sha> <town_sha> <world_sha> <register_digest>
-- <stance_through>"), "-" for an absent sha; the sixth part is present only when
-- stance_through is not NULL, so every digest sealed before this file (and every
-- back-filled one) is unchanged. A cached World (world_snapshot_folds) is kept
-- under the digest, so equal digests still mean an equal World, words included.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `clearing_job`, in the window's transaction (world2/tools/world-snapshot-seal.mjs):
-- one `max(id)` over `acts`, which it already holds SELECT on (002). A pure SQL
-- read, as R1 requires; no grant changes.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, BEFORE THE CODE ──────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/069_snapshot_stance_through.sql
--
-- 054 and 064 first (this file alters their table). A sealing clearing on a store
-- without this file rolls its window back, by design.
--
-- Proof it landed:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'world_snapshots' AND column_name = 'stance_through';   -- bigint
--
-- CONSUMERS: world2/tools/world-snapshot-seal.mjs (the writer),
-- src/world-snapshot.mjs (snapshotDigestOf, checkSnapshot), src/world-settlement.mjs
-- (the settlement's words, the served World), world2/tools/world-snapshot.mjs (--verify).

BEGIN;

ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS stance_through bigint
  CHECK (stance_through > 0);

COMMENT ON COLUMN world_snapshots.stance_through IS
  'POS-362: the newest stance act id at the seal; the settlement''s words are the stance acts up to it. NULL = no word read (before 069, back-filled).';

COMMIT;
