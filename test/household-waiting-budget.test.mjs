// household-waiting-budget.test.mjs — CORE-88: household { read: "waiting" } fits the connector and loses nothing.
//
// THE MEASUREMENT (CORE-84, an authorized founder-household read): the waiting read answered
// 70,691 UTF-8 bytes of MCP text and the client refused it. The agreed cap is 10,000 bytes.
// Wright, 2026-11-14: "Give the household waiting read a budget under the 10,000-byte connector cap
// and fold the rest into stubs with counts and the read that opens each group … Nothing waiting may be lost."
//
// WHAT THESE PIN, on an INVENTED large house (never the founder's, and never a credential), through the
// real composer (householdApex, read: "waiting") and the real MCP serializer (mcp.mjs § contentFor):
//   B0  the yardstick is the connector's own text, in UTF-8 bytes;
//   B1  the fixture is genuinely too large: its unfolded answer (what the base delivered) is over the cap;
//   B2  the folded answer delivers ≤ WAITING_BUDGET_BYTES, non-ASCII included, and uses the room;
//   B3  every part kind is whole, or counted with the existing read that opens the rest; counts match the source;
//   B4  an oversized sample is folded whole, never cut, and every body shown is the source's own;
//   B5  many groups are all accounted for;
//   B6  upstream continuation and the first-N scope survive, and the page is never called the house's total;
//   B7  empty, unavailable and cut are three different words;
//   B8  a house that fits reads exactly what it read before; B9 every read a stub names exists, with arguments it takes;
//   B10 REST and MCP skins give one answer; B11 the worst house still fits.
//
//   node --test test/household-waiting-budget.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { storeIndexPooled } from "../src/town-index-store.mjs";
import { householdApex, HOUSEHOLD_READS, HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";
import { foldWaiting, deliveredBytes, WAITING_BUDGET_BYTES, CONNECTOR_CAP_BYTES } from "../src/household-waiting-budget.mjs";
import { markTakenAlerts, escrowOnMissingAlerts, sortAlerts } from "../src/alerts.mjs";
import { contentFor } from "../src/mcp.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { poolFromClone, RECORD_ON } from "./registry-pool-stub.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { putValues, emptyTown } from "./fixture.mjs";

const AS_OF = "waitingfixture000000000000000000000000000";
const HOUSE = "big-house";
const MEMBERS = ["r000", "r001", "r002"];
const NOW = Date.parse("2026-11-14T06:00:00Z");

const db = emptyTown();
putValues(db, "meta", ["as_of", AS_OF]);
putValues(db, "meta", ["town_path", "fixture"]);
putValues(db, "meta", ["hydrated_counts", JSON.stringify({})]);
for (const [i, h] of MEMBERS.entries())
  putValues(db, "residents", [h, JSON.stringify({ handle: h, is_office: false, last_active: `2026-11-1${i}T10:00:00.000Z`, address: { data: { since: "2026-01-01", joined: "2026-06-10" } } })]);
const IX = await indexStore(db, { db: "waiting_budget" });
const IX_RESTORE = await IX.useInProcess();
after(async () => { await IX_RESTORE(); await IX.stop(); });
const scratch = mkdtempSync(join(tmpdir(), "postmark-waiting-"));
after(() => rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
mkdirSync(join(scratch, "tools"), { recursive: true });
writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
  [HOUSE]: { name: "Big House", human: "BIG", accounts: [{ login: "big", id: 1 }], residents: MEMBERS },
} }));
__setPoolForTest(poolFromClone(scratch));
const keepRecord = { on: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
process.env.WORLD2_PG = RECORD_ON.WORLD2_PG;
process.env.WORLD2_PG_URL = RECORD_ON.WORLD2_PG_URL;
after(() => {
  __setPoolForTest(null);
  if (keepRecord.on === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keepRecord.on;
  if (keepRecord.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keepRecord.url;
});

const key = { household: HOUSE, handles: new Set(["r000", "r001"]) };

// ── an invented house, in the shapes the real readers hand needs-you ──────────
const WORDS = ["fence", "garden", "lantern", "quay", "orchard", "kiln", "bridge", "well"];
// a body that is not ASCII: accents, CJK and an emoji, so a character is 2 to 4 bytes
const body = (n, tag) => `${tag} ${"café 庭の柵を直してください 🌱 ".repeat(n)}`.trim();
/** One stream: `count` marks by `by` over `over`, newest first as the inbox orders them (its last row is the group's oldest). */
const stream = (by, over, count, bodyOf = (i) => body(2, `${by}#${i}`)) => Array.from({ length: count }, (_, i) => ({
  mark: `${by}/${WORDS[i % WORDS.length]}-${i}`, by, on_your_ground: [over], kind: "mark", date: `2026-11-${String(13 - (i % 12)).padStart(2, "0")}`,
  body: bodyOf(i),
}));

/** needs-you's own readers (house-bundle.mjs § needsYou), filled. */
function readersOf({ marks, total = marks.length, cursor = null, extras = {} }) {
  return {
    stances: async () => ({ stances_awaiting: total, awaiting: marks, standing: [], cursor, complete: cursor == null,
      set_downs_awaiting: extras.setDowns ?? [], ...(extras.takes?.length ? { awaiting_your_word: extras.takes } : {}),
      ...(extras.stancesUnavailable ? { unavailable: extras.stancesUnavailable } : {}) }),
    stakesFor: async () => ({ next_settlement: { at: "2026-11-15T00:00:00.000Z" }, rows: extras.atRisk ?? [] }),
    alertsFor: async () => ({ alerts: extras.alerts ?? [], unread: [] }),
    mailAwaiting: (h) => ({ unplaced_bounces: (extras.bounces ?? []).filter((b) => b.handle === h).map(({ handle: _h, ...b }) => b) }),
    claimState: async (_odb, h) => {
      if (extras.keyAsksThrow) throw new Error("key store down");
      return (extras.keyAsks ?? []).includes(h) ? { cosigned: false, asks_standing: "2026-11-12" } : null;
    },
    likenessNeed: async () => extras.likeness ?? { rows: [] },
  };
}
const ctxOf = (readers) => ({ clone: scratch, asOf: AS_OF, odb: { fixture: true }, nowMs: NOW, ix: storeIndexPooled(scratch), readers });

const BIG = () => {
  // three long streams, a stream whose oldest body is oversized, then one-mark authors: 100 read of 130 waiting
  const heron = stream("heron", "r000/the-long-wall", 14, (i) => (i === 13 ? body(300, "heron OVERSIZED") : body(3, `heron#${i}`)));
  const marks = [
    ...stream("kiln-keeper", "r000/garden", 32), ...stream("mossmere", "r001/orchard", 25), ...stream("brook", "r000/quay", 12), ...heron,
    ...Array.from({ length: 17 }, (_, i) => stream(`author-${String(i).padStart(2, "0")}`, `r00${i % 2}/spot-${i}`, 1)[0]),
  ];
  return {
    marks, total: 130, cursor: String(marks.length),
    extras: {
      setDowns: Array.from({ length: 12 }, (_, i) => ({ thing: `thing-${i}`, made_by: "r000", set_down_by: `other-${i}`, at: "2026-11-12T00:00:00Z", act_id: `a${i}`, answer: null })),
      takes: Array.from({ length: 5 }, (_, i) => ({ act: "take", thing: `take-${i}`, owner: "r001", by: `taker-${i}` })),
      bounces: [...Array.from({ length: 4 }, (_, i) => ({ handle: "r000", date: `2026-11-0${i + 1}`, path: `WHITE_PAGES/r000/outbox/${i}.md`, reason: `no resident "ghost-${i}"` })),
        ...Array.from({ length: 3 }, (_, i) => ({ handle: "r001", date: `2026-11-1${i}`, path: `WHITE_PAGES/r001/outbox/${i}.md`, reason: "no such resident" }))],
      keyAsks: ["r000", "r001"],
      likeness: { rows: [{ question: "likeness", cause: "the house's human has not said whether the town may use its residents' likeness" }] },
      atRisk: Array.from({ length: 5 }, (_, i) => ({ mark: `r000/shed-${i}`, class: "commons", escrow: 0, at_risk: true })),
      // built by alerts.mjs's own producers (WLD-51), bodies whole by law: two marks the settlement took, one escrow on a mark that is not in the world
      alerts: sortAlerts([
        ...markTakenAlerts([
          { slug: "r000/old-shed", owner: "r000", body: body(400, "mark-taken body"), opens_at: "2026-11-13T12:00:00.000Z" },
          { slug: "r001/old-well", owner: "r001", body: body(3, "small body"), opens_at: "2026-11-13T12:00:00.000Z" },
        ], new Date(NOW)),
        ...escrowOnMissingAlerts([{ mark: "r001/ghost-kiln", holder: "r001", n: 3, body: body(300, "escrow body") }], () => false),
      ]),
    },
  };
};
// 130 marks + 12 set-downs + 5 takes + 7 bounces + 2 key asks + 1 likeness + 5 at risk + 3 alerts
const BIG_COUNT = 130 + 12 + 5 + 7 + 2 + 1 + 5 + 3;

const ask = (h, ctxOver = {}) => householdApex({ read: "waiting" }, key, { ...ctxOf(readersOf(h)), ...ctxOver });
/** The text the connector delivers, through the real serializer (mcp.mjs § contentFor). */
const delivered = (answer) => { const c = contentFor(answer); assert.equal(c.length, 1, "one text block, nothing beside it"); return c[0].text; };
const bytesOf = (s) => Buffer.byteLength(s, "utf8");
const KNOWN_READS = ['household { read: "stances" }', 'household { read: "needs-you" }', 'household { read: "stakes" }',
  'household { read: "mail", args: { view: "awaiting", handle: "<resident>" } }'];

test("B0 · the yardstick is the connector's own: deliveredBytes is contentFor's text, in UTF-8 bytes", async () => {
  const a = await ask(BIG());
  const t = delivered(a);
  assert.equal(deliveredBytes(a), bytesOf(t));
  assert.ok(t.length < bytesOf(t), "the fixture is non-ASCII: bytes and characters differ, and the bytes are what count");
  assert.ok(WAITING_BUDGET_BYTES < CONNECTOR_CAP_BYTES && CONNECTOR_CAP_BYTES === 10000, "a budget under the agreed 10,000-byte cap");
});

test("B1 · the invented large house is over the cap unfolded: what the base delivered for it is refused", async () => {
  const a = await ask(BIG());
  assert.ok(a.folded, "the composer folded it");
  assert.ok(a.folded.full_bytes > CONNECTOR_CAP_BYTES * 3, `unfolded it was ${a.folded.full_bytes} bytes of text (the founder's house was 70,691)`);
  // the control: a budget nothing reaches returns the answer untouched, so `full_bytes` is the base's own size and the fold is the only difference
  const whole = { read: "waiting", count: 1, groups: [] };
  assert.equal(foldWaiting(whole, { budget: Infinity }), whole);
});

test("B2 · through the real composer and serializer: ≤ the budget, and the budget is used", async () => {
  const a = await ask(BIG());
  const n = bytesOf(delivered(a));
  if (process.env.WAITING_DUMP) writeFileSync(process.env.WAITING_DUMP, delivered(a));
  assert.ok(n <= WAITING_BUDGET_BYTES, `delivered ${n} bytes, budget ${WAITING_BUDGET_BYTES}`);
  assert.ok(n > WAITING_BUDGET_BYTES * 0.7, `not a count-only answer: ${n} bytes`);
  assert.deepEqual([a.read, a.household, a.count], ["waiting", HOUSE, BIG_COUNT], "the count is the whole house's, as the key says");
  assert.equal(a.folded.budget_bytes, WAITING_BUDGET_BYTES);
});

test("B3 · every part names its items as bodyless identity rows, or counts the rest with the read that lists them; counts match the source", async () => {
  const h = BIG();
  const a = await ask(h);
  const src = {
    set_downs_awaiting: h.extras.setDowns, takes_awaiting: h.extras.takes, key_asks: h.extras.keyAsks,
    stakes_at_risk: h.extras.atRisk, alerts: h.extras.alerts, unplaced_bounces: h.extras.bounces, likeness_question: h.extras.likeness.rows,
  };
  const ID = { // the field that names a row of each part, in the source's own shape
    set_downs_awaiting: (r) => r.thing, takes_awaiting: (r) => r.thing, key_asks: (r) => r, stakes_at_risk: (r) => r.mark,
    alerts: (r) => r.about?.mark ?? r.message, unplaced_bounces: (r) => r.path, likeness_question: (r) => r.household,
  };
  const got = (k, r) => ({ set_downs_awaiting: r.thing, takes_awaiting: r.thing, key_asks: r.handle, stakes_at_risk: r.mark, alerts: r.about?.mark ?? r.message, unplaced_bounces: r.path, likeness_question: r.household })[k];
  for (const [k, rows] of Object.entries(src)) {
    const p = a[k];
    assert.ok(p, `${k} is on the answer`);
    assert.equal(p.total, rows.length, `${k}: the source's count`);
    assert.equal(p.rows.length, p.shown, `${k}: shown is the rows that ride`);
    assert.ok(p.shown >= 1, `${k}: at least one item is named while any room is left`);
    // identity rows are the source's first rows, in order, named by the source's own id
    for (const [i, r] of p.rows.entries()) {
      const want = k === "key_asks" ? h.extras.keyAsks[i] : ID[k](rows[i]);
      assert.equal(got(k, r), want, `${k} row ${i} names the source's item`);
      assert.ok(!JSON.stringify(r).includes("body"), `${k} row ${i} carries no body`);
    }
    if (p.shown < p.total) {
      assert.equal(p.rows_not_shown, p.total - p.shown, `${k}: the rows not shown are counted`);
      assert.match(p.read, /^household \{ read: "(stances|needs-you)", args: \{ part: "[a-z_]+", cursor: "\d+" \} \}$/, `${k}: the call that pages the rest, from the rows already shown`);
      assert.ok(p.read.includes(`cursor: "${p.shown}"`), `${k}: and it resumes after the ${p.shown} rows shown`);
    } else assert.ok(!("rows_not_shown" in p), `${k}: nothing left over`);
  }
  assert.equal(a.alerts.shown, 3, "all three producer-shaped alerts are named");
  assert.deepEqual(a.alerts.rows.map((r) => r.about?.mark).sort(), h.extras.alerts.map((r) => r.about?.mark).sort());
  assert.ok(a.alerts.rows.every((r) => r.about === null || Object.keys(r.about).join() === "mark"), "an alert names its mark and not its body");
  assert.ok(a.alerts.rows.every((r) => r.act?.verb && r.message && r.kind && r.severity), "and keeps what lets it be acted on");
  // the marks: groups whole or stubbed, listed, or counted; every group exactly once, every mark once
  const want = new Map();
  for (const m of h.marks) { const k = `${m.by}\u0000${m.on_your_ground[0]}`; want.set(k, (want.get(k) ?? 0) + 1); }
  const seen = new Map();
  for (const g of a.groups) seen.set(`${g.by}\u0000${g.over}`, g.count);
  for (const g of a.groups_more?.listed ?? []) seen.set(`${g.by}\u0000${g.over}`, g.count);
  for (const [k, n] of seen) assert.equal(want.get(k), n, `group ${k.replace("\u0000", " over ")}: the source's count`);
  const unlisted = a.groups_more?.unlisted ?? { groups: 0, marks: 0 };
  assert.equal(seen.size + unlisted.groups, want.size, "every group is on the answer or counted in unlisted");
  assert.equal([...seen.values()].reduce((n, c) => n + c, 0) + unlisted.marks, h.marks.length, "every mark read is in a group on the answer or counted");
  assert.deepEqual(a.groups.slice(0, 3).map((g) => g.count), [32, 25, 14], "largest first, as needGroups orders them");
  assert.deepEqual([a.stances_awaiting.total, a.stances_awaiting.shown], [130, 100]);
});

test("B4 · an oversized sample is folded whole, never cut; every body shown is the source's own", async () => {
  const h = BIG();
  const a = await ask(h);
  const oldest = (by) => h.marks.filter((m) => m.by === by).at(-1);
  const heron = a.groups.find((g) => g.by === "heron");
  assert.ok(heron, "the group with the oversized body is on the answer");
  assert.ok(!("sample" in heron), "its body does not fit and is not shown");
  assert.equal(heron.sample_folded, `${bytesOf(oldest("heron").body)} bytes of body not shown`, "the folded body's size is the source's");
  assert.equal(heron.count, 14, "its count and ids stand");
  assert.deepEqual(heron.ids, ["heron/kiln-13", "heron/orchard-12", "heron/quay-11"], "its oldest ids stand, and its act still answers the group");
  assert.match(heron.act, /declare-stance-on/);
  for (const g of a.groups.filter((x) => "sample" in x)) assert.equal(g.sample, oldest(g.by).body, `${g.by}'s sample is its oldest body, whole`);
  assert.ok(a.groups.some((g) => "sample" in g), "the groups that fit keep their sample");
  // the alerts' bodies are whole by law and far over the budget: named without them, never cut
  const t = delivered(a);
  assert.ok(!t.includes("mark-taken body") && !t.includes("escrow body"), "no piece of an alert's body rides");
  assert.equal(a.alerts.shown, 3);
});

test("B5 · many groups: every group is on the answer or counted, the tail is called anonymous, and the answer still fits", async () => {
  const marks = Array.from({ length: 100 }, (_, i) => stream(`solo-${String(i).padStart(3, "0")}`, `r00${i % 2}/spot-${i % 9}`, 1)[0]);
  const a = await ask({ marks, total: 400, cursor: "100" });
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES);
  const onAnswer = a.groups.length + (a.groups_more?.listed?.length ?? 0) + (a.groups_more?.unlisted?.groups ?? 0);
  assert.equal(onAnswer, 100);
  assert.equal(a.groups.reduce((n, g) => n + g.count, 0) + a.groups_more.marks, 100, "the 100 marks read, none lost");
  assert.match(a.groups_more.unlisted.note, /^not named here/, "the tail says it is not named");
  assert.match(a.groups_more.open, /read: "stances", args: \{ limit: 100 \} \} walks every mark/);
  assert.match(a.groups_more.open, /pages that fit the connector: follow the cursor/, "and says the pages fit and carry a cursor");
  assert.deepEqual([a.stances_awaiting.total, a.stances_awaiting.shown], [400, 100]);
  assert.ok(!/the marks read are the groups below\b/.test(JSON.stringify(a)), "no claim that the groups below are all the marks");
  assert.match(a.stances_awaiting.in_groups, /a group not named is counted in groups_more/);
});

test("B6 · upstream continuation and scope survive: the first page is never called the house's total", async () => {
  const h = BIG();
  const a = await ask(h);
  assert.match(a.groups_note, /^groups are drawn from the first 100 of 130; household \{ read: "stances", args: \{ cursor: "100" \} \} walks the rest$/);
  assert.match(a.stances_awaiting.more, /^household \{ read: "stances", cursor: "100" \}$/, "the upstream cursor is carried");
  assert.equal(a.count, BIG_COUNT, "count is the house's, not the page's");
  assert.ok(a.stances_awaiting.total > a.stances_awaiting.shown);
  // no cursor, nothing to walk: the note is not invented
  const whole = await ask({ marks: h.marks, total: h.marks.length });
  assert.ok(!("groups_note" in whole) && !("more" in whole.stances_awaiting));
});

test("B7 · empty, unavailable and cut are three different words", async () => {
  const h = BIG();
  h.extras.setDowns = []; // empty: read, and nothing waits
  h.extras.keyAsksThrow = true; // unavailable: the key store could not be read
  // cut: more bounces than the answer can name
  h.extras.bounces = Array.from({ length: 60 }, (_, i) => ({ handle: "r000", date: "2026-11-01", path: `WHITE_PAGES/r000/outbox/${i}.md`, reason: `no resident "ghost-${i}"` }));
  const a = await ask(h);
  assert.deepEqual([a.set_downs_awaiting.total, a.set_downs_awaiting.shown, a.set_downs_awaiting.rows.length], [0, 0, 0]);
  assert.ok(!("unavailable" in a.set_downs_awaiting) && !("read" in a.set_downs_awaiting), "empty is not unavailable and not cut");
  assert.match(a.key_asks.unavailable, /could not be read/, "unavailable says so");
  assert.equal(a.key_asks.total, 0);
  assert.ok(!("rows_not_shown" in a.key_asks), "an unreadable list is not a cut one");
  assert.ok(a.unplaced_bounces.rows_not_shown > 0 && a.unplaced_bounces.read, "cut says how many and which read");
  // a stance inbox that could not be read stays unavailable, on a folded answer too
  const blind = BIG();
  blind.extras.stancesUnavailable = "the consent inbox could not be read (record)";
  assert.equal((await ask(blind)).stances_awaiting.unavailable, "the consent inbox could not be read (record)");
  // nothing waits and everything read: the small answer, as it was
  const none = await ask({ marks: [], extras: {} });
  assert.equal(none.count, 0);
  assert.match(none.note, /nothing waits on you/);
  assert.ok(!("folded" in none));
});

test("B8 · a house that fits reads exactly what it read before: nothing folded, nothing renamed", async () => {
  const marks = [...stream("kai", "r000/garden", 3), ...stream("ren", "r001/quay", 1)];
  const a = await ask({ marks, extras: { setDowns: [{ thing: "x", made_by: "r000", set_down_by: "y", at: "2026-11-12T00:00:00Z", act_id: "a", answer: null }] } });
  assert.ok(!("folded" in a));
  assert.equal(a.stances_awaiting.rows.length, 4, "the rows ride, as before");
  assert.deepEqual(Object.keys(a.stances_awaiting), ["total", "shown", "rows"]);
  assert.equal(a.set_downs_awaiting.rows.length, 1);
  assert.ok("cause" in a.set_downs_awaiting.rows[0], "a whole row keeps its cause");
  assert.deepEqual(foldWaiting(a, { budget: WAITING_BUDGET_BYTES }), a, "folding what fits is the identity");
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES);
  assert.equal(a.shown, 5, "`shown` keeps its meaning where nothing is folded");
  assert.ok(a.groups.every((g) => "sample" in g));
});

