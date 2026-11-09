// move-resident.mjs — one resident moves into another household; the empty house they leave is retired.
//
// POS-788 (Darko, 2026-10-25 09:53 EDT, on town #4159: "we need to move Corrie
// into Olivia's household as well"; 09:43: "for now, one household is for one
// individual human and their agent"). The shape is Wright's, 2026-11-07 and
// confirmed 11-09 11:10Z:
//   "The pin is kept: Corrie's handle, login and GitHub id binding stays. Only
//    the empty source household is retired, through the approved owner path."
//   "Not atomic: one store transaction for the two-house membership and account
//    move and the retirement, then the drain, ADDRESS and signed house-key line
//    published in one pen commit, resumable like rekey-household (store first,
//    publication resumes if the push can't land). planHouseKey comes first."
//   "--dry-run prints every row and file it would touch, and writes nothing."
//
//   node tools/move-resident.mjs --handle <handle> --to <household> [--dry-run]
//
// Run it on the box under the town lock, with the office's env (the store as
// the office reads it, the pen key, TOWN_CLONE, TOWN_PUSH) AND the owner's PG*
// env, the idiom the owner's tools already take (world2/tools/adopt-solo.mjs):
//   . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD
// Only the store transaction connects as the owner: no pen holds DELETE on
// `households` (019: "A row that must go is a finding for a person and the
// owner's hand"), and the transaction refuses unless its connection is
// `world2_owner`. A dry run never connects as the owner.
//
// WHAT MOVES, AND WHAT DELIBERATELY DOES NOT:
//
//   · THE PIN DOES NOT MOVE. `household_pins` binds the handle to its login and
//     GitHub id and carries no household; it is not touched.
//   · THE STORE, in one owner transaction (src/registry-store.mjs §
//     moveResidentInStore): the target household gains the resident, the
//     source's accounts, the source's key and former keys in `formerly`, and
//     the resident's home picture; the source row, holding only this
//     resident, is deleted. Rows spelled `hh:<source>` or `gh:<its account>`
//     (acts, claims, marks, letters, notes) keep their spelling for life
//     (024_household_spellings.sql) and stay the house's through its spelling
//     set (src/household-deriver.mjs § houseKeysOf).
//   · THE TOWN FILES, in one pen commit: the registry drain prints
//     tools/households.json from the store (the source key in the target's
//     `formerly`, so the drain's shrink guard reads the retirement as a move);
//     the resident's ADDRESS (and berth) `household:` line says the target's
//     name where it said the source's name or key; and the house's signed key
//     line, `registry: <handle> = hh:<target>`, judged first by planHouseKey
//     (the split, the ledger's tail, the pen, and the dating rule's replay).
//   · NOT CHANGED: the resident's handle, home page and stamps; the welcome
//     either house was paid; any history row.
//
// RESUMABLE. The store moves before the commit, so a push that cannot land
// leaves the store moved and the clone as it was. Running the same command
// again finds the resident already in the target, with a house the town's
// files still print and the target's `formerly` carries: that is the source,
// and the run publishes what is left, without moving the store again. The key
// line is planned from the clone's own ledger, so a line that landed is never
// written twice. A run with nothing left refuses (`SAME_HOUSE`) and writes nothing.

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadRegistryRows, movedTargetRow, moveResidentInStore } from "../src/registry-store.mjs";
import { registryFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { planHouseKey, appendHouseKey, registryWith, LEDGER_REL } from "../src/house-key.mjs";
import { penCommit, penTransaction, landOrRefuse } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { withHouseLine, easternDate } from "./rekey-household.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MOVE_REFUSALS = Object.freeze({
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record — nothing was written" },
  NO_PIN: { code: 404, defect: "--handle names no pinned resident" },
  NO_TARGET: { code: 404, defect: "no household stands at --to" },
  NOT_HOUSED: { code: 404, defect: "--handle lives in no household" },
  SAME_HOUSE: { code: 409, defect: "--handle already lives in --to, and no house it left is waiting to be published" },
  NOT_EMPTY: { code: 409, defect: "the household --handle leaves has other residents: this tool retires only a house that the move leaves empty" },
  CREDIT: { code: 409, defect: "the household --handle leaves carries an invitation credit (invited_by): moving or dropping it is a payout ruling, not this tool's" },
  COLLATERAL: { code: 409, defect: "printing the registry would change more than the two households — the town's files are behind the store elsewhere; run the registry drain first" },
  HOUSE_KEY: { code: 409, defect: "the house's key line cannot be written today" },
  DRAIN_REFUSED: { code: 409, defect: "the registry drain refused to print" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), { code: r.code, defect: r.defect, detail });

