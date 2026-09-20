// parcel-cap.test.mjs — THE CLEARING ASKS THE CAP THE SWEEP ASKS.
//
// ── THE INSTANCE (POS-98, S71) ──────────────────────────────────────────────
//
// Window 191 closed at 2026-09-15T17:45:46.821Z and LOCKED
// `mari/marigold-house-parcel`. The sweep, minutes later, refused it: the cap
// counts per credential household, Mari's resolves to the founder's, and that
// one held five. Measured on the box, the store has been carrying the parcel
// forward ever since — "CARRIED 1 canon-absent mark(s) from earlier window(s):
// mari/marigold-house-parcel" at windows 192, 193 and 194.
//
// ── WHAT THESE FALSIFIERS ARE FOR ───────────────────────────────────────────
//
// The claim under test is not "there is a cap gate" — it is "it is THE SAME cap,
// by the same rule, read from the world and never copied". So the sharpest ones
// here are the two that would go red on a COPY that behaved identically today:
//
//   · the law object identity — the exceptions Map this gate consults must be
//     the very Map the world exports, not an equal one;
//   · the sentence — composed here from the world's three constants, and held
//     against the fold's OWN template literal, read out of the world's source.
//     `marks-fold.mjs` composes that sentence inline at BOTH of its cap sites
//     and exports no function for it, so this side is a third holder of one
//     sentence. This test is what makes that seam loud instead of silent.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { WORLD_CLONE } from "../src/world-store.mjs";
import {
  PARCEL_CAP_CHECK, parcelCapCheck, parcelCapLawAt, parcelCapRefusals, parcelCapLines,
} from "../world2/tools/parcel-cap.mjs";
import { checkNameOf, causeOf, CAUSE_WORDS } from "../src/mark-receipt.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const law = await parcelCapLawAt(WORLD_CLONE);
const FOLD_SRC = readFileSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"), "utf8");

/** The founder's household in the live registry — five parcels before Mari's. */
const FOUNDER = "starforge";
const MARI = "mari/marigold-house-parcel";

const parcel = (slug, cred, date, over = {}) => ({ id: slug, slug, cred, date, amending: false, ...over });

test("THE LAW IS THE WORLD'S OWN OBJECT, not an equal copy of it", async () => {
  const mod = await import(pathToFileURL(join(WORLD_CLONE, "tools", "marks-fold.mjs")).href);
  assert.equal(law.cap, mod.PARCEL_CLAIM_CAP);
  assert.equal(law.lawDate, mod.PARCEL_CAP_LAW_DATE);
  // IDENTITY, not deepEqual. A copied Map would pass an equality check today and
  // stop matching the world the first time the founder grants an exception —
  // which is exactly the drift this gate exists to prevent, so it is the thing
  // asserted rather than the behaviour that follows from it.
  assert.equal(law.exceptions, mod.PARCEL_CAP_EXCEPTIONS, "the exceptions map must BE the world's, not resemble it");
  assert.equal(law.compare, mod.compareClaimOrder, "claim order is a ruling of the world's, not a sort of ours");
  assert.match(law.sha, /^[0-9a-f]{40}$/, "a refusal must be able to name the law it refused against");
});

