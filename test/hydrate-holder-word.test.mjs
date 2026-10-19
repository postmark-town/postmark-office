// hydrate-holder-word.test.mjs — A THING'S OWN HOLDING WORD, THROUGH THE PIPE (the playground's QA,
// Starstory docs/2026-10-18/w43-ship/PART2-MCP-QA.md fail 2).
//
//   node --test test/hydrate-holder-word.test.mjs
//
// Ruled 16:03: "a holder is anything with `holder: true`"; on thing, `holder`, `capacity`, `open` and
// `portable` are sovereign, so a maker writes them on the mark (review-610 S8, holder-word-at-the-door).
// sb-ash left a pouch with `holder: true, capacity: 10`; its file said both, and every make, give and
// take into it then answered "holds nothing". The hydrator's props block is an EXPLICIT field list
// (world-hydrate.mjs § the props block): it listed the four in the node's `keys` and dropped their
// values, so world_graph_nodes read `holder` null. The fifth instance of that block's one class
// (`dials:`, `loot:`, the bounty's notice, a property's fields), and hydrate-loot.test.mjs's method:
// a real mark FILE, through the REAL hydrator, and the assertion is on the row. Nothing here writes props.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { writeFixtureDb } from "./helpers/world-rows.mjs";

import { WORLD_CLONE } from "../src/world-store.mjs";

const OFFICE = resolve(fileURLToPath(new URL("..", import.meta.url)));
const HAVE_WORLD = existsSync(join(WORLD_CLONE, "tools", "marks-fold.mjs"));

const gitq = (dir, args) => execFileSync("git", ["-C", dir, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" },
});

// The frontmatter is written as a FILE: the world's parser has no boolean case, so `holder: true`
// reaches the hydrator as the STRING "true", the shape the playground's pouch had.
function buildWorld() {
  const dir = mkdtempSync(join(tmpdir(), "pm-holder-word-"));
  cpSync(join(WORLD_CLONE, "tools"), join(dir, "tools"), { recursive: true });
  const mark = (rel, front, body) => {
    mkdirSync(join(dir, "WORLD", "marks", rel), { recursive: true });
    writeFileSync(join(dir, "WORLD", "marks", rel, "mark.md"), `---\n${front}\n---\n\n${body}\n`);
  };
  mark("let-there-be-light",
    "kind: sited\nby: the-town\ntier: constitution\ndate: 2026-07-22\nat: { x: 0, y: 0 }\nextent: { w: 320000, h: 320000 }\ncoords: relative",
    "Let there be light.");
  gitq(dir, ["init", "-q", "."]);
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", "the tree as the freeze left it"]);
  // THE POUCH, as the leave door wrote sb-ash's (the old form, kind sited + class thing)
  mark("sb-ash/a-small-pouch",
    "kind: sited\nby: sb-ash\ntier: market\ndate: 2026-10-17\nat: { x: 206, y: -352 }\nextent: { w: 1, h: 1 }\nclass: thing\nholder: true\ncapacity: 10\nopen: false\nportable: false",
    "A small leather pouch.");
  // THE SAME WORD IN W2'S FORM (kind: thing, no class line)
  mark("sb-ash/a-tin-box",
    "kind: thing\nby: sb-ash\ntier: market\ndate: 2026-10-17\nat: { x: 208, y: -352 }\nextent: { w: 1, h: 1 }\nholder: true\ncapacity: 4",
    "A small tin box.");
  // A THING THAT SAID NOTHING: its props grow no key, so every other mark hydrates as it did
  mark("sb-ash/a-pebble",
    "kind: sited\nby: sb-ash\ntier: market\ndate: 2026-10-17\nat: { x: 210, y: -352 }\nextent: { w: 1, h: 1 }\nclass: thing",
    "A pebble.");
  gitq(dir, ["add", "-A"]);
  gitq(dir, ["commit", "-qm", "a pouch, a box and a pebble"]);
  return dir;
}

function hydrate(worldDir) {
  const dbPath = join(worldDir, "world.db");
  const r = spawnSync(process.execPath,
    [join(OFFICE, "src", "world-hydrate.mjs"), "--world", worldDir, "--no-db", "--rows-out", `${dbPath}.rows.json`, "--office", OFFICE, "--no-lints", "--no-gexf"],
    { encoding: "utf8" });
  if (r.status !== 0) assert.fail(`hydration exited ${r.status}\n${r.stdout}\n${r.stderr}`);
  writeFixtureDb(`${dbPath}.rows.json`, dbPath);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  const col = (k) => `json_extract(props,'$.${k}') AS ${k}, json_type(props,'$.${k}') AS ${k}_type`;
  const rows = Object.fromEntries(db.prepare(
    `SELECT id, ${["holder", "capacity", "open", "portable"].map(col).join(", ")} FROM nodes WHERE kind = 'mark'`).all().map((x) => [x.id, x]));
  db.close();
  return rows;
}

test("QA fail 2 · a thing's own holding word (holder, capacity, open, portable) reaches the store as its values",
  { timeout: 180_000 }, (t) => {
    if (!HAVE_WORLD) return t.skip(`no world clone at ${WORLD_CLONE}`);
    const rows = hydrate(buildWorld());
    const pouch = rows["sb-ash/a-small-pouch"];
    assert.ok(pouch, "the pouch did not hydrate at all — this test would prove nothing");
    assert.deepEqual([pouch.holder_type, pouch.capacity, pouch.capacity_type, pouch.open_type, pouch.portable_type], ["true", 10, "integer", "false", "false"],
      "the pouch's file says holder: true, capacity: 10, open: false, portable: false; the store must say the same, as real booleans and a whole number");
    const box = rows["sb-ash/a-tin-box"];
    assert.ok(box, "the W2-form box did not hydrate");
    assert.deepEqual([box.holder_type, box.capacity], ["true", 4], "the same word in W2's form");
    assert.equal(box.open_type, null, "a word the maker did not write is not stamped");
    const pebble = rows["sb-ash/a-pebble"];
    assert.ok(pebble, "the pebble did not hydrate");
    assert.deepEqual([pebble.holder_type, pebble.capacity_type, pebble.open_type, pebble.portable_type], [null, null, null, null],
      "a thing that said nothing grows no key: the class's default answers for it");
  });
