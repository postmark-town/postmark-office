// plain-reasons.test.mjs — a read that could not be read says a plain reason, never the error's
// own text (POS-657; RULED A, Darko 2026-10-16 20:04 EDT; src/fault-words.mjs § plainReason).
//
// Every disclosure keeps its "unknown, not zero" promise, and its parenthetical is one of four
// fixed reasons. What failed goes to the office's log. The legs below drive real readers with
// an error that carries the kind of text that must never reach an answer (a SQL fragment, a path
// on the box, pg's hint) and assert the answer carries none of it, and the log does.
// test/error-text-census.test.mjs counts the lines; this proves the behaviour.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, statSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

import { PLAIN_REASONS, plainReason } from "../src/fault-words.mjs";
import { alertsFor } from "../src/alerts.mjs";
import { stakesFor } from "../src/doorstep-stakes.mjs";
import { householdMistsForecast } from "../src/mists-forecast.mjs";
import { readIntakeMap } from "../src/intake-map.mjs";

const SECRET = "relation \"acts_hidden\" does not exist at /srv/postmark/box/world2.sql (pg hint: SELECT payload FROM acts)";
const boom = () => { throw Object.assign(new Error(SECRET), { code: "42P01", hint: "SELECT payload FROM acts" }); };
// The world's files fail the way git does: a child's stderr, never a SQLSTATE.
const GIT_SECRET = "fatal: bad object refs/hidden/acts_hidden in /srv/postmark/box/world-clone";
const boomGit = () => { throw Object.assign(new Error("Command failed: git show"), { stderr: GIT_SECRET, status: 128 }); };
const REASONS = Object.values(PLAIN_REASONS);

/** Run `fn` with console.error captured: { value, logged }. */
async function logging(fn) {
  const lines = [];
  const was = console.error;
  console.error = (...a) => { lines.push(a.join(" ")); };
  try { return { value: await fn(), logged: lines.join("\n") }; } finally { console.error = was; }
}
const clean = (answer) => {
  const s = JSON.stringify(answer);
  assert.doesNotMatch(s, /acts_hidden|\/srv\/postmark|SELECT payload|42P01|fatal:|world-clone/, `no raw error reaches the answer: ${s.slice(0, 300)}`);
  return s;
};

test("the four reasons are the ruling's words, and a read is given one of them, never the error's text", async () => {
  assert.deepEqual(REASONS, ["the record did not answer", "the world's files could not be read", "a saved file does not parse", "the chain could not be reached"]);
  const { value, logged } = await logging(() => plainReason(new Error(SECRET), "record", "the docket"));
  assert.equal(value, "the record did not answer");
  assert.match(logged, /the docket could not be read \(the record did not answer\): relation "acts_hidden"/, "the raw error goes to the log");
  assert.equal((await logging(() => plainReason(new SyntaxError("Unexpected token } in JSON at position 7"), "files", "a file"))).value,
    "a saved file does not parse", "a file whose JSON is bad says so");
  assert.equal((await logging(() => plainReason(new Error("x"), "chain"))).value, "the chain could not be reached");
  assert.equal((await logging(() => plainReason(new Error("x"), "no such kind"))).value, "the record did not answer", "an unknown kind is the record");
});