const read = (clone, rel) => { try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; } };
const filesHouses = (clone) => JSON.parse(read(clone, REGISTRY_PATH) ?? "{}").households ?? {};

// ── the plan ────────────────────────────────────────────────────────────────

/**
 * Everything the move would change, decided from the store's rows and the
 * clone as they stand. Reads only; throws a named refusal. `keyPlan` is
 * planHouseKey (it judges the key line before anything is written, and signs it
 * in memory), injected in test.
 */
export function planMove({ handle, to, rows, clone, date, keyPlan = planHouseKey }) {
  if (!(rows.pins ?? []).some((p) => p.handle === handle)) throw refuse(MOVE_REFUSALS.NO_PIN, handle);
  const byslug = new Map(rows.households.map((r) => [r.slug, r]));
  const target = byslug.get(to);
  if (!target) {
    const wore = rows.households.find((r) => (r.formerly ?? []).includes(to));
    throw refuse(MOVE_REFUSALS.NO_TARGET, wore ? `${to} is a former key of ${wore.slug}` : to);
  }
  const files = filesHouses(clone);

  // RESUMING: the resident already lives in the target, and the town's files
  // still print a house holding them that the target's `formerly` carries and
  // the store no longer has. Everything the move publishes lands in ONE pen
  // commit, so that printed house is exactly what is left: the registry, the
  // card and the key line together. With no such house, the move (if there
  // ever was one) is published whole, and there is nothing to do.
  const resuming = (target.residents ?? []).includes(handle);
  let from, source;
  if (resuming) {
    from = Object.keys(files).find((s) => s !== to && !byslug.has(s) && (target.formerly ?? []).includes(s) && (files[s]?.residents ?? []).includes(handle)) ?? null;
    if (!from) throw refuse(MOVE_REFUSALS.SAME_HOUSE, `${handle} lives in ${to}`);
    source = { slug: from, residents: [handle], name: files[from]?.name ?? null };
  } else {
    source = rows.households.find((r) => (r.residents ?? []).includes(handle)) ?? null;
    if (!source) throw refuse(MOVE_REFUSALS.NOT_HOUSED, handle);
    from = source.slug;
    if ((source.residents ?? []).length !== 1) throw refuse(MOVE_REFUSALS.NOT_EMPTY, `${from}: ${source.residents.join(", ")}`);
    if (source.invited_by != null) throw refuse(MOVE_REFUSALS.CREDIT, `${from} was invited by ${source.invited_by.by ?? "?"}`);
  }

  // The rows as they will stand: the target moved, the source gone.
  const after = resuming ? rows : {
    ...rows,
    households: rows.households.filter((r) => r.slug !== from).map((r) => (r.slug === to
      ? { ...r, ...movedTargetRow({ handle, source, target }) } : r)),
  };
  const targetAfter = after.households.find((r) => r.slug === to);

  // COLLATERAL (rekey-household's rule): what the drain would print may differ
  // from the town's files only in the two households.
  const printed = renderPublicRegistry(after);
  const printedHouses = JSON.parse(printed.households).households ?? {};
  const moved = [];
  for (const k of new Set([...Object.keys(files), ...Object.keys(printedHouses)])) {
    if (k === from || k === to) continue;
    if (JSON.stringify(files[k]) !== JSON.stringify(printedHouses[k])) moved.push(k);
  }
  if ((read(clone, PINS_PATH) ?? "") !== printed.pins) moved.push(PINS_PATH);
  if (moved.length) throw refuse(MOVE_REFUSALS.COLLATERAL, moved.slice(0, 8).join(", ") + (moved.length > 8 ? `, +${moved.length - 8} more` : ""));

  // The resident's card and berth, where they named the source by name or key.
  const oldValues = [source?.name, from].filter(Boolean).map((v) => String(v).trim());
  const name = targetAfter.name ?? to;
  const cards = [];
  for (const rel of [`WHITE_PAGES/${handle}/ADDRESS.md`, `HARBOR/berths/${handle}.md`]) {
    const text = read(clone, rel);
    const next = text == null || !oldValues.length ? null : withHouseLine(text, { oldValues, name });
    if (next != null && next !== text) cards.push({ path: rel, before: houseLineOf(text), after: houseLineOf(next), content: next });
  }

  // THE KEY, judged before any write (planHouseKey: the split, the tail, the pen, the replay).
  const residentsAfter = [...new Set([...(targetAfter.residents ?? []), handle])];
  const keyed = keyPlan(clone, [{ handle, slug: to, residents: residentsAfter }],
    { date, registry: registryWith(registryFromRows(after), to, residentsAfter) });
  if (keyed?.refusal) throw refuse(MOVE_REFUSALS.HOUSE_KEY, `${keyed.refusal.defect}${keyed.detail ? ` — ${keyed.detail}` : ""}`);

  return {
    handle, from, to, resuming, date,
    pin: { handle, untouched: true },
    store: resuming ? null : {
      update: { table: "households", slug: to, before: pick(target), after: pick({ ...target, ...movedTargetRow({ handle, source, target }) }) },
      retire: { table: "households", slug: from, row: source },
    },
    registry: { retired: files[from] ? from : null, before: files[to] ?? null, after: printedHouses[to] ?? null },
    cards,
    ledger: { lines: (keyed?.lines ?? []).map((l) => l.line), signed: keyed?.signed ?? [], checked: keyed?.replay?.checked ?? null },
  };
}

