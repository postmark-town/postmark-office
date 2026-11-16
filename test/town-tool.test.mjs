// town-tool.test.mjs — the office runs only the town code it pinned (POS-994 /a /b).
//
//   node --test test/town-tool.test.mjs
//
// Ruled by Darko, 2026-11-15 18:03 EST: every place the office runs town code
// next to a key or the store, it runs a reviewed copy pinned in the office, and
// a mismatch stops that part by name. Held here:
//   · a clone equal to the pins loads the PINNED file; a clone that differs in
//     the module or anywhere in its closure stops, naming the file;
//   · the falsifier: a clone that changes only AFTER the check never runs; the
//     pinned bytes are what load;
//   · a child's argv always names the clone (--repo), because the unnamed run
//     answers an empty town without failing (measured below);
//   · the office's own pins are whole and equal to the town at their commit;
//   · no office file reaches a pinned town module except through the loader.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PIN_ROOT, REPO_DEFAULTING, TownPinMismatch, TownToolUnpinned, gitBlobSha, importTownTool, readPins, townTool, townToolArgv } from "../src/town-tool.mjs";
import { MODULES, checkPins, collect, manifest } from "../tools/town-pins.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A tiny town: a module, its closure, and the office's pins of it.
function fixture(files) {
  const base = mkdtempSync(join(tmpdir(), "town-tool-"));
  const clone = join(base, "clone"), pins = join(base, "pins");
  const write = (dir, p, text) => { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); };
  for (const [p, text] of Object.entries(files)) { write(clone, p, text); write(pins, p, text); }
  const read = (p) => Buffer.from(files[p]);
  const mods = Object.keys(files).filter((p) => p.startsWith("tools/")).map((p) => p.slice("tools/".length));
  writeFileSync(join(pins, "PINS.json"), JSON.stringify(manifest(collect(read, mods), { townCommit: "c".repeat(40), readAt: "2026-11-16T00:00:00Z" })));
  return { base, clone, pins, write, done: () => rmSync(base, { recursive: true, force: true }) };
}

const TOWN = {
  "tools/mint.mjs": 'import { rule } from "./rule.mjs";\nexport const who = "pinned";\nexport const r = rule;\n',
  "tools/rule.mjs": 'export const rule = "seven";\n',
};

test("a clone equal to the pins returns the PINNED path, never the clone's", () => {
  const f = fixture(TOWN);
  try {
    const p = townTool(f.clone, "mint.mjs", { root: f.pins });
    assert.equal(p, join(f.pins, "tools", "mint.mjs"));
    assert.ok(!resolve(p).startsWith(resolve(f.clone)));
  } finally { f.done(); }
});

test("the module itself differs: the step stops, naming the file and both blobs", () => {
  const f = fixture(TOWN);
  try {
    f.write(f.clone, "tools/mint.mjs", TOWN["tools/mint.mjs"] + "// a town PR\n");
    assert.throws(() => townTool(f.clone, "mint.mjs", { root: f.pins }), (e) =>
      e instanceof TownPinMismatch && e.code === "TOWN_PIN_MISMATCH" && e.file === "tools/mint.mjs" &&
      e.pinned === gitBlobSha(Buffer.from(TOWN["tools/mint.mjs"])) && /this step stops/.test(e.message));
  } finally { f.done(); }
});

test("a file in its closure differs: the step stops on THAT file", () => {
  const f = fixture(TOWN);
  try {
    f.write(f.clone, "tools/rule.mjs", 'export const rule = "eight";\n');
    assert.throws(() => townTool(f.clone, "mint.mjs", { root: f.pins }), (e) => e instanceof TownPinMismatch && e.file === "tools/rule.mjs");
  } finally { f.done(); }
});

test("a clone without the file stops too, saying so", () => {
  const f = fixture(TOWN);
  try {
    rmSync(join(f.clone, "tools", "rule.mjs"));
    assert.throws(() => townTool(f.clone, "mint.mjs", { root: f.pins }), (e) => e instanceof TownPinMismatch && e.found === null && /has no such file/.test(e.message));
  } finally { f.done(); }
});

test("a module the office never pinned is refused", () => {
  const f = fixture(TOWN);
  try {
    assert.throws(() => townTool(f.clone, "ferry.mjs", { root: f.pins }), (e) => e instanceof TownToolUnpinned && e.file === "tools/ferry.mjs");
  } finally { f.done(); }
});

test("pins inside the clone are refused: the town never vouches for itself", () => {
  const f = fixture(TOWN);
  try {
    assert.throws(() => townTool(f.clone, "mint.mjs", { root: join(f.clone, "tools") }), /inside the clone/);
    assert.throws(() => townTool(f.clone, "mint.mjs", { root: f.clone }), /inside the clone/);
  } finally { f.done(); }
});

test("FALSIFIER: the clone changes after the check, and its code never runs", async () => {
  const f = fixture(TOWN);
  const marker = join(f.base, "the-clone-ran");
  try {
    const checked = townTool(f.clone, "mint.mjs", { root: f.pins });
    // The ferry's pull lands between the check and the load: the clone's
    // module now writes a marker the moment it is evaluated.
    f.write(f.clone, "tools/mint.mjs",
      `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport const who = "clone";\n`);
    const mod = await import(pathToFileURL(checked).href);
    assert.equal(mod.who, "pinned");
    assert.equal(mod.r, "seven", "the closure loaded is the pinned one too");
    assert.equal(existsSync(marker), false, "the clone's code ran");
    // And the next load sees the change and stops.
    await assert.rejects(importTownTool(f.clone, "mint.mjs", { root: f.pins }), TownPinMismatch);
    assert.equal(existsSync(marker), false, "the clone's code ran");
  } finally { f.done(); }
});

