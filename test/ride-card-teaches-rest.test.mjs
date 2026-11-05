// ride-card-teaches-rest.test.mjs — POS-911: the ride card says how to ride over REST.
//
//   node --test test/ride-card-teaches-rest.test.mjs
//
// THE SIGHTING. The ride card carries `dispatches_to: "world_ride"`, which is the MCP tool's name. A caller on plain
// HTTP reads it as a route, and there is no `/world/ride`: REST rides through `POST /world/apex` with the same
// `{ do, args }` envelope the MCP door takes. (rsvp's `dispatched_to: null` reads the same way; that half is not
// fixed here, see the PR.)
//
// LAW (Wright, AUTH 2026-11-05T15:20:42Z; the issue's fix): "the card names how to call it over REST (the apex door and
// the do: value) instead of an internal dispatch name, or alongside it. ... Shape stop: if it needs a new field in the
// card format, stop and report." So the teaching rides an EXISTING text field of the card, the `to` field's
// description, which the card takes from the flat tool's schema (world-apex.mjs § fieldsFor) for BOTH producers of a
// world card (world-apex.mjs § entriesFrom and world2/tools/apex-reads.mjs). `dispatches_to` keeps its value.
//
// WHAT THIS READS. The real field producer (`fieldsFor`), the real dispatch table, and the server's own route heads. It
// is not driven through a standpoint read: the ride card shows only aboard a vehicle, which needs a world clone and a
// passage record (test/ride-bounce-names-the-stops.test.mjs has that rig). The detector reads three clauses of the
// requirement independently of any sentence, so a rewording that still teaches passes and a card that stops teaching
// reds, with the missing clause named.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { fieldsFor, DISPATCHABLE, DISPATCH_TOOLS, dispatchToolFor } from "../src/world-apex.mjs";
import { RIDE_TOOLS } from "../src/world-ride.mjs";

// ── the public address (POS-911, the correction after the first checkpoint) ─────────────────────────────────────────
//
// The first wording told a caller to `POST /world/apex`. That is the OFFICE-relative path, and src/public-base.mjs (POS-777) names
// why an answer must not hand one out: "a bare path is relative to the API yet reads like a site path: copied with the site host it
// 404s (postmark#4132)". The public default is https://postmark.town/api, and PUBLIC_BASE is "read at call time so a test or a deploy
// that sets it is honoured". So the card names the ABSOLUTE address, built from the configured base when the card text is built.
//
// These expectations are WRITTEN HERE, as literals, and never derived through the product's apiUrl or publicBase: a detector that
// computed its expected value with the code under test would agree with any binding of it.
const DEFAULT_URL = "https://postmark.town/api/world/apex";
const CUSTOM_BASE = "https://api.syn-office.invalid/v9";
const CUSTOM_URL = "https://api.syn-office.invalid/v9/world/apex";

/** Run `fn` with PUBLIC_BASE set to `value` (undefined: unset), and put it back. */
async function withBase(value, fn) {
  const had = Object.hasOwn(process.env, "PUBLIC_BASE"), was = process.env.PUBLIC_BASE;
  if (value === undefined) delete process.env.PUBLIC_BASE; else process.env.PUBLIC_BASE = value;
  try { return await fn(); } finally { if (had) process.env.PUBLIC_BASE = was; else delete process.env.PUBLIC_BASE; }
}

const scratch = mkdtempSync(join(tmpdir(), "ride-card-url-"));
after(() => rmSync(scratch, { recursive: true, force: true }));
const RUNNER = join(scratch, "ride-card-runner.mjs");
writeFileSync(RUNNER, [
  `const [, , mode, base, moduleUrl] = process.argv;`,
  `const apex = await import(moduleUrl);                       // the module is imported FIRST`,
  `if (mode === "after-import") process.env.PUBLIC_BASE = base;   // and only then is the base configured`,
  `console.log(JSON.stringify({ text: String(apex.fieldsFor("ride").to?.description ?? "") }));`,
].join("\n"));
/**
 * The ride card's field text as a FRESH process builds it (a new process has no card cache yet): `default` has no PUBLIC_BASE,
 * `before-import` has it in the environment the process starts with, `after-import` sets it once the module is already loaded.
 */