test("each raw cause maps to one reason: the cause outranks the site, and the chain stays the chain", async () => {
  const said = async (e, kind) => (await logging(() => plainReason(e, kind, "a read"))).value;
  assert.equal(await said(Object.assign(new Error(SECRET), { code: "42P01" }), "files"), "the record did not answer", "pg's SQLSTATE is the record");
  assert.equal(await said(Object.assign(new Error("invalid input syntax for type json"), { code: "22P02" }), "files"), "the record did not answer", "pg's code outranks its text");
  assert.equal(await said(new Error("connect ECONNREFUSED 127.0.0.1:5432"), "files"), "the record did not answer");
  assert.equal(await said(Object.assign(new Error("Command failed: git show"), { stderr: GIT_SECRET }), "record"), "the world's files could not be read", "a child's stderr is the files");
  assert.equal(await said(new Error("world clone has no main ref"), "record"), "the world's files could not be read");
  assert.equal(await said(Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" }), "record"), "the world's files could not be read");
  assert.equal(await said(new SyntaxError("Unexpected end of JSON input"), "record"), "a saved file does not parse");
  assert.equal(await said(new Error("connect ECONNREFUSED"), "chain"), "the chain could not be reached", "the chain's RPC failing is the chain");
  assert.equal(await said(new Error("something odd"), "files"), "the world's files could not be read", "no named cause: the site's kind stands");
});

test("alerts: a store that cannot be reached, and a query that fails, say the plain reason", async () => {
  const lost = await logging(() => alertsFor(["kai"], { store: async () => boom() }));
  const s = clean(lost.value);
  assert.match(s, /the store could not be reached \(the record did not answer\)/);
  assert.match(lost.logged, /acts_hidden/);
  const failing = await logging(() => alertsFor(["kai"], { store: async () => ({ query: async () => boom() }), worldIds: async () => new Set() }));
  assert.deepEqual(failing.value.unread.map((u) => u.reason), ["the record did not answer", "the record did not answer"]);
  clean(failing.value);
});

test("the doorstep's stakes: an unreadable world, registry and escrow keep 'unknown, not zero' with plain reasons", async () => {
  const noWorld = await logging(() => stakesFor(["kai"], { world: async () => boomGit() }));
  assert.match(clean(noWorld.value), /the world record could not be read \(the world's files could not be read\) — what you hold is unknown here, not empty/);
  const noEscrow = await logging(() => stakesFor(["kai"], {
    world: async () => ({ state: { marks: [] }, ref: "refs/tags/settlement/S1" }), registry: async () => boom(), escrow: async () => boom(),
  }));
  const s = clean(noEscrow.value);
  assert.match(s, /the escrow projection could not be read \(the record did not answer\) — unknown, not zero/);
  assert.match(noEscrow.logged, /acts_hidden/);
});

test("the Mists forecast: a registry, marks or ground that cannot be read says the plain reason", async () => {
  const base = { pointed: () => true, household: async () => ({ residents: ["kai"] }), publishedMarks: () => [], ringOf: async () => [], engine: async () => null, skeleton: () => null };
  for (const [part, d, want] of [
    ["registry", { ...base, household: async () => boom() }, /the household registry could not be read \(the record did not answer\)/],
    ["marks", { ...base, publishedMarks: () => boomGit() }, /the house's published marks could not be read \(the world's files could not be read\)/],
  ]) {
    const { value } = await logging(() => householdMistsForecast("kai", { deps: d }));
    assert.match(clean(value), want, part);
  }
});

test("a saved file that does not parse says so, without the parser's words", async () => {
  const dir = mkdtempSync(join(tmpdir(), "plain-reasons-"));
  try {
    const file = join(dir, "intake-addresses.json");
    writeFileSync(file, "{ \"0xabc\": \"ec2\", oops }");
    const { value, logged } = await logging(() => readIntakeMap(file));
    assert.equal(value.invalid.length, 1);
    assert.match(value.invalid[0].reason, /^unparseable JSON \(a saved file does not parse\) — every arrival stays pot-ambiguous/);
    assert.doesNotMatch(value.invalid[0].reason, /Unexpected|position|token/);
    assert.match(logged, /deploy\/intake-addresses\.json could not be read/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("every plainReason call in src/ names a kind the ruling has", () => {
  const SRC = join(resolve(dirname(fileURLToPath(import.meta.url)), ".."), "src");
  const walk = (d) => readdirSync(d).flatMap((n) => { const p = join(d, n); return statSync(p).isDirectory() ? walk(p) : p.endsWith(".mjs") ? [p] : []; });
  const kinds = new Set(Object.keys(PLAIN_REASONS));
  let calls = 0;
  for (const f of walk(SRC)) {
    for (const m of readFileSync(f, "utf8").matchAll(/plainReason\(\s*[\w?.]+\s*,\s*"([a-z]+)"/g)) {
      calls += 1;
      assert.ok(kinds.has(m[1]), `${f}: plainReason(…, "${m[1]}") is not one of ${[...kinds].join(", ")}`);
    }
  }
  assert.ok(calls >= 60, `the disclosures go through plainReason (${calls} calls)`);
});
