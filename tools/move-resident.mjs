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
// leaves the store moved and the clone as it was, and any other ceremony's
// drain may then print the move before this act publishes. Running the same
// command again decides from durable facts alone (planMove § RESUMING): the
// store holds the resident in the target, and the sealed ledger does not yet
// key them `hh:<target>`; and it resumes only on evidence of this move, a
// printout that shows the source beside the target holding the resident (a
// rename never prints one). It then finishes each missing step, each a no-op
// where already done: the drain, the card (matched against that printout's
// source name, and refused by name if it names neither house), and the key
// line, planned from the clone's own ledger so it is never written twice. No
// evidence, more than one source, or a card it cannot match refuses and writes
// nothing. Only once the ledger keys the resident to the target does a run
// refuse `SAME_HOUSE`.

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadRegistryRows, movedTargetRow, moveResidentInStore, likenessStateHeld, MOVE_ROW_REFUSALS } from "../src/registry-store.mjs";
import { registryFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { planHouseKey, appendHouseKey, registryWith, LEDGER_REL } from "../src/house-key.mjs";
import { penCommit, penTransaction, landOrRefuse } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { withHouseLine, easternDate, ledgerRegistry } from "./rekey-household.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const MOVE_REFUSALS = Object.freeze({
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record — nothing was written" },
  NO_PIN: { code: 404, defect: "--handle names no pinned resident" },
  NO_TARGET: { code: 404, defect: "no household stands at --to" },
  NOT_HOUSED: { code: 404, defect: "--handle lives in no household" },
  SAME_HOUSE: { code: 409, defect: "--handle already lives in --to, and no house it left is waiting to be published" },
  NO_MOVE_EVIDENCE: { code: 409, defect: "--handle lives in --to, but nothing this clone holds shows this tool moved them there — nothing was written" },
  AMBIGUOUS: { code: 409, defect: "more than one former house of --to shows --handle moved from it — a person reads them; nothing was written" },
  CARD_UNMATCHED: { code: 409, defect: "a card of --handle names a household that is neither --to nor the house they left — a person reads it; nothing was written" },
  NOT_EMPTY: { code: 409, defect: "the household --handle leaves has other residents: this tool retires only a house that the move leaves empty" },
  CREDIT: { code: 409, defect: "the household --handle leaves carries an invitation credit (invited_by): moving or dropping it is a payout ruling, not this tool's" },
  // Wright 2026-11-09 12:43Z (POS-726, on #985): "If the source household has any likeness state, refuse by name,
  // rechecked under the lock, before any write or output, and never print it in the dump."
  LIKENESS_STATE: MOVE_ROW_REFUSALS.LIKENESS_STATE,
  COLLATERAL: { code: 409, defect: "printing the registry would change more than the two households — the town's files are behind the store elsewhere; run the registry drain first" },
  HOUSE_KEY: { code: 409, defect: "the house's key line cannot be written today" },
  DRAIN_REFUSED: { code: 409, defect: "the registry drain refused to print" },
});

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), { code: r.code, defect: r.defect, detail });

