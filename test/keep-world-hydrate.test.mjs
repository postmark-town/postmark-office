// keep-world-hydrate.test.mjs — the keeping tick writes the world graph
// snapshot, and only that (POS-270 lane W; world.db retired in 3b), and a miss
// never fails it. Moved off the retired rehydrate unit (POS-268 part 5b).
//
// deploy/office-world-hydrate.sh runs ONE world hydration with ONE output,
// --to-store, connecting as the law pen through deploy/world2-lib.sh §
// w2_pgenv. What is under test is the shell's control flow around it:
//
//   0   written                 → said plainly
//   1   refused / store missed  → the office keeps the snapshot it has, said loudly
//   no credentials              → no hydration at all, said loudly
//
// and in every case no world.db is written and the script exits 0: the keeping
// tick runs it before the panes, and a world that could not hydrate must never
// stop them.
//
// The SHIPPED script and the SHIPPED lib run against a stubbed hydrator. Runs
// under `dash` where it exists (the box's /bin/sh), else `sh`; where neither is
// a real shell, or there is no bash for the lib, the file SKIPS rather than
// passes. The rehydrate's version of this file also stubbed flock and curl for
// the lock and the door receipt; this script has neither, both went with
// office.db.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const scratch = mkdtempSync(join(tmpdir(), "postmark-keep-world-"));
after(() => { try { rmSync(scratch, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });

const works = (shell) => spawnSync(shell, ["-c", "true"], { stdio: "ignore" }).status === 0;
const SH = works("dash") ? "dash" : works("sh") ? "sh" : null;
const skip = !SH ? "no POSIX shell on this machine" : !works("bash") ? "no bash for deploy/world2-lib.sh" : false;
const fwd = (p) => p.replace(/\\/g, "/");

// The hydrator's shell-facing contract: record the call, exit with what the
// case asks. It writes a --db file only if one is asked for, which is the
// thing the tick must never do.
const OFFICE_FILES = {
  "src/world-hydrate.mjs": `
import { appendFileSync, writeFileSync } from "node:fs";
appendFileSync(process.env.STUB_CALLS, "world-hydrate " + process.argv.slice(2).join(" ") + " as=" + (process.env.PGUSER ?? "-") + "\\n");
if (process.argv.includes("--db")) writeFileSync(process.argv[process.argv.indexOf("--db") + 1], "world hydrated\\n");
process.exit(Number(process.env.STUB_WORLD_EXIT || 0));
`,
};

let seq = 0;
function fixture() {
  const root = join(scratch, `run-${++seq}`);
  const office = join(root, "office");
  const write = (base, files) => { for (const [rel, body] of Object.entries(files)) { mkdirSync(dirname(join(base, rel)), { recursive: true }); writeFileSync(join(base, rel), body); } };
  write(office, OFFICE_FILES);
  write(office, { "deploy/world2-lib.sh": readFileSync(join(OFFICE, "deploy", "world2-lib.sh"), "utf8") });
  return { root, office };
}

function hydrate(fx, extra) {
  const script = join(fx.root, "office-world-hydrate.sh");
  writeFileSync(script, readFileSync(join(OFFICE, "deploy", "office-world-hydrate.sh"), "utf8"));
  const env = {
    ...process.env,
    WORLD_CLONE: fwd(join(fx.root, "world")),
    STUB_CALLS: join(fx.root, "calls.txt"),
    WORLD2_ENV_FILE: join(fx.root, "no-such-world2.env"),   // the lib reads the env first, the file only as a fallback
    PG_LAW_INGESTER_PASSWORD: "s3cret",
    ...extra,
  };
  for (const [k, v] of Object.entries(extra ?? {})) if (v === undefined) delete env[k];
  const r = spawnSync(SH, [script], { cwd: fx.office, env, encoding: "utf8", timeout: 60000 });
  const calls = existsSync(env.STUB_CALLS) ? readFileSync(env.STUB_CALLS, "utf8") : "";
  return { ...r, calls, worldDb: existsSync(join(fx.office, "world.db")) || existsSync(join(fx.office, "world.db.new")) };
}

test("0 · ONE hydration writes the store, as the law pen, and no world.db", { skip }, () => {
  const fx = fixture();
  const r = hydrate(fx, { STUB_WORLD_EXIT: "0" });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.calls.trim().split("\n").length, 1, "one world hydration, not two");
  assert.match(r.calls, /--ref blessed --to-store as=law_ingester/, "the store write is asked for, and connects as the law pen");
  assert.doesNotMatch(r.calls, /--db/, "world.db is retired; the tick must not ask for one");
  assert.equal(r.worldDb, false);
  assert.match(r.stdout, /\[office-keep\] the world graph snapshot written to the store/);
});

test("1 · a refused hydration or a store miss leaves the office on the snapshot it has, and the tick goes on", { skip }, () => {
  const fx = fixture();
  const r = hydrate(fx, { STUB_WORLD_EXIT: "1" });
  assert.equal(r.status, 0, "a world miss must never fail the tick (the panes run after it)");
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal, exit 1\)/);
  assert.equal(r.worldDb, false);
});

test("no credentials · no hydration is attempted, and the journal names the missing credential", { skip }, () => {
  const fx = fixture();
  const r = hydrate(fx, { STUB_WORLD_EXIT: "0", PG_LAW_INGESTER_PASSWORD: undefined });
  assert.equal(r.status, 0);
  assert.equal(r.calls.includes("world-hydrate"), false, "a hydration ran with no credential to write what it built");
  assert.match(r.stderr, /WORLD STORE NOT WRITTEN \(non-fatal\) — the law pen's credential is unreadable/);
  assert.equal(r.worldDb, false);
});