const pick = (r) => ({ residents: r.residents ?? [], accounts: r.accounts ?? [], formerly: r.formerly ?? [], home_images: r.home_images ?? {} });
const houseLineOf = (text) => /^household:[ \t]*(.*)$/m.exec(String(text ?? ""))?.[1]?.trim() ?? null;

// ── the act ─────────────────────────────────────────────────────────────────

/**
 * Plan, and unless `dryRun`, do it: the owner's store transaction, then the
 * printed registers, the card lines and the signed key line, in one pen commit.
 * A dry run returns the plan and calls no writer. `owner` connects the owner's
 * client (the real run only); `move`, `drainWith` and `commit` are injected in
 * test.
 */
export async function moveResident({ handle, to, clone, env = process.env, date = easternDate(), dryRun = false,
  keyPlan = planHouseKey, owner = ownerClient, move = moveResidentInStore, drainWith = collectingDrain, commit = penCommit } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(MOVE_REFUSALS.NO_RECORD);
  const plan = planMove({ handle, to, rows, clone, date, keyPlan });
  if (dryRun) return { dryRun: true, plan };

  if (!plan.resuming) {
    const client = await owner(env);
    try { await move(client, { handle, from: plan.from, to }); }
    finally { try { await client.end(); } catch { /* a client that will not close still committed or rolled back */ } }
  }

  const paths = [];
  for (const c of plan.cards) { writeFileSync(join(clone, c.path), c.content); paths.push(join(clone, c.path)); }
  const { drain, paths: printed } = drainWith({ clone, env });
  const drained = await drain({ note: `POS-788: ${handle} moved to ${to}${plan.from ? `; ${plan.from} retired` : ""}` });
  if (drained?.refused) throw refuse(MOVE_REFUSALS.DRAIN_REFUSED, drained.refused);
  paths.push(...printed);
  const ledger = appendHouseKey(clone, plan.ledger.signed);
  if (ledger) paths.push(ledger);

  const sha = landOrRefuse(() => commit(clone, paths,
    `registry: ${handle} moves to ${to}${plan.from ? ` · ${plan.from} retired` : ""} — the pin unchanged (via postmark-office, move-resident, POS-788)`));
  if (sha?.error) throw Object.assign(new Error(sha.error.defect), sha.error, { detail: "the store has moved; run the same command again to publish" });
  return { dryRun: false, plan, commit: sha };
}

/** The owner's client, from the PG* env the owner's tools take (`w2_pgenv world2_owner …`). */
export async function ownerClient() {
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  return client;
}

// ── the command ─────────────────────────────────────────────────────────────

