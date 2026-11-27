// move-housemate.mjs — one resident leaves a household that KEEPS its other residents; the source stays.
//
// POS-1162 (Darko, POS-448/a, 2026-11-21 14:10Z: "Yes"): the Architect, Iris, Ferry, the Registrar and the
// Worldkeeper move to the town's household, "their past acts staying recorded as Starforge's" and only their
// new acts the town's. Wright, 11-21: "Bring the dry run's output here before any real move." The five live in
// `starforge`, which keeps wright, rei, jetto-of-starforge and mari, so tools/move-resident.mjs (POS-788, one
// sole resident, the empty source retired) refuses them with NOT_EMPTY. This is the other shape.
//
//   node tools/move-housemate.mjs --handle <handle> --from <household> --to <household> --dry-run
//   node tools/move-housemate.mjs --handle <handle> --from <household> --to <household> --credential-ready "<receipt>"
//
// Run it on the box under the town lock, with the office's env (the store as the office reads it, the pen key,
// TOWN_CLONE, TOWN_PUSH) AND the owner's PG* env, the idiom move-resident.mjs and the owner's tools take:
//   . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD
// Only the store transaction connects as the owner (no pen holds the right to rewrite a household's residents
// in this shape, and the transaction refuses unless its connection is `world2_owner`). A dry run never
// connects as the owner.
//
// SCOPE (Wright, settled on POS-1162): MEMBERSHIP ONLY. Credentials stay with POS-448, under Jetto. This tool
// changes no key, token, pin or sign-in, and sets no policy about them. The dry run REPORTS, per handle and from
// non-secret metadata only, which key or sign-in it acts with and whether that is bound to the source
// (src/housemate-evidence.mjs § credentialImpact). "A meep's real move waits until POS-448 has given that meep
// its own town-attributed credential": so a real run takes no default. It refuses unless the operator names
// that receipt, per meep, with --credential-ready. The tool cannot check the receipt, so wherever it prints (the
// refusal, the output, the commit message in the town's public history) it is labelled "operator-attested, not
// verified" (Wright, 2026-11-26). The dry run never waits for it.
//
// WHAT MOVES, AND WHAT DELIBERATELY DOES NOT:
//
//   · THE STORE, in one owner transaction (src/registry-store.mjs § moveHousemateInStore): the handle leaves
//     the source's `residents` and joins the target's, and the resident's own home picture goes with them
//     (Wright: "carry it with the resident"; the printout shows a house's pictures only for its residents).
//     THE SOURCE ROW STAYS, with every other column. Nothing goes into the target's `formerly` and it gains
//     none of the source's accounts or key: THAT IS THE RULING, and it is what `movedTargetRow` and the DELETE
//     in `moveResidentInStore` would break.
//   · ROWS SPELLED IN THE SOURCE'S SET (acts, claims, marks, letters, notes) KEEP THEIR SPELLING FOR LIFE
//     (024_household_spellings.sql) and stay the source's, through the source's own spelling set
//     (src/household-deriver.mjs § houseKeysOf). The dry run counts them.
//   · THE SPELLING SETS DO NOT MOVE (Wright, within Darko's ruling, 2026-11-26: "A move never changes which
//     house a historical spelling belongs to"). The set admits `solo:` spellings through residency, so a
//     membership change could carry them. The plan computes both houses' sets from `houseKeysOf` with the real
//     pins, before and after, and names three deltas: keys leaving the source, keys joining the target, keys
//     held by both. A dry run prints them; a real run refuses SPELLINGS_MOVE unless all three are empty.
//     A mover pinned to one of the source's accounts keeps both deltas empty: the source holds its `solo:`
//     spellings through the pin road and the deriver admits none of them to the target. A mover whose pin is
//     NOT one of the source's accounts would take `solo:<handle>` and `solo:<pin login>` with them. No
//     registry field can hold them for the source (`formerly` is house slugs, read as `hh:<entry>` by the
//     office and the town), so that move is the expected named refusal (SPELLINGS_MOVE), with no write. A
//     former-key carrier would be a new shape, and only a Call adds one.
//   · THE TOWN FILES, in one pen commit: the registry drain prints tools/households.json from the store; the
//     resident's ADDRESS (and berth) `household:` line says the target's name where it said the source's name
//     or key; and the signed, dated key line `registry: <handle> = hh:<target>` goes into the stamp ledger,
//     judged first by planHouseKey (the split, the tail, the pen, and the dating rule's replay). Its
//     house-key law is one household, one key, so a target housemate not yet on `hh:<target>` gets its line in
//     the same act; the dry run names each line and whose it is.
//   · NOT CHANGED: the pin (`household_pins` carries no household), the handle, the home page, any stamp (the
//     town's own folds over the ledger are read before and after, for every account, and a difference refuses),
//     every other resident's home picture, the source's accounts, former keys, invitation credit and likeness
//     fields, any history row.
//
// RESUMABLE (as move-resident is). The store moves before the commit, so a push that cannot land leaves the
// store moved and the clone as it was. Running the same command again decides from durable facts alone: the
// store holds the handle in the target and not in the source, the source still stands, the sealed ledger does
// not yet key the handle `hh:<target>`, and a printout this clone holds shows the target standing without the
// handle while the source held them (the evidence this tool's move is the one waiting; a shallow clone may not
// reach it). It then finishes each missing step, each a no-op where already done; the key lines are planned
// from the clone's own ledger, so they are never written twice. A ledger that keys the handle to the target is
// NOT taken as the act complete on its own: a mover can be keyed `hh:<target>` before the move (a berth the
// declaration keyed, house-key.mjs § houseKeyLines), so its key line is no evidence the publication landed.
// A run refuses SAME_HOUSE only when the ledger keys them there AND nothing is left to publish: no card still
// names the source, and the clone's printout already shows them in the target and not in the source.

