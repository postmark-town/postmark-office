// town-pin-doors.test.mjs — a real pin mismatch, driven through every exec door
// that writes the stamp ledger (POS-994; Truey's review of #1065, finding 7).
//
//   node --test test/town-pin-doors.test.mjs
//
// Each door is spawned as the office spawns it, against a clone that holds the
// pinned town files exactly, then has one pinned file changed (a town change the
// office has not reviewed). Every door must answer the named 503
// (`town-pin-mismatch`, the office's own hint, nothing about the box in it) and
// write NOTHING: the clone's HEAD, its working tree and its ledger are as they were.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { PIN_STOP_HINT } from "../src/town-tool.mjs";
import { pinRootNow, pinnedTown } from "./helpers/pinned-town.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
// The doors import the office's own modules (the pen, the store's pool), which need
// the installed packages; without them the door cannot even start, here or anywhere.
const skip = existsSync(join(ROOT, "node_modules")) ? false : "the office's packages are not installed here (npm ci)";
const made = [];
after(() => { for (const d of made) rmSync(d, { recursive: true, force: true }); });

const git = (dir, ...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.invalid", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.invalid" } }).trim();

/** A clone holding exactly the pinned files, a ledger and a pot, committed; then `changed` moved by one line. */
function mismatchedClone(changed) {
  const clone = pinnedTown();
  made.push(clone);
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "# the stamp ledger\n\n- 2026-11-01 · seed row\n");
  writeFileSync(join(clone, "WHITE_PAGES", "pot-roof.json"), JSON.stringify({ pot: "roof", status: "open", epoch_cadence: "crossing", received_usd: 0, beneficiary: "the-town", target_usd_per_epoch: 100 }) + "\n");
  git(clone, "init", "-q", "-b", "main");
  git(clone, "config", "core.autocrlf", "false");
  git(clone, "add", "-A");
  git(clone, "commit", "-qm", "the pinned town");
  appendFileSync(join(clone, changed), "\n// a town change the office has not reviewed\n");
  git(clone, "commit", "-qam", "an unreviewed change");
  const key = join(clone, "..", `${clone.split(/[\\/]/).pop()}-stamp-key.pem`);
  writeFileSync(key, "not a real key: the pin stops the door before it is used\n");
  made.push(key);
  return { clone, key, head: git(clone, "rev-parse", "HEAD"), ledger: readFileSync(join(clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8") };
}

const DOORS = [
  ["fund-exec.mjs", { pot: "roof", usd: 1, from: "a-payer", ref: "r-1", date: "2026-11-16", rail: "usdc" }, "tools/stamp-mint.mjs"],
  ["gift-exec.mjs", { handle: "limen", amount: 1, slug: "a-hat", by: "wright", date: "2026-11-16" }, "tools/stamp-mint.mjs"],
  ["parcel-room-exec.mjs", { handle: "limen", date: "2026-11-16" }, "tools/stamp-mint.mjs"],
  ["pot-stake-exec.mjs", { handle: "limen", pot: "roof", stamps: 1, date: "2026-11-16" }, "tools/stamp-mint.mjs"],
  ["world-stake-exec.mjs", { verb: "stake", handle: "limen", mark: "some-mark", n: 1, date: "2026-11-16" }, "tools/world-stake.mjs"],
];

for (const [exec, payload, changed] of DOORS) {
  test(`${exec}: a clone whose ${changed} is not the pinned copy is a named 503, and nothing is written`, { skip }, () => {
    const t = mismatchedClone(changed);
    const r = spawnSync(process.execPath, [join(ROOT, "src", exec), JSON.stringify(payload)], {
      encoding: "utf8", timeout: 60_000,
      env: { ...process.env, TOWN_PINS_DIR: pinRootNow(), TOWN_CLONE: t.clone, STAMP_KEY: t.key, TOWN_PUSH: "0", TOWN_CLEAN_WAIT_MS: "0", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid" },
    });
    assert.equal(r.status, 0, `the door answers, it does not trip: ${r.stderr.slice(0, 400)}`);
    const out = JSON.parse(r.stdout.trim().split("\n").at(-1));
    const err = out.error ?? out;
    assert.equal(err.code, 503, JSON.stringify(out));
    assert.equal(err.defect, "town-pin-mismatch");
    assert.equal(err.hint, PIN_STOP_HINT, "the office's own words: no path, no blob, in the answer");
    assert.match(r.stderr, new RegExp(`\\[town-tool\\] the town's ${changed.replace(/[./]/g, "\\$&")} is not the copy the office pinned`), "what differs is in the office's log");
    assert.equal(git(t.clone, "rev-parse", "HEAD"), t.head, "no commit");
    assert.equal(git(t.clone, "status", "--porcelain"), "", "nothing written to the working tree");
    assert.equal(readFileSync(join(t.clone, "WHITE_PAGES", "stamp-ledger.md"), "utf8"), t.ledger, "the ledger is as it was");
  });
}
