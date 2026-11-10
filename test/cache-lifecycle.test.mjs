// cache-lifecycle.test.mjs — the office prunes its own disposable caches, and never one that is recent or in use (POS-989).
//
//   node --test test/cache-lifecycle.test.mjs
//
// WHY: <tmp>/postmark-settlement-town held 7.3 G of town clones (one per settlement sha, 71 dirs since 10-14) and
// <tmp>/postmark-engine 991 engine checkouts; nothing removed one, and the disk sentinel barked at 87% (2026-11-10).
// LAW (Wright 2026-11-10 02:44Z, on Darko's 21:11 EST ask for "a more durable solution"): the office prunes its own settlement
// town clones, "keeping recent shas and any that's in use, and never deleting a dir a fold could be reading", and its
// engine checkouts the same way. Seven days since last use is the retention.
//
// EVERYTHING HERE ACTS ONLY INSIDE ROOTS THIS FILE MAKES (mkdtemp), with invented shas and controlled ages. The oracle (one
// function, `oracle`) is run against the real module and against MUTATED COPIES of it (the flip at the end), so a defect in
// the pruner's safety shows red.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import * as real from "../src/cache-lifecycle.mjs";
import { openTownAtSha, townAtSha, withTownAtSha } from "../src/world-settlement.mjs";
import { materializeAtRef } from "../src/world-branches.mjs";

const SRC = fileURLToPath(new URL("../src/cache-lifecycle.mjs", import.meta.url));
const DAY = 24 * 60 * 60 * 1000;
const T0 = Date.UTC(2026, 10, 10, 12, 0, 0);
const sha = (c) => c.repeat(40);
const scratch = () => mkdtempSync(join(tmpdir(), "pos989-"));
const age = (path, ms) => { const at = new Date(T0 - ms); utimesSync(path, at, at); };

/** One town-clone-shaped entry (`<root>/<sha>/.git/`), last used `usedDaysAgo` days before T0 (undefined: never stamped). */
function townEntry(root, name, usedDaysAgo) {
  mkdirSync(join(root, name, ".git"), { recursive: true });
  writeFileSync(join(root, name, "tools.txt"), `payload of ${name}`);
  age(join(root, name, ".git"), (usedDaysAgo ?? 30) * DAY);
  if (usedDaysAgo !== undefined) {
    mkdirSync(join(root, real.STATE_DIR), { recursive: true });
    writeFileSync(join(root, real.STATE_DIR, `${name}.used`), "");
    age(join(root, real.STATE_DIR, `${name}.used`), usedDaysAgo * DAY);
  }
}
/** A pid that is certainly dead: a child that has already exited. */
const deadPid = () => { const c = spawn(process.execPath, ["-e", "0"]); return new Promise((ok) => c.on("exit", () => ok(c.pid))); };
const names = (root) => readdirSync(root).filter((n) => n !== real.STATE_DIR).sort();

// ── the oracle: what a correct pruner does, over one fixture, against any implementation of cache-lifecycle ─────────────

