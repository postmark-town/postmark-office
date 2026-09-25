// events.test.mjs — the calendar (POS-207) and the RSVP's harness (POS-208).
//
// ⚑ THROUGH A JS STUB OF THE STORE. `acts-pen-stub.mjs` is a pen, not a
// Postgres, and the `events` / `event_rsvps` tables below are a Map each. This
// proves the JS: which rows the door writes, which it refuses, what the read
// answers. It proves NOTHING about 026_events.sql itself (its CHECKs, its
// grants, a real ON CONFLICT) — that is the migration's real run on the dev
// sandbox, which is Wright's hand before the merge.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { installActsPen, uninstallActsPen } from "./acts-pen-stub.mjs";
import {
  hostAtOffice, cancelAtOffice, rsvpAtOffice, calendarAtOffice, eventActs,
} from "../src/events-store.mjs";
import { phaseAt, judgeInterval, EVENT_MAX_DAYS, FELL_BACK_NO_ECHO, BUDGET_DEFAULT } from "../src/events.mjs";
import { compareRebuild } from "../world2/tools/events-rebuild.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const H = 3_600_000;
const iso = (t) => new Date(t).toISOString();

// ── the two tables, in memory ───────────────────────────────────────────────
function eventTables() {
  const events = new Map();
  const rsvps = new Map();
  const EV = ["id", "title", "invitation", "host", "household", "place_mark", "place_x", "place_y",
    "doors_open", "starts", "ends", "revised", "cancelled", "hosted_act", "last_act"];
  const also = [
    [/^INSERT INTO events/i, (q, p) => {
      if (events.has(p[0])) throw new Error(`duplicate key value violates unique constraint "events_pkey"`);
      events.set(p[0], Object.fromEntries(EV.map((k, i) => [k, p[i]])));
      return { rows: [], rowCount: 1 };
    }],
    [/^UPDATE events SET/i, (q, p) => {
      const r = events.get(p[0]);
      Object.assign(r, { title: p[1], invitation: p[2], place_mark: p[3], place_x: p[4], place_y: p[5],
        doors_open: p[6], starts: p[7], ends: p[8], revised: p[9], cancelled: p[10], last_act: p[11] });
      return { rows: [], rowCount: 1 };
    }],
    [/FROM events WHERE id = \$1/i, (q, p) => {
      const r = events.get(p[0]);
      return { rows: r ? [{ ...r }] : [], rowCount: r ? 1 : 0 };
    }],
    [/FROM events WHERE id LIKE \$1/i, (q, p) => {
      const pre = String(p[0]).replace(/%$/, "");
      const rows = [...events.values()].filter((r) => r.id.startsWith(pre)).map((r) => ({ id: r.id, cancelled: r.cancelled, ends: r.ends }));
      return { rows, rowCount: rows.length };
    }],
    [/FROM events WHERE ends > \$1 ORDER BY starts, id/i, (q, p) => {
      const rows = [...events.values()].filter((r) => Date.parse(r.ends) > Date.parse(p[0]))
        .sort((a, b) => Date.parse(a.starts) - Date.parse(b.starts) || a.id.localeCompare(b.id)).map((r) => ({ ...r }));
      return { rows, rowCount: rows.length };
    }],
    [/^INSERT INTO event_rsvps/i, (q, p) => {
      const [event, handle, household, harness, address, budget, fell_back, act] = p;
      rsvps.set(`${event} ${handle}`, { event, handle, household, harness, address, budget, fell_back, act });
      return { rows: [], rowCount: 1 };
    }],
    [/SELECT handle FROM event_rsvps WHERE event = \$1/i, (q, p) => {
      const rows = [...rsvps.values()].filter((r) => r.event === p[0]).map((r) => ({ handle: r.handle })).sort((a, b) => a.handle.localeCompare(b.handle));
      return { rows, rowCount: rows.length };
    }],
    [/FROM event_rsvps WHERE event = ANY\(\$1\)/i, (q, p) => {
      const rows = [...rsvps.values()].filter((r) => p[0].includes(r.event)).map((r) => ({ event: r.event, handle: r.handle }));
      return { rows, rowCount: rows.length };
    }],
  ];
  return { events, rsvps, also };
}

