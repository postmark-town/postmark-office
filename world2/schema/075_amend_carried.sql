-- 075 — amend_carried: the store records which settlement carried each door
-- amend (POS-612; G8 and G9 ruled by Wright 2026-10-14)
--
-- A mark's receipt named the settlement that FIRST carried it, so an amended
-- mark kept saying "published at S<first>" forever. Live: keith's stool,
-- amended at S104 (claim 08a6b024, candle 244), still read "published at S65
-- (fc74bf68)" on 10-14, and Wright misread it in a letter. `mark_carried` (049)
-- is write-once, first carriage, and stays so; this table is its sibling for
-- every later VERSION a resident put forward at the door.
--
-- ── WHAT COUNTS AS AN AMEND (G1) ────────────────────────────────────────────
--
-- A `locked` claim whose `supersedes` is set and whose `data` carries no
-- `_ingested_from`. marks-ingest's own amends are file-side changes (the
-- un-nesting, the v2→v3 rewrite, hand commits) and are written at the window
-- open AFTER the bless, so their window names the next settlement. On 10-14 a
-- git "newest touch" rule differed from first carriage on 807 of 1,569 marks,
-- 647 of them by such commits (docs/2026-10-13/rail/POS-612/gap-read.md).
--
-- ── WHICH SETTLEMENT CARRIED IT (G2, G8) ────────────────────────────────────
--
-- The lowest `settlements.number` whose `window_id` is at or after the amend's
-- window, and ONLY when git proves that settlement carried THIS amend: the mark's
-- file changed between S(n-1) and S(n), and S(n)'s file holds the amend's own
-- content (its `date`, or for an undated amend its body). The writer is `world2/tools/amend-carried.mjs`, run on the keep tick
-- beside `mark_carried`'s (settlements-backfill.mjs --apply), and once with
-- --apply --prod for history. An unproven candidate gets NO row and a named line.
--
-- ── POS-446's FIVE, WRITTEN HERE (G5, G9) ───────────────────────────────────
--
-- Five residents' door amends that the sweep never carried, put on canon by a
-- hand commit (world 10e5b194, 2026-10-08), first contained in S100. The window
-- rule's candidates (S94, S83, S78) fail the proof, so the record of record for
-- these is written by hand, here. Per mark: no matching claim → NOTICE and skip
-- (a store that never held it: the suite, pglite, the sandbox); exactly one →
-- insert; two or more, or a claim present while S100 is missing → RAISE.
-- Ship check (Wright, after applying on the box):
--   SELECT count(*) FROM amend_carried WHERE issue = 'POS-446';   -- 5
--
--   claim        the door amend's claim id: one row per version, ever.
--   mark         `<by>/<slug>`, the id the receipt is asked about.
--   settlement   S<n> that carried this version. REFERENCES settlements.
--   by_hand      the commit that carried it, when a person did; else null.
--   issue        the issue a hand carriage answers to; else null.
--   recorded_at  when the office wrote it.
--
-- ── THE PEN ─────────────────────────────────────────────────────────────────
--
-- `office_api`, INSERT only, as 049. 003_falsifier_roles.sql's lawful list
-- carries the matching row in this commit.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` ─────────────────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/075_amend_carried.sql
--
-- CONSUMERS: src/mark-receipt.mjs § readMarkReceipt (1.0's receipt),
-- src/world2-serve.mjs § twinReceipt (the twin's), world2/tools/amend-carried.mjs
-- (the writer and its verify), world2/tools/settlements-backfill.mjs (the tick).

BEGIN;

-- The FK onto claims(id) and settlements(number) takes SHARE ROW EXCLUSIVE on
-- both until COMMIT: door writes on claims queue behind it, and it queues behind
-- a clearing. Give up in 5 s rather than stall the doors (072's guard); apply
-- away from the 06:00/18:00Z clearing.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS amend_carried (
  claim       uuid PRIMARY KEY REFERENCES claims(id),
  mark        text NOT NULL CHECK (mark ~ '^[^/]+/.+$'),
  settlement  integer NOT NULL REFERENCES settlements(number),
  by_hand     text CHECK (by_hand IS NULL OR by_hand ~ '^[0-9a-f]{40}$'),
  issue       text,
  recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS amend_carried_mark_idx ON amend_carried (mark);

GRANT SELECT ON amend_carried TO office_api, clearing_job, law_ingester, snapshot_reader;
GRANT INSERT ON amend_carried TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('amend_carried', 'source', 'office_api', '{snapshot_reader}',
   'Wright 2026-10-14 (POS-612 G8): the store records which settlement carried each door amend, at carriage time; POS-446''s five hand carries written in the migration')
ON CONFLICT (object) DO NOTHING;

DO $$
DECLARE
  five CONSTANT text[][] := ARRAY[
    ARRAY['berthillon/cone-peche-de-vigne-2026-08-27', '229'],
    ARRAY['berthillon/cone-poire-williams-2026-09-15', '229'],
    ARRAY['vermillion/pagani-huayra', '212'],
    ARRAY['vermillion/pagani-zonda', '212'],
    ARRAY['lupi/the-unworn-step', '207']];
  hand CONSTANT text := '10e5b194acffedab9c5a6177ba6dc7f4360fcf96'; -- world, POS-446 instance repair
  m text; w integer; n integer; c uuid; has100 boolean;
BEGIN
  SELECT EXISTS (SELECT 1 FROM settlements WHERE number = 100) INTO has100;
  FOR i IN 1 .. array_length(five, 1) LOOP
    m := five[i][1]; w := five[i][2]::integer;
    SELECT count(*), min(id::text)::uuid INTO n, c FROM claims
     WHERE slug = m AND window_id = w AND status = 'locked' AND supersedes IS NOT NULL
       AND NOT (coalesce(data, '{}'::jsonb) ? '_ingested_from');
    IF n = 0 THEN
      RAISE NOTICE 'amend_carried: no door amend for % at candle % in this store; POS-446 row not written', m, w;
    ELSIF n > 1 THEN
      RAISE EXCEPTION 'amend_carried: % door amends for % at candle % — POS-446 names one', n, m, w;
    ELSIF NOT has100 THEN
      RAISE EXCEPTION 'amend_carried: % holds its POS-446 amend but settlement 100 is not in settlements', m;
    ELSE
      INSERT INTO amend_carried (claim, mark, settlement, by_hand, issue)
      VALUES (c, m, 100, hand, 'POS-446') ON CONFLICT (claim) DO NOTHING;
    END IF;
  END LOOP;
END $$;

COMMIT;
