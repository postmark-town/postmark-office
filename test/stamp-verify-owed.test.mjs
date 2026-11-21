// stamp-verify-owed.test.mjs — the arrival check's exits say whose fault a stop is (POS-994).
//
// tools/stamp-verify-owed.mjs is office-keep's arrival check: the town's verifier,
// the office's pinned copy, with "mints owed" read as not red. Its exit tells the
// tick what happened, and office-keep names each in the receipt:
//   0  green (or behind the mail and nothing else)
//   1  the ledger is red                     → mint refused ledger-red
//   2  the office could not prepare the check → mint refused prep-failed
//   3  a pin stop (the town is not the pins)  → mint refused town-pin-mismatch
// Truey's re-read of #1065 (finding 4): a deploy defect (no pins, pins without the
// public key) had come out as 1 or an uncaught throw, read by the tick as a red ledger.
//
// THE CAN-FAIL FLIP: put back `if (!isPinStop(e)) throw e;` in stamp-verify-owed's
// catch; the "no pins at all" case exits 1 and goes red here.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { pinnedTown, pinRootNow } from "./helpers/pinned-town.mjs";

const OFFICE = join(dirname(fileURLToPath(import.meta.url)), "..");
const OWED_TOOL = join(OFFICE, "tools", "stamp-verify-owed.mjs");
const RUNNER = join(OFFICE, "src", "stamp-verify-pinned.mjs");
const skip = (() => { try { return JSON.parse(readFileSync(join(pinRootNow(), "PINS.json"), "utf8")).files["tools/stamp-pubkey.pem"] ? false : "the pins in force carry no public key"; } catch { return "no pins in force"; } })();

const owedCheck = (town, pins) => spawnSync(process.execPath, [OWED_TOOL, "--repo", town], { encoding: "utf8", env: { ...process.env, TOWN_PINS_DIR: pins } });

test("the arrival check: a pin stop is 3, and a check the office could not prepare is 2, never a red ledger", { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), "stamp-verify-owed-"));
  try {
    const town = pinnedTown(join(base, "town"));
    mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
    // 2: no pins at all (an empty folder, no PINS.json): the loader refuses, not the ledger
    const empty = join(base, "no-pins");
    mkdirSync(empty);
    const none = owedCheck(town, empty);
    assert.equal(none.status, 2, none.stderr);
    assert.match(none.stderr, /\[stamp-verify-owed\] the office could not prepare the town's verifier \(not a ledger verdict\)/);
    // 2: pins that hold no public key: the runner refuses by name, and the 2 passes through
    const keyless = join(base, "keyless");
    cpSync(pinRootNow(), keyless, { recursive: true });
    rmSync(join(keyless, "tools", "stamp-pubkey.pem"));
    const noKey = owedCheck(town, keyless);
    assert.equal(noKey.status, 2, noKey.stderr);
    assert.match(noKey.stderr, /NOT verified: the office's pins carry no public key/);
    // 3: the town's verifier is not the pinned copy
    appendFileSync(join(town, "tools", "stamp-verify.mjs"), "// a town change the office has not reviewed\n");
    const stop = owedCheck(town, pinRootNow());
    assert.equal(stop.status, 3, stop.stderr);
    assert.match(stop.stderr, /tools\/stamp-verify\.mjs is not the copy the office pinned/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});

test("the runner refuses a --pinned folder inside --repo: pinned code is never read from the town it checks", { skip }, () => {
  const base = mkdtempSync(join(tmpdir(), "stamp-verify-pinned-"));
  try {
    const town = pinnedTown(join(base, "town"));
    const r = spawnSync(process.execPath, [RUNNER, "--pinned", join(town, "tools"), "--repo", town], { encoding: "utf8" });
    assert.equal(r.status, 2, r.stdout + r.stderr);
    assert.match(r.stderr, /--pinned .* is inside --repo .*; the pinned verifier is never read from the town it checks/);
    // the same folder from outside the town is not refused for where it is
    const outside = spawnSync(process.execPath, [RUNNER, "--pinned", join(pinRootNow(), "tools"), "--repo", town], { encoding: "utf8" });
    assert.doesNotMatch(outside.stderr, /is inside --repo/);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