const MARKS = [
  { slug: "current-the-reader/the-snug-harbour", status: "standing", kind: "sited", geometry: { at: { x: -350, y: 4978 }, extent: { w: 30, h: 22 } } },
  { slug: "wright/an-old-porch", status: "retired", kind: "sited", geometry: { at: { x: 5, y: 5 }, extent: { w: 2, h: 2 } } },
  { slug: "wright/a-pin", status: "standing", kind: "sited", geometry: { at: { x: 9, y: 9 }, extent: { w: 0, h: 0 } } },
  { slug: "wright/a-naming", status: "standing", kind: "naming", geometry: null },
];

function setup() {
  const t = eventTables();
  const pen = installActsPen({ marks: MARKS, also: t.also });
  return { ...t, pen };
}

const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };

const at = (now) => ({ starts: iso(now + 1 * H), ends: iso(now + 3 * H) });
const HOST = (now, place = { mark: "current-the-reader/the-snug-harbour" }) =>
  ({ title: "The Snug Harbour Grand Opening", invitation: "Come down to the water.", place, ...at(now) });

async function refusedWith(p, code, re) {
  await assert.rejects(p, (e) => { assert.equal(e.code, code, `${e.code} ${e.defect}`); if (re) assert.match(e.defect, re); return true; });
}

test.afterEach(() => uninstallActsPen());

// ── THE FALSIFIER (the brief, in order) ─────────────────────────────────────

test("falsifier · a host act with a standing mark answers the id and the absolute point; the calendar moves it coming → now → ended by the office's clock", async () => {
  const { pen } = setup();
  const now = Date.now();
  const r = await hostAtOffice(HOST(now), WRIGHT);
  assert.equal(r.event.id, "wright/the-snug-harbour-grand-opening");
  assert.deepEqual(r.event.place, { mark: "current-the-reader/the-snug-harbour", name: "the-snug-harbour", x: -350, y: 4978 });
  assert.equal(pen.rows().length, 1);
  const act = pen.rows()[0];
  assert.equal(act.class, "event"); assert.equal(act.action, "host"); assert.equal(act.object, r.event.id);
  assert.equal(act.at_anchor, "current-the-reader/the-snug-harbour", "the act's anchor is the mark (an anchor and an offset, never a bare x,y)");
  assert.deepEqual([act.at_dx, act.at_dy], [0, 0]);

  const before = await calendarAtOffice({}, { now });
  assert.equal(before.coming.length, 1); assert.equal(before.coming[0].phase, "announced");
  assert.equal(before.now.length + before.ended.length, 0);

  const inside = await calendarAtOffice({}, { now: now + 2 * H });
  assert.equal(inside.now.length, 1); assert.equal(inside.now[0].phase, "underway");
  assert.equal(inside.now[0].starts_in_s, -3600); assert.equal(inside.now[0].ends_in_s, 3600);

  const after = await calendarAtOffice({}, { now: now + 4 * H });
  assert.equal(after.ended.length, 1); assert.equal(after.ended[0].phase, "ended");
  assert.equal(after.total, 1);
});

for (const [name, drop] of [["no place", "place"], ["no end", "ends"]]) {
  test(`falsifier · ${name}: refused by name, nothing written`, async () => {
    const { pen, events } = setup();
    const f = HOST(Date.now()); delete f[drop];
    await refusedWith(hostAtOffice(f, WRIGHT), 422, drop === "place" ? /needs a place/ : /needs an end/);
    assert.equal(pen.rows().length, 0, "an act was written for a refused host");
    assert.equal(events.size, 0);
  });
}

test("falsifier · a draft mark as the place is refused — and in the words a mark that does not exist gets, so no draft is confirmed to exist", async () => {
  const { pen } = setup();
  // A draft is a claim, never a `marks` row: the store has no row for it.
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/my-private-draft" }), WRIGHT), 422, /^no standing mark "wright\/my-private-draft"$/);
  assert.equal(pen.rows().length, 0);
});

test("refusals · a retired mark, a mark with no extent, a naming mark with no where — each by name, nothing written", async () => {
  const { pen } = setup();
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/an-old-porch" }), WRIGHT), 422, /is retired/);
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/a-pin" }), WRIGHT), 422, /has no extent/);
  await refusedWith(hostAtOffice(HOST(Date.now(), { mark: "wright/a-naming" }), WRIGHT), 422, /has no extent/);
  assert.equal(pen.rows().length, 0);
});

