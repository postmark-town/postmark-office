// call-shape.test.mjs — the access line carries every call's SHAPE and never
// its content (POS-722, Darko 2026-10-19 22:32).
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/call-shape.test.mjs
//
// THE PRIVACY LINE IS ABSOLUTE: no string value from any argument may reach the
// log. So the first half plants one sentinel in every value of every field the
// three apexes declare (and in the envelope's act fields, the act and read
// names, arrays and nested objects), and reads the WHOLE line for it. The
// second half boots a real office with its access log in a temp dir, calls it
// through MCP (main thread and read worker) and through each REST apex, and
// reads the lines the office itself wrote.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { bounded, callShape, finishCall, meterOut, methodForLog, replyBounce, queryArgs, CALL_MAX, KEYS_MAX } from "../src/call-shape.mjs";
import { accessLine, LINE_MAX } from "../src/telemetry.mjs";
import { APEX_TOOL } from "../src/world-apex.mjs";
import { HOUSEHOLD_TOOL, HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";
import { HOUSEHOLD_LINES, TOWN_LINES } from "../src/door-read-shape.mjs";
import { TOOLS } from "../src/mcp.mjs";
import { TOWN_TOOL } from "../src/town-apex.mjs";
import { fixtureTown } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { seedStaticKeys } from "./helpers/static-keys.mjs";
import { removeTempDir, tempDir } from "./helpers/temp-dir.mjs";

// Lowercase and dashed: a well-formed field name, so as a KEY only the
// allowlist of declared names keeps it off the line, and as a value only the
// rule that no value is copied.
const SENTINEL = "zq-sentinel-7c1f";
const bytes = (s) => Buffer.byteLength(s, "utf8");
const lineOf = (call, over = {}) => accessLine({ ts: "2026-10-19T22:32:00.000Z", ip: "127.0.0.1", method: "POST", path: "/mcp",
  status: 200, ms: 3, ua: "test", household: "keemin", mcp: "household", call, ...over });

/** Every declared field of `tool`, each carrying the sentinel in the shape its schema names. */
function poisoned(tool) {
  const args = {};
  for (const [name, spec] of Object.entries(tool.inputSchema.properties)) {
    if (spec.type === "object") args[name] = { body: SENTINEL, to: SENTINEL, title: SENTINEL, handle: SENTINEL, mark: SENTINEL,
      slug: SENTINEL, stance: SENTINEL, class: SENTINEL, id: SENTINEL, list: [SENTINEL, SENTINEL], deep: { more: SENTINEL }, n: 7319 };
    else if (spec.type === "array") args[name] = [SENTINEL];
    else args[name] = SENTINEL;
  }
  return args;
}

test("A SENTINEL IN EVERY ARGUMENT NEVER REACHES THE LINE, at all three apexes and a flat tool", () => {
  for (const [name, tool] of [["world", APEX_TOOL], ["household", HOUSEHOLD_TOOL], ["town", TOWN_TOOL]]) {
    const call = callShape(name, poisoned(tool));
    const line = lineOf(finishCall({ call, out_bytes: 1234 }, 422));
    assert.ok(!line.includes(SENTINEL), `${name}: the sentinel reached the line: ${line}`);
    assert.equal(call.do, "other", `${name}: an unknown act is "other"`);
    assert.equal(call.read, "other", `${name}: an unknown read is "other"`);
    // every enum the call names read the sentinel as "other", never as itself
    for (const v of Object.values(call.enums ?? {})) assert.equal(v, "other");
  }
  const flat = callShape("send_letter", { from: SENTINEL, to: SENTINEL, title: SENTINEL, body: SENTINEL, thread: SENTINEL });
  assert.ok(!lineOf(flat).includes(SENTINEL));
  assert.deepEqual(flat.keys, ["body", "from", "thread", "title", "to"], "the names are kept: the shape is the point");
  // a tool name the office does not answer is the caller's text too
  assert.equal(callShape(SENTINEL.toUpperCase(), {}).tool, "other");
});

test("the shape: known act and read names, field names, focus, fixed-set values", () => {
  const send = callShape("household", { do: "send", handle: "wright", args: { from: "wright", to: "shipped", title: "t", body: "b" } });
  assert.deepEqual(send, { tool: "household", do: "send", keys: ["args", "args.body", "args.from", "args.title", "args.to", "do", "handle"] },
    "a letter's recipient is never an enum, even when the handle spells a stage");
  const advance = callShape("town", { do: "advance", args: { post: "bug/42", to: "shipped", credit: "x" } });
  assert.deepEqual(advance.enums, { to: "shipped" }, "at the town door `to` is a stage");
  assert.equal(callShape("town", { do: "advance", args: { to: "wright" } }).enums.to, "other");
  const house = callShape("household", { read: "house", view: "inbox", explain: true });
  assert.deepEqual(house, { tool: "household", read: "house", focus: { explain: true }, keys: ["explain", "read", "view"], enums: { view: "inbox" } });
  const look = callShape("world", { mark: "a/b", since: "c1", read_shape: "v2", cards: "names", args: { depth: 2 } });
  assert.deepEqual(look.focus, { mark: true, since: true, depth: true });
  assert.deepEqual(look.enums, { read_shape: "v2", cards: "names" });
  assert.equal(callShape("world", { read: "happened" }).read, "happened", "a v2 block read is a known read");
  assert.equal(callShape("world", { read: "find" }).read, "find");
  assert.equal(callShape("world", { do: "leave-mark" }).do, "leave-mark");
  assert.equal(callShape("household", { explain: false }).focus, undefined, "explain: false asks for nothing");
});

test("AN UNKNOWN READ NAME LOGS AS \"other\"", () => {
  assert.equal(callShape("household", { read: "nonesuch" }).read, "other");
  assert.equal(callShape("world", { read: "Bulletin" }).read, "other");
  assert.equal(callShape("town", { read: "house" }).read, "other", "a household read is not a town read");
  assert.equal(callShape("household", { read: 42 }).read, "other", "a number is no name");
});

test("A HUGE PAYLOAD DOES NOT GROW THE LINE", () => {
  const small = lineOf(callShape("household", { do: "send", args: { from: "a", to: "b", title: "c", body: "d" } }));
  const huge = lineOf(callShape("household", { do: "send", args: { from: "a".repeat(1e5), to: "b".repeat(1e5), title: "c".repeat(1e5), body: "d".repeat(2e6) } }));
  assert.equal(bytes(huge), bytes(small), "a value's length is never measured into the line");
  // a flood of undeclared names is only counted
  const names = {};
  for (let i = 0; i < 5000; i++) names[`field_${String(i).padStart(4, "0")}_${"x".repeat(20)}`] = SENTINEL;
  const flood = callShape("world", { ...names, args: names });
  assert.equal(flood.keys_other, 10000);
  assert.ok(bytes(lineOf(flood)) + 1 <= LINE_MAX);
  // the declared names are capped, and the widest real call (every focus, every
  // enum, an act and a read, the longest declared names) stays under the bound
  const longest = [...declared()].sort((a, b) => b.length - a.length).slice(0, 40);
  const tidy = callShape("world", { args: Object.fromEntries(longest.map((k) => [k, 1])) });
  assert.equal(tidy.keys.length, KEYS_MAX);
  assert.equal(tidy.keys_more, 41 - KEYS_MAX, "the 40 names and the envelope itself");
  const widest = { do: "declare-stance-on", read: "declare-stance-on", read_shape: "x", view: "x", cards: "x", as: "x", stance: "x",
    mark: 1, find: 1, investigate: 1, explain: 1, since: 1, depth: 1, args: Object.fromEntries(longest.map((k) => [k, 1])) };
  const full = finishCall({ call: callShape("world", widest), out_bytes: 123456789 }, 503);
  assert.ok(bytes(JSON.stringify(full)) <= CALL_MAX, `the widest real call is ${bytes(JSON.stringify(full))} bytes`);
});

test("THE BOUND HOLDS PAST THE CAPS: a call over CALL_MAX drops its field names and says so", () => {
  // No declared name reaches it today (the widest real call is ~700 bytes); the
  // check is what keeps the line bounded the day a cap or a schema grows.
  const over = { tool: "world", do: "send", keys: Array.from({ length: 40 }, (_, i) => `args.${"n".repeat(28)}${i}`), out_bytes: 1, bounce: 503 };
  const b = bounded(over);
  assert.ok(bytes(JSON.stringify(b)) <= CALL_MAX, `${bytes(JSON.stringify(b))} bytes`);
  assert.deepEqual(b, { tool: "world", do: "send", out_bytes: 1, bounce: 503, keys_dropped: true });
  const under = { tool: "world", keys: ["mark"] };
  assert.equal(bounded(under), under, "an ordinary call passes through as the same object");
});

/** Every field name the tools' own schemas declare, gathered here apart from call-shape.mjs. */
function declared() {
  const names = new Set();
  const walk = (s) => { if (!s || typeof s !== "object") return; if (s.properties) for (const [k, v] of Object.entries(s.properties)) { names.add(k); walk(v); } if (s.items) walk(s.items); };
  for (const t of [APEX_TOOL, HOUSEHOLD_TOOL, TOWN_TOOL, ...TOOLS]) walk(t.inputSchema);
  return names;
}

test("KEY NAMES ARE ALLOWLISTED: a name the office does not declare is counted, never written", () => {
  const call = callShape("household", { do: "send", [SENTINEL]: 1, "has space": 1, args: { [SENTINEL]: 1, "jane-at-42-elm-st": 1, from: "a", body: "b" } });
  const line = lineOf(finishCall({ call }, 200));
  assert.ok(!line.includes(SENTINEL) && !line.includes("jane"), `a caller's key reached the line: ${line}`);
  assert.deepEqual(call.keys, ["args", "args.body", "args.from", "do"]);
  assert.equal(call.keys_other, 4);
  // every act field the doors' own one-liners name (door-read-shape.mjs, held against the schemas there) is kept
  for (const [act, card] of Object.entries({ ...HOUSEHOLD_LINES, ...TOWN_LINES })) {
    for (const f of card.fields.map((x) => x.replace(/\?$/, "")).filter((x) => /^[a-z_]+$/.test(x))) {
      const c = callShape(act in HOUSEHOLD_LINES ? "household" : "town", { do: act, args: { [f]: 1 } });
      assert.ok(c.keys?.includes(`args.${f}`), `${act}: its field ${f} is not kept (${JSON.stringify(c)})`);
    }
  }
  // and every household read's own fields
  for (const [read, fields] of Object.entries(HOUSEHOLD_READ_FIELDS)) for (const f of Object.keys(fields)) {
    assert.ok(callShape("household", { read, args: { [f]: 1 } }).keys.includes(`args.${f}`), `read ${read}: ${f} is not kept`);
  }
});

test("a sentinel in every household read's fields and in every enum, at both levels, never reaches the line", () => {
  for (const [read, fields] of Object.entries(HOUSEHOLD_READ_FIELDS)) {
    const planted = Object.fromEntries(Object.keys(fields).map((f) => [f, SENTINEL]));
    const call = callShape("household", { read, ...planted, args: planted });
    assert.ok(!lineOf(call).includes(SENTINEL), `read ${read}: ${lineOf(call)}`);
  }
  const ENUM_FIELDS = ["read_shape", "view", "cards", "as", "stance", "class", "to"];
  for (const tool of ["world", "household", "town"]) {
    for (const at of ["top", "args"]) {
      const values = Object.fromEntries(ENUM_FIELDS.map((f) => [f, SENTINEL]));
      const call = callShape(tool, at === "top" ? values : { args: values });
      assert.ok(!lineOf(call).includes(SENTINEL), `${tool} ${at}: ${lineOf(call)}`);
      assert.ok(Object.keys(call.enums ?? {}).length >= 5, `${tool} ${at}: the enums were read (${JSON.stringify(call.enums)})`);
      for (const v of Object.values(call.enums)) assert.equal(v, "other");
    }
  }
});

test("the `mcp` field's word for a JSON-RPC method: a known one, else \"other\"", () => {
  for (const m of ["initialize", "tools/list", "tools/call", "ping", "notifications/initialized", "resources/list"]) assert.equal(methodForLog(m), m);
  assert.equal(methodForLog(SENTINEL), "other");
  assert.equal(methodForLog(`notifications/${SENTINEL}`), "other");
  assert.equal(methodForLog(undefined), "other");
});

test("the REST query: args= is read for its names only", () => {
  const q = queryArgs(new URLSearchParams({ read: "leave-mark", args: JSON.stringify({ mark: SENTINEL }), handle: SENTINEL }));
  const call = callShape("world", q);
  assert.deepEqual(call.keys, ["args", "args.mark", "handle", "read"]);
  assert.ok(!JSON.stringify(call).includes(SENTINEL));
});

test("an MCP answer's refusal code, read from the answer and never its words", () => {
  const answer = (body, isError) => JSON.stringify({ jsonrpc: "2.0", id: 1, result: { content: [{ type: "text", text: JSON.stringify(body, null, 1) }], isError } });
  assert.equal(replyBounce(answer({ error: "bounce", code: 422, defect: SENTINEL }, true)), 422);
  assert.equal(replyBounce(answer({ error: "bounce", defect: SENTINEL }, true)), true, "a refusal with no code is still a refusal");
  assert.equal(replyBounce(answer({ ok: true, note: '"isError":true and "error":{' }, false)), undefined,
    "a resident's words that spell the markers are escaped inside the string, so they never match");
  assert.equal(replyBounce(Buffer.from(answer({ error: "bounce", code: 503 }, true))), 503, "a read worker's answer arrives as a Buffer");
  assert.equal(replyBounce(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32602, message: SENTINEL } })), -32602);
  assert.equal(replyBounce(JSON.stringify([{ jsonrpc: "2.0", id: 1, result: {} }, { jsonrpc: "2.0", id: 2, error: { code: -32601 } }])), -32601, "a batch answers for its last call");
  assert.equal(finishCall({ call: { tool: "world" }, out_bytes: 9 }, 401).bounce, 401, "an HTTP refusal is its status");
  assert.equal(finishCall({ call: null }, 200), undefined, "no call, no field: an ordinary line is unchanged");
});

