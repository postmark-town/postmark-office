-- 086 — WHERE A HOUSEHOLD CAME FROM, PRIVATELY (POS-770, w44 or w45)
--
-- Darko, 2026-10-22 23:03 EDT: "is there any way that we can track where people
-- will be coming?" Outreach links carry `?from=<tag>` from a fixed list
-- (src/arrival-source.mjs § FROM_TAGS). The site keeps the tag in the visitor's
-- browser for 30 days; the office's own consent pages (the same origin) read it
-- when a human co-signs or signs in, and PARK it against that human's GitHub
-- id; the declaration that founds their household LANDS it as the household's
-- `came_from`. It is an ops fact: never on the public record (not in
-- households.json, not in a commit, not in the journal), never shown or echoed
-- to an agent.
--
-- 030/073's shape, for the same reason: the office writes the tag and never
-- reads it back. No pen holds any privilege on either table; office_api
-- EXECUTEs the two writers and the one count, none of which returns a
-- person's row. An operator reads the rows at psql as the owner.
--
--   arrival_source_pending  gh_id → tag, parked at a consent click; swept after
--                           30 days; a newer park replaces an older one
--   arrival_sources         household → tag, landed once at its declaration
--
-- The tag's own grammar is checked here (a short slug); WHICH tags is the
-- office's list, checked before any park, so the list grows by a PR and never
-- by a migration (Wright's G3).
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/086_arrival_sources.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('arrival_sources'), to_regclass('arrival_source_pending');   -- both named
--   SELECT * FROM arrival_sources_daily(now() - interval '7 days');               -- 0 rows until the first landing
BEGIN;
CREATE TABLE IF NOT EXISTS arrival_source_pending (
  gh_id      bigint PRIMARY KEY,                -- the GitHub id of the human who clicked
  tag        text NOT NULL CHECK (tag ~ '^[a-z0-9]{1,24}$'),
  parked_at  timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS arrival_sources (
  household    text PRIMARY KEY,                -- the house the declaration founded
  tag          text NOT NULL CHECK (tag ~ '^[a-z0-9]{1,24}$'),
  recorded_at  timestamptz NOT NULL
);
ALTER TABLE arrival_source_pending ENABLE ROW LEVEL SECURITY;
ALTER TABLE arrival_sources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON arrival_source_pending FROM office_api, clearing_job, law_ingester, snapshot_reader;
REVOKE ALL ON arrival_sources FROM office_api, clearing_job, law_ingester, snapshot_reader;

CREATE OR REPLACE FUNCTION arrival_source_park(p_gh_id bigint, p_tag text, p_at timestamptz)
  RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM public.arrival_source_pending WHERE parked_at < p_at - interval '30 days';
  INSERT INTO public.arrival_source_pending (gh_id, tag, parked_at) VALUES (p_gh_id, p_tag, p_at)
    ON CONFLICT (gh_id) DO UPDATE SET tag = EXCLUDED.tag, parked_at = EXCLUDED.parked_at;
END $$;

CREATE OR REPLACE FUNCTION arrival_source_land(p_gh_id bigint, p_household text, p_at timestamptz)
  RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE kept integer;
BEGIN
  DELETE FROM public.arrival_source_pending WHERE parked_at < p_at - interval '30 days';
  WITH taken AS (DELETE FROM public.arrival_source_pending WHERE gh_id = p_gh_id RETURNING tag)
  INSERT INTO public.arrival_sources (household, tag, recorded_at)
    SELECT p_household, tag, p_at FROM taken
    ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS kept = ROW_COUNT;
  RETURN kept > 0;
END $$;

-- Counts only: per day on Darko's clock (US-Eastern) and per tag.
CREATE OR REPLACE FUNCTION arrival_sources_daily(since timestamptz)
  RETURNS TABLE (day date, tag text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    SELECT (recorded_at AT TIME ZONE 'America/New_York')::date AS day, tag, count(*)::bigint AS n
      FROM public.arrival_sources
     WHERE recorded_at >= since
     GROUP BY 1, 2
     ORDER BY 1, 2
$$;

REVOKE ALL ON FUNCTION arrival_source_park(bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION arrival_source_land(bigint, text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION arrival_sources_daily(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arrival_source_park(bigint, text, timestamptz) TO office_api;
GRANT EXECUTE ON FUNCTION arrival_source_land(bigint, text, timestamptz) TO office_api;
GRANT EXECUTE ON FUNCTION arrival_sources_daily(timestamptz) TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('arrival_source_pending', 'source', 'office_api', '{}',
   'Darko 2026-10-22 (POS-770): an outreach tag parked at a consent click against the human''s GitHub id until their declaration lands it; no pen holds any privilege on the table; office_api EXECUTEs arrival_source_park and arrival_source_land, neither returns the tag; swept after 30 days; in no export'),
  ('arrival_sources', 'source', 'office_api', '{}',
   'Darko 2026-10-22 (POS-770): where a household came from, one private row per household, an ops fact; counts through arrival_sources_daily() only; never on the public record; in no export')
ON CONFLICT (object) DO NOTHING;
COMMIT;