test("B9 · every read a folded answer names exists, with arguments it takes, and a group's read is sized to its own bodies", async () => {
  const h = BIG();
  const a = await ask(h);
  const used = new Set();
  const walk = (v) => { if (typeof v === "string") for (const m of v.matchAll(/household \{ read: "([a-z-]+)"(?:, args: \{ ([^}]*) \})? \}/g)) used.add(JSON.stringify([m[1], m[2] ?? ""])); else if (v && typeof v === "object") Object.values(v).forEach(walk); };
  walk(a);
  assert.ok(used.size >= 4, `the answer names its reads: ${[...used].join(" ")}`);
  for (const u of used) {
    const [read, args] = JSON.parse(u);
    assert.ok(read in HOUSEHOLD_READS, `${read} is a household read`);
    for (const name of args.split(",").map((s) => s.trim().split(":")[0].trim()).filter(Boolean)) {
      // `handle` is the read door's own exempt field (household-apex.mjs § THE READ VALIDATES), taken by every read that names a resident
      assert.ok(name === "handle" || name in (HOUSEHOLD_READ_FIELDS[read] ?? {}), `read "${read}" takes ${name}`);
    }
  }
  // each group read is the group's own by/over at the read's own page size, and the source holds exactly that many marks for it
  for (const g of a.groups.filter((x) => "open" in x)) {
    const [, by, over, limit] = g.open.match(/by: ("[^"]*"), over: ("[^"]*"), limit: (\d+)/);
    assert.deepEqual([JSON.parse(by), JSON.parse(over)], [g.by, g.over]);
    assert.equal(limit, "100");
    assert.equal(h.marks.filter((m) => m.by === g.by && m.on_your_ground[0] === g.over).length, g.count, "the group the read lists is the one counted");
  }
});