function cardTextInFreshProcess(mode, base) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; delete env.PUBLIC_BASE;       // a child that inherited the runner's context would run nothing
  if (mode === "before-import") env.PUBLIC_BASE = base;
  const args = [...process.execArgv.filter((a, i, all) => a === "--import" || all[i - 1] === "--import"), RUNNER, mode, base ?? "", pathToFileURL(join(import.meta.dirname, "..", "src", "world-apex.mjs")).href];
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, { env, stdio: ["ignore", "pipe", "ignore"], cwd: process.cwd() });
    let out = "", killed = false;
    const timer = setTimeout(() => { killed = true; child.kill("SIGKILL"); }, 60_000);
    child.stdout.on("data", (d) => { out += d; });
    child.on("close", () => { clearTimeout(timer); try { resolve(JSON.parse(out.trim().split("\n").pop()).text); } catch { resolve(killed ? "<<timed out>>" : `<<no answer: ${out.slice(0, 120)}>>`); } });
  });
}

const source = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const SERVER = source("../src/server.mjs");

// ── the premise, as the server states it (a control: it must hold on the base too) ──────────────

test("POS-911 · premise: REST performs a ride through POST /world/apex; there is no /world/ride route; the act dispatches to world_ride", () => {
  const heads = SERVER.split("\n").filter((l) => /^ {4}if \(req\.method === "POST" && .*"\/world\/[a-z-]+"/.test(l));
  const paths = heads.flatMap((h) => [...h.matchAll(/"(\/world\/[a-z-]+)"/g)].map((m) => m[1]));
  assert.ok(paths.includes("/world/say"), `the route scan is live: it found ${JSON.stringify(paths)}`);
  assert.ok(paths.includes("/world/apex"), "REST performs apex acts through POST /world/apex");
  assert.ok(!paths.includes("/world/ride"), "and there is no /world/ride route for dispatches_to: world_ride to invite");
  assert.ok(SERVER.includes('payload?.do != null && payload.do !== ""'), "the apex route takes a `do` from the body");
  assert.ok(DISPATCHABLE.includes("ride"), "ride is a dispatchable apex act");
  assert.equal(dispatchToolFor("ride"), "world_ride", "and it dispatches to the MCP tool world_ride");
  assert.equal(DISPATCH_TOOLS.ride, "world_ride", "which is the card's dispatches_to, a value that stays as it is");
});

// ── the card ──────────────────────────────────────────────────────────────────────────────────────

const REQUIRED_CLAUSES = {
  // the REST door
  namesTheApexDoor: /\/world\/apex/,
  // the do: value, spelled as a caller would send it
  namesTheDoValue: /["']?\bdo\b["']?\s*[:=]\s*["']?ride\b/i,
  // and that the destination rides in args
  namesTheArgs: /\bargs\b[^}]*\bto\b/i,
};
const cardText = (action) => Object.values(fieldsFor(action)).map((f) => String(f?.description ?? "")).join("\n");

test("POS-911 · the ride card's own text names the REST door and the do: value, and does not invite a /world/ride route", async () => {
  const text = await withBase(undefined, () => cardText("ride"));
  const verdict = Object.fromEntries(Object.entries(REQUIRED_CLAUSES).map(([k, re]) => [k, re.test(text)]));
  verdict.inventsNoRideRoute = !/POST\s+\/world\/ride\b/i.test(text);
  assert.deepEqual(verdict, { namesTheApexDoor: true, namesTheDoValue: true, namesTheArgs: true, inventsNoRideRoute: true },
    `LAW (POS-911): "the card names how to call it over REST (the apex door and the do: value)" — the ride card's field text was: ${JSON.stringify(text)}`);
});

test("POS-911 · the ride card names the ABSOLUTE public address, not the office-relative path that reads like a site path", async () => {
  // the default base, in this process (a text read of the real fieldsFor), as one map so a red names every clause that moved
  const text = await withBase(undefined, () => cardText("ride"));
  const verdict = {
    namesThePublicDefaultAddress: text.includes(`POST ${DEFAULT_URL} with`),
    noOfficeRelativeApexPath: !/POST\s+\/world\/apex\b/.test(text),
    theAddressIsNotRelativeToASiteHost: !/(^|[^\w.:/-])\/world\/apex\b/.test(text.replace(DEFAULT_URL, "")),
  };
  assert.deepEqual(verdict, { namesThePublicDefaultAddress: true, noOfficeRelativeApexPath: true, theAddressIsNotRelativeToASiteHost: true },
    `LAW (src/public-base.mjs, POS-777): "a bare path is relative to the API yet reads like a site path: copied with the site host it 404s" — the ride card's field text was: ${JSON.stringify(text)}`);
});

