// town-index-absent.test.mjs — every door that reads the town index answers
// from the store as it answered from office.db (POS-268 part 5a, POS-656).
//
//   node --test test/town-index-absent.test.mjs
//
// One office over one town and one record: a store seeded from the fixture
// town's rows. Every door that reads the town index (REST and MCP, keyed and
// keyless) must answer exactly as the unswitched office answered from office.db
// over the same rows, recorded in the last tree that had it (part 5a's sweep,
// helpers/twin-golden.mjs): the same status, the same body, the same
// x-postmark-as-of.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

import { putValues, fixtureTown } from "./fixture.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { twinGolden, steady } from "./helpers/twin-golden.mjs";
import { townClone, townModuleUrl } from "./fixture-paths.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs"; // POS-352: static keys are store rows
import { currentCrossing } from "../src/crossings.mjs"; // the town clock the manifest serves

// WLD-27's chest and candy doors ship dark (chests-candy.mjs), so these offices run dark, and the doorstep
// answers whose record is read with its `holds` stripped are named here (helpers/twin-golden.mjs § withoutHolds).
delete process.env.WORLD_CHESTS_CANDY;
const DARK = new Set(["REST /doorstep/wright", "REST /doorstep/wright (keyed)", "REST /doorstep/limen (keyed)",
  'MCP read_doorstep {"handle":"wright"}', 'MCP household {"read":"doorstep","handle":"wright"}']);

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TWINS = twinGolden("town-index-absent");
const tmp = mkdtempSync(join(tmpdir(), "town-index-absent-"));
const KEY = "absent-test-key";
// The town clone, when the tree has one: the quest board and the doorstep's next
// steps read the town's own quest tools from it, and without one they never
// reach the index rows they read (the quest registry, progress and standing).
const TOWN = townClone();
let store = null, skip = false;
const offices = {};

