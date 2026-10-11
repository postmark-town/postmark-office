// arrival-heard.test.mjs — "where did you hear about Postmark?" (POS-292).
//
// The gate, from the brief and Wright's rulings (2026-09-28):
//   H1-H4  the answer is normalised, and nothing about it can refuse a join
//   H5-H8  the real declare-exec, spawned against a real git clone with its
//          record-facing modules stubbed: an answer is kept (one INSERT, the
//          note in its params and nowhere else); a skip keeps nothing and the
//          join lands; a store that refuses the INSERT still lets the join land
//   H9     THE FALSIFIER: the note text appears in no file of the town clone,
//          no commit message, and not in the join's own answer
//   H10    the weekly counts come only through the store's suppressing function
//   H11    declare and begin both ask, last and optional (POS-570; ruling B's
//          follow-up: BEGIN_PROPERTIES is gone)
//   H12    nothing in src/ but arrival-heard.mjs names either table, and
//          nothing selects from them (the store refuses that too: 030's proof)
//   H13    GET /ops/heard answers counts only, through the same function
//   H5b    a co-signed begin lands the berth's parked answer by its slug
//   H14    073 on a real store: the berth's answer is parked where no pen
//          reads it, replaced by a second begin, landed by the co-sign into
//          arrival_heard (moved, never copied), and swept with its berth
//   H15    the choices read plainly: Other means none of these
//
// The store itself (RLS, grants, the fold of every cell under 3) is proved on
// a disposable Postgres: docs/2026-09-28/rail/pos-292/PROOF-030-embedded.txt.
// 073 is proved in this file (H14), on the suite's own store. The seam on the
// berth road, every reader of the parked declaration, is test/oauth.test.mjs
// § POS-570, on the real server.

import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

import {
  HEARD, HEARD_LABELS, HEARD_KEYS, HEARD_NOTE_MAX, FEWER_THAN_3, HEARD_FIELD_NAMES, HEARD_FIELDS,
  heardAnswer, recordHeard, parkHeard, heardReceipt, weeklyHeard, heardDoor,
} from "../src/arrival-heard.mjs";
import * as declareModule from "../src/declare.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const { DECLARE_SCHEMA } = declareModule;

// declare-exec reads its handle check from the town index under the lock, and the
// office will not run without one (POS-268). The declaration's own law is stubbed
// here, so the index it reads is an empty store.
const IX = await indexStore(null);
test.after(() => IX.stop());

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOTE = "a zine left at the Porto café, zz-heard-marker-7f3a";

// ── the answer ──────────────────────────────────────────────────────────────