test("refusals · the interval: end before start, doors after start, already ended, longer than the dial, a time with no zone", async () => {
  const { pen } = setup();
  const now = Date.now();
  const base = HOST(now);
  await refusedWith(hostAtOffice({ ...base, ends: iso(now + 0.5 * H) }, WRIGHT), 422, /ends after it starts/);
  await refusedWith(hostAtOffice({ ...base, doors_open: iso(now + 2 * H) }, WRIGHT), 422, /doors open before the start/);
  await refusedWith(hostAtOffice({ ...base, starts: iso(now - 3 * H), ends: iso(now - 1 * H) }, WRIGHT), 422, /already ended/);
  await refusedWith(hostAtOffice({ ...base, ends: iso(now + (EVENT_MAX_DAYS * 24 + 2) * H) }, WRIGHT), 422, new RegExp(`at most ${EVENT_MAX_DAYS} days`));
  await refusedWith(hostAtOffice({ ...base, starts: "2026-09-26T22:00" }, WRIGHT), 422, /not an instant/);
  assert.equal(pen.rows().length, 0);
});

test("a point place: the payload keeps the absolute point, the act anchors to the world with the point as its offset", async () => {
  const { pen } = setup();
  const r = await hostAtOffice(HOST(Date.now(), { at: { x: 120, y: 64 } }), WRIGHT);
  assert.deepEqual(r.event.place, { mark: null, name: null, x: 120, y: 64 });
  const act = pen.rows()[0];
  assert.equal(act.at_anchor, "the-town/let-there-be-light");
  assert.deepEqual([act.at_dx, act.at_dy], [120, 64]);
  assert.deepEqual(JSON.parse(act.payload).place, { mark: null, x: 120, y: 64 });
});

// ── phase, at fixed clocks ──────────────────────────────────────────────────

test("phase · announced, doors-open, underway, ended, at the instants that divide them", () => {
  const e = { doors_open: "2026-09-26T21:30:00.000Z", starts: "2026-09-26T22:00:00.000Z", ends: "2026-09-27T02:00:00.000Z" };
  const t = (s) => Date.parse(s);
  assert.equal(phaseAt(e, t("2026-09-26T21:29:59Z")), "announced");
  assert.equal(phaseAt(e, t("2026-09-26T21:30:00Z")), "doors-open");
  assert.equal(phaseAt(e, t("2026-09-26T22:00:00Z")), "underway");
  assert.equal(phaseAt(e, t("2026-09-27T02:00:00Z")), "ended");
  // doors_open defaults to starts: announced straight to underway
  const d = judgeInterval({ starts: e.starts, ends: e.ends }, t("2026-09-26T00:00:00Z"));
  assert.equal(d.doors_open, e.starts);
});

// ── amend, cancel ───────────────────────────────────────────────────────────

test("amend · host with event: changes only what was sent, counts the revision, keeps every revision in the act log", async () => {
  const { pen } = setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  const r = await hostAtOffice({ event: event.id, ends: iso(now + 4 * H) }, WRIGHT);
  assert.deepEqual(r.amended, ["ends"]);
  assert.equal(r.event.revised, 1);
  assert.equal(r.event.title, "The Snug Harbour Grand Opening");
  assert.deepEqual(pen.rows().map((a) => a.action), ["host", "amend-event"]);
  // someone else's event is not theirs to change
  await refusedWith(hostAtOffice({ event: event.id, title: "mine now" }, ERRANT), 403, /not yours to change/);
  assert.equal(pen.rows().length, 2);
});

test("cancel · stays on the calendar marked cancelled; its id is not reused — the same title mints -2", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  const c = await cancelAtOffice({ event: event.id }, WRIGHT);
  assert.equal(c.event.cancelled, true);
  const cal = await calendarAtOffice({}, { now });
  assert.equal(cal.coming[0].cancelled, true);
  const again = await hostAtOffice(HOST(now), WRIGHT);
  assert.equal(again.event.id, `${event.id}-2`);
  await refusedWith(rsvpAtOffice({ event: event.id }, ERRANT), 409, /was cancelled/);
});

test("a second host of a STANDING event's title is refused and pointed at the amendment", async () => {
  const { pen } = setup();
  const now = Date.now();
  await hostAtOffice(HOST(now), WRIGHT);
  await refusedWith(hostAtOffice(HOST(now), WRIGHT), 409, /already host/);
  assert.equal(pen.rows().length, 1);
});