function office(name, env) {
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0",
    "--oauth-db", seedStaticKeys(join(tmp, `${name}-oauth.db`), `${KEY}=keemin:wright`), "--roles-db", join(tmp, `${name}-roles.db`)], {
    env: { ...process.env, TOWN_CLONE: TOWN ?? join(tmp, "no-clone-here"), WORLD_CLONE: join(tmp, "no-world-clone"),
      VOICES_LOG: join(tmp, `${name}-voices.jsonl`), TOWN_PUSH: "", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_READ_WORKERS: "0", WORLD2_PG: undefined, WORLD2_PG_URL: undefined, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let err = "";
  child.stderr.on("data", (d) => { err += String(d); });
  return new Promise((ok, no) => {
    const t = setTimeout(() => no(new Error(`${name}: the office never listened\n${err}`)), 20_000);
    child.stdout.on("data", (d) => {
      const m = /listening on :(\d+)/.exec(String(d));
      if (m) { clearTimeout(t); offices[name] = { child, base: `http://127.0.0.1:${m[1]}`, err: () => err }; ok(); }
    });
    child.on("exit", (c) => { clearTimeout(t); no(new Error(`${name}: the office exited early (${c})\n${err}`)); });
  });
}

before(async () => {
  store = await startStore({ db: "index_absent" });
  if (store.skip) { skip = store.skip; return; }
  const db = fixtureTown();
  if (TOWN) {
    const { townDay } = await import(townModuleUrl("tools", "quest-progress.mjs"));
    const put = (...v) => putValues(db, "meta", v);
    put("quest_registry", readFileSync(join(TOWN, "quest-registry.json"), "utf8"));
    put("quest_day", townDay());
    putValues(db, "quest_progress", ["wright", 2, 1, 1, 2, 1, JSON.stringify(["limen"]), JSON.stringify(["limen"])], ["handle", "send", "receive", "house_size", "house_send", "house_receive", "sent_to", "heard_from"]);
    putValues(db, "quest_standing", ["wright", JSON.stringify({ facts: { address: true }, since: {} })]);
  }
  const w = await store.connect("law_ingester");
  await seedTownIndex(w, db);
  await w.end();
  await office("absent", { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
});

after(async () => {
  for (const { child } of Object.values(offices)) {
    if (child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  }
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const keyed = { authorization: `Bearer ${KEY}` };

/** Where two answers first part (a JSON path and both values), or null when they are the same bytes. */
function firstDiff(a, b) {
  if (a === b) return null;
  let x, y;
  try { x = JSON.parse(a); y = JSON.parse(b); } catch { return { at: "(not JSON)", plain: a.slice(0, 300), absent: b.slice(0, 300) }; }
  // an MCP answer carries its result as JSON text; open it so the path names the field
  const open = (v) => (typeof v === "string" && /^s*[{[]/.test(v) ? (() => { try { return JSON.parse(v); } catch { return v; } })() : v);
  const walk = (u, v, at) => {
    u = open(u); v = open(v);
    if (u === v) return null;
    if (typeof u !== "object" || typeof v !== "object" || u === null || v === null || Array.isArray(u) !== Array.isArray(v))
      return { at, plain: JSON.stringify(u)?.slice(0, 300), absent: JSON.stringify(v)?.slice(0, 300) };
    const keys = [...new Set([...Object.keys(u), ...Object.keys(v)])];
    for (const k of keys) { const d = walk(u[k], v[k], `${at}.${k}`); if (d) return d; }
    const ko = JSON.stringify(Object.keys(u)), kv = JSON.stringify(Object.keys(v));
    return ko === kv ? null : { at: `${at} (key order)`, plain: ko, absent: kv };
  };
  return walk(x, y, "$") ?? { at: "(whitespace)", plain: a.slice(0, 120), absent: b.slice(0, 120) };
}
// THE ONE DELIBERATE TEXT CHANGE since the record (review-606): the manifest's
// freshness line said the index "rehydrates", which office.db did and the store
// does not. The record keeps what the twin said; this is the line it now says
// instead, and nothing else in that answer may move.
//
// AND THE HOUSE READ (POS-720, Darko 2026-10-19 22:17): household { read: "house" }
// is paged member rows by default now, and the twin's whole answer is the one
// args: { full: true } asks for, so that ask is held to the record's answer for
// the bare ask (RECORDED_AS). The read's line on the bare menu says so.
const CHANGED = {
  "REST /": [["rehydrates from the town repo every few minutes;", "the office's store re-reads the town repo every fifteen minutes;"]],
  "MCP household {}": [["every resident of a house in one answer, each under the doorstep's own names — household: <slug>",
    "a house's members, a row each, paged; full: true is the whole house — household: <slug>"],
    // POS-633 part 2: the stakes line shortened to make room, and the two deep reads on the menu
    ["your published MARKS and what stands behind each — the escrow on every one, which of them the next settlement would sweep (a commons mark holding ✦0) listed first with the stake that fixes it, and the settlement's time. Not the pot stake (do: \\\"stake\\\") and not your books (read: \\\"stamps\\\"); bare it is your whole house, handle: narrows to one resident", "your published MARKS and the escrow behind each, the ones the next settlement would sweep (a commons mark holding ✦0) first, with the stake that fixes it. Not the pot stake nor your books; bare it is your whole house, handle: narrows to one resident"],
    [`"posts":"the house's posts: what it put up, and others' it takes part in"`,
      `"posts":"the house's posts: what it put up, and others' it takes part in","closer":"who your house writes most, this fortnight","correspondents":"the same as closer","happened":"what your house did, newest first","waiting":"what waits on your word, grouped","marks":"your marks: by state, decided, at risk"`],
    // POS-672: a creature's afforded actions are world writes, charged on the same ledger as one verb
    ['"counted_verbs":["world_hold","world_describe"', '"counted_verbs":["world_hold","world_creature","world_describe"']],
  'MCP household {"read":"standing","handle":"wright"}': [['"counted_verbs":["world_hold","world_describe"', '"counted_verbs":["world_hold","world_creature","world_describe"']],
};
// AND THE GLANCE'S TWO FIELDS (POS-633): the household tool takes read_shape and
// since now, and the one recorded answer that lists the tool's fields says so.
CHANGED['MCP household {"read":"letter","id":"limen-2026-07-01-to-wright-the-gap"}'] = [["this tool takes: do, read, explain, args, handle, hide_bounces_older_than_days, view",
  "this tool takes: do, read, explain, args, handle, read_shape, since, hide_bounces_older_than_days, view"]];
// AND THE GLANCE'S BLOCKS AS READS (POS-633 round 4, Darko 2026-10-20 15:46): the bare menu's
// read table names `correspondents`, `waiting` and `marks` too (in the posts line's substitution above).
// AND THE STANCE IS A COUNTED WORLD WRITE (review of #678, item 2): the budget's counted_verbs names it last, in the
// two recorded answers that carry the budget, and nothing else in them moves.
for (const label of ["MCP household {}", 'MCP household {"read":"standing","handle":"wright"}'])
  (CHANGED[label] ??= []).push([`"world_unstake","world_walk"]`, `"world_unstake","world_walk","world_declare_stance"]`]);
const RECORDED_AS = {
  'MCP household {"read":"house","args":{"full":true}}': 'MCP household {"read":"house"}',
};
// THE TOWN CLOCK AT THE DOOR: the manifest serves crossing.number as
// currentCrossing() at the moment it answers (server.mjs § the manifest), so the
// record's number is the crossing it was made in, not the index's. The expected
// number is derived as the office derives it, from crossings.mjs, across the ask:
// the answer must name a crossing between the clock's reading before the ask and
// its reading after, and the record is held to that number; nothing else moves.
const CLOCKED = { "REST /": (a) => a?.body?.["<json>"]?.crossing };
// the twin's recorded answer under `label` (helpers/twin-golden.mjs), against this one;
// `asked` is the town clock's crossing read just before the ask
const same = (what, label, answer, asked = null) => {
  const got = steady(answer);
  let was = TWINS.of(RECORDED_AS[label] ?? label, { dark: DARK.has(label) });
  for (const [then, now] of CHANGED[label] ?? []) {
    assert.ok(was.includes(then), `${label}: the record no longer says "${then}", so this substitution is stale`);
    was = was.split(then).join(now);
  }
  const clocked = CLOCKED[label];
  if (clocked) {
    const after = currentCrossing();
    const rec = JSON.parse(was), live = JSON.parse(got);
    assert.ok(Number.isInteger(clocked(rec)?.number), `${label}: the record carries no crossing number, so this derivation is stale`);
    assert.ok(Number.isInteger(asked), `${label}: asked without the town clock's reading before the ask`);
    const n = clocked(live)?.number;
    assert.ok(Number.isInteger(n) && n >= asked && n <= after, `${what}: crossing.number ${n}, but the town clock read ${asked}..${after} across the ask`);
    clocked(rec).number = n;
    was = JSON.stringify(rec);
  }
  if (got === was) return;
  const d = firstDiff(was, got);
  assert.fail(`${what}: the answers part at ${d?.at}
  office.db: ${d?.plain}
  store:     ${d?.absent}`);
};

// The doors that read the town index: every family the store answers.
const REST = [
  ["/town"], ["/residents"], ["/residents?limit=1&offset=1"], ["/residents/wright"], ["/residents/limen"], ["/residents/nobody"],
  ["/repo/log"], ["/repo/log?path=WHITE_PAGES/"], ["/regions"], ["/regions/the-terrace"], ["/regions/nowhere"],
  ["/bulletin"], ["/bulletin/settling-in"], ["/bulletin/nope"], ["/homes/wright"], ["/homes/nobody"],
  ["/stamps"], ["/stamps/wright"], ["/stamps/nobody"], ["/quests/wright"],
  ["/letters"], ["/letters/limen-2026-07-01-to-wright-the-gap"], ["/letters/limen-2026-07-01-to-wright-the-gap", keyed], ["/letters/nope"],
  ["/mail/wright", keyed], ["/mail/wright?box=outbox", keyed], ["/mail/limen", keyed],
  ["/search?q=gap"], ["/search?q=wright&kind=residents"], ["/metrics/mail"], ["/town/ledger"], ["/town/docs"],
  ["/doorstep/wright"], ["/doorstep/wright", keyed], ["/doorstep/limen", keyed], ["/doorstep/nobody", keyed],
  ["/me", keyed],
  // what the site's build and the sentinel ask beyond the index doors (fetch-town-data, site-sentinel)
  ["/"], ["/households"],
];

// Asked by the site's build too, but stamped with the wall clock at each answer
// (the calendar's as_of, /ops/heard's since), so only their status is compared.
const REST_STATUS_ONLY = ["/calendar", "/posts?class=quest", "/ops/heard"];

// The same families over MCP, through the one dispatch every MCP door shares.
const MCP = [
  ["read_town", {}], ["list_residents", {}], ["read_resident", { handle: "wright" }], ["list_mail", { handle: "wright" }],
  ["list_letters", {}], ["read_letter", { id: "limen-2026-07-01-to-wright-the-gap" }], ["search_town", { q: "gap" }],
  ["list_commits", {}], ["list_regions", {}], ["read_home", { handle: "wright" }], ["read_bulletin", {}], ["read_stamps", {}],
  ["read_stamps", { handle: "wright" }], ["read_quests", { handle: "wright" }], ["read_metrics", {}], ["read_docs", {}],
  ["read_doorstep", { handle: "wright" }], ["whoami", {}],
  ["household", {}], ["household", { read: "stamps" }], ["household", { read: "quests" }], ["household", { read: "fund" }],
  ["household", { read: "doorstep", handle: "wright" }], ["household", { read: "house", args: { full: true } }], ["household", { read: "needs-you" }],
  ["household", { read: "mail", handle: "wright" }], ["household", { read: "letter", id: "limen-2026-07-01-to-wright-the-gap" }],
  ["household", { read: "standing", handle: "wright" }], ["household", { read: "home", handle: "wright" }], ["household", { read: "window", handle: "wright" }],
  ["town", {}], ["town", { read: "town" }], ["town", { read: "residents" }], ["town", { read: "resident", args: { handle: "limen" } }],
  ["town", { read: "letters" }], ["town", { read: "letter", args: { id: "limen-2026-07-01-to-wright-the-gap" } }], ["town", { read: "search", args: { q: "gap" } }],
  ["town", { read: "commits" }], ["town", { read: "regions" }], ["town", { read: "home", args: { handle: "wright" } }],
  ["town", { read: "bulletin" }], ["town", { read: "stamps" }], ["town", { read: "metrics" }], ["town", { read: "quests" }], ["town", { read: "docs" }],
];

async function rest(name, door, headers = {}) {
  const r = await fetch(offices[name].base + door, { headers });
  return { status: r.status, asOf: r.headers.get("x-postmark-as-of"), body: await r.text() };
}

async function mcp(name, tool, args) {
  const r = await fetch(offices[name].base + "/mcp", {
    method: "POST",
    headers: { ...keyed, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } }),
  });
  return { status: r.status, body: await r.text() };
}

test("every index door answers as the unswitched office did: status, body and as-of", async (t) => {
  if (skip) return t.skip(skip);
  for (const [door, headers] of REST) {
    const asked = currentCrossing();
    const b = await rest("absent", door, headers);
    const what = `${door}${headers ? " (keyed)" : ""}`;
    same(what, `REST ${door}${headers ? " (keyed)" : ""}`, b, asked);
  }
  for (const door of REST_STATUS_ONLY) {
    const b = await rest("absent", door);
    assert.equal(b.status, JSON.parse(TWINS.of(`REST ${door}`)).status, `${door}: status (said ${b.body.slice(0, 300)})`);
  }
});

test("every MCP index read answers as the unswitched office did", async (t) => {
  if (skip) return t.skip(skip);
  for (const [tool, args] of MCP) {
    const b = await mcp("absent", tool, args);
    same(`${tool} ${JSON.stringify(args)}`, `MCP ${tool} ${JSON.stringify(args)}`, b);
  }
});
