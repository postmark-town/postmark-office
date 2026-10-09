-- 072 — the snapshot records, at its seal, whether stances count at it
-- (POS-364; follows 054_world_snapshots.sql, 069_snapshot_stance_through.sql).
--
-- RULED (Darko, 2026-10-09 10:25 EDT, "the conservative cutover, on both
-- points"): TOWN_STANCE_CUTOVER names a settlement number. A settlement numbered
-- below it folds with no stances (R14, everything ratified); from it on, every
-- opposition standing at its seal counts. The page and the record never disagree.
--
-- DECIDED ONCE, AT THE SEAL (Wright, 2026-10-09): a sealed settlement folds the
-- same way forever. The clearing seals a snapshot before the keeper's tag gives
-- it a settlements row, so its number at the seal is inferred (the store's newest
-- plus one), and a later reader that found the real row could decide otherwise.
-- So the seal decides, records it here, and every reader (the git write-down,
-- the served World, --verify, a re-fold) reads the record and never recomputes.
--
-- ── WHAT IS KEPT ─────────────────────────────────────────────────────────────
--
--   world_snapshots.stances   {"counted": bool, "cutover": "S<n>" | null,
--                              "settlement_inferred": <n> | null,
--                              "how": "row" | "inferred"}
--                              written by the seal from the cutover the clearing
--                              job holds and the settlement number it reads.
--                              NULL: no decision was recorded (sealed before
--                              this file, or back-filled), which reads as NOT
--                              COUNTED: everything before the deploy is the old
--                              blessing (R14).
--
-- THE SNAPSHOT DIGEST COVERS IT WHEN IT IS SET, as 069 does stance_through: one
-- more part, " stances:<counted|not-counted>:<cutover|->:<settlement|->:<how>",
-- built from the four fields (never from jsonb's own text), appended only when
-- the column is not NULL. Every digest sealed before this file is unchanged, and
-- a World kept under a digest (world_snapshot_folds) is the World of its
-- recorded decision.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `clearing_job`, in the window's transaction (world2/tools/world-snapshot-seal.mjs
-- writes the value the job hands it; the job reads `settlements`, which it holds
-- SELECT on since 018). No grant changes.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, AFTER 071 AND BEFORE THE CODE ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/072_snapshot_stances.sql
--
-- 054 and 069 first. A clearing on a store without this file rolls its window
-- back at the seal, by design.
--
-- APPLY IT BETWEEN CROSSINGS. ADD COLUMN takes ACCESS EXCLUSIVE on
-- world_snapshots. Behind a running clearing it would queue, and every
-- /world/state read would queue behind it. So it waits at most 5 s for its lock
-- and then fails, changing nothing (lock_not_available, 55P03); run it again
-- after the clearing (review of #451, F7).
--
-- Proof it landed:
--   SELECT column_name, data_type FROM information_schema.columns
--    WHERE table_name = 'world_snapshots' AND column_name = 'stances';   -- jsonb
--
-- CONSUMERS: world2/tools/clearing-job.mjs (decides), world2/tools/world-snapshot-seal.mjs
-- (writes), src/world-snapshot.mjs (snapshotDigestOf, checkSnapshot),
-- src/world-settlement.mjs (git, the served World, the labels),
-- world2/tools/world-snapshot.mjs (--verify).

BEGIN;

SET LOCAL lock_timeout = '5s';

ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS stances jsonb
  CHECK (stances IS NULL OR (jsonb_typeof(stances) = 'object'
         AND jsonb_typeof(stances->'counted') = 'boolean'
         AND stances->>'how' IN ('row', 'inferred')));

COMMENT ON COLUMN world_snapshots.stances IS
  'POS-364: whether stances count at this settlement, decided once at the seal ({counted, cutover, settlement_inferred, how}). NULL = no decision recorded (before 072, back-filled) = not counted.';

COMMIT;
