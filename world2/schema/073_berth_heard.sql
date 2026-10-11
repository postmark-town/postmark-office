-- 073 — berth_heard: a berth's "where did you hear" answer, parked until the co-sign (POS-570)
--
-- Follows 030_arrival_heard.sql (POS-292). Darko, 2026-10-10: the question is
-- asked on every road, optional and private, seen through ops as counts.
--
-- ── WHY A TABLE OF ITS OWN ──────────────────────────────────────────────────
--
-- `declare` records its answer at once (030). `begin`, the berth's bridge,
-- does not join anyone: it PARKS its declaration on `oauth_berths.card` until
-- the human's co-sign click runs it. The answer has to wait somewhere too, and
-- the card is the wrong place for it, measured:
--
--   * `office_api` holds SELECT on oauth_berths (031), so the card is readable
--     by the office's own pen. 030's floor is that no pen reads an answer.
--   * While the paperwork mirror stands (paperwork.mjs, until office#450),
--     every card write is copied into oauth.db, a file on the box.
--   * A berth is never deleted (031), so an answer parked by a berth that never
--     co-signs would sit on its row forever.
--
-- So the answer is parked here, under 030's own rules.
--
-- ── PRIVATE TO THE OPERATORS, AS 030 ────────────────────────────────────────
--
--   * RLS is enabled with NO policy for any role, and every pen's privileges
--     are revoked: no pen reads, writes or deletes a row directly. Not even
--     INSERT: `office_api` reaches this table only through the two functions.
--   * berth_heard_park(slug, heard, note, at)  — `begin` parks, or replaces,
--     the berth's answer (heard NULL clears it: begin again without an answer
--     replaces the parked declaration whole). Returns nothing.
--   * berth_heard_land(slug, handle, household, at) — the co-sign moves the
--     parked answer into arrival_heard, the one private record of answers, and
--     deletes it here in the same statement. Returns only whether a row was
--     kept: never the answer.
--   * Both are SECURITY DEFINER, owned by `world2_owner`, and `office_api` may
--     EXECUTE them. Both sweep answers parked more than 8 days ago: a berth
--     sunsets 7 days after it boards (oauth.mjs § BERTH_TTL_S), and its answer
--     goes with it.
--
-- `heard` and `note` carry 030's CHECKs word for word. An answer counts in the
-- week its human co-signed (arrival_heard.answered_at is the co-sign's time),
-- because that is when the arrival happened.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, AFTER 030 AND BEFORE THE CODE ───────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/073_berth_heard.sql
--
-- A second run is a no-op: `IF NOT EXISTS` on the table, `CREATE OR REPLACE`
-- on the functions, `ON CONFLICT DO NOTHING` on the registry row, and
-- GRANT/REVOKE are idempotent. An office without this file still parks every
-- declaration: the park and the landing are best-effort and log a miss.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT tablename, tableowner, rowsecurity FROM pg_tables WHERE tablename = 'berth_heard';
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--    WHERE table_name = 'berth_heard' ORDER BY 1, 2;     -- world2_owner only
--   SELECT proname, prosecdef FROM pg_proc WHERE proname LIKE 'berth_heard_%';
--   SELECT * FROM registry WHERE object = 'berth_heard';
--
-- CONSUMERS, named: src/arrival-heard.mjs (parkHeard at begin; recordHeard's
-- landing at the co-sign, from src/declare-exec.mjs), test/arrival-heard.test.mjs.
-- Nothing else reads it, and nothing can.

BEGIN;

CREATE TABLE IF NOT EXISTS berth_heard (
  slug       text PRIMARY KEY,                 -- the berth whose begin carried the answer
  heard      text NOT NULL CHECK (heard IN ('youtube','discord','x','reddit','friend','their-ai','search','commons','other')),
  note       text CHECK (note IS NULL OR char_length(note) <= 280),
  parked_at  timestamptz NOT NULL
);

ALTER TABLE berth_heard ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON berth_heard FROM office_api, clearing_job, law_ingester, snapshot_reader;

CREATE OR REPLACE FUNCTION berth_heard_park(p_slug text, p_heard text, p_note text, p_at timestamptz)
  RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
BEGIN
  DELETE FROM berth_heard WHERE parked_at < p_at - interval '8 days';
  IF p_heard IS NULL THEN
    DELETE FROM berth_heard WHERE slug = p_slug;
  ELSE
    INSERT INTO berth_heard (slug, heard, note, parked_at) VALUES (p_slug, p_heard, p_note, p_at)
      ON CONFLICT (slug) DO UPDATE SET heard = EXCLUDED.heard, note = EXCLUDED.note, parked_at = EXCLUDED.parked_at;
  END IF;
END $$;

-- ON CONFLICT DO NOTHING as 030's own INSERT: one answer per handle, and the
-- parked row is deleted either way, so an answer is never kept twice.
CREATE OR REPLACE FUNCTION berth_heard_land(p_slug text, p_handle text, p_household text, p_at timestamptz)
  RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public AS $$
DECLARE kept integer;
BEGIN
  DELETE FROM berth_heard WHERE parked_at < p_at - interval '8 days';
  WITH taken AS (DELETE FROM berth_heard WHERE slug = p_slug RETURNING heard, note)
  INSERT INTO arrival_heard (handle, household, heard, note, answered_at)
    SELECT p_handle, p_household, heard, note, p_at FROM taken
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS kept = ROW_COUNT;
  RETURN kept > 0;
END $$;

REVOKE ALL ON FUNCTION berth_heard_park(text, text, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION berth_heard_land(text, text, text, timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION berth_heard_park(text, text, text, timestamptz) TO office_api;
GRANT EXECUTE ON FUNCTION berth_heard_land(text, text, text, timestamptz) TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('berth_heard', 'source', 'office_api', '{}',
   'Darko 2026-10-10 (POS-570): a berth''s "where did you hear" answer, parked from begin until the co-sign moves it into arrival_heard; no pen holds any privilege on the table; office_api EXECUTEs berth_heard_park and berth_heard_land, neither returns the answer; swept after 8 days; in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
