-- 087 — invite_holds: THE HANDS' HOLD ON AN INVITER'S PAYOUT (POS-816, w46)
-- (Numbered 087 because postmark-office #754, POS-770, holds 086, arrival sources.)
--
-- RULED (Darko):
--   2026-10-28 23:07  the invite mint is deterministic, with Little Bird holding
--                     a veto instead of approving every mint ("otherwise little
--                     bird will drown").
--   2026-11-02 23:56  "calls are good. continue with the calls as stated": the
--                     hold is an office act checked by account (the bug-stage
--                     hands' pattern), Little Bird's, with Darko as her backup;
--                     a held payout waits until it is lifted; lifting and
--                     cancelling are each their own move and each needs a
--                     reason; a cancelled payout takes no place in the cap.
--   2026-11-03 00:08  the inviter's 10 waits "A week" after the trigger.
-- Little Bird, 2026-10-30, the program's keeper: "somewhere internal, wherever
-- is simplest to build"; "Always with a reason."
--
-- ── WHY A TABLE OF ITS OWN, AND NO ACTS ─────────────────────────────────────
--
-- 084's reason, word for word where it applies: every `acts` row with a crossing
-- is written, payload and all, to postmark-world's public STATE/log at each
-- settlement and frozen in the notary's archive. A hold's reason is the hands'
-- judgment about a household ("this looks like a second account"), and it is
-- internal. A hold that is never an act cannot reach any public reader. So a
-- hold keeps its whole life here: its state, and each move the hands made,
-- inline, oldest first.
--
-- ── ONE ROW PER INVITED HOUSEHOLD ───────────────────────────────────────────
--
-- `household` is the INVITED house's slug: an invitation is that house's
-- (`households.invited_by`, 085), and its inviter's payout is what is held. No
-- row is no hold. `state`: held (it waits until lifted), lifted (it pays when
-- due) or cancelled (it is never paid; final). The pen's judge is
-- src/invite-pay.mjs § judgeHoldMove; the hands are INVITE_HOLD_HANDS, checked
-- by credential (src/named-hand.mjs § holdsHand) in src/invite-hold-store.mjs.
--
-- PRIVATE: `office_api` only. NO GRANT to `snapshot_reader` or any other role,
-- so no export reads it, and nothing here is ever written to git. No row policy:
-- unlike a report, no household reads its own row; the one reader is the hands'
-- door, and the pay pass reads the states.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/087_invite_holds.sql
--
-- A second run is a no-op: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, and GRANT
-- is idempotent. Until it lands, the hands' hold says it cannot look, and the
-- pay pass pays NO inviter side: a hold it cannot read is never assumed absent.
-- The invited side's 5 more does not wait on it.
--
-- ── HOW TO PROVE IT LANDED (there is no migrations table in this store) ──────
--
--   SELECT to_regclass('public.invite_holds') IS NOT NULL;                      -- t
--   SELECT has_table_privilege('snapshot_reader', 'invite_holds', 'SELECT');     -- f
--   SELECT has_table_privilege('office_api', 'invite_holds', 'UPDATE');          -- t
--
-- CONSUMERS, named: src/invite-hold-store.mjs (move, read), src/invite-facts.mjs
-- (the pay pass's and the report's read of the states), test/invite-hold.test.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS invite_holds (
  household  text PRIMARY KEY CHECK (household ~ '^[a-z0-9][a-z0-9-]*$'),   -- the invited household's slug
  state      text NOT NULL CHECK (state IN ('held', 'lifted', 'cancelled')),
  moves      jsonb NOT NULL DEFAULT '[]'::jsonb,                            -- [{ from, to, note, hand, at }], oldest first
  updated_at timestamptz NOT NULL
);

GRANT SELECT, INSERT, UPDATE ON invite_holds TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('invite_holds', 'source', 'office_api', '{}',
   'Darko 2026-10-28 23:07, 2026-11-02 23:56 and 2026-11-03 00:08 (POS-816): the hands'' hold on an inviter''s payout, Little Bird''s with Darko as backup; held waits until lifted, cancelled is never paid, every move carries a reason; office_api only, in no export, never written to git')
ON CONFLICT (object) DO NOTHING;

COMMIT;
