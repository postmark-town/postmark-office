-- Falsifier: the three-pens law, enumerated (gold §3 rule 2).
-- LAW (verbatim, gold plan §3 rule 2): "Writers are roles, and there are exactly
-- three DB pens ... Enforced by Postgres roles/RLS, not convention. A falsifier
-- enumerates roles with write grants and reds if a fourth appears."
--
-- Run: psql -d world2_dev -f 003_falsifier_roles.sql
-- GREEN = zero rows. Any row printed is a pen that exists outside the law.
-- This query CAN FAIL: grant INSERT on any table to snapshot_reader (or any
-- new role) and a row appears. (Verification probes must be able to fail.)

WITH writers AS (
  SELECT grantee, table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE')
    AND grantee NOT IN ('postgres', 'world2_owner')   -- owner = migrations only, not a runtime pen
),
lawful AS (
  SELECT * FROM (VALUES
    ('office_api',   'acts',             'INSERT'),
    ('office_api',   'claims',           'INSERT'),
    ('office_api',   'claims',           'UPDATE'),
    -- 007_private_drafts.sql, and it is the ONLY grant on this list that a row
    -- policy rather than a trigger keeps narrow: `claims_delete_own_draft`
    -- restricts it to `status = 'draft'` rows of the acting household, and
    -- `claims_delete_guard` refuses a non-draft deletion for every role
    -- including the owner. Lawful because a draft is the one claims state with
    -- no public receipt obligation — nobody outside the household has seen it,
    -- so nobody outside the household is owed an account of its ending. Every
    -- other state here is a public fact, and a public fact is retracted, never
    -- deleted. 007's header carries the full argument.
    ('office_api',   'claims',           'DELETE'),
    -- 018_settlements.sql. One row per settlement/S<n> tag, INSERT only — a
    -- blessing is canon and is never rewritten, so no pen holds UPDATE or DELETE.
    -- office_api because the row is written from the office's own world clone,
    -- under the office's own connection, after the keeper's tag lands there;
    -- the pen is named in 018's header and is one word to move if ruled otherwise.
    ('office_api',   'settlements',      'INSERT'),
    ('clearing_job', 'claims',           'UPDATE'),
    ('clearing_job', 'windows',          'INSERT'),
    ('clearing_job', 'windows',          'UPDATE'),
    ('clearing_job', 'marks',            'INSERT'),
    ('clearing_job', 'marks',            'UPDATE'),
    ('law_ingester', 'law_projection',   'INSERT'),
    ('law_ingester', 'law_projection',   'DELETE'),
    ('law_ingester', 'stamp_projection', 'INSERT'),
    ('law_ingester', 'stamp_projection', 'DELETE'),
    -- 010_town_roll.sql. The town's SECOND projection, written by the same pen
    -- in the same transaction against the same `projection_heads` row — so it
    -- is the stamp lane's grants, not a fourth writer. INSERT + DELETE and no
    -- UPDATE, like every projection here: replaced, never edited.
    ('law_ingester', 'town_roll',        'INSERT'),
    ('law_ingester', 'town_roll',        'DELETE'),
    ('law_ingester', 'projection_heads', 'INSERT'),
    ('law_ingester', 'projection_heads', 'UPDATE'),
    ('law_ingester', 'projection_heads', 'DELETE'),
    ('law_ingester', 'identities',       'INSERT'),
    ('law_ingester', 'identities',       'UPDATE'),
    ('law_ingester', 'identities',       'DELETE')
  ) AS t(grantee, table_name, privilege_type)
)
SELECT w.* FROM writers w
LEFT JOIN lawful l USING (grantee, table_name, privilege_type)
WHERE l.grantee IS NULL;
