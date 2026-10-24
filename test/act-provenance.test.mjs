// act-provenance.test.mjs — POS-633 H4 (part 4a): every act's record carries
// whose hand, for whom, and by which route, from the build forward.
//
//   1. The triple is the record's: the actor, human-of-<slug> (the human's own
//      hand), payload.as_human (the human beside a seat), and a site act (the
//      human at a resident's wheel).
//   2. The route is the door's, set once per request (server.mjs § handle) and
//      read by the pen; outside any door it is absent, never "unknown" (D4).
//   3. Migration 079 adds the three columns; the pen names them only when the
//      store has them, so an office on this code runs unchanged against a
//      store that has not taken 079.
//
//   node --test test/act-provenance.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { provenanceOf, routeOfRequest, withRoute, currentRoute, noteRequester, currentResidents, actsHaveProvenance, __forgetProvenanceProbe, ROUTES } from "../src/act-provenance.mjs";
import { actsInsert, insertAct } from "../src/world2-pen.mjs";
import { startStore, NO_STORE } from "./helpers/embedded-store.mjs";

test("1 · the hand and the for are the record's: a resident, the human's own hand, the human beside a seat, the human at the site", () => {
  assert.deepEqual(provenanceOf({ actor: "rei" }, "mcp"), { hand: "rei", for_handle: "rei", route: "mcp" });
  assert.deepEqual(provenanceOf({ actor: "human-of-starforge" }, "site"), { hand: "human", for_handle: null, route: "site" });
  assert.deepEqual(provenanceOf({ actor: "rei", payload: { as_human: "human-of-starforge" } }, "api"), { hand: "human", for_handle: "rei", route: "api" });
  assert.deepEqual(provenanceOf({ actor: "rei", payload: JSON.stringify({ as_human: "human-of-starforge" }) }, "mcp").hand, "human", "a payload in its string form too");
  assert.deepEqual(provenanceOf({ actor: "rei" }, "site", new Set(["rei", "wright"])), { hand: "human", for_handle: "rei", route: "site" }, "the human at their own resident's wheel");
  assert.deepEqual(provenanceOf({ actor: "rei" }, "site", null), { hand: "rei", for_handle: "rei", route: "site" }, "no requester known: the actor's own");
  assert.deepEqual(provenanceOf({ actor: "rei" }, null), { hand: "rei", for_handle: "rei", route: null }, "outside a door: no route");
  assert.deepEqual(ROUTES, ["mcp", "api", "site", "letter", "operator"], "D3: api joins the four");
});

test("2 · the route is the door's: the site's header first, then the MCP door, else the API; the scope carries it across awaits", async () => {
  assert.equal(routeOfRequest({ url: "/household", headers: { "x-postmark-channel": "web" } }), "site");
  assert.equal(routeOfRequest({ url: "/mcp", headers: {} }), "mcp");
  assert.equal(routeOfRequest({ url: "/mcp/", headers: { "x-postmark-channel": "agent" } }), "mcp");
  assert.equal(routeOfRequest({ url: "/household?read=house", headers: {} }), "api");
  assert.equal(currentRoute(), null);
  const seen = await withRoute("mcp", async () => { await new Promise((r) => setTimeout(r, 5)); return currentRoute(); });
  assert.equal(seen, "mcp");
  assert.equal(await withRoute("carrier-pigeon", async () => currentRoute()), null, "an unknown word is no route");
  assert.equal(currentRoute(), null);
});

