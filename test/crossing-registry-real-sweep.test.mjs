// crossing-registry-real-sweep.test.mjs — THE REAL WORLD SWEEP, NOT THE STUB.
//
//   node --test --test-timeout=180000 test/crossing-registry-real-sweep.test.mjs
//
// ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
//
// `test/crossing-refreshes-the-registry.test.mjs` drives a whole crossing in a
// bottle, and its fixture world carries a `tools/settlement-sweep.mjs` that this
// office repo WROTE — a stub that publishes, reports six channels, and reads
// nothing about the registry. That stub is right for what those tests assert
// (what the CHAIN does), and it blinded them completely to what the WORLD does:
// the first cut of this lane shipped a guard that refused the crossing after
// every quiet one, and F2 asserted the opposite and passed, because the stub
// could not refuse anything.
//
// A falsifier whose fixture cannot express the failure is not a falsifier. So
// this file stands up a real world checkout's OWN `settlement-sweep.mjs` and
// hands it the flags the chain hands it.
//
// ── THE CONTRACT UNDER TEST ─────────────────────────────────────────────────
//
// The office holds the town clone, so the office is the only side that can know
// whether the registry was checked against the live town. It states that, and
// the world checks the statement:
//
//   --registry-verified-at <sha>   checked this crossing. FRESH, whatever stamp
//                                  the file carries — a registry the refresh
//                                  re-derived and found unchanged keeps an older
//                                  one, and the town moves 150-300 commits a day.
//   --registry-unverified <reason> deliberately not checked. NEVER a refusal.
//   neither                        no crossing context; not armed.
//
// ── WHAT A FAILURE HERE MEANS ───────────────────────────────────────────────
//
// If the world checkout this test finds does not understand those flags, this
// file goes RED rather than skipping. That is deliberate: the office half is
// only correct alongside the world half, and a red here is that coupling made
// mechanical instead of left in a paragraph of a report.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tempDir } from "./helpers/temp-dir.mjs";
import { fileURLToPath } from "node:url";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A world checkout to borrow `tools/` from. Env first, so a box or a CI job can
 * point this anywhere; then the office's own world clone, which is what the real
 * office carries; then the sibling clone this fleet keeps beside it.
 */
function findWorldCheckout() {
  const candidates = [
    process.env.POSTMARK_WORLD_CLONE,
    process.env.WORLD_CLONE,
    join(OFFICE, "world-clone"),
    join(OFFICE, "..", "postmark-world"),
    join(OFFICE, "..", "worktrees", "households-refresh-world"),
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(join(c, "tools", "settlement-sweep.mjs"))) return c;
  return null;
}

const WORLD = findWorldCheckout();
// A NAMED SKIP, and only for the one condition a box can genuinely lack: no
// world checkout anywhere. Everything else fails loudly.
const WHY_SKIP = WORLD ? false : "no world checkout found (set POSTMARK_WORLD_CLONE)";

/** A world the real sweep will accept: its own tools, one mark, one registry. */
function worldWith(t, registry) {
  const repo = tempDir("postmark-real-sweep-");
  t.after(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* litter */ } });

  cpSync(join(WORLD, "tools"), join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WORLD", "marks", "let-there-be-light"), { recursive: true });
  writeFileSync(join(repo, "WORLD", "skeleton.json"),
    `${JSON.stringify({ features: [], physics_registry: {} }, null, 2)}\n`);
  writeFileSync(join(repo, "WORLD", "marks", "let-there-be-light", "mark.md"),
    "---\nkind: sited\nby: the-town\ntier: constitution\nat: { x: 0, y: 0 }\n"
    + "extent: { w: 320000, h: 320000 }\ndate: 2026-07-01\n---\n\nthe frame\n");
  writeFileSync(join(repo, "WORLD", "households.json"), `${JSON.stringify(registry, null, 2)}\n`);
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "world-fixture", type: "module" }));

  const stakes = join(repo, "stakes.json");
  writeFileSync(stakes, "[]");
  const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  execFileSync(process.execPath, [join(repo, "tools", "marks-fold.mjs")], { cwd: repo });
  git("add", "-A");
  git("-c", "user.name=fixture", "-c", "user.email=f@test.invalid", "commit", "-q", "-m", "canon");
  return { repo, stakes };
}

/** Run the world's OWN sweep, exactly as deploy/settlement-auto.sh runs it. */
function realSweep({ repo, stakes }, flags) {
  const r = spawnSync(process.execPath,
    [join(repo, "tools", "settlement-sweep.mjs"), "--stakes", stakes, ...flags, "--json"],
    { cwd: repo, encoding: "utf8" });
  return { ...r, all: `${r.stdout}${r.stderr}` };
}

