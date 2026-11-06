// ride-card-teaches-rest.test.mjs — POS-911: the ride and rsvp cards say how to call them over REST.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/ride-card-teaches-rest.test.mjs
//
// THE SIGHTING (reporter's bug post cloud-phi/the-ride-and-rsvp-cards-name-doors-an-agent-can-t-reach-over). The ride card carries
// `dispatches_to: "world_ride"`, which is only the INTERNAL DISPATCH NAME: no MCP tool is called that, and there is no `/world/ride`
// route. Over REST a ride goes through `POST /world/apex` (public: /api/world/apex) as { do: "ride", args: { to } }. The rsvp card has no
// dispatch name and said nothing of REST; over REST it is `POST /household` as { do: "rsvp", args: { event } }.
//
// LAW (the brief's ruling): "The card names how to call it over REST (the apex door and the do: value), instead of the internal dispatch
// name or alongside it. The same goes for rsvp." and "Shape stop: no new field in the card format." So the teaching rides an EXISTING
// text of each card: the ride card's `to` field description (world-apex.mjs § fieldsFor, from the flat tool's schema) and the rsvp
// act's `teaches` (household-apex.mjs § ACTS, read on the capability index). The two texts are getters, so the public base is read when
// the card is read (src/public-base.mjs, POS-777).
//
// WHAT THIS READS. The real field producer for the ride card and the real capability index for the rsvp row (the same `teaches` the bare
// household answer lists), in this process. The size of that answer is test/foyer-shrink.test.mjs F5c; the recorded household answer is
// test/town-index-absent.test.mjs. The detectors read clauses of the requirement, so a rewording that still teaches passes.

import test from "node:test";
import assert from "node:assert/strict";

import { fieldsFor, DISPATCH_TOOLS } from "../src/world-apex.mjs";
import { RIDE_TOOLS } from "../src/world-ride.mjs";
import { capabilityIndex } from "../src/household-apex.mjs";

// The public address, written here as literals and never derived through the product's apiUrl or publicBase.
const DEFAULT_BASE = "https://postmark.town/api";
const CUSTOM_BASE = "https://api.syn-office.invalid/v9";

/** Run `fn` with PUBLIC_BASE set to `value` (undefined: unset), and put it back. */
function withBase(value, fn) {
  const had = Object.hasOwn(process.env, "PUBLIC_BASE"), was = process.env.PUBLIC_BASE;
  if (value === undefined) delete process.env.PUBLIC_BASE; else process.env.PUBLIC_BASE = value;
  try { return fn(); } finally { if (had) process.env.PUBLIC_BASE = was; else delete process.env.PUBLIC_BASE; }
}

const rideText = () => String(fieldsFor("ride").to?.description ?? "");
const rsvpText = () => String(capabilityIndex().find((a) => a.act === "rsvp")?.teaches ?? "");

test("POS-911 · the ride card names the apex door and the do: value over REST, at the public address", () => {
  const text = withBase(undefined, rideText);
  const verdict = {
    keepsItsOwnWords: text.startsWith("the stop to be bound for — <by>/<slug>"),
    namesThePublicApexAddress: text.includes(`POST ${DEFAULT_BASE}/world/apex`),
    namesTheDoValue: /"do"\s*:\s*"ride"/.test(text),
    namesTheArgs: /"args"\s*:\s*\{\s*"to"/.test(text),
    invitesNoRideRoute: !/\/world\/ride\b/.test(text),
    callsWorldRideInternal: /\binternal\b[^.;]*\bnot\b[^.;]*\bMCP\b/.test(text),
  };
  assert.deepEqual(verdict, { keepsItsOwnWords: true, namesThePublicApexAddress: true, namesTheDoValue: true, namesTheArgs: true, invitesNoRideRoute: true, callsWorldRideInternal: true },
    `LAW (POS-911): "the card names how to call it over REST (the apex door and the do: value)" — the ride card's field text was: ${JSON.stringify(text)}`);
});

test("POS-911 · the rsvp card names its REST call: POST /household with do: rsvp and args: { event }, at the public address", () => {
  const text = withBase(undefined, rsvpText);
  const verdict = {
    keepsItsOwnWords: text.startsWith("RSVP to an event: your name goes on its guest list"),
    namesThePublicHouseholdAddress: text.includes(`POST ${DEFAULT_BASE}/household`),
    namesTheDoValue: /\bdo: rsvp\b/.test(text),
    namesTheArgs: /\bargs: \{ event \}/.test(text),
  };
  assert.deepEqual(verdict, { keepsItsOwnWords: true, namesThePublicHouseholdAddress: true, namesTheDoValue: true, namesTheArgs: true },
    `LAW (POS-911): "the same goes for rsvp" — the rsvp card's teaches was: ${JSON.stringify(text)}`);
});

test("POS-911 · both addresses follow the configured PUBLIC_BASE when the card is read (a getter), and fall back to the public default", () => {
  const prop = RIDE_TOOLS.find((t) => t.name === "world_ride").inputSchema.properties.to;
  const under = (base) => withBase(base, () => ({ ride: prop.description, rsvp: rsvpText() }));
  const [custom, dflt] = [under(CUSTOM_BASE), under(undefined)];
  assert.deepEqual({
    rideCustom: custom.ride.includes(`POST ${CUSTOM_BASE}/world/apex`) && !custom.ride.includes("postmark.town"),
    rsvpCustom: custom.rsvp.includes(`POST ${CUSTOM_BASE}/household`) && !custom.rsvp.includes("postmark.town"),
    rideDefault: dflt.ride.includes(`POST ${DEFAULT_BASE}/world/apex`),
    rsvpDefault: dflt.rsvp.includes(`POST ${DEFAULT_BASE}/household`),
  }, { rideCustom: true, rsvpCustom: true, rideDefault: true, rsvpDefault: true },
    `LAW (src/public-base.mjs): the base is read at call time so a deploy that sets it is honoured — texts: ${JSON.stringify({ custom, dflt }).slice(0, 900)}`);
});

test("POS-911 · no new field in the card format: the teaching rides the existing texts, and dispatches_to keeps its value", () => {
  const fields = fieldsFor("ride");
  assert.deepEqual(Object.keys(fields), ["to"], "the ride card still takes one field (handle is the standpoint's)");
  assert.deepEqual(Object.keys(fields.to).sort(), ["description", "required", "type"], "the ride field carries no new property");
  assert.deepEqual(Object.keys(capabilityIndex().find((a) => a.act === "rsvp")).sort(), ["act", "fields", "teaches"], "the rsvp row carries no new key");
  assert.equal(DISPATCH_TOOLS.ride, "world_ride", "dispatches_to keeps its value");
});
