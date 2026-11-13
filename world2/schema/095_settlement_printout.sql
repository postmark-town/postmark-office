-- 095 — THE SETTLEMENT PRINTS ITSELF: its number at the seal, the publications registry in the store, and
--       the printout's record (POS-1025, the office half of POS-365; a box step at the ship)
--
-- RULED (Darko, 2026-11-13). 09:08 EST, POS-365/a: "Printout only" — git becomes a printout of each
-- settlement, the settlement cuts its own tag, and our repairs go through an operator act. 15:1x EST,
-- POS-1025/a "Every settlement": every seal gets a number, quiet ones included; a retry keeps its number;
-- a settlement never printed leaves a gap; the tag is cut only once the printout succeeds, and old tags
-- are never rewritten. POS-1025/c "Report only": what publishes is decided inside the settlement and stays
-- fixed.
--
-- ── 1 · THE NUMBER, AT THE SEAL ─────────────────────────────────────────────
--
--   world_snapshots.sealed_settlement   NEW, integer, unique where set. The clearing allocates it inside its
--                                       own transaction, under the candle lock, as the greatest number the
--                                       store has ever named (a sealed one, or a `settlements` row from a
--                                       keeper's tag) plus one (world-snapshot-seal.mjs § NEXT_SETTLEMENT_SQL).
--                                       A rolled-back clearing takes no number; a printout that never lands
--                                       leaves one unprinted, which is the ruled gap. NULL on every snapshot
--                                       sealed before 095: their number, if any, is their `settlements` row's,
--                                       and nothing reinterprets them.
--   world_snapshots.printout_sha        NEW, the World commit the settlement printed this snapshot at, written
--   world_snapshots.printed_at          once by record_printout (§ 3). A different sha later is refused.
--
-- 018 said "the tag is the receipt" and "a refused gate takes no number": both stay true of `settlements`
-- (the tag-read ledger, written by the office tick). What changes is who cuts the tag and when the number
-- is decided; the snapshot carries the decision, and the tag names it.
--
-- ── 2 · THE PUBLICATIONS REGISTRY, IN THE STORE ─────────────────────────────
--
-- The sweep kept `WORLD/settlement-publications.json` in git: which marks a settlement admitted, and as
-- what class. The commons rule reads it (world tools/unpublish-verdict.mjs: only a registered commons row
-- is ever a candidate), so once the settlement decides before the seal, the registry must be the store's.
--
--   settlement_publications   one row per registry entry per stretch of windows:
--     slug         the mark (<owner>/<name>), the file's key
--     class        the class the settlement admitted it as ("commons" | "home" | "constitution")
--     stale        the seeded row's path was not where the mark is filed (unpublish-verdict § STALE_ROWS
--                  "skip": a stale row is never swept); a row the clearing writes is never stale
--     ord          its place in the file, so the printout keeps the file's order byte for byte
--     from_window  the first window it holds at (0 for the cutover's seed)
--     to_window    the window it stopped holding at, or NULL while it holds
--   The registry AS SEALED at window W is every row with from_window <= W < coalesce(to_window, ∞). A row
--   is never updated in place except to close it: a change closes the old row and opens a new one at the
--   same `ord`, and a removal closes it.
--
-- Written by `clearing_job` (the clearing's step 7.5, the only writer after the seed) and seeded once,
-- at the cutover, by world2/tools/publications-seed.mjs as the owner.
--
-- ── 3 · THE PRINTOUT'S RECORD, AND THE WORLD-MARKS HEAD ─────────────────────
--
-- marks-ingest was the only writer of projection_heads['world-marks'] (as the owner), and it retires with
-- this change. The head says which World commit the store's marks rows are at; read by standing.mjs §
-- classLayerVia, the seal's world_sha and /world2/status. Its new writer is the printout, and only the
-- printout, through ONE function rather than a table grant:
--
--   record_printout(window, sha)   SECURITY DEFINER, EXECUTE to clearing_job only. It records the sha on
--                                  that window's snapshot (refusing a different one), and moves the head
--                                  to it only when that snapshot is the highest-numbered printed one, so a
--                                  stale replay never moves the head backwards. Idempotent.
--
-- ── COMPATIBILITY: APPLY BEFORE THE CODE ────────────────────────────────────
--
-- The new clearing writes sealed_settlement and settlement_publications, so it must not run on a store
-- without 095. The old code reads none of it (it names its columns), so 095 can land any time before the
-- deploy. The registry is seeded by the cutover step (deploy/DEPLOY.md § 095), not here: a migration
-- reads no git.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" \
--     -c "SET ROLE world2_owner;" -f world2/schema/095_settlement_printout.sql
--
-- where $DB is the office's database (WORLD2_PG_URL in /etc/postmark-office.env); the pipe from a commit
-- and the proofs are deploy/DEPLOY.md § 095. It waits at most 5 s for its locks.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT data_type FROM information_schema.columns
--    WHERE table_name = 'world_snapshots' AND column_name = 'sealed_settlement';   -- integer
--   SELECT to_regclass('public.settlement_publications');                         -- settlement_publications
--   SELECT has_function_privilege('clearing_job', 'record_printout(integer, text)', 'EXECUTE');   -- t

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1 · the number, and the printout's record
ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS sealed_settlement integer
  CONSTRAINT world_snapshots_sealed_settlement_positive CHECK (sealed_settlement > 0);
CREATE UNIQUE INDEX IF NOT EXISTS world_snapshots_sealed_settlement
  ON world_snapshots (sealed_settlement) WHERE sealed_settlement IS NOT NULL;
ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS printout_sha text
  CONSTRAINT world_snapshots_printout_sha_shape CHECK (printout_sha ~ '^[0-9a-f]{40}$');
ALTER TABLE world_snapshots ADD COLUMN IF NOT EXISTS printed_at timestamptz;
-- 072's stance record names how the seal knew its number: "row" (a settlements row) or "inferred" (the
-- newest plus one). A seal that allocated it says "sealed". Widened, never narrowed: every existing row
-- still satisfies the new check, and re-running this drops and re-adds the same constraint.
ALTER TABLE world_snapshots DROP CONSTRAINT IF EXISTS world_snapshots_stances_check;
ALTER TABLE world_snapshots ADD CONSTRAINT world_snapshots_stances_check
  CHECK (stances IS NULL OR (jsonb_typeof(stances) = 'object'
         AND jsonb_typeof(stances->'counted') = 'boolean'
         AND stances->>'how' IN ('row', 'inferred', 'sealed')));

-- 2 · the publications registry
CREATE TABLE IF NOT EXISTS settlement_publications (
  slug         text    NOT NULL CHECK (slug ~ '^[^/]+/.+$'),
  class        text    NOT NULL CHECK (class <> ''),
  stale        boolean NOT NULL DEFAULT false,
  ord          bigint  NOT NULL CHECK (ord >= 0),
  from_window  integer NOT NULL CHECK (from_window >= 0),
  to_window    integer CHECK (to_window IS NULL OR to_window > from_window),
  PRIMARY KEY (slug, from_window)
);
CREATE UNIQUE INDEX IF NOT EXISTS settlement_publications_live
  ON settlement_publications (slug) WHERE to_window IS NULL;
GRANT SELECT ON settlement_publications TO office_api, clearing_job, snapshot_reader;
GRANT INSERT, UPDATE ON settlement_publications TO clearing_job;

-- 3 · the printout's record and the world-marks head
CREATE OR REPLACE FUNCTION record_printout(p_window integer, p_sha text)
  RETURNS TABLE (settlement integer, printout_sha text, advanced boolean)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  snap record;
  top integer;
BEGIN
  IF p_sha IS NULL OR p_sha !~ '^[0-9a-f]{40}$' THEN
    RAISE EXCEPTION 'record_printout: "%" is not a full commit sha', p_sha;
  END IF;
  SELECT id, sealed_settlement, world_snapshots.printout_sha AS sha INTO snap
    FROM public.world_snapshots WHERE window_id = p_window FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'record_printout: no snapshot is sealed for window %', p_window;
  END IF;
  IF snap.sealed_settlement IS NULL THEN
    RAISE EXCEPTION 'record_printout: window % was sealed with no settlement number (before 095): it is not printed by the settlement', p_window;
  END IF;
  IF snap.sha IS NOT NULL AND snap.sha <> p_sha THEN
    RAISE EXCEPTION 'record_printout: S% (window %) was already printed at %; refusing %', snap.sealed_settlement, p_window, snap.sha, p_sha;
  END IF;
  IF snap.sha IS NULL THEN
    UPDATE public.world_snapshots SET printout_sha = p_sha, printed_at = now() WHERE id = snap.id;
  END IF;
  SELECT max(w.sealed_settlement) INTO top FROM public.world_snapshots w WHERE w.printout_sha IS NOT NULL;
  IF top = snap.sealed_settlement THEN
    INSERT INTO public.projection_heads (repo, sha, ingested_at) VALUES ('world-marks', p_sha, now())
    ON CONFLICT (repo) DO UPDATE SET sha = EXCLUDED.sha, ingested_at = EXCLUDED.ingested_at
      WHERE public.projection_heads.sha IS DISTINCT FROM EXCLUDED.sha;
    RETURN QUERY SELECT snap.sealed_settlement, p_sha, true;
  ELSE
    RETURN QUERY SELECT snap.sealed_settlement, p_sha, false;
  END IF;
END $$;
REVOKE ALL ON FUNCTION record_printout(integer, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION record_printout(integer, text) TO clearing_job;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('settlement_publications', 'source', 'clearing_job', '{office_api,snapshot_reader}',
   'Darko 2026-11-13 (POS-365/a, POS-1025/c): the settlement decides publication before the seal, so the sweep''s publications registry is the store''s; seeded once at the cutover, then written by the clearing')
ON CONFLICT (object) DO NOTHING;

COMMIT;
