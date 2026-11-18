// month-close-apply.test.mjs — the monthly close's apply, on a real Postgres and real git (POS-851).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/month-close-apply.test.mjs
//
// The plan, the calendar, Starforge's arithmetic and the fingerprint's inputs are test/month-close.test.mjs. This file is
// the landing: one stamped pen commit per pot through the store-backed seam, bound to a reviewed fingerprint, stopping at
// the first failure, and saying "reconciliation required" when Git landed and the store's COMMIT did not.
//
// THE RULING (Darko, 2026-11-13 08:4x EST, "accept."): "one commit per pot, stop at the first failure, Starforge's amounts
// by hand, an empty pot is an error." The packet's line (Rivet, 2026-11-01): "A late head move or any failed/ambiguous
// landing stops the batch. Earlier confirmed pots remain completed; later pots are explicitly not attempted ... The
// documented Git-landed/SQL-COMMIT-failed window remains: classify it requires reconciliation, do not run the close
// again."
//
// THE FAILPOINTS ARE REAL, not stubs of the seam: a push a bare origin's pre-receive hook refuses, a stamp head another
// writer moves between the plan and the landing (a row inserted by the owner role), a remote that cannot be reached, a
// town close that signs nothing, and a DEFERRED CONSTRAINT TRIGGER that makes Postgres refuse the COMMIT itself after Git
// has landed. Synthetic handles, pots and dollars throughout.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { NO_TOWN, townClone } from "./fixture-paths.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { makeTown, git, MONTH, CLOSE_DATE, NOW } from "./helpers/month-close-town.mjs";
import { engineOf, syncStampLinesVia, verifyStampLinesVia } from "../src/stamp-lines.mjs";
import { withTownLockHeld, LOCK_BUSY, LOCK_HELD_TOO_LONG } from "../src/town-lock.mjs";
import { planMonthClose, applyMonthClose, runCloseDefault, verifyTownDefault, APPLY_HOLD_SEC, EXIT } from "../src/month-close.mjs";
import { main } from "../tools/month-close.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TOWN = townClone();
const skip = NO_TOWN && !TOWN ? "no town clone here" : false;
const tmp = tempDir("month-close-apply-");
const ATT = [{ pot: "keeping-ec2", usd: 40, ref: "inv-1" }, { pot: "meeps-fund", usd: 100, ref: "inv-2" }];

