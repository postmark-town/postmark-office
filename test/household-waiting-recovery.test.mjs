// household-waiting-recovery.test.mjs — CORE-88: the calls a folded waiting answer names recover what it folded.
//
// Truey's review (PR #1029) and Wright's Settled 2026-11-14 07:23Z: a stub whose read cannot open its group under the cap is
// not a stub. So this file does not check that a read NAME exists: it FOLLOWS each emitted call through the real dispatcher
// (householdApex) over a real world, a real holding record and the real index, measures every page in the connector's own text,
// walks the cursors, and matches the recovered identities and counts to the source.
//
//   R0  the invented house is large: the unfolded waiting answer is over the cap, the folded one is not, every contributor counts;
//   R1  every group's open call: that group's marks, every mark once, each page under the cap;
//   R2  the walk: every mark the inbox holds, reached once, the unnamed tail included;
//   R3  EVERY contributor (set-downs, takes from the real holding record; bounces from the real index; key asks, likeness, at-risk,
//       alerts from their producers): the identities shown plus the identities its emitted call pages are exactly the source's;
//   R4  an answer that fits is the read's own, untouched (the real stances derivation, deep-equal); one that does not is paged;
//   R5  unavailable survives the skeleton and the pages.
//
// The world, the house and the holding acts are invented; no credential, no founder read.
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

// ── the world in a bottle: r000's big parcel, marks laid over it, and things r000's house made ─────
const repo = join(scratch, "world");
mkdirSync(repo, { recursive: true });
const put = (p, t) => { const f = join(repo, p); mkdirSync(dirname(f), { recursive: true }); writeFileSync(f, t); };
const git = (...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });

// a body that is not ASCII (a mark's body is ≤ 150 characters by the class grammar, world.mjs)
const bodyOf = (tag, n = 3) => `${tag} ${"庭の柵 café 🌱 ".repeat(n)}`.trim().slice(0, 150);
const STREAMS = [["kiln-keeper", 32], ["mossmere", 18], ["brook", 9]];
const SOLOS = 25;
const SETDOWNS = 25, TAKES = 12, BOUNCES = 40, AT_RISK = 60, ALERTS = 20;
const MARKS = [
  { id: "the-town/let-there-be-light", by: "the-town", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 10000, h: 10000 }, date: "2026-07-01", body: "the world frame" },
  { id: "r000/big-parcel", by: "r000", kind: "parcel", at: { x: 100, y: 100 }, extent: { w: 400, h: 400 }, date: "2026-08-01", body: "r000's ground" },
  { id: "r001/orchard-parcel", by: "r001", kind: "parcel", at: { x: 1000, y: 1000 }, extent: { w: 400, h: 400 }, date: "2026-08-01", body: "r001's ground" },
];
let day = 0;
for (const [by, n] of STREAMS) for (let i = 0; i < n; i++)
  MARKS.push({ id: `${by}/stone-${i}`, by, kind: "sited", at: { x: 100 + (i % 20) * 3, y: 100 + (day % 50) }, extent: { w: 2, h: 2 }, date: `2026-09-${String(1 + (day++ % 28)).padStart(2, "0")}`, body: bodyOf(`${by} ${i}`) });
for (let i = 0; i < SOLOS; i++) MARKS.push({ id: `solo-${String(i).padStart(2, "0")}/pebble`, by: `solo-${String(i).padStart(2, "0")}`, kind: "sited", at: { x: 1000 + i * 3, y: 1000 }, extent: { w: 2, h: 2 }, date: `2026-10-${String(1 + (i % 28)).padStart(2, "0")}`, body: bodyOf(`solo ${i}`) });
// the things r000's house made: others take them, or set them down
const THINGS = Array.from({ length: SETDOWNS + TAKES }, (_, i) => `r000/thing-${String(i).padStart(2, "0")}`);
for (const id of THINGS) MARKS.push({ id, by: "r000", kind: "thing", at: { x: 5000, y: 5000 }, extent: { w: 1, h: 1 }, date: "2026-09-02", body: bodyOf(id, 1) });

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
let householdApex, contentFor, ctx, stancesForHandles, PAGE_BYTES, CAP_BYTES, pen;
const cleanups = [];
// a hook's own `after` would run when the hook ends, so the cleanups wait here, at the file's end
after(async () => { for (const c of cleanups.reverse()) await c(); });
// every page this file follows, with its delivered text size (WAITING_PAGES=<file> writes them out, for the Build)
const MEASURED = [];
after(() => { if (process.env.WAITING_PAGES) writeFileSync(process.env.WAITING_PAGES, JSON.stringify(MEASURED, null, 1)); });
const bytesOf = (s) => Buffer.byteLength(s, "utf8");
const text = (answer) => contentFor(answer)[0].text;

