// store-writedown-path-collision.test.mjs — A FILING IS ONE IDENTITY'S: HOLD THE COLLIDING PUBLICATION, PRESERVE BOTH RECORDS (WLD-230).
//
// THE INCIDENT (2026-11-21, window 325, the 18:00Z settlement REFUSED at the harm gate: "lost: seth/signed-la-linterna"). `pathFor` files a
// predicate (neither sited nor a parcel) at `<parent>/<slug>/mark.md` WITHOUT its author. Seth's `signed-la-linterna` under Bramblewick's
// guestbook was published at that path; Lyra's same-slug, different-author predicate under the same guestbook planned the SAME path, and the
// write-down's upsert replaced Seth's file with hers. The world loader's identity is `by` plus the directory leaf, so the fold lost
// `seth/signed-la-linterna` and gained `lyra-of-the-east-tower/signed-la-linterna`. Nothing was renamed; a file was overwritten.
//
// THE RULING (Darko, 2026-11-21 14:58 EST, "Yes"; Wright 20:04Z): "in the store writedown's plan, a non-sited mark whose planned path is already
// the published filing of a different id is held (not written, reported separately, excluded from the written counts, row preserved for the
// canon-absent carry), never a FoldInputRefusal." Seth's bytes, identity, parent and filing stay; Lyra is held/unpublished, her store row
// untouched; nothing is renamed or relocated; unrelated publications proceed.
//
// WHAT THIS FILE RUNS. The exact pair through the REAL `storeWriteDown` over a scratch world repo (the canon-file lookups are git reads at
// main, not an injected decision), then the world's OWN fold over the sketchbook it wrote; the same-id amend and the unrelated publication
// as controls; and the plan's edges. Every name here is invented.
//   node --test test/store-writedown-path-collision.test.mjs
//
// FALSIFIER (run, see the PR): take the `pathCollision` guard out of the plan and the exact-pair test goes red on Seth's bytes, on the
// held list and on the written count (an omitted Lyra still counted as written is the harm gate's second direction).

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { fileFramer } from "../src/world-drain.mjs";
import { filingOccupantId, normalizeMark, pathCollision, planStoreWriteDown, storeWriteDown } from "../src/store-writedown.mjs";
import { markRecord } from "../src/mark-record.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORLD = [process.env.POSTMARK_WORLD_CLONE, process.env.WORLD_CLONE, join(OFFICE, "world-clone"), join(OFFICE, "..", "postmark-world")]
  .filter(Boolean).find((c) => existsSync(join(c, "tools", "marks-fold.mjs"))) ?? null;
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE): this file needs the real loader";

const GUESTBOOK = "bramblewick/libro-de-visitas-de-la-linterna";
const GUESTBOOK_FILE = `WORLD/marks/${GUESTBOOK}/mark.md`;
const SETH_FILE = `WORLD/marks/${GUESTBOOK}/signed-la-linterna/mark.md`;
const SETH = "seth/signed-la-linterna";
const LYRA = "lyra-of-the-east-tower/signed-la-linterna";
const SOUP = "nico-ferraz/soup-of-the-day";
const SOUP_FILE = "WORLD/marks/nico-ferraz/soup-of-the-day/mark.md";

const rec = (fields, body) => `---\n${fields.join("\n")}\n---\n\n${body}\n`;
const SETH_BYTES = rec(["kind: predicated", "by: seth", "date: 2026-11-19T07:25:55.406Z", "slot: sign", "value: Seth"], "Seth, from Seth's Folly: llegué.");

/** The store's row for a predicate under the guestbook, as the fold input carries it: the record and its bytes. */
function predicate({ by, slug = "signed-la-linterna", value, body, household, window = 325, date = "2026-11-21T13:51:56.260Z" }) {
  const fileRec = { kind: "predicated", by, date, slot: "sign", value, parent_id: GUESTBOOK };
  return { slug: `${by}/${slug}`, kind: "predicated", by, household, locked_window: window, status: "standing", founder_commit: null,
    fileRec, body, at_frame: "file", bytes: markRecord(fileRec, body) };
}
function sitedMark({ by, slug, body, household, window = 325 }) {
  const fileRec = { kind: "sited", by, date: "2026-11-21T13:00:00.000Z", at: { x: 40, y: 40 }, extent: { w: 2, h: 2 } };
  return { slug: `${by}/${slug}`, kind: "sited", by, household, locked_window: window, status: "standing", founder_commit: null,
    fileRec, body, at_frame: "world", bytes: markRecord(fileRec, body) };
}
const LYRA_ROW = () => predicate({ by: "lyra-of-the-east-tower", value: "Lyra", household: "gh:222",
  body: "Lyra, of the East Tower: residue. He took the lived half and left the kept." });
