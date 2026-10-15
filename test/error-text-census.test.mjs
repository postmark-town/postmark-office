// error-text-census.test.mjs — every place src/ turns an error's own text
// (`.message`, `.stderr`) into a string is counted, file by file, and each count
// says why it is allowed (POS-573, POS-578).
//
// POS-568 took the raw error out of the REST doors' 5xx answers; POS-573 and
// POS-578 took it out of the MCP door and out of every module that built its
// own 5xx hint or defect from one (fault-words.mjs § faultLogged: the detail goes
// to the log, the resident reads FAULT_LOGGED). Those sites were found by
// grep, and the next one will be written by someone who did not read either
// issue. So this file is the grep, kept: it counts every line in src/ that
// reads an error's text and is not a log line, and holds each file to the
// count below. A new line fails here until someone decides which kind it is:
//
//   · an ANSWER'S hint or defect (a refusal, a 5xx): never; use faultLogged;
//   · a DISCLOSURE in a 200 read ("…could not be read (<message>) — unknown,
//     not zero"): the read-side contract, left alone by POS-578's ruling (G1)
//     and filed as its own follow-up; a new one belongs on that issue;
//   · the office's OWN words (PenUnreachableError's and LateCrossingError's
//     messages are ruled sentences), a refusal relayed by its own defect, or
//     plumbing that never reaches an answer (a classifier, a status field an
//     operator reads, a log variable).
//
// THE FLIP, per module: put any fixed site back (e.g. gangway-door.mjs's
// `hint: String(e.stderr ?? e.message ?? e)`) and its file's count goes up here.
//
//   node --test test/error-text-census.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");
const ERROR_TEXT = /\b(e|e2|err|error|cause|failure)\??\.(message|stderr)\b/;
const LOGGED = /console\.(error|warn|log|info)\(|\blog\(|log\.(warn|error|info)\(|warnOnce\(|\bwarn\(|\bnote\(/;

const DISCLOSURE = "a 200 read's disclosure of what could not be read (the read-side follow-up, left by POS-578's ruling)";
const OWN = "the office's own words, a refusal relayed by its own defect, or plumbing that never reaches an answer";
const ALLOWED = {
  "ashore.mjs": [1, `${OWN}: a backfill's why, printed by its tool`],
  "ballots-store.mjs": [6, `${OWN}: LateCrossingError's ruled message (x2), an UNREACHABLE refusal's \`cause\` field (x3, never sent); and ${DISCLOSURE} (a ballot file that does not parse)`],
  "ceremony.mjs": [1, `${OWN}: a log variable`],
  "claim-effects.mjs": [2, DISCLOSURE],
  "crossing-exec.mjs": [2, `${OWN}: PenUnreachableError's ruled sentence; the push error a receipt discloses`],
  "declare-exec.mjs": [1, `${OWN}: mintRefusal relays a refusal (an HTTP status) by its own defect; any other error, codeless or foreign, is FAULT_LOGGED above it`],
  "doorstep-bundle.mjs": [6, DISCLOSURE],
  "doorstep-stakes.mjs": [4, DISCLOSURE],
  "drop-recovery.mjs": [2, DISCLOSURE],
  "dynamic-entities.mjs": [1, DISCLOSURE],
  "dynamic-presence.mjs": [1, DISCLOSURE],
  "dynamic-store.mjs": [1, `${OWN}: a status field`],
  "earpiece.mjs": [1, DISCLOSURE],
  "edit.mjs": [1, "a 422 quoting the image decoder on the resident's own upload (left with media.mjs's, Wright's G4)"],
  "enter-exit-ledger.mjs": [1, DISCLOSURE],
  "events-store.mjs": [2, `${OWN}: LateCrossingError's ruled message; a refusal's \`cause\` field, never sent`],
  "events.mjs": [1, DISCLOSURE],
  "fault-words.mjs": [2, `${OWN}: errorSaid, the log's reader`],
  "fund-exec.mjs": [1, `${OWN}: classifyFatal's input (its last word is FAULT_LOGGED)`],
  "funding.mjs": [1, DISCLOSURE],
  "gangway-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect`],
  "gift-exec.mjs": [1, `${OWN}: classifyFatal's input (its last word is FAULT_LOGGED)`],
  "house-bundle.mjs": [2, DISCLOSURE],
  "household-media.mjs": [3, DISCLOSURE],
  "idea-store.mjs": [1, `${OWN}: LateCrossingError's ruled message`],
  "intake-map.mjs": [1, DISCLOSURE],
  "join-bind-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect`],
  "join-bind.mjs": [2, `${OWN}: relay, a refusal (a defect or an HTTP status) in its own words`],
  "law-snapshot.mjs": [1, `${OWN}: a status field`],
  "leave-exec.mjs": [2, "a 409 quoting the sketchbook checkout's error (named in POS-573/578's PR, not folded); the push error a receipt discloses"],
  "media.mjs": [1, "a 502 quoting the fetch of the resident's own URL (Wright's G4: it stays)"],
  "mists-forecast.mjs": [4, DISCLOSURE],
  "oauth.mjs": [1, `${OWN}: SignInUnreadable's why, which goes to the log`],
  "paperwork.mjs": [1, `${OWN}: a status field`],
  "read-workers.mjs": [1, `${OWN}: a worker's exit cause, read by the pool`],
  "registry-store.mjs": [1, `${OWN}: a classifier`],
  "release.mjs": [1, DISCLOSURE],
  "server.mjs": [4, `${OWN}: the boot refusal (a log), a log variable, causeSaid (the log's reader), doorTripped's own refusal message`],
  "settle-join-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect`],
  "stamps-preview.mjs": [1, DISCLOSURE],
  "standing-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect`],
  "static-keys-retire.mjs": [1, `${OWN}: a tool's own printout`],
  "store-pool.mjs": [2, `${OWN}: classifiers`],
  "store-txn-watch.mjs": [1, `${OWN}: a status row`],
  "store-writedown.mjs": [1, DISCLOSURE],
  "town-bridge.mjs": [2, DISCLOSURE],
  "town-drain.mjs": [1, DISCLOSURE],
  "town-lock.mjs": [2, `${OWN}: plumbing (stderr onto the error; the busy test)`],
  "town-marks.mjs": [5, DISCLOSURE],
  "town-posts.mjs": [1, `${OWN}: a refusal's \`cause\` field, never sent`],
  "unread-store.mjs": [1, DISCLOSURE],
  "usdc-witness.mjs": [3, `${OWN}: the RPC's own error, rethrown; and ${DISCLOSURE} (Base unreachable, named in the PR)`],
  "walk-exec.mjs": [2, `${OWN}: PenUnreachableError's ruled sentence; the push error a receipt discloses`],
  "world-apex.mjs": [5, `${OWN}: HouseholdsUnreadable's message (its code is foreign, so it is classified); and ${DISCLOSURE}`],
  "world-branches.mjs": [2, `${OWN}: plumbing; a thrown Error with no code, which the last-resort catch logs`],
  "world-classes.mjs": [6, DISCLOSURE],
  "world-crossings.mjs": [5, DISCLOSURE],
  "world-drain.mjs": [1, DISCLOSURE],
  "world-forecast.mjs": [1, DISCLOSURE],
  "world-graph-snapshot.mjs": [4, `${OWN}: status fields; and ${DISCLOSURE}`],
  "world-hold.mjs": [5, `${OWN}: PenUnreachableError's ruled sentence; and ${DISCLOSURE} (the amend's why relays a refusal's defect)`],
  "world-hydrate.mjs": [5, DISCLOSURE],
  "world-lints.mjs": [1, DISCLOSURE],
  "world-movement.mjs": [4, DISCLOSURE],
  "world-pool.mjs": [2, `${OWN}: plumbing`],
  "world-refresher.mjs": [1, `${OWN}: plumbing`],
  "world-serve.mjs": [2, DISCLOSURE],
  "world-settlement.mjs": [4, DISCLOSURE],
  "world-stance.mjs": [6, `${OWN}: PenUnreachableError's ruled sentence (x3); and ${DISCLOSURE}`],
  "world-units.mjs": [3, DISCLOSURE],
  "world.mjs": [12, `${OWN}: PenUnreachableError's ruled sentence (x4); and ${DISCLOSURE}. A walk's entry refusal moved to arrival-entries.mjs § refusalOf, which relays a refusal by its defect and logs anything else (WLD-5)`],
  "world2-acts.mjs": [2, `${OWN}: a status field; and ${DISCLOSURE}`],
  "world2-fold.mjs": [1, DISCLOSURE],
  "world2-guards.mjs": [1, DISCLOSURE],
  "world2-pen.mjs": [2, `${OWN}: status fields`],
  "world2-serve.mjs": [4, DISCLOSURE],
};

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : p.endsWith(".mjs") ? [p] : [];
});
const census = {};
for (const f of walk(SRC)) {
  readFileSync(f, "utf8").split("\n").forEach((line, i) => {
    if (!ERROR_TEXT.test(line) || LOGGED.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
    (census[relative(SRC, f).replaceAll("\\", "/")] ??= []).push(`${i + 1}: ${line.trim().slice(0, 160)}`);
  });
}

test("every line in src/ that reads an error's text is counted, and its file says why", () => {
  const off = [];
  for (const file of new Set([...Object.keys(census), ...Object.keys(ALLOWED)])) {
    const seen = census[file] ?? [];
    const [allowed = 0, why = "nothing: this file reads no error text"] = ALLOWED[file] ?? [];
    if (seen.length !== allowed) off.push(`${file}: ${seen.length} lines, ${allowed} allowed (${why})\n      ${seen.join("\n      ")}`);
  }
  assert.equal(off.length, 0, `an error's text is read where the census does not expect it. If it is an answer's hint or defect, use fault-words.mjs § faultLogged; if it is a disclosure or the office's own words, count it below with why.\n  ${off.join("\n  ")}`);
});

test("the census counts what it claims to (a positive control)", () => {
  const sample = ["throw bounce(500, \"x\", String(e.stderr ?? e.message ?? e).slice(0, 300));", "console.error(`[office] ${e.message}`);"];
  assert.equal(sample.filter((l) => ERROR_TEXT.test(l) && !LOGGED.test(l)).length, 1, "an answer's hint counts; a log line does not");
});
