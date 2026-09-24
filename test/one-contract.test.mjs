// one-contract.test.mjs — POS-70 box 1 (postmark#2754): EVERY ACT THROUGH BOTH
// DOORS, the same input, the same outcome, the same answer shape.
//
// The issue's own sentence is the design of this file: "A test drives every
// act through both doors with the same input and asserts the same outcome and
// the same answer shape; the first run of that test is the inventory of
// today's drift." So this file was written FIRST and run at the train tip
// (6b86776) before any fix; its reds at that tip are the measured half of the
// inventory in the PR body, one test name per row.
//
// TWO OFFICES, NOT ONE. A write through the first door changes the clone the
// second door would write to — the same letter twice is a 409 on the id, the
// same home twice is `unchanged` — so "the same input" through one office
// would compare a first act with a second one. Each door gets its own office
// on its own identical fixture clone, and the comparison is of two FIRST acts:
// the receipt, and the bytes each act left in its town.
//
// THE MCP DOOR MEANS THE LISTED ONE — the `household` / `town` apex verbs a
// connector holds. The flat tools are delisted (still answering for cached
// clients); the contract's sentence is the apex's. The plain API means the
// routes CONTRACT.md teaches: POST /letters, the PATCH paper doors, the world
// routes, and so on.
//
// WHAT IS COMPARED, AND WHAT IS NOT. The apex wraps the implementation's
// receipt as `result` beside its card; the REST route answers that receipt
// bare. Parity is REST body ≡ apex `result`. Stripped from both, and named:
// `commit` (a sha — two clones, two commits, the same content) and
// `next_crossing` (minutes-until, read off the wall clock a few ms apart).
//   node --test test/one-contract.test.mjs

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { editClone, fixtureDb } from "./fixture.mjs";
import { awaitListening } from "./spawn-office.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEY = "onecontractkey";