test("H1 · the ruled list, nine choices, each a label a person picks and a key the store keeps", () => {
  assert.equal(HEARD.length, 9);
  assert.deepEqual(HEARD_KEYS, ["youtube", "discord", "x", "reddit", "friend", "their-ai", "search", "commons", "other"]);
  // 030's CHECK is the same list; a key added here and not there would be refused by the store
  const sql = readFileSync(join(ROOT, "world2", "schema", "030_arrival_heard.sql"), "utf8");
  const check = /heard IN \(([^)]*)\)/.exec(sql)[1].split(",").map((s) => s.trim().replace(/'/g, ""));
  assert.deepEqual(check, HEARD_KEYS);
  assert.match(sql, new RegExp(`char_length\\(note\\) <= ${HEARD_NOTE_MAX}\\b`));
});

test("H2 · a label or a key, any case, is the same answer; the note rides along", () => {
  assert.deepEqual(heardAnswer({ heard: "YouTube" }), { heard: "youtube", note: null, truncated: false });
  assert.deepEqual(heardAnswer({ heard: "the commons / another agent community", heard_note: " Deva's " }), { heard: "commons", note: "Deva's", truncated: false });
  assert.deepEqual(heardAnswer({ heard: "their-ai" }), { heard: "their-ai", note: null, truncated: false });
  for (const label of HEARD_LABELS) assert.ok(heardAnswer({ heard: label })?.heard, label);
});

test("H3 · a skip is nothing; a note with no choice keeps nothing; an off-list choice keeps nothing — and none of them throws", () => {
  assert.equal(heardAnswer({}), null);
  assert.equal(heardAnswer({ heard: "  " }), null);
  assert.equal(heardAnswer({ heard_note: "hi" }).heard, undefined);
  assert.equal(heardAnswer({ heard: "tiktok" }).heard, undefined);
  assert.equal(heardAnswer({ heard: "tiktok" }).unrecognised, true);
  assert.match(heardReceipt(heardAnswer({ heard: "tiktok" }), null), /never blocks a join/);
});

test("H4 · a note over the cap is cut to it, by characters, and the receipt says so", () => {
  const long = "é".repeat(HEARD_NOTE_MAX + 20);
  const a = heardAnswer({ heard: "Other", heard_note: long });
  assert.equal([...a.note].length, HEARD_NOTE_MAX);
  assert.equal(a.truncated, true);
  assert.match(heardReceipt(a, { kept: true }), /cut to 280/);
});

test("H4b · recordHeard never throws: a refusing store and an unpointed office are answers, logged once", async () => {
  const logs = [];
  const log = (s) => logs.push(s);
  const a = heardAnswer({ heard: "Reddit" });
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: a, query: async () => { throw new Error("permission denied"); }, log }), { kept: false, why: "the store refused" });
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: a, query: async () => null, log }), { kept: false, why: "no record" });
  assert.equal(logs.length, 2);
  assert.deepEqual(await recordHeard({ handle: "h", household: "x", answer: null, query: async () => { throw new Error("never called"); } }), { kept: false });
});

// ── the exec, for real, with its record stubbed ─────────────────────────────

const homes = [];
test.after(() => { for (const d of homes) rmSync(d, { recursive: true, force: true }); });
const sh = (cwd, ...args) => execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8" }).trim();
const BOT = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];

const HOOKS = `
export async function resolve(specifier, context, next) {
  const stubs = JSON.parse(process.env.HEARD_STUBS ?? "{}");
  for (const [key, url] of Object.entries(stubs)) {
    const [parent, spec] = key.split("|");
    if (specifier === spec && context.parentURL && context.parentURL.endsWith(parent)) return { url, shortCircuit: true };
  }
  return next(specifier, context);
}
`;
const STUB_DECLARE = `
export const LANDING_GROUND = "the-landing";
export const readRegisters = async () => ({ registry: { households: {} }, pins: {} });
export const conformance = (args) => ({ handle: args.handle, household: "Newcomers", slug: "newcomers", ghId: 7, ghLogin: "newcomer-gh", card: args.card, note: args.note });
export const planDeclaration = (registry, pins, decl) => ({
  slug: decl.slug, date: "2026-09-28", settled: true, gangway: "open",
  registry: { households: { [decl.slug]: { declared_by: decl.handle } } },
  files: [
    { path: "WHITE_PAGES/" + decl.handle + "/ADDRESS.md", content: "---\\nhandle: " + decl.handle + "\\n---\\n\\n" + (decl.card ?? "") + "\\n" },
    { path: "HARBOR/berths/" + decl.handle + ".md", content: JSON.stringify(decl) + "\\n" },
  ],
});
`;
const STUB_RESIDENCY = `export const gangwayState = () => "open";\n`;
const STUB_CEREMONY = `
export const NO_DRAIN = async () => ({ ran: false });
export const collectingDrain = () => ({ drain: async () => ({ ran: true }), paths: [] });
export const mintHousehold = async () => ({});
export const joinHousehold = async () => ({ registry: { rendered: true } });
`;
// The store: every query appended to a file, so the test reads exactly what reached it.
const STUB_ACTS = `
import { appendFileSync } from "node:fs";
export async function actsQuery(text, params) {
  appendFileSync(process.env.HEARD_QUERIES, JSON.stringify({ text, params }) + "\\n");
  if (process.env.HEARD_STORE === "refuse") throw new Error("permission denied for table arrival_heard");
  if (process.env.HEARD_STORE === "none") return null;
  return [];
}
`;

