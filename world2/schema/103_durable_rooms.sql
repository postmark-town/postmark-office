-- 103 — durable rooms: fixed room records, each event's own window membership (POS-1203, CORE-170)
--
-- RULED (Darko, 2026-11-23 18:35 EST): "sparks, galleries, conversations, they should all be durable". At 19:40 EST: "from an Office standpoint,
-- this sitting is pretty much sound the way that it's recommended" (CORE-170/a, all six calls as Rivet's packet recommended them):
--   1. a closed room is a FIXED RECORD in the office's store (its id and aliases, its says, their reply links, its bounds, the inputs it was
--      reconstructed from), looked up and never recomputed;
--   2. a room is fixed only when it TRULY closes: a settlement has passed with no say in the hour after it (hearing-window.mjs § roomOpen, the
--      one rule). A carried or open room keeps its identity and is not stored;
--   3. an event keeps the rooms and says of ITS OWN WINDOW, fixed when it ends: later talk in a room that carried on is never the event's
--      attendance, and nothing about its sparks or its stake changes it;
--   4. a backfill back to the first say (world2/tools/replay-rooms.mjs): the store's says and the World's published settlements, written
--      once, in the same pass twice with the same result;
--   5. no stopgap on the 60-settlement window; live hearing keeps its current-window rule (hearing-window.mjs, unchanged).
--
-- WHAT THIS STORES IS ALREADY PUBLIC. Every row is a fact the conversations page and an event's page already answer from the record (a say's
-- speaker, instant and place; a room's bounds and participants). Nothing is added to what a reader may see, and a say spoken inside a
-- dungeon's walls is never written here (the producer filters it before anything is grouped, as the page does). No permission, money or
-- stake rule changes, and a reader without these tables answers as it did: the door works once code and migration are both in.
--
-- ── THE SHAPE ───────────────────────────────────────────────────────────────
--
--   durable_rooms            one row per CLOSED room: id (the id it was first issued under), aliases (every other id that opens it:
--                            the names its says recorded, the same handle in the same second), keys (those ids' second-granularity
--                            keys, for the page's own "same handle, same second" lookup), first/latest/closed instants, bounds (the
--                            thread's rounded-metre extent), counts, participants, the start place, the frame flag (below), and the
--                            reconstruction inputs it was fixed from.
--   durable_room_says        one row per say of a closed room, by act number: instant, speaker, place, the say's own id and its one
--                            reply edge. `act_id` is the primary key, so a say is in exactly one room. WORDS ARE NOT COPIED: a read takes
--                            them from `acts`, which never changes.
--   durable_event_memberships  one row per ENDED event whose rooms were told: its window, and how many says it could not place. A row
--                            with no rooms is KNOWN NONE; the absence of a row is UNKNOWN, as it ever was.
--   durable_event_rooms      each of the event's rooms, in the order they began: the room's id, its thread header as the event's page
--                            gives it and its frozen frame, both as they were when the event ended (up to the window's end).
--   durable_event_room_says  the says those rooms held up to the window's end, by act number, and whether each fell INSIDE the window.
--
-- ── INSERT ONLY ─────────────────────────────────────────────────────────────
--
-- `office_api` holds SELECT and INSERT and nothing else: a fixed record is never edited or removed by any role the office holds. The
-- producer inserts with ON CONFLICT DO NOTHING, so a second pass writes nothing new and never moves an id. (A pass that finds a stored
-- room differing from what the rules now derive REPORTS it and leaves it: the stored record is the identity.)
--
-- ── THE FRAME FLAG ──────────────────────────────────────────────────────────
--
-- `frame_flag` is set by the producer on a room whose bounds span more than `SUSPECT_SPAN_M` (src/durable-rooms.mjs), as a REPORT for a
-- judgment and not a repair: the bounds are stored exactly as they were derived. (The costume awards' room, `t1793353930000-seraphina`,
-- spans about 95 km by 99 km, joining voices at Pando with voices in town; its judgment is the lead's, CORE-155.)
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, the runbook's step-1 idiom ──────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/103_durable_rooms.sql
--
-- NUMBERING: this file is 103 because office #1181 (open at this writing) holds 102 (102_media_deleted_by_household.sql); order between the two does not matter, they touch no common object.
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT, on Darko's go (SHIPPING § 1: a store migration); nothing in the code lane applies it. Apply it
-- BEFORE the deployed code that writes these tables (deploy/DEPLOY.md § durable rooms). Until it lands every read answers as before: the readers ask
-- `to_regclass` first and fall back to the derivation, and the writers refuse by name rather than write half a record.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('durable_rooms'), to_regclass('durable_room_says'), to_regclass('durable_event_memberships'),
--          to_regclass('durable_event_rooms'), to_regclass('durable_event_room_says');   -- five names, none null
--   SELECT count(*) FROM durable_rooms;                                                   -- 0 until the first pass
--   node world2/tools/migrations-landed.mjs                                               -- 103 landed
--
-- ── ROLLBACK ────────────────────────────────────────────────────────────────
--
--   DROP TABLE durable_event_room_says, durable_event_rooms, durable_event_memberships, durable_room_says, durable_rooms;
--   DELETE FROM registry WHERE object LIKE 'durable\_%';
--
-- Nothing else reads these tables before the code that uses them lands, and the code reads around their absence. No other role holds a grant
-- (the notary's snapshot_reader reads none of them; an export of them is its own later ruling, not this migration's).

BEGIN;

CREATE TABLE IF NOT EXISTS durable_rooms (
  id            text PRIMARY KEY CHECK (id ~ '^t[0-9]+-.+$'),
  aliases       text[]      NOT NULL DEFAULT '{}',
  keys          text[]      NOT NULL,
  first_at      timestamptz NOT NULL,
  latest_at     timestamptz NOT NULL,
  closed_at     timestamptz NOT NULL,
  x0            integer     NOT NULL,
  y0            integer     NOT NULL,
  x1            integer     NOT NULL,
  y1            integer     NOT NULL,
  span_m        integer     NOT NULL,
  voice_count   integer     NOT NULL CHECK (voice_count > 0),
  participants  text[]      NOT NULL,
  place         text,
  place_mark    text,
  last_x        integer     NOT NULL,
  last_y        integer     NOT NULL,
  aboard        boolean     NOT NULL DEFAULT false,
  era           text        NOT NULL CHECK (era IN ('live', 'crystallized', 'mixed')),
  has_replies   boolean     NOT NULL DEFAULT false,
  inputs        jsonb       NOT NULL,
  frame_flag    text,
  source        text        NOT NULL CHECK (source IN ('live', 'replay')),
  recorded_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (latest_at >= first_at AND closed_at >= latest_at)
);
CREATE INDEX IF NOT EXISTS durable_rooms_keys   ON durable_rooms USING gin (keys);
CREATE INDEX IF NOT EXISTS durable_rooms_latest ON durable_rooms (latest_at, id);

CREATE TABLE IF NOT EXISTS durable_room_says (
  act_id     bigint PRIMARY KEY,
  room_id    text        NOT NULL REFERENCES durable_rooms (id),
  ord        integer     NOT NULL,
  at         timestamptz NOT NULL,
  handle     text        NOT NULL,
  x          double precision NOT NULL,
  y          double precision NOT NULL,
  place      text,
  aboard     boolean     NOT NULL DEFAULT false,
  say_id     bigint,
  reply_to   bigint,
  era        text        NOT NULL CHECK (era IN ('live', 'crystallized')),
  root       text,
  place_mark text,
  UNIQUE (room_id, ord)
);
CREATE INDEX IF NOT EXISTS durable_room_says_say ON durable_room_says (say_id) WHERE say_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS durable_room_says_at  ON durable_room_says (at);   -- an ongoing event's read: the fixed rooms with a say in its window

CREATE TABLE IF NOT EXISTS durable_event_memberships (
  event_id      text PRIMARY KEY,
  window_from   timestamptz NOT NULL,
  window_to     timestamptz NOT NULL,
  history       text        NOT NULL CHECK (history = 'complete'),
  rooms_count   integer     NOT NULL CHECK (rooms_count >= 0),
  unplaced_says integer     NOT NULL DEFAULT 0,
  basis         text        NOT NULL,
  source        text        NOT NULL CHECK (source IN ('live', 'replay')),
  frozen_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (window_to >= window_from)
);

CREATE TABLE IF NOT EXISTS durable_event_rooms (
  event_id text    NOT NULL REFERENCES durable_event_memberships (event_id),
  ord      integer NOT NULL,
  room_id  text    NOT NULL,
  header   jsonb   NOT NULL,
  frame    jsonb   NOT NULL,
  PRIMARY KEY (event_id, room_id),
  UNIQUE (event_id, ord)
);

-- the flag an event's frozen room carries (POS-1203): added by ALTER, so a store that applied an earlier 103 gets it on re-apply; the CURRENT 103 is this file
ALTER TABLE durable_event_rooms ADD COLUMN IF NOT EXISTS frame_flag text;

CREATE TABLE IF NOT EXISTS durable_event_room_says (
  event_id  text   NOT NULL REFERENCES durable_event_memberships (event_id),
  room_id   text   NOT NULL,
  act_id    bigint NOT NULL,
  in_window boolean NOT NULL,
  PRIMARY KEY (event_id, act_id)
);
CREATE INDEX IF NOT EXISTS durable_event_room_says_room ON durable_event_room_says (event_id, room_id);

GRANT SELECT, INSERT ON durable_rooms, durable_room_says, durable_event_memberships, durable_event_rooms, durable_event_room_says TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('durable_rooms', 'derived', 'office_api', '{}',
   'Darko 2026-11-23 (CORE-170/a, POS-1203: "sparks, galleries, conversations, they should all be durable"): a closed conversation fixed as a record when it truly closes (a settlement passed with no say in the hour after); its id and aliases are the identity; insert only'),
  ('durable_room_says', 'derived', 'office_api', '{}',
   'CORE-170/a (POS-1203): the says of a fixed room by act number, each in exactly one room; the words stay in acts'),
  ('durable_event_memberships', 'derived', 'office_api', '{}',
   'CORE-170/a (POS-1203): an ended event whose rooms were told, fixed to its own window; no row is unknown, a row with no rooms is known none'),
  ('durable_event_rooms', 'derived', 'office_api', '{}',
   'CORE-170/a (POS-1203): the rooms an event had inside its own window, with the thread header and frame they had when it ended'),
  ('durable_event_room_says', 'derived', 'office_api', '{}',
   'CORE-170/a (POS-1203): the says of those rooms up to the window''s end, and whether each fell inside it; later talk in a carried room is never the event''s')
ON CONFLICT (object) DO NOTHING;

COMMIT;
