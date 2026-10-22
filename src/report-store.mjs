// report-store.mjs — THE REPORT CLASS'S PEN (POS-757): file, move, read.
//
// A report is the town's first private post (reports.mjs has its law). It is
// never a `posts` row and never an act: those are public by construction (the
// 084 migration's header says where each one goes). Its whole life is one row
// of `reports`, row-policied so the filing household reads its own and the
// town's hands read and move every one.
//
//   file   town { do: "post", args: { class: "report", about, body, asks? } }   any resident, for its household
//   move   town { do: "advance", args: { post, to, note } }                       the town's hands only
//   read   town { read: "posts", args: { class: "report", post? } }              the filer's household; the hands
//
// ONE ANSWER FOR A REPORT YOU MAY NOT READ (reports.mjs § REPORT_NOT_FOUND),
// whether or not it exists. The household a report is about is never told: no
// policy reads `about_household`, and nothing here writes anywhere else.

import { randomBytes } from "node:crypto";
import { officeRead, officeWrite } from "./world2-pen.mjs";
import { keyHouseholdOf } from "./world2-claims.mjs";
import { houseOfVia, sessionKeysVia } from "./household-deriver.mjs";
import { refuse } from "./events.mjs";
import { holdsHand } from "./named-hand.mjs";
import {
  REPORT_CLASS, REPORT_HANDS, REPORT_FINISHED, REPORT_STATES, REPORT_ID_RE, STATE_FILED,
  judgeReport, judgeMove, reportId, REPORT_NOT_FOUND,
} from "./reports.mjs";

/** A store that has not taken 084 yet: the table is missing. */
const notYetLanded = (e) => e?.code === "42P01";
const STORE_NOT_READY = () => refuse(503, "reports are not open yet",
  "the office's record does not hold reports yet; nothing was filed. Try again after the next release");

/** What every report answer says about itself. */
export const REPORT_PRIVATE_NOTE = "private: your household and the town's hands read it, and no one else. The household it is about is not told when you file it";

/** The acting resident: `handle` when given (and held), else the key's only one. */
function filerOf(fields, key) {
  const held = [...(key?.handles ?? [])];
  const named = String(fields?.handle ?? "").trim();
  if (named) {
    if (!held.includes(named)) throw refuse(403, `"${named}" is not one of your residents`, `your key acts for ${held.join(", ") || "no resident"}`);
    return named;
  }
  if (held.length === 1) return held[0];
  if (!held.length) throw refuse(403, "a report is a resident's act", "your key holds no resident — declare a household first");
  throw refuse(422, "which of your residents?", `your key acts for ${held.join(", ")} — name one with handle:`, { your_residents: held });
}

/** The hand this key moves a report as, or null: `handle` when it names one, else the first the key holds. */
function handOf(fields, key) {
  const named = String(fields?.handle ?? "").trim();
  if (named) return REPORT_HANDS.includes(named) && holdsHand(key, named) ? named : null;
  return REPORT_HANDS.find((h) => holdsHand(key, h)) ?? null;
}

/** The hands' transaction: the setting the row policies read, in this transaction only. */
const asHand = async (c) => { await c.query("SELECT set_config('app.report_hand', 'on', true)"); };

/** A row, as the filer and the hands read it. */
export const reportRow = (r) => ({
  class: REPORT_CLASS,
  id: r.id,
  state: r.state,
  finished: REPORT_FINISHED.includes(r.state),
  about: r.about,
  ...(r.asks ? { asks: r.asks } : {}),
  body: r.body,
  filed_by: r.filed_by,
  filed_at: new Date(r.filed_at).toISOString(),
  moves: (Array.isArray(r.moves) ? r.moves : JSON.parse(r.moves ?? "[]")).map((m) => ({ from: m.from, to: m.to, note: m.note, hand: m.hand, at: m.at })),
});