async function oracle(mod) {
  const root = scratch(), outside = scratch();
  try {
    const STALE = sha("a"), RECENT = sha("b"), LEASED = sha("c"), DEADLEASE = sha("d"), UNSTAMPED_OLD = sha("e"), LINK = sha("f"), NOMARK = sha("1");
    townEntry(root, STALE, 20);
    townEntry(root, RECENT, 2);
    townEntry(root, LEASED, 20);
    townEntry(root, DEADLEASE, 20);
    townEntry(root, UNSTAMPED_OLD, undefined);                         // never stamped: dated by its own marker, 30 days old
    mkdirSync(join(root, NOMARK), { recursive: true });                // an entry-shaped name with no finished marker, though once stamped as used
    mkdirSync(join(root, real.STATE_DIR), { recursive: true });
    writeFileSync(join(root, real.STATE_DIR, `${NOMARK}.used`), ""); age(join(root, real.STATE_DIR, `${NOMARK}.used`), 20 * DAY);
    writeFileSync(join(outside, "keep.txt"), "an outside file");
    mkdirSync(join(outside, ".git"), { recursive: true }); age(join(outside, ".git"), 30 * DAY);   // the link's target LOOKS like a finished, old entry
    symlinkSync(outside, join(root, LINK));                            // an entry-shaped name that is a link out of the root
    mkdirSync(join(root, "notes"), { recursive: true });               // not an entry name at all
    writeFileSync(join(root, "stray.txt"), "x");
    // a live lease (this process) on LEASED, and a lease of a dead pid on DEADLEASE
    mkdirSync(join(root, mod.STATE_DIR), { recursive: true });
    writeFileSync(join(root, mod.STATE_DIR, `${LEASED}.lease.${process.pid}.1`), String(process.pid));
    writeFileSync(join(root, mod.STATE_DIR, `${DEADLEASE}.lease.${await deadPid()}.1`), "0");

    const out = await mod.pruneCache(root, mod.TOWN_CLONES, { now: () => T0 });
    assert.deepEqual(out.removed.sort(), [DEADLEASE, STALE, UNSTAMPED_OLD].sort(), "stale, unused entries are removed (a dead pid's lease holds nothing)");
    assert.deepEqual(names(root).sort(), [LEASED, LINK, NOMARK, RECENT, "notes", "stray.txt"].sort(), "recent, leased, unfinished, linked and unknown entries stay");
    assert.equal(existsSync(join(root, STALE)), false, "removed whole: not even its folder is left");
    assert.equal(readFileSync(join(outside, "keep.txt"), "utf8"), "an outside file", "nothing outside the root was touched through the link");
    assert.equal(readFileSync(join(root, RECENT, "tools.txt"), "utf8"), `payload of ${RECENT}`, "a kept entry is whole");
    assert.equal(readFileSync(join(root, LEASED, "tools.txt"), "utf8"), `payload of ${LEASED}`);
    // the lease released, the same entry is then stale and unused
    rmSync(join(root, mod.STATE_DIR, `${LEASED}.lease.${process.pid}.1`));
    const again = await mod.pruneCache(root, mod.TOWN_CLONES, { now: () => T0 });
    assert.deepEqual(again.removed, [LEASED], "once its lease is gone it goes");
    return true;
  } finally { rmSync(root, { recursive: true, force: true }); rmSync(outside, { recursive: true, force: true }); }
}

test("ORACLE on the real module: stale unused entries are removed whole; recent, leased, unfinished, linked and unknown ones stay", async () => {
  assert.equal(await oracle(real), true);
});