test("1b · a site request's other actors keep their own hand: the town, a creature, another house's resident (review of #671)", async () => {
  await withRoute("site", async () => {
    noteRequester({ household: "keeminlee", handles: new Set(["rei", "wright"]) });
    assert.deepEqual([...currentResidents()].sort(), ["rei", "wright"]);
    await new Promise((r) => setTimeout(r, 1));
    assert.deepEqual(provenanceOf({ actor: "rei" }), { hand: "human", for_handle: "rei", route: "site" });
    assert.deepEqual(provenanceOf({ actor: "the-town" }), { hand: "the-town", for_handle: "the-town", route: "site" }, "a quest or ballot act the request caused");
    assert.deepEqual(provenanceOf({ actor: "damaris" }), { hand: "damaris", for_handle: "damaris", route: "site" }, "another household's resident");
    assert.deepEqual(provenanceOf({ actor: "creature:raven-259-0" }).hand, "creature:raven-259-0", "a creature's reaction inside the act's door");
  });
  noteRequester({ handles: new Set(["x"]) });
  assert.equal(currentResidents(), null, "outside a scope, nothing is noted");
});

test("3 · the INSERT names the three columns only when handed the triple", () => {
  const row = { written_at: "2026-10-20T00:00:00Z", crossing: null, actor: "rei", action: "say", object: null, class: "voice", payload: {}, effect: null };
  const bare = actsInsert(row, null);
  assert.ok(!/hand|for_handle|route/.test(bare.text), "the INSERT it always was");
  assert.equal(bare.values.length, 13);
  const kept = actsInsert(row, null, { provenance: { hand: "rei", for_handle: "rei", route: "mcp" } });
  assert.match(kept.text, /, hand, for_handle, route\)/);
  assert.deepEqual(kept.values.slice(-3), ["rei", "rei", "mcp"]);
});

test("4 · on a real store: 079 lands the columns, the pen writes the triple under a door's route, and a store without them takes the old INSERT", async (t) => {
  let s;
  try { s = await startStore({ db: "act_provenance" }); } catch { return t.skip(NO_STORE); }
  const api = await s.connect("office_api");
  try {
    __forgetProvenanceProbe();
    assert.equal(await actsHaveProvenance(api), true, "079 is applied with the schema");
    const row = (actor, payload = {}) => ({ written_at: new Date().toISOString(), crossing: null, actor, action: "say", object: null, class: "voice", payload, effect: null });
    const a = await withRoute("mcp", () => insertAct(api, row("rei")));
    const b = await withRoute("site", () => insertAct(api, row("human-of-starforge")));
    const e = await withRoute("site", async () => { noteRequester({ handles: new Set(["rei"]) }); return insertAct(api, row("rei")); });
    const f = await withRoute("site", async () => { noteRequester({ handles: new Set(["rei"]) }); return insertAct(api, row("the-town")); });
    const c = await insertAct(api, row("wright"));
    const got = async (id) => (await api.query("SELECT hand, for_handle, route FROM acts WHERE id = $1", [id])).rows[0];
    assert.deepEqual(await got(a), { hand: "rei", for_handle: "rei", route: "mcp" });
    assert.deepEqual(await got(b), { hand: "human", for_handle: null, route: "site" });
    assert.deepEqual(await got(c), { hand: "wright", for_handle: "wright", route: null }, "no door, no route");
    assert.deepEqual(await got(e), { hand: "human", for_handle: "rei", route: "site" }, "the human at their own resident's wheel");
    assert.deepEqual(await got(f), { hand: "the-town", for_handle: "the-town", route: "site" }, "the town's act inside a site request keeps its own hand");
    await assert.rejects(api.query("INSERT INTO acts (at, actor, action, class, route) VALUES (now(), 'x', 'say', 'voice', 'unknown')"), /acts_route_known/,
      "the store refuses a route word outside the five");
    // a store that has not taken 079: the probe says so, and the pen writes the INSERT it always has
    const owner = await s.connect("world2_owner");
    try { await owner.query("ALTER TABLE acts DROP CONSTRAINT acts_route_known; ALTER TABLE acts DROP COLUMN route"); }
    finally { await owner.end(); }
    __forgetProvenanceProbe();
    assert.equal(await actsHaveProvenance(api), false);
    const d = await withRoute("mcp", () => insertAct(api, row("rei")));
    assert.ok(Number(d) > Number(c), "the act still lands");
  } finally { __forgetProvenanceProbe(); await api.end(); await s.stop(); }
});
