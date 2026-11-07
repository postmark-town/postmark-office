// world-stake-own-receipt.test.mjs — POS-922: a stake's answer names its own
// write, or refuses.
//
//   node --test --test-timeout=180000 test/world-stake-own-receipt.test.mjs
//
// THE REPORT (Wright, 2026-11-06, POS-922): two parallel batches of stakes under
// one hand; lane B's stake on one mark answered `applied 1` with the SAME commit
// as lane A's stake on another, made at about the same moment, and B's stake was
// not on the ledger. "The answer must name its own write, or refuse."
//
// THE FALSIFIER (the description's): two concurrent stakes by one hand on two
// marks, through the REAL lock, exec, town engine and pen (runExec spawns
// src/world-stake-exec.mjs under the flock, exactly as the door does). For every
// answer that says it moved stamps, its commit must hold THAT mark's stake line,
// and the ledger must hold exactly the lines the answers claim.
//
// Synthetic handles and marks; a scratch town, store and remote.

import { after, test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const TOWN = townClone();
const litter = [];
after(() => { for (const d of litter) { try { rmSync(d, { recursive: true, force: true }); } catch { /* litter */ } } });
const scratch = (p) => { const d = mkdtempSync(join(tmpdir(), p)); litter.push(d); return d; };
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const world = scratch("pos922-world-");
mkdirSync(join(world, "WORLD"), { recursive: true });
writeFileSync(join(world, "WORLD", "world-state.json"), JSON.stringify({ tick: 0, dials: {}, marks: [] }));
writeFileSync(join(world, "WORLD", "skeleton.json"), JSON.stringify({ features: [], physics_registry: {} }));
execFileSync("git", ["init", "-q", "-b", "main", world]);
git(world, "add", "-A"); git(world, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "an empty world");

const DAY = "2026-10-13";
const HAND = "sbx-ana";
const FX = TOWN ? (() => {
  const repo = scratch("pos922-town-");
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, repo);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const pem = privateKey.export({ type: "pkcs8", format: "pem" });
  const keyFile = join(scratch("pos922-key-"), "stamp-key.pem");
  writeFileSync(keyFile, pem);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  return { repo, pem, keyFile };
})() : null;

const store = await startStore({ db: "pos922_own_receipt_test" });
const skip = (store.skip ?? false) || (!FX && NO_TOWN) || false;

const savedEnv = {};
const setEnv = (k, v) => { if (!(k in savedEnv)) savedEnv[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; };
if (!skip) {
  setEnv("WORLD_CLONE", world);
  setEnv("TOWN_CLONE", FX.repo);
  setEnv("TOWN_LOCK", join(scratch("pos922-lock-"), "town.lock"));
  setEnv("STAMP_KEY", FX.keyFile);
  setEnv("BOT_NAME", "fixture"); setEnv("BOT_EMAIL", "fixture@test.invalid");
  setEnv("TOWN_PUSH", undefined); setEnv("STAMP_LINES", undefined);
  setEnv("WORLD2_PG", "1"); setEnv("WORLD2_PG_URL", store.url("office_api"));
}

const MINT = FX ? await import(pathToFileURL(join(FX.repo, "tools", "stamp-mint.mjs"))) : null;
if (FX) {
  MINT.appendSigned(FX.repo, [MINT.giftLine({ date: "2026-09-01", handle: HAND, n: 200, slug: "seed", by: "the-town" })], FX.pem);
  git(FX.repo, "add", "-A"); git(FX.repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "fixture town");
}

const { currentCrossing } = await import("../src/crossings.mjs");
const { runExec } = await import("../src/world-stake.mjs");

after(async () => {
  for (const [k, v] of Object.entries(savedEnv)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  if (!(store.skip ?? false)) await store.stop();
});

async function owner(fn) { const c = await store.connect("world2_owner"); try { return await fn(c); } finally { await c.end(); } }
const WIN = 300;
let marks = 0;
async function seed() {
  await owner(async (c) => {
    await c.query("TRUNCATE acts, claims, marks, windows, settlements, households, household_pins CASCADE");
    await c.query(`INSERT INTO windows (id, opens_at, closes_at, status) VALUES ($1, now() - interval '2 days', now() + interval '2 days', 'open')`, [WIN]);
    await c.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, 0, $1, ARRAY[$1], '2026-08-01', $1)`, [HAND]);
  });
}
/** A pending mark of the hand's, as the pen files it. */
async function markOf(slug) {
  const mark = `${HAND}/${slug}-${++marks}`;
  await owner(async (c) => {
    await c.query(`INSERT INTO acts (at, crossing, actor, action, object, class, payload, household) VALUES (now(), $1, $2, 'leave-mark', $3, 'mark', '{}', $4)`, [currentCrossing(), HAND, mark, `hh:${HAND}`]);
    await c.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, bbox, stake, data, slug)
              VALUES ($1, 'sited', $2, $3, 'pending', 'A mark.', $5, '((39,-1),(41,1))', 0, $6, $4)`,
    [WIN, HAND, `hh:${HAND}`, mark, JSON.stringify({ slug: mark, at: { x: 40, y: 0 }, extent: { w: 2, h: 2 } }), JSON.stringify({ by: HAND })]);
  });
  return mark;
}

