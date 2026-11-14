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
import { foldWaiting, deliveredBytes, WAITING_BUDGET_BYTES, CONNECTOR_CAP_BYTES, PART_ROWS } from "../src/household-waiting-budget.mjs";
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
  const heron = stream("heron", "r000/the-long-wall", 6, (i) => (i === 5 ? body(300, "heron OVERSIZED") : body(3, `heron#${i}`)));
  const marks = [
    ...stream("kiln-keeper", "r000/garden", 40), ...stream("mossmere", "r001/orchard", 25), ...stream("brook", "r000/quay", 12), ...heron,
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
      alerts: [
        { kind: "stake-at-risk", severity: "act", about: { mark: "r000/shed-0", body: body(400, "alert body") }, message: "a mark of yours is at risk", act: { verb: "world.stake", args: { handle: "r000" } }, since: "2026-11-12", until: null },
        ...Array.from({ length: 2 }, (_, i) => ({ kind: "info", severity: "info", about: null, message: `info ${i}`, act: { verb: "x", args: {} }, since: "2026-11-12", until: null })),
      ],
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

test("B3 · every part is whole or counted with the existing read that opens the rest, and the counts match the source", async () => {
  const h = BIG();
  const a = await ask(h);
  const src = {
    set_downs_awaiting: h.extras.setDowns.length, takes_awaiting: h.extras.takes.length, key_asks: h.extras.keyAsks.length,
    stakes_at_risk: h.extras.atRisk.length, alerts: h.extras.alerts.length, unplaced_bounces: h.extras.bounces.length, likeness_question: h.extras.likeness.rows.length,
  };
  for (const [k, total] of Object.entries(src)) {
    const p = a[k];
    assert.ok(p, `${k} is on the answer`);
    assert.equal(p.total, total, `${k}: the source's count`);
    assert.equal(p.rows.length, p.shown, `${k}: shown is the rows that ride`);
    assert.ok(p.shown <= PART_ROWS);
    if (p.shown < p.total) {
      assert.equal(p.rows_folded, p.total - p.shown, `${k}: the folded rows are counted`);
      assert.ok(KNOWN_READS.includes(p.read), `${k}: names an existing read that lists the rest: ${p.read}`);
    } else assert.ok(!("read" in p) && !("rows_folded" in p), `${k}: nothing folded, nothing to open`);
  }
  // the rows that ride are the source's own, first ones first
  assert.deepEqual(a.set_downs_awaiting.rows.map((r) => r.thing), h.extras.setDowns.slice(0, a.set_downs_awaiting.shown).map((r) => r.thing));
  assert.deepEqual(a.unplaced_bounces.by_resident, { r000: 4, r001: 3 }, "each bounce count names the resident whose mail read lists it");
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
  assert.deepEqual(a.groups.slice(0, 3).map((g) => g.count), [40, 25, 12], "largest first, as needGroups orders them");
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
  assert.equal(heron.count, 6, "its count and ids stand");
  assert.deepEqual(heron.ids, ["heron/kiln-5", "heron/orchard-4", "heron/quay-3"], "its oldest ids stand, and its act still answers the group");
  assert.match(heron.act, /declare-stance-on/);
  for (const g of a.groups.filter((x) => "sample" in x)) assert.equal(g.sample, oldest(g.by).body, `${g.by}'s sample is its oldest body, whole`);
  assert.ok(a.groups.some((g) => "sample" in g), "the groups that fit keep their sample");
  // the alert whose body is too big rides as a count, never half a body
  assert.equal(a.alerts.shown, 0);
  assert.equal(a.alerts.rows_folded, 3);
  assert.ok(!delivered(a).includes("alert body"), "no piece of the oversized alert body");
});

test("B5 · many groups: every group is on the answer or counted, and the answer still fits", async () => {
  const marks = Array.from({ length: 100 }, (_, i) => stream(`solo-${String(i).padStart(3, "0")}`, `r00${i % 2}/spot-${i % 9}`, 1)[0]);
  const a = await ask({ marks, total: 400, cursor: "100" });
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES);
  const onAnswer = a.groups.length + (a.groups_more?.listed?.length ?? 0) + (a.groups_more?.unlisted?.groups ?? 0);
  assert.equal(onAnswer, 100);
  assert.equal(a.groups_more.groups, a.groups_more.listed?.length + a.groups_more.unlisted.groups || a.groups_more.groups);
  assert.equal(a.groups.reduce((n, g) => n + g.count, 0) + a.groups_more.marks, 100, "the 100 marks read, none lost");
  assert.match(a.groups_more.open, /read: "stances", args: \{ by, over, limit: 100 \}/);
  assert.match(a.groups_more.open, /read: "stances", args: \{ limit: 100, cursor \}/, "and the read that walks every mark");
  assert.deepEqual([a.stances_awaiting.total, a.stances_awaiting.shown], [400, 100]);
});

test("B6 · upstream continuation and scope survive: the first page is never called the house's total", async () => {
  const h = BIG();
  const a = await ask(h);
  assert.equal(a.groups_note, 'groups are drawn from the first 100 of 130; household { read: "stances", args: { cursor: "100" } } walks the rest');
  assert.equal(a.stances_awaiting.more, 'household { read: "stances", cursor: "100" }');
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
  const a = await ask(h);
  assert.deepEqual([a.set_downs_awaiting.total, a.set_downs_awaiting.shown, a.set_downs_awaiting.rows.length], [0, 0, 0]);
  assert.ok(!("unavailable" in a.set_downs_awaiting) && !("read" in a.set_downs_awaiting), "empty is not unavailable and not cut");
  assert.match(a.key_asks.unavailable, /could not be read/, "unavailable says so");
  assert.equal(a.key_asks.total, 0);
  assert.ok(!("rows_folded" in a.key_asks), "an unreadable list is not a cut one");
  assert.ok(a.unplaced_bounces.rows_folded > 0 && a.unplaced_bounces.read, "cut says how many and which read");
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
  assert.deepEqual(foldWaiting(a, { budget: WAITING_BUDGET_BYTES }), a, "folding what fits is the identity");
  assert.ok(bytesOf(delivered(a)) <= WAITING_BUDGET_BYTES);
  assert.equal(a.shown, 5, "`shown` keeps its meaning where nothing is folded");
  assert.ok(a.groups.every((g) => "sample" in g));
});

test("B9 · every read a stub names exists, and every argument it carries is one that read takes", async () => {
  const a = await ask(BIG());
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
  // each stub's open is the group's own by/over, and the source holds exactly that many marks for it
  const h = BIG();
  for (const g of a.groups.filter((x) => "open" in x)) {
    const [, by, over] = g.open.match(/by: ("[^"]*"), over: ("[^"]*")/);
    assert.deepEqual([JSON.parse(by), JSON.parse(over)], [g.by, g.over]);
    assert.equal(h.marks.filter((m) => m.by === g.by && m.on_your_ground[0] === g.over).length, g.count, "the group the read lists is the one counted");
  }
});

test("B10 · REST and MCP skins are one composer: the same bytes", async () => {
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
