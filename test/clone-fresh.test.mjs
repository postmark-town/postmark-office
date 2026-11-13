// clone-fresh.test.mjs — A DIRTY TOWN CLONE REFUSES BY NAME, NOT AS A RAW 500 (POS-382; postmark-office#252; neth, 2026-09-28).
//
//   node --test test/clone-fresh.test.mjs
//
// Every write that lands a file on the town clone begins `git pull --rebase`, which git refuses on any uncommitted change to a tracked file. Those writes let the
// refusal escape as the machinery's: `cannot pull with rebase: You have unstaged changes`, a 500 that reads to a resident as lost stamps. clone-fresh.mjs is the one
// place that pulls, and the one refusal it gives. Claims:
//   1. THE FIXTURE IS THE FAILURE: on a dirtied disposable clone a bare `git pull --rebase` fails with git's raw words (the text the residents saw), and a letter
//      write through the OLD pull would have escaped with them. Without the fix the letter and exec tests below fail on exactly that text.
//   2. THE REFUSAL IS NAMED AND WRITES NOTHING: the 503 "the office's town copy needs tending; nothing was written", before any file, commit or row; the pre-existing dirt is
//      left exactly as it was (never stashed, reset or rebased over); HEAD does not move.
//   3. A WRITER IN FLIGHT IS WAITED FOR, ABANDONED DIRT IS REFUSED: dirt that clears inside the wait lets the write go; dirt that stays is the refusal. Untracked files
//      never refuse; a staged change, a conflicted index and a half-way rebase do.
//   4. A CLEAN CLONE WRITES AS IT ALWAYS DID.
//   5. THE EXECS ANSWER IT: a stake, a gift and a ballot act, run as the child the door spawns, print the refusal as their one JSON answer line (exit 0), not a stack (exit 1).
//   6. ONE HELPER: no write in src/ runs its own `git pull --rebase` any more (the swallowing reads, walk and crossing, are the two named exceptions).

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import { freshenClone, cloneDirt, needsTendingError, isNeedsTending, NEEDS_TENDING } from "../src/clone-fresh.mjs";
import { enqueueLetter } from "../src/write.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const BOT = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];
const NAMED = "the office's town copy needs tending; nothing was written";

const homes = [];
function town() {
  const dir = mkdtempSync(join(tmpdir(), "clone-fresh-"));
  homes.push(dir);
  const origin = join(dir, "origin.git");
  const clone = join(dir, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  sh(clone, "config", "core.autocrlf", "false");
  sh(clone, "checkout", "-q", "-B", "main");
  for (const [rel, text] of Object.entries({
    "WHITE_PAGES/stamp-ledger.md": "# the stamp ledger\n\n- 2026-09-01 · seed row\n",
    "WHITE_PAGES/wright/ADDRESS.md": "---\nhandle: wright\n---\n\n# wright\n",
    "WHITE_PAGES/limen/ADDRESS.md": "---\nhandle: limen\n---\n\n# limen\n",
  })) { mkdirSync(dirname(join(clone, rel)), { recursive: true }); writeFileSync(join(clone, rel), text); }
  sh(clone, "add", "-A");
  sh(clone, ...BOT, "commit", "-qm", "fixture town");
  sh(clone, "push", "-q", "-u", "origin", "main");
  return { dir, origin, clone };
}
after(() => { for (const d of homes) rmSync(d, { recursive: true, force: true, maxRetries: 5 }); });

/** Everything a reader of the clone could see: HEAD, the status, and every file's bytes. */
function snapshot(clone) {
  const files = {};
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (d === clone && name === ".git") continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs);
      else files[relative(clone, abs).replace(/\\/g, "/")] = createHash("sha256").update(readFileSync(abs)).digest("hex");
    }
  };
  walk(clone);
  return { head: sh(clone, "rev-parse", "HEAD"), status: sh(clone, "status", "--porcelain", "--untracked-files=all"), files };
}
/** The abandoned dirt of 2026-09-28: a signed ledger line appended and never committed. */
const dirty = (t) => appendFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-28 · a line the catch-up appended and never committed\n");
const withPush = async (fn) => { const was = process.env.TOWN_PUSH; process.env.TOWN_PUSH = "1"; try { return await fn(); } finally { if (was === undefined) delete process.env.TOWN_PUSH; else process.env.TOWN_PUSH = was; } };
const caught = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a refusal"); };

const IX = await indexStore((await import("./fixture.mjs")).fixtureTown());
const IX_RESTORE = await IX.useInProcess();
after(async () => { await IX_RESTORE(); await IX.stop(); });