test("the meter counts the bytes written, in bytes", () => {
  const sent = [];
  const res = { write(c) { sent.push(c); return true; }, end(c) { if (c != null) sent.push(c); return this; } };
  const tel = { call: { tool: "household" } };
  meterOut(res, tel, { mcp: true });
  res.write("é");
  res.end(Buffer.from(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601 } })));
  assert.equal(tel.out_bytes, 2 + bytes(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601 } })));
  assert.equal(tel.call.bounce, -32601);
  assert.equal(sent.length, 2, "the writes still reach the response");
});

// ── the office's own lines ──────────────────────────────────────────────────

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "call-shape-key";
const tmp = tempDir("call-shape-");
const LOG_DIR = join(tmp, "telemetry");
let ix = null, office = null, base = null, stderr = "";

before(async () => {
  ix = await indexStore(fixtureTown(), { db: "call_shape" });
  // a read worker boots only beside an existing dynamic store (read-worker-failsoft.test.mjs § 2)
  const { openDynamic } = await import("../src/dynamic-store.mjs");
  const dynamicDb = join(tmp, "dynamic.db");
  openDynamic(dynamicDb).close();
  const booted = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", seedStaticKeys(join(tmp, "oauth.db"), `${KEY}=keemin:wright`), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: join(tmp, "no-clone-here"), WORLD_DYNAMIC_DB: dynamicDb,
      VOICES_LOG: join(tmp, "voices.jsonl"), TOWN_PUSH: "", WORLD_APEX: "1", WORLD_STORE_DB: join(tmp, "no-world.db"),
      OFFICE_ACCESS_LOG_DIR: LOG_DIR, ...ix.env },
    stdio: ["ignore", "pipe", "pipe"],
  }));
  office = booted.child;
  office.stderr.on("data", (d) => { stderr += d; });
  base = `http://127.0.0.1:${booted.port}`;
  for (let i = 0; i < 150; i++) {
    const pool = (await (await fetch(`${base}/release`)).json()).read_workers;
    if (pool?.ready >= 1) break;
    await new Promise((ok) => setTimeout(ok, 200));
  }
});

