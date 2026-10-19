// window-truth.test.mjs — the window read may not spend three worlds as one
// sentence, and the act that replaces a pane whole must say what it replaced.
//
//   node --test test/window-truth.test.mjs
//
// THE LAWS THESE ASSERT, verbatim from the marks they are built on:
//
//   `the-town/the-disclosure` (kind: predicated, tier: constitution,
//   2026-08-18), slot `disclosure`, value "refuse or disclose absent inputs;
//   never quietly substitute" —
//
//     "An answer given without its inputs must never wear the grammar of an
//     answer that had them."
//
//   `the-town/window` (kind: class, tier: constitution, 2026-08-14) —
//
//     "A window is a pointer: pane_url names the pane it shows; what the pane
//     says is its household's own — the town hangs the frame, never the words."
//
// WHAT WENT WRONG, and it is why these exist. `readWindowState` answers null
// for three different worlds — no pane file, a pane carrying no machine-state
// island, and a checkout this office cannot read — and `windowRead` described
// all three as "no pane hung yet — household { do: "window", … } hangs one".
// The second world is a living pane. A resident read that sentence about a pane
// that had hung since July, believed it, and called the act it named; `do:
// "window"` REPLACES THE PANE WHOLE and the pane was gone (town commit
// 8b93fc4c). The read wore the grammar of a read that had looked and found
// nothing, and the words the town had promised never to touch were spent by the
// town's own sentence about the frame.
//
// So: F1–F4 assert that each of the four worlds is said as itself, and F5–F7
// assert that the act carries the receipt for a pane it replaced in the one
// state where this office's read had been lying to the caller.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { fixtureTown, probeOfTown } from "./fixture.mjs";
import { windowRead } from "../src/town-index-store.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { updateWindow } from "../src/edit.mjs";
import { readPane } from "../src/panes.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

const KEY = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
const PANE_REL = "WHITE_PAGES/wright/WINDOW/window.html";

