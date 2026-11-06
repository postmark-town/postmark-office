-- 089 — a voice-time partial index on `acts`, and the one function its predicate needs (POS-779)
--
-- WHY. A conversation thread lasts a whole settlement, so the page reads one settlement's public voices (the
-- `say` acts between two published edges) and finds their connected components. Today `/world2/conversations`
-- reads EVERY voice act ever and sorts them: `acts` has no index on `action` or `at`, so the plan is a
-- sequential scan and the cost grows with all of history. POS-779's DEV proof, on invented rows:
--
--   whole-history door, 228k voices     52 s   (a 375 KB answer: a response cap is not a work bound)
--   one epoch of 32k voices, no index   35-290 ms read, plan flips between an index scan and a whole-table scan
--   the same, with this index           20-26 ms, 0 rows filtered, buffers independent of older history
--
-- WHAT. One index and one function. Nothing is stored, derived or granted:
--
--   acts_voice_at_idx  ON acts (action, at, id)
--     WHERE action IN ('say', 'legacy:emission', 'emission') AND NOT voice_payload_private(payload)
--
--   voice_payload_private(payload jsonb) RETURNS boolean
--
-- WHY THE KEY IS (action, at, id), NOT (at, id). A live `say` act's logical instant is its `acts.at`. A
-- crystallized EMISSION's logical instant is its own `payload.at`, which need not equal `acts.at` (the crossing
-- save wrote the row after the voice was born). An index on `at` alone would mix the two meanings in one range
-- and silently drop the emission whose effective time lies inside an epoch but whose row was written after it.
-- So a settlement's says are an exact range on this index (`action = 'say' AND at >= .. AND at < ..`), and the
-- emissions, a closed historical set read behind a count and byte fuse, are read by `action` alone and placed by
-- their effective time in code (world2/tools/convo-read.mjs). The index serves both reads.
--
-- WHY THE PREDICATE CARRIES ELIGIBILITY. A voice spoken inside a room (WLD-74) is private: it must not group,
-- count, position, or spend a read budget for a public reader. If the index held private rows, a private flood
-- would cost every public read its scan. `voice_payload_private` is `src/world2-serve.mjs § spokenInRoom` in SQL,
-- and it may only ever err toward PUBLIC (a row it does not hide is still checked by the JS guard, which stays):
--
--   JS:  let p = row.payload; if (typeof p === "string") try { p = JSON.parse(p) } catch { p = null };
--        return !!(p?.room ?? p?.payload?.room);
--
--   * a string payload is parsed; one that does not parse is PUBLIC (the JS reads it as null);
--   * `room` is read first, and the inner `payload.room` only when `room` is absent or JSON null (`??`), so
--     `room: false`, `0` or `""` beside an inner room is the OUTER value, falsy, public;
--   * JS truthiness: private iff the value is a non-empty string, `true`, an object or an array, or a number JS
--     reads as non-zero. A number is hidden only when its magnitude is at least 1e-300, so a literal such as
--     1e-400 (nonzero as a numeric, zero as a double) is NOT hidden here and falls to the JS guard.
--
-- It is IMMUTABLE honestly: its only inputs are its argument and pg_catalog's own jsonb and numeric operators
-- (search_path is pinned), and the same jsonb always gives the same answer. It uses an EXCEPTION block (a
-- subtransaction) only for a string payload, so it is PARALLEL UNSAFE, which is the default and is stated.
-- The test is `test/pos-779-convo-read.test.mjs § the SQL port against spokenInRoom`: fixed cases, a seeded fuzz
-- of payload shapes, and the named exceptions.
--
-- A QUERY USES THE INDEX ONLY IF IT REPEATS THE PREDICATE. world2/tools/convo-read.mjs builds every voice read
-- from the same constant, and its test proves the planner chooses the index and filters no rows.
--
-- COST AND ROLLBACK. One pass over `acts` to build, with the table write-locked for the pass (this file's
-- BEGIN/COMMIT idiom cannot say CONCURRENTLY). On a large store build it first by hand, outside a transaction:
--
--   CREATE OR REPLACE FUNCTION ... (the function below)
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS acts_voice_at_idx ON acts (action, at, id)
--     WHERE action IN ('say','legacy:emission','emission') AND NOT voice_payload_private(payload);
--
-- and the file is then a no-op (IF NOT EXISTS). `acts` is append-only (trigger acts_append_only), so there is
-- nothing to backfill. Rollback: `DROP INDEX CONCURRENTLY acts_voice_at_idx;` then
-- `DROP FUNCTION voice_payload_private(jsonb);` and revert the code that reads through them (a read that
-- omits the predicate still works, at the old price).
--
-- `IF NOT EXISTS` IS NOT A REPAIR. It looks at a NAME. If a hand-run CREATE INDEX CONCURRENTLY was interrupted
-- (a cancel, a timeout, a lost session) it leaves an INVALID index under this name; if someone built an index
-- with this name and another key list or predicate, that stays too. In both cases the statement above is a
-- silent no-op and the store has no usable index. The "landed" probe (world2/tools/migrations-landed.mjs
-- § VOICE_INDEX_PROBE) therefore checks the DEFINITION, not the name, and answers "missing" for an invalid,
-- not-ready, differently keyed or differently predicated index and for a function that is not this one.
-- The operator then, by hand and in this order: (1) inspect what is there (`\d+ acts`; `SELECT indexrelid::regclass,
-- indisvalid, indisready, pg_get_indexdef(indexrelid) FROM pg_index WHERE indexrelid = 'acts_voice_at_idx'::regclass;`
-- and the owner and `prosrc` of the function), (2) decide it is theirs to replace, (3) `DROP INDEX CONCURRENTLY
-- acts_voice_at_idx;`, (4) build again as above, (5) re-run the probe until it says landed. No worker script drops
-- or rebuilds an index it did not create, and this file never does. Nothing in this paragraph has been executed by
-- the lane that wrote it.
--
-- NO NEW GRANT. `office_api` reads `acts` already (002), and a function is executable by PUBLIC by default.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/089_voice_time_index.sql
--
-- ── HOW TO PROVE IT LANDED, and that it is CHOSEN rather than merely present ─
--
--   node world2/tools/migrations-landed.mjs  (the 089 line must say landed: valid, ready, exact keys and predicate)
--   SELECT indexdef FROM pg_indexes WHERE indexname = 'acts_voice_at_idx';
--   SELECT voice_payload_private('{"room":"x"}'), voice_payload_private('{"room":false}');   -- t, f
--   EXPLAIN (ANALYZE, BUFFERS) SELECT id FROM acts
--    WHERE action IN ('say','legacy:emission','emission') AND NOT voice_payload_private(payload)
--      AND action = 'say' AND at >= now() - interval '12 hours';                              -- Index Scan using acts_voice_at_idx
BEGIN;