const A = "a".repeat(40);   // the town a registry was derived from
const B = "b".repeat(40);   // the town a later crossing pinned — always different
const STAMPED = { town_sha: A, households: { alpha: "gh:1" }, logins: { "alpha-hub": "gh:1" } };
const UNSTAMPED = { households: { alpha: "gh:1" }, logins: { "alpha-hub": "gh:1" } };

test("the world checkout under test understands the verification flags at all", { skip: WHY_SKIP }, (t) => {
  // Asserted first and on its own, so a failure here reads as "the world half
  // has not landed beside this office half" and not as a defect in the cases
  // below. This is the merge-order coupling, mechanical.
  const src = readFileSync(join(WORLD, "tools", "settlement-sweep.mjs"), "utf8");
  assert.match(src, /--registry-verified-at/,
    `the world checkout at ${WORLD} does not read --registry-verified-at. The office half of this lane is `
    + "only correct alongside the world half; land them in the same crossing.");
  assert.match(src, /--registry-unverified/, "…and the bypass flag likewise");
});

test("F14a · THE BLOCKER — verified this crossing, file stamped with an OLDER town: the sweep does NOT refuse", { skip: WHY_SKIP }, (t) => {
  // The crossing after a quiet one. The export rewrites the file only when the
  // MAPPING moved, so this registry keeps the stamp of the town it was derived
  // from while the crossing pins a newer one. The town takes 150-300 commits a
  // day, so this is not an edge case: it is every crossing on which nobody
  // joined. A guard comparing the two for equality stops the town.
  const w = worldWith(t, STAMPED);
  const r = realSweep(w, ["--registry-verified-at", B]);
  assert.ok(!/registry-freshness/.test(r.all),
    `a registry VERIFIED this crossing is fresh whatever stamp it carries — refusing it stops the town on `
    + `every quiet day: ${r.all.slice(0, 500)}`);
  assert.equal(r.status, 0, `and the crossing completes: ${r.all.slice(0, 400)}`);
});

test("F14b · verified this crossing over an UNSTAMPED file: the sweep REFUSES", { skip: WHY_SKIP }, (t) => {
  // The 2026-08-07 file exactly: no `town_sha`, because the export has never
  // written it. A verified registry is a written one, so a claim of verification
  // over this file cannot be true, and the incident that started this lane is
  // the one thing the world side can still catch on its own.
  const w = worldWith(t, UNSTAMPED);
  const r = realSweep(w, ["--registry-verified-at", B]);
  assert.notEqual(r.status, 0, "it must refuse");
  assert.match(r.all, /registry-freshness/, "by name, so the receipt can classify it");
  assert.match(r.all, /NO town_sha/, "and it must say what is wrong with the file, not just that something is");
});

test("F14c · THE BYPASS ACTUALLY BYPASSES — unverified, over the same unstamped file", { skip: WHY_SKIP }, (t) => {
  // The second blocker review caught: `SETTLEMENT_REGISTRY=0` is documented as
  // the escape hatch for an operator whose export is broken, and the first cut
  // passed a verification unconditionally, so the hatch refused on the very file
  // it exists to tolerate. A bypass that refuses is not a bypass.
  const w = worldWith(t, UNSTAMPED);
  const r = realSweep(w, ["--registry-unverified", "SETTLEMENT_REGISTRY=0"]);
  assert.ok(!/registry-freshness/.test(r.all),
    `a declared bypass must never be a refusal: ${r.all.slice(0, 400)}`);
  assert.equal(r.status, 0, `and the town crosses: ${r.all.slice(0, 400)}`);
});

test("F14d · no statement at all: not armed, so hand runs and the isolation pass still work", { skip: WHY_SKIP }, (t) => {
  const w = worldWith(t, UNSTAMPED);
  const r = realSweep(w, []);
  assert.ok(!/registry-freshness/.test(r.all), "an unarmed sweep is today's contract, unchanged");
  assert.equal(r.status, 0);
});

test("F14e · THE CAN-FAIL FLIP — the equality guard this lane shipped WOULD have refused F14a", { skip: WHY_SKIP }, () => {
  // F14a asserts an absence of a refusal, and an absence is what a sweep that
  // ignores the flag entirely produces too. So the control: the rule as it was
  // first written, evaluated on F14a's own inputs, must refuse them. Written out
  // here rather than imported, because the point is that it no longer exists.
  const asShipped = (registry, pinnedTownSha) =>
    (registry?.town_sha ?? null) === pinnedTownSha ? null : "REFUSED";
  assert.equal(asShipped(STAMPED, B), "REFUSED",
    "the shipped guard refused the crossing after a quiet one — if this passes, F14a is asserting nothing");
  assert.equal(asShipped(UNSTAMPED, B), "REFUSED",
    "and it refused the documented bypass too, which is the second blocker");
  assert.equal(asShipped(STAMPED, A), null,
    "it only ever passed when the town had not moved between two crossings, which the town does not do");
});
