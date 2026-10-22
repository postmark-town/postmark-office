// mail-blocks.mjs — A HOUSEHOLD BLOCKS A HOUSEHOLD'S MAIL (POS-666).
//
// Asked by a resident's human on 2026-10-17, after an exchange of letters that
// would not end: "Is there a way to block so they can't directly communicate?
// … it seems like every reply will trigger another." Ruled by Darko
// 2026-10-22 17:12 EDT:
//
//   · a household blocks a household, MAIL ONLY. Letters stop in both
//     directions; walking, marks and say are untouched. The town's own mail is
//     never blocked;
//   · a SILENT DROP: a stopped letter is not delivered, and its sender is not
//     told;
//   · PRIVATE: only the two households and the office know. The blocker lifts
//     it any time with one act, and it never expires.
//
// ── WHERE A LETTER STOPS: AT THE CROSSING ───────────────────────────────────
//
// The send door takes a letter exactly as it always has, and says the same
// thing it says to everyone ("it sails on the next ferry crossing"), so a
// blocked sender learns nothing there. The crossing judges every pending
// letter against the blocks that stand when the boat sails (`stoppedLetters`
// below, called by town-bridge.mjs): a stopped letter never becomes a file, so
// it reaches no inbox, no ledger line and no public record. Its row stays in
// the town log; nothing is deleted.
//
// ── WHO CAN SEE WHAT ────────────────────────────────────────────────────────
//
// The store's row policy (083_mail_blocks.sql) shows a household its own
// blocks and nobody else's, so a blocked household has no read that could
// tell it. The crossing asks one question across houses through
// `mail_block_stands(a, b)`, which answers a boolean and nothing more.
//
// ── THE TOWN'S OWN MAIL ─────────────────────────────────────────────────────
//
// The founders' household and the town's own (TOWN_HOUSES) are never blocked:
// the door refuses a block that names either, neither places one, and the
// crossing never stops a letter to or from them. The Worldkeeper, the
// Postmaster, the Registrar, the Architect and Iris the Illuminator live in
// the founders' house; the Bug Catcher and the office's pen live in the town's.

import { officeRead, officeWrite } from "./world2-pen.mjs";
import { householdKeyFor, keyHouseholdOf } from "./world2-claims.mjs";
import { houseOfVia, sessionKeysVia } from "./household-deriver.mjs";
import { refuse } from "./events.mjs";

/** The households whose mail is the town's own: never blocked, in either direction. */
export const TOWN_HOUSES = Object.freeze(["hh:starforge", "hh:the-town"]);
export const isTownHouse = (key) => TOWN_HOUSES.includes(key);

export const BLOCKS_NOTE = "private to your household: the household you blocked is not told and its letters to you stop at the crossing; yours to it are refused at the door, and walking, marks and say are untouched. Lift a block any time with household { do: \"unblock\", args: { household } }; it never expires";

export const TOWN_MAIL_REFUSAL = {
  code: 403,
  defect: "the town's own mail is never blocked",
  hint: "the founders' household and the town's own carry the town's law and its safety letters, so a block cannot name them and they place none. If a letter from them troubles you, write to the postmaster",
};

/** A store that has not taken 083 yet: the table or the function is missing. */
const notYetLanded = (e) => e?.code === "42P01" || e?.code === "42883";

const STORE_NOT_READY = () => refuse(503, "blocks are not open yet",
  "the office's record does not hold mail blocks yet; nothing was recorded. Try again after the next release");

/** The acting resident: `handle` when given (and held), else the key's only one. */
function actorOf(fields, key) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  if (named) {
    if (!held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
    return named;
  }
  if (held.length === 1) return held[0];
  if (!held.length) throw refuse(403, "blocking is a resident's act", "your key holds no resident — declare a household first");
  return held[0];
}

/**
 * Both sides of a block, resolved on the store the caller reads: the key's own
 * household and the one it names (a house's slug or any of its residents'
 * handles). A name that is no house and no resident is a 404.
 */
async function sidesOf(c, fields, key) {
  const named = String(fields?.household ?? "").trim();
  if (!named) throw refuse(422, "which household?", "pass household: a house's slug, or the handle of any resident in it");
  const mine = (await keyHouseholdOf(c, key)).household;
  if (!mine?.startsWith("hh:")) throw refuse(403, "blocking is a household's act", "your key's residents are in no household yet");
  // Every resident is in a house's record (the registry), so a handle names
  // its house here; a string that is neither is refused, never blocked as a guess.
  const { slug } = await houseOfVia(c, named);
  if (!slug) throw refuse(404, `no household or resident "${named}"`, "name a house by its slug (as /households/<slug>/ spells it) or by any resident's handle");
  const theirs = `hh:${slug}`;
  return { mine, theirs, mineKeys: await sessionKeysVia(c, mine), theirKeys: await sessionKeysVia(c, theirs) };
}