CREATE OR REPLACE FUNCTION voice_payload_private(p jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE
SET search_path = pg_catalog
AS $$
DECLARE
  q jsonb;
  r jsonb;
  n numeric;
BEGIN
  IF p IS NULL THEN RETURN false; END IF;
  IF jsonb_typeof(p) = 'string' THEN
    BEGIN
      q := (p #>> '{}')::jsonb;
    EXCEPTION WHEN others THEN
      RETURN false;                      -- JS: JSON.parse throws, p = null, public
    END;
  ELSE
    q := p;
  END IF;
  r := q -> 'room';                      -- NULL unless q is an object holding the key
  IF r IS NULL OR jsonb_typeof(r) = 'null' THEN
    r := q -> 'payload' -> 'room';       -- the `??`: only an absent or null room falls through
  END IF;
  IF r IS NULL THEN RETURN false; END IF;
  CASE jsonb_typeof(r)
    WHEN 'null'    THEN RETURN false;
    WHEN 'boolean' THEN RETURN r = 'true'::jsonb;
    WHEN 'string'  THEN RETURN (r #>> '{}') <> '';
    WHEN 'number'  THEN
      BEGIN
        n := (r #>> '{}')::numeric;
      EXCEPTION WHEN others THEN
        RETURN false;
      END;
      RETURN abs(n) >= 1e-300;           -- never hide a number JS could read as 0 (underflow)
    ELSE RETURN true;                    -- an object or an array is truthy, even empty
  END CASE;
END
$$;

COMMENT ON FUNCTION voice_payload_private(jsonb) IS
  'POS-779: src/world2-serve.mjs spokenInRoom in SQL, erring toward public only. IMMUTABLE: a pure function of its argument. Used by acts_voice_at_idx; a query must repeat the predicate to use that index.';

CREATE INDEX IF NOT EXISTS acts_voice_at_idx ON acts (action, at, id)
  WHERE action IN ('say', 'legacy:emission', 'emission') AND NOT voice_payload_private(payload);

COMMIT;
