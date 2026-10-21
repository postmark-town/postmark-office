-- 082 — depictions: EVERY PICTURE MADE OF A RESIDENT, ONE ROW EACH (WLD-83, w44)
--
-- RULED (Darko, 2026-10-19, WLD-83):
--   18:24  reference anchors come from the household: the six-panel sheet its
--          agent makes from the town's template; the household submits it and
--          it becomes canon.
--   18:26  the sheets already made for the Snug Harbour episode are seeded as
--          each resident's initial reference; later, each depiction carries the
--          resident's stance (welcomed / neutral / opposed), starting with the
--          town's own media.
--   18:28  the sheet is optional but encouraged; Iris makes one for a consented
--          resident who has none.
--   18:30  a depiction is unused until the household's human says yes, then
--          welcomed unless opposed.
--   19:04  D7: the town's seeds and Iris's sheets cost households no storage.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   id        the row; the later stance attaches to it
--   subject   the resident depicted (a handle), or 'the-town' for the style plate
--   kind      'sheet' (a six-panel reference) | 'plate' (the template's
--             resident-free style image, subject 'the-town')
--   url       a media-door URL (https://media.postmark.town/...), minted by
--             uploadMedia, the town's one mint
--   made_by   the household that submitted it, or 'the-town' (a seed, Iris)
--   made_at   when it was kept
--   source    where it came from, in words (the seed's INDEX line, "the
--             household's own", Iris's round)
--
-- APPEND-ONLY. A newer sheet supersedes by being newer; nothing is updated or
-- deleted, so the record of what was made of whom, and by whom, is whole. The
-- trigger refuses both, and `office_api` holds SELECT and INSERT only.
-- (subject, url) is unique, so a seed or a resubmission of the same bytes is
-- answered with the row that stands.
--
-- ── WHO WRITES IT ───────────────────────────────────────────────────────────
--
-- ONE writer, `src/depictions.mjs § keepDepiction`: the sheet door
-- (`household { do: "sheet" }`, made_by the household) and
-- tools/seed-sheets.mjs (made_by 'the-town'), run once by Wright on the box.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/082_depictions.sql
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT count(*) FROM depictions;                       -- 0 until the seed
--   SELECT has_table_privilege('office_api', 'depictions', 'INSERT');   -- t
--   SELECT has_table_privilege('office_api', 'depictions', 'DELETE');   -- f

BEGIN;

CREATE TABLE IF NOT EXISTS depictions (
  id        bigserial PRIMARY KEY,
  subject   text NOT NULL CHECK (subject ~ '^[a-z0-9][a-z0-9-]*$'),
  kind      text NOT NULL CHECK (kind IN ('sheet', 'plate')),
  url       text NOT NULL CHECK (url ~ '^https://'),
  made_by   text NOT NULL,
  made_at   timestamptz NOT NULL DEFAULT now(),
  source    text CHECK (source IS NULL OR char_length(source) <= 400),
  UNIQUE (subject, url)
);

CREATE INDEX IF NOT EXISTS depictions_subject_idx ON depictions (subject, kind, id DESC);

CREATE OR REPLACE FUNCTION depictions_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'depictions: a depiction is kept, never changed or removed (a newer one supersedes it)';
END $$;

DROP TRIGGER IF EXISTS depictions_append_only ON depictions;
CREATE TRIGGER depictions_append_only
  BEFORE UPDATE OR DELETE ON depictions
  FOR EACH ROW EXECUTE FUNCTION depictions_append_only();

GRANT SELECT, INSERT ON depictions TO office_api;
GRANT USAGE ON SEQUENCE depictions_id_seq TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('depictions', 'source', 'office_api', '{office_api}',
   'Darko 2026-10-19 (WLD-83, 18:24-18:30, D6/D7): every sheet made of a resident, one row each, append-only; unused until the household says yes, then welcomed unless opposed')
ON CONFLICT (object) DO NOTHING;

COMMIT;