const stake = (mark) => runExec({ verb: "stake", handle: HAND, mark, n: 1, via: "api", date: DAY });
const ledgerAt = (ref) => git(FX.repo, "show", `${ref}:WHITE_PAGES/stamp-ledger.md`);
/** The stake lines a commit ADDED (its own write), mark by mark. */
const addedStakeMarks = (commit) => git(FX.repo, "diff", `${commit}^`, commit, "--", "WHITE_PAGES/stamp-ledger.md")
  .split("\n").filter((l) => l.startsWith("+- ")).map((l) => /stake:world-mark\/(\S+)/.exec(l)?.[1]).filter(Boolean);

/**
 * THE ASSERTION, per answer: a success's commit is a commit, it ADDED this
 * mark's stake line, and the ledger holds that line; a refusal claims nothing.
 */
function assertOwnWrite(answer, mark, label) {
  if (answer?.error) {
    assert.ok(!answer.applied, `${label}: a refusal claims nothing moved`);
    return 0;
  }
  assert.ok(answer.applied >= 1, `${label}: ${JSON.stringify(answer)}`);
  assert.match(String(answer.commit ?? ""), /^[0-9a-f]{40}$/, `${label}: a stake that moved stamps names its commit`);
  assert.deepEqual(addedStakeMarks(answer.commit), [mark],
    `${label}: LAW (POS-922): "a stake's answer names its own write" — commit ${String(answer.commit).slice(0, 8)} must add ${mark}'s stake line and no other`);
  assert.match(ledgerAt("HEAD"), new RegExp(`stake:world-mark/${mark.replace(/[/.]/g, "\\$&")}\\b`), `${label}: the line is on the ledger`);
  return answer.applied;
}

async function race(rounds, label) {
  for (let i = 0; i < rounds; i++) {
    const a = await markOf("buttress");
    const b = await markOf("south-keeper");
    const [ra, rb] = await Promise.all([stake(a), stake(b)]);
    assertOwnWrite(ra, a, `${label} round ${i} lane A`);
    assertOwnWrite(rb, b, `${label} round ${i} lane B`);
    if (!ra?.error && !rb?.error) assert.notEqual(ra.commit, rb.commit, `${label} round ${i}: two landed stakes are two commits`);
  }
}

// ── THE MECHANISM (measured, POS-922) ───────────────────────────────────────
//
// The stake execs are serialized by the town lock, and the two races above
// pass at the train's tip: two stakes alone never cross. What crosses them is
// a writer the lock does not cover. The server's paper doors write TOWN_CLONE
// in-process without town.lock (write.mjs § THE PEN BATCH), and a refused one
// is put back by `restore`, which may `reset --hard` the clone to the HEAD it
// recorded. Landing between a stake's commit and its receipt, that reset
// takes the stake's commit away and leaves HEAD at the previous write — and
// the pen used to read HEAD as its own commit. The other stake's commit was on
// main, so the receipt "landed": `applied 1`, someone else's sha, a line gone.
//
// The hook below is that writer, at that instant: once, right after lane B's
// stake commit, it resets the clone to the commit before it (as `restore`
// would to its recorded head). Everything under test is real: the lock, the
// exec, the town engine, the pen and its landing.
function resetUnderTheNextCommitOf(mark) {
  const marker = join(scratch("pos922-hook-"), "fired");
  const hook = join(FX.repo, ".git", "hooks", "post-commit");
  writeFileSync(hook, `#!/bin/sh\n[ -e "${marker}" ] && exit 0\ngit log -1 --format=%s | grep -q "${mark}" || exit 0\n: > "${marker}"\ngit reset -q --hard HEAD~1\n`, { mode: 0o755 });
  return { fired: () => { try { readFileSync(marker); return true; } catch { return false; } }, remove: () => rmSync(hook, { force: true }) };
}