test("POS-911 · the address follows the configured PUBLIC_BASE when the text is built: default, set before import, set AFTER import, slashes ignored, and read again on every access of the schema", async () => {
  // a FRESH process builds the card (no cache yet), so each configuration is the first thing it sees. The after-import case is the one that
  // falsifies a base captured when the module loads; the before-import case falsifies a hardcoded host.
  const [dflt, before, after_, slashed] = await Promise.all([
    cardTextInFreshProcess("default"),
    cardTextInFreshProcess("before-import", CUSTOM_BASE),
    cardTextInFreshProcess("after-import", CUSTOM_BASE),
    cardTextInFreshProcess("after-import", `${CUSTOM_BASE}//`),
  ]);
  // and the flat tool's own schema property, which is read when it is asked for: two reads in one process under two bases
  const prop = RIDE_TOOLS.find((t) => t.name === "world_ride").inputSchema.properties.to;
  const [readDefault, readCustom] = [await withBase(undefined, () => prop.description), await withBase(CUSTOM_BASE, () => prop.description)];
  const has = (text, url) => text.includes(`POST ${url} with`);
  assert.deepEqual({
    freshDefault: has(dflt, DEFAULT_URL),
    freshBeforeImport: has(before, CUSTOM_URL) && !before.includes("postmark.town"),
    freshAfterImport: has(after_, CUSTOM_URL) && !after_.includes("postmark.town"),
    freshAfterImportSlashes: has(slashed, CUSTOM_URL),
    schemaReadUnderDefault: has(readDefault, DEFAULT_URL),
    schemaReadUnderCustom: has(readCustom, CUSTOM_URL) && !readCustom.includes("postmark.town"),
  }, {
    freshDefault: true, freshBeforeImport: true, freshAfterImport: true, freshAfterImportSlashes: true, schemaReadUnderDefault: true, schemaReadUnderCustom: true,
  }, `LAW (src/public-base.mjs): the base "is read at call time so a test or a deploy that sets it is honoured" — texts: ${JSON.stringify({ dflt, before, after_, slashed, readDefault, readCustom }).slice(0, 900)}`);
});

test("POS-911 · the teaching rides the existing field: same keys, same type, same requirement, the old words kept, the dispatch value kept", () => {
  const fields = fieldsFor("ride");
  assert.deepEqual(Object.keys(fields), ["to"], "the ride card still takes one field (handle is the standpoint's)");
  assert.deepEqual(Object.keys(fields.to).sort(), ["description", "required", "type"], "the field carries no new property");
  assert.equal(fields.to.type, "string");
  assert.equal(fields.to.required, true);
  assert.ok(fields.to.description.startsWith("the stop to be bound for — <by>/<slug>, one the vehicle's timetable names — her own berth included."), "the old opening words are kept");
  assert.match(fields.to.description, /The one stop you cannot name is the one you are already bound from\./, "and the old closing sentence");
  const tool = RIDE_TOOLS.find((t) => t.name === "world_ride");
  assert.deepEqual(tool.inputSchema.required, ["to"]);
  assert.equal(tool.inputSchema.additionalProperties, false);
  assert.deepEqual(Object.keys(tool.inputSchema.properties).sort(), ["handle", "to"], "the flat tool's schema keeps its two properties");
  assert.equal(DISPATCH_TOOLS.ride, "world_ride", "dispatches_to keeps its value");
});

test("POS-911 · both producers of a world card take their fields from fieldsFor, so one change reaches both (a text pin, labelled)", () => {
  const apex = source("../src/world-apex.mjs");
  const twin = source("../world2/tools/apex-reads.mjs");
  const call = "fields: fieldsFor(action, a?.fields)";
  assert.equal(apex.split(call).length - 1, 1, "world-apex.mjs § entriesFrom builds a card's fields with fieldsFor, once");
  assert.equal(twin.split(call).length - 1, 1, "world2/tools/apex-reads.mjs builds the 2.0 door's card fields with the same fieldsFor, once");
});
