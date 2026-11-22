#!/usr/bin/env node
// bluesky-pds-proof.mjs — the real PDS's answer to the record key, without posting (POS-904 correction).
//
//   node tools/bluesky-pds-proof.mjs --world <world clone> --settlement <n> [--service <url>]
//   node tools/bluesky-pds-proof.mjs --crossing <n>                         [--service <url>]
//
// WHAT IT SHOWS, as the town's account, on the real PDS, with validation left ON:
//   1. the LEGACY key (the event's name, settlement-<n>) is refused by the key schema: 400 InvalidRequest "Invalid record key…"
//   2. the CANDIDATE key (the TID the publisher now derives) passes validation and reaches the compare-and-swap:
//      400 InvalidSwap
//   3. afterwards getRecord reads RecordNotFound for both, and the repo's head commit is the one it was before.
//
// WHY NEITHER CALL CAN CREATE A RECORD (checked in code before either call, and the run STOPS, calling nothing, if any fails):
//   · both createRecord requests carry swapCommit, a VALID CID that is not the repo's head. In bluesky-social/atproto,
//     packages/pds/src/api/com/atproto/repo/createRecord.ts parses swapCommit (parseCid), runs prepareCreate (the lexicon's key
//     schema: InvalidRecordKeyError → 400 InvalidRequest) and only then actor-store/repo/transactor.ts processWrites →
//     formatCommit, whose FIRST check is `swapCommit && !currRoot.cid.equals(swapCommit)` → BadCommitSwapError → 400 InvalidSwap.
//     Nothing is persisted (applyCommit, indexWrites, blobs) before formatCommit returns, so a request whose swapCommit is not
//     the head writes nothing, whatever its key. A swapCommit that EQUALS the head would be an ordinary create: the run
//     reads the head first and refuses to go on if the two are equal, and it never sends `validate: false`.
//   · neither key may already hold a record (getRecord reads RecordNotFound first): a present record is not a proof, and
//     is stopped on.
//   · the head is read again at the end: a head that moved is reported, whatever else happened.
//
// THE CREDENTIAL is the same two env names the publisher reads (BSKY_IDENTIFIER, BSKY_APP_PASSWORD), from the posting
// unit's EnvironmentFile, read here and sent to createSession only. Neither, nor the session token, is ever printed,
// logged, written or placed in an argument; a server's words are printed only as a name and a short prefix of its
// message, and only when they hold none of those secrets.
//
// OUT: one JSON report on stdout. EXIT: 0 every expected answer; 1 an unexpected answer or a head that moved;
// 2 usage; 3 stopped before any createRecord (preflight), nothing was sent that could write.

import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { BSKY_ENV, DEFAULT_SERVICE, POST_COLLECTION, TID_PATTERN, credentialsFrom, eventKeyFor, postRecord, tidFor } from "../src/bluesky-publisher.mjs";
import { instantOf } from "./bluesky-publish.mjs";

const B32 = "abcdefghijklmnopqrstuvwxyz234567";
/** A valid CIDv1 (dag-cbor, sha2-256) that names no block of anyone's repo: the swapCommit that can never match a head. PURE. */
export function neverACommitCid(seed = "postmark POS-904 proof: this names no commit") {
  const bytes = Buffer.concat([Buffer.from([0x01, 0x71, 0x12, 0x20]), createHash("sha256").update(seed).digest()]);
  let bits = 0, acc = 0, out = "";
  for (const b of bytes) { acc = (acc << 8) | b; bits += 8; while (bits >= 5) { out += B32[(acc >>> (bits - 5)) & 31]; bits -= 5; } }
  if (bits) out += B32[(acc << (5 - bits)) & 31];
  return `b${out}`;
}
export const CID_PATTERN = /^b[a-z2-7]{58}$/;                          // CIDv1, base32 lower, 36 bytes (version, codec, hash code, length, 32-byte digest)

const SHOWN_PREFIX = 120;
/** What of a server's answer may be printed: its error name and a short prefix of its message, each only when it holds no secret. PURE. */
export function shown({ error, message }, secrets) {
  const safe = (s, n) => {
    if (typeof s !== "string") return null;
    const low = s.toLowerCase();
    return secrets.some((x) => x && low.includes(String(x).toLowerCase())) ? "(withheld)" : s.slice(0, n);
  };
  return { error: safe(error, 60), message: safe(message, SHOWN_PREFIX) };
}

/** One XRPC call that keeps the status and the JSON body (a thrown fetch is `{ status: null }`). Never logs a header. */
async function call({ fetch, service, timeoutMs }, method, { query = null, body = null, token = null } = {}) {
  const url = new URL(`/xrpc/${method}`, service);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const init = { method: body ? "POST" : "GET", headers: {}, signal: AbortSignal.timeout(timeoutMs) };
  if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  if (token) init.headers.authorization = `Bearer ${token}`;
  try {
    const res = await fetch(url, init);
    let json = null;
    try { json = await res.json(); } catch { /* an empty body */ }
    return { status: res.status, json: json ?? {} };
  } catch { return { status: null, json: {} }; }
}

/**
 * Run the proof. `keys` is `{ legacy, candidate }`. Returns `{ code, report }`; every line of `report` is safe to print.
 */
