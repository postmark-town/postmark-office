// fold-buffer.test.mjs — POS-710: a fold over a world past 1 MiB answers, never ENOBUFS.
//
// The stake forecast folds the world in a child (world-branches.mjs §
// foldedStateAtRef) and reads the whole folded state off its stdout. At Node's
// 1 MiB default every forecast failed ENOBUFS once world-state.json passed it
// (1.46 MB at S119, 2026-10-19). The fixture's fold prints a 1.5 MB state, the
// size prod's is today.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/fold-buffer.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const repo = mkdtempSync(join(tmpdir(), "postmark-fold-buffer-"));
after(() => { try { rmSync(repo, { recursive: true, force: true, maxRetries: 5 }); } catch { /* litter */ } });
const put = (path, text) => { mkdirSync(dirname(join(repo, path)), { recursive: true }); writeFileSync(join(repo, path), text); };

// 1,500 marks of ~1 KB each: a prev state, and a folded state, of about 1.5 MB.
const MARKS = Array.from({ length: 1500 }, (_, i) => ({ id: `h${i}/m${i}`, by: `h${i}`, kind: "sited", tier: "market", stamps: 0, weight: 0, body: "x".repeat(1000) }));
const PREV = JSON.stringify({ tick: 119, dials: {}, parcels: [], determined: {}, vague: [], rivalries: [], portfolios: {}, terrain_weight: {}, errors: [], marks: MARKS });
put("WORLD/world-state.json", PREV);
put("WORLD/skeleton.json", JSON.stringify({ features: [], physics_registry: {} }));
put("WORLD/marks/.keep", "");
// The fold: the prev state carried one tick on, printed whole, as marks-fold --json does.
put("tools/marks-fold.mjs", `
import { readFileSync } from "node:fs";
const args = process.argv.slice(2);
const prev = JSON.parse(readFileSync(args[args.indexOf("--prev") + 1], "utf8"));
process.stdout.write(JSON.stringify({ ...prev, tick: prev.tick + 1 }));
`);
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
git("init", "-q", "-b", "main");
git("add", "-A");
git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a world past 1 MiB");

const { foldedStateAtRef } = await import("../src/world-branches.mjs");

test("POS-710 · a fold whose state is past 1 MiB is read whole (no ENOBUFS)", () => {
  assert.ok(PREV.length > 1024 * 1024, `the fixture is past the 1 MiB default: ${PREV.length} bytes`);
  const state = foldedStateAtRef(repo, "refs/heads/main", { stakes: [] });
  assert.equal(state.tick, 120);
  assert.equal(state.marks.length, 1500);
  assert.ok(JSON.stringify(state).length > 1024 * 1024, "the answer read back is the whole state");
});