function execTown() {
  const dir = mkdtempSync(join(tmpdir(), "heard-"));
  homes.push(dir);
  const origin = join(dir, "origin.git");
  const clone = join(dir, "clone");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  execFileSync("git", ["clone", "-q", origin, clone], { stdio: "ignore" });
  sh(clone, "config", "core.autocrlf", "false");
  sh(clone, "checkout", "-q", "-B", "main");
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "WHITE_PAGES", "README.md"), "# the white pages\n");
  sh(clone, "add", "-A"); sh(clone, ...BOT, "commit", "-qm", "fixture town"); sh(clone, "push", "-q", "-u", "origin", "main");
  const stubDir = join(dir, "stubs");
  mkdirSync(stubDir);
  const put = (name, text) => { writeFileSync(join(stubDir, name), text); return pathToFileURL(join(stubDir, name)).href; };
  const register = join(stubDir, "register.mjs");
  writeFileSync(register, `import { register } from "node:module"; register(${JSON.stringify(put("hooks.mjs", HOOKS))});\n`);
  const stubs = {
    "/src/declare-exec.mjs|./declare.mjs": put("declare.mjs", STUB_DECLARE),
    "/src/declare-exec.mjs|./residency.mjs": put("residency.mjs", STUB_RESIDENCY),
    "/src/declare-exec.mjs|./ceremony.mjs": put("ceremony.mjs", STUB_CEREMONY),
    "/src/arrival-heard.mjs|./world2-acts.mjs": put("world2-acts.mjs", STUB_ACTS),
  };
  const dbPath = join(dir, "office.db");
  new DatabaseSync(dbPath).close();
  return { dir, origin, clone, register, stubs, dbPath, queries: join(dir, "queries.jsonl") };
}

function declare(t, args, store = "ok", extra = {}) {
  const r = spawnSync(process.execPath, ["--import", pathToFileURL(t.register).href, join(ROOT, "src", "declare-exec.mjs"),
    JSON.stringify({ args: { handle: "newcomer", household: "Newcomers", card: "I am new here.", ...args }, key: { ghId: 7, ghLogin: "newcomer-gh" }, dbPath: t.dbPath, ...extra })], {
    encoding: "utf8",
    env: { ...process.env, TOWN_CLONE: t.clone, TOWN_PUSH: "1", BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid",
      HEARD_STUBS: JSON.stringify(t.stubs), HEARD_QUERIES: t.queries, HEARD_STORE: store, ...IX.env },
  });
  assert.equal(r.status, 0, `declare-exec answers rather than trips: ${r.stderr}`);
  return { out: JSON.parse(r.stdout.trim().split("\n").at(-1)), stdout: r.stdout, stderr: r.stderr };
}
const queriesOf = (t) => existsSync(t.queries) ? readFileSync(t.queries, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : [];

/** Every byte a reader of the town could see: the files, and every commit's message and patch. */
function everythingInTheTown(t) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      if (name === ".git") continue;
      const abs = join(d, name);
      if (statSync(abs).isDirectory()) walk(abs); else out.push(relative(t.clone, abs) + "\n" + readFileSync(abs, "utf8"));
    }
  };
  walk(t.clone);
  out.push(execFileSync("git", ["--git-dir", t.origin, "log", "-p", "--all"], { encoding: "utf8" }));
  return out.join("\n");
}

test("H5 · a join WITH an answer keeps it: one INSERT into arrival_heard, the key and the note in its params, and the join landed", () => {
  const t = execTown();
  const { out } = declare(t, { heard: "Reddit", heard_note: NOTE });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  const q = queriesOf(t);
  assert.equal(q.length, 1);
  assert.match(q[0].text, /^INSERT INTO arrival_heard \(handle, household, heard, note, answered_at\)/);
  assert.match(q[0].text, /ON CONFLICT DO NOTHING$/, "no conflict target: a target needs SELECT, which no pen holds");
  assert.deepEqual(q[0].params.slice(0, 4), ["newcomer", "newcomers", "reddit", NOTE]);
  assert.match(out.heard_about, /kept privately/);
});