// the producers' own shapes, built by alerts.mjs and needs-you's readers
let ALERT_ROWS, ATRISK_ROWS;
before(async () => {
  ({ householdApex } = await import("../src/household-apex.mjs"));
  ({ contentFor } = await import("../src/mcp.mjs"));
  ({ stancesForHandles } = await import("../src/world-stance.mjs"));
  ({ PAGE_BYTES, CAP_BYTES } = await import("../src/household-read-page.mjs"));
  const { installActsPen, uninstallActsPen, RECORD_ON } = await import("./acts-pen-stub.mjs");
  const { useGuardReader } = await import("../src/world2-guards.mjs");
  const { actsClient } = await import("./stands-store-fixture.mjs");
  const { rowsFromRegistry } = await import("../src/registry-rows.mjs");
  const { STANCE_ON, stancePoolFromJournal } = await import("./stance-pool-stub.mjs");
  const { putValues, emptyTown } = await import("./fixture.mjs");
  const { indexStore } = await import("./helpers/office-under-test.mjs");
  const { storeIndexPooled } = await import("../src/town-index-store.mjs");
  const { markTakenAlerts, sortAlerts } = await import("../src/alerts.mjs");

  Object.assign(process.env, STANCE_ON, RECORD_ON);
  // the record's pen: the registry (this house), and the holding acts the real keeper folds
  const REG = rowsFromRegistry({ households: { [HOUSE]: { residents: ["r000", "r001"], accounts: [{ login: "rec", id: 1 }] } } }, {});
  pen = installActsPen({ households: REG.households });
  // the keeper's holding reads (world-kinds.mjs § keeper) answered from the acts this pen holds, filtered and ordered as the real SQL does
  const written = () => pen.rows().map((r) => ({ ...r, at: new Date(r.at), payload: typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload }));
  const unread = useGuardReader((run) => run(actsClient(written())));
  stancePoolFromJournal(dbPath);
  let at = Date.parse("2026-11-13T00:00:00Z");
  const hold = (actor, action, thing) => pen.seedAct({ class: "holding", actor, action, object: thing, at: new Date((at += 1000)),
    payload: { thing, holder: actor, previous_holder: null, made_by: "r000", policy: "cascade" } });
  THINGS.forEach((thing, i) => { hold(`out-${i}`, "take", thing); if (i < SETDOWNS) hold(`out-${i}`, "drop", thing); });
  cleanups.push(() => { unread(); uninstallActsPen(); delete process.env.WORLD2_STANCE_URL; delete process.env.WORLD2_PG; delete process.env.WORLD2_PG_URL; });

  const town = emptyTown();
  putValues(town, "meta", ["as_of", AS_OF]);
  putValues(town, "meta", ["town_path", "fixture"]);
  putValues(town, "meta", ["hydrated_counts", JSON.stringify({})]);
  for (const h of ["r000", "r001"]) putValues(town, "residents", [h, JSON.stringify({ handle: h, is_office: false, last_active: "2026-11-10T10:00:00.000Z", address: { data: { since: "2026-01-01", joined: "2026-06-10" } } })]);
  // r000 wrote letters that never arrived (the mail law's own `unplaced_bounces`)
  putValues(town, "mail_state", ["r000", JSON.stringify({
    handle: "r000", language: "sequence, never debt", conversations: [],
    unplaced_bounces: Array.from({ length: BOUNCES }, (_, i) => ({ date: "2026-10-01", path: `WHITE_PAGES/r000/outbox/${i}.md`, reason: `no resident "ghost-${i}"` })),
    summary: { they_spoke_last: 0, new_inbound: 0, they_spoke_again: 0, reply_queued: 0, last_word_yours: 0, bounced: BOUNCES },
  })]);
  const ix = await indexStore(town, { db: "waiting_recovery" });
  const restore = await ix.useInProcess();
  cleanups.push(async () => { await restore(); await ix.stop(); });

  const now = new Date("2026-11-14T06:00:00Z");
  ALERT_ROWS = sortAlerts(markTakenAlerts(Array.from({ length: ALERTS }, (_, i) => ({ slug: `r000/old-${String(i).padStart(2, "0")}`, owner: "r000", body: bodyOf(`alert ${i}`, 4), opens_at: "2026-11-13T12:00:00.000Z" })), now));
  ATRISK_ROWS = Array.from({ length: AT_RISK }, (_, i) => ({ mark: `r000/shed-${String(i).padStart(2, "0")}`, class: "commons", escrow: 0, at_risk: true, body: bodyOf(`shed ${i}`) }));
  ctx = { clone: scratch, asOf: AS_OF, odb: { fixture: true }, nowMs: now.getTime(), ix: storeIndexPooled(scratch), strictFields: true, slim: true,
    // the stance inbox, the holding record, the mail and the world are REAL; these four have a producer of their own that needs the store
    readers: {
      stakesFor: async () => ({ next_settlement: { at: "2026-11-15T00:00:00.000Z" }, rows: ATRISK_ROWS }),
      alertsFor: async () => ({ alerts: ALERT_ROWS, unread: [] }),
      claimState: async (_odb, h) => { if (ctx.keyAsksThrow) throw new Error("key store down"); return { cosigned: false, asks_standing: `2026-11-1${h === "r000" ? 1 : 2}` }; },
      likenessNeed: async () => ({ rows: [{ household: HOUSE, residents: ["r000"], cause: "the house's human has not said whether the town may use their likeness", link: "https://example.invalid/likeness", hand_it_over: "give it to your human" }] }),
    } };
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
/** Follow a call and its cursors to the end; every page measured in the connector's own text. Returns the rows and the page sizes. */
async function walk(call, { rowsOf }) {
  const [read, args0] = argsOf(call);
  const rows = [], sizes = [];
  let args = args0;
  for (let i = 0; i < 200; i++) {
    const r = await callRead(read, args);
    assert.ok(!r.error, `a page: ${JSON.stringify(r).slice(0, 300)}`);
    const n = bytesOf(text(r));
    sizes.push(n);
    MEASURED.push({ call: `${read} ${JSON.stringify(args)}`, bytes: n });
    assert.ok(n <= PAGE_BYTES && n < CAP_BYTES, `${call} page ${i}: ${n} bytes`);
    rows.push(...rowsOf(r));
    if (r.complete === true || r.cursor == null) return { rows, sizes };
    args = { ...args, cursor: r.cursor };
  }
  assert.fail(`${call}: the walk did not end`);
}

test("R0 · the invented house is large: unfolded over the cap, folded under it, every contributor counted", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  assert.equal(w.read, "waiting", JSON.stringify(w).slice(0, 600));
  assert.ok(w.folded, "folded");
  assert.ok(w.folded.full_bytes > CAP_BYTES * 3, `unfolded it was ${w.folded.full_bytes} bytes`);
  const n = bytesOf(text(w));
  assert.ok(n <= 9000, `delivered ${n} bytes`);
  const marks = 32 + 18 + 9 + SOLOS;
  assert.equal(w.stances_awaiting.total, marks);
  const got = { set_downs_awaiting: w.set_downs_awaiting.total, takes_awaiting: w.takes_awaiting.total, unplaced_bounces: w.unplaced_bounces.total, key_asks: w.key_asks.total,
    likeness_question: w.likeness_question.total, stakes_at_risk: w.stakes_at_risk.total, alerts: w.alerts.total };
  assert.deepEqual(got, { set_downs_awaiting: SETDOWNS, takes_awaiting: TAKES, unplaced_bounces: BOUNCES, key_asks: 2, likeness_question: 1, stakes_at_risk: AT_RISK, alerts: ALERTS });
  assert.equal(w.count, marks + SETDOWNS + TAKES + BOUNCES + 2 + 1 + AT_RISK + ALERTS, "count is the house's, every contributor");
});

test("R1 · every group's open call, followed, returns that group's marks, every mark once, each page under the cap", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  let followed = 0;
  for (const g of w.groups) {
    const call = g.open ?? g.act.split(", then")[0];
    if (!/read: "stances"/.test(call)) continue;
    followed += 1;
    const { rows, sizes } = await walk(call, { rowsOf: (r) => r.awaiting });
    const want = MARKS.filter((m) => m.id.startsWith(`${g.by}/`)).map((m) => m.id).sort();
    assert.deepEqual(rows.map((r) => r.mark).sort(), want, `${g.by}: every mark of the group, once`);
    assert.equal(rows.length, g.count);
    assert.ok(rows.every((r) => r.on_your_ground[0] === g.over));
    assert.ok(Math.max(...sizes) <= PAGE_BYTES);
  }
  assert.ok(followed >= 3, `${followed} group reads followed`);
});

