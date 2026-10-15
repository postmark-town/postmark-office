-- 076 — a mark the settlement takes goes back to its household's drafts, and
-- the store remembers why it left (WLD-51 ruling 2; postmark#3757)
--
-- RULED (Darko, 2026-10-15 13:00, WLD-51 G1): "When the settlement takes a
-- mark, it writes the mark back to its household as a private draft claim
-- (`claims.status = 'draft'`) at its last place, with nothing staked behind it.
-- It then shows in their drafts, and staking it or putting it forward brings it
-- back, as the git era's 'return to the draft branch' did." The store era only
-- ever wrote a `retired` row (retire-unpublished.mjs → materialize.mjs §
-- retireMarks), which was drift from the store port, never a ruling.
--
-- RULED (Darko, 2026-10-15 12:59, WLD-51 G3): "every taken mark gets a
-- doorstep and needs-you note for 7 days, or until it's put forward again; no
-- letter." The note needs to know which door a retired mark left by.
--
-- ── 1 · marks.retired_cause (G3) ────────────────────────────────────────────
--
-- The store retires a mark by two doors, and the note is true of only one:
--
--   settlement-unpublish   the sweep took it (retire-unpublished.mjs)
--   marks-ingest           a file-side change on main took it (marks-ingest.mjs)
--
-- `retireMarks` already carried the cause, onto the receipt only. It now writes
-- it here too. A row retired before this migration has no cause (NULL) and is
-- never noted: the note starts with the first take after the deploy.
--
-- ── 2 · clearing_job may plant a RETURNED draft (G1) ────────────────────────
--
-- The retire step runs as `clearing_job`, in its own transaction (068's pen,
-- one INSERT on `claims`, narrowed by trigger to a carry). It gains exactly one
-- more insert, narrowed the same way: a draft claim that is the return of a
-- mark this pen has just retired by the sweep's door. The trigger lets it in
-- only when ALL of these hold:
--
--   · status 'draft', stake 0, no `supersedes`;
--   · `data._returned.mark` names a `marks` row that is RETIRED, with
--     `retired_cause = 'settlement-unpublish'`, carrying this claim's slug,
--     whose OWNER is this claim's claimant (a mark goes back to its own
--     author's drafts, and the clearing's revive then asks the same thing:
--     clearing-job.mjs § step 1, "only its author may leave it again");
--   · the claim's `household` IS the mark's (`m.household`, the house it
--     stood in: G1's "its household"), so the pen cannot choose the house;
--   · the claim is written in the window the mark was retired at
--     (`m.retired_window = window_id`, and `data._returned.window` says so):
--     a return is part of its take, never a later act;
--   · no claim already returns this mark from this take: once per take.
--
-- And the row policy holds it to a household the transaction declared, as 024
-- holds the door's drafts: `household = ANY(app.household_keys)`, so it cannot
-- plant one at all outside a declared transaction. The binding to the mark's
-- own house is the trigger's, in SQL, and does not rest on what the pen
-- declares (review-220-577, finding 2b: with only the policy, a return planted
-- into another house it declared read "inserted").
--
-- ── WHAT THIS DOES NOT CHANGE ───────────────────────────────────────────────
--
-- No grant: `clearing_job` has held INSERT on `claims` since 068, and
-- 003_falsifier_roles.sql already lists it. No read carve: a draft is still
-- visible only to a transaction that declared its household (007/024), and the
-- retire step declares the one house it is returning to, to see whether that
-- house already holds a draft of the mark (theirs stands; nothing is written).
-- The function and trigger keep 068's names, so 068's landed-probe still reads
-- true and nothing re-applies it over this.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, BEFORE THE OFFICE CODE ─────────────
--
-- The w43 office's retireMarks writes `retired_cause`; on a store without this
-- column every retirement refuses (loudly; the crossing still publishes, and the
-- retire step is owed). Apply this first, away from the 06:00/18:00Z clearing:
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d <db> \
--     -c "SET ROLE world2_owner;" -f world2/schema/076_taken_to_drafts.sql
--
-- Ship check:
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'marks' AND column_name = 'retired_cause';         -- 1 row
--   SELECT with_check FROM pg_policies WHERE policyname = 'claims_insert_clearing';  -- names 'draft'
--
-- CONSUMERS: world2/tools/materialize.mjs § retireMarks, § returnToDrafts
-- (the writers); world2/tools/retire-unpublished.mjs (the step);
-- src/doorstep-stakes.mjs § leftTheWorld (the note), read by the doorstep's
-- `stakes` segment and household { read: "needs-you" }.

BEGIN;

-- The policy and trigger change take locks on `claims`; door writes queue
-- behind them. Give up in 5 s rather than stall the doors (072's guard).
SET LOCAL lock_timeout = '5s';

ALTER TABLE marks ADD COLUMN IF NOT EXISTS retired_cause text;

ALTER POLICY claims_insert_clearing ON claims
  WITH CHECK (status = 'locked'
              OR (status = 'draft'
                  AND household = ANY(string_to_array(NULLIF(current_setting('app.household_keys', true), ''), ','))));

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
  RAISE EXCEPTION 'claims: clearing_job may insert only a carried mark''s claim (status locked, superseding a standing mark, data._carried_by naming the move: POS-441) or a taken mark''s return to its author''s drafts, once, in its own house and window (status draft, stake 0, data._returned naming the mark the sweep retired: WLD-51)';
END $$;

UPDATE registry SET ruling = ruling || ' + 076: clearing_job returns a mark the sweep took to its author''s drafts (WLD-51 G1, data._returned), narrowed by trigger and by app.household_keys; marks.retired_cause names the door a mark left by (G3)'
  WHERE object = 'claims' AND ruling NOT LIKE '%076:%';

COMMIT;
