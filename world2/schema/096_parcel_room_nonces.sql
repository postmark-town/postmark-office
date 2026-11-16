
-- 096 — parcel_room_nonces: A ROOM PURCHASE'S RETRY KEY (POS-939, w47)
--
-- RULED. Wright 2026-11-13 15:2x EST, on Darko's ruling: "buy-parcel-room joins
-- the office's act nonce, so a retry after a lost answer can't buy a second
-- room." The promise it keeps is POS-762's: "a retry after a lost answer reads
-- as a second purchase, and only a caller field (`room: 2`, or a nonce) can tell
-- them apart".
--
-- ── WHY A TABLE OF ITS OWN, AND NOT `acts.nonce` ────────────────────────────
--
-- The world acts keep their key on the act's first `acts` row (027, 052). A room
-- purchase writes no act: it is one signed BURN line on the town's stamp ledger,
-- written by the town's own pen under the town lock (src/parcel-room-exec.mjs).
-- A fake world act to hold the key would be a public row about a private
-- string. So the key is kept here, office_api's alone, in no export.
--
-- ── THE KEY IS KEPT BEFORE ANY STAMP BURNS ─────────────────────────────────
--
-- The door (src/parcel-room.mjs § THE RETRY KEY) INSERTs the row and commits it
-- BEFORE it runs the exec, so there is no moment when a burn has landed and its
-- key has not. The row names the purchase the nonce is: the house, the room it
-- buys (`nth`, the parcel the room is for) and the resident who pays. It never
-- says "bought": the receipt is read off the ledger, under the lock, as the
-- line `<handle> → BURN · <price> · for: parcel:<nth>/hh:<household>`. A key
-- whose line is not on the ledger is a purchase not yet made, and a retry makes
-- it, once; a key whose room another resident bought answers a refusal.
--
--   household  the paying house's slug when the key was kept
--   nonce      the caller's key, spelled `buy-parcel-room:<nonce>`, as a world
--              act's is spelled `<door action>:<nonce>` (act-nonce.mjs § keptNonce)
--   handle     the resident whose purchase this key names: the payer
--   nth        the parcel the room is for (2 or 3), the room the call saw
--
-- One key per house and nonce (the primary key), so two calls that race past
-- the door's lookup keep one row, and the second reads the first's.
--
-- PRIVATE: `office_api` only, SELECT and INSERT. No UPDATE or DELETE: a key
-- names one purchase for good, so a retry can never be pointed at another room.
-- No grant to `snapshot_reader` or any other role, so no export reads it.
--
-- ── IDEMPOTENT. APPLY AS `world2_owner`, 019's idiom ────────────────────────
--
--   sudo -n -u postgres psql -v ON_ERROR_STOP=1 -d world2_dev \
--     -c "SET ROLE world2_owner;" -f world2/schema/096_parcel_room_nonces.sql
--
-- THE PRODUCTION MIGRATION IS THE OPERATOR'S BOX ACT; nothing in the code lane
-- applies it. Until it lands, a purchase that carries a nonce refuses 503 by
-- name and burns nothing (a key it cannot keep would let a retry buy twice);
-- a purchase without one is unchanged.
--
-- ── HOW TO PROVE IT LANDED ──────────────────────────────────────────────────
--
--   SELECT to_regclass('public.parcel_room_nonces') IS NOT NULL;                    -- t
--   SELECT has_table_privilege('office_api', 'parcel_room_nonces', 'INSERT');       -- t
--   SELECT has_table_privilege('office_api', 'parcel_room_nonces', 'UPDATE');       -- f
--   SELECT has_table_privilege('snapshot_reader', 'parcel_room_nonces', 'SELECT');  -- f
--
-- CONSUMERS, named: src/parcel-room.mjs (keep, read), test/parcel-room-nonce.test.mjs.

BEGIN;

CREATE TABLE IF NOT EXISTS parcel_room_nonces (
  household text NOT NULL CHECK (household ~ '^[a-z0-9][a-z0-9-]*$'),
  nonce     text NOT NULL,
  handle    text NOT NULL,
  nth       integer NOT NULL CHECK (nth IN (2, 3)),
  kept_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (household, nonce)
);

GRANT SELECT, INSERT ON parcel_room_nonces TO office_api;

INSERT INTO registry (object, kind, owner_pen, consumers, ruling) VALUES
  ('parcel_room_nonces', 'source', 'office_api', '{}',
   'Wright 2026-11-13 15:2x EST on Darko''s ruling (POS-939): buy-parcel-room joins the office''s act nonce, so a retry after a lost answer can''t buy a second room; the key is kept before any stamp burns and names one purchase for good; office_api only, in no export')
ON CONFLICT (object) DO NOTHING;

COMMIT;