let store, office, owner;
before(async () => {
  if (skip) return;
  store = await startStore({ db: "month_close_apply" });
  office = await store.connect("office_api");
  owner = await store.connect("world2_owner");
  Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), STAMP_LINES: "store", TOWN_PUSH: "1", BOT_NAME: "postmark-office[bot]", BOT_EMAIL: "office@postmark.invalid", TOWN_LOCK: join(tmp, "town.lock") });
});
after(async () => {
  for (const c of [office, owner]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

async function freshTown(opts = {}) {
  const t = await makeTown({ tmp, townSource: TOWN, ...opts });
  await owner.query("DELETE FROM stamp_lines");
  t.engine = await engineOf(t.dir);
  await office.query("BEGIN"); await syncStampLinesVia(office, t.dir, { engine: t.engine }); await office.query("COMMIT");
  return t;
}
const plan = (t, over = {}) => planMonthClose({ clone: t.dir, month: MONTH, date: CLOSE_DATE, now: NOW, attestations: ATT, ...over });
const apply = (t, fingerprint, over = {}) => applyMonthClose({ clone: t.dir, month: MONTH, date: CLOSE_DATE, attestations: ATT, fingerprint, keyPath: t.keyFile, now: NOW, ...over });
const rows = async () => Number((await office.query("SELECT count(*) n FROM stamp_lines")).rows[0].n);
const originTip = (t) => git(t.origin, "rev-parse", "main").trim();
const originCount = (t) => Number(git(t.origin, "rev-list", "--count", "main").trim());
const ledgerOf = (t) => t.M.parseStampLedger(t.ledgerText()).map((e) => e.canonical);
const state = async (t) => ({ head: git(t.dir, "rev-parse", "HEAD").trim(), dirt: git(t.dir, "status", "--porcelain").trim(), origin: originTip(t), rows: await rows(), ledger: t.ledgerText(), prov: readFileSync(join(t.dir, "WHITE_PAGES", "starforge-provisional.json"), "utf8") });
const outcomes = (r) => r.pots.map((p) => [p.pot, p.outcome]);
const selected = (p) => p.plan.pots.filter((x) => x.status === "selected");

test("THE APPLY: three stamped pen commits, one per pot, each the plan's own rows; the store, the clone, the remote and the town's verifier all agree; and the Starforge dollars never reach the real ledger", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  assert.equal(p.ok, true, JSON.stringify(p.refusals));
  const locks = [];
  const lock = (fn, opts) => { locks.push(opts); return withTownLockHeld(fn, opts); };
  const res = await apply(t, p.fingerprint, { lock });
  assert.equal(res.status, "completed", JSON.stringify(res));
  assert.deepEqual(outcomes(res), [["darko-fund", "closed"], ["keeping-ec2", "closed"], ["meeps-fund", "closed"]]);
  assert.deepEqual(res.not_attempted, []);
  assert.deepEqual(locks, [{ shared: false, holdSec: APPLY_HOLD_SEC }], "the shared writer lock is taken ONCE for the batch, exclusively, never per pot or per child");

  // one commit per pot, in order, on the remote
  assert.equal(originCount(t), 4, "the seed and three closes");
  const subjects = git(t.origin, "log", "--format=%s", "-3", "main").trim().split("\n").reverse();
  assert.deepEqual(subjects, [
    "close: darko-fund 2026-10 (the monthly close, 2 row(s))",
    "close: keeping-ec2 2026-10 (the monthly close, 2 row(s); Starforge provisional recorded)",
    "close: meeps-fund 2026-10 (the monthly close, 3 row(s); Starforge provisional recorded)",
  ]);
  const files = (sha) => git(t.origin, "show", "--name-only", "--format=", sha).trim().split("\n").sort();
  const shas = git(t.origin, "log", "--format=%H", "-3", "main").trim().split("\n").reverse();
  assert.deepEqual(files(shas[0]), ["WHITE_PAGES/stamp-ledger.md"], "a pot with no attested contribution commits its ledger rows only");
  assert.deepEqual(files(shas[1]), ["WHITE_PAGES/stamp-ledger.md", "WHITE_PAGES/starforge-provisional.json"], "the provisional entry rides in the SAME commit as its pot's rows");
  assert.deepEqual(files(shas[2]), ["WHITE_PAGES/stamp-ledger.md", "WHITE_PAGES/starforge-provisional.json"]);
  assert.deepEqual(res.pots.map((x) => x.commit), shas, "the answer names each pot's own commit");
  assert.equal(git(t.origin, "log", "-1", "--format=%an", "main").trim(), "postmark-office[bot]", "the pen's ceremony: the office bot");

  // sequential dry-run/apply parity: the town's own CLI, deriving on the real ledger one pot at a time, wrote exactly the rows the planner derived in memory
  assert.deepEqual(ledgerOf(t).slice(13), selected(p).flatMap((x) => x.lines));
  // the store, the export and the town's verifier
  assert.equal(await rows(), 20, "the store holds every line");
  const v = await verifyStampLinesVia(office, t.dir, { engine: t.engine });
  assert.deepEqual([v.ok, v.problems, v.held, v.exported], [true, [], 20, 20]);
  assert.equal(verifyTownDefault(t.dir).ok, true, "the town's own verifier is green over the closed ledger");
  assert.deepEqual(res.pots.map((x) => x.ledger_after), [15, 17, 20]);

  // Starforge: provisional only
  const prov = JSON.parse(readFileSync(join(t.dir, "WHITE_PAGES", "starforge-provisional.json"), "utf8"));
  assert.deepEqual(prov.entries.map((e) => [e.pot, e.epoch, e.usd, e.holo_would_mint]), [["keeping-ec2", MONTH, 40, 8], ["meeps-fund", MONTH, 100, 13]]);
  assert.equal(prov.total_holo_would_mint, 21);
  const real = ledgerOf(t);
  assert.ok(!real.some((l) => l.includes("starforge-provisional")), "the counterfactual's receipt never reached the ledger");
  assert.ok(!t.M.foldHolo(real.map((canonical) => ({ canonical }))).has("wright"), "the credited household holds no minted holo: provisional is not a balance");
  assert.ok(!real.some((l) => /pot-receipt/.test(l) && /wright/.test(l)), "and no Starforge receipt");

  // safe repetition: a later run reports the work as complete and appends nothing
  const again = await plan(t);
  assert.equal(again.ok, true, JSON.stringify(again.refusals));
  assert.deepEqual(again.plan.pots.filter((x) => x.order).map((x) => x.status), ["already-complete", "already-complete", "already-complete"]);
  const rerun = await apply(t, again.fingerprint);
  assert.deepEqual([rerun.status, rerun.pots], ["completed", []], "nothing to close, nothing closed");
  assert.equal(originCount(t), 4);
  assert.equal(await rows(), 20);
});

test("THE APPLY IS BOUND TO THE REVIEWED PLAN: no fingerprint, a different one, a moved input (a receipt, a pot's metadata) each refuse and change nothing; the switches and the key are checked first", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const before = await state(t);
  const refuses = async (fp, code, over = {}) => { const r = await apply(t, fp, over); assert.equal(r.status, "refused", JSON.stringify(r)); assert.deepEqual(r.refusals.map((x) => x.code), [code], JSON.stringify(r.refusals)); assert.deepEqual(await state(t), before, `${code}: nothing changed`); };
  await refuses(undefined, "no-fingerprint");
  await refuses("abc123", "no-fingerprint");
  await refuses("0".repeat(64), "plan-changed");
  await refuses(p.fingerprint, "push-off", { env: { ...process.env, TOWN_PUSH: "0" } });
  await refuses(p.fingerprint, "store-not-on", { env: { ...process.env, STAMP_LINES: "" } });
  await refuses(p.fingerprint, "no-key", { keyPath: join(tmp, "no-such-key.pem") });
  await refuses(p.fingerprint, "plan-changed", { attestations: [{ pot: "keeping-ec2", usd: 41, ref: "inv-1" }, ATT[1]] });
  await refuses(p.fingerprint, "plan-changed", { date: "2026-11-01" });

  // town traffic that arrives after the review: another clone appends a receipt and pushes; the store takes it in. The apply's pull brings it, the re-plan differs, it refuses.
  const other = `${t.dir}-other`;
  git(tmp, "clone", "-q", "-c", "core.autocrlf=false", t.origin, other); // LF in, LF out: a CRLF checkout re-committed would change every pinned file
  t.M.appendSigned(other, [t.M.potReceiptLine({ date: "2026-10-25", pot: "keeping-ec2", rail: "stripe", usd: 1, from: "dee", ref: "t-after-review" })], t.pem);
  git(other, "add", "-A"); git(other, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a receipt after the review"); git(other, "push", "-q", "origin", "main");
  await office.query("BEGIN"); await syncStampLinesVia(office, other, { engine: t.engine }); await office.query("COMMIT");
  const r = await apply(t, p.fingerprint);
  assert.deepEqual([r.status, r.refusals.map((x) => x.code)], ["refused", ["plan-changed"]], `a changed receipt set needs a fresh dry run: ${JSON.stringify(r.refusals)}`);
  assert.equal(originCount(t), 2, "nothing was written to the remote: the seed and the receipt");
  assert.equal(ledgerOf(t).length, 14, "the clone was brought to the town, and nothing was appended");
  assert.equal(await rows(), 14);

  // the same, for metadata: a pot's posted need moves on origin
  const p2 = await plan(t);
  assert.equal(p2.ok, true, JSON.stringify(p2.refusals));
  writeFileSync(join(other, "WHITE_PAGES", "pot-meeps-fund.json"), readFileSync(join(other, "WHITE_PAGES", "pot-meeps-fund.json"), "utf8").replace("200", "180"));
  git(other, "add", "-A"); git(other, "-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a posted need moves"); git(other, "push", "-q", "origin", "main");
  const r2 = await apply(t, p2.fingerprint);
  assert.deepEqual([r2.status, r2.refusals.map((x) => x.code)], ["refused", ["plan-changed"]], "changed metadata too");
  assert.equal(ledgerOf(t).length, 14);
});

test("STOP AT THE FIRST FAILURE: a failure on the second pot leaves the first closed and the rest not attempted; a continuation is a NEW plan that finds the first complete and never replays it", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const res = await apply(t, p.fingerprint, { hooks: { beforeWrite: (e) => { if (e.pot === "keeping-ec2") throw new Error("failpoint: before the write"); } } });
  assert.equal(res.status, "partial");
  assert.deepEqual(outcomes(res), [["darko-fund", "closed"], ["keeping-ec2", "not-landed"]]);
  assert.deepEqual(res.not_attempted, ["meeps-fund"], "later pots are explicitly not attempted");
  assert.equal(originCount(t), 2, "the seed and darko-fund only");
  assert.equal(ledgerOf(t).length, 15);
  assert.equal(await rows(), 15, "the store holds exactly what the remote holds");
  assert.equal(git(t.dir, "status", "--porcelain").trim(), "", "the failed pot left nothing behind in the clone");
  assert.match(res.pots[1].detail, /failpoint: before the write/);

  const cont = await plan(t);
  assert.equal(cont.ok, true, JSON.stringify(cont.refusals));
  assert.deepEqual(cont.plan.pots.filter((x) => x.order).map((x) => [x.pot, x.status]), [["darko-fund", "already-complete"], ["keeping-ec2", "selected"], ["meeps-fund", "selected"]]);
  assert.notEqual(cont.fingerprint, p.fingerprint, "a continuation needs a new reviewed plan");
  assert.deepEqual(selected(cont).map((x) => x.lines), selected(p).slice(1).map((x) => x.lines), "and it preserves the approved order and the approved rows (the prefix is the same)");
  const stale = await apply(t, p.fingerprint);
  assert.deepEqual([stale.status, stale.refusals.map((x) => x.code)], ["refused", ["plan-changed"]], "the old fingerprint cannot drive the continuation");
  const done = await apply(t, cont.fingerprint);
  assert.equal(done.status, "completed", JSON.stringify(done));
  assert.deepEqual(outcomes(done), [["keeping-ec2", "closed"], ["meeps-fund", "closed"]]);
  const returns = ledgerOf(t).filter((l) => /· holo · .* · pot:darko-fund · epoch:2026-10/.test(l));
  assert.equal(returns.length, 1, "darko-fund's money was written once");
  assert.equal(ledgerOf(t).length, 20);
});

test("FAILPOINT, the town's close: a signer that cannot sign, a close that writes nothing, a close that writes rows the plan did not derive: nothing lands, the clone is put back", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const before = await state(t);
  // signing: a key that is not a key (the town's own child dies inside its signature, before it appends)
  const badKey = join(tmp, "bad-key.pem"); writeFileSync(badKey, "not a pem\n");
  const signing = await apply(t, p.fingerprint, { keyPath: badKey });
  assert.deepEqual([signing.status, outcomes(signing)], ["partial", [["darko-fund", "not-landed"]]]);
  assert.match(signing.pots[0].detail, /the town's close did not run/);
  assert.deepEqual(signing.not_attempted, ["keeping-ec2", "meeps-fund"]);
  assert.deepEqual(await state(t), before, "nothing anywhere");
  // a close that exits clean and appends nothing (the town's CLI does exactly that with no key)
  const silent = await apply(t, p.fingerprint, { runClose: () => "no --key — nothing appended" });
  assert.match(silent.pots[0].detail, /did not append the planned rows \(0 appended, 2 planned\)/);
  assert.deepEqual(await state(t), before);
  // parity: the town's own derivation disagrees with the plan (here, another date): the rows are held to the plan byte for byte, and put back
  const differs = await apply(t, p.fingerprint, { runClose: (a) => runCloseDefault({ ...a, date: "2026-11-03" }) });
  assert.match(differs.pots[0].detail, /did not append the planned rows/);
  assert.deepEqual(await state(t), before, "the rows the CLI had written were unmade");
  assert.equal(differs.pots[0].outcome, "not-landed");
});

test("THE IN-LOCK PREFIX GUARD: a ledger that moved after the plan is refused by name before the town's close runs, not discovered by the rows check", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const before = await state(t);
  let ran = false;
  const res = await apply(t, p.fingerprint, {
    runClose: (a) => { ran = true; return runCloseDefault(a); },
    hooks: { beforeWrite: () => { t.M.appendSigned(t.dir, [t.M.potReceiptLine({ date: "2026-10-26", pot: "darko-fund", rail: "stripe", usd: 1, from: "dee", ref: "t-moved" })], t.pem); } },
  });
  assert.deepEqual([res.status, outcomes(res)], ["partial", [["darko-fund", "not-landed"]]]);
  assert.match(res.pots[0].detail, /the ledger is not the prefix the plan stood on/);
  assert.equal(ran, false, "the town's close never ran over a moved ledger");
  assert.deepEqual(await state(t), before, "and the moved line was put back");
});