for (const pushing of [false, true]) {
  test(`A WRITER RESETS THE CLONE UNDER LANE B (${pushing ? "pushing" : "local"} pen): B refuses rather than answer with A's commit, and A stands`, { skip }, async () => {
    await seed();
    if (pushing) {
      const origin = join(scratch("pos922-origin-"), "town.git");
      execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
      try { git(FX.repo, "remote", "remove", "origin"); } catch { /* none yet */ }
      git(FX.repo, "remote", "add", "origin", origin);
      git(FX.repo, "push", "-q", "-u", "origin", "main");
      setEnv("TOWN_PUSH", "1");
    }
    const a = await markOf("buttress");
    const b = await markOf("south-keeper");
    const writer = resetUnderTheNextCommitOf(b);
    try {
      const [ra, rb] = await Promise.all([stake(a), stake(b)]);
      assert.ok(writer.fired(), "the foreign reset landed between B's commit and its receipt");
      assertOwnWrite(ra, a, "lane A");
      assert.ok(rb?.error, `LAW (POS-922): "names its own write, or refuses" — lane B's own commit is gone, so it must refuse; it answered ${JSON.stringify(rb)}`);
      assert.doesNotMatch(ledgerAt("HEAD"), new RegExp(`stake:world-mark/${b.replace(/[/.]/g, "\\$&")}\\b`), "and B's line is truly not on the ledger");
    } finally {
      writer.remove();
      if (pushing) delete process.env.TOWN_PUSH;
    }
  });
}

// The same writer one step earlier: its reset lands after the engine appended
// the stake's line and before the pen stages it. The pen then finds nothing to
// commit and names no commit; the stake moved nothing on the ledger, so it must
// refuse rather than answer `applied` with no write behind it. The town engine
// in the fixture clone is wrapped (the real engine, then that reset), switched
// on for one mark by POS922_RESET_AFTER_APPLY.
test("A WRITER RESETS THE CLONE BEFORE THE PEN STAGES LANE B's LINE: B refuses rather than answer applied with no commit", { skip }, async () => {
  await seed();
  const tools = join(FX.repo, "tools");
  const real = readFileSync(join(tools, "world-stake.mjs"), "utf8");
  writeFileSync(join(tools, "world-stake-real.mjs"), real);
  writeFileSync(join(tools, "world-stake.mjs"), `import { execFileSync } from "node:child_process";
import * as engine from "./world-stake-real.mjs";
export * from "./world-stake-real.mjs";
export function worldStakeApply(repo, args, keyPem) {
  const out = engine.worldStakeApply(repo, args, keyPem);
  if (process.env.POS922_RESET_AFTER_APPLY && args.mark === process.env.POS922_RESET_AFTER_APPLY)
    execFileSync("git", ["-C", repo, "checkout", "-q", "HEAD", "--", "WHITE_PAGES/stamp-ledger.md"]);
  return out;
}
`);
  git(FX.repo, "add", "-A"); git(FX.repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "the engine, wrapped for one test");
  const b = await markOf("south-keeper");
  setEnv("POS922_RESET_AFTER_APPLY", b);
  try {
    const rb = await stake(b);
    assert.ok(rb?.error, `LAW (POS-922): "names its own write, or refuses" — it answered ${JSON.stringify(rb)}`);
    assert.match(rb.hint, /nothing was staked and your stamps are untouched/);
  } finally {
    delete process.env.POS922_RESET_AFTER_APPLY;
    writeFileSync(join(tools, "world-stake.mjs"), real);
    rmSync(join(tools, "world-stake-real.mjs"), { force: true });
    git(FX.repo, "add", "-A"); git(FX.repo, "-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid", "commit", "-q", "-m", "the engine, unwrapped");
  }
});

test("TWO CONCURRENT STAKES BY ONE HAND, the pen local: each answer names its own write, or refuses", { skip }, async () => {
  await seed();
  await race(6, "local");
});

test("TWO CONCURRENT STAKES BY ONE HAND, the pen pushing to a remote (TOWN_PUSH=1): each answer names its own write, or refuses", { skip }, async () => {
  await seed();
  const origin = join(scratch("pos922-origin-"), "town.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  try { git(FX.repo, "remote", "remove", "origin"); } catch { /* none yet */ }
  git(FX.repo, "remote", "add", "origin", origin);
  git(FX.repo, "push", "-q", "-u", "origin", "main");
  setEnv("TOWN_PUSH", "1");
  try { await race(6, "pushing"); } finally { setEnv("TOWN_PUSH", undefined); process.env.TOWN_PUSH = undefined; delete process.env.TOWN_PUSH; }
});