test("H5b · a co-signed begin (POS-570) lands the berth's parked answer by its slug: one call to berth_heard_land, no answer read, the join landed", () => {
  const t = execTown();
  const { out } = declare(t, {}, "ok", { heardFrom: "newcomer" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  const q = queriesOf(t);
  assert.equal(q.length, 1);
  assert.equal(q[0].text, "SELECT berth_heard_land($1, $2, $3, $4) AS kept", "the store moves the answer; the office never selects it");
  assert.deepEqual(q[0].params.slice(0, 3), ["newcomer", "newcomer", "newcomers"]);
  assert.equal("heard_about" in out, false, "the co-sign's answer says nothing of an answer the office never read");
  // a store that refuses the landing does not refuse the join
  const t2 = execTown();
  const refused = declare(t2, {}, "refuse", { heardFrom: "newcomer" });
  assert.equal(refused.out.error, undefined, JSON.stringify(refused.out));
  assert.match(refused.out.commit ?? "", /^[0-9a-f]{40}$/);
  assert.match(refused.stderr, /\[arrival-heard\] newcomer: not kept/);
  // The road to here: the co-sign names its berth, and declareViaOffice hands
  // it to this exec. The click itself is a field act (household-apex.test.mjs's
  // header), so the wiring is read where it is written.
  const oauth = readFileSync(join(ROOT, "src", "oauth.mjs"), "utf8");
  assert.match(oauth, /declareViaOffice\(ctx\.clone, \{ \.\.\.decl, handle: pending\.slug \},[\s\S]{0,200}?mint: false, heardFrom: pending\.slug \}\)/,
    "the berth co-sign passes its slug, so the parked answer lands");
  const declareSrc = readFileSync(join(ROOT, "src", "declare.mjs"), "utf8");
  assert.match(declareSrc, /dbPath,\n\s+\.\.\.\(heardFrom \? \{ heardFrom \} : \{\}\),\n\s+\}\);/, "declareViaOffice hands heardFrom to the exec's payload");
});

test("H6 · a join that SKIPS keeps nothing, and still lands", () => {
  const t = execTown();
  const { out } = declare(t, {});
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  assert.equal(queriesOf(t).length, 0, "no answer, no store call");
  assert.equal("heard_about" in out, false);
});

test("H7 · a store that REFUSES the answer does not refuse the join", () => {
  const t = execTown();
  const { out, stderr } = declare(t, { heard: "YouTube" }, "refuse");
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.match(out.commit ?? "", /^[0-9a-f]{40}$/);
  assert.match(out.heard_about, /could not be kept/);
  assert.match(stderr, /\[arrival-heard\] newcomer: not kept/);
});

test("H8 · an off-list choice keeps nothing and the join lands", () => {
  const t = execTown();
  const { out } = declare(t, { heard: "a billboard", heard_note: NOTE });
  assert.equal(out.error, undefined, JSON.stringify(out));
  assert.equal(queriesOf(t).length, 0);
  assert.match(out.heard_about, /Not kept/);
});

test("H9 · THE FALSIFIER: the note reaches no file in the town, no commit, and not the join's own answer", () => {
  const t = execTown();
  const { out, stdout } = declare(t, { heard: "Other", heard_note: NOTE, note: "my public directory line" });
  assert.equal(out.error, undefined, JSON.stringify(out));
  const town = everythingInTheTown(t);
  assert.ok(town.includes("my public directory line"), "the instrument can see what a declaration DOES publish, or this proves nothing");
  assert.equal(town.includes("zz-heard-marker-7f3a"), false, "the note is in the town repo");
  assert.equal(/\bOther\b|"other"/.test(town), false, "the choice is in the town repo");
  assert.equal(stdout.includes("zz-heard-marker-7f3a"), false, "the note rides the join's answer");
  assert.ok(queriesOf(t)[0].params.includes(NOTE), "and it did reach the store");
});

