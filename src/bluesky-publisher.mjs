// bluesky-publisher.mjs — THE TOWN'S DAY ON BLUESKY (POS-904 Part 1).
//
// Darko, 2026-11-05: "We already have a Blue Sky account for postmark.town, and
// yeah, we should definitely post these things." After each crossing, Ferry's
// Daily headline and its link; after each BLESSED settlement, a short summary of
// what it changed and its replay link. One publisher path serves both.
//
// ── THE RUNTIME CONTRACT (Jetto 2026-11-19 03:55Z; Wright 03:56Z "it stands") ──
//
//   · The credential is two env names and nothing else: BSKY_IDENTIFIER and
//     BSKY_APP_PASSWORD, which the posting unit's EnvironmentFile supplies. They
//     are read here, sent to createSession, and never logged, written to a state
//     file or a receipt. Nor is the session's token or any Authorization header.
//   · com.atproto.server.createSession, then com.atproto.repo.createRecord of an
//     ordinary app.bsky.feed.post at a DETERMINISTIC rkey. The post's key type is
//     `tid`, and the PDS runs the lexicon's key schema before anything else (the
//     first real send, S187 at 2026-11-22 20:06Z, was refused twice for the
//     `settlement-<n>` key this file first used), so the key is a TID derived from
//     the event's own immutable instant (§ tidFor). The PDS refuses a second
//     record at a key that exists, so a key is an event, never a guess. The
//     event's NAME, crossing-<n> / settlement-<n> (§ eventKeyFor), still names its
//     state file and lock: the state directory keeps every event it ever recorded.
//   · A send whose answer is ambiguous (a timeout, a dropped connection, a 5xx, or
//     any refusal after the request went out) is reconciled with
//     com.atproto.repo.getRecord at that same key: a record there means delivered.
//   · At most two sends per event ("retried once"), then it is logged, failed.
//
// ── THE ONE RULE THAT KEEPS A POST SINGLE ───────────────────────────────────
//
// createRecord is sent only when nothing was ever sent for the event, or when
// getRecord has just CONFIRMED the key empty. The state is written "sending"
// BEFORE each send, so a process killed mid-send leaves an event the next run
// reconciles first. A getRecord that cannot answer creates nothing; the event
// waits for the next run, which asks again, and costs no send. A record that
// already stands at the key is never overwritten, whatever its text.
//
// ── DURABLE, AND ONE AT A TIME ──────────────────────────────────────────────
//
// One JSON file per event (<state>/<event name>.json, § eventKeyFor), written whole to a temporary
// name and renamed, so a reader never sees half of it. It carries the event, the
// payload as first composed (a retry sends the same words), every attempt with
// its outcome, and the posted record's uri. One lock per event (lockEvent): a
// second invocation for the same event, a repeated hook or a concurrent one,
// finds it held and leaves; a lock whose pid is gone is stale, and a later
// number is taken over it without ever moving or removing the old one.

import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join } from "node:path";

export const BSKY_ENV = Object.freeze(["BSKY_IDENTIFIER", "BSKY_APP_PASSWORD"]);
export const DEFAULT_SERVICE = "https://bsky.social";
export const POST_COLLECTION = "app.bsky.feed.post";
export const MAX_SENDS = 2;                 // the first, and the one retry
export const REQUEST_TIMEOUT_MS = 20_000;
export const POST_MAX_GRAPHEMES = 300;      // app.bsky.feed.post's own limit

/** The event's name, which names its state file and lock: crossing-<n> or settlement-<n>. NOT the record's key (§ tidFor). */
export function eventKeyFor(kind, n) {
  if (kind !== "crossing" && kind !== "settlement") throw new Error(`no such event kind: ${kind}`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`a ${kind} number is a whole number, not ${n}`);
  return `${kind}-${n}`;
}

