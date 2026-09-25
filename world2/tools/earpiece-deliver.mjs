#!/usr/bin/env node
// earpiece-deliver.mjs — THE EARPIECE'S DELIVERER (POS-209, Earpiece C).
//
// A oneshot. The box's timer (deploy/postmark-earpiece.timer) runs it every
// minute; while no event's window is open it reads the calendar once, writes
// its stamp and exits 0. While one is open it wakes the residents who RSVPed,
// by the rules in src/earpiece.mjs, through the queries in
// src/earpiece-store.mjs.
//
// ── THE KILL FLAG ───────────────────────────────────────────────────────────
//
// `W2_EARPIECE=1` or it sends nothing. Unset, or anything else, and the run
// writes `status: "disabled"` on its stamp and exits 0 without opening a
// connection (the precedent is W2_FOLD in src/world-serve.mjs).
//
// ── WHAT IS LOGGED WHERE ────────────────────────────────────────────────────
//
// A wake that was attempted, and the one row that says a budget ran out, go in
// `earpiece_wakes` (026), the resident's own log behind household { read:
// "earpiece" }. What a RUN saw goes on the stamp file: `disabled`, `idle`, the
// events it found outside their window, the counts. Those are facts about the
// run, not about a resident, and a per-resident row every minute for every
// announced event would bury the log a resident reads.
//
// Usage: node world2/tools/earpiece-deliver.mjs --run [--state <file>]
// Env:   W2_EARPIECE=1 · WORLD2_PG_URL (the office's record) · WORLD_CLONE
//        (the world engine's containment law) · EARPIECE_STATE (the stamp file)
// Exit:  0 ran, idle or disabled · 1 the record could not be reached (the
//        stamp says so) · 2 usage.

import { writeFileSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  earpieceEnabled, inWindow, placeOf, saysAt, walksAt, decideWake, buildEnvelope, postWake, letterFor, KILL_FLAG,
} from "../../src/earpiece.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
export const STATE_DEFAULT = "/srv/postmark-earpiece/state.json";

// ── THE MAIL PORT: STOPPED ON ITS SENDER (POS-209) ──────────────────────────
//
// MEASURED: every letter the office pens has a resident `from`, and the key
// that sends it must hold that resident (write.mjs § validateLetter: "is not
// one of your residents"). The office has no sender of its own. The welcome and
// doorstep letters are `postmaster`'s, and postmaster is Ferry, a Meep who
// writes them herself. Which resident signs a wake the office writes is a shape
// call, so the default port sends nothing and says why; a mail wake is logged
// `failed` and is not charged. The port is injected, so the rules and the log
// are proved without it.
export const MAIL_STOPPED = "no mail pen for the earpiece yet: which resident signs a letter the office writes is a shape call (POS-209, stopped)";
export const mailStopped = async () => ({ ok: false, detail: MAIL_STOPPED });

const iso = (t) => new Date(t).toISOString();

/**
 * One run. Everything it touches is injected, so the suite drives it against a
 * store in memory and a listener on this machine.
 *
 *   store      { candidates(now), rsvps(ids), tap(event, since, until), household(key, fn) }
 *   withinFn   the world engine's containment (world-verbs.mjs § pointWithinMark)
 *   earshotM   the say lane's earshot, for an event at a bare point
 */