test("R2 · the walk reaches every mark the inbox holds, the unnamed tail included, each page under the cap", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  const named = new Set([...w.groups.map((g) => g.by), ...(w.groups_more?.listed ?? []).map((g) => g.by)]);
  const { rows, sizes } = await walk('household { read: "stances", args: { limit: 100 } }', { rowsOf: (r) => r.awaiting });
  const total = 32 + 18 + 9 + SOLOS;
  assert.equal(rows.length, total);
  assert.equal(new Set(rows.map((r) => r.mark)).size, total, "each once");
  assert.ok(sizes.length > 1, `it took ${sizes.length} pages`);
  assert.equal(rows.filter((r) => !named.has(r.by)).length, w.groups_more.unlisted?.marks ?? 0, "the marks no group names are exactly the unlisted count");
});

test("R3 · every contributor: the identities shown plus the identities its emitted call pages are exactly the source's", async () => {
  const w = await householdApex({ read: "waiting" }, key, ctx);
  const SRC = {
    set_downs_awaiting: { ids: THINGS.slice(0, SETDOWNS), of: (r) => r.thing },
    takes_awaiting: { ids: THINGS.slice(SETDOWNS), of: (r) => r.thing },
    unplaced_bounces: { ids: Array.from({ length: BOUNCES }, (_, i) => `WHITE_PAGES/r000/outbox/${i}.md`), of: (r) => r.path },
    key_asks: { ids: ["r000", "r001"], of: (r) => r.handle },
    likeness_question: { ids: [HOUSE], of: (r) => r.household },
    stakes_at_risk: { ids: ATRISK_ROWS.map((r) => r.mark), of: (r) => r.mark },
    alerts: { ids: ALERT_ROWS.map((r) => r.about.mark), of: (r) => r.about?.mark },
  };
  let paged = 0;
  for (const [part, { ids, of }] of Object.entries(SRC)) {
    const p = w[part];
    assert.equal(p.total, ids.length, `${part}: the source's count`);
    const shown = p.rows.map(of);
    let recovered = [];
    if (p.shown < p.total) {
      paged += 1;
      assert.equal(p.rows_not_shown, p.total - p.shown);
      const { rows } = await walk(p.read, { rowsOf: (r) => r.rows });
      recovered = rows.map(of);
      assert.equal(recovered.length, p.total - p.shown, `${part}: the call pages exactly the rows not shown (from its cursor)`);
    }
    assert.deepEqual([...shown, ...recovered].sort(), [...ids].sort(), `${part}: no item lost, none twice`);
  }
  assert.ok(paged >= 5, `the fixture makes ${paged} parts overflow`);
});

