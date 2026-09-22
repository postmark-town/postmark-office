-- 022 — THE STORE'S ROWS LEARN THE SLUG (postmark POS-160, w40)
--
-- RULED: the key is the household's SLUG, minted once (POS-158). From the w40
-- ship every NEW line that names a house names `hh:<slug>`; earlier lines keep
-- their spellings, because history is not rewritten.
--
-- ── SO WHY IS THIS FILE REWRITING ROWS ──────────────────────────────────────
--
-- Because 007's draft row policy is a STRING EQUALITY:
--
--   CREATE POLICY claims_read ON claims FOR SELECT
--     USING (status <> 'draft' OR household = current_setting('app.household', true));
--
-- `app.household` is set from `householdKeyFor`, which from this ship answers
-- `hh:<slug>`. A resident whose rows were written under `gh:<id>` therefore
-- stops seeing their own drafts, stops being able to edit them, and stops being
-- able to delete them — all four policies compare the same string — while every
-- mechanism in 007 works exactly as written. The rows are not history. They are
-- CURRENT STATE with a live reader, and a live reader that cannot read them is
-- the defect this file closes.
--
-- The LEDGER's lines and the WORLD's marks are the history that keeps its
-- spellings. Nothing here touches either.
--
-- ── IT RUNS BETWEEN THE DEPLOY AND THE FIRST CROSSING ───────────────────────
--
-- wright-ship-week § 4.3b: a store backfill that waits on a shipped reader runs
-- between the deploy and the first crossing (POS-154's departures hole, w40).
-- This is that shape exactly, and the order is not negotiable:
--
--   1. deploy the office carrying `src/household-deriver.mjs`
--   2. THIS FILE                                        <- the window
--   3. the first crossing
--
-- Run it BEFORE the deploy and every row is re-spelled while the running office
-- still writes and reads `gh:<id>`, so the drafts go dark for the length of the
-- gap instead of never. Run it AFTER a crossing and the crossing's own writes
-- land in the new spelling beside un-respelled neighbours, which is the mixed
-- store this file exists to end.
--
-- ── THE MAP IS THE DERIVER'S WALK, IN SQL ───────────────────────────────────
--
-- `src/household-deriver.mjs § resolveHouse` and this CTE must agree, and the
-- one place they could disagree is ORDER. Three handles in the live registry
-- are ALSO some house's slug — `mari` (a starforge resident, and the slug of
-- ev-attractor's house), `moth` (the-rookery's, and threshold's house), and
-- `elias-returning` (harmless: both roads reach one door). The deriver reads a
-- bare string as a HANDLE first for exactly that reason, so `rank` below is its
-- walk written down:
--
--   0  `hh:<slug>` / `gh:<id>`  a prefixed key says what it is; no ambiguity
--   1  a resident handle        what `identities` was keyed by, and what every
--                               caller of `householdKeyFor` has always meant
--   2  a pinned handle          through the pin's immutable id
--   3  a bare slug              only once the handle roads have missed
--   4  `hh:<former slug>`       an alias never outranks a live key
--   5  a bare former slug
--
-- A pin's LOGIN is not a road here, deliberately — `tools/witness.mjs §
-- loadBindings`: a pinned resident's login string is display-only, because
-- GitHub releases abandoned logins for re-registration.
--
-- ── WHAT IS NOT TOUCHED, AND WHY ────────────────────────────────────────────
--
--   `solo:<handle>`   names no house. It is the honest answer for a handle the
--                     registry has never heard of, and it stays that answer.
--   a value the map   left exactly as it stands. A row this migration cannot
--   does not name     name is a row a PERSON should look at; guessing at it
--                     here would be the fabricated household the deriver
--                     refuses to invent. The receipt below counts them.
--   `stamp_projection` a PROJECTION with its own ingester, re-derived rather
--                     than rewritten by hand. Its `household` follows
--                     `identities`, which is POS-160's second STOP (the
--                     law-ingest projection) and is not this ship's.
--   `identities`      the same: `law_ingester` owns every row of it.
--
-- ── IDEMPOTENT ──────────────────────────────────────────────────────────────
--
-- Every UPDATE carries `AND t.household <> 'hh:' || m.slug`, so a second run
-- matches nothing and reports zero. Safe to re-run; safe to re-run after a
-- crossing has written more rows.
--
-- ── APPLY AS `world2_owner` by the runbook's step-1 idiom ───────────────────
--
-- Secret-free: nothing sourced, no URL and no password anywhere on the line.
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/022_household_respell.sql
--
-- Applied as `postgres` instead, the tables' owner diverges and nothing fails
-- (014's lesson; the divergence is silent and permanent).

BEGIN;

-- Every spelling the store could be holding -> the house it names.
-- `DISTINCT ON (alias) ... ORDER BY alias, rank` keeps the deriver's order.
CREATE TEMP TABLE household_alias ON COMMIT DROP AS
SELECT DISTINCT ON (alias) alias, slug, rank
  FROM (
    -- 0 · the prefixed keys, which are unambiguous by construction
    SELECT 'hh:' || h.slug              AS alias, h.slug, 0 AS rank FROM households h
    UNION ALL
    SELECT 'gh:' || (a->>'id')          AS alias, h.slug, 0 AS rank
      FROM households h, LATERAL jsonb_array_elements(h.accounts) a
     WHERE a->>'id' IS NOT NULL
    UNION ALL
    -- 1 · a resident handle
    SELECT r                            AS alias, h.slug, 1 AS rank
      FROM households h, LATERAL unnest(h.residents) r
    UNION ALL
    -- 2 · a pinned handle, through its pin's id
    SELECT p.handle                     AS alias, h.slug, 2 AS rank
      FROM household_pins p
      JOIN households h
        ON EXISTS (SELECT 1 FROM jsonb_array_elements(h.accounts) a
                    WHERE (a->>'id') IS NOT NULL AND (a->>'id')::bigint = p.gh_id)
    UNION ALL
    -- 3 · a bare slug
    SELECT h.slug                       AS alias, h.slug, 3 AS rank FROM households h
    UNION ALL
    -- 4 · a former key, written as one
    SELECT 'hh:' || f                   AS alias, h.slug, 4 AS rank
      FROM households h, LATERAL unnest(h.formerly) f
    UNION ALL
    -- 5 · a former key, written bare
    SELECT f                            AS alias, h.slug, 5 AS rank
      FROM households h, LATERAL unnest(h.formerly) f
  ) roads
 WHERE alias IS NOT NULL AND alias <> ''
 ORDER BY alias, rank;

-- ── the receipt, BEFORE ─────────────────────────────────────────────────────
-- Read these. A migration that says nothing about what it is about to move is
-- a migration nobody can check afterwards.
\echo '── 022 · what the store holds BEFORE ────────────────────────────────'
SELECT 'acts'   AS t, household, count(*) FROM acts   WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;
SELECT 'claims' AS t, household, count(*) FROM claims WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;
SELECT 'marks'  AS t, household, count(*) FROM marks  WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;

\echo '── 022 · values this map CANNOT name (left exactly as they stand) ───'
SELECT t, household, n FROM (
  SELECT 'acts'   AS t, household, count(*) AS n FROM acts   WHERE household IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'claims', household, count(*) FROM claims WHERE household IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'marks',  household, count(*) FROM marks  WHERE household IS NOT NULL GROUP BY 2
) v
 WHERE household NOT LIKE 'solo:%'
   AND NOT EXISTS (SELECT 1 FROM household_alias m WHERE m.alias = v.household)
 ORDER BY n DESC;

-- ── the re-spelling ─────────────────────────────────────────────────────────
-- RLS does not stand in the way here: these run as `world2_owner`, which is the
-- tables' owner and is not subject to its own policies unless FORCE is set, and
-- 007 sets no FORCE. Stated rather than assumed, because a policy silently
-- filtering an UPDATE would leave a half-respelled store that reads as done.
UPDATE acts t SET household = 'hh:' || m.slug
  FROM household_alias m
 WHERE t.household = m.alias AND t.household <> 'hh:' || m.slug;

UPDATE claims t SET household = 'hh:' || m.slug
  FROM household_alias m
 WHERE t.household = m.alias AND t.household <> 'hh:' || m.slug;

UPDATE marks t SET household = 'hh:' || m.slug
  FROM household_alias m
 WHERE t.household = m.alias AND t.household <> 'hh:' || m.slug;

-- ── the receipt, AFTER ──────────────────────────────────────────────────────
\echo '── 022 · what the store holds AFTER ─────────────────────────────────'
SELECT 'acts'   AS t, household, count(*) FROM acts   WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;
SELECT 'claims' AS t, household, count(*) FROM claims WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;
SELECT 'marks'  AS t, household, count(*) FROM marks  WHERE household IS NOT NULL GROUP BY 2 ORDER BY 3 DESC LIMIT 20;

\echo '── 022 · every spelling that is not hh: or solo: (should be empty) ──'
SELECT t, household, n FROM (
  SELECT 'acts'   AS t, household, count(*) AS n FROM acts   WHERE household IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'claims', household, count(*) FROM claims WHERE household IS NOT NULL GROUP BY 2
  UNION ALL SELECT 'marks',  household, count(*) FROM marks  WHERE household IS NOT NULL GROUP BY 2
) v
 WHERE household NOT LIKE 'hh:%' AND household NOT LIKE 'solo:%'
 ORDER BY n DESC;

COMMIT;

-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ─────
--
--   -- no row in the three tables still wears a credential key
--   SELECT count(*) FROM acts   WHERE household LIKE 'gh:%';   -- 0
--   SELECT count(*) FROM claims WHERE household LIKE 'gh:%';   -- 0
--   SELECT count(*) FROM marks  WHERE household LIKE 'gh:%';   -- 0
--
--   -- and a resident can still see their own drafts, which is the whole point
--   BEGIN;
--     SELECT set_config('app.household', 'hh:<their-slug>', true);
--     SELECT count(*) FROM claims WHERE status = 'draft';
--   ROLLBACK;
--
--   -- the count BEFORE the migration, taken with the same transaction under
--   -- their OLD key, is the number this has to match. Take it first.
