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
//     ordinary app.bsky.feed.post at a DETERMINISTIC rkey: crossing-<n> for a
//     crossing's Daily, settlement-<n> for a blessed settlement. The PDS refuses a
//     second record at a key that exists, so a key is an event, never a guess.
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
// One JSON file per event (<state>/<rkey>.json), written whole to a temporary
// name and renamed, so a reader never sees half of it. It carries the event, the
// payload as first composed (a retry sends the same words), every attempt with
// its outcome, and the posted record's uri. One lock per event (<rkey>.lock,
// created exclusively, naming its pid): a second invocation for the same event,
// a repeated hook or a concurrent one, finds it held and leaves; a lock whose
// pid is gone is stale and taken over.

import { closeSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync, writeSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export const BSKY_ENV = Object.freeze(["BSKY_IDENTIFIER", "BSKY_APP_PASSWORD"]);
export const DEFAULT_SERVICE = "https://bsky.social";
export const POST_COLLECTION = "app.bsky.feed.post";
export const MAX_SENDS = 2;                 // the first, and the one retry
export const REQUEST_TIMEOUT_MS = 20_000;
export const POST_MAX_GRAPHEMES = 300;      // app.bsky.feed.post's own limit

/** The deterministic record key: crossing-<n> or settlement-<n>. */
export function rkeyFor(kind, n) {
  if (kind !== "crossing" && kind !== "settlement") throw new Error(`no such event kind: ${kind}`);
  if (!Number.isInteger(n) || n < 0) throw new Error(`a ${kind} number is a whole number, not ${n}`);
  return `${kind}-${n}`;
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
 * THE CROSSING'S POST, from Ferry's Daily. The Daily is curated by Ferry after
 * the boat (hours after, not at the ferry's completion) and names its crossing
 * in its first line ("*Crossing **320** · …"); its headline is the lead `##`
 * (tools/site-sentinel.mjs § dailyFingerprint, the producer the sentinel holds
 * the served page to). A Daily is the town's completion record for a crossing:
 * a crossing that failed, or whose Daily is not yet curated, has none, so there
 * is no post. Only the current crossing or the one before it is posted, so a
 * Daily left standing (a missed curation) never posts its old crossing late.
 * Returns `{ event }` or `{ skip }`, the reason. PURE.
 */
export function crossingEvent({ markdown, headline, current }) {
  const n = Number(/Crossing\s+\**\s*(\d+)/.exec(String(markdown ?? ""))?.[1]);
  if (!Number.isInteger(n)) return { skip: "the Daily names no crossing" };
  if (!headline) return { skip: `the Daily for crossing ${n} has no lead headline yet` };
  if (n > current || n < current - 1) return { skip: `the Daily names crossing ${n}, not the current crossing (${current}) or the one before: a Daily not yet curated for this boat, posted never late` };
  return { event: { kind: "crossing", n, text: `Crossing ${n} · Ferry's Daily: ${plainLine(headline)}`, link: DAILY_LINK } };
}

/**
 * WHAT A BLESSED SETTLEMENT CHANGED, counted from the World's own record at the
 * two blessed tags, never written by hand and never the receipt's channel totals:
 *   marks newly published   WORLD/settlement-publications.json's `published`
 *                           keys at S<n> and not at the previous blessed tag,
 *                           each counted by its own mark's `kind:` at S<n>
 *   households joined       WORLD/households.json's household keys at S<n> and
 *                           not at the previous blessed tag
 * `kindOf(key)` reads a published mark's kind (null when it cannot be read).
 * A record that cannot be read makes the count null, never zero. PURE.
 */
export function settlementChanges({ before, after, kindOf }) {
  if (!before?.published || !after?.published) return null;
  const added = Object.keys(after.published).filter((k) => !Object.hasOwn(before.published, k)).sort();
  const byKind = {};
  for (const k of added) { const kind = kindOf(k) ?? "unread"; byKind[kind] = (byKind[kind] ?? 0) + 1; }
  const households = before.households && after.households
    ? Object.keys(after.households).filter((h) => !Object.hasOwn(before.households, h)).length : null;
  return { published: added.length, byKind, households };
}

const counted = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * THE SETTLEMENT'S POST: its number, what it changed, and its replay link (the
 * site's /replay/ gives every blessed settlement its own anchor, `#S<n>`).
 * `changes` null (the record could not be read) is a skip, never a guessed zero.
 * PURE.
 */
export function settlementEvent({ n, changes }) {
  if (!changes || changes.households == null || changes.byKind.unread)
    return { skip: `settlement S${n}'s changes cannot be read whole from its blessed record${changes?.byKind?.unread ? ` (${changes.byKind.unread} published mark(s) whose kind cannot be read)` : ""}: no post, never a guessed count` };
  const parcels = changes.byKind.parcel ?? 0;
  const things = changes.byKind.thing ?? 0;
  const marks = changes.published - parcels - things;
  const said = [counted(marks, "mark drawn", "marks drawn"), counted(parcels, "parcel chartered", "parcels chartered"),
    counted(things, "thing built", "things built"), counted(changes.households, "household joined", "households joined")];
  return { event: { kind: "settlement", n, text: `Settlement S${n} is blessed: ${said.join(", ")}.`, link: replayLink(n) } };
}

// ── the wire ─────────────────────────────────────────────────────────────────

class XrpcError extends Error {
  constructor(method, { status = null, error = null, message = null, ambiguous }) {
    super(`${method}: ${status ? `HTTP ${status}` : "no answer"}${error ? ` ${error}` : ""}${message ? ` — ${String(message).slice(0, 200)}` : ""}`);
    Object.assign(this, { method, status, error, ambiguous });
  }
}

/**
 * One XRPC call. A thrown fetch (timeout, refused, reset) and a 5xx are
 * AMBIGUOUS: the request may have been acted on. A 4xx is a definite answer.
 * The error text names the method, status and the server's own error name, and
 * never a header or a body we sent.
 */
async function xrpc({ fetch, service, timeoutMs }, method, { query = null, body = null, token = null } = {}) {
  const url = new URL(`/xrpc/${method}`, service);
  if (query) for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const init = { method: body ? "POST" : "GET", headers: {}, signal: AbortSignal.timeout(timeoutMs) };
  if (body) { init.headers["content-type"] = "application/json"; init.body = JSON.stringify(body); }
  if (token) init.headers.authorization = `Bearer ${token}`;
  let res;
  try { res = await fetch(url, init); }
  catch (e) { throw new XrpcError(method, { message: e?.name === "TimeoutError" ? "timed out" : (e?.cause?.code ?? e?.name ?? "fetch failed"), ambiguous: true }); }
  let json = null;
  try { json = await res.json(); } catch { /* an empty or broken body */ }
  if (res.ok) return json ?? {};
  throw new XrpcError(method, { status: res.status, error: json?.error ?? null, message: json?.message ?? null, ambiguous: res.status >= 500 });
}

/** A session: the account's did and its access token, held in memory only. */
export async function createSession(wire, { identifier, password }) {
  const s = await xrpc(wire, "com.atproto.server.createSession", { body: { identifier, password } });
  if (!s?.did || !s?.accessJwt) throw new XrpcError("com.atproto.server.createSession", { message: "the answer named no did or token", ambiguous: false });
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
function writeState(dir, state) {
  mkdirSync(dir, { recursive: true });
  const tmp = `${statePath(dir, state.rkey)}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1) + "\n");
  renameSync(tmp, statePath(dir, state.rkey));
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

/** The event's lock, or null when a live process holds it. A lock whose pid is gone is taken over. */
export function lockEvent(dir, rkey, { pid = process.pid } = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${rkey}.lock`);
  for (let i = 0; i < 2; i++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, String(pid));
      closeSync(fd);
      return { release: () => { try { if (readFileSync(path, "utf8").trim() === String(pid)) rmSync(path); } catch { /* gone */ } } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let holder = NaN;
      try { holder = Number(readFileSync(path, "utf8").trim()); } catch { /* raced away */ }
      if (Number.isInteger(holder) && holder > 0 && alive(holder)) return null;
      try { rmSync(path); } catch { /* another took it */ }
    }
  }
  return null;
}

// ── the publisher ────────────────────────────────────────────────────────────

/**
 * Publish one event, at most once, at most MAX_SENDS sends over its life.
 * `event` is `{ kind, n, text, link }`. Returns the receipt: `{ event, rkey,
 * outcome, sends, uri?, detail? }`, where outcome is one of
 *   posted      this run's createRecord succeeded
 *   reconciled  a send's answer was lost or refused, and getRecord found the record
 *   already     the state already says posted (no network)
 *   busy        another invocation holds this event's lock
 *   waiting     no session, or getRecord could not tell whether an earlier send landed: nothing sent, no send spent
 *   failed      both sends are spent and the key is empty: logged, never sent again
 * (A first send refused outright, its key confirmed empty, is retried once in the same run.)
 *   unconfigured  no BSKY_IDENTIFIER / BSKY_APP_PASSWORD: nothing read, nothing sent
 * Nothing in the receipt or the state names the credential or the token.
 */
export async function publishEvent(event, { stateDir, env = process.env, fetch = globalThis.fetch, service = DEFAULT_SERVICE, now = () => new Date(), timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
  const rkey = rkeyFor(event.kind, event.n);
  const receipt = (outcome, state, detail) => ({ event: `${event.kind} ${event.n}`, rkey, outcome, sends: state?.sends ?? 0,
    ...(state?.uri ? { uri: state.uri } : {}), ...(detail ? { detail } : {}) });

  const held = readState(stateDir, rkey);
  if (held?.status === "posted") return receipt("already", held);
  if (held?.status === "failed") return receipt("failed", held, "both sends were spent earlier; never sent again");
  const creds = credentialsFrom(env);
  if (!creds) return receipt("unconfigured", held, `${BSKY_ENV.join(" and ")} are not both set: nothing was read or sent`);

  const lock = lockEvent(stateDir, rkey);
  if (!lock) return receipt("busy", held, "another invocation holds this event");
  try {
    const at = () => now().toISOString();
    // the payload is bound the first time the event is seen: a retry sends the same words
    const state = readState(stateDir, rkey) ?? {
      v: 1, event: { kind: event.kind, n: event.n }, rkey, status: "pending", sends: 0, attempts: [],
      payload: { text: event.text, link: event.link, created_at: at() },
    };
    state.payload.digest ??= createHash("sha256").update(`${state.payload.text}\n${state.payload.link}`).digest("hex");
    if (state.status === "posted") return receipt("already", state);
    const note = (step, outcome, detail = null) => { state.attempts.push({ at: at(), step, outcome, ...(detail ? { detail } : {}) }); writeState(stateDir, state); };
    const wire = { fetch, service, timeoutMs };

    let session;
    try { session = await createSession(wire, creds); }
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
    if (state.sends > 0 || state.status === "sending") {
      const found = await reconcile();
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
