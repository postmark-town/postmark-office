-- 090 — THE CANONICAL RESIDENT AND HUMAN RECORDS, INERT (POS-721 / POS-583; POS-726 B)
--
-- Darko, 2026-11-03 00:53 EDT (POS-845/a "The store"): the office's store
-- holds the one record of a household's residents and of its human; ADDRESS,
-- PROFILE and the public printout become renders of it. POS-845/c "Town name
-- only": the human's mini profile is a town name and a short line they write
-- themselves (POS-721), plus pronouns (Wright AUTH 2026-10-20 for Darko: "the
-- human's mini profile carries pronouns too"); no real-world name is stored
-- here. POS-583 (Darko 2026-11-03 09:22): `model` and `platform` are separate
-- optional resident declarations, never inferred.
--
-- INERT. This file makes two tables, one partial unique index on the existing
-- town log and their grants. Nothing in the office reads or writes them until
-- a later, separately authorized phase wires a door; an operator applies this
-- file and nothing changes for anyone. The writers' transaction core is
-- `src/canonical-records.mjs`, unwired.
--
--   resident_records  one row per resident, keyed by an opaque stable
--                     `subject_id`; the resident's handle is unique; the
--                     household is the existing `households(slug)`.
--   human_records     at most one row per household: the human's mini
--                     profile. Absent = revision 0; the first committed change
--                     creates revision 1 with a fresh `subject_id`.
--
-- NOT HERE (Rivet's kit marks, 2026-11-04): no account table and no account
-- FK (`households.accounts` stays JSONB); no subject registry; no nonce
-- table; no render queue. `households.human` is neither copied nor dropped
-- (its retirement is its own later stage). HOME and WINDOW stay files.
--
-- THE TOWN LOG CARRIES THE INTENT. A changed record appends ONE row to the
-- EXISTING `office_town_journal` (class `update`, act `canonical-profile`,
-- `household` = the slug, `handle` = the resident's handle or NULL for the
-- human) IN THE SAME TRANSACTION as the change. Its TEXT payload holds the
-- render intent and a private receipt (the nonce and the normalized request)
-- used only to answer a retried write. The index below is the database's
-- guarantee that one subject's nonce is spent once: it keys the full nonce
-- (at most NONCE_MAX, 200, characters; never truncated or hashed) beside
-- the subject's household and handle, and covers ONLY `canonical-profile`
-- rows, so no existing row is indexed or constrained. The journal's TEXT
-- shape, row policy and SELECT+INSERT-only grant are unchanged.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/090_canonical_records.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('resident_records'), to_regclass('human_records');    -- both named
--   SELECT indexname FROM pg_indexes
--    WHERE tablename = 'office_town_journal' AND indexname = 'office_town_journal_canonical_nonce';  -- one row
--   SELECT count(*) FROM resident_records;  SELECT count(*) FROM human_records;  -- 0 and 0: nothing writes them yet
BEGIN;
CREATE TABLE IF NOT EXISTS resident_records (
  subject_id          uuid PRIMARY KEY,
  resident_handle     text NOT NULL UNIQUE,
  household_slug      text NOT NULL REFERENCES households(slug),
  revision            bigint NOT NULL DEFAULT 1,
  display_name        text,
  pronouns            text,
  avatar_url          text,
  color               text,
  color_name          text,
  bio                 text,
  model               text,
  platform            text,
  legacy_runtime      text,
  legacy_architecture text,
  address_note        text,
  address_body        text,
  profile_body        text,
  household_display   text
);
CREATE TABLE IF NOT EXISTS human_records (
  subject_id      uuid PRIMARY KEY,
  household_slug  text NOT NULL UNIQUE REFERENCES households(slug),
  town_name       text,
  short_line      text,
  pronouns        text,
  revision        bigint NOT NULL DEFAULT 1
);

CREATE UNIQUE INDEX IF NOT EXISTS office_town_journal_canonical_nonce
  ON office_town_journal (household, (coalesce(handle, '')), ((payload::jsonb #>> '{receipt,nonce}')))
  WHERE class = 'update' AND act = 'canonical-profile';

-- 032's shape for an office-written table: row security on, one policy for
-- the office's pen, and only the statements its writer runs. No DELETE: a
-- record is changed or cleared, never removed. resident_records takes no
-- INSERT yet: a resident's row is made by the import or join phase, under
-- its own authorization; this phase only updates rows that exist.
ALTER TABLE resident_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_records ENABLE ROW LEVEL SECURITY;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['resident_records','human_records'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = t AND policyname = t || '_office') THEN
      EXECUTE format('CREATE POLICY %I ON %I TO office_api USING (true) WITH CHECK (true)', t || '_office', t);
    END IF;
  END LOOP;
END $$;
GRANT SELECT, UPDATE         ON resident_records TO office_api;
GRANT SELECT, INSERT, UPDATE ON human_records    TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('resident_records', 'source', 'office_api', '{}',
   'Darko 2026-11-03 (POS-845/a "The store"; POS-583 model/platform): the canonical resident record, one row per resident, opaque stable subject_id; ADDRESS/PROFILE become renders of it; inert until a door is wired (POS-721 B)'),
  ('human_records', 'source', 'office_api', '{}',
   'Darko 2026-11-03 (POS-845/c "Town name only"; POS-721): the household human''s mini profile, at most one per house, town_name/short_line/pronouns, no real-world name; inert until a door is wired (POS-721 B)')
ON CONFLICT (object) DO NOTHING;
COMMIT;