// ── THE RECORD KEY: A TID DERIVED FROM THE EVENT'S OWN INSTANT ───────────────
//
// A TID (atproto's key type for app.bsky.feed.post) is 13 characters of
// base32-sortable, `234567abcdefghijklmnopqrstuvwxyz`, over 64 bits: one zero
// bit, 53 bits of microseconds since the Unix epoch, 10 bits of clock id. A
// client normally takes the wall clock and a random clock id: a fresh key every
// run. Here both belong to the event: the TIME is the event's own immutable
// instant, never the moment of publication or the run's clock (its milliseconds,
// then the event's number mod 1000 in the microseconds, so two events of a kind
// that share a second still have two keys, in their own order), and the CLOCK ID
// is fixed per kind. One event therefore has one key, however many times and at
// whatever hour it is run. Two kinds never alias (their clock ids differ); two
// events of one kind alias only if they share an instant to the millisecond AND
// their numbers differ by a multiple of 1000, and publishEvent holds such an
// event rather than guess.
//   crossing    the crossing's own sailing instant, 00:00Z or 12:00Z (crossings.mjs § crossingSailsAt)
//   settlement  the COMMITTER time of the commit the blessed tag settlement/S<n> peels to
//               (a tag never moves, and a commit's time never changes)
// An event whose source cannot give its instant has none: the caller holds it.
export const TID_ALPHABET = "234567abcdefghijklmnopqrstuvwxyz";
export const TID_CLOCK = Object.freeze({ crossing: 1n, settlement: 2n });
export const TID_PATTERN = /^[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}$/;   // the lexicon's own `tid` shape

/** The event's instant as epoch milliseconds, from an ISO string or a number; throws when it is not a real instant. PURE. */
export function instantMs(at) {
  const ms = typeof at === "number" ? at : Date.parse(String(at ?? ""));
  if (!Number.isSafeInteger(ms) || ms < 0) throw new Error(`an event instant is a real time, not ${JSON.stringify(at)}`);
  return ms;
}

/** The deterministic record key for event `n` of `kind`, whose own instant is `at`. PURE. */
export function tidFor(kind, n, at) {
  const clock = TID_CLOCK[kind];
  if (clock === undefined) throw new Error(`no such event kind: ${kind}`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`a ${kind} number is a whole number, not ${n}`);
  const v = ((BigInt(instantMs(at)) * 1000n + BigInt(n % 1000)) << 10n) | clock;
  let out = "";
  for (let shift = 60n; shift >= 0n; shift -= 5n) out += TID_ALPHABET[Number((v >> shift) & 31n)];
  return out;
}

/** The two env names, or null when either is missing. Nothing else in `env` is read. */
export function credentialsFrom(env = process.env) {
  const identifier = String(env.BSKY_IDENTIFIER ?? "").trim();
  const password = String(env.BSKY_APP_PASSWORD ?? "");
  return identifier && password ? { identifier, password } : null;
}

// ── the post ─────────────────────────────────────────────────────────────────

const graphemes = (s) => [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(s)].length;
const bytes = (s) => Buffer.byteLength(s, "utf8");