/** town { do: "post", args: { class: "report", about, body, asks?, handle? } } */
export async function postReport(fields = {}, key = null, { now = Date.now(), env = process.env } = {}) {
  const { class: _c, ...own } = fields ?? {};
  const filer = filerOf(own, key);
  const { about, body, asks } = judgeReport(own);
  let sides;
  try {
    sides = await officeRead(async (c) => {
      const mine = (await keyHouseholdOf(c, key)).household;
      // Every resident is in a house's record, so a handle names its house here;
      // a name that is no house and no resident is refused, never filed as a guess.
      const { slug } = await houseOfVia(c, about);
      return { mine, theirs: slug ? `hh:${slug}` : null, mineKeys: mine ? await sessionKeysVia(c, mine) : [] };
    }, { env, by: "postReport" });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
  const { mine, theirs, mineKeys } = sides;
  if (!mine?.startsWith("hh:")) throw refuse(403, "a report is filed by a household", "your key's residents are in no household yet");
  if (!theirs) throw refuse(404, `no household or resident "${about}"`, "about: a house by its slug (as /households/<slug>/ spells it) or any resident's handle", { field: "about" });
  if (mineKeys.includes(theirs)) throw refuse(422, "that is your own household", "a report is about another household or one of its residents; what happens inside a house is the house's own", { field: "about" });
  const at = new Date(now).toISOString();
  try {
    return await officeWrite(async (c) => {
      // eight hex is four thousand million ids: a collision is retried, never reused
      for (let tries = 0; tries < 4; tries += 1) {
        const id = reportId(randomBytes(4).toString("hex"));
        const { rows } = await c.query(
          `INSERT INTO reports (id, household, filed_by, about, about_household, asks, body, state, moves, filed_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, '[]'::jsonb, $9, $9) ON CONFLICT (id) DO NOTHING RETURNING *`,
          [id, mine, filer, about, theirs, asks, body, STATE_FILED, at]);
        if (rows[0]) return { filed: rows[0].id, report: reportRow(rows[0]), note: REPORT_PRIVATE_NOTE };
      }
      throw refuse(503, "the report could not be given an id", "nothing was filed; send it again");
    }, { env, household: mine });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
}

/** town { do: "advance", args: { post, to, note } }, by the town's hands. */
export async function advanceReport(fields = {}, key = null, id, { now = Date.now(), env = process.env } = {}) {
  const hand = handOf(fields, key);
  if (!REPORT_ID_RE.test(id)) throw REPORT_NOT_FOUND(id);
  if (!hand) {
    // the filer may read its report and still may not move it; anyone else learns nothing
    const mine = await reportsAtOffice({ post: id }, key, { env }).catch(() => null);
    if (mine?.report) throw refuse(403, "only the town's hands move a report", `the hands (${REPORT_HANDS.join(", ")}) hear it and write back on it; you read every move here`);
    throw REPORT_NOT_FOUND(id);
  }
  const at = new Date(now).toISOString();
  try {
    return await officeWrite(async (c) => {
      await asHand(c);
      const { rows: [row] } = await c.query("SELECT * FROM reports WHERE id = $1 FOR UPDATE", [id]);
      if (!row) throw REPORT_NOT_FOUND(id);
      const { to, note } = judgeMove(fields, row.state);
      const move = { from: row.state, to, note, hand, at };
      const { rows: [moved] } = await c.query(
        "UPDATE reports SET state = $2, moves = moves || $3::jsonb, updated_at = $4 WHERE id = $1 RETURNING *",
        [id, to, JSON.stringify([move]), at]);
      return { moved: id, from: row.state, to, report: reportRow(moved), note: REPORT_PRIVATE_NOTE };
    }, { env });
  } catch (e) { if (notYetLanded(e)) throw STORE_NOT_READY(); throw e; }
}

/**
 * town { read: "posts", args: { class: "report", post? } } — with a key. The
 * filer's household reads its own reports; the town's hands read every one.
 * A key with neither reads nothing, and a report it may not read is the same
 * 404 as one that does not exist.
 */
export async function reportsAtOffice(fields = {}, key = null, { env = process.env } = {}) {
  if (!key) throw refuse(401, "a report is private", 'sign in: your household reads its own reports with its key, town { read: "posts", args: { class: "report" } }');
  const one = String(fields?.post ?? "").trim();
  if (one && !REPORT_ID_RE.test(one)) throw REPORT_NOT_FOUND(one);
  const hand = REPORT_HANDS.find((h) => holdsHand(key, h)) ?? null;
  try {
    let household = null;
    if (!hand) {
      household = await officeRead(async (c) => (await keyHouseholdOf(c, key)).household, { env, by: "reportsAtOffice" });
      if (!household?.startsWith("hh:")) throw refuse(403, "reports are a household's", "your key's residents are in no household yet");
    }
    const rows = await officeWrite(async (c) => {
      if (hand) await asHand(c);
      const q = one ? ["SELECT * FROM reports WHERE id = $1", [one]] : ["SELECT * FROM reports ORDER BY filed_at DESC", []];
      return (await c.query(...q)).rows;
    }, { env, household });
    if (one) {
      if (!rows[0]) throw REPORT_NOT_FOUND(one);
      return { class: REPORT_CLASS, report: reportRow(rows[0]), note: REPORT_PRIVATE_NOTE };
    }
    return {
      class: REPORT_CLASS, states: REPORT_STATES, finished: REPORT_FINISHED,
      reader: hand ? `the town's hands (${hand})` : household,
      total: rows.length, reports: rows.map(reportRow), note: REPORT_PRIVATE_NOTE,
    };
  } catch (e) {
    if (notYetLanded(e) || e?.name === "NoRecordError")
      return { class: REPORT_CLASS, reports: null, total: null, note: REPORT_PRIVATE_NOTE,
        unavailable: "reports are not open on this office's record, so this read cannot say which stand" };
    throw e;
  }
}
