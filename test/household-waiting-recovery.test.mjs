// household-waiting-recovery.test.mjs — CORE-88: the reads a folded waiting answer names are the ones that recover what it folded.
//
// Truey's review of the first fold (PR #1029, 6f5112f8): a stub that names a read the connector refuses leads
// nowhere. So this file does not check that a read NAME exists: it FOLLOWS each emitted call through the real
// dispatcher (householdApex) over a real world, and measures what comes back, in the connector's own text.
//
//   R1  the group stubs' open calls (by, over, limit) over a real world-in-a-bottle: each returns that group's marks,
//       the page fits under the cap, and the next page (cursor) continues it, every mark once;
//   R2  the walk and the cursor the answer names cover the marks the page held back, bounded the same way;
//   R3  the bounce count's mail read, over the real index, lists those bounces, bounded;
//   R4  an act the answer names for a small group is the call that answers it.
//
// The world is invented (alpha-style fixture of doorstep-stances.test.mjs), the house is invented, no credential.
//
//   node --test test/household-waiting-recovery.test.mjs

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const sweep = (d) => { try { rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 }); } catch { /* litter */ } };
const scratch = mkdtempSync(join(tmpdir(), "postmark-waiting-recovery-"));
after(() => sweep(scratch));

// ── the world in a bottle: r000's big parcel, and marks laid over it ─────────
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// a body that is not ASCII, and long enough that a group of them cannot ride one page
const bodyOf = (tag, n = 6) => `${tag} ${"庭の柵を直してください café 🌱 ".repeat(n)}`.trim();
const STREAMS = [["kiln-keeper", 30], ["mossmere", 18], ["brook", 9]];
const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "r000/big-parcel", by: "r000", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 400, h: 400 }, date: "2026-08-01", body: "r000's ground" },
  { id: "r001/orchard-parcel", by: "r001", kind: "parcel", at: { x: 1000, y: 1000 }, extent: { w: 400, h: 400 }, date: "2026-08-01", body: "r001's ground" },
];
let day = 0;
for (const [by, n] of STREAMS) for (let i = 0; i < n; i++) {
  MARKS.push({ id: `${by}/stone-${i}`, by, kind: "sited", at: { x: 100 + (i % 20) * 3, y: 100 + (day % 50) }, extent: { w: 2, h: 2 }, date: `2026-09-${String(1 + (day++ % 28)).padStart(2, "0")}`, body: bodyOf(`${by} ${i}`, i === 0 ? 120 : 6) });
}
// one-mark authors over r001's ground, so there are many small groups
for (let i = 0; i < 25; i++) MARKS.push({ id: `solo-${String(i).padStart(2, "0")}/pebble`, by: `solo-${String(i).padStart(2, "0")}`, kind: "sited", at: { x: 1000 + i * 3, y: 1000 }, extent: { w: 2, h: 2 }, date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, body: bodyOf(`solo ${i}`, 3) });

put("tools/geometry.mjs", `
export const rect = (mk) => ({ x: mk.at?.x ?? 0, y: mk.at?.y ?? 0, w: mk.extent?.w ?? 1, h: mk.extent?.h ?? 1 });
export function overlapArea(a, b) {
  const dx = Math.min(a.x + a.w / 2, b.x + b.w / 2) - Math.max(a.x - a.w / 2, b.x - b.w / 2);
  const dy = Math.min(a.y + a.h / 2, b.y + b.h / 2) - Math.max(a.y - a.h / 2, b.y - b.h / 2);
  return dx > 0 && dy > 0 ? dx * dy : 0;
}
`);
put("WORLD/world-state.json", JSON.stringify({ tick: 0, marks: MARKS, parcels: [] }));
put("WORLD/skeleton.json", JSON.stringify({ features: [] }));
for (const m of MARKS) put(`WORLD/marks/let-there-be-light/${m.id.split("/")[1]}/mark.md`, `---\nkind: ${m.kind}\nby: ${m.by}\ndate: ${m.date}\n---\n\n${m.body}\n`);
git("init", "-q", "-b", "main");
git("config", "user.email", "t@postmark.invalid");
git("config", "user.name", "waiting recovery falsifier");
git("add", "-A");
git("commit", "-qm", "canon");

// THE ENVIRONMENT IS SET BEFORE THE OFFICE IS IMPORTED (doorstep-stances.test.mjs § says why), so every office import below is dynamic.
const dbPath = join(scratch, "dynamic.db");
process.env.WORLD_CLONE = repo;
process.env.WORLD_DYNAMIC_DB = dbPath;
process.env.WORLD_SINGLE_LOG = "1";
process.env.WORLD_APEX = "1";
after(() => { delete process.env.WORLD_DYNAMIC_DB; delete process.env.WORLD_SINGLE_LOG; });