test("THE SENTENCE MATCHES THE FOLD'S OWN TEMPLATE, read out of the world's source", () => {
  // Both of the fold's cap sites compose this inline. Extract the literal and
  // substitute what the fold would substitute, then compare to what this side
  // composes. Re-wording either holder turns this red.
  const literals = [...FOLD_SRC.matchAll(/`parcel claim capped[^`]*`/g)].map((m) => m[0]);
  assert.ok(literals.length >= 2,
    `expected the fold's two cap sites to carry the sentence; found ${literals.length}`);
  assert.equal(new Set(literals).size, 1,
    "the fold's own two holders have drifted from each other — that is the world's to repair before this side mirrors either");

  const rendered = literals[0]
    .slice(1, -1)
    .replaceAll("${held}", "5")
    .replaceAll("${PARCEL_CLAIM_CAP}", String(law.cap))
    .replaceAll("${PARCEL_CAP_LAW_DATE}", law.lawDate);
  assert.equal(rendered.includes("${"), false, "an unsubstituted placeholder means the fold's template grew a field this test does not bind");
  assert.equal(parcelCapCheck(MARI, 5, law), `${PARCEL_CAP_CHECK}: ${MARI} — ${rendered}`);
});

test("THE BRIEF'S FALSIFIER: a household at the cap claiming a fourth parcel is refused, with the cap's sentence", () => {
  const v = parcelCapRefusals([parcel("someone/the-fourth-parcel", "a-house", "2026-09-15")],
    { heldByCred: new Map([["a-house", law.cap]]), law });
  assert.equal(v.refused.length, 1);
  assert.equal(v.admitted.length, 0);
  const [r] = v.refused;
  assert.equal(r.slug, "someone/the-fourth-parcel");
  assert.equal(r.held, law.cap);
  assert.match(r.check, /^parcel-cap: someone\/the-fourth-parcel — parcel claim capped —/);
  assert.match(r.check, new RegExp(`cap ${law.cap} per household, ruled ${law.lawDate}`));
  assert.equal(checkNameOf(r.check), PARCEL_CAP_CHECK, "the docket splits the check name off the first colon");
});

test("THE BRIEF'S CONTROL: a household under the cap is admitted exactly as today", () => {
  const v = parcelCapRefusals([parcel("someone/a-second-parcel", "a-house", "2026-09-15")],
    { heldByCred: new Map([["a-house", law.cap - 1]]), law });
  assert.deepEqual(v.refused, []);
  assert.equal(v.admitted.length, 1);
  assert.equal(v.admitted[0].excepted, false);
});

test("THE BRIEF'S CONTROL: an amendment of a held parcel is admitted (POS-88's law)", () => {
  const v = parcelCapRefusals(
    [parcel("someone/the-moved-parcel", "a-house", "2026-09-15", { amending: true })],
    { heldByCred: new Map([["a-house", law.cap + 2]]), law });
  assert.deepEqual(v.refused, [], "a relocation is a replacement, not a second claim — marks-fold.mjs's own !mk._replacing");
  assert.equal(v.admitted[0].amending, true);
});

test("prior estate stands: a claim dated on or before the law date is never refused", () => {
  const onTheDay = parcelCapRefusals([parcel("someone/prior", "a-house", law.lawDate)],
    { heldByCred: new Map([["a-house", law.cap + 4]]), law });
  assert.deepEqual(onTheDay.refused, [], "the fold compares strictly greater-than, so the law date itself is prior estate");

  const undated = parcelCapRefusals([parcel("someone/undated", "a-house", null)],
    { heldByCred: new Map([["a-house", law.cap + 4]]), law });
  assert.deepEqual(undated.refused, [],
    "an absent date is not post-law in the fold, and a gate stricter than the law it ports is a different law");
});

test("THE INSTANCE, BOTH WAYS: Mari's parcel is excepted, and the household's NEXT claim is still refused", () => {
  assert.equal(law.exceptions.has(MARI), true,
    "the world half of POS-98 is merged; if this is false the exception was reverted and the rest of this test is about a different world");

  const held = new Map([[FOUNDER, 5]]);
  const hers = parcelCapRefusals([parcel(MARI, FOUNDER, "2026-09-14")], { heldByCred: held, law });
  assert.deepEqual(hers.refused, [], "the founder's word admits it at the candle exactly as it does at the fold");
  assert.equal(hers.admitted[0].excepted, true);

  // And the exception does not soften the forward law: `held` still counts it.
  const next = parcelCapRefusals(
    [parcel(MARI, FOUNDER, "2026-09-14"), parcel("someone-else/a-new-parcel", FOUNDER, "2026-09-16")],
    { heldByCred: held, law });
  assert.deepEqual(next.refused.map((r) => r.slug), ["someone-else/a-new-parcel"]);
  assert.equal(next.refused[0].held, 6, "Mari's admitted parcel raised the count, as deva's entry says it must");
});

test("several claims in one window meet the cap IN THE WORLD'S CLAIM ORDER, not the docket's", () => {
  // Handed to the gate newest-first on purpose: if it judged arrival order the
  // EARLIER claim would be the one refused, which is the defect
  // `parcelsInClaimOrder` was written to end — "a resident's ground is not a
  // thing that may flicker".
  const v = parcelCapRefusals([
    parcel("h/late", "a-house", "2026-09-16"),
    parcel("h/early", "a-house", "2026-09-10"),
  ], { heldByCred: new Map([["a-house", law.cap - 1]]), law });
  assert.deepEqual(v.admitted.map((a) => a.slug), ["h/early"]);
  assert.deepEqual(v.refused.map((r) => r.slug), ["h/late"]);
});

test("a household's headroom is spent by its OWN claims and nobody else's", () => {
  const v = parcelCapRefusals([
    parcel("a/one", "house-a", "2026-09-15"),
    parcel("b/one", "house-b", "2026-09-15"),
  ], { heldByCred: new Map([["house-a", law.cap], ["house-b", 0]]), law });
  assert.deepEqual(v.refused.map((r) => r.slug), ["a/one"]);
  assert.deepEqual(v.admitted.map((a) => a.slug), ["b/one"]);
});

test("A CHECKOUT THAT CANNOT ANSWER THROWS — it never falls back to a permissive cap", async () => {
  // An empty exceptions map is not "no exceptions granted"; it is the founder's
  // five rulings missing, and it would refuse Mari's parcel again on the
  // quietest possible code path.
  await assert.rejects(() => parcelCapLawAt(null), /no world checkout/);
  await assert.rejects(() => parcelCapLawAt(join(WORLD_CLONE, "does-not-exist")), /no world checkout/);

  // A directory that EXISTS and is not a world checkout — the shape a mistyped
  // argument actually takes, and the one a permissive gate would run over.
  const dir = mkdtempSync(join(tmpdir(), "not-a-world-"));
  try {
    await assert.rejects(() => parcelCapLawAt(dir), /no tools\/marks-fold\.mjs/);
    // …and one with the file's PATH but nothing behind it stops at HEAD rather
    // than importing whatever happens to be there.
    mkdirSync(join(dir, "tools"), { recursive: true });
    readFileSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));   // prove the source exists before copying its name
    await assert.rejects(() => parcelCapLawAt(dir), /no tools\/marks-fold\.mjs|cannot read HEAD/);
  } finally { rmSync(dir, { recursive: true, force: true }); }

  assert.throws(() => parcelCapRefusals([], {}), /never supplies a default/);
});

