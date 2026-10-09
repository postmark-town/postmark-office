// settlement-classify.mjs — WHICH KIND OF REFUSAL IS THIS, AND CAN A RERUN CLEAR IT.
//
// ── THE FAILURE THIS RETIRES (2026-08-30, the v1 settlement hardening) ───────
//
// The sweep's refusal reached the operator as this, verbatim, from the box's
// journal at 2026-08-31T02:39:26Z:
//
//   SETTLEMENT-SWEEP-REFUSAL {"cause":"the crossing does not lint clean: 2
//   error(s), first — this mark is filed at WORLD/marks/let-there-be-light/
//   the-mushroom-greenhouse, but the frozen filing names WORLD/marks/
//   let-there-be-light/the-protected-grove/the-mushroom-greenhouse — \"A mark's
//   directory is its historical filing: it carries ","phase":"unknown"}
//
// `"phase":"unknown"` is the whole defect. The receipt names WHAT tripped and
// says nothing about the only question the person reading it at 3 AM has: is
// this mine to rerun, or mine to repair? Those are different nights. The
// 02:39 refusal was rerunnable — a drained draft carried a mark filed at the
// fossil root, and the 02:40 rerun published (02:59:28Z, dbed7311 -> c1f26410).
// Nothing in the refusal said so, so the rerun was a guess that happened to be
// right.
//
// ── THE TWO CLASSES, AND THE TEST THAT SEPARATES THEM ───────────────────────
//
// The lint runs over the crossing's COMPOSITION: origin/main's tree with the
// eligible drafts folded in. So a path that fails the gate came from exactly
// one of two places, and which one decides everything:
//
//   input-bad   the offending path exists ONLY in the drained inputs. Main is
//               clean; the composition is not. Repair the source (the drawer,
//               the draft) and the next crossing composes clean. A rerun after
//               that repair CLEARS IT — and a rerun before the repair does not,
//               which is worth saying too.
//
//               An AMEND is this class too: its path is in canon, but the
//               copy the lint refused is the sketchbook's (§ AN AMEND'S PATH
//               IS ALWAYS IN CANON, at classify below; POS-378).
//
//   canon-bad   the offending path is in origin/main's own tree, as canon
//               has it (no sketchbook changed it). NO RERUN CAN
//               EVER CLEAR THIS: every future crossing composes the same red
//               from the same canon, twice a day, forever. It needs an
//               operator-repair commit on main (or on the drawer that keeps
//               re-proposing it), and the refusal must say so rather than let
//               an operator burn three crossings discovering it.
//
// ── WHAT THIS DELIBERATELY WILL NOT DO ──────────────────────────────────────
//
// It never guesses. A refusal it cannot attribute to any path — a machinery
// trip, a stderr shape it does not recognise, a cause truncated mid-path — is
// `unclassified`, with a next_step that says a human must read the stderr. A
// classifier that defaulted to `input-bad` would tell an operator to rerun a
// crossing that cannot ever pass, and that is strictly worse than saying
// nothing.
//
// ── A DEPENDENCY, NAMED ─────────────────────────────────────────────────────
//
// The world sweep truncates its cause at 240 characters and forwards only the
// FIRST error (postmark-world tools/settlement-sweep.mjs:1254). So this file
// classifies on a fraction of the evidence: a crossing whose SECOND error is
// the canon-bad one is classified from the first error alone. That is a real
// limit, it is the v1 #6 finding, and its fix lives in the world repo. Until
// then, `errors_seen` vs `errors_claimed` on the verdict is the honest gap —
// it prints both so the reader can see how much of the refusal was withheld.
//
// Usage:
//   node deploy/settlement-classify.mjs --stderr sweep.err --clone /path/to/clone [--ref origin/main]
// Prints the verdict as JSON on stdout. Exit is always 0 — this is an
// instrument, and a classifier that could fail the crossing it is describing
// would be a second way to lose a settlement.

import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