// ── the counts ──────────────────────────────────────────────────────────────

test("H10 · the counts come ONLY through arrival_heard_weekly(), which never selects the note", async () => {
  const seen = [];
  const rows = await weeklyHeard({ since: "2026-09-01T00:00:00Z", query: async (text, params) => {
    seen.push({ text, params });
    return [{ week: "2026-09-21", heard: FEWER_THAN_3, n: "2" }, { week: "2026-09-21", heard: "youtube", n: "3" }];
  } });
  assert.deepEqual(rows, [{ week: "2026-09-21", heard: FEWER_THAN_3, n: 2 }, { week: "2026-09-21", heard: "youtube", n: 3 }]);
  assert.equal(seen.length, 1);
  assert.match(seen[0].text, /FROM arrival_heard_weekly\(\$1\)/);
  assert.doesNotMatch(seen[0].text, /\bnote\b|FROM arrival_heard\b(?!_)/);
  assert.equal(await weeklyHeard({ since: "x", query: async () => null }), null, "an unpointed office is null, never zeroes");
  // the function's own body folds the small cells and names no note
  const sql = readFileSync(join(ROOT, "world2", "schema", "030_arrival_heard.sql"), "utf8").split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const body = /CREATE OR REPLACE FUNCTION arrival_heard_weekly[\s\S]*?\$\$([\s\S]*?)\$\$/.exec(sql)[1];
  assert.match(body, /CASE WHEN n >= 3 THEN heard ELSE 'fewer-than-3' END/);
  assert.doesNotMatch(body, /\bnote\b/);
});

// ── the question, where it is asked ─────────────────────────────────────────