after(async () => {
  if (office && office.exitCode === null) office.kill();
  await ix?.stop();
  await removeTempDir(tmp, { children: [office] });
});

const auth = { authorization: `Bearer ${KEY}` };
let rpcId = 0;
async function mcp(name, args) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  return { status: r.status, reader: r.headers.get("x-pm-reader"), body: Buffer.from(await r.arrayBuffer()) };
}
async function rpc(method) {
  const r = await fetch(`${base}/mcp`, { method: "POST", headers: { ...auth, "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method }) });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
}
async function rest(method, path, payload) {
  const r = await fetch(`${base}${path}`, { method, headers: { ...auth, "content-type": "application/json" }, ...(payload ? { body: JSON.stringify(payload) } : {}) });
  return { status: r.status, body: Buffer.from(await r.arrayBuffer()) };
}

/** The office's own lines, once `done` holds of them (a line lands on its response's finish, just after the answer). */
async function officeLines(done) {
  const until = Date.now() + 10_000;
  for (;;) {
    const files = existsSync(LOG_DIR) ? readdirSync(LOG_DIR).filter((f) => f.startsWith("access-")) : [];
    const all = files.flatMap((f) => readFileSync(join(LOG_DIR, f), "utf8").split("\n").filter(Boolean));
    if (done(all) || Date.now() > until) return all;
    await new Promise((ok) => setTimeout(ok, 50));
  }
}

test("THE OFFICE'S OWN LINES: every door's call shaped, sized and refused by code, and the sentinel nowhere", async () => {
  // a bare world read, which a read worker answers (the pool is ready, above): the handed path is measured
  const bare = await mcp("world", {});
  const asked = [
    { what: "a worker's bare world read", r: bare, mcp: "world", call: { tool: "world" } },
    { what: "a worker's poisoned world read", r: await mcp("world", { read: SENTINEL, handle: SENTINEL, args: { mark: SENTINEL } }), mcp: "world", call: { tool: "world", read: "other" } },
    { what: "the household house read", r: await mcp("household", { read: "house", handle: SENTINEL }), mcp: "household", call: { tool: "household", read: "house" } },
    { what: "a poisoned letter", r: await mcp("household", { do: "send", args: { from: SENTINEL, to: SENTINEL, title: SENTINEL, body: SENTINEL.repeat(500), [SENTINEL]: 1, "jane-at-42-elm-st": 1 } }), mcp: "household", call: { tool: "household", do: "send" } },
    { what: "an unknown tool", r: await mcp(SENTINEL, { body: SENTINEL }), mcp: "other", call: { tool: "other" }, bounce: -32602 },
    { what: "GET /household", r: await rest("GET", `/household?read=house&handle=${SENTINEL}&args=${encodeURIComponent(JSON.stringify({ q: SENTINEL }))}`), call: { tool: "household", read: "house" } },
    { what: "POST /world/apex", r: await rest("POST", "/world/apex", { do: SENTINEL, args: { text: SENTINEL } }), call: { tool: "world", do: "other" } },
    { what: "POST /town/apex", r: await rest("POST", "/town/apex", { read: "bulletin", args: { q: SENTINEL } }), call: { tool: "town", read: "bulletin" } },
    { what: "POST /household", r: await rest("POST", "/household", { do: "address", args: { body: SENTINEL } }), call: { tool: "household", do: "address" } },
  ];
  // Each ask is found by its own door and shape, never by the order lines land.
  const doorOf = (a) => (a.mcp ? ["POST", "/mcp"] : a.what.split(" "));
  const lineFor = (records, a) => records.findLast((r) => {
    const [method, path] = doorOf(a);
    return r.call && r.method === method && r.path === path && (a.mcp == null || r.mcp === a.mcp)
      && ["tool", "do", "read"].every((k) => r.call[k] === a.call[k]);
  });
  const parse = (all) => all.map((l) => JSON.parse(l));
  // and two JSON-RPC methods that are not tools/call: a known one, and the caller's own text
  await rpc("tools/list");
  await rpc(SENTINEL);
  const methodLine = (records, word) => records.findLast((r) => r.path === "/mcp" && !r.call && r.mcp === word);
  const lines = await officeLines((all) => asked.every((a) => lineFor(parse(all), a)) && methodLine(parse(all), "tools/list") && methodLine(parse(all), "other"));
  for (const l of lines) assert.ok(!l.includes(SENTINEL), `the sentinel reached the office's line: ${l}`);
  assert.ok(bare.reader, `a read worker answered the bare read (the handed path is measured, not assumed); the office said: ${stderr.slice(-1500)}`);
  const records = parse(lines);
  assert.ok(methodLine(records, "tools/list") && methodLine(records, "other"), "a known method is named, an unknown one reads \"other\"");
  const letter = lineFor(records, asked[3]);
  assert.equal(letter.call.keys_other, 2, "the letter's two undeclared field names are counted, not written");
  asked.forEach((a) => {
    const got = lineFor(records, a);
    assert.ok(got, `${a.what}: no line carries its call`);
    for (const [k, v] of Object.entries(a.call)) assert.equal(got.call[k], v, `${a.what}: call.${k} ${JSON.stringify(got.call)}`);
    assert.equal(got.call.out_bytes, a.r.body.length, `${a.what}: out_bytes is the answer's size`);
    assert.equal(got.status, a.r.status);
    const text = a.r.body.toString("utf8");
    const refused = a.r.status >= 400 || /"isError":true|"error":\{/.test(text);
    if (a.bounce !== undefined) assert.equal(got.call.bounce, a.bounce, a.what);
    assert.equal(got.call.bounce != null, refused, `${a.what}: bounce is set exactly when the answer refused (${a.r.status} ${text.slice(0, 120)})`);
    if (a.r.status >= 400) assert.equal(got.call.bounce, a.r.status, `${a.what}: a REST refusal is its status`);
  });
});