// ── the RSVP (POS-208) ──────────────────────────────────────────────────────

const echoing = (seen) => async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: 200, text: async () => JSON.parse(init.body).nonce }; };
const silent = (seen) => async (url, init) => { seen.push({ url, body: JSON.parse(init.body) }); return { status: 200, text: async () => "ok" }; };

test("falsifier · a webhook that echoes lands as webhook; one that does not lands as mail and says so; both show the budget", async () => {
  const { rsvps } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const seen = [];
  const ok = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/postmark" }, budget: 9 }, ERRANT, { fetchImpl: echoing(seen) });
  assert.equal(ok.harness.kind, "webhook"); assert.equal(ok.harness.url, "https://hooks.example.org/postmark");
  assert.equal(ok.budget, 9); assert.equal(ok.fell_back, undefined);
  assert.equal(seen.length, 1, "the url is challenged exactly once"); assert.match(seen[0].body.nonce, /^[0-9a-f]{32}$/);

  const no = await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/deaf" } }, WRIGHT, { fetchImpl: silent([]) });
  assert.equal(no.harness.kind, "mail"); assert.equal(no.fell_back, FELL_BACK_NO_ECHO);
  assert.equal(no.budget, BUDGET_DEFAULT);
  // an unechoed URL is never registered: nothing a later wake could read
  assert.equal(rsvps.get(`${event.id} wright`).address, null);
  assert.equal(rsvps.get(`${event.id} wright`).harness, "mail");
});

test("rsvp · mail needs nothing; letta names its conversation; a budget past the dial and a private url are refused by name", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const m = await rsvpAtOffice({ event: event.id }, ERRANT);
  assert.equal(m.harness.kind, "mail"); assert.equal(m.budget, 6);
  const l = await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-4f2a" } }, ERRANT);
  assert.deepEqual(l.harness, { kind: "letta", conversation: "conv-4f2a" });
  const n = pen.rows().length;
  await refusedWith(rsvpAtOffice({ event: event.id, budget: 61 }, ERRANT), 422, /1 to 60/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://127.0.0.1/x" } }, ERRANT), 422, /private address/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "http://hooks.example.org/x" } }, ERRANT), 422, /https/);
  await refusedWith(rsvpAtOffice({ event: event.id, harness: { kind: "mail", url: "https://x.example" } }, ERRANT), 422, /does not take: url/);
  assert.equal(pen.rows().length, n);
});

test("the act carries no address: a webhook url and a letta conversation never reach `acts` (the table the notary exports)", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" } }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-private-77" } }, WRIGHT);
  const text = JSON.stringify(pen.rows());
  assert.doesNotMatch(text, /secret-path|conv-private-77/);
});

test("the public read carries no harness, url, conversation or budget — only who RSVPed", async () => {
  setup();
  const now = Date.now();
  const { event } = await hostAtOffice(HOST(now), WRIGHT);
  await rsvpAtOffice({ event: event.id, harness: { kind: "webhook", url: "https://hooks.example.org/secret-path" }, budget: 7 }, ERRANT, { fetchImpl: echoing([]) });
  await rsvpAtOffice({ event: event.id, harness: { kind: "letta", conversation: "conv-private-77" } }, WRIGHT);
  for (const read of [await calendarAtOffice({}, { now }), await calendarAtOffice({ event: event.id }, { now })]) {
    const text = JSON.stringify(read);
    assert.doesNotMatch(text, /secret-path|conv-private-77|harness|budget|webhook|letta/);
  }
  const one = await calendarAtOffice({ event: event.id }, { now });
  assert.deepEqual(one.event.rsvps, { total: 2, residents: ["errant", "wright"] });
});