/** Markdown and HTML out of a line of town text: links keep their words, emphasis and tags go, whitespace is one space. PURE. */
export function plainLine(s) {
  return String(s ?? "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * An app.bsky.feed.post: `text`, then the link on its own line, the link made a
 * link by a facet (byte offsets, as the lexicon counts them). The text is cut to
 * fit the post's 300 graphemes with the link whole. PURE.
 */
export function postRecord({ text, link, createdAt }) {
  const body = plainLine(text);
  const room = POST_MAX_GRAPHEMES - graphemes(link) - 1;
  let head = body;
  if (graphemes(head) > room) {
    const parts = [...new Intl.Segmenter("en", { granularity: "grapheme" }).segment(head)].map((x) => x.segment);
    head = parts.slice(0, Math.max(0, room - 1)).join("").trimEnd() + "…";
  }
  const full = `${head}\n${link}`;
  const byteStart = bytes(`${head}\n`);
  return {
    $type: POST_COLLECTION,
    text: full,
    createdAt,
    langs: ["en"],
    facets: [{ index: { byteStart, byteEnd: byteStart + bytes(link) }, features: [{ $type: "app.bsky.richtext.facet#link", uri: link }] }],
  };
}

// ── the two events ───────────────────────────────────────────────────────────

export const DAILY_LINK = "https://postmark.town/daily/";
export const replayLink = (n) => `https://postmark.town/replay/#S${n}`;

/**
 * THE CROSSING'S POST, from one committed version of Ferry's Daily. The Daily is
 * curated by Ferry after the boat (hours after, not at the ferry's completion)
 * and names its crossing in its first line ("*Crossing **320** · …"); its
 * headline is the lead `##` (tools/site-sentinel.mjs § dailyFingerprint, the
 * producer the sentinel holds the served page to). A Daily is the town's
 * completion record for a crossing: a crossing that failed, or whose Daily is
 * not yet curated, has none, so there is no post. No age is judged here: which
 * crossings are owed is the caller's (tools/bluesky-publish.mjs).
 * Returns `{ event }` or `{ skip, n? }`, the reason. PURE.
 */
export function crossingEvent({ markdown, headline }) {
  const n = Number(/Crossing\s+\**\s*(\d+)/.exec(String(markdown ?? ""))?.[1]);
  if (!Number.isInteger(n)) return { skip: "the Daily names no crossing" };
  if (!headline) return { n, skip: `the Daily for crossing ${n} has no lead headline yet` };
  return { event: { kind: "crossing", n, text: `Crossing ${n} · Ferry's Daily: ${plainLine(headline)}`, link: DAILY_LINK } };
}

/**
 * WHAT A BLESSED SETTLEMENT CHANGED: the literal record counts between the two
 * blessed tags (Wright, 2026-11-19 04:14:32Z, option C), read from the World's
 * own record at each tag, never written by hand and never the receipt's channel
 * totals:
 *   new marks published       WORLD/settlement-publications.json's `published`
 *                             keys at S<n> and not at the previous blessed tag
 *   household records added   WORLD/households.json's `households` keys at S<n>
 *                             and not at the previous blessed tag
 * No mark taxonomy and no retirements (Part 1). A rename can add a household
 * record, so this count is never called "joined". A record that cannot be read
 * makes its count null, never zero. PURE.
 */
export function settlementChanges({ before, after }) {
  const added = (b, a) => (b && a ? Object.keys(a).filter((k) => !Object.hasOwn(b, k)).length : null);
  return { marks: added(before?.published, after?.published), households: added(before?.households, after?.households) };
}

/**
 * THE SETTLEMENT'S POST: its number, the two counts under their own words, and
 * its replay link (the site's /replay/ gives every blessed settlement its own
 * anchor, `#S<n>`). A count that cannot be read holds the event (`{ held }`):
 * no post, never a guessed zero, and it is still owed. PURE.
 */
export function settlementEvent({ n, changes }) {
  if (changes?.marks == null || changes?.households == null)
    return { n, held: `settlement S${n}'s counts cannot be read whole from its blessed record: no post, never a guessed count` };
  return { event: { kind: "settlement", n,
    text: `Settlement S${n} is blessed. New marks published: ${changes.marks} · household records added: ${changes.households}.`, link: replayLink(n) } };
}

// ── the wire ─────────────────────────────────────────────────────────────────

// WHAT A REFUSAL MAY SAY (the review of #1148 at 8327313b). Nothing the server
// writes as free text is ever kept: a PDS (or anything in its place) could echo
// the identifier, the password or the token back in its `message`, and whatever
// this file keeps reaches the state file and the receipt. So a refusal is
// composed only of the method, the HTTP status, the server's error NAME when it
// is one of the few names below, and a fixed phrase of this file's own. A name
// that is anything else is "(unnamed)": a shape test is not enough (the review
// at 054812e7: an app password `abcd-efgh-ijkl-mnop` echoed back as
// `abcdefghijklmnop` is a plain identifier, and holds no secret verbatim).
export const XRPC_ERROR_NAMES = Object.freeze(new Set([
  "AuthenticationRequired", "ExpiredToken", "InvalidToken", "AccountTakedown", "RateLimitExceeded",
  "InvalidRequest", "InvalidSwap", "RecordNotFound", "MethodNotImplemented",
  "InternalServerError", "UpstreamFailure", "UpstreamTimeout", "NotEnoughResources",
]));
// what a failed fetch may say of its cause: the network's own codes
export const CAUSE_NAMES = Object.freeze(new Set([
  "ECONNREFUSED", "ECONNRESET", "ENOTFOUND", "EAI_AGAIN", "ETIMEDOUT", "EHOSTUNREACH", "ENETUNREACH", "EPIPE",
  "UND_ERR_SOCKET", "UND_ERR_CONNECT_TIMEOUT", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "AbortError",
]));
/** `name` when it is in `known` and holds, or is held in, none of `secrets`; else null. PURE. */
export function knownName(name, known, secrets = []) {
  if (typeof name !== "string" || !known.has(name)) return null;
  const low = name.toLowerCase();
  return secrets.some((x) => x && (low.includes(String(x).toLowerCase()) || String(x).toLowerCase().includes(low))) ? null : name;
}

class XrpcError extends Error {
  constructor(method, { status = null, error = null, why = null, ambiguous }) {
    super(`${method}: ${status ? `HTTP ${status}` : "no answer"}${error ? ` ${error}` : ""}${why ? ` (${why})` : ""}`);
    Object.assign(this, { method, status, error, ambiguous });
  }
}

/**
 * One XRPC call. A thrown fetch (timeout, refused, reset) and a 5xx are
 * AMBIGUOUS: the request may have been acted on. A 4xx is a definite answer.
 * A refusal carries the method, the status and the server's error name when it
 * is a known one (knownName, against `wire.secrets`), never its message, a
 * header or a body.
 */
async function xrpc({ fetch, service, timeoutMs, secrets = [] }, method, { query = null, body = null, token = null } = {}) {
  const url = new URL(`/xrpc/${method}`, service);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const init = { method: body ? "POST" : "GET", headers: {}, signal: AbortSignal.timeout(timeoutMs) };
  if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  if (token) init.headers.authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(url, init); }
  catch (e) {
    const why = e?.name === "TimeoutError" ? "timed out" : (knownName(e?.cause?.code, CAUSE_NAMES, secrets) ?? knownName(e?.name, CAUSE_NAMES, secrets) ?? "the connection failed");
    throw new XrpcError(method, { why, ambiguous: true });
  }
  let json = null;
  try { json = await res.json(); } catch { /* an empty or broken body */ }
  if (res.ok) return json ?? {};
  throw new XrpcError(method, { status: res.status, error: knownName(json?.error, XRPC_ERROR_NAMES, secrets) ?? (json?.error == null ? null : "(unnamed)"), ambiguous: res.status >= 500 });
}

/** A session: the account's did and its access token, held in memory only. */
export async function createSession(wire, { identifier, password }) {
  const s = await xrpc(wire, "com.atproto.server.createSession", { body: { identifier, password } });
  if (!s?.did || !s?.accessJwt) throw new XrpcError("com.atproto.server.createSession", { why: "the answer named no did or token", ambiguous: false });
  return { did: s.did, accessJwt: s.accessJwt };
}

/** What stands at the key: `{ found: true, uri, cid, value }`, `{ found: false }`, or `{ found: null }` when it cannot be told. */
export async function recordAt(wire, { did, rkey }) {
  try {
    const r = await xrpc(wire, "com.atproto.repo.getRecord", { query: { repo: did, collection: POST_COLLECTION, rkey } });
    return { found: true, uri: r.uri ?? null, cid: r.cid ?? null, value: r.value ?? null };
  } catch (e) {
    if (e.status === 400 && e.error === "RecordNotFound") return { found: false };
    return { found: null, why: e.message };
  }
}

// ── the state ────────────────────────────────────────────────────────────────

const statePath = (dir, rkey) => join(dir, `${rkey}.json`);
export function readState(dir, rkey) {
  try { return JSON.parse(readFileSync(statePath(dir, rkey), "utf8")); } catch { return null; }
}
/** Every event of `kind` with a state file in `dir`, oldest first: `{ n, state }`, state null when the file cannot be read. */
export function recordedEvents(dir, kind) {
  let names;
  try { names = readdirSync(dir); } catch { return []; }
  return names.flatMap((f) => {
    const m = /^(crossing|settlement)-(\d+)\.json$/.exec(f);
    return m && m[1] === kind ? [{ n: Number(m[2]), state: readState(dir, `${kind}-${m[2]}`) }] : [];
  }).sort((a, b) => a.n - b.n);
}
function writeState(dir, state) {
  mkdirSync(dir, { recursive: true });
  const file = statePath(dir, eventKeyFor(state.event.kind, state.event.n));   // the event's name, never its record key
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1) + "\n");
  renameSync(tmp, file);
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/**
 * THE EVENT'S LOCK, or null when a live process holds it.
 *
 * The review at 054812e7: a contender that saw a dead holder removed the lock
 * file by name, and so could remove a FRESH holder's lock that replaced it,
 * after which both sent. So no contender ever moves or removes a lock it does not
 * hold. Locks are numbered, `<rkey>.lock.<k>`, and the highest number present is
 * the lock.
 *   · A holder releases by ADDING `free.<k>` beside its `lock.<k>`. The claim
 *     name `lock.<k>` is never renamed or removed while it is the highest (the
 *     review at 27a96fd4: a release that vacated it let a contender that had
 *     read an older top link into it afterwards, and the next holder then cleared
 *     that live lock as "below").
 *   · To take the event, a contender reads the highest number k. A live holder
 *     there means busy. A `free.<k>`, a dead pid, or no number at all means it
 *     tries to CREATE `lock.<k+1>`: written whole under a private name and
 *     hard-linked into place, which the filesystem lets exactly one contender do
 *     and never shows half-written.
 *   · A contender that created `lock.<k+1>` then looks again. Unless its number
 *     is the highest and not freed, the number it took was already superseded
 *     (cleared below a later holder), and it removes its own file and leaves.
 *   · The holder then clears the numbers below its own (their `lock` and `free`
 *     both). They are never the live lock: the highest number is always kept, so
 *     a stale link into a cleared lower number always finds it and backs out.
 * A stale observation can only fail to create a number that exists, or create
 * one already superseded, so it can never displace a holder, even for a moment.
 * `pause(point)` is a test seam ("takeover", "locked") where the falsifier holds
 * a process to force the interleaving.
 */