test("FAILPOINT, the head moves: another writer records a stamp row between the plan and the landing; nothing lands and the clone is put back", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const res = await apply(t, p.fingerprint, { hooks: { afterPlan: async (pl) => { await owner.query("INSERT INTO stamp_lines (seq, canonical, sig, seal) VALUES ($1, '- 2026-10-31 · another writer', 'another-writers-sig', $2)", [pl.head.seq + 1, "0".repeat(64)]); } } });
  assert.deepEqual([res.status, outcomes(res)], ["partial", [["darko-fund", "not-landed"]]]);
  assert.match(res.pots[0].detail, /stamp head moved/);
  assert.equal(originCount(t), 1, "nothing was pushed");
  assert.equal(ledgerOf(t).length, 13, "and the clone is put back");
  assert.equal(git(t.dir, "status", "--porcelain").trim(), "");
  assert.equal(await rows(), 14, "(only the other writer's own row stands in the store)");
  assert.deepEqual(res.not_attempted, ["keeping-ec2", "meeps-fund"]);
});

test("FAILPOINT, the push: a remote that refuses the push is NOT LANDED (nothing anywhere); a remote that cannot be reached at all is AMBIGUOUS and stops as reconciliation required", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const before = await state(t);
  const hook = join(t.origin, "hooks", "pre-receive");
  writeFileSync(hook, "#!/bin/sh\necho refused by the failpoint >&2\nexit 1\n"); chmodSync(hook, 0o755);
  const refused = await apply(t, p.fingerprint);
  assert.deepEqual([refused.status, outcomes(refused)], ["partial", [["darko-fund", "not-landed"]]]);
  assert.match(refused.pots[0].detail, /the push could not land/);
  assert.deepEqual(await state(t), before, "the commit was unmade and the store rolled back with it");
  writeFileSync(hook, "#!/bin/sh\nexit 0\n");
  // unreachable remote: the fetch itself throws, so whether anything landed cannot be read
  const good = t.origin;
  const res = await apply(t, p.fingerprint, { hooks: { beforeWrite: () => { git(t.dir, "remote", "set-url", "origin", join(tmp, "nowhere.git")); } } });
  git(t.dir, "remote", "set-url", "origin", good);
  assert.equal(res.status, "reconciliation-required", JSON.stringify(res));
  assert.match(res.pots[0].detail, /whether Git landed is not proven/);
  assert.equal(await rows(), 13, "the store rolled back: the open question is Git's, and it is named");
});

