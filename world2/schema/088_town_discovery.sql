-- 088 — discovery's two derived tables: literal public text, and who writes to whom (POS-497)
--
-- RULED (Darko, 2026-11-03 09:22 EDT, POS-497/a): "Literal search + common
-- correspondents". SETTLED (Wright, 2026-11-03, POS-497/b): bounded pages: a
-- page that cannot finish within its work bound says it is incomplete and hands
-- a continuation tied to the source generation; it never guesses a total and
-- never falls back to an unbounded scan.
--
-- Both tables are DERIVED from rows 033 already holds, by the one derivation
-- (src/town-index.mjs, src/town-discovery.mjs § discoveryRowsOf), and written by
-- the town-index ingest in the same transaction as the rows they come from:
--
-- ── town_discovery_chunks: the public text, in bounded pieces ───────────────
--
-- Sources: a committed letter's body (town_letters, decoded from its json) and a
-- home's title and description (town_homes). Nothing else: no resident card, no
-- profile, no mailbox state, no private disposition. Each text is cut into base
-- pieces of at most 1024 UTF-8 bytes on codepoint boundaries, and each stored
-- piece carries the base plus up to 255 bytes of what follows (whole codepoints),
-- so any literal of at most 256 bytes that starts in a base lies wholly inside
-- its piece: no character is dropped and no query is cut at a seam. A stored
-- piece is at most 1279 bytes. A NUL ends a run (no query can hold one).
-- `author` is the letter's sender or the home's resident, only when it is a
-- handle the door could admit (src/residency.mjs § isResidentHandle); a source
-- id longer than 1024 bytes is not indexed. The ingest counts both, by reason.
--
-- ── town_letter_edges: one row per letter, sender and recipient ─────────────
--
-- Every committed letter in every box (no delivered_at rule, no inbox rule),
-- its recipients the town's own `recipientsOf` (toList when present, else to),
-- each pair once per letter. Synthetic stored ids (`unidentified-N`) are kept.
--
-- ── THE GENERATION (town_meta) ──────────────────────────────────────────────
--
-- `discovery_epoch` names the derivation's rule; a rule change is a new epoch,
-- and the next ingest replaces both tables whole. `discovery_revision` is the
-- XOR of every row digest in both tables and one digest per resident key
-- (town_residents.handle): it moves in the same transaction as any derived row or
-- any resident joining or leaving, and it equals the whole derivation's, so the
-- town-index equality falsifiers hold it like any other row. A discovery cursor
-- carries both, and a moved generation is an explicit reset.
--
-- ── KEYS AND ORDER ──────────────────────────────────────────────────────────
--
-- A chunk's id is `<kind>:<ordinal>:<source id>` and an edge's is
-- `<sender>:<recipient>:<letter id>`: kind, ordinal and handles hold no ':', so
-- each splits one way. Reads walk the keyset in COLLATE "C" (bytewise), the
-- order every town_* reader already uses.
--
-- ── THE PEN ──────────────────────────────────────────────────────────────────
--
-- `law_ingester`, INSERT and DELETE and no UPDATE, like every projection here.
-- `office_api` reads (the discover door). 003's lawful list has the rows.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner` by the runbook's step-1 idiom ────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/088_town_discovery.sql
--
-- ORDER: code first is safe. Until 088 lands the ingest skips both tables and
-- both meta keys and says so in its log, and the discover door answers that
-- discovery is not installed. The first ingest after 088 lands finds no
-- `discovery_epoch` and fills both tables whole from the stored letters and
-- homes, in its own transaction.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('town_discovery_chunks'), to_regclass('town_letter_edges');   -- both named
--   SELECT key, value FROM town_meta WHERE key LIKE 'discovery\_%';                  -- both, after the next ingest
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
-- Code: revert the office; these tables are then read by nothing. Schema, as
-- `world2_owner`, in one transaction: DROP TABLE town_discovery_chunks,
-- town_letter_edges; DELETE FROM registry WHERE object IN (the two). The next
-- ingest drops the two meta keys itself (its meta rows no longer name them).
--
-- CONSUMERS, named: world2/tools/town-index-ingest.mjs (the writer),
-- src/town-index-store.mjs § discover (the reader).

BEGIN;

CREATE TABLE IF NOT EXISTS town_discovery_chunks (
  id          text PRIMARY KEY,
  author      text NOT NULL CHECK (octet_length(author) <= 40),
  source_kind text NOT NULL CHECK (source_kind IN ('home', 'letter')),
  source_id   text NOT NULL CHECK (octet_length(source_id) <= 1024),
  ordinal     integer NOT NULL CHECK (ordinal >= 0),
  piece       text NOT NULL CHECK (octet_length(piece) <= 1284),
  digest      text NOT NULL,
  UNIQUE (source_kind, source_id, ordinal)
);
CREATE INDEX IF NOT EXISTS town_discovery_chunks_walk ON town_discovery_chunks
  (author COLLATE "C", source_kind COLLATE "C", source_id COLLATE "C", ordinal);

CREATE TABLE IF NOT EXISTS town_letter_edges (
  id        text PRIMARY KEY,
  letter_id text NOT NULL CHECK (octet_length(letter_id) <= 1024),
  sender    text NOT NULL CHECK (octet_length(sender) <= 40),
  recipient text NOT NULL CHECK (octet_length(recipient) <= 40),
  digest    text NOT NULL,
  UNIQUE (letter_id, sender, recipient)
);
CREATE INDEX IF NOT EXISTS town_letter_edges_walk ON town_letter_edges
  (sender COLLATE "C", recipient COLLATE "C", letter_id COLLATE "C");

GRANT SELECT ON town_discovery_chunks, town_letter_edges TO office_api, law_ingester;
GRANT INSERT, DELETE ON town_discovery_chunks, town_letter_edges TO law_ingester;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('town_discovery_chunks', 'projection', 'law_ingester', '{office_api}',
   'Darko 2026-11-03 (POS-497/a: "Literal search + common correspondents"): committed letter bodies and home titles and descriptions, cut into bounded pieces for a bounded literal walk; derived from town_letters and town_homes by the one derivation'),
  ('town_letter_edges', 'projection', 'law_ingester', '{office_api}',
   'Darko 2026-11-03 (POS-497/a): one row per committed letter, sender and recipient, for the bounded common-correspondents walk; derived from town_letters by the one derivation')
ON CONFLICT (object) DO NOTHING;

COMMIT;