export function lockEvent(dir, rkey, { pid = process.pid, pause = () => {} } = {}) {
  mkdirSync(dir, { recursive: true });
  // every number present, highest first: { k, free (its free.<k> is there), names }
  const numbered = () => {
    const by = new Map();
    for (const f of readdirSync(dir)) {
      const m = f.startsWith(`${rkey}.`) && /^(lock|free)\.(\d+)$/.exec(f.slice(rkey.length + 1));
      if (!m) continue;
      const g = by.get(Number(m[2])) ?? { k: Number(m[2]), free: false, names: [] };
      if (m[1] === "free") g.free = true;
      g.names.push(f);
      by.set(g.k, g);
    }
    return [...by.values()].sort((a, b) => b.k - a.k);
  };
  for (let i = 0; i < 3; i++) {
    const [top] = numbered();
    if (top && !top.free) {
      let holder = NaN;
      try { holder = Number(readFileSync(join(dir, `${rkey}.lock.${top.k}`), "utf8").trim()); } catch { continue; /* cleared under a later holder: look again */ }
      if (alive(holder)) return null;
    }
    const k = (top?.k ?? 0) + 1;
    const mine = join(dir, `${rkey}.lock.${k}`);
    pause("takeover");
    const making = join(dir, `${rkey}.${pid}.${randomUUID()}.making`);
    writeFileSync(making, String(pid));
    try { linkSync(making, mine); }
    catch (e) { if (e.code !== "EEXIST") throw e; continue; }   // another took k: look again
    finally { rmSync(making, { force: true }); }
    const [now] = numbered();
    if (now?.k !== k || now.free) { rmSync(mine, { force: true }); continue; }
    for (const g of numbered()) if (g.k < k) for (const f of g.names) rmSync(join(dir, f), { force: true });
    pause("locked");
    // the claim name stays; release only marks it free, so no stale link can ever enter lock.<k> again
    return { release: () => { try { writeFileSync(join(dir, `${rkey}.free.${k}`), String(pid)); } catch { /* the state directory is gone */ } } };
  }
  return null;
}

