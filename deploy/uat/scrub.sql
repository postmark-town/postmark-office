-- deploy/uat/scrub.sql — what UAT's copy of the store loses before anyone signs in (CORE-160).
--
-- REVIEWED: Darko, 2026-11-23 16:56 EST "okay go on all"; 17:01 EST "empty both is fine yeah" (resident_notes, letter_notes)
-- AWAITING: Darko's review of every delete and scrub marked `awaiting` in the table below (CORE-165, finding 1 of Truey's review of #1206). Listed one per line next to its statement.
--
-- store-restore-scrub.sh refuses to run while this file has a line starting `-- AWAITING:` (nothing here reached
-- Darko yet), and refuses unless the REVIEWED line above reads `REVIEWED: <Darko's ruling, dated>`. To clear the
-- first, Darko rules on each awaiting row; the keeper then deletes that row's AWAITING line and extends REVIEWED with
-- his words and the date. Nothing here is a ruling of his except what the REVIEWED line quotes.
--
-- WHY THE LIST GREW. The first list (Jetto, 2026-11-23, checked against prod's columns by name: token, secret, hash,
-- login, payer, address) found two household-private tables by their row policies. It missed the rest: the nightly dump
-- is taken as world2_owner on purpose so that it CARRIES the drafts (deploy/world2-backup.sh), and a restore applies no
-- row policy to the restoring superuser, so every row-policy-private table arrives whole. This list is built from every
-- table the office's migrations create (world2/schema/*.sql, 108 base tables on 2026-11-27, with migration 103; the views events,
-- event_rsvps, identities, docket and standing_marks hold no rows of their own). test/uat-kit.test.mjs reads the real
-- schema and fails if a table has no row here, so a new migration cannot add a private table that nothing classifies.
--
-- The rule: keep the public record (handles, households, acts, marks, letters, settlements) so UAT tests what
-- residents see; drop every credential, every household-private word, and anything that would let UAT reach a real
-- person or system. "Public" is what a migration's own header calls public (a table the notary exports, a copy of the
-- public town repo, a projection of public acts). A table is private if its header says so, if it sits behind a row
-- policy for one household, or if office_api alone holds it and no export reads it.
--
-- THE CLASSIFICATION (verdict: DELETE the rows, SCRUB a column, KEEP, or UNSURE = kept as is until Darko says;
-- status: `reviewed` is quoted on the REVIEWED line, `awaiting` is not yet his):
--
-- | table | verdict | status | why |
-- | acts | KEEP | - | the public record; the notary exports it |
-- | amend_carried | KEEP | - | which settlement carried an amend; derived from public files |
-- | arrival_entries | KEEP | - | queued enter-on-arrival intents from public walk acts; a trigger refuses every DELETE |
-- | arrival_heard | DELETE | awaiting | where a joining human heard of Postmark: about the human, private to operators (030), carries a free-text note |
-- | arrival_source_pending | DELETE | awaiting | a GitHub id parked with its outreach tag: an ops fact, never on the record (086) |
-- | arrival_sources | DELETE | awaiting | household to outreach tag: an ops fact, never on the record (086) |
-- | ashore | KEEP | - | which handle came ashore; append-only, the town repo shows it |
-- | berth_heard | DELETE | awaiting | a berth's parked where-did-you-hear answer: 030's rules, no pen reads it |
-- | claims | DELETE | awaiting | the DRAFT rows only (007: a draft is a household's private compose space); the public docket stays |
-- | crossing_receipts | KEEP | - | the crossing's public receipts |
-- | depictions | KEEP | - | media-door URLs of pictures made of a resident, append-only record |
-- | durable_event_memberships | KEEP | - | an ended event's window: already answered by the event's public page (103: "WHAT THIS STORES IS ALREADY PUBLIC") |
-- | durable_event_room_says | KEEP | - | the says an ended event's rooms held, by act number; words are not copied, they come from public acts (103) |
-- | durable_event_rooms | KEEP | - | an event's rooms as its public page gave them (103) |
-- | durable_room_says | KEEP | - | a closed room's says: speaker, instant, place and reply edge, all on the public conversations page; no words (103) |
-- | durable_rooms | KEEP | - | closed rooms as fixed public records: ids, bounds, participants (103; dungeon-wall says are filtered out before they are written) |
-- | earpiece_wakes | DELETE | awaiting | a resident's wake log: row policy for one household (026) |
-- | escrow_projection | KEEP | - | a projection of public stamps |
-- | gangway_acts | KEEP | - | the gangway's public acts |
-- | household_harnesses | SCRUB | reviewed | a resident's harness secret and address (item 3 below) |
-- | household_pins | KEEP | - | handle, login, GitHub id: the town's public github-ids.json |
-- | households | SCRUB | awaiting | `human` (a name 019 calls the human's own, 101 calls it the private name: unsure which, so it goes) and the `request` part of `likeness_state` (092: PRIVATE); every other column prints into the public households.json |
-- | invite_holds | DELETE | awaiting | the hands' judgment about a household, internal by its own header (087) |
-- | law_projection | KEEP | - | a projection of the public law |
-- | letter_notes | DELETE | reviewed | a household's marks on its letters (item 5; "empty both is fine yeah") |
-- | letter_opens | DELETE | awaiting | which letters a household has opened: row policy, not an act, never public (029) |
-- | mail_blocks | DELETE | awaiting | a household blocks a household: private to the two houses and the office (083) |
-- | mark_carried | KEEP | - | which settlement carried a mark; derived from public files |
-- | mark_versions | KEEP | - | the public marks' versions |
-- | marks | KEEP | - | the public record |
-- | oauth_berths | SCRUB | reviewed | the hash goes (item 2); the card (a parked declaration) is kept, see UNSURE below |
-- | oauth_clients | KEEP | - | dynamic registrations of PUBLIC clients (RFC 7591, oauth.mjs); no secret is stored |
-- | oauth_codes | DELETE | reviewed | item 1 |
-- | oauth_key_claims | DELETE | reviewed | item 1: ask_hash is a capability |
-- | oauth_pending | DELETE | reviewed | item 1 |
-- | oauth_tokens | DELETE | reviewed | item 1: every sign-in and household key |
-- | office_media | KEEP | - | the media quota ledger: byte accounting (household, sha, bytes), no content |
-- | office_meta | KEEP | - | the town log's drain cursor |
-- | office_role_audit | KEEP | - | who granted which role: GitHub logins the town already shows |
-- | office_roles | KEEP | - | the office's roles, by GitHub id and login |
-- | office_town_journal | UNSURE | - | the town's input log; its header says the rows are "not yet the record (a letter before it sails)" so the notary does not export it. Kept: secrets are not in it (gh ids and logins are public) and UAT's drain writes only to its stubs. Darko decides if a letter not yet sailed is private enough to drop |
-- | parcel_room_nonces | DELETE | awaiting | a purchase's retry key: office_api's alone, in no export (096) |
-- | position_snapshot_rows | KEEP | - | derived from public acts |
-- | position_snapshots | KEEP | - | derived from public acts |
-- | posts | KEEP | - | the public calendar and posts |
-- | projection_heads | KEEP | - | a projection cursor |
-- | refused_acts | DELETE | awaiting | the private log of an act a door refused, for 90 days (098) |
-- | register_versions | KEEP | - | the public register's versions |
-- | registry | KEEP | - | the store's own object registry |
-- | registry_meta | KEEP | - | the households file's metadata |
-- | reports | DELETE | awaiting | a resident's report of a resident: private to the filer and the town's hands (084) |
-- | resident_notes | DELETE | reviewed | item 5; "empty both is fine yeah" |
-- | responses | KEEP | - | RSVPs; the public acts already carry their kind and budget (026) |
-- | settlement_decisions | KEEP | - | the settlement's public decisions |
-- | settlement_publications | KEEP | - | the settlement's public printouts |
-- | settlements | KEEP | - | the public record |
-- | stamp_lines | KEEP | - | the stamp ledger's lines: the town repo's public ledger |
-- | stamp_projection | KEEP | - | a projection of public stamps |
-- | standing_acts | KEEP | - | the public acts that stand |
-- | town_bulletin | KEEP | - | a copy of the public town repo (town_* below are all this) |
-- | town_discovery_chunks | KEEP | - | the public letters, cut for search |
-- | town_funding_holo | KEEP | - | a copy of the public town repo |
-- | town_funding_invalid | KEEP | - | a copy of the public town repo |
-- | town_funding_keeping_mint | KEEP | - | a copy of the public town repo |
-- | town_funding_roll | KEEP | - | a copy of the public town repo |
-- | town_homes | KEEP | - | a copy of the public town repo |
-- | town_index_snapshots | KEEP | - | a copy of the public town repo |
-- | town_ledger | KEEP | - | a copy of the public town repo |
-- | town_letter_edges | KEEP | - | the public letters' reply graph |
-- | town_letters | KEEP | - | the town's letters: published, residents' data is public |
-- | town_mail_lines | KEEP | - | the mail ledger's lines, a copy of the public town repo |
-- | town_mail_state | KEEP | - | derived from the public mail ledger |
-- | town_meta | KEEP | - | a copy of the public town repo |
-- | town_pot_escrow | KEEP | - | a copy of the public town repo |
-- | town_pot_receipts | SCRUB | reviewed | the receipt and its amount stay; who paid goes (item 4) |
-- | town_pot_stakers | KEEP | - | a copy of the public town repo |
-- | town_pots | KEEP | - | a copy of the public town repo |
-- | town_quest_progress | KEEP | - | a copy of the public town repo |
-- | town_quest_standing | KEEP | - | a copy of the public town repo |
-- | town_regions | KEEP | - | a copy of the public town repo |
-- | town_repo_log | KEEP | - | a copy of the public town repo |
-- | town_residents | KEEP | - | the residents' public pages, GitHub logins the town already shows |
-- | town_roll | KEEP | - | the public roll |
-- | town_rooms | KEEP | - | every white-pages room and the login its address names |
-- | town_stamps | KEEP | - | a copy of the public town repo |
-- | town_threads | KEEP | - | a copy of the public town repo |
-- | windows | KEEP | - | the candle's public windows |
-- | world_graph_edges | KEEP | - | the world's public graph |
-- | world_graph_events | KEEP | - | the world's public graph |
-- | world_graph_geometry | KEEP | - | the world's public graph |
-- | world_graph_lints | KEEP | - | the world's public graph |
-- | world_graph_meta | KEEP | - | the world's public graph |
-- | world_graph_nodes | KEEP | - | the world's public graph |
-- | world_graphs | KEEP | - | the world's public graph |
-- | world_snapshot_folds | KEEP | - | the public notary's snapshots |
-- | world_snapshot_marks | KEEP | - | the public notary's snapshots |
-- | world_snapshot_register | KEEP | - | the public notary's snapshots |
-- | world_snapshots | KEEP | - | the public notary's snapshots |
--
-- UNSURE, for Darko (kept as they are until he says):
--   office_town_journal (row above); oauth_berths.card, the declaration a berth parks until its human co-signs (a founding
--   declaration is public once it lands, but a parked one is not yet); office_roles.note and office_role_audit.note
--   (an operator's free-text note on a role); household_pins.note and renamed (free prose in the public github-ids.json).
--
-- Kept on purpose, as the public record: household_pins.login, identities.gh_login, office_roles.login,
-- office_role_audit.login, office_town_journal.gh_login, town_residents.github_address (GitHub logins
-- the town already shows), oauth_berths.cosigned_gh_login.
--
-- Runs in one transaction against the freshly restored copy, never against a live store. It runs as the postgres
-- superuser, which no row policy binds, so the readback below counts every row, not the rows a policy would show.

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

-- 6. Everything else a household keeps to itself or the office keeps from the record (Truey's finding 1 on
--    #1206). Each statement carries its own AWAITING line: none of these is Darko's ruling yet.
-- AWAITING: arrival_source_pending (a GitHub id parked with an outreach tag)
DELETE FROM arrival_source_pending;
-- AWAITING: arrival_sources (household to outreach tag)
DELETE FROM arrival_sources;
-- AWAITING: arrival_heard (where a joining human heard of Postmark, with a free-text note)
DELETE FROM arrival_heard;
-- AWAITING: berth_heard (a berth's parked answer to the same question)
DELETE FROM berth_heard;
-- AWAITING: claims, draft rows only (007: a draft is private to its household until staked; the docket stays whole)
DELETE FROM claims WHERE status = 'draft';
-- AWAITING: reports (a resident's report, private to the filer and the town's hands)
DELETE FROM reports;
-- AWAITING: mail_blocks (a household blocks a household, private to the two houses)
DELETE FROM mail_blocks;
-- AWAITING: invite_holds (the hands' judgment about a household)
DELETE FROM invite_holds;
-- AWAITING: letter_opens (which letters a household has opened)
DELETE FROM letter_opens;
-- AWAITING: earpiece_wakes (a resident's wake log)
DELETE FROM earpiece_wakes;
-- AWAITING: refused_acts (the private log of refused acts)
DELETE FROM refused_acts;
-- AWAITING: parcel_room_nonces (a room purchase's retry key)
DELETE FROM parcel_room_nonces;
-- AWAITING: households.human (the human's name: 019 says public file, 101 says private) and households.likeness_state's
-- `request` (092: PRIVATE). The official pointer and history in likeness_state stay (the public registry projects them).
UPDATE households SET human = NULL, likeness_state = NULLIF(likeness_state - 'request', '{}'::jsonb) WHERE human IS NOT NULL OR likeness_state ? 'request';

-- THE READBACK the script reads. One line per label, `<label> <count>`, and store-restore-scrub.sh's check
-- (lib.sh § uat_check_readback) demands EVERY label below, exactly once:
--   zero_*     must be 0: what the scrub was to remove, counted after;
--   present_*  must be above 0: the restored copy still holds the public record. A readback of zeros proves nothing
--              if the tables were empty to begin with (a dump restored into the wrong database, a failed restore),
--              so these show the counts are counts of something.
-- A label missing from the output, a line printed twice, or no output at all fails. Adding a deleted table adds its
-- zero_ label here; the test reads the labels off this file, so the script and the file cannot disagree.
SELECT 'zero_oauth_tokens' AS t, count(*) FROM oauth_tokens
UNION ALL SELECT 'zero_oauth_codes', count(*) FROM oauth_codes
UNION ALL SELECT 'zero_oauth_pending', count(*) FROM oauth_pending
UNION ALL SELECT 'zero_oauth_key_claims', count(*) FROM oauth_key_claims
UNION ALL SELECT 'zero_berths_with_a_real_hash', count(*) FROM oauth_berths WHERE token_hash NOT LIKE 'uat-scrubbed:%'
UNION ALL SELECT 'zero_harness_secrets_or_live_addresses', count(*) FROM household_harnesses WHERE secret IS DISTINCT FROM (CASE WHEN kind = 'webhook' THEN 'uat-scrubbed' END) OR address NOT LIKE 'https://harness.invalid/uat-scrubbed/%'
UNION ALL SELECT 'zero_payers', count(*) FROM town_pot_receipts WHERE payer IS DISTINCT FROM 'uat-scrubbed'
UNION ALL SELECT 'zero_resident_notes', count(*) FROM resident_notes
UNION ALL SELECT 'zero_letter_notes', count(*) FROM letter_notes
UNION ALL SELECT 'zero_arrival_source_pending', count(*) FROM arrival_source_pending
UNION ALL SELECT 'zero_arrival_sources', count(*) FROM arrival_sources
UNION ALL SELECT 'zero_arrival_heard', count(*) FROM arrival_heard
UNION ALL SELECT 'zero_berth_heard', count(*) FROM berth_heard
UNION ALL SELECT 'zero_claims_drafts', count(*) FROM claims WHERE status = 'draft'
UNION ALL SELECT 'zero_reports', count(*) FROM reports
UNION ALL SELECT 'zero_mail_blocks', count(*) FROM mail_blocks
UNION ALL SELECT 'zero_invite_holds', count(*) FROM invite_holds
UNION ALL SELECT 'zero_letter_opens', count(*) FROM letter_opens
UNION ALL SELECT 'zero_earpiece_wakes', count(*) FROM earpiece_wakes
UNION ALL SELECT 'zero_refused_acts', count(*) FROM refused_acts
UNION ALL SELECT 'zero_parcel_room_nonces', count(*) FROM parcel_room_nonces
UNION ALL SELECT 'zero_households_human', count(*) FROM households WHERE human IS NOT NULL
UNION ALL SELECT 'zero_households_likeness_request', count(*) FROM households WHERE likeness_state ? 'request'
UNION ALL SELECT 'present_acts', count(*) FROM acts
UNION ALL SELECT 'present_marks', count(*) FROM marks
UNION ALL SELECT 'present_households', count(*) FROM households
UNION ALL SELECT 'present_claims_not_draft', count(*) FROM claims WHERE status <> 'draft';

COMMIT;