export async function proveKeyOnPds({ keys, env = process.env, fetch = globalThis.fetch, service = DEFAULT_SERVICE, timeoutMs = 20_000, now = () => new Date() }) {
  const creds = credentialsFrom(env);
  const report = { proof: "POS-904 record key on the real PDS", service, at: now().toISOString(), validation: "on (no `validate` field is ever sent)", keys, steps: {} };
  if (!creds) return { code: 3, report: { ...report, stopped: `${BSKY_ENV.join(" and ")} are not both set: nothing was read or sent` } };
  const wire = { fetch, service, timeoutMs };
  const secrets = [creds.identifier, creds.password];
  const stop = (why) => ({ code: 3, report: { ...report, stopped: why, sent_createRecord: 0 } });

  // PREFLIGHT, none of which can write
  if (TID_PATTERN.test(keys.legacy)) return stop(`the legacy key ${keys.legacy} is already shaped like a TID: it would prove nothing`);
  if (!TID_PATTERN.test(keys.candidate)) return stop("the candidate key is not shaped like a TID");
  const s = await call(wire, "com.atproto.server.createSession", { body: { identifier: creds.identifier, password: creds.password } });
  if (s.status !== 200 || !s.json.did || !s.json.accessJwt) return stop(`no session (HTTP ${s.status ?? "no answer"}): nothing else was called`);
  const { did, accessJwt } = s.json; secrets.push(accessJwt);
  report.account = { did, session: "created" };
  const head = await call(wire, "com.atproto.sync.getLatestCommit", { query: { did } });
  if (head.status !== 200 || !head.json.cid) return stop(`the repo's head commit cannot be read (HTTP ${head.status ?? "no answer"}): without it no swapCommit can be shown to differ`);
  const swap = neverACommitCid();
  if (!CID_PATTERN.test(swap) || swap === head.json.cid) return stop("the swapCommit is not a valid CID that differs from the head: a create could succeed, so none is sent");
  report.head_before = head.json.cid; report.swap_commit = swap;
  const absent = async (rkey) => {
    const r = await call(wire, "com.atproto.repo.getRecord", { query: { repo: did, collection: POST_COLLECTION, rkey } });
    return r.status === 400 && r.json.error === "RecordNotFound" ? true : (r.status === 200 ? false : null);
  };
  for (const [name, rkey] of Object.entries(keys)) {
    const a = await absent(rkey);
    if (a !== true) return stop(`getRecord for the ${name} key ${rkey} did not read RecordNotFound (${a === false ? "a record is there" : "it could not be told"}): not a proof, nothing was sent that could write`);
  }
  report.steps.preflight = { head_read: true, swap_differs_from_head: true, both_keys_absent: true, would_create: false };

  // THE TWO CALLS: each carries the swapCommit that is not the head, and no `validate` field
  const record = postRecord({ text: "POS-904 key proof: this is never written", link: "https://postmark.town/", createdAt: report.at });
  const attempt = async (rkey) => {
    const r = await call(wire, "com.atproto.repo.createRecord", { token: accessJwt, body: { repo: did, collection: POST_COLLECTION, rkey, swapCommit: swap, record } });
    return { status: r.status, ...shown(r.json, secrets), created: r.status === 200 };
  };
  report.sent_createRecord = 0;
  const legacy = await attempt(keys.legacy); report.sent_createRecord += 1;
  report.steps.legacy_key = { ...legacy, expected: "400 InvalidRequest, message begins 'Invalid record key'" };
  if (legacy.created) return { code: 1, report: { ...report, stopped: "UNEXPECTED: the legacy-key createRecord answered 200. The second call is NOT made. See the read-back." , read_back: await readBack(wire, did, keys, absent, head.json.cid) } };
  const candidate = await attempt(keys.candidate); report.sent_createRecord += 1;
  report.steps.candidate_key = { ...candidate, expected: "400 InvalidSwap (validation passed, the compare-and-swap refused)" };

  report.read_back = await readBack(wire, did, keys, absent, head.json.cid);
  const ok = legacy.status === 400 && legacy.error === "InvalidRequest" && /^Invalid record key/.test(legacy.message ?? "")
    && candidate.status === 400 && candidate.error === "InvalidSwap"
    && report.read_back.legacy_absent === true && report.read_back.candidate_absent === true && report.read_back.head_unchanged === true;
  report.verdict = ok ? "AS EXPECTED: the legacy key was refused by validation, the TID reached InvalidSwap, both records are absent, the repo head is unchanged"
    : "NOT AS EXPECTED: read the steps; nothing is claimed";
  return { code: ok ? 0 : 1, report };
}

async function readBack(wire, did, keys, absent, headBefore) {
  const head = await call(wire, "com.atproto.sync.getLatestCommit", { query: { did } });
  return { legacy_absent: await absent(keys.legacy), candidate_absent: await absent(keys.candidate), head_after: head.json.cid ?? null, head_unchanged: head.json.cid === headBefore };
}

export async function main(argv, { env = process.env, fetch = globalThis.fetch, out = (l) => console.log(l) } = {}) {
  const arg = (name) => { const i = argv.indexOf(`--${name}`); return i === -1 ? null : argv[i + 1]; };
  const kind = arg("settlement") != null ? "settlement" : arg("crossing") != null ? "crossing" : null;
  const n = kind ? Number(String(arg(kind)).replace(/^S/, "")) : NaN;
  if (!kind || !Number.isInteger(n) || n < 0 || (kind === "settlement" && !arg("world"))) {
    console.error("usage: bluesky-pds-proof.mjs --world <world clone> --settlement <n> | --crossing <n>  [--service <url>]");
    return 2;
  }
  const at = instantOf(kind, n, arg("world") ? resolve(arg("world")) : null);
  if (!at) { console.error(`no instant for ${kind} ${n}: no key can be derived, nothing was sent`); return 3; }
  const { code, report } = await proveKeyOnPds({ keys: { legacy: eventKeyFor(kind, n), candidate: tidFor(kind, n, at) }, env, fetch, service: arg("service") ?? DEFAULT_SERVICE });
  out(JSON.stringify(report, null, 1));
  return code;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) process.exitCode = await main(process.argv.slice(2));