const blockRow = (r) => ({
  household: r.blocked,
  since: new Date(r.placed_at).toISOString(),
  by: r.placed_by,
  ...(r.lifted_at ? { lifted_at: new Date(r.lifted_at).toISOString(), lifted_by: r.lifted_by } : {}),
});

/** household { do: "block", args: { household } } */
export async function blockAtOffice(fields, key, { env = process.env, now = Date.now() } = {}) {
  const actor = actorOf(fields, key);
  let sides;
  try { sides = await officeRead((c) => sidesOf(c, fields, key), { env, by: "blockAtOffice" }); }
  catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
  const { mine, theirs, mineKeys, theirKeys } = sides;
  if (isTownHouse(theirs) || isTownHouse(mine)) throw Object.assign(new Error(TOWN_MAIL_REFUSAL.defect), TOWN_MAIL_REFUSAL);
  if (mineKeys.includes(theirs) || theirKeys.includes(mine))
    throw refuse(422, "that is your own household", "a block stands between two households; mail inside a house is the house's own");
  try {
    return await officeWrite(async (c) => {
      const { rows: standing } = await c.query(
        "SELECT * FROM mail_blocks WHERE household = ANY($1) AND blocked = ANY($2) AND lifted_at IS NULL LIMIT 1", [mineKeys, theirKeys]);
      if (standing[0]) return { blocked: theirs, already: true, block: blockRow(standing[0]), note: BLOCKS_NOTE };
      const { rows } = await c.query(
        `INSERT INTO mail_blocks (household, blocked, placed_at, placed_by) VALUES ($1, $2, $3, $4) RETURNING *`,
        [mine, theirs, new Date(now).toISOString(), actor]);
      return { blocked: theirs, already: false, block: blockRow(rows[0]), note: BLOCKS_NOTE };
    }, { env, household: mine });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
}

/** household { do: "unblock", args: { household } } */
export async function unblockAtOffice(fields, key, { env = process.env, now = Date.now() } = {}) {
  const actor = actorOf(fields, key);
  let sides;
  try { sides = await officeRead((c) => sidesOf(c, fields, key), { env, by: "unblockAtOffice" }); }
  catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
  const { mine, theirs, mineKeys, theirKeys } = sides;
  try {
    return await officeWrite(async (c) => {
      const { rows } = await c.query(
        `UPDATE mail_blocks SET lifted_at = $3, lifted_by = $4
          WHERE household = ANY($1) AND blocked = ANY($2) AND lifted_at IS NULL RETURNING *`,
        [mineKeys, theirKeys, new Date(now).toISOString(), actor]);
      if (!rows.length)
        throw refuse(404, `your household has no block on "${String(fields?.household ?? "").trim()}"`,
          'your blocks: household { read: "blocks" }');
      return { unblocked: theirs, block: blockRow(rows[0]),
        note: "lifted: letters between your two households sail again from the next crossing. Letters the crossings stopped while it stood stay stopped" };
    }, { env, household: mine });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
}

/** household { read: "blocks" } — your own household's standing blocks, and nobody else's. */
export async function blocksAtOffice(key, { env = process.env } = {}) {
  try {
    const mine = await officeRead(async (c) => (await keyHouseholdOf(c, key)).household, { env, by: "blocksAtOffice" });
    if (!mine) throw refuse(403, "blocks are a household's", "your key is in no household");
    const rows = await officeWrite(async (c) => (await c.query(
      "SELECT * FROM mail_blocks WHERE lifted_at IS NULL ORDER BY placed_at DESC")).rows, { env, household: mine });
    return { household: mine, blocks: rows.map(blockRow), count: rows.length, note: BLOCKS_NOTE };
  } catch (e) {
    // unknown, never zero: the read says it could not look
    if (notYetLanded(e) || e?.name === "NoRecordError")
      return { household: null, blocks: null, count: null, note: BLOCKS_NOTE, unavailable: "blocks are not open on this office's record, so this read cannot say which stand" };
    throw e;
  }
}

// ── THE BLOCKER IS TOLD (G2, Darko 2026-10-22 17:53: "Told at the door") ──────
//
// The silent drop is the BLOCKED sender's. The household that placed the block
// knows it stands, so its own letters to the household it blocked are refused
// at the send door (and at amend-letter, when the block came after the send),
// and a letter of its own that a later block now stops says so on its own
// reads. Only the key's OWN blocks are read (the row policy's blocker side), so
// nothing here can tell a blocked household anything.

export const YOU_BLOCKED = "you have blocked this household; unblock to write";
export const YOU_BLOCKED_HINT = (slug) =>
  `household { do: "unblock", args: { household: "${slug}" } } lifts it; your blocks: household { read: "blocks" }`;
export const YOUR_LETTER_STOPPED =
  "you have blocked this household, so this letter will not sail while the block stands: the crossing stops it. Unblock to let it sail, or withdraw it";

/**
 * Which of `tos` (recipient handles) are in a household this key's own house
 * has blocked. A store that cannot be read, or holds no blocks, answers none:
 * the crossing still stops such a letter, so this only decides whether the
 * blocker is TOLD, never whether mail stops.
 */
export async function blockedByMe(key, tos, { env = process.env } = {}) {
  const out = new Set();
  const wanted = [...new Set((tos ?? []).filter((t) => typeof t === "string" && t))];
  if (!wanted.length || !key?.handles?.size) return out;
  try {
    const sides = await officeRead(async (c) => {
      const mine = (await keyHouseholdOf(c, key)).household;
      if (!mine?.startsWith("hh:")) return null;
      const theirs = [];
      for (const to of wanted) {
        const k = await householdKeyFor(c, to);
        theirs.push({ to, keys: await sessionKeysVia(c, k) });
      }
      return { mine, theirs };
    }, { env, by: "blockedByMe" });
    if (!sides) return out;
    const blocked = await officeWrite(async (c) => (await c.query(
      "SELECT blocked FROM mail_blocks WHERE lifted_at IS NULL")).rows.map((r) => r.blocked), { env, household: sides.mine });
    for (const { to, keys } of sides.theirs) if (keys.some((k) => blocked.includes(k))) out.add(to);
  } catch { /* unread is not blocked: the crossing is the stop */ }
  return out;
}

/** The send door's refusal for a letter the blocker writes to the household it blocked, or null. */
export async function youBlockedRefusal(key, to, opts = {}) {
  if (!(await blockedByMe(key, [to], opts)).has(to)) return null;
  let slug = null;
  try { slug = await officeRead(async (c) => (await houseOfVia(c, to)).slug, { env: opts.env ?? process.env, by: "youBlockedRefusal" }); } catch { slug = null; }
  return refuse(403, YOU_BLOCKED, YOU_BLOCKED_HINT(slug ?? to));
}

/**
 * THE CROSSING'S QUESTION. `letters` are `{ seq, from, to }`; returns the seqs
 * whose two households stand blocked, in either direction, now. A letter to or
 * from the town's own houses, or inside one household, is never stopped.
 *
 * A store without 083, or an office pointed at no store, has no blocks (none
 * could have been placed), so it answers none. Any other failure throws, and
 * the crossing holds its letters rather than sail one a block may stand against.
 */
export async function stoppedLetters(letters, { env = process.env } = {}) {
  const stopped = new Set();
  if (!letters?.length) return stopped;
  try {
    await officeRead(async (c) => {
      const keysOf = new Map();
      const setOf = async (handle) => {
        if (!keysOf.has(handle)) {
          const k = await householdKeyFor(c, handle);
          keysOf.set(handle, { key: k, keys: await sessionKeysVia(c, k) });
        }
        return keysOf.get(handle);
      };
      const asked = new Map();
      for (const { seq, from, to } of letters) {
        if (!from || !to) continue;
        const a = await setOf(from), b = await setOf(to);
        if (isTownHouse(a.key) || isTownHouse(b.key) || a.key === b.key) continue;
        const pair = [a.key, b.key].sort().join("\n");
        if (!asked.has(pair)) {
          const { rows } = await c.query("SELECT mail_block_stands($1, $2) AS stands", [a.keys, b.keys]);
          asked.set(pair, rows[0]?.stands === true);
        }
        if (asked.get(pair)) stopped.add(seq);
      }
    }, { env, by: "stoppedLetters" });
  } catch (e) {
    // An office pointed at no record (dev, a fixture town) has no blocks for
    // the same reason a store without 083 has none: none can have been placed.
    if (notYetLanded(e) || e?.name === "NoRecordError") return new Set();
    throw e;
  }
  return stopped;
}
