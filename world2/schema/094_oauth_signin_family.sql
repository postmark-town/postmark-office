-- 094 — oauth_tokens.family: WHICH SIGN-IN A TOKEN PAIR CAME FROM (POS-485, a box step at the ship)
--
-- RULED (Darko, 2026-11-13). 09:09 EST, POS-485/a: "End the whole sign-in, no grace": a reused, retired refresh token ends
-- every key from that sign-in, the 30-day access key included, and the person signs in again. 13:1x EST, POS-485/b: "Link new
-- keys, leave old": from the switch every new or refreshed pair records its sign-in and falls under that rule; access keys
-- issued before the switch stay outside it until they expire on their own (30 days at most). Nobody is signed out.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   family   NEW, text, NULL on every existing row. The office writes a random id once per sign-in (an authorization-code
--            exchange) on the access and refresh rows it issues, and every refresh carries it to the new pair
--            (src/oauth.mjs § THE SIGN-IN'S FAMILY). It is not a credential and is never shown.
--   kind     031's column, unchanged in type, gains one value the office writes: 'spent', a refresh token retired by its
--            rotation, kept on its own hash with its family, NULL expires and nothing else, as the evidence that
--            recognizes it if it comes back. The kinds are now access | refresh | household | static | retired | spent.
--   index    oauth_tokens_family, for the revocation (DELETE ... WHERE family = $1) and the sweep's NOT EXISTS.
--
-- NO BACKFILL, AND NO ROW CHANGES. A family is never inferred for an existing row: not from the account, the client or the
-- times (one account holds many sign-ins). An existing refresh token starts a family at its first rotation after the code
-- ships; the access keys issued beside it before then stay NULL and outside the rule until they expire.
--
-- NO GRANT CHANGES. office_api already holds SELECT, INSERT and DELETE on oauth_tokens (031), and the office still never
-- UPDATEs a token: a rotation DELETEs the refresh row and INSERTs its 'spent' row and the new pair. A rotation and a
-- revocation of one family serialize on a transaction-scoped advisory lock (pg_advisory_xact_lock), which needs no grant.
-- 031's RLS policy (oauth_tokens_office, USING true) covers the new column.
--
-- ── COMPATIBILITY: APPLY BEFORE THE CODE ────────────────────────────────────
--
-- The new code writes `family` on every pair it issues, so against a store without the column every sign-in and every
-- refresh would roll back (the token endpoint answers 503 with Retry-After: nobody is signed out, but nobody can sign in
-- or refresh). So: 094 first, then the code.
-- The office before this change ignores the column (it names its columns), so 094 can land any time before the deploy.
-- A rollback of the code after the deploy leaves the 'spent' rows inert (no reader before this change matches the kind,
-- and its sweep skips NULL expires) and the family column unread; refreshes keep working, without the reuse rule.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d "$DB" \
--     -c "SET ROLE world2_owner;" -f world2/schema/094_oauth_signin_family.sql
--
-- where $DB is the office's database, read from WORLD2_PG_URL in /etc/postmark-office.env; the exact pipe from a tag and
-- its proof are deploy/DEPLOY.md § 094.
--
-- It waits at most 5 s for its lock (lock_timeout): behind a long transaction on oauth_tokens it fails with
-- lock_not_available and changes nothing, so run it again. Taking the lock briefly holds sign-in lookups for as long as the
-- index takes to build on a table of a few thousand rows.
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane applies it.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT data_type FROM information_schema.columns
--    WHERE table_name = 'oauth_tokens' AND column_name = 'family';          -- text
--   SELECT to_regclass('public.oauth_tokens_family');                       -- oauth_tokens_family
--   SELECT count(*) FROM oauth_tokens WHERE family IS NOT NULL;             -- 0 until the code ships

BEGIN;
SET LOCAL lock_timeout = '5s';

ALTER TABLE oauth_tokens ADD COLUMN IF NOT EXISTS family text;
CREATE INDEX IF NOT EXISTS oauth_tokens_family ON oauth_tokens (family);

COMMIT;