test("the operator lines name the refusals and spend the exceptions out loud", () => {
  const v = parcelCapRefusals([
    parcel("h/refused", "a-house", "2026-09-16"),
    parcel(MARI, FOUNDER, "2026-09-14"),
  ], { heldByCred: new Map([["a-house", law.cap], [FOUNDER, 5]]), law });
  const lines = parcelCapLines(v, law);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /refused 1 claim\(s\).*h\/refused \(holds 3\)/);
  assert.match(lines[0], new RegExp(`world ${law.sha.slice(0, 8)}`));
  assert.match(lines[1], /admitted by founder exception: mari\/marigold-house-parcel/);
  // Composed by a pure function and asserted on the STRINGS, because a line
  // composed at a script's call site is watched by nothing — escrowLines printed
  // `[object Object]` for exactly that reason.
});

test("nothing to judge prints nothing", () => {
  assert.deepEqual(parcelCapLines(parcelCapRefusals([], { heldByCred: new Map(), law }), law), []);
});

// ── the wiring, and the docket ──────────────────────────────────────────────

test("THE WIRING: clearing-job asks the gate and writes its check onto the claim", () => {
  // clearing-job.mjs connects to Postgres at import and is not importable, so
  // this reads its source — the same shape window-reanchor.test.mjs already uses
  // for this file. Weak as proofs go, and it is the only thing between the gate
  // and a deletion that no unit test would notice.
  const src = readFileSync(join(ROOT, "world2", "tools", "clearing-job.mjs"), "utf8");

  // ⚑ SCOPED TO STEP 5.6, AND THAT IS THE WHOLE REPAIR. The first cut asserted
  // `src.includes('decide(r.id, "refused", r.check)')` over the WHOLE file, and
  // a flip that deleted this step's copy of that line left the suite green:
  // step 5.5's escrow gate carries the identical string one screen up
  // (clearing-job.mjs:304). The check matched a DIFFERENT gate's wiring and
  // could not fail for the break it named. Found by the flip, which is the only
  // thing that could have found it.
  const from = src.indexOf("// 5.6 · THE PARCEL CLAIM CAP");
  const to = src.indexOf("// 6 · everything still undecided LOCKS");
  assert.ok(from !== -1 && to > from, "step 5.6's block must be findable between its own marker and step 6");
  const step = src.slice(from, to);

  assert.ok(step.includes("parcelCapRefusals("), "step 5.6 must ask the gate");
  assert.ok(step.includes('decide(r.id, "refused", r.check)'), "and write its sentence onto the claim");
  assert.ok(step.includes("parcelCapLawAt("), "reading the law from the world checkout, not from a constant here");
  assert.ok(/amending:\s*amends\.has\(/.test(step), "and telling the gate which claims are amendments (POS-88)");
  assert.ok(src.includes("parcel_cap: capSeen"), "and put its account on the window's receipt");
  assert.ok(/the sweep's own check is untouched/i.test(step), "the sweep stays the gate of last resort");

  // The scoping itself must be able to fail: if the two markers ever stop
  // bracketing a real block, this test would silently assert over an empty
  // string and pass forever.
  assert.ok(step.length > 500, `step 5.6's block read as ${step.length} characters — the markers no longer bracket it`);
});

test("THE RUNNER: the crossing hands the clearing a world checkout, and omits it rather than passing a stale one", () => {
  // The third holder, and the one nothing else watches: a gate the runner never
  // arms is a gate that does not exist, and `bash -n` would not notice.
  const sh = readFileSync(join(ROOT, "deploy", "world2-clearing.sh"), "utf8");
  assert.ok(/world2-refresh-clone\.sh" world/.test(sh), "the world checkout is refreshed before it is read");
  assert.ok(sh.includes('WORLD_REPO_ARG=(--world-repo "$WORLD_CLONE_DIR")'), "and passed on the success arm");
  assert.ok(sh.includes("WORLD_REPO_ARG=()"), "and OMITTED on the failure arm — a stale exceptions map refuses founder-granted ground");
  assert.ok(sh.includes('"${WORLD_REPO_ARG[@]}"'), "and actually reaches the clearing's argv");

  // The omit arm is the load-bearing one, so its ORDER is asserted too: passing
  // the path and then discovering the refresh failed would be the stale-law bug
  // wearing this fix's clothes.
  assert.ok(sh.indexOf("WORLD_REPO_ARG=(--world-repo") < sh.indexOf('node world2/tools/clearing-job.mjs'),
    "the argument is decided before the clearing is invoked, not after");
});

test("THE DOCKET: `parcel-cap` has no bulletin word yet, and the receipt says so rather than guessing one", () => {
  const { cause, cause_row } = causeOf(parcelCapCheck(MARI, 5, law));
  assert.equal(cause, null,
    "none of the six fits: not contested (nobody else claims it), not unbacked (the stake is fine), not malformed " +
    "(the record is fine), not quarantined or held. mark-receipt.mjs's own rule — guessing one of the promised words " +
    "for a refusal nobody has classified is the town keeping its promise in appearance only. canon-absent answered " +
    "null for one lap for exactly this reason and got its word from the founder.");
  assert.equal(CAUSE_WORDS.includes("capped"), false,
    "when the founder rules a word, this line and the map in mark-receipt.mjs are where it lands");
  // The resident is NOT left with nothing: the raw check rides on cause_row and
  // carries the whole sentence, including the number and the remedy.
  assert.match(cause_row, /parcel claim capped/);
  assert.match(cause_row, /wait on the founder's word/);
});