export const SENTINEL = "SETTLEMENT-SWEEP-REFUSAL";

export const INPUT_BAD = "input-bad";
export const CANON_BAD = "canon-bad";
export const UNCLASSIFIED = "unclassified";

/**
 * The refusal body the sweep printed, parsed out of a stderr blob.
 *
 * Returns `{ cause, phase }` or null. The sentinel line is JSON after the
 * sentinel word; anything else on the stream (the lint advisories, the
 * already-standing drops) is noise this must step over rather than parse.
 */
export function refusalOf(stderr) {
  if (typeof stderr !== "string") return null;
  for (const line of stderr.split(/\r?\n/)) {
    const at = line.indexOf(SENTINEL);
    if (at < 0) continue;
    const body = line.slice(at + SENTINEL.length).trim();
    try {
      const parsed = JSON.parse(body);
      if (parsed && typeof parsed === "object") return parsed;
    } catch {
      // A sentinel whose body will not parse is a finding, not a crash: fall
      // through and let the caller report `unclassified` with the raw line.
      return { cause: body, phase: null, unparsed: true };
    }
  }
  return null;
}

/** How many errors the sweep SAID it had, from its own "N error(s)" phrasing. */
export function errorsClaimed(cause) {
  const m = /(\d+)\s+error\(s\)/.exec(String(cause ?? ""));
  return m ? Number(m[1]) : null;
}

