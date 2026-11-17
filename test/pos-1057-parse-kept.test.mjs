// pos-1057-parse-kept.test.mjs — POS-1057 (the continuation): a file at a commit is parsed once, not once per caller.
//
// WHAT THE BOX WAS DOING, MEASURED LOCALLY. A household's agents read through POST /mcp, which the main thread answers (src/read-workers.mjs § MCP_WORKER_TOOLS
// names only the world reads), so every `household` read (the v2 glance, the doorstep, stamps, quests) runs on the one thread that also admits every other call.
// Profiled on a capped local office (3 read workers, the pinned town index, invented polling by three houses), 15-17% of that thread's CPU was
// `JSON.parse` of `WORLD/world-state.json` (2.5 MB, ~25 ms a parse): `readAtRef` kept the file's TEXT by (repo, sha, path) and `readJsonAtRef` parsed it again on
// every call. The glance parsed it once per member of the house (`publishedMarksOf`, per handle) and again for the stances, the drafts and the stakes; a doorstep
// three times. A nine-member house polling together spent a third of a second of the main thread apiece on a file that had not moved.
//
// THE REGRESSION counts parses of a large invented world-state, through the callers the household and doorstep reads make (`publishedMarksOf` per member,
// `publishedState().state`), and asserts a moved ref is read afresh. Red on `JSON.parse(readAtRef(...))` per call (one parse per call), green kept per (repo, sha, path).
//
//   node --test test/pos-1057-parse-kept.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";

const tmp = tempDir("pos1057-parse-");
const repo = join(tmp, "world");
const git = (...a) => execFileSync("git", ["-C", repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", ...a], { encoding: "utf8" });
mkdirSync(join(repo, "WORLD"), { recursive: true });
const HANDLES = Array.from({ length: 9 }, (_, i) => `member-${i}`);
const world = (n, tag) => JSON.stringify({ tick: 1, tag, marks: Array.from({ length: n }, (_, i) => ({
  id: `${HANDLES[i % 9]}/mark-${i}`, by: HANDLES[i % 9], kind: "sited", tier: "market", body: `invented body ${i} `.repeat(8), at: { x: i, y: -i }, extent: { w: 3, h: 3 }, stamps: i % 5, weight: i % 7 })) });
writeFileSync(join(repo, "WORLD", "world-state.json"), world(9000, "first"));
git("init", "-q", "-b", "main");
git("add", "-A");
git("commit", "-qm", "invented world");

/** Count the parses of text this big (the world state), while `fn` runs. */
function countingParses(fn) {
  const real = JSON.parse;
  let big = 0;
  JSON.parse = (text, ...r) => { if (typeof text === "string" && text.length > 500_000) big += 1; return real(text, ...r); };
  try { fn(); } finally { JSON.parse = real; }
  return big;
}

test("a world state at one commit is parsed once for however many callers ask, and the callers get the same object", async () => {
  const { readJsonAtRef, __forgetParsedForTest } = await import("../src/world-branches.mjs");
  __forgetParsedForTest();
  let a, b;
  const parses = countingParses(() => {
    a = readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json");
    b = readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json");
  });
  assert.equal(parses, 1, `${parses} parses of the world state for two reads of one commit`);
  assert.equal(a, b, "one parse, shared");
  assert.equal(a.marks.length, 9000);
});

test("a house's glance (published marks per member) parses the world state once, not once per member", async () => {
  const { __forgetParsedForTest } = await import("../src/world-branches.mjs");
  const { publishedMarksOf } = await import("../src/town-marks.mjs");
  __forgetParsedForTest();
  let rows;
  const parses = countingParses(() => { rows = HANDLES.map((h) => publishedMarksOf(h, { repo })); });
  assert.equal(parses, 1, `${parses} parses of the world state for a nine-member house's published marks (one per member was the cost)`);
  assert.ok(rows.every((r) => r.length === 1000), "each member's marks are exactly theirs");
});

test("a ref that moves is read afresh: the kept parse is keyed by the commit, never by the name", async () => {
  const { readJsonAtRef, __forgetParsedForTest } = await import("../src/world-branches.mjs");
  __forgetParsedForTest();
  const before = readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json");
  assert.equal(before.tag, "first");
  writeFileSync(join(repo, "WORLD", "world-state.json"), world(10, "second"));
  git("commit", "-qam", "the world moved");
  const after = readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json");
  assert.equal(after.tag, "second", "the new commit's file, not the kept one");
  assert.equal(after.marks.length, 10);
  assert.equal(before.marks.length, 9000, "what an earlier caller holds is untouched");
});

test("a ref that moves between the resolution and the read cannot file the new commit's JSON under the old commit", async () => {
  const { readJsonAtRef, __forgetParsedForTest } = await import("../src/world-branches.mjs");
  __forgetParsedForTest();
  const oldSha = git("rev-parse", "refs/heads/main").trim();
  const oldTag = JSON.parse(git("show", `${oldSha}:WORLD/world-state.json`)).tag;
  writeFileSync(join(repo, "WORLD", "world-state.json"), world(11, "raced"));
  const moved = () => { git("commit", "-qam", "moved mid-read"); };
  const got = readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json", { afterResolve: moved });
  assert.equal(got.tag, oldTag, "the read is of the commit it resolved");
  const asked = readJsonAtRef(repo, oldSha, "WORLD/world-state.json");
  assert.equal(asked.tag, oldTag, "a later read of the old commit is the old commit's file");
  assert.equal(readJsonAtRef(repo, "refs/heads/main", "WORLD/world-state.json").tag, "raced", "the moved ref reads its new commit");
});

test("a ref git's own files do not resolve (HEAD) is read and parsed as before, a fresh object each time", async () => {
  const { readJsonAtRef, __forgetParsedForTest } = await import("../src/world-branches.mjs");
  __forgetParsedForTest();
  const a = readJsonAtRef(repo, "HEAD", "WORLD/world-state.json");
  const b = readJsonAtRef(repo, "HEAD", "WORLD/world-state.json");
  assert.deepEqual(a, b);
  assert.notEqual(a, b, "no kept parse for a ref the cache cannot key by commit");
});

test.after(() => { rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