// ── the publisher ────────────────────────────────────────────────────────────

/**
 * Publish one event, at most once, at most MAX_SENDS sends over each arming of its life.
 * `event` is `{ kind, n, text, link, at }`: `at` is the event's own immutable instant (§ tidFor),
 * bound into the state the first time the event is seen. Returns the receipt: `{ event, rkey,
 * outcome, sends, uri?, detail?, rearmed? }`, where `rkey` is the record's TID and outcome is one of
 *   posted      this run's createRecord succeeded
 *   reconciled  a send's answer was lost or refused, and getRecord found the record
 *   already     the state already says posted (no network)
 *   busy        another invocation holds this event's lock
 *   waiting     no session, or getRecord could not tell whether an earlier send landed: nothing sent, no send spent
 *   failed      both sends are spent and the key is empty: logged, never sent again (until an operator re-arms it)
 * (A first send refused outright, its key confirmed empty, is retried once in the same run.)
 *   unconfigured  no BSKY_IDENTIFIER / BSKY_APP_PASSWORD: nothing read, nothing sent
 *   held        nothing sent: the event's state file is there but cannot be read (a lost history never
 *               becomes a fresh event with two new sends), the event has no instant, or another event
 *               of its kind already holds its key
 *   not-rearmed an operator's re-arm was asked and there was nothing failed to re-arm
 * RE-ARMING (`rearm: { reason }`, the operator's explicit act on ONE named failed event, never a scheduled run's):
 * a failed event gets a fresh budget of MAX_SENDS under its current key, its history kept (the attempts, and
 * a `rearms` entry with the reason, when, the spent sends and the key it failed under), and the first thing
 * the next send does is ask getRecord: a record already standing there is reconciled, never posted twice.
 * The failed file is never deleted. Nothing in the receipt or the state names the credential or the token.
 */
