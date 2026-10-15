// alerts.test.mjs — the doorstep's alerts: one shape, a registered kind each
// (WLD-51; Darko 2026-10-15 19:06, the shape approved 19:29).
//
//   node --test test/alerts.test.mjs
//
// Pure: the readers are handed in. The two kinds' store queries are proven on
// a real Postgres in test/taken-to-drafts.test.mjs.

import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_KINDS, SEVERITIES, alert, sortAlerts, alertsFor, markTakenAlerts, escrowOnMissingAlerts,
  settlementOfWindow, townWhen, markTakenMessage, MARK_TAKEN_SETTLEMENTS,
} from "../src/alerts.mjs";

const SHAPE = ["kind", "severity", "about", "message", "act", "since", "until"];

test("THE REGISTRY: every kind has its severity and a one-line definition, in one home", () => {
  assert.deepEqual(SEVERITIES, ["urgent", "act", "info"]);
  assert.deepEqual(Object.keys(ALERT_KINDS).sort(), ["escrow-on-missing-mark", "mark-taken"]);
  for (const [kind, reg] of Object.entries(ALERT_KINDS)) {
    assert.ok(SEVERITIES.includes(reg.severity), `${kind}: a known severity`);
    assert.ok(typeof reg.definition === "string" && reg.definition.length > 40 && !reg.definition.includes("\n"), `${kind}: one line`);
  }
  assert.equal(ALERT_KINDS["mark-taken"].severity, "act");
  assert.equal(ALERT_KINDS["escrow-on-missing-mark"].severity, "info");
});

test("THE SHAPE: an alert is exactly { kind, severity, about, message, act: { verb, args }, since, until }; an unregistered kind is refused where it is made", () => {
  const a = alert("escrow-on-missing-mark", { about: { mark: "a/b", body: null }, message: "m", act: { verb: "unstake", args: { mark: "a/b", stamps: 1 } } });
  assert.deepEqual(Object.keys(a), SHAPE);
  assert.equal(a.severity, "info", "the registry's severity, never the caller's");
  assert.deepEqual([a.since, a.until], [null, null]);
  assert.throws(() => alert("a-new-worry", { message: "m", act: { verb: "x", args: {} } }), /not a registered kind/);
  assert.throws(() => alert("mark-taken", { message: "m" }), /needs its act/);
});

test("THE ORDER: most severe first, then the newest since, then the mark", () => {
  const mk = (kind, mark, since) => alert(kind, { about: { mark, body: null }, message: "m", act: { verb: "v", args: {} }, since });
  const sorted = sortAlerts([
    mk("escrow-on-missing-mark", "a/z", null),
    mk("mark-taken", "a/old", "2026-10-14T18:00:00.000Z"),
    mk("escrow-on-missing-mark", "a/a", null),
    mk("mark-taken", "a/new", "2026-10-15T18:00:00.000Z"),
  ]);
  assert.deepEqual(sorted.map((a) => a.about.mark), ["a/new", "a/old", "a/a", "a/z"]);
});

test("mark-taken: the settlement that took it, named in the town's time, never the window's ISO opening; until is 14 settlements on", () => {
  assert.equal(MARK_TAKEN_SETTLEMENTS, 14);
  assert.equal(settlementOfWindow("2026-10-15T17:45:40Z"), "2026-10-15T18:00:00.000Z");
  assert.equal(settlementOfWindow("2026-10-16T05:45:40Z"), "2026-10-16T06:00:00.000Z");
  assert.equal(townWhen("2026-10-15T18:00:00.000Z"), "Oct 15, 2:00 pm EDT");
  assert.equal(townWhen("2026-12-01T18:00:00.000Z"), "Dec 1, 1:00 pm EST");
  const row = { slug: "lupi/rootwood-bookend", owner: "lupi", body: "A bookend of rootwood.", opens_at: new Date("2026-10-15T17:45:40Z") };
  const [a] = markTakenAlerts([row], new Date("2026-10-16T00:00:00Z"));
  assert.deepEqual(a, {
    kind: "mark-taken", severity: "act",
    about: { mark: "lupi/rootwood-bookend", body: "A bookend of rootwood." },
    message: markTakenMessage("lupi/rootwood-bookend", "lupi", "Oct 15, 2:00 pm EDT"),
    act: { verb: "stake", args: { mark: "lupi/rootwood-bookend", stamps: 1 } },
    since: "2026-10-15T18:00:00.000Z", until: "2026-10-22T18:00:00.000Z",
  });
  assert.equal(a.message, "lupi/rootwood-bookend had no stamps behind it, so it left the world at the Oct 15, 2:00 pm EDT settlement. It's back in your household's drafts, and its author, lupi, can stake it, or leave it again with a stamp, to bring it back.");
  assert.doesNotMatch(a.message, /\d{4}-\d{2}-\d{2}T/, "no ISO instant reaches the words");
  assert.deepEqual(markTakenAlerts([row], new Date("2026-10-22T18:00:00Z")), [], "expired at its until");
});

test("escrow-on-missing-mark: the message and the act that resolves it; a mark on world main is never missing", () => {
  const found = [
    { mark: "vireo/the-understory", holder: "vireo", n: 2, body: "The understory, as its twin stood." },
    { mark: "caelum-reeves/the-sky-side", holder: "caelum-reeves", n: 5, body: null },
    { mark: "vireo/understory", holder: "vireo", n: 1, body: "x" },
  ];
  const out = escrowOnMissingAlerts(found, (id) => id === "vireo/understory");
  assert.deepEqual(out.map((a) => [a.about, a.message, a.act]), [
    [{ mark: "vireo/the-understory", body: "The understory, as its twin stood." }, "✦2 on vireo/the-understory, which isn't in the world; unstake to bring it home",
      { verb: "unstake", args: { mark: "vireo/the-understory", stamps: 2 } }],
    [{ mark: "caelum-reeves/the-sky-side", body: null }, "✦5 on caelum-reeves/the-sky-side, which isn't in the world; unstake to bring it home",
      { verb: "unstake", args: { mark: "caelum-reeves/the-sky-side", stamps: 5 } }],
  ]);
});

test("alertsFor: no handle asks nothing; no store answers none; an unreadable kind is named in unread, never read as none", async () => {
  let asked = 0;
  const store = async () => { asked += 1; return { query: async () => ({ rows: [] }) }; };
  assert.deepEqual(await alertsFor([], { store }), { alerts: [], unread: [] });
  assert.equal(asked, 0);
  assert.deepEqual(await alertsFor(["rei"], { store: async () => null }), { alerts: [], unread: [] });
  const half = await alertsFor(["rei"], { store: async () => ({ query: async (sql) => { if (/retired_cause/.test(sql)) throw new Error("column \"retired_cause\" does not exist"); return { rows: [] }; } }) });
  assert.deepEqual(half, { alerts: [], unread: [{ kind: "mark-taken", reason: "column \"retired_cause\" does not exist" }] });
  const down = await alertsFor(["rei"], { store: async () => { throw new Error("ECONNREFUSED"); } });
  assert.deepEqual(down.unread.map((u) => u.kind), ["mark-taken", "escrow-on-missing-mark"]);
});
