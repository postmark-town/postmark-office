-- deploy/uat/own.sql — the restored copy belongs to world2_owner, as prod's store does (CORE-165, finding 7).
--
-- The nightly dump is taken --no-owner --no-acl (deploy/world2-backup.sh), and store-restore-scrub.sh restores it as
-- the postgres superuser, so every object lands owned by postgres. Every migration's header says to apply it as
-- world2_owner ("SET ROLE world2_owner"), and a role cannot alter what it does not own, so the frozen release's
-- migrations (store-restore-scrub.sh § the migrations) would be refused on a copy owned by postgres. A SECURITY
-- DEFINER function is also owned by whoever owns it, and the migrations name world2_owner. So, before the grants and
-- the migrations: hand every object in `public` to world2_owner.
--
-- Not pg_restore --role: with it the restore runs as a non-superuser, and any superuser-only line in the archive
-- (an extension's comment) would refuse the whole restore under --exit-on-error. This does the same job after it, and
-- test/uat-kit.test.mjs proves it on a real store.
--
-- Objects: tables, views and materialised views, sequences no column owns (an identity or serial column's sequence
-- follows its table, and cannot be handed over alone), functions and procedures, and enum and domain types.
-- Run as postgres, inside the new database. Idempotent. The last SELECT counts what it left: store-restore-scrub.sh
-- refuses unless that is 0.

BEGIN;

DO $own$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT CASE c.relkind WHEN 'v' THEN 'VIEW' WHEN 'm' THEN 'MATERIALIZED VIEW' WHEN 'S' THEN 'SEQUENCE' ELSE 'TABLE' END AS kind,
           format('%I.%I', n.nspname, c.relname) AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'S', 'f')
       AND c.relowner <> 'world2_owner'::regrole
       AND NOT (c.relkind = 'S' AND EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = c.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')))
     ORDER BY c.relkind, c.relname
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO world2_owner', r.kind, r.name);
  END LOOP;

  FOR r IN
    SELECT CASE p.prokind WHEN 'p' THEN 'PROCEDURE' WHEN 'a' THEN 'AGGREGATE' ELSE 'FUNCTION' END AS kind, p.oid::regprocedure::text AS name
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proowner <> 'world2_owner'::regrole
       AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e')
  LOOP
    EXECUTE format('ALTER %s %s OWNER TO world2_owner', r.kind, r.name);
  END LOOP;

  FOR r IN
    SELECT format('%I.%I', n.nspname, t.typname) AS name
      FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
     WHERE n.nspname = 'public' AND t.typowner <> 'world2_owner'::regrole
       AND t.typtype IN ('e', 'd') AND t.typcategory <> 'A'
  LOOP
    EXECUTE format('ALTER TYPE %s OWNER TO world2_owner', r.name);
  END LOOP;
END
$own$;

COMMIT;

-- The readback: objects in public that are still not world2_owner's, one `<label> <count>` line (must be 0).
SELECT 'zero_not_owned_by_world2_owner' AS t, (
    (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm', 'f') AND c.relowner <> 'world2_owner'::regrole)
  + (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proowner <> 'world2_owner'::regrole
        AND NOT EXISTS (SELECT 1 FROM pg_depend d WHERE d.objid = p.oid AND d.classid = 'pg_proc'::regclass AND d.deptype = 'e'))
) AS count;
