#!/usr/bin/env node
// town-signpost-amend — ONE amend, ever: the town's signpost `the-town/how-ideas-enter` gets its approved words
// (POS-606).
//
// ── THE RULINGS ─────────────────────────────────────────────────────────────
//
// The signpost still tells residents to plant a bounty and to publish an idea as "one mark, class: idea". The bounty
// was retired on 09-28, and the idea's road is the Think Tank's. Wright approved the new text, 128 characters
// (founder, 2026-11-03 18:06 EST, on POS-606). It names no mechanism, so it stays true whether the tank takes ideas as
// marks or as posts. Wright's scope word (2026-11-03 22:4x EST, on POS-606): one reviewed office tool that amends
// this one mark's body, writing with the town's pen the way drop-recovery does, with --dry-run / --apply, one act and
// one receipt, after checking the exact current record. It is not a general town-writing door, a new mark, a binding
// or a public actor. When it's done, it's done. It writes as the town to a constitution-tier mark, so its PR merges
// after Darko's In Review walk, and the apply follows with a dry-run receipt first (SHIPPING § 1).
//
// ── THE ROUTE ───────────────────────────────────────────────────────────────
//
// No door lets a caller act as `the-town` (POS-606, 11-04 03:30Z): `leave-mark` acts only for a key's own residents,
// and the town's pen is office-internal. So this tool calls the office's own amend, `journalLeaveMark` (world.mjs),
// the one insert behind every leave-mark and amend, with every guard that runs there. It writes as the mark's own
// author and household (`by: the-town`, household `the-town`), never through a key. The next settlement carries it
// into canon as the mark's first amend. Every version stays in the log.
//
// ── THE CHECKS, BEFORE ANYTHING ─────────────────────────────────────────────
//
// The mark in canon must be exactly the mark as it has stood since S51: kind note, by the-town, household the-town,
// tier constitution, at 258,-97, extent 3×2, and the old body byte for byte. A live declaration of it already waiting
// for the crossing refuses too. Anything else (already amended, moved, reworded, an amend pending) refuses and writes
// nothing, so a second --apply is a refusal, never a second act. Then the office's own preview runs, and --apply
// writes only when that preview says the amend publishes (§ applyGate): never a private town draft, never a stake.
//
//   node tools/town-signpost-amend.mjs --dry-run   every check and guard, and the verdict; nothing written (the
//                                                  amend's own preview)
//   node tools/town-signpost-amend.mjs --apply     the one write, and its receipt (the journal row)
//
// It runs on the box under the office service's own environment (the store, W2_PEN, WORLD_CLONE), never with a key
// a seat holds. A lane never runs --apply.

import { pathToFileURL } from "node:url";

export const MARK = "the-town/how-ideas-enter";
export const OLD_BODY = "Asking a resident? Plant a bounty here. An idea for the town? Publish it at the Think Tank — one mark, class: idea; drawn whole, a blueprint follows.";
export const NEW_BODY = "An idea for the town? Bring it to the Think Tank, where residents back it. Asking a resident for something? Write them a letter.";
export const EXPECTED = { kind: "note", by: "the-town", household: "the-town", tier: "constitution", at: { x: 258, y: -97 }, extent: { w: 3, h: 2 } };
// THE ONE SHAPE CHANGE, for Wright's word on POS-606. The record's `kind: note` is a founding-era kind with no lineage
// in today's law (world-grants.mjs § standingOf: neither sited nor a predicate), so the office's amend reads it as a
// description and asks for a parent to describe. The only declarable kind that keeps the mark where it stands is
// `sited`: the office's preview nests it under the-town/the-town-centre, as the record's placementParent already
// does, at the same path (WORLD/marks/the-town/how-ideas-enter). Everything else is the record's own.
export const DECLARED_KIND = "sited";

const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * The plan, pure. `canonMark` is the mark as canon holds it (canonForGuards().byId), `live` the town's live
 * declarations (draft or pending). Answers { clean } to amend, or { refusal } and nothing is written.
 */