const trash = [];
test.after(() => { for (const d of trash.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// The window is read from the store's town index (the suite's embedded store),
// seeded from the fixture town; an act checks its handle against the same town's probe.
const town = fixtureTown();
const IX = await indexStore(town);
const api = await IX.store.connect("office_api");
const probe = await probeOfTown(town);
test.after(async () => { await api.end(); await IX.stop(); });

/** A town checkout with a real pen behind it, so a commit sha is a real sha. */
function townClone() {
  const dir = mkdtempSync(join(tmpdir(), "pm-wintruth-"));
  trash.push(dir);
  mkdirSync(join(dir, "WHITE_PAGES", "wright", "WINDOW"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "wright", "ADDRESS.md"),
    "---\nsince: 2026-05-12\njoined: 2026-07-01\ngithub: keeminlee\n---\n\n# wright\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

/** Put a pane on the shelf and commit it, the way a July-era PR did. */
function hangPane(clone, html) {
  const file = join(clone, PANE_REL);
  writeFileSync(file, html);
  const git = (...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "wright: window hung by PR");
  return { file, bytes: statSync(file).size, sha: git("rev-parse", "HEAD").trim() };
}

// A pane exactly like the one that was lost: real content, no machine twin.
const ISLAND_LESS = `<!doctype html><html><head><meta charset="utf-8"><title>wright</title></head>
<body><h1>the trueing house</h1><p>the lamp is lit; the ledger is open.</p>
<p>keemin: three things wait on your word.</p></body></html>
`;
const WITH_ISLAND = `<!doctype html><html><body>
<script type="application/json" id="window-state">{"hand_set":"2026-08-26","lamp":"lit"}</script>
<h1>the trueing house</h1></body></html>
`;

// ═══════════════════════════════════════════════════════════════════════════
// F1 · THE PANE THAT WAS LOST: an island-less pane is not an empty window
// ═══════════════════════════════════════════════════════════════════════════

test("F1 · a pane that hangs without an island is SAID to hang — never 'no pane hung yet'", async () => {
  const clone = townClone();
  const hung = hangPane(clone, ISLAND_LESS);

  const w = await windowRead(api, "wright", { clone });

  // The words are still absent, and the read still says so honestly.
  assert.equal(w.window, null, "there is no island, so there is no hand-set state to hand back");

  // But the FRAME is stated, because the frame is the town's own —
  // `the-town/window`: "the town hangs the frame, never the words."
  assert.equal(w.pane.hung, true, "a pane file is on the shelf and the office looked at it");
  assert.equal(w.pane.bytes, hung.bytes, "the frame's size is the town's to state, and it states the real one");

  // And the sentence is the one the incident turned on.
  assert.doesNotMatch(w.note, /no pane hung yet/,
    "`the-town/the-disclosure`: \"An answer given without its inputs must never wear the grammar of an answer that had them.\" — this read HAD its inputs and they said a pane hangs");
  assert.match(w.note, /a pane hangs/);
  assert.match(w.note, new RegExp(String(hung.bytes)), "the byte size rides the sentence, not only the field");
  assert.match(w.note, /REPLACES the pane whole/,
    "the verb this reader reaches for next destroys what is here, and that is not recoverable from anywhere else in the answer");
  assert.match(w.note, /WHITE_PAGES\/wright\/WINDOW\/window\.html/,
    "name the file, so 'read it first' is an instruction someone can follow");
});

// ═══════════════════════════════════════════════════════════════════════════
// F2 · NON-REGRESSION: a shelf with no pane still reads as no pane
// ═══════════════════════════════════════════════════════════════════════════

test("F2 · the office looked and there is genuinely no pane — 'no pane hung yet' survives, and only here", async () => {
  const clone = townClone(); // WINDOW/ exists, window.html does not
  const w = await windowRead(api, "wright", { clone });
  assert.equal(w.window, null);
  assert.equal(w.pane.hung, false, "false is a LOOK that found nothing — it is not the same as not looking");
  assert.equal(w.pane.bytes, null);
  assert.match(w.note, /no pane hung yet/);
  assert.match(w.note, /do: "window"/, "the act that would hang one is still named, because here it destroys nothing");
});

// ═══════════════════════════════════════════════════════════════════════════
// F3 · THE ORDINARY GOOD CASE: an island is handed back as the household's own
// ═══════════════════════════════════════════════════════════════════════════

test("F3 · a pane with an island hands back the words, and the frame agrees a pane hangs", async () => {
  const clone = townClone();
  const hung = hangPane(clone, WITH_ISLAND);
  const w = await windowRead(api, "wright", { clone });
  assert.deepEqual(w.window, { hand_set: "2026-08-26", lamp: "lit" },
    "`the-town/window`: \"what the pane says is its household's own\" — quoted, never paraphrased");
  assert.equal(w.pane.hung, true);
  assert.equal(w.pane.bytes, hung.bytes);
  assert.match(w.note, /hand-set state/);
  assert.doesNotMatch(w.note, /no pane hung yet/);
});

// ═══════════════════════════════════════════════════════════════════════════
// F4 · THE BLIND READ: no checkout is not an empty window
// ═══════════════════════════════════════════════════════════════════════════

test("F4 · with no readable checkout the read REFUSES to say whether a pane hangs", async () => {
  const w = await windowRead(api, "wright"); // no clone at all — the office cannot look
  assert.equal(w.window, null);
  assert.equal(w.pane.hung, null,
    "`the-town/the-disclosure`: \"refuse or disclose absent inputs; never quietly substitute\" — null is the refusal, and false would be the substitution");
  assert.doesNotMatch(w.note, /no pane hung yet/,
    "\"An answer given without its inputs must never wear the grammar of an answer that had them.\" — this read had no checkout and may not speak as though it had one");
  assert.match(w.note, /cannot see whether a pane hangs/);
  assert.match(w.note, /REPLACES it whole/,
    "a reader who cannot be told what is there must at least be told what the act would do to it");
});

test("F4b · readPane is the ONE owner, and it never spends 'could not look' as 'nothing hangs'", () => {
  assert.deepEqual(readPane(null, "wright"), { hung: null, bytes: null, state: null },
    "no clone: the office did not look");
  assert.deepEqual(readPane(join(tmpdir(), "pm-wintruth-nonexistent-checkout"), "wright"),
    { hung: false, bytes: null, state: null },
    "a readable path with no pane on it: the office looked, and there is nothing");
});

// ═══════════════════════════════════════════════════════════════════════════
// F5 · THE ACT'S RECEIPT: replacing an island-less pane warns, with the sha
// ═══════════════════════════════════════════════════════════════════════════

test("F5 · replacing an island-less pane WARNS and hands back bytes + the commit the old pane is still in", () => {
  const clone = townClone();
  const before = hangPane(clone, ISLAND_LESS);

  const out = updateWindow({ handle: "wright", html: WITH_ISLAND }, KEY, probe, clone);

  // The founder's shape: a WARN, not a refusal. The act did its work.
  assert.ok(out.commit, "the act proceeds — this is a warning, never a gate");
  assert.equal(out.hung, false, "the pane was replaced, not first-hung");
  assert.equal(readFileSync(join(clone, PANE_REL), "utf8"), WITH_ISLAND,
    "the new pane is on the shelf: nothing here holds the write back");

  assert.ok(out.replaced, "the caller is owed the pane they just wrote over");
  assert.equal(out.replaced.prior_pane, true);
  assert.equal(out.replaced.prior_bytes, before.bytes);
  assert.equal(out.replaced.prior_window_state, null,
    "the state that WAS null is named as null — the whole reason this call was likely made on a lie");
  assert.equal(out.replaced.prior_commit, before.sha);
  assert.match(out.replaced.note, /no pane hung yet/,
    "the warning quotes the sentence that misled them, so they can recognise what happened to them");
});

test("F5b · the recovery the warning promises is EXECUTED here, not asserted", () => {
  const clone = townClone();
  const before = hangPane(clone, ISLAND_LESS);
  const out = updateWindow({ handle: "wright", html: WITH_ISLAND }, KEY, probe, clone);

  // `the-town/the-disclosure`: telling a caller their pane is gone without
  // telling them where it still is would be an answer given without its
  // inputs. So run the command the note prints and require the bytes back.
  const m = /git show (\S+):(\S+)/.exec(out.replaced.note);
  assert.ok(m, "the note prints a runnable recovery command");
  const recovered = execFileSync("git", ["-C", clone, "show", `${m[1]}:${m[2]}`], { encoding: "utf8" });
  assert.equal(recovered, ISLAND_LESS,
    "the sha in the warning really does hold the replaced pane, byte for byte");
  assert.equal(m[1], before.sha);
  assert.equal(m[2], PANE_REL);
});

// ═══════════════════════════════════════════════════════════════════════════
// F6 · THE WARNING IS NARROW: it fires only where the read had been lying
// ═══════════════════════════════════════════════════════════════════════════

test("F6 · a first hang replaces nothing, so nothing is warned about", () => {
  const clone = townClone();
  const out = updateWindow({ handle: "wright", html: ISLAND_LESS }, KEY, probe, clone);
  assert.equal(out.hung, true, "first call creates the pane");
  assert.equal(out.replaced, undefined,
    "there was no prior pane — a warning here would be a warning about nothing");
});

test("F6b · replacing a pane that CARRIED an island is not warned — that read never lied", () => {
  const clone = townClone();
  hangPane(clone, WITH_ISLAND);
  const out = updateWindow({ handle: "wright", html: ISLAND_LESS }, KEY, probe, clone);
  assert.ok(out.commit, "the act proceeds");
  assert.equal(out.replaced, undefined,
    "`household read: \"window\"` handed this caller their state and said a pane hangs; warning them anyway would put a notice on every ordinary keeping-update, which is how a warning stops being read by the time it is true");
});

// ═══════════════════════════════════════════════════════════════════════════
// F7 · THE TWO SURFACES CANNOT DISAGREE — they read the same owner
// ═══════════════════════════════════════════════════════════════════════════

test("F7 · the read's frame and the act's warning are the same fact, taken from one owner", async () => {
  const clone = townClone();
  const before = hangPane(clone, ISLAND_LESS);
  const read = await windowRead(api, "wright", { clone });
  const out = updateWindow({ handle: "wright", html: WITH_ISLAND }, KEY, probe, clone);

  assert.equal(read.pane.hung, true);
  assert.equal(read.pane.bytes, out.replaced.prior_bytes,
    "the size the read reported a moment ago is the size the act says it replaced — one readPane, two callers, so there is no second measurement to drift");
  assert.equal(out.replaced.prior_bytes, before.bytes);
});
