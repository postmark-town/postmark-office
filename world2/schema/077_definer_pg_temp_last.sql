-- 077 — every SECURITY DEFINER function searches pg_temp last (POS-579)
--
-- Follows 030_arrival_heard.sql (POS-292) and 073_berth_heard.sql (POS-570).
--
-- ── THE HOLE ────────────────────────────────────────────────────────────────
--
-- A SECURITY DEFINER function runs as its owner and resolves names through its
-- own `search_path`. When that list does not name `pg_temp`, Postgres searches
-- the CALLING session's temp schema FIRST. 030's `arrival_heard_weekly` says
-- `SET search_path = public` and reads a bare `arrival_heard`, so an office_api
-- session could make a TEMP table of that name and the owner's function would
-- read it instead of the store's. The function only reads and only answers
-- counts, so a caller who shadows the table reads back nothing but their own
-- rows: nothing leaks today. It is the class the review of #482 closed for 073,
-- found again by lane B on 2026-10-11 (POS-579).
--
-- ── THE FIX ─────────────────────────────────────────────────────────────────
--
-- `arrival_heard_weekly` is re-created with `SET search_path = public, pg_temp`
-- (temp searched last) and a schema-qualified table. Its body, its result and
-- its grants are 030's, unchanged: counts per ISO week per choice, every cell
-- under 3 folded into one 'fewer-than-3' row, never the note; EXECUTE for
-- office_api only.
--
-- The sweep of world2/schema found three SECURITY DEFINER functions in all:
-- this one, and 073's `berth_heard_park` and `berth_heard_land`, which already
-- name `public, pg_temp` and qualify every table. The last statement below
-- holds the store to it: the migration refuses, and rolls back whole, if any
-- SECURITY DEFINER function in `public` does not search pg_temp LAST and only
-- there: a list of plain schema names (or "$user") whose last entry is pg_temp,
-- which appears once and is not the only entry. A quoted single string
-- ('public, pg_temp') is one schema name with a comma in it, and a quoted
-- "PG_TEMP" is another schema; both are refused (review of #589).
-- test/definer-pg-temp-last.test.mjs holds the files and the store to the same
-- rule.
--
-- Idempotent (CREATE OR REPLACE keeps the owner and the grants, which are also
-- re-stated), one transaction, under lock_timeout = 5s so a blocked apply fails
-- whole and is simply re-run. Applied by hand as world2_owner (deploy/DEPLOY.md
-- § 077). Its probe: world2/tools/migrations-landed.mjs.

BEGIN;
SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION arrival_heard_weekly(since timestamptz)
  RETURNS TABLE (week date, heard text, n bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
    WITH cells AS (
      SELECT date_trunc('week', answered_at AT TIME ZONE 'UTC')::date AS week, heard, count(*) AS n
        FROM public.arrival_heard
       WHERE answered_at >= since
       GROUP BY 1, 2
    )
    SELECT week, CASE WHEN n >= 3 THEN heard ELSE 'fewer-than-3' END AS heard, sum(n)::bigint AS n
      FROM cells
     GROUP BY 1, 2
     ORDER BY 1, 2
$$;

REVOKE ALL ON FUNCTION arrival_heard_weekly(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION arrival_heard_weekly(timestamptz) TO office_api;

-- The store holds the rule: every SECURITY DEFINER function in public searches
-- the caller's pg_temp last, once, after at least one schema of its own.
DO $$
DECLARE bad text;
BEGIN
  SELECT string_agg(p.oid::regprocedure::text, ', ' ORDER BY p.oid::regprocedure::text) INTO bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prosecdef
     AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c
                      WHERE c ~ '^search_path=(?:(?:"\$user"|[a-z_][a-z0-9_$]*)\s*,\s*)+pg_temp$'
                        AND c !~ '(=|,)\s*pg_temp\s*,');
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'POS-579: these SECURITY DEFINER functions do not search pg_temp last: %', bad;
  END IF;
END $$;

UPDATE registry SET ruling = ruling || ' + 077: arrival_heard_weekly searches pg_temp last and names public.arrival_heard (POS-579)'
  WHERE object = 'arrival_heard' AND ruling NOT LIKE '%077:%';

COMMIT;
