// invite-facts.mjs — what the invite plan reads (POS-816): the office's store and
// the town's ledger, once, for the three callers of src/invite-pay.mjs (the pass,
// the hands' hold view and tools/invites.mjs).
//
// THE STORE (`q(sql, params) -> rows`, actsQuery's shape or a pg client's):
//   households   slug, name, residents, formerly, and 085's `invited_by` (read
//                through to_jsonb, so a store without 085 reads none);
//   ashore       when each invited house's first resident came ashore (071);
//   town_letters each invited house's first DELIVERED letter, any resident's;
//   marks        each invited house's first parcel, at the close of the window
//                that locked it (its home), under either spelling of its key;
//   invite_holds the hands' holds (087). A store without 087 answers
//                `holds: null`, and the plan's caller pays no inviter side on a
//                hold it cannot read: it fails closed.
// The queries are tools/invites.mjs's own, moved here unchanged so the report
// and the pass read one record the same way.
//
// THE LEDGER: the town clone's own stamp-mint.mjs, imported from the clone, its
// classifier and its houseCanonOf over the STORE's registry (the same registry
// the pass hands the town's verb with --registry), so the plan reads a line the
// way the town's fold does.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ledgerFacts } from "./invite-pay.mjs";
import { meepLawOf } from "./fund-holder.mjs";

const iso = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; };
const missing = (e) => e?.code === "42P01"; // undefined_table: a migration that has not landed

/** The store's half of the plan's inputs. */
export async function inviteStoreFacts(q) {
  const houses = await q(`SELECT slug, name, residents, formerly, to_jsonb(households) -> 'invited_by' AS invited_by FROM households`, []);
  if (houses === null) return null;
  const rows = houses.filter((r) => r.invited_by != null && typeof r.invited_by === "object");
  const firsts = rows.map((r) => (r.residents ?? [])[0]).filter(Boolean);
  const houseOf = new Map(rows.flatMap((r) => (r.residents ?? []).map((h) => [h, r.slug])));
  const handles = [...houseOf.keys()];
  const ashore = new Map();
  for (const s of firsts.length ? (await q("SELECT handle, at FROM ashore WHERE handle = ANY($1)", [firsts])) ?? [] : [])
    ashore.set(houseOf.get(s.handle), iso(s.at));
  const letters = new Map();
  for (const s of handles.length ? (await q("SELECT from_h, min(delivered_at) AS at FROM town_letters WHERE from_h = ANY($1) AND delivered_at IS NOT NULL GROUP BY from_h", [handles])) ?? [] : []) {
    const slug = houseOf.get(s.from_h), at = iso(s.at);
    if (at && (!letters.has(slug) || at < letters.get(slug))) letters.set(slug, at);
  }
  const spellings = rows.flatMap((r) => [r.slug, `hh:${r.slug}`]);
  const homes = new Map();
  for (const p of spellings.length ? (await q(`SELECT m.household, min(w.closes_at) AS at FROM marks m JOIN windows w ON w.id = m.locked_window
      WHERE m.kind = 'parcel' AND m.household = ANY($1) GROUP BY m.household`, [spellings])) ?? [] : []) {
    const slug = String(p.household).replace(/^hh:/, ""), at = iso(p.at);
    if (at && (!homes.has(slug) || at < homes.get(slug))) homes.set(slug, at);
  }
  let holds = new Map();
  try {
    for (const h of (await q("SELECT household, state, moves FROM invite_holds", [])) ?? [])
      holds.set(h.household, { state: h.state, moves: Array.isArray(h.moves) ? h.moves : JSON.parse(h.moves ?? "[]") });
  } catch (e) { if (!missing(e)) throw e; holds = null; }
  return {
    rows: rows.map((r) => ({ slug: r.slug, name: r.name, residents: r.residents ?? [], invited_by: r.invited_by })),
    houses: houses.map((h) => ({ slug: h.slug, residents: h.residents ?? [], formerly: h.formerly ?? [] })),
    facts: { letters, homes, ashore },
    holds,
  };
}

/**
 * The town engine and its ledger, from the clone. Refuses, naming what is
 * missing, when the clone's stamp-mint.mjs carries no invite grammar: then the
 * plan cannot see what is already paid, and nothing may be paid twice.
 */
export async function townInviteLedger(town, registryHouseholds, { on = new Date() } = {}) {
  const tool = join(town, "tools", "stamp-mint.mjs");
  if (!existsSync(tool)) throw new Error(`invite: no tools/stamp-mint.mjs in ${town} — the town clone is named wrong`);
  const engine = await import(pathToFileURL(tool).href);
  if (typeof engine.inviteInvitedLine !== "function" || typeof engine.houseCanonOf !== "function")
    throw new Error("invite: this town's stamp-mint.mjs has no invite grammar (invite:<invited>/<inviter>/…), so the plan cannot see what is already paid — the town must carry --invite-mint first (POS-816's town half)");
  const ledgerFile = join(town, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerFile) ? engine.parseStampLedger(readFileSync(ledgerFile, "utf8")) : [];
  const canon = engine.houseCanonOf(registryHouseholds ?? {});
  // The town's meep law, for the plan's choice of a house's resident to pay (invite-pay.mjs § inviterRecipient).
  // The lenient read (fund-holder.mjs § meepLawOf): an unreadable law answers "nobody is a meep" here, which
  // can only plan a line the town's judge refuses (it holds the same law again at the verb), never pay a meep.
  const isMeep = meepLawOf(engine, entries, new Date(on).toISOString().slice(0, 10));
  return { engine, entries, ledger: { ...ledgerFacts(entries, { engine, canon }), isMeep } };
}