export async function publishEvent(event, { stateDir, env = process.env, fetch = globalThis.fetch, service = DEFAULT_SERVICE, now = () => new Date(), timeoutMs = REQUEST_TIMEOUT_MS, pause, rearm = null } = {}) {
  const key = eventKeyFor(event.kind, event.n);
  const held = readState(stateDir, key);
  // the event's instant is bound the first time it is seen (the state's own wins over a later reading)
  let rkey = null, noInstant = null, rearmed = null;
  try { rkey = tidFor(event.kind, event.n, held?.event?.at ?? event.at); } catch { noInstant = `the ${event.kind} has no real instant of its own`; }
  const receipt = (outcome, state, detail, extra = {}) => ({ event: `${event.kind} ${event.n}`, rkey: rkey ?? state?.rkey ?? null, outcome, sends: state?.sends ?? 0,
    ...(state?.uri ? { uri: state.uri } : {}), ...(detail ? { detail } : {}), ...(rearmed ? { rearmed } : {}), ...extra });
  const unreadable = () => receipt("held", null, `${key}.json is there but cannot be read: nothing sent until it is mended`);

  if (!held && existsSync(statePath(stateDir, key))) return unreadable();
  if (held?.status === "posted") return receipt("already", held);
  if (rearm && held?.status !== "failed") return receipt("not-rearmed", held, held ? `${key} is ${held.status}, not failed: nothing to re-arm` : `${key} has no state: nothing to re-arm`);
  if (!rearm && held?.status === "failed") return receipt("failed", held, "both sends were spent earlier; never sent again until an operator re-arms it");
  if (noInstant) return receipt("held", held, `${noInstant}: no key can be derived, nothing sent`);
  const creds = credentialsFrom(env);
  if (!creds) return receipt("unconfigured", held, `${BSKY_ENV.join(" and ")} are not both set: nothing was read or sent`);

  const lock = lockEvent(stateDir, key, { pause });
  if (!lock) return receipt("busy", held, "another invocation holds this event");
  try {
    const at = () => now().toISOString();
    // read again under the lock: the history is whatever the last holder left
    const kept = readState(stateDir, key);
    if (!kept && existsSync(statePath(stateDir, key))) return unreadable();
    // no two events of a kind may share a key: the one that is not already recorded is the one held
    const twin = recordedEvents(stateDir, event.kind).find((e) => e.n !== event.n && e.state?.rkey === rkey);
    if (twin) return receipt("held", kept, `${event.kind} ${twin.n} already holds this key (the two events share an instant to the millisecond and their numbers differ by a multiple of 1000): nothing sent, no key is guessed`);
    // the payload is bound the first time the event is seen: a retry sends the same words
    const state = kept ?? {
      v: 1, event: { kind: event.kind, n: event.n, at: new Date(instantMs(event.at)).toISOString() }, rkey, status: "pending", sends: 0, attempts: [],
      payload: { text: event.text, link: event.link, created_at: at() },
    };
    const note = (step, outcome, detail = null) => { state.attempts.push({ at: at(), step, outcome, ...(detail ? { detail } : {}) }); writeState(stateDir, state); };
    // a state written before the key was a TID (its key was the event's name, which no PDS accepts) takes the TID now
    state.event.at ??= new Date(instantMs(event.at)).toISOString();
    if (state.rkey !== rkey) {
      state.legacy_rkey = state.rkey;
      state.rkey = rkey;
      if (kept) note("rekey", "tid", `the record key is now the TID derived from the event's instant (it was ${state.legacy_rkey})`);
    }
    if (rearm) {
      if (state.status !== "failed") return receipt("not-rearmed", state, `${key} is ${state.status}, not failed: nothing to re-arm`);
      rearmed = { at: at(), reason: String(rearm.reason ?? ""), prior_sends: state.sends, prior_key: state.legacy_rkey ?? state.rkey, key: rkey };
      (state.rearms ??= []).push(rearmed);
      Object.assign(state, { status: "pending", sends: 0, ask_first: true });
      note("rearm", "armed", rearmed.reason || null);
    }
    state.payload.digest ??= createHash("sha256").update(`${state.payload.text}\n${state.payload.link}`).digest("hex");
    if (state.status === "posted") return receipt("already", state);
    if (state.status === "failed") return receipt("failed", state, "both sends were spent earlier; never sent again until an operator re-arms it");
    // every secret this run holds, so no refusal's name can carry one (the token joins once it exists)
    const wire = { fetch, service, timeoutMs, secrets: [creds.identifier, creds.password] };

    let session;
    try { session = await createSession(wire, creds); wire.secrets.push(session.accessJwt); }
    catch (e) {
      // said once while it repeats: a credential that stays wrong is one line, not one per tick
      const last = state.attempts.at(-1);
      if (!(last?.step === "session" && last.detail === e.message)) note("session", "refused", e.message);
      return receipt("waiting", state, `no session: ${e.message}; nothing sent`);
    }

    // RECONCILE FIRST: any earlier send (finished or killed mid-flight) is asked about before another is made
    const reconcile = async () => {
      const r = await recordAt(wire, { did: session.did, rkey });
      if (r.found === true) {
        Object.assign(state, { status: "posted", uri: r.uri, cid: r.cid, posted_at: state.posted_at ?? at() });
        note("getRecord", "found", r.value?.text != null && r.value.text !== postRecord({ text: state.payload.text, link: state.payload.link, createdAt: "" }).text ? "a record stands at the key with other words; it is kept, never overwritten" : null);
      } else if (r.found === false) note("getRecord", "absent");
      else note("getRecord", "unknown", r.why);
      return r.found;
    };
    if (state.sends > 0 || state.status === "sending" || state.ask_first) {
      const found = await reconcile();
      if (found !== null) delete state.ask_first;
      if (found === true) return receipt("reconciled", state);
      if (found === null) return receipt("waiting", state, "an earlier send's fate cannot be told yet; nothing sent");
      if (state.sends >= MAX_SENDS) { state.status = "failed"; note("give-up", "failed", `${MAX_SENDS} sends, no record at ${rkey}`); return receipt("failed", state); }
    }

    while (state.sends < MAX_SENDS) {
      state.sends += 1;
      state.status = "sending";
      note("createRecord", "sending");
      const record = postRecord({ text: state.payload.text, link: state.payload.link, createdAt: state.payload.created_at });
      try {
        const r = await xrpc(wire, "com.atproto.repo.createRecord", { token: session.accessJwt, body: { repo: session.did, collection: POST_COLLECTION, rkey, record } });
        Object.assign(state, { status: "posted", uri: r.uri ?? null, cid: r.cid ?? null, posted_at: at() });
        note("createRecord", "created");
        return receipt("posted", state);
      } catch (e) {
        note("createRecord", e.ambiguous ? "ambiguous" : "refused", e.message);
        // whatever the answer, the key is asked before anything else is sent
        const found = await reconcile();
        if (found === true) return receipt("reconciled", state);
        if (found === null) { state.status = "sending"; writeState(stateDir, state); return receipt("waiting", state, `${e.message}; whether it landed cannot be told yet, nothing more sent`); }
        state.status = "pending";
        writeState(stateDir, state);
      }
    }
    state.status = "failed";
    note("give-up", "failed", `${MAX_SENDS} sends, no record at ${rkey}`);
    return receipt("failed", state);
  } finally {
    lock.release();
  }
}