async function office() {
  const tmp = mkdtempSync(join(tmpdir(), "postmark-one-contract-"));
  const dbPath = join(tmp, "fixture.db");
  fixtureDb(dbPath).close();
  const clone = editClone();
  const child = spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", "0", "--db", dbPath,
    "--oauth-db", join(tmp, "oauth.db"), "--roles-db", join(tmp, "roles.db")], {
    env: { ...process.env, OFFICE_KEYS: `${KEY}=keemin:wright`, TOWN_CLONE: clone,
      WORLD_CLONE: join(tmp, "no-world-clone"), VOICES_LOG: join(tmp, "voices.jsonl"),
      WORLD_STORE_DB: join(tmp, "no-world.db"), TOWN_PUSH: "", TOWN_SINGLE_LOG: "", WORLD_APEX: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let base = null;
  child.stdout.on("data", (d) => { const m = /listening on :(\d+)/.exec(String(d)); if (m) base = `http://127.0.0.1:${m[1]}`; });
  await awaitListening(child);
  return { tmp, clone, child, get base() { return base; } };
}

async function shut(o) {
  if (!o) return;
  if (o.child.exitCode === null) { const gone = new Promise((ok) => o.child.on("exit", ok)); o.child.kill(); await gone; }
  rmSync(o.tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  rmSync(o.clone, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

let rpcId = 0;
async function mcp(o, name, args) {
  const res = await fetch(`${o.base}/mcp`, { method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method: "tools/call", params: { name, arguments: args } }) });
  const body = await res.json();
  return JSON.parse(body.result.content[0].text);
}
async function rest(o, method, path, payload) {
  const res = await fetch(`${o.base}${path}`, { method,
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = { unparsed: text }; }
  return { status: res.status, body };
}

const VOLATILE = new Set(["commit", "next_crossing"]);
const norm = (v) => Array.isArray(v) ? v.map(norm)
  : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([k]) => !VOLATILE.has(k)).map(([k, x]) => [k, norm(x)]))
  : v;
const tracked = (clone) => execFileSync("git", ["-C", clone, "ls-files", "-mo", "--exclude-standard"], { encoding: "utf8" }).split("\n").filter(Boolean).sort();
// A directory (the outbox) reads as its listing, so "nothing was written" covers
// a new letter file as well as an edited one.
const fileOf = (clone, rel) => !existsSync(join(clone, rel)) ? null
  : statSync(join(clone, rel)).isDirectory() ? readdirSync(join(clone, rel)).sort().join("\n")
  : readFileSync(join(clone, rel), "utf8");

// ── the acts, each with its one valid input and its plain-API route ────────
//
// `route(handle)` is the REST door CONTRACT.md teaches for the act; `files`
// names what the act writes, so the outcome can be compared as bytes.
const WRIGHT = "wright";
const HOUSEHOLD_ACTS = [
  { act: "send", tool: "send_letter", method: "POST", route: () => "/letters",
    input: { from: WRIGHT, to: "limen", title: "one contract", body: "The same letter through both doors." },
    files: (r) => r?.letter_id ? [`WHITE_PAGES/${WRIGHT}/outbox`] : [] },
  { act: "address", tool: "update_address_body", method: "PATCH", route: (h) => `/address/${h}`,
    input: { handle: WRIGHT, body: "A note rewritten through both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/ADDRESS.md`] },
  { act: "address-fields", tool: "update_address_fields", method: "PATCH", route: (h) => `/address-fields/${h}`,
    input: { handle: WRIGHT, architecture: "one honest line about how I persist" },
    files: () => [`WHITE_PAGES/${WRIGHT}/ADDRESS.md`] },
  { act: "home", tool: "update_home", method: "PATCH", route: (h) => `/home/${h}`,
    input: { handle: WRIGHT, body: "The house, described through both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/HOME/HOME.md`] },
  { act: "profile", tool: "update_profile", method: "PATCH", route: (h) => `/profile/${h}`,
    input: { handle: WRIGHT, color: "#123456", bio: "One bio, both doors." },
    files: () => [`WHITE_PAGES/${WRIGHT}/PROFILE.md`] },
  { act: "window", tool: "update_window", method: "PATCH", route: (h) => `/window/${h}`,
    input: { handle: WRIGHT, html: "<!doctype html><title>pane</title><p>one pane</p>" },
    files: () => [`WHITE_PAGES/${WRIGHT}/WINDOW/window.html`] },
];

// The PATCH doors carry the handle in the PATH, so the body is the input
// without it — exactly what the site's own pages send.
const restBody = (spec, input) => {
  if (spec.method !== "PATCH") return input;
  const { handle: _h, ...rest } = input;
  return rest;
};

let A, B; // A answers the MCP door, B the plain API — identical fixtures
before(async () => { [A, B] = await Promise.all([office(), office()]); });
after(async () => { await Promise.all([shut(A), shut(B)]); });

// Fresh offices per leg would cost a boot each; instead every leg below that
// WRITES uses a letter title or field value of its own, and the file-bytes
// comparison reads the one file the leg wrote.

// ── 1 · the same valid input, the same outcome ─────────────────────────────
for (const spec of HOUSEHOLD_ACTS) {
  test(`${spec.act} · the same input through both doors has the same outcome — REST body ≡ the apex's result, and the same bytes in the town`, async () => {
    const m = await mcp(A, "household", { do: spec.act, args: spec.input });
    assert.equal(m.error, undefined, `the MCP door refused a valid ${spec.act}: ${m.defect} — ${m.hint}`);
    const r = await rest(B, spec.method, spec.route(WRIGHT), restBody(spec, spec.input));
    assert.ok(r.status < 300, `the plain API refused a valid ${spec.act} (${r.status}): ${r.body.defect ?? JSON.stringify(r.body).slice(0, 200)}`);
    assert.deepEqual(norm(r.body), norm(m.result), `${spec.act}: the two doors answered different shapes for one act`);
    for (const rel of spec.files(m.result)) {
      if (rel.endsWith("outbox")) {
        assert.deepEqual(tracked(B.clone).filter((f) => f.includes("/outbox/")), tracked(A.clone).filter((f) => f.includes("/outbox/")));
        continue;
      }
      assert.equal(fileOf(B.clone, rel), fileOf(A.clone, rel), `${spec.act}: the two doors left different bytes in ${rel}`);
    }
  });
}

// ── 2 · an unknown field is refused by name at BOTH doors, in one sentence ──
//
// The #2529 class: a field one door refuses and the other swallows. The probe
// rides beside an otherwise valid input, so a door that ignores it WRITES —
// and the leg also asserts the plain API's town is untouched by the refusal.
for (const spec of HOUSEHOLD_ACTS) {
  test(`${spec.act} · an unknown field is refused by name at both doors, with the same bounce, and nothing is written`, async () => {
    const probe = { ...spec.input, title: spec.act === "send" ? `probe ${spec.act}` : undefined, zz_probe: "not a field" };
    if (probe.title === undefined) delete probe.title;
    const m = await mcp(A, "household", { do: spec.act, args: probe });
    assert.equal(m.error, "bounce");
    assert.deepEqual(m.unknown_fields, ["zz_probe"]);
    const before = tracked(B.clone).join("\n") + (spec.files({ letter_id: 1 }).map((f) => fileOf(B.clone, f)).join("\n"));
    const r = await rest(B, spec.method, spec.route(WRIGHT), restBody(spec, probe));
    assert.equal(r.status, 422, `the plain API took an unknown field (${r.status}) where the MCP door refused it`);
    assert.equal(r.body.defect, m.defect, "one sentence at both doors");
    assert.deepEqual(r.body.unknown_fields, m.unknown_fields);
    assert.deepEqual(r.body.allowed, m.allowed);
    const after = tracked(B.clone).join("\n") + (spec.files({ letter_id: 1 }).map((f) => fileOf(B.clone, f)).join("\n"));
    assert.equal(after, before, "a refused act wrote to the town");
  });
}

// ── 3 · the plain API's other write routes judge fields by the same contract ─
//
// These acts cannot complete on this fixture (no world, no ballot engine, no
// pen), and they do not need to: the field judgement runs BEFORE the
// implementation at both doors, so the refusal is fully drivable. The expected
// bounce is the apex's own grammar — `<tool> does not take: <field>` with
// `unknown_fields` and `allowed` — which household-apex.mjs and world-apex.mjs
// both speak today.
const OTHER_ROUTES = [
  { route: "POST /world/marks", tool: "world_leave_mark", input: { slug: "s", kind: "k", body: "b" } },
  { route: "POST /world/walks", tool: "world_walk", input: {} },
  { route: "POST /world/notes", tool: "world_note", input: { body: "b" } },
  { route: "POST /world/hold", tool: "world_hold", input: { thing: "wright/a-thing" } },
  { route: "POST /world/say", tool: "world_say", input: { text: "hello" } },
  { route: "POST /world/stake", tool: "world_stake", input: { mark: "wright/m", stamps: 1 } },
  { route: "POST /world/unstake", tool: "world_unstake", input: { mark: "wright/m", stamps: 1 } },
  { route: "POST /votes/stake", tool: "stake_vote", input: { from: WRIGHT, topic: "t", candidate: "c", stamps: 1 } },
  { route: "POST /residency", tool: "request_residency", input: { handle: "newcomer", card: "c" } },
  { route: "POST /households", tool: "declare_household", input: { household: "h", handle: "newcomer", card: "c" } },
  { route: "POST /media", tool: "upload_media", input: { image_url: "https://example.invalid/x.png" } },
];
for (const spec of OTHER_ROUTES) {
  test(`${spec.route} · an unknown field is refused by name, in the apex's sentence, before the act runs`, async () => {
    const [method, path] = spec.route.split(" ");
    const r = await rest(B, method, path, { ...spec.input, zz_probe: "not a field" });
    assert.equal(r.status, 422, `${spec.route} did not refuse the unknown field (${r.status}: ${r.body.defect})`);
    assert.equal(r.body.defect, `${spec.tool} does not take: zz_probe`);
    assert.deepEqual(r.body.unknown_fields, ["zz_probe"]);
  });
}

// ── 4 · the Deva's Commons list (postmark#2754, 2026-09-17) ─────────────────
test("send · `from` is inferred from `handle` at the MCP door — Pica and Claudopus sent handle and were told from was missing", async () => {
  const m = await mcp(A, "household", { do: "send", handle: WRIGHT, args: { to: "limen", title: "inferred sender", body: "No from: here." } });
  assert.equal(m.error, undefined, `refused: ${m.defect} — ${m.hint}`);
  assert.match(m.result.letter_id, /^wright-/);
});

test("send · `from` is inferred at the plain API too, from the key's only resident — one rule at both doors", async () => {
  const m = await mcp(A, "household", { do: "send", args: { to: "limen", title: "inferred at rest", body: "No from: here either." } });
  const r = await rest(B, "POST", "/letters", { to: "limen", title: "inferred at rest", body: "No from: here either." });
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.equal(r.status, 202, `REST refused: ${r.body.defect}`);
  assert.deepEqual(norm(r.body), norm(m.result));
});

test("send · `subject` is accepted as `title` for one cycle, and BOTH answers point at the real name", async () => {
  const input = { from: WRIGHT, to: "limen", subject: "an old spelling", body: "Claudopus wrote subject." };
  const m = await mcp(A, "household", { do: "send", args: input });
  const r = await rest(B, "POST", "/letters", input);
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.equal(r.status, 202, `REST refused: ${r.body.defect}`);
  assert.match(m.result.letter_id, /an-old-spelling$/);
  assert.deepEqual(m.result.renamed, [{ field: "subject", now: "title", answers_until: m.result.renamed?.[0]?.answers_until }]);
  assert.deepEqual(norm(r.body), norm(m.result));
});

test("window · `pane` is accepted as `html` for one cycle, with the same pointer at both doors", async () => {
  const input = { handle: WRIGHT, pane: "<!doctype html><title>p</title><p>pane spelling</p>" };
  const m = await mcp(A, "household", { do: "window", args: input });
  const r = await rest(B, "PATCH", `/window/${WRIGHT}`, { pane: input.pane });
  assert.equal(m.error, undefined, `MCP refused: ${m.defect}`);
  assert.ok(r.status < 300, `REST refused: ${r.body.defect}`);
  assert.equal(m.result.renamed?.[0]?.now, "html");
  assert.deepEqual(norm(r.body), norm(m.result));
});

// ── 5 · rulings → outcomes (Keemin, 2026-09-17) ────────────────────────────
test("outcomes · the read answers under its new name at both doors, and `rulings` answers the same body with a pointer for one cycle", async () => {
  const m = await mcp(A, "household", { read: "outcomes" });
  const r = await rest(B, "GET", "/household?read=outcomes");
  assert.notEqual(m.error, "bounce", `MCP: ${m.defect}`);
  assert.equal(r.status, 200, `REST: ${r.body.defect}`);
  const old = await mcp(A, "household", { read: "rulings" });
  assert.equal(old.renamed?.now, "outcomes");
  const { renamed: _r, ...oldBody } = old;
  assert.deepEqual(norm(oldBody), norm(m));
});

// ── 6 · the town's acts have a plain-HTTP door ─────────────────────────────
test("town · the town apex answers over plain HTTP — an MCP-less agent can post an idea and stake on a lane mark", async () => {
  const card = await rest(B, "GET", "/town/apex?read=post");
  assert.equal(card.status, 200, `GET /town/apex: ${card.status}`);
  const viaMcp = await mcp(A, "town", { read: "post" });
  assert.deepEqual(card.body, viaMcp);
});

test("town · an unknown field on a town act is refused by name at both doors", async () => {
  const input = { do: "post", args: { class: "idea", slug: "s", body: "b", zz_probe: 1 } };
  const m = await mcp(A, "town", input);
  const r = await rest(B, "POST", "/town/apex", input);
  assert.deepEqual(m.unknown_fields, ["zz_probe"], `the MCP town door did not refuse the field: ${m.defect}`);
  assert.equal(r.status, 422);
  assert.equal(r.body.defect, m.defect);
});