const AS_OF = "recoveryfixture000000000000000000000000";
const HOUSE = "recovery-house";
const key = { household: HOUSE, handles: new Set(["r000", "r001"]) };
let householdApex, contentFor, ctx, rowBytes, HEAVY_ROW_BYTES;
const cleanups = [];
// a hook's own `after` would run when the hook ends, so the cleanups wait here, at the file's end
after(async () => { for (const c of cleanups.reverse()) await c(); });
const bytesOf = (s) => Buffer.byteLength(s, "utf8");
const text = (answer) => contentFor(answer)[0].text;

before(async () => {
  ({ householdApex } = await import("../src/household-apex.mjs"));
  ({ contentFor } = await import("../src/mcp.mjs"));
  ({ rowBytes, HEAVY_ROW_BYTES } = await import("../src/household-waiting-budget.mjs"));
  const { __setPoolForTest } = await import("../src/world2-acts.mjs");
  const { poolFromClone, RECORD_ON } = await import("./registry-pool-stub.mjs");
  const { STANCE_ON, stancePoolFromJournal } = await import("./stance-pool-stub.mjs");
  const { putValues, emptyTown } = await import("./fixture.mjs");
  const { indexStore } = await import("./helpers/office-under-test.mjs");
  const { storeIndexPooled } = await import("../src/town-index-store.mjs");

  mkdirSync(join(scratch, "tools"), { recursive: true });
  writeFileSync(join(scratch, "tools", "households.json"), JSON.stringify({ households: {
    [HOUSE]: { name: "Recovery House", human: "REC", accounts: [{ login: "rec", id: 1 }], residents: ["r000", "r001"] },
  } }));
  __setPoolForTest(poolFromClone(scratch));
  Object.assign(process.env, STANCE_ON, RECORD_ON);
  stancePoolFromJournal(dbPath);
  cleanups.push(() => { __setPoolForTest(null); delete process.env.WORLD2_STANCE_URL; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

  const town = emptyTown();
  putValues(town, "meta", ["as_of", AS_OF]);
  putValues(town, "meta", ["town_path", "fixture"]);
  putValues(town, "meta", ["hydrated_counts", JSON.stringify({})]);
  for (const h of ["r000", "r001"]) putValues(town, "residents", [h, JSON.stringify({ handle: h, is_office: false, last_active: "2026-11-10T10:00:00.000Z", address: { data: { since: "2026-01-01", joined: "2026-06-10" } } })]);
  // r000 wrote 40 letters that never arrived (the mail law's own `unplaced_bounces`)
  putValues(town, "mail_state", ["r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations: [],
    unplaced_bounces: Array.from({ length: 40 }, (_, i) => ({ date: "2026-10-01", path: `WHITE_PAGES/r000/outbox/${i}.md`, reason: `no resident "ghost-${i}"` })),
    summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: 40 },
  })]);
  const ix = await indexStore(town, { db: "waiting_recovery" });
  const restore = await ix.useInProcess();
  cleanups.push(async () => { await restore(); await ix.stop(); });
  ctx = { clone: scratch, asOf: AS_OF, odb: null, nowMs: Date.parse("2026-11-14T06:00:00Z"), ix: storeIndexPooled(scratch), strictFields: true, slim: true,
    // only the readers this fixture does not hold in a store: the stance inbox, the mail and the world are REAL
    readers: { stakesFor: async () => ({ next_settlement: null, rows: [] }), alertsFor: async () => ({ alerts: [], unread: [] }), claimState: async () => null, likenessNeed: async () => ({ rows: [] }) } };
});

const callRead = (read, args) => householdApex({ read, args }, key, ctx);
/** The call a folded answer emits, as text → the dispatcher's own arguments. */
const argsOf = (call) => {
  const m = /household \{ read: "([a-z-]+)", args: \{ ([^}]*) \}/.exec(call);
  assert.ok(m, `a household read with args: ${call}`);
  const args = {};
  for (const part of m[2].split(/,\s*(?=[a-z]+:)/)) { const [k, ...v] = part.split(":"); args[k.trim()] = JSON.parse(v.join(":").trim()); }
  return [m[1], args];
};

test("R0 · the invented house is real: the world answers a large waiting inbox, and the unfolded answer is over the cap", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  assert.equal(w.read, "waiting", JSON.stringify(w).slice(0, 600));
  assert.ok(w.folded, `folded: ${JSON.stringify(w).slice(0, 300)}`);
  assert.ok(w.folded.full_bytes > 10000, `unfolded it was ${w.folded.full_bytes} bytes`);
  assert.ok(bytesOf(text(w)) <= 9000, `delivered ${bytesOf(text(w))}`);
  assert.equal(w.stances_awaiting.total, 30 + 18 + 9 + 25);
});

