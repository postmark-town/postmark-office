// canon-register.test.mjs — the falsifiers for the #2594 predicate.
//
// THE LAW THIS WAS BUILT FROM (Keemin, 2026-09-08 at the G1 sitting, verbatim —
// its lock-time half WITHDRAWN the same evening; the next section says where):
//
//   "refusal at the candle. A claim that would lock while the mark it
//    materializes has no file on main at the locking crossing is REFUSED at the
//    clearing job's lock step, naming the slug and the world sha — not held for
//    review."
//
// ── WHERE THIS PREDICATE IS ASKED, AND WHERE IT IS NOT (RE-RULED 2026-09-08) ─
//
// NOT at the candle. The reviewer timed the two units' journals over seven
// consecutive crossings and the settlement's push lands three to four minutes
// AFTER the candle clears — never once before — so a canon check at the lock
// step refuses the marks its own crossing just locked. Keemin withdrew the
// lock-time refusal the same evening. This predicate now serves the NIGHTLY read
// on the notary rail, where the push is nine hours old, and the `fold` backend
// at the G1 swap.
//
// ── WHAT THESE CAN AND CANNOT PROVE ─────────────────────────────────────────
//
// `falsifier-canon-locks.mjs` and `review-rule.mjs` — this predicate's two
// callers — are CLI tools: `process.argv`, `process.exit`, a store URL from the
// environment. So no test here reaches their WIRING, and nothing in
// `clearing-job.mjs` calls this predicate at all since the withdrawal. That is a
// property of the files' shape, not of their content, and saying otherwise is
// the defect this room has already recorded once (the hydrate fold,
// 2026-09-08). What these prove is the PREDICATE. What proves the read's wiring
// is the rehearsal in `docs/2026-09-08/jetto-candle-refusal-report.md` § C —
// the read on the pre-cutover dump, five findings, then one after the retire —
// and the lap-4 review's run of it against prod on the notary rail.
//
// ── THE CAN-FAIL FLIP, REPRODUCIBLE ─────────────────────────────────────────
//
// In `world2/tools/canon-register.mjs § canonAbsentAmong`, delete the membership
// test so every named claim is reported absent:
//
//     -    if (register.slugs.has(slug)) continue;
//
// That is the shape of "the check refuses everything", which is the failure the
// 26-of-27 measurement in the file's header is about. Its split is recorded in
// the report beside the run.
//
// The OTHER flip, and it is the one that matters, is the reverse — delete the
// push instead, so the check never refuses anything:
//
//     -    absent.push({ id: c.id, slug, check: canonAbsentCheck(slug, register.sha) });
//
// A test suite that only reds on the first flip is watching the town's safety and
// not the ruling's; both are run, and both splits are in the report.

import { townHoldsOf } from "../world2/tools/canon-register.mjs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

import {
  canonRegisterAt, canonRegisterAtSha, canonAbsentAmong, canonAbsentCheck, CANON_BACKENDS, CANON_ABSENT_CHECK,
} from "../world2/tools/canon-register.mjs";
import { slugOf } from "../world2/tools/materialize.mjs";

// ── the fixture checkout ─────────────────────────────────────────────────────
//
// A REAL git checkout with a REAL `tools/marks-fold.mjs`, because the predicate's
// two load-bearing moves are `git rev-parse HEAD` and a dynamic import out of the
// checkout ("the code that parses sha X is the code that shipped at sha X"). A
// fixture that stubbed either of those would be testing a different function.
const made = [];
function worldFixture(ids, { unreadable = [] } = {}) {
  const dir = mkdtempSync(join(tmpdir(), "canon-reg-"));
  made.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  const records = [
    ...ids.map((id) => ({ id, kind: "sited" })),
    ...unreadable.map((id) => ({ id, kind: "sited", _error: "unparseable" })),
  ];
  writeFileSync(join(dir, "tools", "marks-fold.mjs"),
    `export const loadMarks = () => (${JSON.stringify(records)});\n`);
  writeFileSync(join(dir, "WORLD", "marks", ".keep"), "");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  git("add", "-A");
  git("commit", "-qm", "fixture");
  return dir;
}
test.after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const claim = (id, slug) => ({ id, slug });

