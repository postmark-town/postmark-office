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
//   · a DISCLOSURE in a 200 read ("…could not be read (<reason>) — unknown,
//     not zero"): never the error's text; since POS-657 (RULED A, Darko
//     2026-10-16 20:04 EDT) its reason is fault-words.mjs § plainReason's,
//     and the raw error goes to the log;
//   · an OPERATOR's tool, pass or panel, or what a household's OWN URL
//     answered (G4): the raw text stays, and the line says which;
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
// ANY NAME, so a renamed variable cannot hide (review-602: `worldUnread?.message`
// had slipped past the old list of names). A call (`commit.message(…)`) is not text.
const ERROR_TEXT = /\b\w+\??\.(message|stderr)\b(?!\s*\()/;
const LOGGED = /console\.(error|warn|log|info)\(|\blog\(|log\.(warn|error|info)\(|warnOnce\(|\bwarn\(|\bnote\(/;

const OWN = "the office's own words, a refusal relayed by its own defect, or plumbing that never reaches an answer";
// POS-657 (RULED A, Darko 2026-10-16 20:04 EDT): a 200 read's disclosure keeps its "unknown, not zero"
// promise and says a fixed plain reason (fault-words.mjs § plainReason); the raw error goes to the log.
// What stays is not a resident's read: an operator's tool or panel, or a household's own url's answer.
const OPERATOR = "an operator's tool, pass or panel, never a resident's read";
const OWN_URL = "what a household's own url answered (Wright's G4: like media.mjs, it stays)";
const ALLOWED = {
  "ashore.mjs": [1, `${OWN}: a backfill's why, printed by its tool`],
  "ballots-store.mjs": [5, `${OWN}: LateCrossingError's ruled message (x2), an UNREACHABLE refusal's \`cause\` field (x3, never sent)`],
  "ceremony.mjs": [1, `${OWN}: a log variable`],
  "crossing-exec.mjs": [2, `${OWN}: PenUnreachableError's ruled sentence; the push error a receipt discloses`],
  "declare-exec.mjs": [1, `${OWN}: mintRefusal relays a refusal (an HTTP status) by its own defect; any other error, codeless or foreign, is FAULT_LOGGED above it`],
  "drop-recovery.mjs": [2, `${OPERATOR} (the drop-recovery pass's report)`],
  "dynamic-store.mjs": [1, `${OWN}: a status field`],
  "earpiece.mjs": [1, `${OWN_URL} (what the household's own webhook answered)`],
  "edit.mjs": [1, "a 422 quoting the image decoder on the resident's own upload: KEPT (POS-617), since the decoder's words are about the resident's own bytes and help them fix the file (left with media.mjs's, Wright's G4)"],
  "events-store.mjs": [3, `${OWN}: LateCrossingError's ruled message; a refusal's \`cause\` field, never sent; PenUnreachableError's ruled sentence, as the 503's defect`],
  "events.mjs": [1, `${OWN_URL} (what the household's own echo url answered)`],
  "fault-words.mjs": [5, `${OWN}: errorSaid, the log's reader; causeKind reads an error's text to choose a plain reason and never says it (x2); plainReason hands back an ownWordsError's sentence (the office's own words, POS-657)`],
  "fund-exec.mjs": [1, `${OWN}: classifyFatal's input (its last word is FAULT_LOGGED)`],
  "gangway-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect, else its message (KEPT, POS-617: an integer HTTP code is only ever set by the office, so the message is the office's own sentence)`],
  "gift-exec.mjs": [1, `${OWN}: classifyFatal's input (its last word is FAULT_LOGGED)`],
  "scoop-store.mjs": [2, `${OWN}: LateCrossingError's ruled message; PenUnreachableError's ruled sentence, as the 503's defect`],
  "idea-store.mjs": [2, `${OWN}: LateCrossingError's ruled message; PenUnreachableError's ruled sentence, as the 503's defect`],
  "join-bind-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect, else its message (KEPT, POS-617: an integer HTTP code is only ever set by the office, so the message is the office's own sentence)`],
  "join-bind.mjs": [2, `${OWN}: relay, a refusal (a defect or an HTTP status) in its own words`],
  "leave-exec.mjs": [1, "the push error a receipt discloses (the 409's sketchbook-checkout error is FAULT_LOGGED since POS-617)"],
  "media.mjs": [1, "a 502 quoting the fetch of the resident's own URL (Wright's G4: it stays)"],
  "media-sweep.mjs": [5, `${OPERATOR} (the sweep's and the takedown's reports on the box: a source's or storage's refusal, named for the operator who reads last.json)`],
  "oauth.mjs": [2, `${OWN}: SignInUnreadable's why, and the co-sign's unread berth place (POS-740), both of which go to the log`],
  "paperwork.mjs": [1, `${OWN}: a status field`],
  "read-workers.mjs": [1, `${OWN}: a worker's exit cause, read by the pool`],
  "registry-store.mjs": [1, `${OWN}: a classifier`],
  "release.mjs": [1, `${OPERATOR} (the deploy receipt the auto-deploy probes)`],
  "server.mjs": [3, `${OWN}: the boot refusal (a log), causeSaid (the log's reader), doorTripped's own refusal message (KEPT, POS-617: an integer HTTP code is only ever set by the office, and the 503 classes' messages are ruled sentences)`],
  "settle-join-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect, else its message (KEPT, POS-617: an integer HTTP code is only ever set by the office, so the message is the office's own sentence)`],
  "standing-exec.mjs": [1, `${OWN}: a refusal (an HTTP status) relayed by its own defect, else its message (KEPT, POS-617: an integer HTTP code is only ever set by the office, so the message is the office's own sentence)`],
  "static-keys-retire.mjs": [1, `${OWN}: a tool's own printout`],
  "store-pool.mjs": [2, `${OWN}: classifiers`],
  "store-txn-watch.mjs": [1, `${OWN}: a status row`],
  "store-writedown.mjs": [1, `${OPERATOR} (the write-down pass's report)`],
  "town-bridge.mjs": [4, `${OPERATOR} (the bridge pass's report, the drain worktree's refusal, and the clone's refused fast-forward, POS-723)`],
  "town-drain.mjs": [1, `${OPERATOR} (the drain's stalled rows)`],
  "town-lock.mjs": [2, `${OWN}: plumbing (stderr onto the error; the busy test)`],
  "town-posts.mjs": [1, `${OWN}: a refusal's \`cause\` field, never sent`],
  "usdc-witness.mjs": [2, `${OWN}: the RPC's own error, rethrown inside baseRpc, and the last one onto "all RPCs failed" (Base unreachable answers BASE_BLIND and logs the RPC's words since POS-617)`],
  "walk-exec.mjs": [2, `${OWN}: PenUnreachableError's ruled sentence; the push error a receipt discloses`],
  "snapshot-loads.mjs": [1, `${OWN}: plainRefreshError hands back an ownWordsError's sentence (the office's own words); a store's own text goes to the log only (POS-680, /release is keyless)`],
  "set-down.mjs": [3, `${OPERATOR} (POS-740: a set-down's why, logged by the co-sign and printed by tools/set-down-ashore.mjs; the co-sign's page says only that the place did not record)`],
  "world-apex.mjs": [1, `${OWN}: HouseholdsUnreadable's message (its code is foreign, so it is classified)`],
  "world-branches.mjs": [2, `${OWN}: plumbing; a thrown Error with no code, which the last-resort catch logs`],
  "world-drain.mjs": [1, `${OPERATOR} (the drain's archive report)`],
  "world-filing-order.mjs": [1, `${OWN}: plumbing (git's stderr onto the thrown error, which the settlement's readers plain or log)`],
  "world-graph-snapshot.mjs": [2, `${OWN}: a rows fixture's load error (node --test only) and a tool's answer (worldGraphForTool), neither on a door; a refresh's error is plained (POS-680)`],
  "world-hold.mjs": [1, `${OWN}: PenUnreachableError's ruled sentence`],
  "world-hydrate.mjs": [5, `${OPERATOR} (the hydrate gate's refusals)`],
  "world-lints.mjs": [1, `${OPERATOR} (a lint's report)`],
  "world-movement.mjs": [1, `${OPERATOR} (storedDepartures' absent, for the crossing's save; the resident's disclosure in world.mjs plains it, POS-657)`],
  "world-pool.mjs": [2, `${OWN}: plumbing`],
  "world-refresher.mjs": [1, `${OWN}: plumbing`],
  "world-serve.mjs": [1, `${OWN}: plumbing (the eligibility gate's detail, which only a log line reads; the instrument panel GET /world/store is keyless, so since POS-663 its unread main says plainReason's words and the raw error goes to the log)`],
  "world-stance.mjs": [3, `${OWN}: PenUnreachableError's ruled sentence (x3: the ground's word, the town's, and the owner's word on a thing, POS-688)`],
  "world.mjs": [7, `${OWN}: PenUnreachableError's ruled sentence (x4); and ${OWN_URL} (the media host's answer about a picture's url, x3). A walk's entry refusal moved to arrival-entries.mjs § refusalOf, which relays a refusal by its defect and logs anything else (WLD-5)`],
  "world2-acts.mjs": [1, `${OWN}: a status field`],
  "world2-pen.mjs": [2, `${OWN}: status fields`],
  "write.mjs": [1, `${OPERATOR} (the pen batch's held line: a refused landing's defect, else its first line, onto a held act in the drain's report, POS-723)`],
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
  assert.ok(ERROR_TEXT.test("unavailable: `could not be read (${String(worldUnread?.message ?? worldUnread).slice(0, 120)})`"), "a renamed variable is still counted (review-602)");
  assert.ok(!ERROR_TEXT.test("await land(client, commit.message(result))"), "a method call is not error text");
});