test("a reader in ANOTHER PROCESS holds an entry: its lease keeps it, the pruner remembers nothing of it, and it goes once that process ends", async () => {
  const root = scratch();
  try {
    const NAME = sha("9");
    townEntry(root, NAME, 20);
    const child = spawn(process.execPath, ["--input-type=module", "-e",
      `import { leaseEntry, TOWN_CLONES } from ${JSON.stringify(pathToFileURL(SRC).href)};
       const release = leaseEntry(${JSON.stringify(root)}, ${JSON.stringify(NAME)}, TOWN_CLONES);
       console.log(release ? "held" : "refused");
       process.stdin.resume();`], { stdio: ["pipe", "pipe", "inherit"] });
    await new Promise((ok, no) => { child.stdout.once("data", (d) => (String(d).includes("held") ? ok() : no(new Error(`child said ${d}`)))); child.on("error", no); });
    const during = await real.pruneCache(root, real.TOWN_CLONES, { now: () => T0 });
    assert.deepEqual(during.removed, [], "the other process's lease keeps it");
    assert.deepEqual(during.kept.map((k) => [k.name, k.why]), [[NAME, "in use"]]);
    await new Promise((ok) => { child.on("exit", ok); child.stdin.end(); child.kill(); });
    const after = await real.pruneCache(root, real.TOWN_CLONES, { now: () => T0 });
    assert.deepEqual(after.removed, [NAME], "its pid is dead, its lease is stale, and the entry is stale: removed");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("THE HANDSHAKE: a reader never proceeds under a live claim, a pruner never claims over a live claim, and a dead pruner's claim is ignored", async () => {
  const root = scratch();
  try {
    const NAME = sha("8");
    townEntry(root, NAME, 20);
    const claim = join(root, real.STATE_DIR, `${NAME}.claim`);
    mkdirSync(join(root, real.STATE_DIR), { recursive: true });
    writeFileSync(claim, String(process.pid));                          // a live pruner (this process) has claimed it
    assert.equal(real.leaseEntry(root, NAME, real.TOWN_CLONES, { now: () => Date.now() }), null, "the reader waits it out and then gives way: it rebuilds rather than read a dir being removed");
    assert.deepEqual(readdirSync(join(root, real.STATE_DIR)).filter((f) => f.includes(".lease.")), [], "and leaves no lease behind");
    const pruned = await real.pruneCache(root, real.TOWN_CLONES, { now: () => T0 });
    assert.deepEqual(pruned.kept.map((k) => k.why), ["claimed by another pruner"], "a pruner does not claim over a live claim");
    rmSync(claim);
    writeFileSync(claim, String(await deadPid()));                      // a pruner that died holding a claim
    const release = real.leaseEntry(root, NAME, real.TOWN_CLONES);
    assert.equal(typeof release, "function", "a dead pruner's claim does not block a reader");
    release();
    assert.equal(existsSync(claim), false, "and it is cleared");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("a lookup refreshes the use stamp, so a clone asked for every few days is never stale, however old its marker", async () => {
  const root = scratch();
  try {
    const NAME = sha("7");
    townEntry(root, NAME, 20);
    real.touchUsed(root, NAME, { now: () => T0 });                      // a lookup at T0
    const out = await real.pruneCache(root, real.TOWN_CLONES, { now: () => T0 + 3 * DAY });
    assert.deepEqual(out.removed, [], "used three days ago: recent");
    const later = await real.pruneCache(root, real.TOWN_CLONES, { now: () => T0 + 8 * DAY });
    assert.deepEqual(later.removed, [NAME], "untouched for eight days: stale");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── the two owners, end to end, on invented fixtures ────────────────────────────────────────────────────────────────

const git = (cwd, ...a) => execFileSync("git", ["-C", cwd, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

test("TOWN CLONES: a stale unused clone is pruned and the SAME sha is rebuilt and read correctly; a held clone is not removed under its reader", async () => {
  const repo = scratch(), root = scratch();
  try {
    git(repo, "init", "-q", "-b", "main");
    mkdirSync(join(repo, "tools"), { recursive: true });
    writeFileSync(join(repo, "tools", "resolver.mjs"), "export const v = 1;\n");
    writeFileSync(join(repo, "ECONOMY-DIALS.json"), "{}\n");
    git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "one");
    const SHA = git(repo, "rev-parse", "HEAD");
    // held: a reader inside the lease while the pruner runs a pass at "eight days on"
    const read = await withTownAtSha(repo, SHA, async (dir) => {
      const during = await real.pruneCache(root, real.TOWN_CLONES, { now: () => Date.now() + 8 * DAY });
      assert.deepEqual(during.removed, [], "never under a lease, async reads included");
      await new Promise((ok) => setTimeout(ok, 20));
      return readFileSync(join(dir, "tools", "resolver.mjs"), "utf8");
    }, root);
    assert.equal(read, "export const v = 1;\n", "the read after the pass still finds its clone");
    // released and stale: pruned whole, then reconstructed on demand with the same bytes
    const out = await real.pruneCache(root, real.TOWN_CLONES, { now: () => Date.now() + 8 * DAY });
    assert.deepEqual(out.removed, [SHA]);
    assert.equal(existsSync(join(root, SHA)), false);
    const { dir, release } = openTownAtSha(repo, SHA, root);
    try { assert.equal(readFileSync(join(dir, "tools", "resolver.mjs"), "utf8"), "export const v = 1;\n", "an old sha reconstructs and reads correctly"); } finally { release(); }
    assert.equal(townAtSha(repo, SHA, root), join(root, SHA), "the unscoped form still returns the path");
    assert.throws(() => townAtSha(repo, "nope", root), /names no town sha/, "a bad sha is refused as before");
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

test("ENGINE CHECKOUTS: another process's checkout is pruned when stale and rebuilt on demand; this process's own stays while it lives (an import can outlive the lookup)", async () => {
  const repo = scratch(), root = scratch();
  try {
    git(repo, "init", "-q", "-b", "main");
    mkdirSync(join(repo, "tools"), { recursive: true });
    writeFileSync(join(repo, "tools", "walk.mjs"), "export const answer = 42;\n");
    git(repo, "add", "-A"); git(repo, "commit", "-q", "-m", "one");
    // made by ANOTHER process (which then exits), so its lease is stale and the entry only has its age
    const wb = pathToFileURL(fileURLToPath(new URL("../src/world-branches.mjs", import.meta.url))).href;
    execFileSync(process.execPath, ["--input-type=module", "-e", `import { materializeAtRef } from ${JSON.stringify(wb)}; console.log(materializeAtRef(${JSON.stringify(repo)}, "HEAD", "tools", ${JSON.stringify(root)}));`], { stdio: ["ignore", "pipe", "inherit"] });
    const [entry] = names(root);
    assert.match(entry, /^[0-9a-f]{40}--tools$/);
    age(join(root, entry, ".materialized"), 30 * DAY);
    age(join(root, real.STATE_DIR, `${entry}.used`), 30 * DAY);        // last used thirty days ago
    const out = await real.pruneCache(root, real.ENGINE_CHECKOUTS, { now: () => Date.now() });
    assert.deepEqual(out.removed, [entry], "stale and unheld: removed whole");
    // an old ref reconstructs and imports correctly later
    const dir = materializeAtRef(repo, "HEAD", "tools", root);
    assert.equal((await import(pathToFileURL(join(dir, "tools", "walk.mjs")).href)).answer, 42, "rebuilt on demand, same bytes");
    // and THIS process now holds it for its life: an old marker does not make it removable while the process lives
    age(join(dir, ".materialized"), 40 * DAY);
    const mine = await real.pruneCache(root, real.ENGINE_CHECKOUTS, { now: () => Date.now() + 30 * DAY });
    assert.deepEqual(mine.removed, [], "in use by a live process");
    assert.deepEqual(mine.kept.map((k) => k.why), ["in use"]);
  } finally { rmSync(repo, { recursive: true, force: true }); rmSync(root, { recursive: true, force: true }); }
});

// ── THE FLIP: the oracle must go red on a pruner with each safety line broken ─────────────────────────────────────────

async function mutant(label, from, to) {
  const text = readFileSync(SRC, "utf8");
  assert.ok(text.includes(from), `the flip's anchor is still in the module: ${label}`);
  const dir = mkdtempSync(join(tmpdir(), "pos989-mutant-"));
  const file = join(dir, "cache-lifecycle.mjs");
  writeFileSync(file, text.split(from).join(to));
  try { return await import(`${pathToFileURL(file).href}?${label}`); } finally { /* the module is loaded; its folder is removed below by the caller */ void dir; }
}

for (const [label, from, to, why] of [
  ["ignore-leases", "export function liveLeases(root, name) {", "export function liveLeases(root, name) { return [];", "age-only deletion removes an entry a reader holds"],
  ["ignore-recency", "return Math.max(used ?? 0, made ?? 0) || null;", "return 1;", "ignores when an entry was last used, so a recently used one is removed"],
  ["follow-links", "if (st.isSymbolicLink() || !st.isDirectory())", "if (!st.isDirectory() && !st.isSymbolicLink())", "a link out of the root is treated as an entry"],
  ["no-marker-check", "if (!markerPresent(full, spec)) {", "if (false) {", "an entry-shaped folder with no finished marker is removed"],
]) {
  test(`FLIP ${label}: the oracle is red on a pruner that ${why}`, async () => {
    const mod = await mutant(label, from, to);
    await assert.rejects(oracle(mod), (e) => e?.name === "AssertionError", `${label} must be caught`);
  });
}
