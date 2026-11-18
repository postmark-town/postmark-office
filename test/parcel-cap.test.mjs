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

// ── THE SENTENCE MATCHES THE FOLD'S OWN TEMPLATE (POS-896) ─────────────────────────────────────────────────────────
// Until the world's POS-762 the fold composed this sentence INLINE at its two cap sites, and this case required every `parcel claim capped` template
// in marks-fold.mjs to be one string. The fold now has ONE helper, `parcelCapRefusal(held, room)`, called at both sites, with two branches that are
// two sentences ON PURPOSE: at the cap, the 07-30 sentence (unchanged, and the one this side mirrors); below the cap, the November law (room, the
// 10-31 cutoff, the price). Two literals beginning `parcel claim capped` are no longer drift, so the case selects the helper and its AT-CAP branch.

/** A source with its comments gone, so a mention in prose is not a call. */
const codeOf = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
/** The body of `export function <name>(…) { … }` in `src`, braces matched (the template literals' `${…}` are balanced); null when absent. */
function bodyOf(src, name) {
  const at = src.indexOf(`export function ${name}(`);
  if (at < 0) return null;
  const open = src.indexOf("{", src.indexOf(")", at));
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth += 1;
    else if (src[i] === "}" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}
/** The helper's AT-CAP literal, as written (the template between the backticks), or null. */
const atCapLiteralOf = (src) => bodyOf(codeOf(src), "parcelCapRefusal")?.match(/if \(room >= PARCEL_CLAIM_CAP\)\s*return `([^`]*)`/)?.[1] ?? null;
/** That literal rendered the way the fold renders it, for a household holding 5. */
const renderedAtCap = (src) => atCapLiteralOf(src)
  ?.replaceAll("${held}", "5").replaceAll("${PARCEL_CLAIM_CAP}", String(law.cap)).replaceAll("${PARCEL_CAP_LAW_DATE}", law.lawDate) ?? null;
/** How many places in the fold's CODE enforce the cap by calling the helper: `errors.push({ mark: …, error: parcelCapRefusal(held, room) })`. */
const capSitesOf = (src) => [...codeOf(src).matchAll(/errors\.push\(\{\s*mark: [^,]+,\s*error: parcelCapRefusal\(held, room\)\s*\}\)/g)].length;
const officeAtCap = () => parcelCapCheck(MARI, 5, law);

test("THE SENTENCE MATCHES THE FOLD'S OWN TEMPLATE, read out of the world's source: the helper's at-cap branch, bound exactly", () => {
  const body = bodyOf(codeOf(FOLD_SRC), "parcelCapRefusal");
  assert.ok(body && body.length > 100, "the fold's cap helper, parcelCapRefusal, is in the world's source and is not empty");
  const literal = atCapLiteralOf(FOLD_SRC);
  assert.ok(literal, "the helper's at-cap branch (`if (room >= PARCEL_CLAIM_CAP) return …`) carries a template literal");
  assert.ok(literal.startsWith("parcel claim capped"), "and it is the capped sentence");
  const rendered = renderedAtCap(FOLD_SRC);
  assert.equal(rendered.includes("${"), false, "an unsubstituted placeholder means the fold's at-cap template grew a field this test does not bind");
  assert.equal(officeAtCap(), `${PARCEL_CAP_CHECK}: ${MARI} — ${rendered}`);
});

test("BOTH of the fold's cap sites route through the helper, and none composes the sentence inline any more", () => {
  assert.equal(capSitesOf(FOLD_SRC), 2, "the two enforcement sites each push `parcelCapRefusal(held, room)` (code, not a mention in a comment)");
  const outside = codeOf(FOLD_SRC).replace(bodyOf(codeOf(FOLD_SRC), "parcelCapRefusal") ?? "", "");
  assert.equal(/`parcel claim capped/.test(outside), false, "no cap site composes the sentence inline: the helper is the one holder");
  assert.ok(codeOf(FOLD_SRC).length < FOLD_SRC.length && codeOf(FOLD_SRC).includes("export function parcelCapRefusal("), "the control: the comment strip ate comments and left the code");
});

test("PARITY AGAINST THE WORLD'S OWN FUNCTION: at the cap the office's sentence is the fold's, below the cap the fold's sentence is another that keeps the protocol prefix", async () => {
  const mod = await import(pathToFileURL(join(WORLD_CLONE, "tools", "marks-fold.mjs")).href);
  assert.equal(typeof mod.parcelCapRefusal, "function", "the world exports its cap helper");
  const atCap = mod.parcelCapRefusal(5, mod.PARCEL_CLAIM_CAP);
  assert.equal(officeAtCap(), `${PARCEL_CAP_CHECK}: ${MARI} — ${atCap}`, "the office's cap sentence is what the fold's function says at the cap, for the same household");
  assert.equal(renderedAtCap(FOLD_SRC), atCap, "and the literal read out of the source is what the function returns when run: the pin and the behaviour agree");
  const below = mod.parcelCapRefusal(1, 1);
  assert.ok(below.startsWith("parcel claim capped"), "below the cap the fold still says `parcel claim capped` first: the words the settlement cites the claim cap by");
  assert.notEqual(below, mod.parcelCapRefusal(1, mod.PARCEL_CLAIM_CAP), "and it is another sentence (the November law), not the at-cap one");
  assert.ok(below.includes("has room for 1"), "which names the household's room");
});