// ── 1 · the register is the checkout's own, at the checkout's own sha ────────
test("the register is read from the checkout, and the sha is the checkout's HEAD", async () => {
  const dir = worldFixture(["darko/the-first-stone", "wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.equal(reg.count, 2);
  assert.ok(reg.slugs.has("darko/the-first-stone"));
  assert.match(reg.sha, /^[0-9a-f]{40}$/);
  assert.equal(reg.sha, execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim());
});

// ── 2 · the three instances, and a control that must lock ───────────────────
//
// The claims are the real ones off prod: `darko/the-second-foundation-stone`
// carries its slug in `geometry` and NOT in `claims.slug` (a pre-006 lab row —
// measured on prod 2026-09-08: `slug IS NULL`, `geometry->>'slug'` set), so this
// also proves the predicate goes through `slugOf`'s shim rather than reading the
// column. Reading `c.slug` would have let the foundation stone through — the
// exact mark the ruling was written about.
test("the three never-stood marks are absent; a mark canon carries is not", async () => {
  const dir = worldFixture(["berthillon/pistache-cone-for-julian", "wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  const batch = [
    { id: "2a2463c0", slug: null, geometry: { slug: "darko/the-second-foundation-stone" } },
    claim("03c8470b", "wright/final-unstaked"),
    claim("5bc276b7", "little-bird/the-second-spoon-verdict"),
    claim("control", "berthillon/pistache-cone-for-julian"),
  ];
  const absent = canonAbsentAmong(batch, reg, slugOf);
  assert.deepEqual(absent.map((a) => a.slug).sort(), [
    "darko/the-second-foundation-stone",
    "little-bird/the-second-spoon-verdict",
    "wright/final-unstaked",
  ]);
  assert.ok(!absent.some((a) => a.id === "control"), "a claim whose mark canon carries must LOCK, not be refused");
});

// ── 3 · the check string is the writers' grammar ────────────────────────────
test("the finding's check string is `canon-absent: <slug> @ <sha8>` and splits on the first colon", async () => {
  const dir = worldFixture(["wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  const [only] = canonAbsentAmong([claim("x", "lupi/the-drift-room")], reg, slugOf);
  assert.equal(only.check, `canon-absent: lupi/the-drift-room @ ${reg.sha.slice(0, 8)}`);
  assert.equal(only.check.slice(0, only.check.indexOf(":")), CANON_ABSENT_CHECK);
});

// ── 4 · a claim that names no mark is not refused ───────────────────────────
//
// `materializeClaims` filters on exactly this ("a stake or escrow claim names no
// mark"). A predicate that refused them would refuse every stake in the town for
// a mark it was never going to make.
test("a claim that names no mark cannot be canon-absent", async () => {
  const dir = worldFixture(["wright/the-lit-name"]);
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.deepEqual(canonAbsentAmong([{ id: "stake", slug: null, geometry: { at: { x: 1, y: 2 } } }], reg, slugOf), []);
});

// ── 5 · an empty register is a CANNOT RUN, never "canon carries nothing" ────
//
// The one that shuts the town if it is wrong: an empty answer would refuse every
// claim at the next crossing. The siblings' rule, at the place it costs most.
test("a checkout that loads no marks refuses to answer", async () => {
  const dir = worldFixture([]);
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: dir }),
    /loads no marks — refusing to treat an empty register/);
});

// ── 6 · the backends ────────────────────────────────────────────────────────
test("the fold backend is not built and says so, loudly", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "fold" }),
    /the 'fold' backend is not built/);
  assert.deepEqual([...CANON_BACKENDS], ["git", "fold"]);
});

test("an unknown backend is a throw, not a default", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "guess" }), /unknown backend/);
});

// ── 7 · a checkout git cannot answer for ────────────────────────────────────
test("no checkout, and a checkout with no WORLD/marks, both refuse", async () => {
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: null }), /no world checkout/);
  const dir = mkdtempSync(join(tmpdir(), "canon-reg-bare-"));
  made.push(dir);
  await assert.rejects(() => canonRegisterAt({ backend: "git", worldRepo: dir }), /no WORLD\/marks under/);
});

// ── 8 · an unreadable record states nothing either way ──────────────────────
//
// It is neither counted as carried (which would launder a broken file into a
// pass) nor as absent (which is not this function's call), and it is REPORTED so
// the crossing's log names it.
test("a record the loader could not parse is reported, not counted", async () => {
  const dir = worldFixture(["wright/the-lit-name"], { unreadable: ["broken/mark"] });
  const reg = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.equal(reg.count, 1);
  assert.deepEqual(reg.unreadable, ["broken/mark"]);
  assert.equal(canonAbsentAmong([claim("b", "broken/mark")], reg, slugOf).length, 1);
});

// ── 9 · the short sha is the check's, the full sha is the receipt's ─────────
test("canonAbsentCheck never invents a sha it was not given", () => {
  assert.equal(canonAbsentCheck("a/b", null), "canon-absent: a/b @ ?");
  assert.equal(canonAbsentCheck("a/b", "0123456789abcdef"), "canon-absent: a/b @ 01234567");
});

