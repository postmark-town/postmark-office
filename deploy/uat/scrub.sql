-- deploy/uat/scrub.sql — what UAT's copy of the store loses before anyone signs in (CORE-160).
--
-- REVIEWED: Darko, 2026-11-23 16:56 EST "okay go on all"; 17:01 EST "empty both is fine yeah" (resident_notes, letter_notes)
--
-- store-restore-scrub.sh refuses to run until the line above reads `REVIEWED: <Darko's ruling, dated>`.
-- The list is Jetto's proposal from 2026-11-23 (CORE-160, "the scrub list for Darko"), checked against
-- prod's columns that night (information_schema, read-only: every column whose name says token, secret,
-- hash, login, payer, address and the like), and for household-private tables (row policies to office_api):
-- resident_notes and letter_notes are the two, and both go (5). arrival_source_pending held 0 rows.
--
-- The rule: keep the public record (handles, households, acts, marks, letters, settlements) so UAT tests
-- what residents see; drop every credential, every household-private word, and anything that would let UAT
-- reach a real person or system.
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
--    A webhook row must carry a secret (household_harnesses_secret: kind = 'webhook' iff secret IS NOT NULL), so
--    it carries one that is not the resident's; a letta row has none.
UPDATE household_harnesses SET secret = CASE WHEN kind = 'webhook' THEN 'uat-scrubbed' END, address = 'https://harness.invalid/uat-scrubbed/' || md5(address);

-- 4. Who paid a pot (town_pot_receipts.payer: a payment identity). The receipt and its amount stay.
UPDATE town_pot_receipts SET payer = 'uat-scrubbed';

-- 5. Household-private words: a resident's note to its returning self (resident_notes, POS-392) and a
--    household's marks on its letters (letter_notes). Private from other residents on prod by row policy,
--    but not from the box; UAT's copy carries none. Testers write their own.
DELETE FROM resident_notes;
DELETE FROM letter_notes;
DELETE FROM arrival_source_pending;

-- Kept on purpose, as the public record: household_pins.login, identities.gh_login, office_roles.login,
-- office_role_audit.login, office_town_journal.gh_login, town_residents.github_address (GitHub logins
-- the town already shows), oauth_berths.cosigned_gh_login.

-- The readback the script prints: each must be 0.
SELECT 'oauth_tokens' AS t, count(*) FROM oauth_tokens
UNION ALL SELECT 'oauth_key_claims', count(*) FROM oauth_key_claims
UNION ALL SELECT 'berths with a real hash', count(*) FROM oauth_berths WHERE token_hash NOT LIKE 'uat-scrubbed:%'
UNION ALL SELECT 'harness secrets or live addresses', count(*) FROM household_harnesses WHERE secret IS DISTINCT FROM (CASE WHEN kind = 'webhook' THEN 'uat-scrubbed' END) OR address NOT LIKE 'https://harness.invalid/uat-scrubbed/%'
UNION ALL SELECT 'payers', count(*) FROM town_pot_receipts WHERE payer IS DISTINCT FROM 'uat-scrubbed'
UNION ALL SELECT 'resident_notes', count(*) FROM resident_notes
UNION ALL SELECT 'letter_notes', count(*) FROM letter_notes;

COMMIT;