test("the acting resident · handle names which of your residents acts; one resident is the default; several are asked for by name; another house's is refused", async () => {
  const { pen } = setup();
  const { event } = await hostAtOffice(HOST(Date.now()), WRIGHT);
  const TWO = { household: "errant", handles: new Set(["errant", "pica"]) };
  const n = pen.rows().length;
  await refusedWith(rsvpAtOffice({ event: event.id }, TWO), 422, /which of your residents/);
  await refusedWith(rsvpAtOffice({ event: event.id, handle: "wright" }, TWO), 403, /not one of your residents/);
  assert.equal(pen.rows().length, n, "a refused rsvp wrote nothing");
  const r = await rsvpAtOffice({ event: event.id, handle: "pica" }, TWO);
  assert.equal(r.handle, "pica");
  assert.equal(pen.rows().at(-1).actor, "pica");
  const { APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  for (const a of ["host", "cancel-event", "rsvp"]) assert.ok(APEX_ONLY_FIELDS[a].properties.handle, `${a} declares handle`);
});

// ── the rebuild ─────────────────────────────────────────────────────────────

test("rebuild · the tables equal what the act log alone derives — and a hand-edited row is caught", async () => {
  const { pen, events, rsvps } = setup();
  const now = Date.now();
  const a = await hostAtOffice(HOST(now), WRIGHT);
  await hostAtOffice({ event: a.event.id, title: "The Snug Harbour, opened" }, WRIGHT);
  const b = await hostAtOffice({ ...HOST(now, { at: { x: 1, y: 2 } }), title: "Reading by the lamp" }, WRIGHT);
  await cancelAtOffice({ event: b.event.id }, WRIGHT);
  await rsvpAtOffice({ event: a.event.id, harness: { kind: "letta", conversation: "c1" } }, ERRANT);
  await rsvpAtOffice({ event: a.event.id, budget: 3 }, ERRANT);   // a second RSVP replaces the first
  const acts = await eventActs(pen);
  assert.equal(acts.length, 6);
  const stored = () => ({ events: [...events.values()], rsvps: [...rsvps.values()] });
  const ok = compareRebuild(stored(), acts);
  assert.deepEqual(ok.drift, []); assert.equal(ok.equal, true);
  assert.deepEqual(ok.counts, { acts: 6, events: 2, event_rsvps: 1 });
  events.get(a.event.id).title = "edited by hand";
  const bad = compareRebuild(stored(), acts);
  assert.equal(bad.equal, false);
  assert.match(bad.drift[0], /title: stored "edited by hand"/);
});

// ── the doors ───────────────────────────────────────────────────────────────

test("the household door dispatches host/cancel-event/rsvp and refuses in its own grammar; the town door lists calendar", async () => {
  const { HOUSEHOLD_DISPATCHABLE, APEX_ONLY_FIELDS } = await import("../src/household-apex.mjs");
  const { TOWN_READS } = await import("../src/town-apex.mjs");
  for (const a of ["host", "cancel-event", "rsvp"]) {
    assert.ok(HOUSEHOLD_DISPATCHABLE.includes(a), a);
    assert.ok(APEX_ONLY_FIELDS[a], `${a} declares its fields`);
  }
  assert.equal(TOWN_READS.calendar.tool, "read_calendar");
  const { judgeActFields } = await import("../src/one-contract.mjs");
  const j = judgeActFields({ tool: "host", declared: APEX_ONLY_FIELDS.host.properties, fields: { title: "x", zz_probe: 1 } });
  assert.equal(j.bounce.defect, "host does not take: zz_probe");
});

test("an office pointed at no record refuses the act with the pen's sentence, and the read with its own", async () => {
  uninstallActsPen();
  const off = { WORLD2_PG: undefined, WORLD2_PG_URL: undefined };
  await refusedWith(hostAtOffice(HOST(Date.now()), WRIGHT, { env: off }), 503, /nothing was written, and nothing was lost/);
  await refusedWith(calendarAtOffice({}, { env: off }), 503, /record cannot be read/);
});

// ── the sample the site lane reads ──────────────────────────────────────────

test("test/fixtures/calendar.sample.json has the live read's keys, at the top and on every event", async () => {
  setup();
  const now = Date.now();
  await hostAtOffice(HOST(now), WRIGHT);
  const live = await calendarAtOffice({}, { now });
  const sample = JSON.parse(readFileSync(join(HERE, "fixtures", "calendar.sample.json"), "utf8"));
  const keys = (o) => Object.keys(o).sort();
  assert.deepEqual(keys(sample), keys(live));
  const liveEvent = live.coming[0];
  for (const e of [...sample.now, ...sample.coming, ...sample.ended]) {
    assert.deepEqual(keys(e), keys(liveEvent), `sample event ${e.id}`);
    assert.deepEqual(keys(e.place), keys(liveEvent.place));
    assert.deepEqual(keys(e.rsvps), keys(liveEvent.rsvps));
    assert.equal(e.phase, phaseAt(e, Date.parse(sample.as_of)), `sample event ${e.id}'s phase is not the office's`);
  }
});