// A repo path as the lint names one. Deliberately anchored on the two roots the
// world's own trees use, so a stray word that happens to contain a slash is not
// mistaken for a file.
const PATH_RE = /\b(?:WORLD|STATE)\/[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*/g;

/**
 * Every repo path named in the refusal text, in order, deduped.
 *
 * A path that ENDS EXACTLY AT THE END of the text is dropped, because the
 * sweep truncates its cause mid-sentence: a half-path would not be found in
 * canon and would classify a canon-bad refusal as input-bad, which is the one
 * mistake with a real cost. Truncation must lose evidence, never invent it.
 */
export function pathsIn(text) {
  const s = String(text ?? "");
  const out = [];
  for (const m of s.matchAll(PATH_RE)) {
    if (m.index + m[0].length >= s.length) continue; // truncated mid-path
    if (!out.includes(m[0])) out.push(m[0]);
  }
  return out;
}

/**
 * The verdict. `existsInCanon(path)` answers "is this in the reference tree",
 * and `changedByInputs(path)` answers "which of this crossing's sketchbooks
 * changed it" (a list of branch names, empty when none) — both injected so the
 * whole judgment is a pure function a falsifier can drive without a clone.
 *
 * ── AN AMEND'S PATH IS ALWAYS IN CANON (POS-378, postmark#3375) ─────────────
 *
 * Path presence alone called every bad AMEND terminal. On 2026-10-02 18:00Z the
 * lint refused WORLD/marks/kinofire/the-gloaming, which canon carried, so this
 * said "NO RERUN CAN CLEAR THIS" (postmark#3363). The fault was kinofire's
 * amend: canon's copy was clean, the crossing's copy was not, and the repair was
 * one line on world main (f8cfefb4). So a fault in canon is canon-bad only when
 * the composition left it as canon has it. A sketchbook that changed the file
 * means the lint refused the INPUT's copy, and that is input-bad. With no probe
 * (or a probe that cannot answer) nothing is downgraded: canon-bad stays the
 * answer, because calling a terminal refusal rerunnable is the costly mistake.
 */
export function classify({ stderr, existsInCanon, changedByInputs = () => [], ref = "origin/main" }) {
  const refusal = refusalOf(stderr);
  const cause = refusal ? String(refusal.cause ?? "") : "";

  // ── WHICH PATH IS THE FAULT, AND WHEN THAT IS KNOWABLE ─────────────────────
  //
  // A lint message names TWO paths and only one of them is the fault:
  //
  //   "this mark is filed at WORLD/…/the-mushroom-greenhouse, but the frozen
  //    filing names WORLD/…/the-protected-grove/the-mushroom-greenhouse"
  //
  // The first is the offending file; the second is the reference it is being
  // held to, and the reference is IN CANON BY CONSTRUCTION. A rule of "any named
  // path that exists in main means canon-bad" would therefore have called the
  // 02:39 refusal terminal — and it was not. The founder's own repair commit is
  // the receipt (postmark-world 7f866059, 2026-08-30 22:40): "drop root-parked
  // the-breakfast-table + the-mushroom-greenhouse … the drawer now matches the
  // frozen filing" — a DRAWER repair, which is input-bad, cleared by a rerun.
  //
  // So the fault is read from `errors[].file` when the sweep forwards it, and
  // from `errors[].file` ONLY: prose inside a message is a description, never a
  // subject. Without that field there is no honest way to tell the offender from
  // the reference, and the classifier says so rather than guessing — except in
  // the one case where guessing is unnecessary, which is when NO named path is
  // in canon at all. Then nothing in canon can be the fault, whichever path was
  // meant, and input-bad is sound.
  const forwarded = Array.isArray(refusal?.errors) ? refusal.errors : null;
  const faults = forwarded ? [...new Set(forwarded.map((e) => e.file).filter(Boolean))] : [];
  const mentioned = forwarded
    ? [...new Set(forwarded.flatMap((e) => pathsIn(`${e.msg ?? ""} `)).filter((m) => !faults.includes(m)))]
    : (refusal ? pathsIn(cause) : []);

  const base = {
    at: new Date().toISOString(),
    ref,
    cause,
    errors_claimed: errorsClaimed(cause),
    // Without `errors[]` the sweep forwards its FIRST error only, so one is all
    // there is to judge — said out loud rather than implied by a short list.
    errors_seen: forwarded ? forwarded.length : (mentioned.length ? 1 : 0),
    faults,
    paths_in_canon: [],
    paths_in_inputs: [],
  };

  const withheld = base.errors_claimed !== null && base.errors_claimed > base.errors_seen
    ? ` (the sweep reported ${base.errors_claimed} error(s) and forwarded ${base.errors_seen} — this verdict ` +
      `is drawn from the forwarded one only; postmark-world tools/settlement-sweep.mjs:1254)`
    : "";

  const probe = (p) => { try { return !!existsInCanon(p); } catch { return false; } };
  const amenders = (p) => { try { const b = changedByInputs(p); return Array.isArray(b) ? b : []; } catch { return []; } };
  const split = (list) => {
    const inCanon = [];
    const inInputs = [];
    for (const p of list) (probe(p) ? inCanon : inInputs).push(p);
    return { inCanon, inInputs };
  };

  if (!refusal) {
    return {
      ...base,
      class: UNCLASSIFIED,
      next_step:
        `the sweep tripped without printing a ${SENTINEL} line, so this is a machinery trip and not a ` +
        `record finding — read the unit's stderr (journalctl -u postmark-settlement.service) before rerunning`,
    };
  }

  // ── THE SURE PATH: the sweep named its faults ──────────────────────────────
  if (faults.length) {
    const { inCanon: present, inInputs } = split(faults);
    // § AN AMEND'S PATH IS ALWAYS IN CANON: a present path a sketchbook changed
    // is the input's copy, not canon's.
    const amended = present.map((p) => ({ path: p, by: amenders(p) })).filter((a) => a.by.length);
    const inCanon = present.filter((p) => !amended.some((a) => a.path === p));
    const amendedBy = Object.fromEntries(amended.map((a) => [a.path, a.by]));
    if (inCanon.length) {
      return {
        ...base,
        paths_in_canon: present,
        paths_in_inputs: inInputs,
        amended_by_inputs: amendedBy,
        class: CANON_BAD,
        next_step:
          `NO RERUN CAN CLEAR THIS. ${inCanon.join(", ")} ${inCanon.length === 1 ? "is" : "are"} in ${ref}'s own ` +
          `tree and ${inCanon.length === 1 ? "is" : "are"} what the lint refused, so every crossing from now on ` +
          `composes the same red from the same canon — twice a day, until somebody changes the record. Removal ` +
          `lane: an operator-repair commit on world main (or on the drawer that keeps re-proposing the path), ` +
          `then the next scheduled crossing.${withheld}`,
      };
    }
    if (amended.length) {
      const changed = amended.map((a) =>
        `${a.path} is in ${ref}'s tree, but this crossing's ${a.by.join(", ")} changed it, and the lint refused that changed copy, not canon's.`);
      const only = inInputs.length
        ? ` ${inInputs.join(", ")} ${inInputs.length === 1 ? "exists" : "exist"} only in this crossing's drained inputs.` : "";
      return {
        ...base,
        paths_in_canon: present,
        paths_in_inputs: inInputs,
        amended_by_inputs: amendedBy,
        class: INPUT_BAD,
        next_step:
          `rerunnable AFTER the source is repaired, not before. ${changed.join(" ")}${only} Repair the amend at its ` +
          `source, or re-amend the mark on world main as postmark-world f8cfefb4 did on 2026-10-02 (postmark#3363), ` +
          `and rerun. A rerun before the repair composes the same red.${withheld}`,
      };
    }
    return {
      ...base,
      paths_in_canon: [],
      paths_in_inputs: inInputs,
      amended_by_inputs: {},
      class: INPUT_BAD,
      next_step:
        `rerunnable AFTER the source is repaired, not before. ${inInputs.join(", ")} ` +
        `${inInputs.length === 1 ? "is" : "are"} what the lint refused and ${inInputs.length === 1 ? "exists" : "exist"} ` +
        `only in this crossing's drained inputs; ${ref} is clean of ${inInputs.length === 1 ? "it" : "them"}. Repair ` +
        `the mark at its drawer (draft/<household>) — the shape of postmark-world 7f866059 — and rerun. A rerun ` +
        `before the repair composes the same red.${withheld}`,
    };
  }

  // ── THE PROSE PATH: no faults named, only a sentence ───────────────────────
  if (!mentioned.length) {
    return {
      ...base,
      class: UNCLASSIFIED,
      next_step:
        `the refusal names no repo path this classifier can test against ${ref} — a human must read the ` +
        `cause above and decide whether the fault is in the drained inputs or in canon. Do NOT rerun blind: ` +
        `if the fault is in canon, every rerun composes the same red`,
    };
  }

  const { inCanon, inInputs } = split(mentioned);
  if (!inCanon.length) {
    // Sound without knowing which path was the subject: none of them is in
    // canon, so canon cannot be the fault whichever one the lint meant.
    return {
      ...base,
      paths_in_canon: [],
      paths_in_inputs: inInputs,
      class: INPUT_BAD,
      next_step:
        `rerunnable AFTER the source is repaired, not before. No path this refusal names is in ${ref} ` +
        `(${inInputs.join(", ")}), so the fault is in this crossing's drained inputs whichever of them the lint ` +
        `meant. Repair the mark at its drawer (draft/<household>) — the shape of postmark-world 7f866059 — and ` +
        `rerun. A rerun before the repair composes the same red.${withheld}`,
    };
  }

  return {
    ...base,
    paths_in_canon: inCanon,
    paths_in_inputs: inInputs,
    class: UNCLASSIFIED,
    next_step:
      `the refusal names a path that IS in ${ref} (${inCanon.join(", ")}) and one that is not ` +
      `(${inInputs.join(", ")}), and the sweep did not say which of them it refused — a lint message names the ` +
      `offending file AND the reference it is held to, and the reference is in canon by construction. Read the ` +
      `cause and decide: a fault in the drawer is rerunnable after repair (postmark-world 7f866059), a fault in ` +
      `canon is not. This becomes decidable the day the sweep forwards errors[].file ` +
      `(postmark-world tools/settlement-sweep.mjs:1254).${withheld}`,
  };
}

/** The canon test, against a real clone. Trees and blobs both answer here. */
export function canonProbe(clone, ref = "origin/main") {
  return (path) => {
    try {
      execFileSync("git", ["-C", clone, "cat-file", "-e", `${ref}:${path}`], { stdio: "ignore", timeout: 20_000 });
      return true;
    } catch {
      // A mark is named by its DIRECTORY in the lint's prose; a repo that files
      // the body one level down still counts as canon carrying it.
      try {
        execFileSync("git", ["-C", clone, "cat-file", "-e", `${ref}:${path}/mark.md`], { stdio: "ignore", timeout: 20_000 });
        return true;
      } catch { return false; }
    }
  };
}

/**
 * Which of this crossing's sketchbooks changed a path, against a real clone.
 *
 * The store write-down builds each household's sketchbook as a local
 * `draft/<name>` branch from main and commits that household's marks on it
 * (src/store-writedown.mjs), and the sweep composes main with those branches.
 * The sweep rolls its working tree back on a refusal, so the branches are
 * where the composed copy can still be read. A branch counts when it changed
 * the path itself (against its merge-base with `ref`, so a stale branch built
 * on an older main does not count for a file main moved since) AND its copy
 * differs from `ref`'s. Any git failure answers "none", which leaves the
 * verdict canon-bad.
 */
export function inputsProbe(clone, ref = "origin/main") {
  const git = (args) => execFileSync("git", ["-C", clone, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 20_000 });
  const differs = (a, b, path) => {
    try { git(["diff", "--quiet", a, b, "--", path]); return false; } catch (e) { return e.status === 1; }
  };
  let branches = [];
  try { branches = git(["for-each-ref", "--format=%(refname:short)", "refs/heads/draft/"]).split("\n").filter(Boolean); }
  catch { return () => []; }
  return (path) => branches.filter((b) => {
    let base;
    try { base = git(["merge-base", b, ref]).trim(); } catch { return false; }
    return differs(base, b, path) && differs(ref, b, path);
  });
}

function argOf(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

export function run() {
  const stderrPath = argOf("stderr");
  const clone = argOf("clone");
  const ref = argOf("ref", "origin/main");
  let stderr = "";
  try { stderr = stderrPath ? readFileSync(stderrPath, "utf8") : ""; } catch { stderr = ""; }
  // NO CLONE, NO VERDICT. A probe that cannot run must never report agreement:
  // answering `false` for every path would make every refusal look input-bad and
  // tell the operator to rerun a crossing that can never pass. The one honest
  // answer is that the question was not asked.
  if (!clone) {
    process.stdout.write(`${JSON.stringify({
      at: new Date().toISOString(), ref, cause: refusalOf(stderr)?.cause ?? "",
      class: UNCLASSIFIED,
      next_step:
        `no clone was given, so nothing could be tested against ${ref} and the class is unknown — ` +
        `re-run this classifier with --clone <the settlement clone> before acting on the refusal`,
      faults: [], paths_in_canon: [], paths_in_inputs: [],
    }, null, 1)}\n`);
    return 0;
  }
  process.stdout.write(`${JSON.stringify(classify({ stderr, existsInCanon: canonProbe(clone, ref), changedByInputs: inputsProbe(clone, ref), ref }), null, 1)}\n`);
  return 0;
}

// ── entry guard ──────────────────────────────────────────────────────────────
// The junction lesson (2026-09-05, HQ memory `junctions-defeat-main-guards`):
// `pathToFileURL(process.argv[1]).href === import.meta.url` is FALSE when the
// entry path reaches this file through a Windows junction — the ESM loader
// realpaths the entry, argv[1] is not — so the tool exits 0 having done nothing.
// Compare real paths (world2/tools/await-clearing.mjs's idiom); the URL compare is
// only the fallback for an argv[1] that cannot be realpath'd. The office's
// test/cli-guard.test.mjs imports this file and spawns it through a junction.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exit(run());