test("FAILPOINT, Git landed and Postgres then REFUSED THE COMMIT (a deferred constraint trigger): RECONCILIATION REQUIRED, not retried, later pots not attempted, and the next run refuses until the store is reconciled", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  await owner.query(`CREATE OR REPLACE FUNCTION month_close_failpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failpoint: the COMMIT is refused'; END $$`);
  await owner.query("CREATE CONSTRAINT TRIGGER month_close_failpoint AFTER INSERT ON stamp_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION month_close_failpoint()");
  let res;
  try { res = await apply(t, p.fingerprint); }
  finally { await owner.query("DROP TRIGGER month_close_failpoint ON stamp_lines"); }
  assert.equal(res.status, "reconciliation-required", JSON.stringify(res));
  assert.deepEqual(outcomes(res), [["darko-fund", "reconciliation-required"]]);
  assert.deepEqual(res.not_attempted, ["keeping-ec2", "meeps-fund"], "not retried, and no later pot attempted");
  assert.match(res.pots[0].detail, /Git landed .* and the store's COMMIT then failed/);
  assert.ok(res.pots[0].commit, "the landed commit is named for the reconciler");
  assert.equal(originCount(t), 2, "Git holds the landing");
  assert.equal(git(t.origin, "rev-parse", "main").trim(), res.pots[0].commit);
  assert.equal(await rows(), 13, "the store is BEHIND its export");
  assert.equal(ledgerOf(t).length, 15);
  const v = await verifyStampLinesVia(office, t.dir, { engine: t.engine });
  assert.equal(v.ok, false);
  assert.match(v.problems.join("\n"), /past the store's 13/);
  // the guard against running it again: the preflight refuses a store that is not the export, naming it
  const next = await plan(t);
  assert.equal(next.ok, false);
  assert.ok(next.refusals.some((r) => r.code === "store-unverified"), "no further close is planned over an unreconciled store");
  assert.match(next.refusals.find((r) => r.code === "store-unverified").message, /15 exported/);
  const again = await apply(t, p.fingerprint);
  assert.equal(again.status, "refused", "and the apply refuses before it writes");
});

test("THE LOCK: a lock that is busy or cannot be taken refuses with nothing written; a hold that runs out under a running section is a reconciliation, never a retry", { skip }, async () => {
  const t = await freshTown();
  const p = await plan(t);
  const before = await state(t);
  const busy = await apply(t, p.fingerprint, { lock: async () => { throw Object.assign(new Error(LOCK_BUSY.defect), LOCK_BUSY); } });
  assert.deepEqual([busy.status, busy.refusals.map((x) => x.code)], ["refused", ["lock-not-taken"]]);
  assert.deepEqual(await state(t), before);
  const slow = await apply(t, p.fingerprint, { lock: async () => { throw Object.assign(new Error(LOCK_HELD_TOO_LONG.defect), LOCK_HELD_TOO_LONG); } });
  assert.deepEqual([slow.status, slow.refusals.map((x) => x.code)], ["reconciliation-required", ["lock-hold-ran-out"]]);
  const hold = await apply(t, p.fingerprint, { lock: (fn, o) => withTownLockHeld(({ signal }) => { const ac = new AbortController(); ac.abort(); return fn({ signal: ac.signal }); }, o) });
  assert.deepEqual([hold.status, outcomes(hold)], ["partial", [["darko-fund", "not-landed"]]], "an aborted hold stops before the next write, and says so");
  assert.match(hold.pots[0].detail, /the lock's hold ran out/);
  assert.deepEqual(await state(t), before);
});

test("THE CLI: exit codes say what happened (0 done, 2 usage, 10 refused, 11 partial, 12 reconciliation required), and a real process closes a month end to end", { skip }, async () => {
  const quiet = async (f) => { const log = console.log, err = console.error; console.log = () => {}; console.error = () => {}; try { return await f(); } finally { console.log = log; console.error = err; } };
  const t = await freshTown();
  const env = { ...process.env, TOWN_CLONE: t.dir, STAMP_KEY: t.keyFile };
  const attFile = join(tmp, "cli-att.json"); writeFileSync(attFile, JSON.stringify(ATT));
  const args = (verb, ...more) => [verb, "--month", MONTH, "--date", CLOSE_DATE, "--starforge-file", attFile, ...more];
  assert.equal(await quiet(() => main([], env)), EXIT.usage);
  assert.equal(await quiet(() => main(["plan", "--month", MONTH], env)), EXIT.usage, "a date is required");
  assert.equal(await quiet(() => main(["plan", "--month", MONTH, "--date", CLOSE_DATE, "--bogus"], env)), EXIT.usage);
  assert.equal(await quiet(() => main(["apply", ...args("apply").slice(1)], env)), EXIT.usage, "apply without a fingerprint");
  assert.equal(await quiet(() => main(["plan", "--month", "2026-11", "--date", "2026-11-02"], env)), EXIT.refused, "an unended month");

  // a real process: plan, then apply with its fingerprint
  const node = (a) => spawnSync(process.execPath, [join(ROOT, "tools", "month-close.mjs"), ...a], { cwd: ROOT, env, encoding: "utf8" });
  const planned = node([...args("plan"), "--json"]);
  assert.equal(planned.status, 0, planned.stderr);
  const fingerprint = JSON.parse(planned.stdout).fingerprint;
  assert.match(fingerprint, /^[0-9a-f]{64}$/);
  // partial: a key that cannot sign stops at the first pot (11)
  const badKey = join(tmp, "cli-bad-key.pem"); writeFileSync(badKey, "nope\n");
  const stopped = node([...args("apply", "--fingerprint", fingerprint, "--key", badKey)]);
  assert.equal(stopped.status, EXIT.partial, stopped.stdout + stopped.stderr);
  assert.match(stopped.stdout, /monthly close: PARTIAL/);
  assert.match(stopped.stdout, /A continuation needs a NEW dry run/);
  const done = node([...args("apply", "--fingerprint", fingerprint, "--json")]);
  assert.equal(done.status, 0, done.stdout + done.stderr);
  assert.equal(JSON.parse(done.stdout).status, "completed");
  assert.equal(originCount(t), 4);
  assert.equal(await rows(), 20);
  // 12: the store refuses a COMMIT after Git landed (a fresh town, the trigger again)
  const t2 = await freshTown();
  const p2 = await plan(t2);
  await owner.query(`CREATE OR REPLACE FUNCTION month_close_failpoint() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'failpoint: the COMMIT is refused'; END $$`);
  await owner.query("CREATE CONSTRAINT TRIGGER month_close_failpoint AFTER INSERT ON stamp_lines DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION month_close_failpoint()");
  let code;
  try { code = await quiet(() => main(["apply", "--month", MONTH, "--date", CLOSE_DATE, "--starforge-file", attFile, "--fingerprint", p2.fingerprint, "--key", t2.keyFile, "--clone", t2.dir], env)); }
  finally { await owner.query("DROP TRIGGER month_close_failpoint ON stamp_lines"); }
  assert.equal(code, EXIT.reconciliation);
});

test("the town's own epoch-close keeps its MANUAL header, and this command never edits it", { skip }, () => {
  const text = readFileSync(join(ROOT, "src", "town-pins", "tools", "epoch-close.mjs"), "utf8");
  assert.match(text, /MANUAL by design: not cron, not settlement-riding/);
  assert.equal(existsSync(join(ROOT, "tools", "month-close.mjs")), true);
  assert.match(readFileSync(join(ROOT, "tools", "month-close.mjs"), "utf8"), /MANUAL by design, and operator-only: not an MCP act, not a public endpoint, not a timer/);
});