test("1 · THE FIXTURE IS THE FAILURE: a bare pull on the dirtied clone fails in git's raw words, the 500 neth was shown", () => {
  const t = town();
  dirty(t);
  let raw = null;
  try { sh(t.clone, "pull", "--rebase", "-q"); } catch (e) { raw = String(e.stderr ?? e.message); }
  assert.match(raw, /cannot pull with rebase: You have unstaged changes/, "the raw failure this fix replaces");
});

test("2 · the refusal is named, a 503 in the bounce vocabulary, and the dirt is left exactly as found", () => {
  const t = town();
  dirty(t);
  const before = snapshot(t.clone);
  const e = caught(() => freshenClone(t.clone, { waitMs: 0 }));
  assert.equal(isNeedsTending(e), true);
  assert.equal(e.pen, NEEDS_TENDING);
  assert.deepEqual([e.code, e.defect], [503, NAMED]);
  assert.match(e.hint, /nothing was written and no stamps moved/);
  assert.deepEqual(e.dirt, ["WHITE_PAGES/stamp-ledger.md"]);
  assert.deepEqual(snapshot(t.clone), before, "no stash, no reset, no rebase: HEAD, status and every byte as they were");
  assert.deepEqual(Object.keys(needsTendingError()).sort(), ["code", "defect", "dirt", "hint", "pen"], "the typed refusal is a bounce {code, defect, hint}");
});

test("3 · a writer in flight is waited for; dirt that stays is refused; untracked files never refuse; staged, conflicted and half-way states do", () => {
  // in flight: the dirt clears inside the wait (the other writer commits), and the pull goes on
  const t = town();
  dirty(t);
  let naps = 0;
  freshenClone(t.clone, { waitMs: 5_000, sleep: () => { naps += 1; sh(t.clone, "checkout", "-q", "--", "WHITE_PAGES/stamp-ledger.md"); } });
  assert.equal(naps, 1, "it waited once, saw a clean clone, and pulled");
  assert.deepEqual(cloneDirt(t.clone), []);
  // abandoned: still dirty at the end of the wait
  const stuck = town();
  dirty(stuck);
  let waits = 0;
  const e = caught(() => freshenClone(stuck.clone, { waitMs: 400, sleep: () => { waits += 1; } }));
  assert.equal(e.code, 503);
  assert.ok(waits >= 1, "it did wait before calling the dirt abandoned");
  // untracked files are not what a pull refuses on
  const u = town();
  writeFileSync(join(u.clone, "residue.tmp"), "the office's own residue\n");
  freshenClone(u.clone, { waitMs: 0 });
  assert.equal(existsSync(join(u.clone, "residue.tmp")), true, "and they are left alone");
  // staged is dirt
  const s = town();
  dirty(s); sh(s.clone, "add", "WHITE_PAGES/stamp-ledger.md");
  assert.equal(caught(() => freshenClone(s.clone, { waitMs: 0 })).code, 503);
  // a half-way rebase is dirt
  const r = town();
  mkdirSync(join(r.clone, ".git", "rebase-merge"));
  assert.deepEqual(cloneDirt(r.clone), [".git/rebase-merge"]);
  assert.equal(caught(() => freshenClone(r.clone, { waitMs: 0 })).code, 503);
});

test("4 · a CLEAN clone is freshened as it always was: the town's new commit arrives", () => {
  const t = town();
  const other = join(t.dir, "other");
  execFileSync("git", ["clone", "-q", t.origin, other], { stdio: "ignore" });
  appendFileSync(join(other, "WHITE_PAGES", "stamp-ledger.md"), "- 2026-09-29 · the town moved\n");
  sh(other, "add", "-A"); sh(other, ...BOT, "commit", "-qm", "traffic"); sh(other, "push", "-q", "origin", "main");
  freshenClone(t.clone, { waitMs: 0 });
  assert.equal(sh(t.clone, "rev-parse", "HEAD"), sh(other, "rev-parse", "HEAD"));
});

test("5 · THROUGH THE REAL WRITE PATH: a letter on the dirtied clone is the named 503, writes no file and no commit, and leaves the dirt; clean, it lands", async () => {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE residents (handle TEXT PRIMARY KEY); CREATE TABLE letters (id TEXT PRIMARY KEY);");
  db.prepare("INSERT INTO residents VALUES (?), (?)").run("wright", "limen");
  const key = { household: "keemin", handles: new Set(["wright"]), ghId: "42", ghLogin: "keeminlee" };
  const letter = { from: "wright", to: "limen", title: "a fine hat", body: "limen —\n\nA hat." };
  const t = town();
  dirty(t);
  const before = snapshot(t.clone);
  await withPush(async () => {
    const e = await Promise.resolve().then(() => enqueueLetter(letter, key, db, t.clone)).then(() => assert.fail("expected a refusal"), (x) => x);
    assert.deepEqual([e.code, e.defect, e.pen], [503, NAMED, NEEDS_TENDING], `got: ${e.message}`);
  });
  assert.deepEqual(snapshot(t.clone), before, "no letter file, no empty outbox, no commit; the dirt as found");
  // tended (a person committed the line), the same letter writes
  sh(t.clone, "add", "-A"); sh(t.clone, ...BOT, "commit", "-qm", "tended"); sh(t.clone, "push", "-q", "origin", "main");
  const r = await withPush(async () => enqueueLetter(letter, key, db, t.clone));
  assert.match(r.letter_id, /^wright-.*-to-limen-a-fine-hat$/);
});