test("R4 · an answer that fits is the read's own, untouched; one that does not comes in pages", async () => {
  // the real derivation, trimmed of the lists that make it big: it fits, and the door returns exactly what the derivation built
  const trimmed = async (...a) => ({ ...(await stancesForHandles(...a)), set_downs_awaiting: [], awaiting_your_word: undefined, standing: [], ground: [] });
  const small = await householdApex({ read: "stances", args: { by: "solo-03" } }, key, { ...ctx, readers: { ...ctx.readers, stances: trimmed } });
  const direct = await trimmed(["r000", "r001"], { cursor: null, limit: undefined, by: "solo-03", over: null, setDowns: true });
  assert.equal(small.awaiting.length, 1);
  assert.ok(bytesOf(text(direct)) <= PAGE_BYTES, "it fits");
  assert.deepEqual(small, direct, "the same object the derivation built");
  assert.equal(text(small), text(direct), "and the same delivered bytes");
  // the real holding record makes the bare read big: the marks page that fits, its context counted and read by part
  const bare = await callRead("stances", {});
  assert.ok(bytesOf(text(bare)) <= PAGE_BYTES);
  assert.ok(bare.context && !("teach" in bare) && !("ground" in bare), "the context is counted and read by part");
  assert.equal(bare.context.set_downs.total, SETDOWNS);
  assert.equal(bare.context.takes.total, TAKES);
  // and needs-you, bare, is its parts counted
  const needs = await callRead("needs-you", {});
  assert.ok(bytesOf(text(needs)) <= PAGE_BYTES);
  assert.ok(needs.paged && needs.alerts.total === ALERTS && needs.stakes_at_risk.total === AT_RISK);
});

test("R5 · unavailable survives the skeleton and the pages", async () => {
  ctx.keyAsksThrow = true;
  try {
    const needs = await callRead("needs-you", {});
    assert.match(needs.key_asks.unavailable, /could not be read/);
    const page = await callRead("needs-you", { part: "key_asks" });
    assert.match(page.unavailable, /could not be read/, "and on its page");
    assert.equal(page.total, 0, "unreadable is not none, and not cut");
    const w = await householdApex({ read: "waiting" }, key, ctx);
    assert.match(w.key_asks.unavailable, /could not be read/);
  } finally { ctx.keyAsksThrow = false; }
});