export function amendPlan(canonMark, live = [], now = new Date()) {
  if (!canonMark) return { refusal: `${MARK} is not in canon; nothing written` };
  if (canonMark.body === NEW_BODY) return { refusal: `already amended: canon carries the approved text; nothing written` };
  const pending = live.find((m) => m?.id === MARK);
  if (pending) return { refusal: `a live declaration of ${MARK} is already waiting for the crossing (${pending.body === NEW_BODY ? "the approved text: already applied" : "with other words"}); nothing written` };
  const why = [];
  for (const k of ["kind", "by", "household", "tier"]) if (canonMark[k] !== EXPECTED[k]) why.push(`${k} is ${JSON.stringify(canonMark[k])}, not ${JSON.stringify(EXPECTED[k])}`);
  if (!same(canonMark.at, EXPECTED.at)) why.push(`at is ${JSON.stringify(canonMark.at)}`);
  if (!same(canonMark.extent, EXPECTED.extent)) why.push(`extent is ${JSON.stringify(canonMark.extent)}`);
  if (canonMark.body !== OLD_BODY) why.push("its body is not the one approved to be replaced");
  if (why.length) return { refusal: `the record is not the one this tool was reviewed against (${why.join("; ")}); nothing written` };
  return {
    clean: {
      slug: "how-ideas-enter", kind: DECLARED_KIND, at: { ...EXPECTED.at }, extent: { ...EXPECTED.extent }, body: NEW_BODY,
      by: EXPECTED.by, household: EXPECTED.household, date: now.toISOString(), amend: true,
    },
  };
}

/**
 * The apply's gate, pure: the one write happens only when the office's own preview says the amend publishes. A
 * draft that never reaches canon would leave the signpost unchanged behind a private town draft, and making it
 * publish (a stake from the town's ledger) is not this tool's act.
 */
export function applyGate(preview) {
  if (preview?.would !== "amend") return `the office's preview would not amend (${JSON.stringify(preview?.would ?? null)}); nothing written`;
  if (preview.put_forward !== true) return "the office's preview says the amend would stand as a private draft and not publish (no escrow behind it, and the ground is not read as the town's own); nothing written: bring the dry-run receipt to POS-606";
  return null;
}

async function main(argv) {
  const DRY = argv.includes("--dry-run"), APPLY = argv.includes("--apply");
  if (DRY === APPLY) { console.error("town-signpost-amend: pass exactly one of --dry-run or --apply"); return 2; }
  const { canonForGuards, journalLeaveMark } = await import("../src/world.mjs");
  const { guardedLiveMarks } = await import("../src/world2-guards.mjs");
  const canonMark = canonForGuards().byId.get(MARK) ?? null;
  const live = await guardedLiveMarks(null, { actor: EXPECTED.by }) // by actor: the act stores the declared household, solo:the-town;
  const plan = amendPlan(canonMark, live);
  console.log(`town-signpost-amend (POS-606), ${DRY ? "dry run" : "APPLY"}: ${MARK}`);
  console.log(`  was: ${JSON.stringify(canonMark?.body ?? null)}`);
  console.log(`  to:  ${JSON.stringify(NEW_BODY)} (${NEW_BODY.length} characters)`);
  if (plan.refusal) { console.log(`  REFUSED: ${plan.refusal}`); return 1; }
  // the preview first, always: every guard, the verdict, nothing written
  const p = await journalLeaveMark({ ...plan.clean, preview: true });
  console.log(`  preview: would ${p?.would ?? "?"}; publishes: ${p?.put_forward === true}; nests in ${p?.parent ?? "nothing"}; at ${p?.dir ?? "?"}`);
  const gate = applyGate(p);
  if (DRY) { console.log(gate ? `  an --apply would refuse: ${gate}` : "  an --apply would write it"); return 0; }
  if (gate) { console.log(`  REFUSED: ${gate}`); return 1; }
  const r = await journalLeaveMark(plan.clean);
  console.log(`  receipt: ${JSON.stringify({ id: r?.id ?? MARK, seq: r?.seq ?? null, amended: r?.amended ?? null, put_forward: r?.put_forward ?? null })}`);
  console.log("  the next settlement carries it into canon as the mark's first amend; then world #312 closes or rebases to match (Bevel)");
  return 0;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(`town-signpost-amend: ${e?.defect ?? e?.message ?? e}`); process.exit(1); });
}
