// world2-standing-parity.test.mjs — THE STORE'S STANDING WALK EQUALS THE WORLD'S
// OWN FOLD, ROW FOR ROW, before W2's kind migration and after it.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/world2-standing-parity.test.mjs
//   W2_WORLD=<a world checkout at W2> node --import ./test/helpers/sparse-guard.mjs --test test/world2-standing-parity.test.mjs
//
// `materialize.mjs § recomputeStanding` runs `standing.mjs § computeStanding`
// over the store's rows at step 7 of every crossing and writes `data.tier`
// wherever it disagrees. So if the port and the world's fold disagree about a
// row, the first crossing after a bless MOVES that row's standing. W2 (postmark-
// world #236) re-kinds 141 instance marks (`thing`, `portal-ground`, `town`,
// `timetable`, `vehicle`, `note`), and the port at 674430cce treated only
// `kind: sited | parcel` as ground.
//
// The rows are built the way the store is: `seed-import.mjs § deriveSeed` (the
// `marks` rows, `data.tier` = the fold's answer) and `law-ingest.mjs §
// deriveLaw` (the class rows `law_projection` carries), each through a JSON round
// trip for `jsonb`. The oracle is `seed-import.mjs § foldDerivedFor`, the world's
// own fold over the same checkout, the one the seed and the standing falsifier use.
//
// THE TWO WORLDS:
//   · the pinned world (WORLD_CLONE, test/clone-pins.json), pre-W2;
//   · W2: `W2_WORLD` when set (a checkout, read in place), else W2's head
//     commit in WORLD_CLONE's objects, checked out shared into a temp dir. CI
//     fetches only the pin, so on CI this arm skips and SAYS so, until the pin
//     moves past W2 and the pinned arm is the W2 arm.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { WORLD_CLONE } from "../src/world-store.mjs";
import { computeStanding, classLayerOf } from "../world2/tools/standing.mjs";
import { deriveSeed, foldDerivedFor } from "../world2/tools/seed-import.mjs";
import { deriveLaw } from "../world2/tools/law-ingest.mjs";

/** W2's kind migration with the G12 fold, as it stands on world main after postmark-world#252 (POS-702:
 *  every town mark stands at the constitution). Was #236's head b12b7156, which predates #252, so the port
 *  (which now answers constitution for every town mark) could no longer equal it. */
const W2_SHA = "8c4ed2914a9d7ad654c4ff1ff644a339408b3862";

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
const hasObject = (repo, sha) => { try { git(repo, ["cat-file", "-e", `${sha}^{commit}`]); return true; } catch { return false; } };

const temps = [];
after(() => { for (const d of temps) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });

function sharedCheckout(repo, sha, label) {
  const dir = mkdtempSync(join(tmpdir(), `standing-parity-${label}-`));
  temps.push(dir);
  execFileSync("git", ["clone", "-q", "--shared", "--no-checkout", repo, join(dir, "w")], { stdio: "ignore" });
  git(join(dir, "w"), ["-c", "advice.detachedHead=false", "checkout", "-q", sha]);
  return join(dir, "w");
}

const PINNED_SKIP = existsSync(join(WORLD_CLONE, "WORLD", "marks")) ? false : `no world clone at ${WORLD_CLONE} (set WORLD_CLONE)`;
const W2_FROM = process.env.W2_WORLD
  ? { repo: process.env.W2_WORLD }
  : !PINNED_SKIP && hasObject(WORLD_CLONE, W2_SHA) ? { sha: W2_SHA } : null;
const W2_SKIP = W2_FROM ? false
  : `W2's head ${W2_SHA.slice(0, 8)} is not in ${WORLD_CLONE}'s objects and W2_WORLD is unset (CI fetches only the pin)`;

/**
 * The port over the store's rows against the fold over the files: every slug
 * the two disagree about, `slug: fold X · port Y`, and the census of kinds walked.
 */
async function parity(repo) {
  const jsonb = (v) => JSON.parse(JSON.stringify(v));
  const { records, derive } = await foldDerivedFor(repo);
  // A window handed in: the seed's genesis window reads the town clock out of
  // STATE/log, which the walk never reads (and the sparse clone does not carry).
  const window = { id: 1, opens_at: "2026-10-17T00:00:00Z", cleared_at: "2026-10-17T00:00:00Z" };
  const seed = await deriveSeed({ worldRepo: repo, lawSha: git(repo, ["rev-parse", "HEAD"]).trim(), window });
  const law = await deriveLaw({ lawRepo: repo });
  const rows = jsonb(seed.marks);
  const classes = classLayerOf(jsonb((law.rows ?? law).filter((r) => r.kind === "class")));
  const walk = computeStanding(rows, { classes });
  const diffs = [];
  const kinds = new Map();
  for (const rec of records) {
    if (rec.kind === "class") continue;   // law: law_projection, never `marks`
    kinds.set(String(rec.kind), (kinds.get(String(rec.kind)) ?? 0) + 1);
    const fold = derive(rec).tier, port = walk.get(rec.id);
    if (fold !== port) diffs.push(`${rec.id} (kind ${rec.kind}): fold ${fold} · port ${port}`);
  }
  return { diffs, rows: rows.length, kinds };
}

test("THE PINNED WORLD: the port's standing equals the fold's on every row", { skip: PINNED_SKIP }, async () => {
  const { diffs, rows } = await parity(WORLD_CLONE);
  assert.ok(rows > 500, `a register to compare (${rows} rows)`);
  assert.deepEqual(diffs.slice(0, 20), [], `${diffs.length} row(s) differ`);
});

test("W2: the port's standing equals the G12 fold's on every row, the re-kinded marks among them", { skip: W2_SKIP }, async () => {
  const repo = W2_FROM.repo ?? sharedCheckout(WORLD_CLONE, W2_FROM.sha, "w2");
  const { diffs, rows, kinds } = await parity(repo);
  const rekinded = [...kinds].filter(([k]) => !["sited", "parcel", "predicated", "predicate", "naming", "property"].includes(k));
  assert.ok(rekinded.reduce((a, [, c]) => a + c, 0) > 100, `W2's re-kinded marks are in the register (${JSON.stringify(rekinded)})`);
  assert.ok(rows > 500, `a register to compare (${rows} rows)`);
  assert.deepEqual(diffs.slice(0, 20), [], `${diffs.length} row(s) differ`);
});