const caughtAsync = async (fn) => { try { await fn(); return null; } catch (e) { return e; } };

// ── 6 · THE REGISTER AT A NAMED SHA (2026-09-12) ─────────────────────────────
//
// WHY THIS SIBLING EXISTS, and it is a defect a reviewer caught in the carry
// lane rather than a generalisation anyone wanted.
//
// `canonRegisterAt` stamps `git rev-parse HEAD` and reads the WORKING TREE. For
// the notary at 03:20 those are the same state and the answer is right. For the
// settlement crossing they are NOT: `deploy/settlement-auto.sh` reads
// `WORLD_FROM` from `origin/main` and checks the clone out at it (:303-304), and
// then COMMITS `WORLD/households.json` onto that same clone whenever the
// household registry moved (:386-395) — the script says so itself at :418-425,
// "main may already be ahead of origin/main at this line, because the registry
// refresh commits before the fold". So on any crossing after a household
// declaration, HEAD is one commit past `WORLD_FROM`, and a register stamped HEAD
// would make the fold's own equality check refuse a crossing that was fine.
//
// THE FIX IS NOT TO LOOSEN THE CHECK. It is to make the register answer about
// the sha the crossing names, so `register.sha === worldSha` holds BY
// CONSTRUCTION and the equality check stays as the falsifier for the day
// something else moves.
//
// THE TREE IS MATERIALIZED AND `loadMarks` IS STILL THE ONE PARSER. Enumerating
// `git ls-tree -r --name-only <sha>` and reading slugs off the PATHS would be a
// second reader and a recorded defect besides: the identity is `by/<leaf>` where
// `by` comes from the mark's own frontmatter, and "the PATH is a different string
// and is never the identity" (`review-g1-retire.md` repair 1). So the blobs at
// the sha are written to a scratch directory and the checkout's own loader reads
// them, exactly as it reads a checkout.
//
// The fixture below therefore ships a `loadMarks` that REALLY READS THE
// DIRECTORY it is handed. The stub used by the tests above returns a constant,
// which cannot tell a read at a sha from a read at HEAD — it would pass on the
// broken function.

/**
 * A world checkout whose `loadMarks` genuinely walks the tree, so a read at a
 * sha and a read at HEAD can DISAGREE and the test can see it.
 */
function readingWorldFixture() {
  const dir = mkdtempSync(join(tmpdir(), "canon-sha-"));
  made.push(dir);
  mkdirSync(join(dir, "tools"), { recursive: true });
  mkdirSync(join(dir, "WORLD", "marks"), { recursive: true });
  writeFileSync(join(dir, "tools", "marks-fold.mjs"), [
    'import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";',
    'import { join, basename } from "node:path";',
    "export function loadMarks(dir) {",
    "  const out = [];",
    "  if (!existsSync(dir)) return out;",
    "  for (const owner of readdirSync(dir)) {",
    "    const od = join(dir, owner);",
    "    if (!statSync(od).isDirectory()) continue;",
    "    for (const leaf of readdirSync(od)) {",
    "      const md = join(od, leaf, 'mark.md');",
    "      if (!existsSync(md)) continue;",
    "      const text = readFileSync(md, 'utf8');",
    "      const by = (text.match(/^by:\\s*(.+)$/m) || [])[1];",
    "      out.push(by ? { id: by.trim() + '/' + basename(join(od, leaf)), kind: 'sited' }",
    "                  : { id: leaf, _error: 'no by' });",
    "    }",
    "  }",
    "  return out;",
    "}",
  ].join("\n"));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: "pipe" });
  git("init", "-q");
  git("config", "user.email", "test@example.invalid");
  git("config", "user.name", "test");
  return { dir, git };
}

const addMark = (dir, id) => {
  const [by, leaf] = [id.slice(0, id.indexOf("/")), id.slice(id.indexOf("/") + 1)];
  mkdirSync(join(dir, "WORLD", "marks", by, leaf), { recursive: true });
  writeFileSync(join(dir, "WORLD", "marks", by, leaf, "mark.md"), `---\nby: ${by}\nkind: sited\n---\n\nbody\n`);
};