export async function runEarpiece({ now = Date.now(), env = process.env, store, fetchImpl = globalThis.fetch,
  sendMail = mailStopped, sleep, withinFn = null, earshotM = null } = {}) {
  const at = iso(now);
  if (!earpieceEnabled(env)) return { at, status: "disabled", why: `${KILL_FLAG} is not 1 — nothing was read and nothing was sent` };

  const events = await store.candidates(now);
  const open = events.filter((e) => inWindow(e, now));
  const outside_window = events.filter((e) => !open.includes(e)).map((e) => e.id);
  const counts = { delivered: 0, failed: 0, fell_back: 0, "budget-exhausted": 0, coalescing: 0, "nothing-new": 0, "already-exhausted": 0 };
  if (!open.length) return { at, status: "idle", outside_window, counts };

  const byId = new Map(open.map((e) => [e.id, e]));
  const rsvps = await store.rsvps(open.map((e) => e.id));

  // The tap, read ONCE per event from its doors to now; each resident's
  // `since` is a filter over it.
  const taps = new Map();
  const refused = [];
  for (const e of open) {
    const t = await store.tap(e, e.doors_open ?? e.starts, at);
    const place = placeOf(e, t.markRow);
    if (place.mark && (!place.shape || typeof withinFn !== "function")) {
      refused.push({ event: e.id, why: !place.shape ? `the mark ${place.mark} has no geometry in the record` : "no containment law loaded from the world clone" });
      continue;
    }
    taps.set(e.id, { place, ...t });
  }
  const newsFor = (id) => (since) => {
    const t = taps.get(id);
    const said = saysAt(t.voiceActs, t.place, { since, until: at, compose: t.compose, withinFn, earshotM });
    return { said, ...walksAt(t.frameActs, t.place, { since, until: at }) };
  };

  // ONE HOUSEHOLD AT A TIME (earpiece-store.mjs § the header).
  const houses = new Map();
  for (const r of rsvps) {
    if (!taps.has(r.event)) continue;
    const key = r.household ?? `solo:${r.handle}`;
    houses.set(key, [...(houses.get(key) ?? []), r]);
  }

  for (const [key, list] of houses) {
    const plans = await store.household(key, async (tx) => {
      const out = [];
      for (const rsvp of list) {
        const event = byId.get(rsvp.event);
        const harness = rsvp.harness === "mail" ? null : await tx.harness(rsvp.handle);
        const history = await tx.wakes(rsvp.event, rsvp.handle);
        out.push({ rsvp, event, decision: decideWake({ event, rsvp, harness, history, now, news: newsFor(rsvp.event) }) });
      }
      return out;
    });

    // No transaction is open from here to the log.
    const rows = [];
    for (const { rsvp, event, decision: d } of plans) {
      const base = { event: rsvp.event, handle: rsvp.handle, household: key, sent_at: at };
      if (d.act === "none") { counts[d.why === "budget-exhausted" ? "already-exhausted" : d.why] += 1; continue; }
      if (d.act === "exhausted") {
        rows.push({ ...base, harness: rsvp.harness, wake_n: Number(rsvp.budget), status: "budget-exhausted", budget_left: 0,
          detail: `the budget of ${rsvp.budget} is spent; nothing more is sent for this event` });
        counts["budget-exhausted"] += 1;
        continue;
      }
      const envelope = buildEnvelope({ event, place: taps.get(rsvp.event).place, since: d.since, news: d.news,
        budget_left: d.budget_left, wake_n: d.wake_n, now });
      let status, detail, kind = d.route.kind;
      if (d.route.kind === "webhook") {
        const r = await postWake(d.route.url, d.route.secret, envelope, { fetchImpl, ...(sleep ? { sleep } : {}) });
        status = r.ok ? "delivered" : "failed";
        detail = r.detail;
      } else {
        const r = await sendMail({ to: rsvp.handle, ...letterFor(envelope) }).catch((e) => ({ ok: false, detail: String(e?.message ?? e).slice(0, 200) }));
        status = r.ok ? (d.route.fell_back ? "fell_back" : "delivered") : "failed";
        detail = [d.route.fell_back ? `fell back to mail: ${d.route.fell_back}` : null, r.detail ?? null].filter(Boolean).join(" — ") || null;
      }
      counts[status] += 1;
      rows.push({ ...base, harness: kind, wake_n: d.wake_n, status, detail,
        budget_left: status === "failed" ? d.budget_left + 1 : d.budget_left });
    }
    if (rows.length) await store.household(key, async (tx) => { for (const w of rows) await tx.log(w); });
  }
  return { at, status: "ran", windows: open.map((e) => e.id), outside_window, ...(refused.length ? { refused } : {}), counts };
}

// ── the oneshot ─────────────────────────────────────────────────────────────

function writeState(path, body) {
  try { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`); }
  catch (e) { console.error(`[earpiece] the stamp file refused a write (${String(e?.message ?? e).slice(0, 120)})`); }
}

async function main(argv) {
  if (!argv.includes("--run")) {
    console.error("usage: earpiece-deliver.mjs --run [--state <file>]   (the box's timer runs it every minute; W2_EARPIECE=1 or it sends nothing)");
    process.exit(2);
  }
  const i = argv.indexOf("--state");
  const state = i >= 0 ? argv[i + 1] : (process.env.EARPIECE_STATE ?? STATE_DEFAULT);
  if (!earpieceEnabled()) {
    const out = await runEarpiece({});
    writeState(state, out);
    console.log(JSON.stringify(out));
    process.exit(0);
  }
  const clone = process.env.WORLD_CLONE ?? join(ROOT, "world-clone");
  const verbs = await import(pathToFileURL(join(clone, "tools", "world-verbs.mjs"))).catch(() => null);
  const { EARSHOT_M } = await import("../../src/reach.mjs");
  const { pgStore } = await import("../../src/earpiece-store.mjs");
  try {
    const out = await runEarpiece({ store: pgStore(), withinFn: verbs?.pointWithinMark ?? null, earshotM: EARSHOT_M });
    writeState(state, out);
    console.log(JSON.stringify(out));
    process.exit(0);
  } catch (e) {
    // The record's own sentence, never the driver's message: a failing row
    // could carry a secret, and a stamp file is not a place for one.
    const out = { at: iso(Date.now()), status: "failed", why: "the office's record could not be reached mid-run — a wake sent before it failed may be missing from earpiece_wakes; the journal has this run" };
    writeState(state, out);
    console.error(`[earpiece] ${out.why}`);
    process.exit(1);
  }
}

// THE REALPATH COMPARE (await-clearing.mjs § isMain): a plain resolve() is
// defeated by a junction, and the cli-guard enters through one.
const isMain = (() => {
  try { return Boolean(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main(process.argv.slice(2));