const read = (clone, rel) => { try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; } };
const filesHouses = (clone) => JSON.parse(read(clone, REGISTRY_PATH) ?? "{}").households ?? {};
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const gitOut = (clone, args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();

/**
 * The households of the LAST printout that still held `slug`: the clone's file
 * when it holds it, else the version just before the commit that removed its
 * `"<slug>": {` line, read from the printout's own git history (which later
 * drains never rewrite). Null when the clone holds no such version (it never
 * printed the house, or a shallow clone does not reach back that far).
 */
export function lastPrintedHolding(clone, slug) {
  if (!SLUG_RE.test(slug)) return null;
  const now = filesHouses(clone);
  if (now[slug]) return now;
  let rev;
  try { rev = gitOut(clone, ["log", "-n", "1", "--format=%H", "-G", `^    "${slug}": `, "--", REGISTRY_PATH]); } catch { return null; }
  if (!rev) return null;
  for (const r of [rev, `${rev}^`]) {
    try {
      const houses = JSON.parse(gitOut(clone, ["show", `${r}:${REGISTRY_PATH}`])).households ?? {};
      if (houses[slug]) return houses;
    } catch { /* the parent of a root or shallow commit, or a file that did not parse there */ }
  }
  return null;
}

/** The clone's HEAD, which a dry run names: it reads the clone as it stands and never pulls. */
const cloneHead = (clone) => { try { return gitOut(clone, ["rev-parse", "HEAD"]); } catch { return null; } };

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

  // RESUMING, decided from DURABLE facts only (the review of #985, finding 1):
  // the STORE says the resident lives in the target, and the SEALED LEDGER says
  // whether the act's record landed. Never the current printout: every other
  // ceremony's drain reprints the whole registry from the store, so the first
  // one to land after a stalled publication erases the source's printed row.
  //   · sealed `hh:<to>`: the key line rode the act's one commit beside the
  //     card, so the publication is complete; nothing to do (SAME_HOUSE);
  //   · otherwise a candidate source is a former key of the target the store no
  //     longer has: the one the sealed line names (`hh:<source>`), or, for a
  //     resident who still mints under their human's `gh:<id>` and so has no
  //     such line, any of them.
  //   · A CANDIDATE IS RESUMED ONLY ON EVIDENCE OF THIS MOVE (the second review
  //     of #985, finding 1): the last printout that still held it shows it
  //     standing BESIDE the target and holding the resident, whom the target did
  //     not hold. A move prints that version (the source retires after the
  //     target already stood); a rename never does (the old key and the new
  //     one never stand together). The source's display name comes from that
  //     same version. No such version (a rename, a resident never moved here,
  //     or a clone too shallow to reach it) refuses by name, as does more than
  //     one: nothing is written and no line is signed on a guess.
  const resuming = (target.residents ?? []).includes(handle);
  let from, source;
  if (resuming) {
    const sealed = ledgerRegistry(read(clone, LEDGER_REL)).latest.get(handle) ?? null;
    if (sealed === `hh:${to}`) throw refuse(MOVE_REFUSALS.SAME_HOUSE, `${handle} lives in ${to}, and the ledger keys them there`);
    const gone = (target.formerly ?? []).filter((s) => !byslug.has(s) && SLUG_RE.test(s));
    const named = sealed?.startsWith("hh:") ? sealed.slice(3) : null;
    const candidates = named ? gone.filter((s) => s === named) : gone;
    const proven = candidates.map((s) => [s, lastPrintedHolding(clone, s)]).filter(([s, houses]) =>
      houses?.[to] && (houses[s]?.residents ?? []).includes(handle) && !(houses[to].residents ?? []).includes(handle));
    if (!proven.length)
      throw refuse(MOVE_REFUSALS.NO_MOVE_EVIDENCE, `${handle} lives in ${to}; the ledger keys them ${sealed ?? "under their human's account"}; `
        + (candidates.length ? `no printout this clone holds shows ${candidates.join(" or ")} beside ${to} holding ${handle} (a rename never does; a shallow clone may not reach it)`
          : `${to} has no retired former key${named ? ` named ${named}` : ""}`));
    if (proven.length > 1) throw refuse(MOVE_REFUSALS.AMBIGUOUS, proven.map(([s]) => s).join(", "));
    const [[slug, houses]] = proven;
    from = slug;
    source = { slug: from, residents: [handle], name: houses[from].name ?? null };
  } else {
    source = rows.households.find((r) => (r.residents ?? []).includes(handle)) ?? null;
    if (!source) throw refuse(MOVE_REFUSALS.NOT_HOUSED, handle);
    from = source.slug;
    if ((source.residents ?? []).length !== 1) throw refuse(MOVE_REFUSALS.NOT_EMPTY, `${from}: ${source.residents.join(", ")}`);
    if (source.invited_by != null) throw refuse(MOVE_REFUSALS.CREDIT, `${from} was invited by ${source.invited_by.by ?? "?"}`);
    // A row that carries the state (a train whose parser reads 092) refuses here too; moveResident has already asked
    // the store directly, because an older parser omits the column and its absence here proves nothing.
    if (holdsLikenessState(source)) throw refuse(MOVE_REFUSALS.LIKENESS_STATE, from);
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
  // (read here, never written: the drain is the registers' one writer, test/registry-no-file-writer.test.mjs)
  const pinsBehind = (read(clone, PINS_PATH) ?? "") !== printed.pins;
  if (pinsBehind) moved.push("tools/github-ids.json");
  if (moved.length) throw refuse(MOVE_REFUSALS.COLLATERAL, moved.slice(0, 8).join(", ") + (moved.length > 8 ? `, +${moved.length - 8} more` : ""));

  // The resident's card and berth, where they named the source by name or key.
  const oldValues = [source?.name, from].filter(Boolean).map((v) => String(v).trim());
  const name = targetAfter.name ?? to;
  const cards = [];
  for (const rel of [`WHITE_PAGES/${handle}/ADDRESS.md`, `HARBOR/berths/${handle}.md`]) {
    const text = read(clone, rel);
    // A RESUMED CARD MUST BE MATCHABLE (the second review of #985, finding 2): a
    // `household:` line naming neither the target nor the house they left would
    // be left stale while the key line marks the act complete, so it refuses here,
    // before anything is written. (A first run leaves such a line as the
    // resident's own words, as rekey-household does.)
    const said = text == null ? null : frontHouseLine(text);
    if (resuming && said != null && said !== name && !oldValues.includes(said))
      throw refuse(MOVE_REFUSALS.CARD_UNMATCHED, `${rel}: household: ${said}`);
    const next = text == null || !oldValues.length ? null : withHouseLine(text, { oldValues, name });
    if (next != null && next !== text) cards.push({ path: rel, before: houseLineOf(text), after: houseLineOf(next), content: next });
  }

  // THE KEY, judged before any write (planHouseKey: the split, the tail, the pen, the replay).
  const residentsAfter = [...new Set([...(targetAfter.residents ?? []), handle])];
  const keyed = keyPlan(clone, [{ handle, slug: to, residents: residentsAfter }],
    { date, registry: registryWith(registryFromRows(after), to, residentsAfter) });
  if (keyed?.refusal) throw refuse(MOVE_REFUSALS.HOUSE_KEY, `${keyed.refusal.defect}${keyed.detail ? ` — ${keyed.detail}` : ""}`);

  return {
    handle, from, to, resuming, date, clone_head: cloneHead(clone),
    pin: { handle, untouched: true },
    store: resuming ? null : {
      update: { table: "households", slug: to, before: pick(target), after: pick({ ...target, ...movedTargetRow({ handle, source, target }) }) },
      retire: { table: "households", slug: from, row: withoutPrivate(source) },
    },
    registry: { retired: files[from] ? from : null, before: files[to] ?? null, after: printedHouses[to] ?? null },
    cards,
    ledger: { lines: (keyed?.lines ?? []).map((l) => l.line), signed: keyed?.signed ?? [], checked: keyed?.replay?.checked ?? null },
  };
}

const pick = (r) => ({ residents: r.residents ?? [], accounts: r.accounts ?? [], formerly: r.formerly ?? [], home_images: r.home_images ?? {} });
// THE PRIVATE LIKENESS STATE (092, POS-726): a row carries it as `likeness_state`, and a printed file as its public
// projection `likeness_official`. Neither is ever part of the plan or the dry run.
const PRIVATE_LIKENESS = ["likeness_state", "likeness_official"];
const holdsLikenessState = (row) => PRIVATE_LIKENESS.some((k) => row?.[k] != null);
const withoutPrivate = (row) => Object.fromEntries(Object.entries(row ?? {}).filter(([k]) => !PRIVATE_LIKENESS.includes(k)));
const houseLineOf = (text) => /^household:[ \t]*(.*)$/m.exec(String(text ?? ""))?.[1]?.trim() ?? null;
/** The frontmatter's `household:` value, read as withHouseLine reads it, or null. */
const frontHouseLine = (text) => {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  return fm ? (/^household:[ \t]*(.*)$/m.exec(fm[2])?.[1]?.trim() ?? null) : null;
};

// ── the act ─────────────────────────────────────────────────────────────────

/**
 * Plan, and unless `dryRun`, do it: the owner's store transaction, then the
 * printed registers, the card lines and the signed key line, in one pen commit.
 * A dry run returns the plan and calls no writer. `owner` connects the owner's
 * client (the real run only); `move`, `drainWith` and `commit` are injected in
 * test.
 */
export async function moveResident({ handle, to, clone, env = process.env, date = easternDate(), dryRun = false,
  keyPlan = planHouseKey, owner = ownerClient, move = moveResidentInStore, drainWith = collectingDrain, commit = penCommit,
  stateHeld = likenessStateHeld } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(MOVE_REFUSALS.NO_RECORD);
  // LIKENESS STATE, BEFORE ANY OUTPUT OR WRITE (Wright 12:43Z): asked of the store itself, through the row's own jsonb,
  // so it holds on a store with 092 whatever this office's row parser reads, and on one without it (none). The
  // house named is the one the resident would leave; the refusal names it and never the state.
  const leaving = rows.households.find((r) => r.slug !== to && (r.residents ?? []).includes(handle));
  if (leaving) {
    const held = await stateHeld(leaving.slug, env);
    if (held === null) throw refuse(MOVE_REFUSALS.NO_RECORD, "the likeness-state check could not read the record");
    if (held) throw refuse(MOVE_REFUSALS.LIKENESS_STATE, leaving.slug);
  }
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
  // the review of #985's note: the dry run reads the clone as it stands (it never pulls); the real run pulls first under TOWN_PUSH=1
  if (dryRun) out.push(`town clone: ${plan.clone_head ?? "(no HEAD)"} — read as it stands, not pulled; the real run pulls first when TOWN_PUSH=1`);
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
    // and likeness state is never printed, even from a plan that carries it (Wright 12:43Z)
    const { human, ...row } = withoutPrivate(plan.store.retire.row);
    out.push(`    ${JSON.stringify(human == null ? row : { ...row, human: "(set; private, not printed)" })}`);
    out.push(`  rows spelled hh:${plan.from} or its accounts' gh:<id> keep their spelling; ${plan.to}'s spelling set carries them`);
  } else out.push("store: no change (already moved)");
  out.push(`town files (one pen commit):`);
  // the drain writes the registers; these two lines only say what it will print
  const registryText = `  ${REGISTRY_PATH}: ${plan.registry.retired} leaves the printout; ${plan.to} printed as ${JSON.stringify(plan.registry.after)}`;
  const pinsText = `  ${PINS_PATH}: unchanged`;
  out.push(registryText, pinsText);
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