test("the register at a NAMED SHA answers about that sha, not about HEAD", async () => {
  const { dir, git } = readingWorldFixture();
  addMark(dir, "darko/the-first-stone");
  git("add", "-A"); git("commit", "-qm", "one");
  const first = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  addMark(dir, "wright/the-lit-name");
  git("add", "-A"); git("commit", "-qm", "two");
  const second = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  const atFirst = await canonRegisterAtSha({ worldRepo: dir, sha: first });
  assert.equal(atFirst.sha, first, "the register is stamped with the sha it was ASKED for");
  assert.deepEqual([...atFirst.slugs].sort(), ["darko/the-first-stone"],
    "and it carries what canon carried THERE — the second mark does not exist at this sha");

  const atHead = await canonRegisterAt({ backend: "git", worldRepo: dir });
  assert.equal(atHead.sha, second, "the notary's call is untouched and still reads HEAD");
  assert.deepEqual([...atHead.slugs].sort(), ["darko/the-first-stone", "wright/the-lit-name"]);
});

test("THE REGISTRY-REFRESH SHAPE · a households-only commit on top does not move the answer", async () => {
  // The reviewer's case, exactly. `settlement-auto.sh` commits WORLD/households.json
  // onto the clone before the fold, so HEAD is one past WORLD_FROM. The marks tree
  // is byte-identical, so the ANSWER never moved — only the stamp would have, and
  // the stamp is what the fold's equality check reads.
  const { dir, git } = readingWorldFixture();
  addMark(dir, "neth/warm-stone-for-whoever-waits");
  addMark(dir, "sophia-familiaris/reachability-is-not-permission");
  git("add", "-A"); git("commit", "-qm", "marks");
  const worldFrom = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();

  writeFileSync(join(dir, "WORLD", "households.json"), JSON.stringify({ logins: { yannlugrin: "gh:1" } }, null, 1));
  git("add", "-A"); git("commit", "-qm", "the household registry moved");
  const head = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  assert.notEqual(head, worldFrom, "the fixture must actually reproduce the advance, or it proves nothing");

  const reg = await canonRegisterAtSha({ worldRepo: dir, sha: worldFrom });
  assert.equal(reg.sha, worldFrom,
    "the register names the crossing's own world sha, so `register.sha === worldSha` holds BY CONSTRUCTION");
  assert.deepEqual([...reg.slugs].sort(),
    ["neth/warm-stone-for-whoever-waits", "sophia-familiaris/reachability-is-not-permission"]);
});

test("a sha this clone does not hold REFUSES, and names it", async () => {
  // Never a silent empty register: an empty one would make every standing mark
  // absent and hand the crossing the whole corpus to carry.
  const { dir, git } = readingWorldFixture();
  addMark(dir, "darko/the-first-stone");
  git("add", "-A"); git("commit", "-qm", "one");
  const e = await caughtAsync(() => canonRegisterAtSha({ worldRepo: dir, sha: "b".repeat(40) }));
  assert.ok(e, "it must refuse");
  assert.match(e.message, /bbbbbbbb/, "and name the sha, or the operator cannot tell which clone was wrong");
});

test("a sha that is not a sha REFUSES before it touches the clone", async () => {
  const { dir, git } = readingWorldFixture();
  addMark(dir, "darko/the-first-stone");
  git("add", "-A"); git("commit", "-qm", "one");
  const e = await caughtAsync(() => canonRegisterAtSha({ worldRepo: dir, sha: "HEAD" }));
  assert.ok(e, "a ref name is not a sha: the register must name the STATE, not a moving pointer");
  assert.match(e.message, /HEAD/);
});

test("a sha whose marks tree is EMPTY is a CANNOT-RUN, never `canon carries nothing`", async () => {
  // The siblings' rule at the one place getting it wrong would carry the whole
  // standing corpus into a single crossing.
  const { dir, git } = readingWorldFixture();
  writeFileSync(join(dir, "WORLD", "households.json"), "{}");
  git("add", "-A"); git("commit", "-qm", "no marks at all");
  const empty = execFileSync("git", ["-C", dir, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
  const e = await caughtAsync(() => canonRegisterAtSha({ worldRepo: dir, sha: empty }));
  assert.ok(e, "an empty register must refuse");
  assert.match(e.message, /loads no marks|no WORLD\/marks/);
});

test("TOWN HOLDS · townHoldsOf keeps the town's own records' holder and owner, null when canon prints none, and no one else's", () => {
  const holds = townHoldsOf([
    { id: "the-town/a-key", by: "the-town", held_by: "wright/a-knight", owned_by: " kai " },
    { id: "the-town/a-sign", by: "the-town" },
    { id: "alpha/held-thing", by: "alpha", held_by: "beta" },
    { id: "the-town/broken", by: "the-town", _error: "unparseable" },
  ]);
  assert.deepEqual([...holds.entries()], [
    ["the-town/a-key", { held_by: "wright/a-knight", owned_by: "kai" }],
    ["the-town/a-sign", { held_by: null, owned_by: null }],
  ]);
});