test("THE SOURCE PIN CAN FAIL: a copy of the world's source with the at-cap literal re-worded, or one cap site inlined, no longer matches", () => {
  const literal = atCapLiteralOf(FOLD_SRC);
  const reworded = FOLD_SRC.replace(literal, literal.replace("per household", "for each household"));
  assert.notEqual(reworded, FOLD_SRC, "the copy differs (the mutation applied)");
  assert.notEqual(renderedAtCap(reworded), renderedAtCap(FOLD_SRC));
  assert.notEqual(officeAtCap(), `${PARCEL_CAP_CHECK}: ${MARI} — ${renderedAtCap(reworded)}`, "re-worded at the cap: the office's sentence no longer equals the copy's");
  const site = /errors\.push\(\{\s*mark: [^,]+,\s*error: parcelCapRefusal\(held, room\)\s*\}\)/;
  const inlined = FOLD_SRC.replace(site, "errors.push({ mark: mk.id, error: `parcel claim capped — inline` })");
  assert.notEqual(inlined, FOLD_SRC);
  assert.equal(capSitesOf(inlined), 1, "one site inlined: the routing check counts one, not two");
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

test("THE WIRING: clearing-job DECIDES the limits ahead of the geometry, opposed and citing the law (POS-364, Darko's ruling A)", () => {
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
  const from = src.indexOf("// 2.5 · THE PARCEL LIMITS, DECIDED AT THE CLEARING");
  const to = src.indexOf("// 3 · escrow sufficiency");   // Darko's A (2026-10-08) moved it ahead of the geometry
  assert.ok(from !== -1 && to > from, "step 2.5's block must be findable between its own marker and step 3");
  assert.ok(from < src.indexOf("// 4 · geometry vs STANDING marks") && from < src.indexOf("// 5.7 · THE CARRY"),
    "ahead of step 4's overlap and step 5.7's carry: an over-limit parcel never holds ground");
  const step = src.slice(from, to);

  assert.ok(step.includes("limitsAtClearing("), "step 2.5 asks the world's own fold, never a parallel count (one rule, not two)");
  assert.ok(!step.includes("parcelCapRefusals("), "and no longer counts for itself");
  assert.ok(step.includes('decide(r.id, "refused", r.check)'), "and decides each over-limit claim opposed, citing its law");
  assert.ok(step.includes("over_limit:"), "its account says which claims are over the limit");
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

test("THE DOCKET: a parcel over a limit answers `opposed`, the bulletin's seventh word (Darko, POS-364, 2026-10-08)", async () => {
  const { opposedCheck } = await import("../world2/tools/parcel-cap.mjs");
  assert.equal(CAUSE_WORDS.length, 7);
  assert.equal(CAUSE_WORDS.at(-1), "opposed", "the ruled word is in the receipt's vocabulary");
  // the clearing's check (the A build), for each limit
  for (const law of ["the-town/claim-cap", "the-town/one-per-resident"]) {
    const { cause, cause_row } = causeOf(opposedCheck({ law, slug: MARI, error: "over its limit" }));
    assert.equal(cause, "opposed", `${law} answers opposed`);
    assert.ok(cause_row.includes(`opposed: ${law}: ${MARI}`), "and the raw check still rides beside it, naming the law");
  }
  // the older count's spelling, on rows the train's clearing refused before the A build
  const older = causeOf(parcelCapCheck(MARI, 5, law));
  assert.equal(older.cause, "opposed");
  assert.match(older.cause_row, /parcel claim capped/);
  assert.match(older.cause_row, /wait on the founder's word/);
});

test("the clearing's outcome sentence for a parcel over a limit names the law mark that holds it", async () => {
  const { opposedCheck, OPPOSED_CHECK } = await import("../world2/tools/parcel-cap.mjs");
  const check = opposedCheck({ law: "the-town/claim-cap", slug: "someone/the-fourth-parcel", error: "parcel claim capped — this credential household already holds 3 (cap 3 per household, ruled 2026-07-30; prior estate stands, new claims wait on the founder's word)" });
  assert.equal(checkNameOf(check), OPPOSED_CHECK);
  assert.match(check, /^opposed: the-town\/claim-cap: someone\/the-fourth-parcel — parcel claim capped — this credential household already holds/);
});