test("a child's argv names the clone: --repo is added, and a foreign --repo refused", () => {
  const f = fixture({ "tools/stamp-mint.mjs": "export {};\n", "tools/witness-chain.mjs": "export {};\n" });
  try {
    const o = { root: f.pins };
    assert.deepEqual(townToolArgv(f.clone, "stamp-mint.mjs", ["--derive"], o), [join(f.pins, "tools", "stamp-mint.mjs"), "--derive", "--repo", f.clone]);
    assert.deepEqual(townToolArgv(f.clone, "stamp-mint.mjs", ["--repo", f.clone, "--balances"], o), [join(f.pins, "tools", "stamp-mint.mjs"), "--repo", f.clone, "--balances"]);
    assert.throws(() => townToolArgv(f.clone, "stamp-mint.mjs", ["--repo", "/elsewhere"], o), /is not the clone/);
    // witness-chain takes no default repo; its argv is left as the caller wrote it.
    assert.deepEqual(townToolArgv(f.clone, "witness-chain.mjs", ["owe-open", "--owed", "/o"], o), [join(f.pins, "tools", "witness-chain.mjs"), "owe-open", "--owed", "/o"]);
  } finally { f.done(); }
});

test("WHY the argv is built here: the pinned world-stake, unnamed, answers an empty town and exits 0", () => {
  // Measured on town 2470d732: run from the pins with no --repo, the town's own
  // default is the pins' folder, which holds no ledger. It does not fail: it
  // says nothing is staked. A settlement reading that would drop every stake.
  const before = new Set(walk(PIN_ROOT));
  const r = spawnSync(process.execPath, [join(PIN_ROOT, "tools", "world-stake.mjs"), "--escrow", "--json"], { cwd: tmpdir(), encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(walk(PIN_ROOT).filter((p) => !before.has(p)), [], "the unnamed run wrote under the pins");
});

test("the office's pins are whole: every MODULE pinned, every byte its blob, every closure pinned", () => {
  assert.deepEqual(checkPins(PIN_ROOT), []);
  const pins = readPins(PIN_ROOT);
  for (const m of MODULES) assert.ok(pins.files[`tools/${m}`], `tools/${m} is not pinned`);
  for (const m of REPO_DEFAULTING) assert.ok(MODULES.includes(m), `${m} defaults its repo but is not a MODULE`);
  assert.match(pins.town_commit, /^[0-9a-f]{40}$/);
});

test("the office's pins equal the town at their commit (when the town clone holds that commit)", (t) => {
  const clone = join(ROOT, "town-clone");
  const { town_commit } = readPins(PIN_ROOT);
  let have = false;
  try { execFileSync("git", ["-C", clone, "cat-file", "-e", `${town_commit}^{commit}`], { stdio: "ignore" }); have = true; } catch { /* below */ }
  if (!have) return t.skip(`the town clone does not hold the pins' commit ${town_commit.slice(0, 12)} (tools/town-pins.mjs --check --town <a clone that does> holds it)`);
  const townBlob = (c, p) => { try { return execFileSync("git", ["-C", clone, "rev-parse", `${c}:${p}`]).toString().trim(); } catch { return null; } };
  assert.deepEqual(checkPins(PIN_ROOT, { townBlob }), []);
});

// ── THE SOURCE LAW ──────────────────────────────────────────────────────────
// No office file builds a path to a pinned town module itself: it imports
// through importTownTool or spawns through townToolArgv. Checking that a module
// EXISTS in the clone (existsSync) is not a reach and stays.

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}

test("no office file reaches a pinned town module except through the loader", () => {
  const names = MODULES.map((m) => m.replace(/[.]/g, "\\.")).join("|");
  const reach = new RegExp(`join\\([^()]*"tools",\\s*"(${names})"\\)`, "g");
  const scanned = ["src", "tools", "world2", "deploy"].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.(mjs|js)$/.test(p) && !p.includes(`${sep}town-pins${sep}`) && !p.includes(`${sep}node_modules${sep}`));
  const found = [];
  for (const p of scanned) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      for (const m of line.matchAll(reach)) {
        const before = line.slice(0, m.index);
        if (/existsSync\(\s*$/.test(before)) continue;
        found.push(`${relative(ROOT, p).split(sep).join("/")}:${i + 1}: ${m[0]}`);
      }
    });
  }
  assert.deepEqual(found, [], `town modules reached around the loader:\n${found.join("\n")}`);
});

test("only the loader turns a pin into a path: no office file imports the bare townTool", () => {
  // importTownTool and townToolArgv check AND use the pin; a bare path invites a
  // spawn without --repo. (tools/stamp-sandbox.mjs's own ctx.townTool is the dev
  // sandbox's runner, a different thing that shares the word.)
  const bare = /import\s*\{[^}]*\btownTool\b[^}]*\}\s*from\s*["'][^"']*town-tool\.mjs["']/;
  const scanned = ["src", "tools", "world2", "deploy"].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.(mjs|js)$/.test(p) && !p.includes(`${sep}town-pins${sep}`));
  const found = scanned.filter((p) => bare.test(readFileSync(p, "utf8"))).map((p) => relative(ROOT, p));
  assert.deepEqual(found, []);
});
