-- deploy/uat/scrub.sql — what UAT's copy of the store loses before anyone signs in (CORE-160). A DRAFT.
--
-- REVIEWED: no
--
-- store-restore-scrub.sh refuses to run until the line above reads `REVIEWED: <Darko's ruling, dated>`.
-- The list is Jetto's proposal from 2026-11-23 (CORE-160, "the scrub list for Darko"), checked against
-- prod's columns that night (information_schema, read-only: every column whose name says token, secret,
-- hash, login, payer, address and the like). The questions still his: do PRIVATE parts exist beyond these
-- (drafts, unsent letters, household settings) that must go too? And `arrival_source_pending`, the one
-- other table whose name says pending: keep or empty?
--
-- The rule: keep the public record (handles, households, acts, marks, letters, settlements) so UAT tests
-- what residents see; drop every credential and anything that would let UAT reach a real person or system.
-- Runs in one transaction against the freshly restored copy, never against a live store.

BEGIN;

-- 1. Every sign-in. Prod's tokens are useless on UAT (its own GitHub OAuth app), but even their hashes stay
--    off the box. Testers sign in through UAT's app; the fleet gets a UAT static key of its own.
DELETE FROM oauth_tokens;        -- access tokens, household keys, static keys (token_hash, gh_login)
DELETE FROM oauth_codes;
DELETE FROM oauth_pending;
DELETE FROM oauth_key_claims;    -- pending claims carry a capability (ask_hash)

-- 2. Berths keep their names and co-signs (the harbor is public), never a working key.
UPDATE oauth_berths SET token_hash = 'uat-scrubbed:' || slug;

-- 3. A household's harness: its secret, and its address, which is where the office would reach a real
--    resident's agent. UAT must never call a real harness.
--    `address` is NOT NULL (checked 2026-11-23), so it gets an address that cannot route (.invalid, RFC 2606),
--    kept distinct per row in case a constraint wants it.
UPDATE household_harnesses SET secret = NULL, address = 'https://harness.invalid/uat-scrubbed/' || md5(address);

-- 4. Who paid a pot (town_pot_receipts.payer: a payment identity). The receipt and its amount stay.
UPDATE town_pot_receipts SET payer = 'uat-scrubbed';

-- Kept on purpose, as the public record: household_pins.login, identities.gh_login, office_roles.login,
-- office_role_audit.login, office_town_journal.gh_login, town_residents.github_address (GitHub logins
-- the town already shows), oauth_berths.cosigned_gh_login.

-- The readback the script prints: each must be 0.
SELECT 'oauth_tokens' AS t, count(*) FROM oauth_tokens
UNION ALL SELECT 'oauth_key_claims', count(*) FROM oauth_key_claims
UNION ALL SELECT 'berths with a real hash', count(*) FROM oauth_berths WHERE token_hash NOT LIKE 'uat-scrubbed:%'
UNION ALL SELECT 'harness secrets or live addresses', count(*) FROM household_harnesses WHERE secret IS NOT NULL OR address NOT LIKE 'https://harness.invalid/uat-scrubbed/%'
UNION ALL SELECT 'payers', count(*) FROM town_pot_receipts WHERE payer IS DISTINCT FROM 'uat-scrubbed';

COMMIT;
