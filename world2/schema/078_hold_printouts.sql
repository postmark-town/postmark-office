-- 078 — the clearing prints where a thing is: a hold printout (POS-688)
--
-- RULED (Darko, 2026-10-18 20:58, POS-688): a held thing is published but
-- unplaced. "I totally forgot that we made it so that held marks are still
-- technically considered marks. I think that's the best of both worlds and just
-- the cleanest and most commonsensical solution." The settlement prints a held
-- thing with `held_by: <its holder>` and no at/extent, and a drop prints a fresh
-- at where the dropper stood.
--
-- HOW (W1 a, settled by Wright the same night): the clearing writes the hold
-- record through, step 6.2 (world2/tools/hold-through.mjs), as a locked claim
-- of its own superseding the standing mark, filed by materialize.mjs: the
-- store's one lawful way, so every version stays in the log as its own claim
-- row. That INSERT is `clearing_job`'s, and 068's trigger (widened by 076)
-- narrows the pen's INSERT to two shapes:
--
--   068  a CARRY: locked, superseding a standing mark, `data._carried_by`
--        naming the mover's claim. A hold printout is no carry: nothing moved
--        it, and there is no mover's claim to name. Naming a fake one would put
--        a false move on the record and on the window's receipts.
--   076  a RETURN: a DRAFT, stake 0, superseding nothing, of a mark the sweep
--        just RETIRED. A hold printout is the opposite on every clause: locked,
--        superseding a STANDING mark that stays standing.
--
-- So this adds a third arm, as narrow as the other two. `clearing_job` may
-- insert a hold printout only when ALL of these hold:
--
--   · status 'locked', superseding a mark that is STANDING, of the same slug;
--   · the claimant is that mark's OWNER (a printout never changes whose it is);
--   · its kind and its body are the mark's own (a printout carries no new words);
--   · its data is the mark's data but for the hold keys alone: `held_by`, where
--     it last stood (`_placed`), the cutoff that printed it (`_held_through`, the
--     arm's marker), and the file bookkeeping the write-down re-derives
--     (`_fileAt`, `_origin`). So a printout can change where a thing is, or
--     whose hands it is in, and nothing else.
--
-- WHAT THIS DOES NOT CHANGE: no grant (`clearing_job` has held INSERT on
-- `claims` since 068); the policy (`claims_insert_clearing` admits status
-- 'locked' already); 068's and 076's arms, verbatim. The function and trigger
-- keep 068's names, so 068's and 076's landed-probes still read true.
--
-- IDEMPOTENT. APPLY AS `world2_owner`, BEFORE THE OFFICE CODE THAT PRINTS
-- (office #628). Without it the clearing's step 6.2 is refused by name, and
-- the whole window with it (one transaction).
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/078_hold_printouts.sql
--
-- ⚑ A BOX MIGRATION UNDER THE SOFT FREEZE (SHIPPING § 10) IS DARKO'S CALL
-- (Wright, 2026-10-18): applied to a sandbox store only until he rules.
--
-- Ship check:
--   SELECT prosrc LIKE '%_held_through%' FROM pg_proc WHERE proname = 'claims_insert_carry_only';  -- t
--
-- CONSUMERS: world2/tools/hold-through.mjs § writeHoldThrough (the writer);
-- world2/tools/clearing-job.mjs step 6.2.

BEGIN;

SET LOCAL lock_timeout = '5s';

CREATE OR REPLACE FUNCTION claims_insert_carry_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'clearing_job' THEN RETURN NEW; END IF;
  -- 068: a carried mark's claim
  IF NEW.status = 'locked' AND NEW.supersedes IS NOT NULL
     AND NEW.data IS NOT NULL AND NEW.data ? '_carried_by' THEN
    RETURN NEW;
  END IF;
  -- 076: a taken mark, returned to its author's drafts, in its own house, once per take
  IF NEW.status = 'draft' AND NEW.stake = 0 AND NEW.supersedes IS NULL
     AND NEW.data IS NOT NULL AND jsonb_typeof(NEW.data -> '_returned') = 'object'
     AND EXISTS (SELECT 1 FROM marks m
                  WHERE m.id::text = NEW.data -> '_returned' ->> 'mark'
                    AND m.slug = NEW.slug AND m.owner = NEW.claimant
                    AND NEW.household = m.household
                    AND m.status = 'retired' AND m.retired_cause = 'settlement-unpublish'
                    AND m.retired_window = NEW.window_id
                    AND NEW.data -> '_returned' ->> 'window' = m.retired_window::text
                    AND NOT EXISTS (SELECT 1 FROM claims c
                                     WHERE c.data -> '_returned' ->> 'mark' = m.id::text
                                       AND c.data -> '_returned' ->> 'window' = m.retired_window::text)) THEN
    RETURN NEW;
  END IF;
  -- 078: a hold printout, the same standing mark moved into or out of hands and nothing else (POS-688)
  IF NEW.status = 'locked' AND NEW.supersedes IS NOT NULL
     AND NEW.data IS NOT NULL AND NEW.data ? '_held_through'
     AND EXISTS (SELECT 1 FROM marks m
                  WHERE m.id = NEW.supersedes AND m.status = 'standing'
                    AND m.slug = NEW.slug AND m.owner = NEW.claimant
                    AND m.kind = NEW.class
                    AND m.body IS NOT DISTINCT FROM NEW.body
                    AND (COALESCE(m.data, '{}'::jsonb) - 'held_by' - '_placed' - '_held_through' - '_fileAt' - '_origin')
                      = (NEW.data - 'held_by' - '_placed' - '_held_through' - '_fileAt' - '_origin')) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'claims: clearing_job may insert only a carried mark''s claim (status locked, superseding a standing mark, data._carried_by naming the move: POS-441), a taken mark''s return to its author''s drafts, once, in its own house and window (status draft, stake 0, data._returned naming the mark the sweep retired: WLD-51), or a hold printout (status locked, superseding its own standing mark, by its owner, with its kind, body and data but for where it is or whose hands it is in, data._held_through naming the cutoff: POS-688)';
END $$;

UPDATE registry SET ruling = ruling || ' + 078: clearing_job prints a hold record through (POS-688, data._held_through): a locked claim superseding its own standing mark, by its owner, changing only where it is or whose hands it is in'
  WHERE object = 'claims' AND ruling NOT LIKE '%078:%';

COMMIT;
