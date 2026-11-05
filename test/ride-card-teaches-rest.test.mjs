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

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { fieldsFor, DISPATCHABLE, DISPATCH_TOOLS, dispatchToolFor } from "../src/world-apex.mjs";
import { RIDE_TOOLS } from "../src/world-ride.mjs";

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

test("POS-911 · the ride card's own text names the REST door and the do: value, and does not invite a /world/ride route", () => {
  const text = cardText("ride");
  const verdict = Object.fromEntries(Object.entries(REQUIRED_CLAUSES).map(([k, re]) => [k, re.test(text)]));
  verdict.inventsNoRideRoute = !/POST\s+\/world\/ride\b/i.test(text);
  assert.deepEqual(verdict, { namesTheApexDoor: true, namesTheDoValue: true, namesTheArgs: true, inventsNoRideRoute: true },
    `LAW (POS-911): "the card names how to call it over REST (the apex door and the do: value)" — the ride card's field text was: ${JSON.stringify(text)}`);
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