const SOUP_ROW = () => sitedMark({ by: "nico-ferraz", slug: "soup-of-the-day", household: "gh:333", body: "Today's soup is leek." });

function world(t) {
  const repo = mkdtempSync(join(tmpdir(), "postmark-storewd-collide-"));
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });
  const put = (p, text) => { mkdirSync(join(repo, dirname(p)), { recursive: true }); writeFileSync(join(repo, p), text); };
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  put("package.json", JSON.stringify({ name: "world-fixture", type: "module" }));
  put("WORLD/skeleton.json", `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  put("WORLD/households.json", `${JSON.stringify({
    households: { seth: "gh:111", "lyra-of-the-east-tower": "gh:222", "nico-ferraz": "gh:333", bramblewick: "gh:444" },
    logins: { "seth-agent": "gh:111", "lyra-agent": "gh:222", "nico-agent": "gh:333", "bramblewick-agent": "gh:444" } }, null, 2)}\n`);
  put("WORLD/marks/let-there-be-light/mark.md", rec(["kind: sited", "by: the-town", "tier: constitution", "date: 2026-07-22",
    "at: { x: 0, y: 0 }", "extent: { w: 320000, h: 320000 }", "coords: relative"], "Let there be light."));
  put(GUESTBOOK_FILE, rec(["kind: sited", "by: bramblewick", "date: 2026-11-01", "at: { x: 10, y: 10 }", "extent: { w: 4, h: 4 }"], "The lantern's guestbook."));
  put(SETH_FILE, SETH_BYTES);
  put("WORLD/filing-freeze.json", `${JSON.stringify({ frozen_at: "2026-08-25", marks: {} }, null, 2)}\n`);
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "canon: Seth signed the guestbook (S179)");
  return { repo, git };
}

const INPUT = (marks) => ({ marks, stakes: [], as_of: { window: 325, world_sha: "dc462e74", town_sha: "910bba7e" },
  selection: { by: "docket", window: 325, docket_claims: marks.length, carried_absent: { checked: true, count: 0 } } });
const AT = Date.parse("2026-11-21T18:02:50Z");
const run = async (w, marks) => storeWriteDown({ repo: w.repo, at: AT, toFileFrame: await fileFramer(w.repo), input: INPUT(marks) });

/** The world's own fold over a branch's WORLD tree: the ids it holds (the harm gate's reading of "lost" and "gained"). */
function foldIds(w, ref) {
  const dir = mkdtempSync(join(tmpdir(), "postmark-storewd-collide-fold-"));
  try {
    cpSync(join(WORLD, "tools"), join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));
    for (const p of w.git("ls-tree", "-r", "--name-only", ref, "--", "WORLD").trim().split("\n").filter(Boolean)) {
      mkdirSync(join(dir, dirname(p)), { recursive: true });
      writeFileSync(join(dir, p), w.git("show", `${ref}:${p}`));
    }
    execFileSync(process.execPath, [join(dir, "tools", "marks-fold.mjs")], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    const marks = JSON.parse(readFileSync(join(dir, "WORLD", "world-state.json"), "utf8")).marks;
    return new Map(marks.map((m) => [m.id, m]));
  } finally { try { rmSync(dir, { recursive: true, force: true }); } catch { /* litter */ } }
}

// ── THE EXACT PAIR, through the real write-down ─────────────────────────────────────────────────────────────────

test("THE INCIDENT: Lyra's same-slug predicate is HELD; Seth's bytes, identity and filing stand; the unrelated publication proceeds; the accounting says so", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  assert.ok(foldIds(w, "main").has(SETH), "canon: Seth's signature stands under the guestbook");
  const out = await run(w, [LYRA_ROW(), SOUP_ROW()]);

  // the account of the crossing: one held (named, with whose filing), one written, nothing thrown
  assert.equal(out.refused, undefined, "a hold, never a FoldInputRefusal (which would abort the whole crossing)");
  assert.deepEqual(out.held_path_collision.map((h) => ({ id: h.id, path: h.path, held_by_filing_of: h.held_by_filing_of, crossing_output: h.crossing_output })),
    [{ id: LYRA, path: SETH_FILE, held_by_filing_of: SETH, crossing_output: "path-held-by-another-id" }]);
  assert.equal(out.held_path_collision_count, 1);
  assert.equal(out.marks, 2, "offered");
  assert.equal(out.written, 1, "only the soup: the held mark is NOT counted as written");
  assert.equal(out.counts.held, 1);
  assert.equal(out.counts.written, 1);
  assert.deepEqual(out.written_by_locked_window, { 325: 1 }, "and not in the per-window written histogram");
  assert.equal(out.unchanged_skipped, 0);
  assert.deepEqual(out.held_unbound, [], "a different hold: the unbound-household list is not where this goes");

  // what the sweep would see: only the soup's household has a sketchbook; Lyra's household opened none
  assert.deepEqual(out.households.map((h) => h.household_key), ["gh:333"]);
  const branch = out.households[0].branch;
  assert.equal(w.git("show", `${branch}:${SETH_FILE}`), SETH_BYTES, "Seth's file is byte for byte what canon holds");
  assert.equal(w.git("show", `${branch}:${SOUP_FILE}`).includes("Today's soup is leek."), true, "the unrelated publication was written");
  const grep = (() => { try { return w.git("grep", "-l", "lyra-of-the-east-tower", branch, "--", "WORLD/marks").trim(); } catch { return ""; } })(); // git grep exits 1 on no match
  assert.equal(grep, "", "no byte of Lyra's is in the tree: unpublished");
  assert.equal(w.git("branch", "--list", "*lyra*").trim(), "", "and no sketchbook was opened for her");

  // the harm gate's two directions, on the world's own fold over what the sweep would publish
  const ids = foldIds(w, branch);
  assert.ok(ids.has(SETH), "Seth is not lost");
  assert.equal(ids.get(SETH).parent ?? ids.get(SETH).placementParent ?? GUESTBOOK, GUESTBOOK, "and his parent is the guestbook still");
  assert.equal(ids.has(LYRA), false, "Lyra is NOT in the tree, and so she is named nowhere as published");
  assert.ok(ids.has(SOUP), "the soup is");
});

test("the hold repeats: the same crossing run again holds the same mark the same way, and changes nothing about Seth", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  const a = await run(w, [LYRA_ROW(), SOUP_ROW()]);
  const b = await run(w, [LYRA_ROW(), SOUP_ROW()]);
  assert.deepEqual(b.held_path_collision, a.held_path_collision);
  assert.equal(b.written, 1);
  assert.equal(w.git("show", `main:${SETH_FILE}`), SETH_BYTES, "canon is untouched by either run");
});

test("only the collision is held: a crossing of just Lyra writes nothing and opens no sketchbook, and is no refusal", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  const out = await run(w, [LYRA_ROW()]);
  assert.equal(out.refused, undefined);
  assert.equal(out.written, 0);
  assert.equal(out.held_path_collision_count, 1);
  assert.deepEqual(out.households, []);
});

// ── CONTROLS ────────────────────────────────────────────────────────────────────────────────────────────────

test("CONTROL, same-id amend: Seth amending his OWN signature is written at the same filing, and is not held", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  const amend = predicate({ by: "seth", value: "Seth", household: "gh:111", window: 326, date: "2026-11-19T07:25:55.406Z",
    body: "Seth, from Seth's Folly: llegué, and I am glad I did." });
  const out = await run(w, [amend]);
  assert.equal(out.held_path_collision_count, 0);
  assert.equal(out.written, 1);
  const branch = out.households[0].branch;
  assert.match(w.git("show", `${branch}:${SETH_FILE}`), /glad I did/, "his amend reaches his own file");
  assert.match(w.git("show", `${branch}:${SETH_FILE}`), /^by: seth$/m);
  const ids = foldIds(w, branch);
  assert.ok(ids.has(SETH) && !ids.has(LYRA));
});

test("CONTROL, same bytes: a mark canon already holds identically is 'unchanged', not held", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  const same = { ...predicate({ by: "seth", value: "Seth", household: "gh:111", window: 326, date: "2026-11-19T07:25:55.406Z", body: "Seth, from Seth's Folly: llegué." }) };
  const out = await run(w, [same]);
  assert.equal(out.held_path_collision_count, 0);
  assert.equal(out.unchanged_skipped, 1);
  assert.equal(out.written, 0);
});

test("CONTROL, unrelated publications: a predicate with a slug no filing holds, and a sited mark, are written as before", { skip: WHY_SKIP }, async (t) => {
  const w = world(t);
  const fresh = predicate({ by: "lyra-of-the-east-tower", slug: "signed-another", value: "Lyra", household: "gh:222", body: "Lyra signs a page of her own." });
  const out = await run(w, [fresh, SOUP_ROW()]);
  assert.equal(out.held_path_collision_count, 0);
  assert.equal(out.written, 2);
  const lyra = out.households.find((h) => h.household_key === "gh:222");
  assert.match(w.git("show", `${lyra.branch}:WORLD/marks/${GUESTBOOK}/signed-another/mark.md`), /Lyra signs a page of her own\./);
  assert.equal(w.git("show", `${lyra.branch}:${SETH_FILE}`), SETH_BYTES);
});

// ── THE PLAN AND ITS EDGES (pure) ───────────────────────────────────────────────────────────────────────────────

const planOf = (rows, { canon = {}, published = {} } = {}) => planStoreWriteDown(rows.map(normalizeMark), {
  publishedPathOf: (id) => published[id] ?? (id === GUESTBOOK ? GUESTBOOK_FILE : null),
  canonBytesAt: (p) => (p in canon ? canon[p] : null),
});

test("the plan: the held mark is named, excluded from written, bucketed nowhere; the rest is untouched", () => {
  const plan = planOf([LYRA_ROW(), SOUP_ROW()], { canon: { [SETH_FILE]: SETH_BYTES } });
  assert.equal(plan.held.length, 1);
  assert.deepEqual(plan.held[0], { id: LYRA, by: "lyra-of-the-east-tower", slug: "signed-la-linterna", household: "gh:222", locked_window: 325, path: SETH_FILE,
    held_by_filing_of: SETH, crossing_output: "path-held-by-another-id" });
  assert.deepEqual(plan.counts, { marks: 2, written: 1, unchanged: 0, held: 1, framed: 0, households: 1, removed: 0, written_by_locked_window: { 325: 1 } });
  assert.deepEqual(plan.households.map((h) => h.household), ["gh:333"]);
});

test("the guard's edges: sited and parcel never; its own published filing never; no file or no author is no occupant; a same-author same-slug file is the same id", () => {
  const canon = { [SETH_FILE]: SETH_BYTES };
  const ask = (m, path = SETH_FILE, published = {}) => pathCollision(m, path, {
    publishedPathOf: (id) => published[id] ?? null, canonBytesAt: (p) => (p in canon ? canon[p] : null) });
  const lyra = normalizeMark(LYRA_ROW());
  assert.equal(ask(lyra)?.held_by_filing_of, SETH);
  assert.equal(ask({ ...lyra, kind: "sited", fileRec: { ...lyra.fileRec, kind: "sited" } }), null, "a sited mark files at its own author's root: no collision arises");
  assert.equal(ask({ ...lyra, kind: "parcel", fileRec: { ...lyra.fileRec, kind: "parcel" } }), null);
  assert.equal(ask(lyra, SETH_FILE, { [LYRA]: SETH_FILE }), null, "the path is her OWN published filing: an amend, not a collision");
  assert.equal(ask(lyra, "WORLD/marks/bramblewick/elsewhere/signed-la-linterna/mark.md"), null, "canon holds nothing there");
  assert.equal(pathCollision(lyra, SETH_FILE, { canonBytesAt: null }), null, "no canon reader: the plan is as it was");
  assert.equal(pathCollision(lyra, null, { canonBytesAt: () => SETH_BYTES }), null);
  assert.equal(filingOccupantId(SETH_FILE, SETH_BYTES), SETH);
  assert.equal(filingOccupantId(SETH_FILE, rec(["kind: predicated", "slot: sign"], "no author")), null, "a file that names no author is not an occupant");
  assert.equal(ask(normalizeMark(predicate({ by: "seth", value: "Seth", household: "gh:111", body: "again" }))), null, "the same id (by + leaf) at its own file");
});