test("R1 · every group stub's open call, followed through the dispatcher, is deliverable and returns that group's marks, page by page", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  const opened = w.groups.filter((g) => "open" in g || g.act.includes('read: "stances"'));
  assert.ok(opened.length >= 3, `groups whose read is named: ${opened.map((g) => g.by)}`);
  let heavy = 0;
  for (const g of opened) {
    const [read, args] = argsOf(g.open ?? g.act);
    assert.equal(read, "stances");
    assert.deepEqual([args.by, args.over], [g.by, g.over]);
    const want = MARKS.filter((m) => m.by === g.by && m.id !== "x").map((m) => m.id);
    const seen = [];
    let cursor = null, pages = 0;
    do {
      const r = await callRead("stances", { ...args, ...(cursor ? { cursor } : {}) });
      const t = bytesOf(text(r));
      // only a page holding a mark whose own row outweighs half a page may exceed the cap (no limit narrows one row; the answer says limit: 1 reads it alone)
      if (!r.awaiting.some((row) => rowBytes(row) > HEAVY_ROW_BYTES)) assert.ok(t <= 10000, `${g.by} page ${pages}: ${t} bytes is over the connector's cap (limit ${args.limit})`);
      else heavy += 1;
      assert.ok(r.awaiting.length <= args.limit);
      for (const row of r.awaiting) { assert.equal(row.by, g.by); assert.equal(row.on_your_ground[0], g.over); seen.push(row.mark); }
      cursor = r.cursor; pages += 1;
      assert.ok(pages < 60, "the walk ends");
    } while (cursor);
    assert.deepEqual(seen.sort(), want.filter((id) => id.startsWith(`${g.by}/`)).sort(), `${g.by}: every mark of the group, once, across ${pages} page(s)`);
    assert.equal(seen.length, g.count, "and it is the count the answer gave");
    assert.ok(g.count <= args.limit || pages > 1, "several pages for a group that does not fit one");
    if (g.count > args.limit) assert.ok(pages > 1, `${g.by}: a group whose bodies do not fit one page takes several`);
  }
});

test("R2 · the walk and the cursor the answer names cover the marks no group names, bounded the same way", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  const named = new Set([...w.groups.map((g) => g.by), ...(w.groups_more?.listed ?? []).map((g) => g.by)]);
  const [read, args] = argsOf(w.groups_more.open);
  assert.equal(read, "stances");
  const seen = [];
  let cursor = null, pages = 0, heavyPages = 0;
  do {
    const r = await callRead("stances", { ...args, ...(cursor ? { cursor } : {}) });
    // a page is over the cap only where it carries one of the marks whose own row outweighs half a page (the 120-fold body of a stream's first mark): no limit can narrow a single row
    const heavy = r.awaiting.some((row) => rowBytes(row) > HEAVY_ROW_BYTES);
    if (!heavy) assert.ok(bytesOf(text(r)) <= 10000, `walk page ${pages}: ${bytesOf(text(r))} bytes (limit ${args.limit})`);
    else heavyPages += 1;
    for (const row of r.awaiting) seen.push(row);
    cursor = r.cursor; pages += 1;
    assert.ok(pages < 80, `limit ${args.limit} cursor ${cursor} rows ${seen.length} open ${w.groups_more.open.slice(0,90)}`);
  } while (cursor);
  assert.ok(heavyPages <= 3, `only pages holding a row heavier than a page may exceed it: ${heavyPages}`);
  const anonymous = w.groups_more.unlisted?.marks ?? 0;
  assert.ok(anonymous > 0, "the fixture leaves an anonymous tail");
  assert.equal(seen.length, 30 + 18 + 9 + 25, "the walk reaches every mark the inbox holds");
  assert.equal(seen.filter((r) => !named.has(r.by)).length, anonymous, "and the marks no group names are exactly the ones the answer counted as unlisted");
});

test("R3 · the bounce count's mail read lists those bounces, bounded", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  const p = w.unplaced_bounces;
  assert.equal(p.total, 40);
  assert.ok(p.shown < 40, "the answer cannot name them all");
  assert.deepEqual(p.by_resident, { r000: 40 });
  const [read, args] = argsOf(p.read.replace("<resident>", "r000").replace('handle: "r000"', 'handle: "r000"'));
  assert.equal(read, "mail");
  const r = await householdApex({ read: "mail", args: { view: "awaiting", handle: "r000" } }, key, ctx);
  assert.ok(bytesOf(text(r)) <= 10000, `${bytesOf(text(r))} bytes`);
  assert.equal(args.view, "awaiting");
  assert.ok(Array.isArray(r.unplaced_bounces) && r.unplaced_bounces.length > 0, "the bounces ride on it");
  assert.equal(r.unplaced_bounces_total, 40, "and it counts the same 40");
});
