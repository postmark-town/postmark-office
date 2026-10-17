// pos619-lossy-ingest.test.mjs — POS-619: the office's two ingests never store
// a value the world's parser would silently lose.
//
// The parser keeps what it can read and drops the rest without a word, so the
// heist's spelling `dials: { stolen: true, clue: "…" }` (bare keys) reads as {}.
// World #200/#204 name each loss from the raw text (marks-fold.mjs §
// lossyValues, § lossyMessage) and the lint errs on it in the PR lane. A commit
// that reaches main past the lane is caught here:
//   · marks-ingest HOLDS a changed mark with a loss, in the lint's own words;
//     a held ADD's children are held with it (no STOP); the mixed arm asks the
//     hand commit's text; a ref before world #204 is NOT CHECKED, and says so.
//   · law-ingest REFUSES the whole sha (class marks are law; marks-ingest never
//     reads them), so the law stays where it was. The candy class carries the
//     heist's dial: its lossy spelling is refused, its strict JSON goes through.
//
// The world side is the pinned world clone (test/clone-pins.json), which must
// carry world #204: the helper is read from the checkout being ingested.
//
//   WORLD_CLONE=<a world clone at or after #204> node --test test/pos619-lossy-ingest.test.mjs

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  ingest, planIngest, renderPlan, pathsAt, withLossyHands, lossyWhy, LOSSY_NOT_CHECKED,
} from "../world2/tools/marks-ingest.mjs";
import { deriveLaw, lossyRefusal } from "../world2/tools/law-ingest.mjs";
import { deriveSeed } from "../world2/tools/seed-import.mjs";
import { WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const git = (repo, ...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const LOSSY = 'dials: { stolen: true, clue: "No such thing as candy exists" }';
const STRICT = 'dials: {"stolen": true, "clue": "No such thing as candy exists"}';
const LINT_SENTENCE = 'dials: { stolen: true, clue: "No such thing as candy exists" } is not strict JSON, so the record keeps only its number pairs and silently drops stolen, clue (it reads as {}) — write it as strict JSON, every key quoted: dials: { "stolen": true, "clue": "No such thing as candy exists" }';
// The newest world commit BEFORE #200: no lossyValues, no lossyMessage.
const BEFORE_200 = "814d9e9aaf159a01ab91dbd314bf4781879c9bdb";

const FM = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;
function setLine(text, key, value) {
  const m = text.match(FM);
  const lines = m[1].split(/\r?\n/).filter((l) => !l.startsWith(`${key}:`));
  lines.push(`${key}: ${value}`);
  return `---\n${lines.join("\n")}\n---\n${text.slice(m[0].length)}`;
}

let dir = null;
const clones = [];
function cloneAt(sha, label) {
  const at = join(dir, `${label}-${clones.length}`);
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", WORLD_CLONE, at], { stdio: "ignore" });
  git(at, "-c", "advice.detachedHead=false", "checkout", "-q", sha);
  git(at, "config", "user.name", "pos619-fixture");
  git(at, "config", "user.email", "fixture@postmark.invalid");
  clones.push(at);
  return at;
}
const commitAll = (repo, msg) => { git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", msg); return git(repo, "rev-parse", "HEAD"); };

let PIN = null;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "pos619-"));
  PIN = git(WORLD_CLONE, "rev-parse", "HEAD");
  const mf = readFileSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"), "utf8");
  assert.match(mf, /export function lossyMessage/,
    `the pinned world clone (${WORLD_CLONE} @ ${PIN.slice(0, 9)}) must carry world #204 (lossyValues + lossyMessage) — move test/clone-pins.json`);
});
after(() => { if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

// ── the plan, without a world ───────────────────────────────────────────────

const row = (slug, over = {}) => ({
  id: `id-${slug}`, slug, kind: "sited", owner: slug.split("/")[0], household: "h", body: "b",
  geometry: { at: { x: 0, y: 0 }, extent: { w: 1, h: 1 } }, bbox: "(1,1),(0,0)", parent: null,
  status: "standing", locked_window: 1, locked_at: "2026-08-28T00:00:00.000Z", data: { date: "2026-07-01", tier: "market" }, ...over,
});
const C = (sha) => ({ sha, author: "a", at: "2026-09-10T00:00:00.000Z", subject: "s" });

test("POS-619 · planIngest holds a lossy ADD and a lossy AMEND in the lint's words; a strict mark plans in", () => {
  const plan = planIngest({
    derived: [row("a/lossy-add"), row("a/lossy-amend", { body: "file" }), row("a/strict", { body: "file" })],
    storeRows: [row("a/lossy-amend", { body: "store" }), row("a/strict", { body: "store" })],
    pathAtRef: new Map([["a/lossy-add", "p/1"], ["a/lossy-amend", "p/2"], ["a/strict", "p/3"]]),
    commitFor: () => C("c1"),
    lossy: new Map([["a/lossy-add", [LINT_SENTENCE]], ["a/lossy-amend", [LINT_SENTENCE]]]),
  });
  assert.deepEqual([plan.adds.length, plan.amends.map((a) => a.slug), plan.stops], [0, ["a/strict"], []]);
  assert.deepEqual(plan.held.map((h) => h.slug), ["a/lossy-add", "a/lossy-amend"]);
  for (const h of plan.held) assert.equal(h.why, lossyWhy([LINT_SENTENCE]));
  assert.ok(plan.lossyChecked);
  const receipt = renderPlan(plan, { target: { ref: "r", sha: "f".repeat(40) }, head: null, base: null, windowId: 2, classMarks: 0 });
  assert.match(receipt, /HELD 2:/);
  assert.ok(receipt.includes(`· a/lossy-add — HELD: the parser would silently lose a value, so the store would hold less than the file says — ${LINT_SENTENCE} (POS-619)`), receipt);
  assert.ok(!receipt.includes(LOSSY_NOT_CHECKED));
});

test("POS-619 · a held parent holds its children: no STOP, the rest of the run plans", () => {
  const plan = planIngest({
    derived: [row("a/parent"), row("a/child", { kind: "predicated", geometry: null, parent: "id-a/parent" }),
      row("a/grandchild", { kind: "naming", geometry: null, parent: "id-a/child" }), row("a/other")],
    storeRows: [], pathAtRef: new Map([["a/parent", "p/1"], ["a/child", "p/2"], ["a/grandchild", "p/3"], ["a/other", "p/4"]]),
    commitFor: () => C("c1"), lossy: new Map([["a/parent", [LINT_SENTENCE]]]),
  });
  assert.deepEqual(plan.stops, [], `a held parent must not STOP the run:\n${plan.stops.join("\n")}`);
  assert.deepEqual(plan.adds.map((a) => a.slug), ["a/other"]);
  assert.deepEqual(plan.held.map((h) => h.slug), ["a/child", "a/grandchild", "a/parent"]);
  assert.match(plan.held.find((h) => h.slug === "a/child").why, /^HELD with its parent: a\/parent is held and not in the store/);
  assert.match(plan.held.find((h) => h.slug === "a/grandchild").why, /^HELD with its parent: a\/child is held/);
});

test("POS-619 · a child of a held AMEND still plans: its parent stands in the store", () => {
  const plan = planIngest({
    derived: [row("a/parent", { body: "file" }), row("a/child", { kind: "predicated", geometry: null, parent: "id-a/parent" })],
    storeRows: [row("a/parent", { body: "store" })], pathAtRef: new Map([["a/parent", "p/1"], ["a/child", "p/2"]]),
    commitFor: () => C("c1"), lossy: new Map([["a/parent", [LINT_SENTENCE]]]),
  });
  assert.deepEqual([plan.held.map((h) => h.slug), plan.adds.map((a) => a.slug), plan.stops], [["a/parent"], ["a/child"], []]);
});

test("POS-619 · no helper at the ref: the receipt says NOT CHECKED, and nothing is held for it", () => {
  const plan = planIngest({ derived: [row("a/x")], storeRows: [], pathAtRef: new Map([["a/x", "p"]]), commitFor: () => C("c1") });
  assert.equal(plan.lossyChecked, false);
  assert.deepEqual(plan.held, []);
  const receipt = renderPlan(plan, { target: { ref: "r", sha: "f".repeat(40) }, head: null, base: null, windowId: 2, classMarks: 0 });
  assert.ok(receipt.includes(LOSSY_NOT_CHECKED), receipt);
});

// ── the seam, on a real checkout ────────────────────────────────────────────

/** Two resident sited marks at `repo` with no `dials:` yet, and their files. */
async function twoSitedMarks(repo) {
  const { paths } = await pathsAt(repo);
  const seed = await deriveSeed({ worldRepo: repo, lawSha: git(repo, "rev-parse", "HEAD") });
  const picks = seed.marks.filter((m) => m.kind === "sited" && m.owner !== "the-town" && paths.has(m.slug)
    && !/^dials:/m.test(readFileSync(join(repo, paths.get(m.slug)), "utf8").match(FM)[1])
    && !seed.marks.some((x) => String(x.parent) === String(m.id))).slice(0, 3);
  assert.equal(picks.length, 3, "the fixture needs three resident sited marks");
  return { seed, paths, picks: picks.map((m) => ({ slug: m.slug, file: join(repo, paths.get(m.slug)) })) };
}

test("POS-619 · pathsAt reads each mark's raw text through the ref's own helper: the heist's spelling is named, strict JSON is not", async () => {
  const repo = cloneAt(PIN, "seam");
  const { picks: [x, y] } = await twoSitedMarks(repo);
  writeFileSync(x.file, setLine(readFileSync(x.file, "utf8"), "dials", LOSSY.slice("dials: ".length)));
  writeFileSync(y.file, setLine(readFileSync(y.file, "utf8"), "dials", STRICT.slice("dials: ".length)));
  const { lossy, lossyOf } = await pathsAt(repo);
  assert.deepEqual([...lossy.keys()], [x.slug], "only the lossy spelling is named");
  assert.deepEqual(lossy.get(x.slug), [LINT_SENTENCE]);
  assert.equal(typeof lossyOf, "function");

  const old = cloneAt(BEFORE_200, "old");
  const before200 = await pathsAt(old);
  assert.deepEqual([before200.lossy, before200.lossyOf], [null, null], "a checkout before world #204 has no helper to ask");
});

test("POS-619 · THE INGEST: a pushed lossy mark is HELD with the lint's sentence and its row is untouched; the strict one is amended", async () => {
  const repo = cloneAt(PIN, "ingest");
  const base = git(repo, "rev-parse", "HEAD");
  const { seed, picks: [x, y] } = await twoSitedMarks(repo);
  writeFileSync(x.file, setLine(readFileSync(x.file, "utf8"), "dials", LOSSY.slice("dials: ".length)));
  writeFileSync(y.file, setLine(readFileSync(y.file, "utf8"), "dials", STRICT.slice("dials: ".length)));
  const ref = commitAll(repo, "a direct push past the PR lane (pos619 fixture)");

  // The store says exactly what the base says; a read-only dry run asks it.
  const statements = [];
  const client = { query: async (text) => {
    const t = text.trim();
    statements.push(t.split(/\s+/).slice(0, 3).join(" "));
    if (/^BEGIN READ ONLY$|^ROLLBACK$/i.test(t)) return { rows: [] };
    if (/FROM projection_heads WHERE repo/i.test(t)) return { rows: [] };
    if (/FROM windows WHERE status = 'open'/i.test(t)) return { rows: [{ id: 2 }] };
    if (/FROM marks m LEFT JOIN windows/i.test(t)) return { rows: seed.marks.map((m) => ({ ...structuredClone(m), id: String(m.id), parent: m.parent == null ? null : String(m.parent), status: "standing", locked_at: null })) };
    throw new Error(`the fixture store does not answer: ${t.slice(0, 120)}`);
  } };
  const r = await ingest(client, { worldRepo: repo, ref, since: base, dryRun: true });
  assert.equal(r.status, "dry-run", r.receipt);
  assert.deepEqual(r.plan.held.map((h) => h.slug), [x.slug], r.receipt);
  assert.equal(r.plan.held[0].why, lossyWhy([LINT_SENTENCE]));
  assert.deepEqual(r.plan.amends.map((a) => [a.slug, a.fields]), [[y.slug, ["dials"]]], r.receipt);
  assert.deepEqual(r.plan.amends[0].row.data.dials, { stolen: true, clue: "No such thing as candy exists" }, "the strict spelling carries the whole dial");
  assert.deepEqual([r.plan.adds, r.plan.stops], [[], []]);
  assert.ok(r.receipt.includes(`HELD 1:\n  · ${x.slug} — ${lossyWhy([LINT_SENTENCE])}`), r.receipt);
  assert.ok(!r.receipt.includes("NOT CHECKED"));
  assert.ok(!statements.some((s) => /^(INSERT|UPDATE|DELETE)/i.test(s)), "a dry run writes nothing");
});

test("POS-619 · the mixed arm asks the HAND commit's text: a lossy hand edit the printout later re-spelled is still named", async () => {
  const repo = cloneAt(PIN, "mixed");
  const { picks: [, , z] } = await twoSitedMarks(repo);
  writeFileSync(z.file, setLine(readFileSync(z.file, "utf8"), "dials", LOSSY.slice("dials: ".length)));
  const hand = commitAll(repo, "hand: a lossy dial (pos619 fixture)");
  writeFileSync(z.file, setLine(readFileSync(z.file, "utf8"), "dials", STRICT.slice("dials: ".length)));
  commitAll(repo, "settlement: sweep (pos619 fixture)");
  const { paths, lossy, lossyOf } = await pathsAt(repo);
  assert.ok(!lossy.has(z.slug), "the ref's own text is strict");
  const mixed = new Map([[z.slug, { hands: [{ commit: { sha: hand } }], printouts: [] }]]);
  const out = withLossyHands(repo, lossy, mixed, paths, lossyOf);
  assert.deepEqual(out.get(z.slug), [LINT_SENTENCE]);
  assert.ok(!lossy.has(z.slug), "the ref's map is not mutated");
});

// ── the law pen: the heist's own mark ───────────────────────────────────────

// The candy class is world #195's (unmerged at the pin: it lands with the 10-18
// candy settlement, with its parent class `consumable`). Where the pinned law
// does not declare it yet, the fixture files it as #195 writes it, under
// `consumable` when the law has it and under `thing` (consumable's own parent)
// when it does not, so the heist's edit lands on a candy class either way.
const CANDY_195 = `---
kind: class
by: the-town
tier: constitution
date: 2026-10-13
class: candy
version: 1
extends: EXTENDS
dials: {}
labels: []
implements: []
source: LOGOS/classes.md
---

Candy is a consumable that comes in labels, each with its name and its creator; a label marks a count, never a class of its own.
`;
async function candyWith(dials, label) {
  const repo = cloneAt(PIN, label);
  const { rows } = await deriveLaw({ lawRepo: repo });
  let path = rows.find((r) => r.kind === "class" && r.key === "candy")?.path;
  if (!path) {
    const parent = rows.find((r) => r.kind === "class" && r.key === "consumable") ?? rows.find((r) => r.kind === "class" && r.key === "thing");
    assert.ok(parent, "the law declares consumable or thing, candy's ancestry");
    path = `${dirname(parent.path)}/candy/mark.md`;
    mkdirSync(join(repo, dirname(path)), { recursive: true });
    writeFileSync(join(repo, path), CANDY_195.replace("EXTENDS", parent.key));
    commitAll(repo, "world #195's candy class (pos619 fixture)");
    assert.ok((await deriveLaw({ lawRepo: repo })).rows.some((r) => r.kind === "class" && r.key === "candy"), "the fixture's candy class is declared");
  }
  const file = join(repo, path);
  writeFileSync(file, setLine(readFileSync(file, "utf8"), "dials", dials.slice("dials: ".length)));
  const sha = commitAll(repo, `the heist's edit, ${label} (pos619 fixture)`);
  return { repo, sha, path };
}

test("POS-619 · LAW: the heist's lossy spelling on the candy class is REFUSED whole, in the lint's words", async () => {
  const { repo, sha, path } = await candyWith(LOSSY, "law-lossy");
  const { lossy, lossyChecked } = await deriveLaw({ lawRepo: repo });
  assert.ok(lossyChecked);
  assert.deepEqual(lossy, [{ path, sentences: [LINT_SENTENCE] }]);
  const refusal = lossyRefusal(sha, lossy);
  assert.match(refusal, /^REFUSED: the law at [0-9a-f]{40} carries 1 mark\(s\) with a value the parser would silently lose[^\n]*Nothing was written; the law stays where it was \(POS-619\)\./);
  assert.ok(refusal.includes(`  ${path}: ${LINT_SENTENCE}`), refusal);

  const cli = spawnSync(process.execPath, ["world2/tools/law-ingest.mjs", "--law-repo", repo, "--sha", sha, "--dry-run"], { cwd: OFFICE, encoding: "utf8" });
  assert.equal(cli.status, 1, `the pen refuses: ${cli.stdout}\n${cli.stderr}`);
  assert.ok(cli.stderr.includes(refusal), cli.stderr);
  assert.doesNotMatch(cli.stdout, /law_projection:/, "no census: nothing was derived to write");
});

test("POS-619 · LAW: the strict-JSON spelling goes through, and the candy class carries the whole dial", async () => {
  const { repo, sha } = await candyWith(STRICT, "law-strict");
  const { rows, lossy } = await deriveLaw({ lawRepo: repo });
  assert.deepEqual(lossy, []);
  assert.equal(lossyRefusal(sha, lossy), null);
  assert.deepEqual(rows.find((r) => r.kind === "class" && r.key === "candy").data.dials, { stolen: true, clue: "No such thing as candy exists" });
  const cli = spawnSync(process.execPath, ["world2/tools/law-ingest.mjs", "--law-repo", repo, "--sha", sha, "--dry-run"], { cwd: OFFICE, encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
  assert.match(cli.stdout, new RegExp(`^dry-run · ${sha}\\n  law_projection: \\d+`));
  assert.doesNotMatch(cli.stderr, /REFUSED|NOT CHECKED/);
});