test("H11 · declare and begin both ask, last and optional (POS-570: begin validates against DECLARE_SCHEMA, and its card is declare's)", async () => {
  const names = Object.keys(DECLARE_SCHEMA.properties);
  assert.deepEqual(names.slice(-2), HEARD_FIELD_NAMES);
  for (const f of HEARD_FIELD_NAMES) assert.equal(DECLARE_SCHEMA.required.includes(f), false, `${f} is optional`);
  assert.deepEqual(DECLARE_SCHEMA.properties.heard.enum, HEARD_LABELS);
  assert.equal("BEGIN_PROPERTIES" in declareModule, false, "begin's question-less copy of the schema is gone");
  const apex = readFileSync(join(ROOT, "src", "household-apex.mjs"), "utf8");
  assert.match(apex, /if \(act === "declare" \|\| act === "begin"\) return actionFields\(DECLARE_SCHEMA\.properties/, "begin's card is declare's fields");
  assert.match(apex, /const declared = act === "declare" \|\| act === "begin" \? DECLARE_SCHEMA\.properties/, "begin's validator is declare's schema");
});

test("H12 · nothing in src/ but arrival-heard.mjs names either table, and nothing reads them but through the store's functions", () => {
  const src = join(ROOT, "src");
  const naming = readdirSync(src).filter((f) => f.endsWith(".mjs") && /\b(arrival|berth)_heard\b/.test(readFileSync(join(src, f), "utf8")));
  assert.deepEqual(naming, ["arrival-heard.mjs"]);
  const own = readFileSync(join(src, "arrival-heard.mjs"), "utf8");
  assert.doesNotMatch(own, /SELECT[^;`]*FROM arrival_heard\b(?!_)/, "a SELECT on the table itself");
  assert.doesNotMatch(own, /FROM berth_heard\b(?!_)|berth_heard\s+(SET|WHERE)/i, "a read or a write of the parked answers outside their functions");
  const exporter = readFileSync(join(ROOT, "world2", "tools", "snapshot-export.mjs"), "utf8");
  assert.doesNotMatch(exporter, /arrival_heard|berth_heard/);
});

test("H13 · GET /ops/heard's answer: counts and words, the fold said out loud, and no note anywhere", async () => {
  const body = await heardDoor({ weeks: 4, now: new Date("2026-09-30T00:00:00Z"), query: async () => [
    { week: "2026-09-28", heard: FEWER_THAN_3, n: 1 },
  ] });
  assert.deepEqual(body.weeks, [{ week: "2026-09-28", heard: FEWER_THAN_3, n: 1 }]);
  assert.equal(body.since, "2026-09-02T00:00:00.000Z");
  assert.equal(body.choices.reddit, "Reddit");
  assert.match(body.small_counts, /fewer than 3/);
  const unpointed = await heardDoor({ query: async () => null });
  assert.equal(unpointed.weeks, null);
  // weeks is clamped: never an unbounded read
  let asked = null;
  await heardDoor({ weeks: 9999, now: new Date("2026-09-30T00:00:00Z"), query: async (t, p) => { asked = p[0]; return []; } });
  assert.equal(asked, new Date(Date.parse("2026-09-30T00:00:00Z") - 52 * 7 * 864e5).toISOString());
});

// ── 073, on a real store (POS-570) ──────────────────────────────────────────

test("H14 · 073: begin's answer parks where no pen reads it, a second begin replaces it, the co-sign MOVES it into arrival_heard, and it goes with its berth", async () => {
  const s = await startStore({ db: "berth_heard_test" });
  const api = await s.connect("office_api");
  const owner = await s.connect("world2_owner");
  try {
    const query = async (text, params) => (await api.query(text, params)).rows;
    const parked = async () => (await owner.query("SELECT slug, heard, note FROM berth_heard ORDER BY slug")).rows;
    const T0 = new Date("2026-10-10T12:00:00Z");

    assert.deepEqual(await parkHeard({ slug: "dock-walker", answer: heardAnswer({ heard: "Other", heard_note: NOTE }), at: T0, query }), { parked: true });
    assert.deepEqual(await parked(), [{ slug: "dock-walker", heard: "other", note: NOTE }], "the owner sees it parked: the instrument can see the answer");

    // No pen holds anything on the table: not a read, not a write, not a delete.
    for (const sql of ["SELECT * FROM berth_heard", "SELECT count(*) FROM berth_heard",
      "INSERT INTO berth_heard (slug, heard, parked_at) VALUES ('x', 'youtube', now())", "UPDATE berth_heard SET note = 'x'", "DELETE FROM berth_heard"]) {
      await assert.rejects(api.query(sql), (e) => e.code === "42501", `office_api may not: ${sql}`);
    }
    // The two functions are the owner's, and neither returns the answer. Each
    // searches the caller's pg_temp LAST (review of #482): a definer function
    // with `search_path = public` alone still searches pg_temp first.
    assert.deepEqual((await owner.query(
      "SELECT proname, pg_get_function_result(oid) AS returns, prosecdef, pg_get_userbyid(proowner) AS owner, proconfig FROM pg_proc WHERE proname LIKE 'berth_heard\\_%' ORDER BY 1")).rows,
      [{ proname: "berth_heard_land", returns: "boolean", prosecdef: true, owner: "world2_owner", proconfig: ["search_path=public, pg_temp"] },
       { proname: "berth_heard_park", returns: "void", prosecdef: true, owner: "world2_owner", proconfig: ["search_path=public, pg_temp"] }]);

    // Begin again replaces the parked declaration whole: a new answer, or none.
    assert.deepEqual(await parkHeard({ slug: "dock-walker", answer: heardAnswer({ heard: "YouTube" }), at: T0, query }), { parked: true });
    assert.deepEqual(await parked(), [{ slug: "dock-walker", heard: "youtube", note: null }]);
    assert.deepEqual(await parkHeard({ slug: "dock-walker", answer: heardAnswer({ heard: "a billboard" }), at: T0, query }), { parked: false });
    assert.deepEqual(await parked(), [], "an answer that keeps nothing clears the old one");

    // The co-sign lands it: into arrival_heard at the co-sign's time, and out of berth_heard.
    await parkHeard({ slug: "dock-walker", answer: heardAnswer({ heard: "Reddit", heard_note: NOTE }), at: T0, query });
    const T1 = new Date("2026-10-12T08:00:00Z");
    // THE SHADOW (review of #482): office_api makes a TEMP arrival_heard of its
    // own and lets the owner write it, then calls the landing. The landing
    // still writes the store's table, and the shadow stays empty.
    await api.query("CREATE TEMP TABLE arrival_heard (handle text, household text, heard text, note text, answered_at timestamptz)");
    await api.query("GRANT INSERT, SELECT ON arrival_heard TO world2_owner");
    assert.deepEqual(await recordHeard({ handle: "dock-walker", household: "dockside", berth: "dock-walker", at: T1, query }), { kept: true });
    assert.deepEqual((await api.query("SELECT * FROM pg_temp.arrival_heard")).rows, [], "the caller's temp table caught nothing");
    await api.query("DROP TABLE pg_temp.arrival_heard");
    assert.deepEqual((await owner.query("SELECT handle, household, heard, note, answered_at FROM arrival_heard")).rows,
      [{ handle: "dock-walker", household: "dockside", heard: "reddit", note: NOTE, answered_at: T1 }]);
    assert.deepEqual(await parked(), [], "moved, never copied");
    assert.deepEqual(await recordHeard({ handle: "dock-walker", household: "dockside", berth: "dock-walker", at: T1, query }), { kept: false }, "nothing parked, nothing kept, nothing doubled");
    assert.deepEqual(await weeklyHeard({ since: "2026-10-01T00:00:00Z", query }), [{ week: "2026-10-12", heard: FEWER_THAN_3, n: 1 }], "it counts, folded, in the week its human co-signed");

    // A parked answer goes with its berth: a berth sunsets 7 days after it boards, and the sweep takes answers 8 days old.
    await parkHeard({ slug: "sunset-berth", answer: heardAnswer({ heard: "A search" }), at: T0, query });
    await parkHeard({ slug: "fresh-berth", answer: heardAnswer({ heard: "Discord" }), at: new Date(T0.getTime() + 7 * 864e5), query });
    assert.deepEqual((await parked()).map((r) => r.slug), ["fresh-berth", "sunset-berth"], "7 days on, still parked");
    await parkHeard({ slug: "later-berth", answer: null, at: new Date(T0.getTime() + 8 * 864e5 + 1000), query });
    assert.deepEqual((await parked()).map((r) => r.slug), ["fresh-berth"], "8 days on, swept");
  } finally {
    await api.end();
    await owner.end();
    await s.stop();
  }
});

test("H15 · the choices read plainly (POS-570): Other means none of these, and the note is for the detail; the ruled list is unchanged", () => {
  assert.match(HEARD_FIELDS.heard.description, /"Other" means none of these/);
  assert.match(HEARD_FIELDS.heard_note.description, /which video, who told you, which community/);
  assert.deepEqual(HEARD_FIELDS.heard.enum, HEARD_LABELS);
  assert.deepEqual(HEARD_KEYS, ["youtube", "discord", "x", "reddit", "friend", "their-ai", "search", "commons", "other"]);
  // begin's receipt says where the answer waits, and never repeats it
  const parked = heardReceipt(heardAnswer({ heard: "Other", heard_note: NOTE }), { parked: true }, { parked: true });
  assert.match(parked, /until your human co-signs/);
  assert.equal(parked.includes("zz-heard-marker-7f3a"), false);
  assert.match(heardReceipt(heardAnswer({ heard: "YouTube" }), { parked: false, why: "no record" }, { parked: true }), /declaration is parked all the same/);
});
