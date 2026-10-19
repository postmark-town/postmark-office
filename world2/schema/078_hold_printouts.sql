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
-- WHAT THIS DOES NOT CHANGE: no grant on `claims` (`clearing_job` has held INSERT
-- on it since 068; the one new grant is on `acts`, for the return below); the policy (`claims_insert_clearing` admits status
-- 'locked' already); 068's and 076's arms, verbatim. The function and trigger
-- keep 068's names, so 068's and 076's landed-probes still read true.
--
-- AND ONE CHECK, WIDENED BY ONE CASE: 004's `sited_marks_have_a_where` lets a
-- `sited` row be placeless only when it names its holder (a thing in the old
-- form, held). Found on the playground's crossing of window 273: two old-form
-- bags were refused by it. See the block below.
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
--   SELECT pg_get_constraintdef(oid) LIKE '%held_by%' FROM pg_constraint WHERE conname = 'sited_marks_have_a_where';  -- t
--   SELECT has_table_privilege('clearing_job', 'acts', 'INSERT') AND EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'acts_insert_return_only');  -- t
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

-- ── A HELD THING IN THE OLD FORM HAS NO WHERE EITHER ───────────────────────────
--
-- 004's CHECK holds every `sited` row to a geometry. A thing in the old form
-- (`kind: sited` with `class: <a kind of thing>`, as the doors wrote it before
-- LOGOS v2's W2) is `sited` in this column, so its printout as held (geometry
-- null) was refused by name ("a sited mark with no place"). It is allowed exactly
-- when the row names its holder; a parcel, and every sited mark nobody holds,
-- still needs its where.
ALTER TABLE marks DROP CONSTRAINT IF EXISTS sited_marks_have_a_where;
ALTER TABLE marks ADD CONSTRAINT sited_marks_have_a_where
  CHECK (kind NOT IN ('sited','parcel') OR (geometry IS NOT NULL AND bbox IS NOT NULL)
         OR (kind = 'sited' AND data ? 'held_by'));

-- ── AN OPPOSED TAKE RETURNS AT THE SETTLEMENT (POS-688 D3, Darko 2026-10-19 09:21) ──
--
-- "The maker may oppose a take before the settlement, and the thing returns."
-- The opposition is a stance (the set-down arm's machinery, world-stance.mjs §
-- the take arm); the return is ONE act the clearing writes in its own
-- transaction, so the record and the printout agree the moment the window locks
-- (hold-through.mjs § an opposed take returns). `clearing_job` has never held
-- INSERT on `acts`: this grants it, narrowed by a trigger to exactly that act —
--
--   · the town's own (`actor = 'the-town'`), class holding, a drop or a give;
--   · `payload.returned` names a TAKE of this very thing and the maker's
--     OPPOSED stance on that take, both standing in `acts`;
--   · of a standing mark, once per take (no earlier return names it).
--
-- Every other pen's INSERT on acts is untouched (the function returns at once
-- for any other role). 003_falsifier_roles.sql lists the grant.
GRANT INSERT ON acts TO clearing_job;

CREATE OR REPLACE FUNCTION acts_insert_return_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user <> 'clearing_job' THEN RETURN NEW; END IF;
  IF NEW.class = 'holding' AND NEW.actor = 'the-town' AND NEW.action IN ('drop', 'give')
     AND NEW.payload IS NOT NULL AND jsonb_typeof(NEW.payload -> 'returned') = 'object'
     AND NEW.payload ->> 'thing' = NEW.object
     AND EXISTS (SELECT 1 FROM marks m WHERE m.slug = NEW.object AND m.status = 'standing')
     AND EXISTS (SELECT 1 FROM acts k
                  WHERE k.id::text = NEW.payload -> 'returned' ->> 'take_act'
                    AND k.class = 'holding' AND k.action = 'take' AND k.object = NEW.object)
     AND EXISTS (SELECT 1 FROM acts s
                  WHERE s.id::text = NEW.payload -> 'returned' ->> 'stance_act'
                    AND s.class = 'stance' AND s.object = NEW.object
                    AND s.payload ->> 'answers' = 'take' AND s.payload ->> 'stance' = 'opposed'
                    AND s.payload -> 'take' ->> 'act_id' = NEW.payload -> 'returned' ->> 'take_act')
     AND NOT EXISTS (SELECT 1 FROM acts r
                      WHERE r.object = NEW.object AND r.class = 'holding'
                        AND r.payload -> 'returned' ->> 'take_act' = NEW.payload -> 'returned' ->> 'take_act') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'acts: clearing_job may insert only the return of an opposed take (the town''s drop or give of a standing thing, payload.returned naming the take and the maker''s opposed stance on it, once per take: POS-688)';
END $$;

DROP TRIGGER IF EXISTS acts_insert_return_only ON acts;
CREATE TRIGGER acts_insert_return_only BEFORE INSERT ON acts
  FOR EACH ROW EXECUTE FUNCTION acts_insert_return_only();

UPDATE registry SET ruling = ruling || ' + 078: clearing_job prints a hold record through (POS-688, data._held_through): a locked claim superseding its own standing mark, by its owner, changing only where it is or whose hands it is in; a sited row may be placeless when it names its holder'
  WHERE object = 'claims' AND ruling NOT LIKE '%078:%';

COMMIT;