import { readFileSync, writeFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import { loadRegistryRows, moveHousemateInStore, movedHousemateRows } from "../src/registry-store.mjs";
import { registryFromRows, pinsFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { houseKeysOf } from "../src/household-deriver.mjs";
import { collectingDrain } from "../src/ceremony.mjs";
import { planHouseKey, appendHouseKey, registryWith, currentKeysOf, ledgerTail, LEDGER_REL } from "../src/house-key.mjs";
import { penCommit, penTransaction, landOrRefuse } from "../src/write.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { world2Enabled } from "../src/world2-acts.mjs";
import { historyCounts, credentialImpact, stampsFold, why } from "../src/housemate-evidence.mjs";
import { withHouseLine, easternDate, ledgerRegistry } from "./rekey-household.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

export const HOUSEMATE_REFUSALS = Object.freeze({
  NO_RECORD: { code: 503, defect: "the office cannot reach the town's record — nothing was written" },
  NO_PIN: { code: 404, defect: "--handle names no pinned resident" },
  NO_SOURCE: { code: 404, defect: "no household stands at --from" },
  NO_TARGET: { code: 404, defect: "no household stands at --to" },
  TARGET_IS_SOURCE: { code: 409, defect: "--to is --from: a resident cannot move to the house they are leaving" },
  NOT_IN_SOURCE: { code: 409, defect: "--handle is not a resident of --from" },
  WOULD_EMPTY: { code: 409, defect: "the move would leave --from with no resident: retiring an emptied house is move-resident.mjs's job, not this tool's" },
  SAME_HOUSE: { code: 409, defect: "--handle already lives in --to, the ledger keys them there, and nothing of a move is left to publish" },
  NO_MOVE_EVIDENCE: { code: 409, defect: "--handle lives in --to, but nothing this clone holds shows this tool's move from --from put them there — nothing was written" },
  IN_BOTH_HOUSES: { code: 409, defect: "--handle is listed in both --from and --to — a person reads the rows; nothing was written" },
  CARD_UNMATCHED: { code: 409, defect: "a card of --handle names a household that is neither --to nor --from — a person reads it; nothing was written" },
  KEY_ELSEWHERE: { code: 409, defect: "the ledger keys --handle's stamps to neither --from nor --to: the move would change which house their stamps count under in a way it does not describe — a person reads the ledger; nothing was written" },
  STAMPS_MOVE: { code: 409, defect: "the town's folds over the ledger with the planned key lines appended differ from the ledger as it stands: this move must not move a stamp — nothing was written" },
  STAMPS_UNREADABLE: { code: 503, defect: "the town's stamp folds could not be read, so the move cannot show that every balance and stake stays put — nothing was written" },
  COLLATERAL: { code: 409, defect: "printing the registry would change more than the two households — the town's files are behind the store elsewhere; run the registry drain first" },
  HOUSE_KEY: { code: 409, defect: "the house's key line cannot be written today" },
  DRAIN_REFUSED: { code: 409, defect: "the registry drain refused to print" },
  CREDENTIAL_PRECONDITION: { code: 409, defect: "a real move names the receipt that POS-448 gave this meep its own town-attributed credential (--credential-ready \"<receipt>\", operator-attested, not verified: the tool cannot check it); the dry run does not wait for it — nothing was written" },
  SPELLINGS_MOVE: { code: 409, defect: "the move would change which house a spelling belongs to (keys leaving --from, joining --to, or held by both): a move never changes which house a historical spelling belongs to, and no registry field can hold them for --from — nothing was written" },
});

/** Wherever the receipt prints: the tool takes the operator's word for it and cannot check it. */
export const ATTESTED = "operator-attested, not verified";

/**
 * THE SPELLING SETS, before and after (Wright, POS-1162, 2026-11-26). Each house's set is `houseKeysOf` over
 * the registry rows as they stand and as they will stand, with the real pins. Answers both sets for both houses
 * and the three deltas a real run refuses on: keys leaving the source, keys joining the target, keys the two
 * houses would both hold. PURE.
 */
export function spellingDelta({ before, after, from, to }) {
  const setOf = (rows, slug) => houseKeysOf(`hh:${slug}`, registryFromRows(rows), pinsFromRows(rows));
  const source = { before: setOf(before, from), after: setOf(after, from) };
  const target = { before: setOf(before, to), after: setOf(after, to) };
  const minus = (a, b) => a.filter((k) => !b.includes(k));
  const leaving_source = minus(source.before, source.after);
  const joining_target = minus(target.after, target.before);
  const held_by_both = source.after.filter((k) => target.after.includes(k));
  return { source, target, leaving_source, joining_target, held_by_both,
    empty: !leaving_source.length && !joining_target.length && !held_by_both.length };
}

const refuse = (r, detail = null) => Object.assign(new Error(r.defect), { code: r.code, defect: r.defect, detail });

const read = (clone, rel) => { try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; } };
const filesHouses = (clone) => JSON.parse(read(clone, REGISTRY_PATH) ?? "{}").households ?? {};
const gitOut = (clone, args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
const cloneHead = (clone) => { try { return gitOut(clone, ["rev-parse", "HEAD"]); } catch { return null; } };

/** How many printouts back the resume evidence looks. A drain prints at most once a crossing; 400 is months. */
export const EVIDENCE_PRINTOUTS = 400;

/**
 * The newest printout this clone holds in which the target stood WITHOUT `handle`: the clone's file first, then
 * its history of tools/households.json newest first. Answers `{ source_held: boolean, at }` for it, or null when
 * the clone holds no such printout (the handle was always the target's, or a shallow clone does not reach back).
 * Durable evidence only: never the current printout alone, because every other ceremony's drain reprints the
 * whole registry from the store and erases the source's row of a stalled move.
 */
export function printedBeforeMove(clone, { handle, from, to }) {
  const seen = (houses, at) => (houses?.[to] && !(houses[to].residents ?? []).includes(handle)
    ? { source_held: (houses[from]?.residents ?? []).includes(handle), at } : null);
  const now = seen(filesHouses(clone), "the clone's file");
  if (now) return now;
  let revs;
  try { revs = gitOut(clone, ["log", "-n", String(EVIDENCE_PRINTOUTS), "--format=%H", "--", REGISTRY_PATH]).split("\n").filter(Boolean); } catch { return null; }
  for (const rev of revs) {
    let houses;
    try { houses = JSON.parse(gitOut(clone, ["show", `${rev}:${REGISTRY_PATH}`])).households ?? {}; } catch { continue; }
    const hit = seen(houses, rev.slice(0, 10));
    if (hit) return hit;
  }
  return null;
}

// ── the plan ────────────────────────────────────────────────────────────────

const houseLineOf = (text) => /^household:[ \t]*(.*)$/m.exec(String(text ?? ""))?.[1]?.trim() ?? null;
const frontHouseLine = (text) => {
  const fm = /^(---\r?\n)([\s\S]*?)(\r?\n---)/.exec(text);
  return fm ? (/^household:[ \t]*(.*)$/m.exec(fm[2])?.[1]?.trim() ?? null) : null;
};
// The row facts a reviewer reads before and after. likeness fields are never read here, and the human's name is not a fact it needs.
const pick = (r) => ({
  residents: r.residents ?? [],
  accounts: (r.accounts ?? []).map((a) => a?.id ?? null),
  formerly: r.formerly ?? [],
  home_images: Object.keys(r.home_images ?? {}).sort(),
  invited_by: r.invited_by != null,
});

/** The first and last line a change touches, as `-`/`+` lines: a line diff of two printouts, prefix and suffix trimmed, then an LCS of the middle. */
export function lineDiff(before, after, { cap = 40 } = {}) {
  const a = String(before ?? "").split("\n");
  const b = String(after ?? "").split("\n");
  let s = 0;
  while (s < a.length && s < b.length && a[s] === b[s]) s++;
  let e = 0;
  while (e < a.length - s && e < b.length - s && a[a.length - 1 - e] === b[b.length - 1 - e]) e++;
  const x = a.slice(s, a.length - e);
  const y = b.slice(s, b.length - e);
  if (x.length * y.length > 25_000_000) return { unavailable: "the two printouts differ over too wide a span to diff here" };
  const w = y.length + 1;
  const dp = new Int32Array((x.length + 1) * w);
  for (let i = x.length - 1; i >= 0; i--)
    for (let j = y.length - 1; j >= 0; j--)
      dp[i * w + j] = x[i] === y[j] ? dp[(i + 1) * w + j + 1] + 1 : Math.max(dp[(i + 1) * w + j], dp[i * w + j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < x.length || j < y.length) {
    if (i < x.length && j < y.length && x[i] === y[j]) { i++; j++; }
    else if (i < x.length && (j === y.length || dp[(i + 1) * w + j] >= dp[i * w + j + 1])) out.push(`-${x[i++]}`);
    else out.push(`+${y[j++]}`);
  }
  return { lines: out.slice(0, cap), total: out.length, capped: out.length > cap };
}

/** Where the new line(s) would land in the ledger: after which entry, at which physical lines. Reads only. */
export function ledgerLanding(clone, count) {
  const text = read(clone, LEDGER_REL);
  if (text == null) return null;
  const lines = text.replace(/\s*$/, "").split("\n");
  const entries = lines.filter((l) => /^- \d{4}-\d{2}-\d{2} · /.test(l));
  // the tail the dating rule reads is the NEWEST date on the ledger (house-key.mjs § ledgerTail), not the last line's
  return { file: LEDGER_REL, after_entry: entries.length, tail_dated: ledgerTail(text), first_line: lines.length + 1, last_line: lines.length + count };
}

/**
 * Everything the move would change, decided from the store's rows and the clone as they stand. Reads only; throws
 * a named refusal. `keyPlan` (planHouseKey), `stamps` (the town's folds) and `currentKeys` are injected in test.
 */
export async function planHousemate({ handle, from, to, rows, clone, date, keyPlan = planHouseKey, stamps = stampsFold, currentKeys = currentKeysOf }) {
  if (!(rows.pins ?? []).some((p) => p.handle === handle)) throw refuse(HOUSEMATE_REFUSALS.NO_PIN, handle);
  const byslug = new Map(rows.households.map((r) => [r.slug, r]));
  const source = byslug.get(from);
  if (!source) {
    const wore = rows.households.find((r) => (r.formerly ?? []).includes(from));
    throw refuse(HOUSEMATE_REFUSALS.NO_SOURCE, wore ? `${from} is a former key of ${wore.slug}` : from);
  }
  const target = byslug.get(to);
  if (!target) {
    const wore = rows.households.find((r) => (r.formerly ?? []).includes(to));
    throw refuse(HOUSEMATE_REFUSALS.NO_TARGET, wore ? `${to} is a former key of ${wore.slug}` : to);
  }
  if (from === to) throw refuse(HOUSEMATE_REFUSALS.TARGET_IS_SOURCE, from);
  const files = filesHouses(clone);
  const ledgerText = read(clone, LEDGER_REL);

  // RESUMING is decided from DURABLE facts only: the store says the handle is in the target, the sealed ledger and
  // the clone's own files say what landed. Never the current printout alone (see printedBeforeMove).
  const resuming = (target.residents ?? []).includes(handle);
  if (resuming) {
    const sealed = ledgerRegistry(ledgerText).latest.get(handle) ?? null;
    // A key line to the target is not the act complete: the mover may have been keyed there before the move.
    // Done means nothing is left to publish: no card still names the source, and the printout has them home.
    if (sealed === `hh:${to}`) {
      const named = [source.name, from].filter(Boolean).map((v) => String(v).trim());
      const staleCards = [`WHITE_PAGES/${handle}/ADDRESS.md`, `HARBOR/berths/${handle}.md`]
        .filter((rel) => { const said = frontHouseLine(read(clone, rel) ?? ""); return said != null && named.includes(said); });
      const printedHome = (files[to]?.residents ?? []).includes(handle) && !(files[from]?.residents ?? []).includes(handle);
      if (!staleCards.length && printedHome) throw refuse(HOUSEMATE_REFUSALS.SAME_HOUSE, `${handle} lives in ${to}, the ledger keys them there, and the clone's cards and printout already say so`);
    }
    if ((source.residents ?? []).includes(handle)) throw refuse(HOUSEMATE_REFUSALS.IN_BOTH_HOUSES, `${handle}: ${from} and ${to}`);
    const proven = printedBeforeMove(clone, { handle, from, to });
    if (!proven?.source_held)
      throw refuse(HOUSEMATE_REFUSALS.NO_MOVE_EVIDENCE, `${handle} lives in ${to}; the ledger keys them ${sealed ?? "under their human's account"}; `
        + (proven ? `the newest printout that shows ${to} without them shows them outside ${from} too` : `no printout this clone holds shows ${to} standing without them (a shallow clone may not reach it)`));
  } else {
    if (!(source.residents ?? []).includes(handle)) throw refuse(HOUSEMATE_REFUSALS.NOT_IN_SOURCE, `${from}: ${(source.residents ?? []).join(", ") || "no residents"}`);
    if ((source.residents ?? []).length < 2) throw refuse(HOUSEMATE_REFUSALS.WOULD_EMPTY, `${from}: ${source.residents.join(", ")}`);
  }

  // STAMPS FOLLOW THE HANDLE'S OWN KEY: if the ledger keys the handle to some house that is neither of these two, the key
  // line this move signs would change which house their stamps count under without saying so.
  const sourceKeys = new Set([`hh:${from}`, ...(source.formerly ?? []).map((f) => `hh:${String(f).replace(/^hh:/, "")}`),
    ...(source.accounts ?? []).filter((a) => a?.id != null).map((a) => `gh:${a.id}`)]);
  const standing = ledgerText == null ? null : (currentKeys(clone).get(handle) ?? null);
  if (standing != null && !sourceKeys.has(standing) && standing !== `hh:${to}`)
    throw refuse(HOUSEMATE_REFUSALS.KEY_ELSEWHERE, `${handle} is keyed ${standing}; ${from}'s spellings are ${[...sourceKeys].join(", ")}`);

  // The two rows as they will stand: the membership of each, and nothing else.
  const moved = movedHousemateRows({ handle, source, target });
  const after = resuming ? rows : {
    ...rows,
    households: rows.households.map((r) => (r.slug === from ? { ...r, ...moved.source } : r.slug === to ? { ...r, ...moved.target } : r)),
  };
  const targetAfter = after.households.find((r) => r.slug === to);

  // THE SPELLING SETS (see the header). "Before" is the store as it stood before the move: on a resume the store
  // has already moved, so it is the two memberships put back.
  const unmoved = !resuming ? rows : {
    ...rows,
    households: rows.households.map((r) => (r.slug === from ? { ...r, residents: [...(r.residents ?? []), handle] }
      : r.slug === to ? { ...r, residents: (r.residents ?? []).filter((h) => h !== handle) } : r)),
  };
  const spellings = spellingDelta({ before: unmoved, after, from, to });

  // COLLATERAL (rekey-household's rule): what the drain would print may differ from the town's files only in the two households.
  const printed = renderPublicRegistry(after);
  const printedHouses = JSON.parse(printed.households).households ?? {};
  const changed = [];
  for (const k of new Set([...Object.keys(files), ...Object.keys(printedHouses)])) {
    if (k === from || k === to) continue;
    if (JSON.stringify(files[k]) !== JSON.stringify(printedHouses[k])) changed.push(k);
  }
  // (read here, never written: the drain is the registers' one writer, test/registry-no-file-writer.test.mjs)
  const pinsBehind = (read(clone, PINS_PATH) ?? "") !== printed.pins;
  if (pinsBehind) changed.push("tools/github-ids.json");
  if (changed.length) throw refuse(HOUSEMATE_REFUSALS.COLLATERAL, changed.slice(0, 8).join(", ") + (changed.length > 8 ? `, +${changed.length - 8} more` : ""));

  // The resident's card and berth, where they named the source by name or key.
  const oldValues = [source.name, from].filter(Boolean).map((v) => String(v).trim());
  const name = targetAfter.name ?? to;
  const cards = [];
  for (const rel of [`WHITE_PAGES/${handle}/ADDRESS.md`, `HARBOR/berths/${handle}.md`]) {
    const text = read(clone, rel);
    // A RESUMED CARD MUST BE MATCHABLE: a `household:` line naming neither house would be left stale while the key line marks the act complete.
    const said = text == null ? null : frontHouseLine(text);
    if (resuming && said != null && said !== name && !oldValues.includes(said))
      throw refuse(HOUSEMATE_REFUSALS.CARD_UNMATCHED, `${rel}: household: ${said}`);
    const next = text == null ? null : withHouseLine(text, { oldValues, name });
    if (next != null && next !== text) cards.push({ path: rel, before: houseLineOf(text), after: houseLineOf(next), content: next });
  }

  // THE KEY, judged before any write (planHouseKey: the split, the tail, the pen, the replay).
  const residentsAfter = [...new Set([...(targetAfter.residents ?? []), handle])];
  const keyed = keyPlan(clone, [{ handle, slug: to, residents: residentsAfter }],
    { date, registry: registryWith(registryFromRows(after), to, residentsAfter) });
  if (keyed?.refusal) throw refuse(HOUSEMATE_REFUSALS.HOUSE_KEY, `${keyed.refusal.defect}${keyed.detail ? ` — ${keyed.detail}` : ""}`);
  const lines = (keyed?.lines ?? []).map((l) => ({ handle: l.handle, line: l.line, role: l.handle === handle ? "the mover" : "a housemate of the target, one household one key" }));

  // NO STAMP MOVES: the town's own folds, every account, with the signed lines appended in memory.
  const folds = await stamps(clone, { signed: keyed?.signed ?? [], handle });
  if (folds.unavailable == null && folds.unchanged === false) throw refuse(HOUSEMATE_REFUSALS.STAMPS_MOVE, `${handle}: balance ${folds.balance.before} -> ${folds.balance.after}, staked ${folds.staked.before} -> ${folds.staked.after}`);

  return {
    handle, from, to, resuming, date, clone_head: cloneHead(clone),
    pin: { handle, untouched: true },
    store: resuming ? null : {
      source: { slug: from, before: pick(source), after: pick({ ...source, ...moved.source }) },
      target: { slug: to, before: pick(target), after: pick({ ...target, ...moved.target }) },
    },
    registry: {
      source: { before: files[from] ?? null, after: printedHouses[from] ?? null },
      target: { before: files[to] ?? null, after: printedHouses[to] ?? null },
      diff: lineDiff(read(clone, REGISTRY_PATH), printed.households),
      // The public printout lists a house's home pictures only for its CURRENT residents (registry-public.mjs § publicHomeImages),
      // so the picture is carried with the resident; say plainly whether the printed file keeps showing it.
      home_picture_printed: {
        before: [files[from], files[to]].some((h) => h?.home_images?.[handle] != null),
        after: [printedHouses[from], printedHouses[to]].some((h) => h?.home_images?.[handle] != null),
      },
    },
    cards,
    ledger: { lines, signed: keyed?.signed ?? [], checked: keyed?.replay?.checked ?? null, landing: lines.length ? ledgerLanding(clone, lines.length) : null },
    stamps: folds,
    spellings,
    home_picture: resuming
      ? ((target.home_images ?? {})[handle] != null ? `on ${to}'s row (the store has moved)` : "none set")
      : (source.home_images?.[handle] != null ? `set; it leaves ${from}'s row and goes with ${handle} to ${to}'s` : "none set"),
    stays_with_source: {
      invite_credit: source.invited_by != null ? "the source carries one (stays on the source's row)" : "none on the source",
      likeness: "not read, not changed (a separate follow-up)",
      accounts: `${(source.accounts ?? []).length} account(s) on the source row, all kept`,
    },
  };
}

// ── the evidence a dry run adds (reads only) ────────────────────────────────

/** The office's read pool for the dry run's counts: `office_api`, one connection. Null when the office is not pointed at the record. */
export async function openEvidence(env = process.env) {
  if (!world2Enabled(env)) return null;
  const { default: pg } = await import("pg");
  const { storePoolOptions, watchPoolErrors } = await import("../src/store-pool.mjs");
  const pool = watchPoolErrors(new pg.Pool(storePoolOptions(env, { name: "housemate-evidence", max: 1 })), "housemate-evidence");
  return { pool, close: () => pool.end() };
}

async function evidenceFor({ handle, from, to, rows, env, open }) {
  let held = null;
  try { held = await open(env); } catch (e) { held = { error: why(e) }; }
  if (!held || held.error) {
    const reason = held?.error ?? "the office is not pointed at the record";
    return { history: { unavailable: reason }, credentials: { handle, unavailable: reason } };
  }
  try {
    return {
      history: await historyCounts({ pool: held.pool, handle, from }),
      credentials: await credentialImpact({ pool: held.pool, handle, from, to, rows }),
    };
  } finally { try { await held.close(); } catch { /* a pool that will not close has no transaction open */ } }
}

// ── the act ─────────────────────────────────────────────────────────────────

/**
 * Plan, and unless `dryRun`, do it: the owner's store transaction, then the printed registers, the card lines and the
 * signed key line(s), in one pen commit. A dry run returns the plan and the evidence and calls no writer.
 * `owner` connects the owner's client (the real run only); `move`, `drainWith`, `commit` and `open` are injected in test.
 */
export async function moveHousemate({ handle, from, to, clone, env = process.env, date = easternDate(), dryRun = false, credentialReady = null,
  keyPlan = planHouseKey, stamps = stampsFold, currentKeys = currentKeysOf, owner = ownerClient, move = moveHousemateInStore,
  drainWith = collectingDrain, commit = penCommit, open = openEvidence } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null) throw refuse(HOUSEMATE_REFUSALS.NO_RECORD);
  const plan = await planHousemate({ handle, from, to, rows, clone, date, keyPlan, stamps, currentKeys });
  if (dryRun) return { dryRun: true, plan, evidence: await evidenceFor({ handle, from, to, rows, env, open }) };

  // A SPELLING MOVES WITH NO MOVE (Wright, POS-1162): a real run goes ahead only when all three deltas are empty.
  const S = plan.spellings;
  if (!S.empty) throw refuse(HOUSEMATE_REFUSALS.SPELLINGS_MOVE,
    `leaving ${from}: ${S.leaving_source.join(", ") || "none"}; joining ${to}: ${S.joining_target.join(", ") || "none"}; held by both: ${S.held_by_both.join(", ") || "none"}`);

  // A REAL MOVE TAKES NO DEFAULT (Wright, POS-1162): the receipt that this meep has its own town-attributed key is named per move.
  const receipt = String(credentialReady ?? "").trim();
  if (!receipt || /[\r\n]/.test(receipt)) throw refuse(HOUSEMATE_REFUSALS.CREDENTIAL_PRECONDITION);
  if (plan.stamps.unavailable != null) throw refuse(HOUSEMATE_REFUSALS.STAMPS_UNREADABLE, plan.stamps.unavailable);

  if (!plan.resuming) {
    const client = await owner(env);
    try { await move(client, { handle, from, to }); }
    finally { try { await client.end(); } catch { /* a client that will not close still committed or rolled back */ } }
  }

  const paths = [];
  for (const c of plan.cards) { writeFileSync(join(clone, c.path), c.content); paths.push(join(clone, c.path)); }
  const { drain, paths: printed } = drainWith({ clone, env });
  const drained = await drain({ note: `POS-1162: ${handle} moved from ${from} to ${to}; ${from} stays` });
  if (drained?.refused) throw refuse(HOUSEMATE_REFUSALS.DRAIN_REFUSED, drained.refused);
  paths.push(...printed);
  const ledger = appendHouseKey(clone, plan.ledger.signed);
  if (ledger) paths.push(ledger);

  const sha = landOrRefuse(() => commit(clone, paths,
    `registry: ${handle} moves from ${from} to ${to} · ${from} stays — the pin and past acts unchanged (via postmark-office, move-housemate, POS-1162; credential receipt, ${ATTESTED}: ${receipt.slice(0, 120)})`));
  if (sha?.error) throw Object.assign(new Error(sha.error.defect), sha.error, { detail: "the store has moved; run the same command again to publish" });
  return { dryRun: false, plan, commit: sha, receipt };
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

const row = (label, v) => `    ${label.padEnd(12)}${JSON.stringify(v)}`;
const countLine = (name, c) => {
  if (c?.unavailable != null) return `  ${name}: UNAVAILABLE — ${c.unavailable}`;
  const sp = Object.entries(c.by_spelling).sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k} ${n}`).join(", ") || "none";
  const kinds = c.by_kind ? `; by kind ${JSON.stringify(c.by_kind)}` : "";
  const out = c.outside_source_set == null ? "" : `; spelled outside the source's set: ${c.outside_source_set}`;
  return `  ${name}: ${c.in_source_set} spelled in the source's set (${sp})${kinds}${out} [scope: ${c.scope}]`;
};

/** What the plan touches, every row and file, in plain lines. */
export function describe(plan, { dryRun, evidence = null, receipt = null }) {
  const out = [];
  out.push(`${dryRun ? "DRY RUN — nothing written." : "MOVED."}${plan.resuming ? " (resuming: the store had already moved)" : ""}`);
  out.push(`resident: ${plan.handle}  ·  from: ${plan.from} (stays)  ·  to: ${plan.to}  ·  date: ${plan.date}`);
  if (dryRun) out.push(`town clone: ${plan.clone_head ?? "(no HEAD)"} — read as it stands, not pulled; the real run pulls first when TOWN_PUSH=1`);
  out.push(`pin: household_pins ${plan.handle} — unchanged (handle, login and GitHub id stay bound)`);
  out.push("1. STORE ROWS (one transaction, as world2_owner; the source row is kept and nothing is deleted):");
  if (plan.store) {
    for (const k of ["source", "target"]) {
      const { slug, before, after } = plan.store[k];
      out.push(`  UPDATE households ${slug} (${k}):`);
      out.push(row("residents", before.residents) + ` -> ${JSON.stringify(after.residents)}`);
      for (const f of ["accounts", "formerly", "home_images", "invited_by"])
        out.push(row(f, before[f]) + (JSON.stringify(before[f]) === JSON.stringify(after[f]) ? "  (unchanged)" : ` -> ${JSON.stringify(after[f])}  <-- CHANGED`));
    }
    out.push(`  nothing goes into ${plan.to}'s formerly, and ${plan.to} gains none of ${plan.from}'s accounts or key; only ${plan.handle}'s own home picture goes with them`);
  } else out.push("  no change (already moved)");
  out.push("2. TOWN FILES (one pen commit):");
  const registryText = `  ${REGISTRY_PATH}: the drain prints ${plan.from} residents ${JSON.stringify(plan.registry.source.before?.residents ?? null)} -> ${JSON.stringify(plan.registry.source.after?.residents ?? null)}, ${plan.to} residents ${JSON.stringify(plan.registry.target.before?.residents ?? null)} -> ${JSON.stringify(plan.registry.target.after?.residents ?? null)}; exact lines:`;
  const pinsText = `  ${PINS_PATH}: unchanged`;
  out.push(registryText);
  const d = plan.registry.diff;
  if (d.unavailable) out.push(`    UNAVAILABLE — ${d.unavailable}`);
  else { for (const l of d.lines) out.push(`    ${l}`); if (d.capped) out.push(`    … ${d.total - d.lines.length} more`); }
  const pic = plan.registry.home_picture_printed;
  out.push(`  ${plan.handle}'s home picture in the printout: ${pic.before ? "printed" : "not printed"} today, ${pic.after ? "printed" : "not printed"} after${pic.after ? ` (under ${plan.to})` : ""}`);
  if (pic.before && !pic.after)
    out.push(`  NOTE: ${plan.handle}'s home picture is printed today and is NOT printed after the move`);
  out.push(pinsText);
  for (const c of plan.cards) out.push(`  ${c.path}: household: ${c.before} -> ${c.after}`);
  if (!plan.cards.length) out.push("  no card line to change");
  out.push("3. THE LEDGER LINE(S):");
  if (plan.ledger.lines.length) {
    const L = plan.ledger.landing;
    out.push(`  ${LEDGER_REL}: append ${plan.ledger.lines.length} signed line(s), dated ${plan.date} (US Eastern, never before the ledger's tail; dating rule: ${plan.ledger.checked ?? "n/a"})`);
    if (L) out.push(`  lands after entry ${L.after_entry} (the ledger's newest date is ${L.tail_dated ?? "n/a"}), at lines ${L.first_line} to ${L.last_line}`);
    for (const l of plan.ledger.lines) out.push(`    ${l.line} · sig: <the office pen>   (${l.role})`);
  } else out.push(`  ${LEDGER_REL}: no line (the clone's ledger already keys the house)`);
  out.push("4. WHAT DOES NOT CARRY OVER:");
  out.push(`  rows keep their spelling for life, and a row spelled in ${plan.from}'s set stays ${plan.from}'s while the set holds that spelling:`);
  const sp = plan.spellings;
  const keys = (l) => (l.length ? l.join(", ") : "none");
  out.push(`  ${plan.from}'s spelling set before: ${keys(sp.source.before)}`);
  out.push(`  ${plan.from}'s spelling set after:  ${keys(sp.source.after)}`);
  out.push(`  ${plan.to}'s spelling set before: ${keys(sp.target.before)}`);
  out.push(`  ${plan.to}'s spelling set after:  ${keys(sp.target.after)}`);
  out.push(`  keys leaving ${plan.from}: ${keys(sp.leaving_source)}`);
  out.push(`  keys joining ${plan.to}: ${keys(sp.joining_target)}`);
  out.push(`  keys held by both: ${keys(sp.held_by_both)}`);
  out.push(sp.empty
    ? "  all three are empty: no spelling changes house (household-deriver.mjs § houseKeysOf, with the real pins)"
    : `  NOT EMPTY: a real run refuses SPELLINGS_MOVE, writing nothing. No registry field can hold these for ${plan.from} (formerly is house slugs), so this tool does not move this resident`);
  const h = evidence?.history;
  if (!h) out.push("  (history counts are taken by the dry run, not by a real run)");
  else if (h.unavailable != null) out.push(`  history counts: UNAVAILABLE — ${h.unavailable}`);
  else {
    out.push(`  the source's spelling set: ${h.spelling_set.join(", ")}`);
    for (const [name, c] of Object.entries(h.tables)) out.push(countLine(name, c));
    if (h.ground.unavailable != null) out.push(`  ground, parcels and homes the resident owns: UNAVAILABLE — ${h.ground.unavailable}`);
    else out.push(`  ground, parcels and homes the resident owns: ${h.ground.count}${h.ground.slugs.length ? ` (${h.ground.slugs.join(", ")}${h.ground.capped ? ", …" : ""})` : ""} — spelled as they were, unchanged`);
  }
  out.push(`  ${plan.handle}'s home picture: ${plan.home_picture}`);
  out.push(`  invitation credit: ${plan.stays_with_source.invite_credit}`);
  out.push(`  likeness: ${plan.stays_with_source.likeness}`);
  out.push(`  accounts: ${plan.stays_with_source.accounts}`);
  const s = plan.stamps;
  if (s.unavailable != null) out.push(`  balance and stake: UNAVAILABLE — ${s.unavailable} (not "unchanged"; a real run refuses)`);
  else out.push(`  balance ${s.balance.before} -> ${s.balance.after}, staked ${s.staked.before} -> ${s.staked.after}; every account's balance and stake ${s.unchanged ? "unchanged" : "CHANGED"} by the planned lines (the town's own folds)`);
  out.push("5. CREDENTIAL IMPACT (non-secret metadata only; this tool changes no credential, POS-448 does):");
  const c = evidence?.credentials;
  if (!c) out.push("  (the credential report is taken by the dry run)");
  else if (c.unavailable != null) out.push(`  UNAVAILABLE — ${c.unavailable}`);
  else {
    const si = c.sign_in;
    out.push(si.pinned_account
      ? `  sign-in: pinned to ${si.pinned_account.login ?? "(no login)"} (GitHub id ${si.pinned_account.id}); that account is listed by ${plan.from}: ${si.listed_in_source}, by ${plan.to}: ${si.listed_in_target}`
      : "  sign-in: no pinned account");
    if (c.static_keys.unavailable != null) out.push(`  static keys naming ${plan.handle}: UNAVAILABLE — ${c.static_keys.unavailable}`);
    else {
      out.push(`  static keys naming ${plan.handle}: ${c.static_keys.count}`);
      for (const k of c.static_keys.keys) out.push(`    household ${k.household}: bound to ${plan.from}: ${k.bound_to_source}, to ${plan.to}: ${k.bound_to_target}`);
    }
    if (c.live_sign_in_keys.unavailable != null) out.push(`  live sign-in keys held by the pinned account: UNAVAILABLE — ${c.live_sign_in_keys.unavailable}`);
    else out.push(`  live sign-in keys held by the pinned account: ${c.live_sign_in_keys.by_kind ? JSON.stringify(c.live_sign_in_keys.by_kind) : c.live_sign_in_keys.note}`);
    out.push(`  harness keys: UNAVAILABLE — ${c.harness_keys.unavailable}`);
    out.push(`  bound to ${plan.from}: ${c.bound_to_source}${c.bound_to_source === "unknown" ? " (nothing read says yes, and a key the harness holds cannot be read)" : ""}`);
  }
  out.push(`  a real move waits, per meep, for POS-448 to give it its own town-attributed credential, and is run with --credential-ready "<receipt>" (${ATTESTED}: the tool cannot check it)`);
  if (receipt) out.push(`  credential receipt (${ATTESTED}): ${receipt.slice(0, 120)}`);
  out.push("not changed: the handle, the home page, stamps, the pin, any history row. The office's house caches renew within a minute.");
  return out.join("\n");
}

export async function main(argv = process.argv.slice(2), { env = process.env, log = console.log, err = console.error, act = moveHousemate } = {}) {
  const handle = arg("--handle", argv), from = arg("--from", argv), to = arg("--to", argv);
  if (!handle || !from || !to) { err("move-housemate: --handle <handle> --from <household> --to <household> are required ([--dry-run] [--credential-ready \"<receipt>\"])"); return 2; }
  const clone = env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");
  const dryRun = argv.includes("--dry-run");
  const credentialReady = arg("--credential-ready", argv);
  try {
    const out = await penTransaction(clone, async () => {
      if (!dryRun && env.TOWN_PUSH === "1") execFileSync("git", ["-C", clone, "pull", "--rebase", "-q"], { encoding: "utf8" });
      try { return await act({ handle, from, to, clone, env, dryRun, credentialReady }); }
      catch (e) {
        if (typeof e?.code !== "number") throw e;
        return { error: { code: e.code, defect: e.defect ?? String(e.message), detail: e.detail ?? null } };
      }
    });
    if (out?.error) { err(`move-housemate: REFUSED — ${out.error.defect}${out.error.detail ? ` (${out.error.detail})` : ""}`); return 1; }
    log(describe(out.plan, out));
    if (out.commit) log(`commit: ${out.commit}`);
    return 0;
  } catch (e) {
    err(`move-housemate: tripped — ${String(e?.stack ?? e).slice(0, 600)}`);
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
