// maintenance.mjs — the planned-maintenance switch (POS-1096).
//
// Darko, 2026-11-16 22:50 EST: "we can just have like a small build so that there's an
// alert that gracefully says like, hey, like the server's down for maintenance or
// something. If there are queries in the meantime. And we should be able to reuse that
// for any future like planned outages as well."
//
// ONE SWITCH. An operator on the box creates a flag file before planned work (a store
// restart, a migration) and removes it after. While the file exists, every door answers
// at once with 503, Retry-After, one plain message and, if the file names one, the
// expected end time. No restart, no per-outage code, nothing from outside the box can
// flip it (it is a file on the box's own disk; no route writes it).
//
//   on :  echo 2026-11-18T03:30:00Z > /srv/postmark-office/MAINTENANCE     (an end time, optional)
//         touch /srv/postmark-office/MAINTENANCE                           (no end time)
//   off:  rm /srv/postmark-office/MAINTENANCE
//
// OFFICE_MAINTENANCE_FILE moves the file. The check is server.mjs § handleRequestBody's
// first act, BEFORE the bearer is resolved (that lookup is a store read) and before any
// door, so it answers while Postgres is restarting and never waits on the store's acquire
// timeout. This module touches no store, no clone and no network: one small file read,
// remembered for a second.
//
// WHAT STAYS UP: the manifest (GET /), GET /release and the two keyless in-memory ops
// reads (/ops/loop-lag, /ops/store-txn), so the sentinel's probes read "maintenance" (the
// manifest and /release say so in a `maintenance` field) and not a fault. A CORS preflight
// (OPTIONS) is let through: it carries no credential and reads nothing.

import { readFileSync } from "node:fs";

export const MAINTENANCE_DEFAULT_FILE = "/srv/postmark-office/MAINTENANCE";
export const MAINTENANCE_DEFECT = "Postmark is down for planned maintenance, back in a few minutes";
export const MAINTENANCE_HINT = "this is planned work, not a fault and not your key: your sign-in is intact. Send the same request again after Retry-After seconds; do not sign in again.";
/** Retry-After when no end time is given (or it has passed): a few minutes' worth of patience, not a hammer. */
export const MAINTENANCE_RETRY_AFTER_S = 120;
const RETRY_MIN_S = 5;
const RETRY_MAX_S = 3600;
const CACHE_MS = 1000;

/** The doors that answer through maintenance (all GET; HEAD is rewritten to GET by the time anything else looks). */
const STAYS_UP = new Set(["/", "/release", "/ops/loop-lag", "/ops/store-txn"]);

/**
 * The switch's reading: null when off, else { ends_at } (an ISO string, or null).
 * `read` is the file reader (a test hands one in); it returns the file's text, or throws
 * ENOENT when there is no file. Any OTHER read failure (permissions, a directory) reads as
 * off: the switch fails open, because an unreadable flag must never take the town down.
 */
export function readSwitch(file, read = (f) => readFileSync(f, "utf8")) {
  return readSwitchState(file, read).sw;
}

/**
 * The same reading with its state named, so a caller can log a CHANGE: `{ sw, state, code }`,
 * where state is "off" (no file), "on", or "unreadable" (any read failure but ENOENT; `code` is
 * the error's code). An unreadable flag still reads as off (`sw` null): failing open stays.
 */
export function readSwitchState(file, read = (f) => readFileSync(f, "utf8")) {
  let text;
  try { text = read(file); }
  catch (e) {
    if (e?.code === "ENOENT") return { sw: null, state: "off", code: null };
    return { sw: null, state: "unreadable", code: String(e?.code ?? "no error code").slice(0, 80) };
  }
  const first = String(text).split(/\r?\n/, 1)[0].trim();
  const ms = first ? Date.parse(first) : NaN;
  return { sw: { ends_at: Number.isFinite(ms) ? new Date(ms).toISOString() : null }, state: "on", code: null };
}

/** Seconds to put in Retry-After for a switch reading at `nowMs`. */
export function retryAfterSeconds(sw, nowMs) {
  const end = sw?.ends_at ? Date.parse(sw.ends_at) : NaN;
  if (!Number.isFinite(end) || end <= nowMs) return MAINTENANCE_RETRY_AFTER_S;
  return Math.min(RETRY_MAX_S, Math.max(RETRY_MIN_S, Math.ceil((end - nowMs) / 1000)));
}

/** The 503's JSON body for a switch reading. */
export function maintenanceBody(sw) {
  return {
    error: "bounce",
    defect: MAINTENANCE_DEFECT,
    hint: MAINTENANCE_HINT,
    maintenance: { on: true, ends_at: sw?.ends_at ?? null },
  };
}

/** What the manifest and /release say about the switch: null when off. */
export const maintenanceNote = (sw) => (sw ? { on: true, ends_at: sw.ends_at ?? null, message: MAINTENANCE_DEFECT } : null);

/**
 * The switch as the office reads it: `check()` answers the reading now (null when off),
 * from a one-second memory so a busy door does not read a file per request.
 * `file` and `clock`/`read` are injectable for a test, and so is `log` (default console.error).
 * One log line each time the switch's state CHANGES (off to on, on to off, readable to
 * unreadable with the error code), never one per request or per read; the first reading
 * counts as a change from "off", so a flag that is unreadable at boot is said once.
 */
export function makeMaintenance({ file = () => process.env.OFFICE_MAINTENANCE_FILE || MAINTENANCE_DEFAULT_FILE, clock = Date.now, read, log = (m) => console.error(m) } = {}) {
  let at = -Infinity, held = null, lastState = "off", lastCode = null;
  const check = () => {
    const t = clock();
    if (t - at >= CACHE_MS || t < at) {
      const r = readSwitchState(typeof file === "function" ? file() : file, read);
      held = r.sw; at = t;
      if (r.state !== lastState || r.code !== lastCode) {
        lastState = r.state; lastCode = r.code;
        try {
          if (r.state === "on") log(`[maintenance] switch ON${r.sw.ends_at ? ` (expected end ${r.sw.ends_at})` : ""}: every door answers 503`);
          else if (r.state === "off") log("[maintenance] switch OFF: doors answer normally");
          else log(`[maintenance] the flag file could not be read (${r.code}): treated as off, the town stays up`);
        } catch { /* a logger must never take a request down */ }
      }
    }
    return held;
  };
  /** True when this request is answered by the maintenance 503 (the switch is on and the door is not one that stays up). */
  const refuses = (method, path) => {
    const sw = check();
    if (!sw) return null;
    if (method === "OPTIONS") return null;
    if ((method === "GET" || method === "HEAD") && STAYS_UP.has(path)) return null;
    return sw;
  };
  /** `{ maintenance: {...} }` while on, `{}` while off: spread into a body, so the off shape is byte-for-byte unchanged. */
  const field = () => { const n = maintenanceNote(check()); return n ? { maintenance: n } : {}; };
  return { check, refuses, field };
}

/** Answer a request with the maintenance 503 on a node `res`. Touches nothing but `res`. */
export function sendMaintenance(res, sw, { asOf = null, nowMs = Date.now() } = {}) {
  const body = JSON.stringify(maintenanceBody(sw), null, 1);
  res.writeHead(503, {
    "content-type": "application/json; charset=utf-8",
    "retry-after": String(retryAfterSeconds(sw, nowMs)),
    "cache-control": "no-store",
    // a browser window (the site's live islands) reads the message instead of a CORS failure
    "access-control-allow-origin": "*",
    "x-postmark-maintenance": "on",
    ...(asOf ? { "x-postmark-as-of": asOf } : {}),
  });
  res.end(body);
}