// the execs, as the child the door spawns: one JSON line out, exit 0
const KEYFILE = join(mkdtempSync(join(tmpdir(), "clone-fresh-key-")), "stamp-key.pem");
writeFileSync(KEYFILE, "not a real key: the refusal comes before it is read\n");
after(() => rmSync(dirname(KEYFILE), { recursive: true, force: true }));
function runExec(name, clone, payload, { seed = () => {} } = {}) {
  seed(clone);
  return spawnSync(process.execPath, [join(ROOT, "src", name), JSON.stringify(payload)], {
    encoding: "utf8", timeout: 60_000,
    env: { ...process.env, TOWN_CLONE: clone, TOWN_PUSH: "1", STAMP_KEY: KEYFILE, TOWN_CLEAN_WAIT_MS: "0" },
  });
}
const lastJson = (out) => JSON.parse(String(out).trim().split("\n").at(-1));
const stubMint = (clone) => { mkdirSync(join(clone, "tools"), { recursive: true }); writeFileSync(join(clone, "tools", "stamp-mint.mjs"), "export {};\n"); sh(clone, "add", "-A"); sh(clone, ...BOT, "commit", "-qm", "mint stub"); sh(clone, "push", "-q", "origin", "main"); };

for (const [exec, payload, seed] of [
  ["stake-exec.mjs", { handle: "wright", topic: "t", candidate: "c", stamps: 1, via: "mcp" }, undefined],
  ["gift-exec.mjs", { handle: "limen", amount: 1, slug: "g", by: "wright", date: "2026-11-13" }, stubMint],
  ["ballot-act-exec.mjs", { verb: "open", args: {}, hand: "wright", today: "2026-11-13" }, undefined],
]) {
  test(`5 · ${exec}: a dirtied clone is the exec's ANSWER, a named 503 (exit 0), and the dirt is untouched`, () => {
    const t = town();
    seed?.(t.clone);
    dirty(t);
    const before = snapshot(t.clone);
    const r = runExec(exec, t.clone, payload);
    assert.equal(r.status, 0, `exit 0, an answer not a trip; stderr: ${r.stderr.slice(0, 300)}`);
    assert.deepEqual(lastJson(r.stdout), { error: { code: 503, defect: NAMED, hint: lastJson(r.stdout).error.hint } });
    assert.match(r.stderr, /\[clone-fresh\] refused: .*WHITE_PAGES\/stamp-ledger\.md/, "the dirt is named in the log, never in the answer");
    assert.doesNotMatch(r.stdout, /ledger/);
    assert.deepEqual(snapshot(t.clone), before, "nothing written, nothing taken");
  });
}

test("6 · ONE HELPER: no write in src/ pulls on its own; the two swallowing reads are the named exceptions", () => {
  const src = join(ROOT, "src");
  const pulls = readdirSync(src).filter((f) => f.endsWith(".mjs")).flatMap((f) =>
    readFileSync(join(src, f), "utf8").split("\n").map((line, i) => ({ f, i: i + 1, line })).filter(({ line }) => /"pull", "--rebase"/.test(line) && !/^\s*\/\//.test(line)));
  const where = pulls.map(({ f }) => f).sort();
  assert.deepEqual(where, ["clone-fresh.mjs", "crossing-exec.mjs", "walk-exec.mjs"].sort(), `unexpected pulls: ${JSON.stringify(pulls.map((p) => `${p.f}:${p.i}`))}`);
  for (const f of ["crossing-exec.mjs", "walk-exec.mjs"]) assert.match(readFileSync(join(src, f), "utf8"), /"pull", "--rebase", "-q"\], \{ encoding: "utf8" \}\); \} catch \{ \/\* offline\/behind/, `${f} swallows its pull: a read of what it holds, never a 500`);
  for (const f of readdirSync(src).filter((x) => /-exec\.mjs$/.test(x) && !/^(walk|crossing|leave)-/.test(x))) {
    const text = readFileSync(join(src, f), "utf8");
    if (/penTransaction\(/.test(text)) assert.match(text, /freshenIfPush\(CLONE\)/, `${f} freshens through the shared helper`);
    if (/penTransaction\(/.test(text)) assert.match(text, /main\(\)\.catch\(exitOnFault\)/, `${f} answers the refusal`);
  }
});
