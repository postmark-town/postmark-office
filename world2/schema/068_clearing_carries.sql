-- 068 — the clearing writes a carried mark's claim (POS-441)
--
-- RULED (Darko, 2026-10-07, POS-441; postmark#2458): moving a mark carries the
-- marks inside it that belong to the same household; they keep their place
-- relative to it. Another household's marks never move. "That should just
-- always be the default rule."
--
-- The store composes no frames, so a rider moves only if the clearing writes it
-- (world2/tools/carry.mjs § why the store has to write it). It is written the
-- store's one lawful way — a locked claim superseding the standing mark, then
-- `materializeClaims` — so every version stays in the log as its own claim row.
-- That claim is born inside the clearing's transaction, already decided, and
-- `clearing_job` has never held INSERT on `claims`: the door files claims and the
-- candle decides them. This grants the one INSERT the carry needs and nothing
-- wider.
--
-- ── THE INSERT IS NARROWED BY A TRIGGER, AS 002 NARROWS office_api's UPDATE ──
--
-- `clearing_job` may insert a claim only when it is the record of a carry: born
-- `locked`, superseding a standing mark, and naming the act that carried it in
-- `data._carried_by` (the mover's claim id). Anything else it tries is refused
-- by name. Every other pen's INSERT is untouched.
--
-- 003_falsifier_roles.sql lists the grant (('clearing_job', 'claims', 'INSERT')).
-- 066 and 067 are taken by postmark-office#376; this is 068 on purpose.

BEGIN;

GRANT INSERT ON claims TO clearing_job;

-- 007 put `claims` under row security, and its only INSERT policy is the door's
-- (TO office_api). The candle's write needs its own: a carried claim is born
-- decided, never a draft.
DROP POLICY IF EXISTS claims_insert_clearing ON claims;
CREATE POLICY claims_insert_clearing ON claims FOR INSERT TO clearing_job
  WITH CHECK (status = 'locked');

CREATE OR REPLACE FUNCTION claims_insert_carry_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'clearing_job' THEN RETURN NEW; END IF;
  IF NEW.status = 'locked' AND NEW.supersedes IS NOT NULL
     AND NEW.data IS NOT NULL AND NEW.data ? '_carried_by' THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'claims: clearing_job may insert only a carried mark''s claim (status locked, superseding a standing mark, data._carried_by naming the move) — POS-441';
END $$;

DROP TRIGGER IF EXISTS claims_insert_carry_only ON claims;
CREATE TRIGGER claims_insert_carry_only
  BEFORE INSERT ON claims
  FOR EACH ROW EXECUTE FUNCTION claims_insert_carry_only();

UPDATE registry SET ruling = ruling || ' + 068: clearing_job inserts a carried mark''s locked claim (POS-441, data._carried_by), narrowed by trigger'
  WHERE object = 'claims' AND ruling NOT LIKE '%068:%';

COMMIT;