const arg = (name, argv) => { const i = argv.indexOf(name); return i === -1 ? null : argv[i + 1]; };

/** What the plan touches, every row and file, in plain lines. */
export function describe(plan, { dryRun }) {
  const out = [];
  out.push(`${dryRun ? "DRY RUN — nothing written." : "MOVED."}${plan.resuming ? " (resuming: the store had already moved)" : ""}`);
  out.push(`resident: ${plan.handle}  ·  from: ${plan.from}  ·  to: ${plan.to}  ·  date: ${plan.date}`);
  out.push(`pin: household_pins ${plan.handle} — unchanged (handle, login and GitHub id stay bound)`);
  if (plan.store) {
    const { before, after } = plan.store.update;
    out.push(`store (one transaction, as world2_owner):`);
    out.push(`  UPDATE households ${plan.to}:`);
    out.push(`    residents   ${JSON.stringify(before.residents)} -> ${JSON.stringify(after.residents)}`);
    out.push(`    accounts    ${JSON.stringify(before.accounts)} -> ${JSON.stringify(after.accounts)}`);
    out.push(`    formerly    ${JSON.stringify(before.formerly)} -> ${JSON.stringify(after.formerly)}`);
    out.push(`    home_images ${JSON.stringify(Object.keys(before.home_images))} -> ${JSON.stringify(Object.keys(after.home_images))}`);
    out.push(`  DELETE households ${plan.from} (its only resident is ${plan.handle}); the row as it stands:`);
    // the human's own name stays out of the print, as the public registry keeps it out (POS-394)
    const { human, ...row } = plan.store.retire.row;
    out.push(`    ${JSON.stringify(human == null ? row : { ...row, human: "(set; private, not printed)" })}`);
    out.push(`  rows spelled hh:${plan.from} or its accounts' gh:<id> keep their spelling; ${plan.to}'s spelling set carries them`);
  } else out.push("store: no change (already moved)");
  out.push(`town files (one pen commit):`);
  out.push(`  ${REGISTRY_PATH}: ${plan.registry.retired} leaves the printout; ${plan.to} printed as ${JSON.stringify(plan.registry.after)}`);
  out.push(`  ${PINS_PATH}: unchanged`);
  for (const c of plan.cards) out.push(`  ${c.path}: household: ${c.before} -> ${c.after}`);
  if (!plan.cards.length) out.push("  no card line to change");
  if (plan.ledger.lines.length) {
    out.push(`  ${LEDGER_REL}: append ${plan.ledger.lines.length} signed line(s) (dating rule: ${plan.ledger.checked ?? "n/a"}):`);
    for (const l of plan.ledger.lines) out.push(`    ${l} · sig: <the office pen>`);
  } else out.push(`  ${LEDGER_REL}: no line (the clone's ledger already keys the house)`);
  out.push("not changed: the handle, the home page, stamps, any welcome, any history row. The office's house caches renew within a minute.");
  return out.join("\n");
}

export async function main(argv = process.argv.slice(2), { env = process.env, log = console.log, err = console.error, act = moveResident } = {}) {
  const handle = arg("--handle", argv), to = arg("--to", argv);
  if (!handle || !to) { err("move-resident: --handle <handle> --to <household> are required ([--dry-run])"); return 2; }
  const clone = env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
  const dryRun = argv.includes("--dry-run");
  try {
    const out = await penTransaction(clone, async () => {
      if (!dryRun && env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
      try { return await act({ handle, to, clone, env, dryRun }); }
      catch (e) {
        if (typeof e?.code !== "number") throw e;
        return { error: { code: e.code, defect: e.defect ?? String(e.message), detail: e.detail ?? null } };
      }
    });
    if (out?.error) { err(`move-resident: REFUSED — ${out.error.defect}${out.error.detail ? ` (${out.error.detail})` : ""}`); return 1; }
    log(describe(out.plan, out));
    if (out.commit) log(`commit: ${out.commit}`);
    return 0;
  } catch (e) {
    err(`move-resident: tripped — ${String(e?.stack ?? e).slice(0, 600)}`);
    return 1;
  }
}

// ── entry guard ── the realpath compare (test/cli-guard.test.mjs spawns it both ways)
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(await main());
