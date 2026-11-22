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
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { tempDir } from "./helpers/temp-dir.mjs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { PIN_ROOT, REPO_DEFAULTING, TownPinMismatch, holderArgs, TownToolUnpinned, ancestorOfPin, gitBlobSha, importTownTool, importTownToolAt, readPins, townTool, townToolArgv } from "../src/town-tool.mjs";
import { stampKeyRefusal } from "../tools/stamp-sandbox.mjs";
import { MODULES, checkPins, collect, manifest } from "../tools/town-pins.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// A tiny town: a module, its closure, and the office's pins of it.
function fixture(files) {
  const base = tempDir("town-tool-");
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

// EXEMPT BY NAME (Wright, POS-994, 2026-11-16 08:5x EST). The stamp sandbox's
// purpose is to run the --town checkout's own engines against this office tree;
// it refuses to start where a mint key is present (stamp-sandbox.mjs §
// stampKeyRefusal, held below). The one other: the pinned verifier's runner
// (src/stamp-verify-pinned.mjs), which imports only from the pinned folder that
// townToolArgv checked against the clone and handed it (Wright's pubkey pin,
// POS-994, 2026-11-16). Nothing else is exempt.
const SOURCE_LAW_EXEMPT = new Set(["tools/stamp-sandbox.mjs", "src/stamp-verify-pinned.mjs"]);

test("no office file reaches a pinned town module except through the loader", () => {
  const names = MODULES.map((m) => m.replace(/[.]/g, "\\.")).join("|");
  // One nested call may sit inside the join: `join(resolve(town), "tools", …)` (witness-settlement's shape).
  const reach = new RegExp(`join\\((?:[^()]|\\([^()]*\\))*"tools",\\s*"(${names})"\\)`, "g");
  // A local helper hides the join (`import(toolUrl(repo, "stamp-mint.mjs"))`, escrow-ingest's and
  // stamp-ingest's shape): a line that imports or spawns AND names a pinned module is a reach too.
  const helperReach = new RegExp(`\\b(import\\(|spawnSync\\(|execFileSync\\(|spawn\\()[^\\n]*"(${names})"`);
  const scanned = ["src", "tools", "world2", "deploy"].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.(mjs|js)$/.test(p) && !p.includes(`${sep}town-pins${sep}`) && !p.includes(`${sep}node_modules${sep}`))
    .filter((p) => !SOURCE_LAW_EXEMPT.has(relative(ROOT, p).split(sep).join("/")));
  const found = [];
  for (const p of scanned) {
    readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      const at = `${relative(ROOT, p).split(sep).join("/")}:${i + 1}`;
      if (/^\s*(\/\/|\*)/.test(line)) return;
      for (const m of line.matchAll(reach)) {
        const before = line.slice(0, m.index);
        if (/existsSync\(\s*$/.test(before)) continue;
        found.push(`${at}: ${m[0]}`);
      }
      if (helperReach.test(line) && !/importTownTool|townToolArgv/.test(line)) found.push(`${at}: ${line.trim().slice(0, 140)}`);
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

test("the two snapshot replays reach the town engine only through importTownToolAt", () => {
  for (const f of ["src/world-snapshot.mjs", "src/parcel-room.mjs"]) {
    assert.match(readFileSync(join(ROOT, f), "utf8"), /importTownToolAt(Head)?\(/, `${f} no longer loads its snapshot engine through importTownToolAt`);
  }
});

// ── A CHECKOUT AT A PAST POSITION (importTownToolAt; Wright, POS-994) ──────
// A real git town: c1 holds mint v1, c2 holds mint v2. Pins are written for one
// of them; the checkout stands at the other (or is edited), and the helper either
// loads the checkout's own module or goes through the pins.

function gitTown() {
  const base = tempDir("town-tool-at-");
  const repo = join(base, "town");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid" } }).trim();
  mkdirSync(join(repo, "tools"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  const commit = (who) => {
    writeFileSync(join(repo, "tools", "mint.mjs"), `import { rule } from "./rule.mjs";\nexport const who = "${who}";\nexport const r = rule;\n`);
    writeFileSync(join(repo, "tools", "rule.mjs"), `export const rule = "${who}-rule";\n`);
    git("add", "-A"); git("commit", "-qm", who);
    return git("rev-parse", "HEAD");
  };
  const c1 = commit("v1"), c2 = commit("v2");
  // pins for a commit: the module and its closure as git holds them there
  const pinsAt = (sha) => {
    const root = join(base, `pins-${sha.slice(0, 7)}`);
    const files = collect((p) => execFileSync("git", ["-C", repo, "show", `${sha}:${p}`]), ["mint.mjs"]);
    for (const [p, { bytes }] of files) { mkdirSync(dirname(join(root, p)), { recursive: true }); writeFileSync(join(root, p), bytes); }
    writeFileSync(join(root, "PINS.json"), JSON.stringify(manifest(files, { townCommit: sha, readAt: "2026-11-16T00:00:00Z" })));
    return root;
  };
  return { base, repo, git, c1, c2, pinsAt, done: () => rmSync(base, { recursive: true, force: true }) };
}

test("AT: a checkout at an ANCESTOR of the pin's commit loads its own module (not the pinned one)", async () => {
  const t = gitTown();
  try {
    const root = t.pinsAt(t.c2);
    t.git("checkout", "-q", t.c1);
    assert.equal(ancestorOfPin(t.repo, t.c1, { root }), 0);
    const mod = await importTownToolAt(t.repo, t.c1, "mint.mjs", { root });
    assert.equal(mod.who, "v1", "the checkout's own engine at its own commit");
    assert.equal(mod.r, "v1-rule", "and its own closure");
  } finally { t.done(); }
});

test("AT: a checkout PAST the pin (exit 1) with a differing file stops by name", async () => {
  const t = gitTown();
  try {
    const root = t.pinsAt(t.c1);
    assert.equal(ancestorOfPin(t.repo, t.c2, { root }), 1);
    await assert.rejects(importTownToolAt(t.repo, t.c2, "mint.mjs", { root }), (e) => e instanceof TownPinMismatch && e.file === "tools/mint.mjs");
  } finally { t.done(); }
});

test("AT: a sha git cannot place (exit 128) is never allowed: it goes through the pins and stops", async () => {
  const t = gitTown();
  try {
    const root = t.pinsAt(t.c1);
    const unknown = "0123456789abcdef0123456789abcdef01234567";
    assert.equal(ancestorOfPin(t.repo, unknown, { root }), 128);
    await assert.rejects(importTownToolAt(t.repo, unknown, "mint.mjs", { root }), TownPinMismatch);
  } finally { t.done(); }
});

test("AT: an ancestor checkout EDITED by hand stops: the files that load must be git's at that commit", async () => {
  const t = gitTown();
  const marker = join(t.base, "the-edit-ran");
  try {
    const root = t.pinsAt(t.c2);
    t.git("checkout", "-q", t.c1);
    writeFileSync(join(t.repo, "tools", "rule.mjs"), `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport const rule = "edited";\n`);
    await assert.rejects(importTownToolAt(t.repo, t.c1, "mint.mjs", { root }), (e) => e instanceof TownPinMismatch && e.file === "tools/rule.mjs");
    assert.equal(existsSync(marker), false, "the edited closure file ran");
  } finally { t.done(); }
});

test("AT: past the pin but equal to it, the PINNED copy loads (as importTownTool would)", async () => {
  const t = gitTown();
  try {
    const root = t.pinsAt(t.c2);
    // c2 IS the pin commit, so it is an ancestor-or-equal: its own module. A third commit that keeps the files is past the pin.
    t.git("commit", "-q", "--allow-empty", "-m", "v3, same files");
    const c3 = t.git("rev-parse", "HEAD");
    assert.equal(ancestorOfPin(t.repo, c3, { root }), 1);
    const mod = await importTownToolAt(t.repo, c3, "mint.mjs", { root });
    assert.equal(mod.who, "v2");
    assert.ok(!fileURLToPath(import.meta.url).startsWith(t.repo));
  } finally { t.done(); }
});

// ── THE SANDBOX'S CONDITION (stamp-sandbox.mjs § stampKeyRefusal) ───────────

test("the stamp sandbox refuses to run where a stamp key is present, and runs where none is", () => {
  const base = tempDir("sandbox-key-");
  try {
    const key = join(base, "stamp-key.pem");
    assert.equal(stampKeyRefusal([key, join(base, "nor-this.pem")], { storeUrl: "" }), null, "no key, no store, no refusal");
    // the store's credentials are refused like a key (Truey's re-read of #1065, finding 6)
    assert.match(stampKeyRefusal([key], { storeUrl: "postgres://office@127.0.0.1/world2" }), /^stamp-sandbox: refused — the store's credentials are present \(WORLD2_PG_URL\)/);
    const viaEnv = spawnSync(process.execPath, [join(ROOT, "tools", "stamp-sandbox.mjs")], { encoding: "utf8", env: { ...process.env, STAMP_KEY: "", WITNESS_KEY: "", WORLD2_PG_URL: "postgres://office@127.0.0.1/world2" } });
    assert.equal(viaEnv.status, 3, viaEnv.stderr);
    assert.match(viaEnv.stderr, /the store's credentials are present/);
    writeFileSync(key, "a stand-in, not a key\n");
    const said = stampKeyRefusal([join(base, "nor-this.pem"), key], { storeUrl: "" });
    assert.match(said, /^stamp-sandbox: refused — a stamp key is present at /);
    assert.ok(said.includes(key), "it names the path it found");
    // the CLI exits nonzero with that sentence before it does anything, here via STAMP_KEY
    const r = spawnSync(process.execPath, [join(ROOT, "tools", "stamp-sandbox.mjs")], { encoding: "utf8", env: { ...process.env, STAMP_KEY: key, WORLD2_PG_URL: "" } });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /stamp-sandbox: refused — a stamp key is present at/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

// ── DEV PINS ITS OWN RE-SIGNED TOWN (Wright, POS-994, 2026-11-16) ───────────
// The freshen re-signs dev's town, which rewrites signatures inside the town's
// own tools, then pins THAT town into a folder outside the clone with this exact
// command; the dev units name the folder. Held here on a real git town whose
// "re-sign" commit changes stamp-verify.

function devTown() {
  const base = tempDir("town-tool-dev-");
  const repo = join(base, "town-clone");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid" } }).trim();
  mkdirSync(join(repo, "tools"), { recursive: true });
  git("init", "-q", "-b", "main");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repo, "tools", "registry-source.mjs"), "export const source = 'roll';\n");
  writeFileSync(join(repo, "tools", "stamp-mint.mjs"), "export const mint = 'seed';\nexport const lazy = () => import('./registry-source.mjs');\n");
  writeFileSync(join(repo, "tools", "stamp-verify.mjs"), "import { mint } from './stamp-mint.mjs';\nexport const RULED = new Set(['prod-sig-21582']);\nexport const of = mint;\n");
  git("add", "-A"); git("commit", "-qm", "the seed");
  const seed = git("rev-parse", "HEAD");
  const resign = () => {
    writeFileSync(join(repo, "tools", "stamp-verify.mjs"), "import { mint } from './stamp-mint.mjs';\nexport const RULED = new Set(['dev-sig-21582']);\nexport const of = mint;\n");
    git("commit", "-qam", "dev: the stamp ledger re-signed under dev's own key");
    return git("rev-parse", "HEAD");
  };
  return { base, repo, git, seed, resign, pins: join(base, "town-pins-dev"), done: () => rmSync(base, { recursive: true, force: true }) };
}
const freshenPin = (t) => spawnSync(process.execPath, [join(ROOT, "tools", "town-pins.mjs"), "--write", "--town", t.repo, "--ref", "HEAD", "--out", t.pins], { encoding: "utf8" });

test("DEV: the freshen's pin, run after the re-sign, matches the re-signed clone (and the seed's would not)", async () => {
  const t = devTown();
  try {
    assert.equal(freshenPin(t).status, 0, "the seed's pin");
    assert.equal(JSON.parse(readFileSync(join(t.pins, "PINS.json"), "utf8")).town_commit, t.seed);
    const signed = t.resign();
    // the seed's pins no longer vouch for the re-signed verifier
    assert.throws(() => townTool(t.repo, "stamp-verify.mjs", { root: t.pins }), (e) => e instanceof TownPinMismatch && e.file === "tools/stamp-verify.mjs");
    const r = freshenPin(t);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(join(t.pins, "PINS.json"), "utf8")).town_commit, signed, "the pins name the re-signed commit");
    const townBlob = (c, p) => { try { return t.git("rev-parse", `${c}:${p}`); } catch { return null; } };
    assert.deepEqual(checkPins(t.pins, { townBlob }), [], "every pinned file is the re-signed town's, byte for byte");
    // A RUNNING process keeps the manifest it read: this one still holds the seed's. That is
    // why the freshen restarts the dev office after it re-pins (deploy/postmark-dev-freshen.service).
    assert.throws(() => townTool(t.repo, "stamp-verify.mjs", { root: t.pins }), TownPinMismatch, "the running process still reads the seed's pins");
    // A RESTARTED process (the dev office after the freshen) reads the new pins and loads the re-signed verifier.
    const fresh = spawnSync(process.execPath, ["--input-type=module", "-e",
      `const { importTownTool } = await import(${JSON.stringify(pathToFileURL(join(ROOT, "src", "town-tool.mjs")).href)});
       const m = await importTownTool(process.argv[1], "stamp-verify.mjs", { root: process.argv[2] });
       console.log([...m.RULED].join(","));`, t.repo, t.pins], { encoding: "utf8" });
    assert.equal(fresh.status, 0, fresh.stderr);
    assert.equal(fresh.stdout.trim(), "dev-sig-21582", "the restarted office runs the re-signed verifier");
  } finally { t.done(); }
});

test("DEV: the freshen restarts the dev office only after the pins are written, and never after a failure", () => {
  // The order: the freshen's ExecStart (the script) writes the pins, last of all after
  // the re-signed town's verify; its ExecStartPost restarts the dev office. A oneshot's
  // ExecStartPost runs only once ExecStart has exited 0, so a red verify (the script
  // puts the clone back on the seed, pins the seed again and exits 1) restarts nothing:
  // the dev office keeps the pins it was running, and the unit reads failed.
  const unit = readFileSync(join(ROOT, "deploy", "postmark-dev-freshen.service"), "utf8").split("\n");
  const at = (re) => unit.findIndex((l) => re.test(l));
  assert.notEqual(at(/^Type=oneshot$/), -1, "a oneshot: ExecStartPost waits for ExecStart to exit 0");
  const start = at(/^ExecStart=\/srv\/postmark-office-dev\/postmark-dev-freshen\.sh$/);
  const post = at(/^ExecStartPost=\+\/usr\/bin\/systemctl --no-block restart postmark-office-dev\.service$/);
  assert.ok(start !== -1 && post > start, "the restart is the unit's step after the script, never inside it");
  const script = readFileSync(join(ROOT, "deploy", "postmark-dev-freshen.sh"), "utf8");
  assert.doesNotMatch(script, /systemctl/, "the script itself restarts nothing: only a freshen that exited 0 does");
  const body = script.slice(script.indexOf("bash -c '"));
  const lastPin = body.lastIndexOf("\n  pin\n"), verify = body.indexOf("town-tool.mjs\" run stamp-verify.mjs");
  assert.ok(lastPin !== -1 && verify > lastPin, "the re-signed town is pinned before its verify, and the script's success follows the verify");
});

test("DEV: an --out inside the --town checkout is refused, and nothing is written", () => {
  const t = devTown();
  try {
    const inside = join(t.repo, "pins");
    const r = spawnSync(process.execPath, [join(ROOT, "tools", "town-pins.mjs"), "--write", "--town", t.repo, "--ref", "HEAD", "--out", inside], { encoding: "utf8" });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /is inside the --town checkout/);
    assert.equal(existsSync(inside), false, "nothing written inside the clone");
  } finally { t.done(); }
});

test("DEV: the dev units name dev's pins; no prod unit names TOWN_PINS_DIR, and the loader reads no other switch", () => {
  const LINE = "Environment=TOWN_PINS_DIR=/srv/postmark-office-dev/town-pins-dev";
  for (const f of ["deploy/postmark-office-dev.service-dropin-town-pins.conf", "deploy/postmark-dev-freshen.service"]) {
    assert.ok(readFileSync(join(ROOT, f), "utf8").split("\n").includes(LINE), `${f} names dev's pins`);
  }
  assert.match(readFileSync(join(ROOT, "deploy", "postmark-office-dev.service-dropin-town-pins.conf"), "utf8"), /^# \/etc\/systemd\/system\/postmark-office-dev\.service\.d\/town-pins\.conf$/m);
  assert.match(readFileSync(join(ROOT, "deploy", "postmark-dev-freshen.sh"), "utf8"), /pins="\$dev\/town-pins-dev"/, "the freshen writes where the units point");
  const prod = readdirSync(join(ROOT, "deploy")).filter((n) => /\.(service|timer|socket|conf)$/.test(n) && !/dev/.test(n));
  assert.ok(prod.includes("postmark-office.service") && prod.includes("postmark-ferry.service"));
  for (const n of prod) assert.doesNotMatch(readFileSync(join(ROOT, "deploy", n), "utf8"), /TOWN_PINS_DIR/, `${n} is prod's: it runs the office's own pins`);
  // NO OFF SWITCH: the loader's only environment read is the pins' folder, and a folder is never "none"
  const envReads = readFileSync(join(ROOT, "src", "town-tool.mjs"), "utf8").match(/process\.env\.[A-Z_]+/g) ?? [];
  assert.deepEqual([...new Set(envReads)], ["process.env.TOWN_PINS_DIR"]);
});

// ── THE STRONG SOURCE LAW (Truey's review of #1065, finding 1 and 6) ────────
// The join-shaped law above missed a child script that named the module inside
// a string (`import(pathToFileURL(engineDir + '/stamp-mint.mjs'))`). This one
// reads every line outside comments: a string (any quote, a template literal
// included) naming a pinned module, on a line that imports, spawns or builds a
// path, is a reach unless it goes through the loader. Shell and unit files too:
// a pinned module run by `node … tools/<module>` is a reach unless it is the
// loader's door (`src/town-tool.mjs run`).
const STRONG_EXEMPT = new Map([
  ["src/town-tool.mjs", "the loader itself"],
  ["tools/town-pins.mjs", "the pin writer reads the town's modules to pin them"],
  ["tools/stamp-sandbox.mjs", "the stamp sandbox: exempt by name (Wright, POS-994); it refuses to run where a key is"],
  ["tools/stamp-sandbox-script.mjs", "the stamp sandbox's script, run only by the sandbox"],
  ["src/stamp-verify-pinned.mjs", "the pinned verifier's runner: it imports only from the folder townToolArgv checked and handed it"],
]);
// Known shell reaches, each named with the issue that removes it. (POS-1083's two, settlement-auto.sh's and
// settlement-shadow.sh's `node tools/world-stake.mjs --escrow --json`, went when #1022 rewrote both scripts, POS-1025.)
const SHELL_ALLOW = [];

const LAW_NAMES = MODULES.map((m) => m.replace(/[.]/g, "\\.")).join("|");
// A town module named inside a string: the bare filename as a whole string
// ("stamp-mint.mjs"), or after a "/" that is not "./" ('/stamp-mint.mjs',
// `${dir}/tools/stamp-mint.mjs`). The office's own modules of the same name are
// imported as "./crossings.mjs" or "../src/world-stake.mjs", and a longer name
// that ends in one ("world-crossings.mjs") is not one.
const townName = new RegExp(`(?:['"\`](?:${LAW_NAMES})['"\`])|(?:(?<!\\.)(?<!\\.\\.)/(?:${LAW_NAMES})\\b)`);
const ownModule = new RegExp(`\\.\\.?/(?:src/|world2/tools/|tools/)?(?:${LAW_NAMES})\\b`, "g");
const namesPinned = (line) => townName.test(line.replace(ownModule, ""));
const reachy = /\bimport\s*\(|\brequire\s*\(|\bspawn(Sync)?\s*\(|\bexec(File)?(Sync)?\s*\(|\bjoin\s*\(|\bresolve\s*\(|pathToFileURL|\+\s*['"`]\/|['"`]\/(tools\/)?[a-z-]+\.mjs/;
const runs = /\bimport\s*\(|\brequire\s*\(|\bspawn(Sync)?\s*\(|\bexec(File)?(Sync)?\s*\(/;
const throughLoader = /importTownTool(At|AtHead)?\s*\(|townToolArgv\s*\(|pinnedToolsDir\s*\(|\btownTool\s*\(|town-tool\.mjs["']?\s*run\b/;
// existsSync( is a look, not a reach, only on a line that runs nothing (Truey's
// re-read, finding 3a: `if (existsSync(c)) return import(…stamp-mint.mjs…)` was exempt whole).
const onlyLooks = (line) => /existsSync\s*\(/.test(line) && !runs.test(line);
// A reach whose module name arrives by variable (Truey's re-read, 3b and 3c):
// `import(…join(c, "tools", f)…)`. In a file that holds one, every string naming a
// pinned module counts as a reach unless its line goes through the loader.
const varReach = /(?:\bimport\s*\(|\brequire\s*\(|\bspawn(?:Sync)?\s*\(|\bexec(?:File)?(?:Sync)?\s*\()[^\n]*\bjoin\s*\([^\n]*['"]tools['"]\s*,\s*[A-Za-z_$][\w$]*\s*\)/;

/** The reaches around the loader in one code file (an office .mjs/.js), as "rel:line: text". */
function strongCodeReaches(rel, text) {
  // A child script that imports by folder (`engineDir + '/stamp-mint.mjs'`) passes
  // only where EVERY engineDir in the file is the loader's pinnedToolsDir(...):
  // the folder it is handed was checked against the clone and is the pinned one.
  const assigns = [...text.matchAll(/\bengineDir\s*=\s*([^;\n]+)/g)].map((m) => m[1].trim());
  const childPinned = assigns.length > 0 && assigns.every((a) => /^pinnedToolsDir\(/.test(a));
  const lines = text.split("\n");
  const code = (line) => !/^\s*(\/\/|\*|\/\*)/.test(line);
  const byVariable = lines.some((l) => code(l) && varReach.test(l) && !throughLoader.test(l));
  const found = [];
  lines.forEach((line, i) => {
    if (!code(line)) return;
    if (childPinned && /engineDir \+ '\/[a-z-]+\.mjs'/.test(line)) return;
    if (!namesPinned(line) || throughLoader.test(line) || onlyLooks(line)) return;
    if (reachy.test(line) || byVariable) found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 150)}`);
  });
  return found;
}

const shellRe = new RegExp(`\\bnode\\b[^#]*?\\btools/(${LAW_NAMES})|"\\$[A-Z_]+[^"]*/tools/(${LAW_NAMES})"`);
/** The reaches around the loader in one shell or unit file. */
function strongShellReaches(rel, text) {
  const found = [];
  text.split("\n").forEach((line, i) => {
    if (/^\s*#/.test(line)) return;
    if (!shellRe.test(line) || /town-tool\.mjs run/.test(line)) return;
    // an existence test is a look, not a reach, only on a line that runs no node
    // (Truey's re-read, finding 3d: `[ -f … ] && node "$TOWN_CLONE/tools/stamp-mint.mjs"` was exempt whole)
    if (/\[ !? ?-f /.test(line) && !/\bnode\b/.test(line)) return;
    if (SHELL_ALLOW.some((a) => a.file === rel && line.includes(a.text))) return;
    found.push(`${rel}:${i + 1}: ${line.trim().slice(0, 150)}`);
  });
  return found;
}

test("THE STRONG SOURCE LAW: no string names a pinned module on a reach outside the loader, in code, shell or unit files", () => {
  const code = ["src", "tools", "world2", "deploy"].flatMap((d) => walk(join(ROOT, d)))
    .filter((p) => /\.(mjs|js)$/.test(p) && !p.includes(`${sep}town-pins${sep}`) && !p.includes(`${sep}node_modules${sep}`));
  const found = [];
  for (const p of code) {
    const rel = relative(ROOT, p).split(sep).join("/");
    if (STRONG_EXEMPT.has(rel)) continue;
    found.push(...strongCodeReaches(rel, readFileSync(p, "utf8")));
  }
  const shells = walk(join(ROOT, "deploy")).filter((p) => /\.(sh|service|conf)$/.test(p));
  for (const p of shells) found.push(...strongShellReaches(relative(ROOT, p).split(sep).join("/"), readFileSync(p, "utf8")));
  assert.deepEqual(found, [], `pinned town modules reached around the loader:\n${found.join("\n")}`);
  // NO FOLDER SWITCH AROUND THE PIN (Truey, #1065 finding 1): STAMP_ENGINE_DIR is gone from office code.
  const switches = [...code, ...shells].filter((p) => /STAMP_ENGINE_DIR/.test(readFileSync(p, "utf8").replace(/^\s*(\/\/|\*|#).*$/gm, "")));
  assert.deepEqual(switches.map((p) => relative(ROOT, p)), [], "an engine-folder switch reads past the loader");
  // every allowlisted shell line still exists (a stale allowance is a red, not a silent pass)
  for (const a of SHELL_ALLOW) assert.ok(readFileSync(join(ROOT, a.file), "utf8").includes(a.text), `${a.file} no longer holds "${a.text}": drop it from the allowlist (${a.why})`);
});

// THE LAW'S OWN FALSIFIERS (Truey's re-read of #1065, finding 3): each shape the
// re-read planted and the law missed is planted here and must be caught; beside
// each, the loader's own shape of the same line, which must pass.
test("THE STRONG SOURCE LAW catches the four planted shapes, and passes the loader's shape of each", () => {
  const planted = {
    "(a) existsSync( on the line that imports": [
      `if (existsSync(c)) return import(pathToFileURL(join(c, "tools", "stamp-mint.mjs")).href);`,
      `if (existsSync(join(c, "tools", "stamp-mint.mjs"))) return importTownTool(c, "stamp-mint.mjs");`,
    ],
    "(b) the name in a variable, the reach on another line": [
      `const f = "stamp-mint.mjs";\nconst m = await import(pathToFileURL(join(clone, "tools", f)).href);`,
      `const f = "stamp-mint.mjs";\nconst m = await importTownTool(clone, f);`,
    ],
    "(c) the name handed to a helper": [
      `const T = (c, f) => import(pathToFileURL(join(c, "tools", f)).href);\nconst m = await T(clone, "stamp-mint.mjs");`,
      `const T = (c, f) => importTownTool(c, f);\nconst m = await T(clone, "stamp-mint.mjs");`,
    ],
  };
  for (const [shape, [reach, loader]] of Object.entries(planted)) {
    assert.notDeepEqual(strongCodeReaches("planted.mjs", reach), [], `${shape}: the law misses it`);
    assert.deepEqual(strongCodeReaches("planted.mjs", loader), [], `${shape}: the loader's shape is not a reach`);
  }
  // (d) in shell: an existence test on the same line as the run
  assert.notDeepEqual(strongShellReaches("deploy/planted.sh", '[ -f "$TOWN_CLONE/x" ] && node "$TOWN_CLONE/tools/stamp-mint.mjs" --append'), [], "(d): the law misses it");
  assert.deepEqual(strongShellReaches("deploy/planted.sh", 'if [ ! -f "$TOWN_CLONE/tools/witness-chain.mjs" ]; then echo none; fi'), [], "(d): a look that runs nothing is not a reach");
  assert.deepEqual(strongShellReaches("deploy/planted.sh", '[ -f "$TOWN_CLONE/x" ] && node /srv/postmark-office/src/town-tool.mjs run stamp-mint.mjs --clone "$TOWN_CLONE" -- --append'), [], "(d): the loader's door is not a reach");
});

// ── THE SHELL'S DOOR: 3 is a pin stop, and only that (Truey, #1065 findings 5 and 3) ──
const DOOR = join(ROOT, "src", "town-tool.mjs");
const door = (args, env = {}) => spawnSync(process.execPath, [DOOR, ...args], { encoding: "utf8", env: { ...process.env, ...env } });

test("DOOR: a clone that differs from the pins exits 3, runs nothing, and names the stopped file in --stop-file", () => {
  const f = fixture(TOWN);
  const marker = join(f.base, "the-clone-ran");
  try {
    f.write(f.clone, "tools/rule.mjs", `import { writeFileSync } from "node:fs";\nwriteFileSync(${JSON.stringify(marker)}, "ran");\nexport const rule = "x";\n`);
    const stop = join(f.base, "stop");
    const r = door(["run", "mint.mjs", "--clone", f.clone, "--stop-file", stop, "--", "anything"], { TOWN_PINS_DIR: f.pins });
    assert.equal(r.status, 3, r.stderr);
    assert.match(r.stderr, /^\[town-tool\] the town's tools\/rule\.mjs is not the copy the office pinned/m);
    assert.equal(readFileSync(stop, "utf8").trim(), "tools/rule.mjs");
    assert.equal(existsSync(marker), false, "nothing ran");
  } finally { f.done(); }
});

test("DOOR: anything else it refuses exits 2, never 3: no pins to read, a foreign --repo, a bad call", () => {
  const f = fixture({ "tools/stamp-mint.mjs": "export {};\n" });
  try {
    const empty = join(f.base, "no-pins-here");
    mkdirSync(empty);
    const noPins = door(["run", "stamp-mint.mjs", "--clone", f.clone, "--", "--derive"], { TOWN_PINS_DIR: empty });
    assert.equal(noPins.status, 2, `a missing PINS.json is a broken deploy, not "the town changed": ${noPins.stderr}`);
    const foreign = door(["run", "stamp-mint.mjs", "--clone", f.clone, "--", "--repo", f.base], { TOWN_PINS_DIR: f.pins });
    assert.equal(foreign.status, 2, foreign.stderr);
    assert.match(foreign.stderr, /is not the clone the pin was checked against/);
    assert.equal(door(["run", "stamp-mint.mjs", "--", "x"]).status, 2, "no --clone: a bad call");
    assert.equal(door(["walk"]).status, 2);
  } finally { f.done(); }
});

test("CLONE-FREE: the witness's owe-open and owe-incomplete run from the pinned copy with NO clone at all, and nothing else may", () => {
  // The real pinned witness chain (src/town-pins), its owed queue in a scratch folder,
  // and a --clone that does not exist: if either verb read the clone, it could not run.
  const base = tempDir("town-tool-clonefree-");
  try {
    const owed = join(base, "owed");
    const noClone = join(base, "there-is-no-clone");
    const env = { TOWN_PINS_DIR: PIN_ROOT };
    const open = door(["run", "witness-chain.mjs", "--clone", noClone, "--", "owe-open", "--owed", owed, "--kind", "mail-crossing", "--attempt", "ferry-t1"], env);
    assert.equal(open.status, 0, open.stderr);
    const inc = door(["run", "witness-chain.mjs", "--clone", noClone, "--", "owe-incomplete", "--owed", owed, "--kind", "mail-crossing", "--attempt", "ferry-t1", "--why", "town-pin-mismatch: tools/stamp-mint.mjs"], env);
    assert.equal(inc.status, 0, inc.stderr);
    assert.equal(existsSync(noClone), false, "neither verb made or read the clone");
    const files = walk(owed);
    assert.ok(files.length > 0, "the outcome is owed");
    assert.ok(files.some((p) => readFileSync(p, "utf8").includes("town-pin-mismatch: tools/stamp-mint.mjs")), "owed with the pin stop's own why");
    // every other verb keeps the clone check: publish against a clone that is not there stops
    const pub = door(["run", "witness-chain.mjs", "--clone", noClone, "--", "publish", "--repo", noClone, "--owed", owed, "--key", join(base, "k.pem")], env);
    assert.equal(pub.status, 3, pub.stderr);
    // and the exemption is by name and verb, nowhere else
    assert.throws(() => townToolArgv(noClone, "witness-chain.mjs", ["publish"], { verifyClone: false }), /only witness-chain\.mjs owe-open\/owe-incomplete may run without the clone check/);
    assert.throws(() => townToolArgv(noClone, "stamp-mint.mjs", ["owe-open"], { verifyClone: false }), /only witness-chain\.mjs/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("HOLDER: an owe-open through the door is held by the door's CALLER, not the door (POS-1035)", () => {
  // The ferry unit's shell calls the door, and the door spawns witness-chain. Left to
  // its default (process.ppid), owe-open would name the door, which exits at once, and
  // the next publisher would read the crossing as dead while it still ran. Here the
  // test process is the caller, so the open entry must name process.pid.
  const base = tempDir("town-tool-holder-");
  try {
    const noClone = join(base, "there-is-no-clone");
    const env = { TOWN_PINS_DIR: PIN_ROOT };
    const openEntry = (owed) => walk(owed).map((p) => JSON.parse(readFileSync(p, "utf8"))).find((o) => o.state === "open");
    const owed = join(base, "owed");
    const r = door(["run", "witness-chain.mjs", "--clone", noClone, "--", "owe-open", "--owed", owed, "--kind", "mail-crossing", "--attempt", "ferry-holder"], env);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(openEntry(owed)?.holder?.pid, process.pid, "held by the door's caller");
    // a holder the caller names is kept as named
    const owed2 = join(base, "owed2");
    const named = door(["run", "witness-chain.mjs", "--clone", noClone, "--", "owe-open", "--owed", owed2, "--kind", "mail-crossing", "--attempt", "ferry-named", "--pid", String(process.pid)], env);
    assert.equal(named.status, 0, named.stderr);
    assert.equal(openEntry(owed2)?.holder?.pid, process.pid);
  } finally { rmSync(base, { recursive: true, force: true }); }
  // only owe-open gains a holder, and only when none is named
  assert.deepEqual(holderArgs("witness-chain.mjs", ["owe-open", "--owed", "/o"], 41), ["owe-open", "--owed", "/o", "--pid", "41"]);
  assert.deepEqual(holderArgs("witness-chain.mjs", ["owe-open", "--pid", "7"], 41), ["owe-open", "--pid", "7"]);
  assert.deepEqual(holderArgs("witness-chain.mjs", ["owe-incomplete", "--owed", "/o"], 41), ["owe-incomplete", "--owed", "/o"]);
  assert.deepEqual(holderArgs("stamp-mint.mjs", ["owe-open"], 41), ["owe-open"]);
});

test("AT: a symlinked module in an ancestor checkout is refused by name (node would import it by its real path)", async (t) => {
  const g = gitTown();
  try {
    const root = g.pinsAt(g.c2);
    g.git("checkout", "-q", g.c1);
    const outside = join(g.base, "elsewhere.mjs");
    writeFileSync(outside, "export const rule = 'from elsewhere';\n");
    rmSync(join(g.repo, "tools", "rule.mjs"));
    try { symlinkSync(outside, join(g.repo, "tools", "rule.mjs")); }
    catch (e) { return t.skip(`this machine cannot make a symlink (${e.code})`); }
    await assert.rejects(importTownToolAt(g.repo, g.c1, "mint.mjs", { root }),
      (e) => e instanceof TownPinMismatch && e.file === "tools/rule.mjs" && /a symlink/.test(e.message));
  } finally { g.done(); }
});