test("B12 · at-risk marks past the room are counted, and the call named pages exactly those rows from where the answer stopped", async () => {
  const h = BIG();
  h.extras.atRisk = Array.from({ length: 80 }, (_, i) => ({ mark: `r000/shed-${i}`, class: "commons", escrow: 0, at_risk: true, body: body(5, "shed") }));
  const a = await ask(h);
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES);
  const p = a.stakes_at_risk;
  assert.equal(p.total, 80);
  assert.ok(p.shown >= 1 && p.shown < 80);
  assert.equal(p.rows_not_shown, 80 - p.shown);
  assert.equal(p.read, `household { read: "needs-you", args: { part: "stakes_at_risk", cursor: "${p.shown}" } }`);
  assert.ok(p.rows.every((r) => r.mark && !("body" in r) && !("cause" in r)), "identity rows: the mark, and no body");
});

test("B10 ·REST and MCP skins are one composer: the same bytes", async () => {
  const h = BIG();
  const mcp = await ask(h, { slim: true, strictFields: true });
  const rest = await ask(h, {});
  assert.deepEqual(rest, mcp);
});

test("B11 · the worst house still fits: every part full, every group alone, every body huge", async () => {
  const marks = Array.from({ length: 100 }, (_, i) => ({ ...stream(`solo-${i}`, `r000/spot-${i}`, 1)[0], body: body(200, `solo ${i}`) }));
  const h = BIG();
  const a = await ask({ ...h, marks, total: 100, cursor: null });
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES, `${bytesOf(delivered(a))} bytes`);
  assert.equal(a.count, 100 + BIG_COUNT - 130);
});
