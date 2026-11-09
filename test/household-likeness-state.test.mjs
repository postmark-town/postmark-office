// household-likeness-state.test.mjs — a household's likeness REQUEST, SELECTED PROOF and OFFICIAL POINTER (POS-726 slice B).
//
// Every house, handle, login, id and proof here is INVENTED. The sentinels (GH-SENTINEL ids, "secret-sentinel" logins) exist to be
// searched for in the public print.
//
//   § 1  the pure transitions: versions, history, withdrawal, answer gating, proof shape
//   § 2  the writer on a store: request -> select -> replace -> withdraw, the answer stays the one permission
//   § 3  refusals: no/unanswered, another house, an unbound account, a store without 092, a moved row
//   § 4  the renders: the public print and the registry carry the pointer only, never the request/selection/history/account
//   § 5  the use gate and the drain law
//
//   node --test test/household-likeness-state.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { rowsFromRegistry, registryFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { publicRegistry, publicHouse } from "../src/registry-public.mjs";
import { changeLikenessState, setLikeness, officialLikenessFor } from "../src/likeness.mjs";
import { setLikenessState } from "../src/registry-store.mjs";
import {
  requestLikeness, selectProof, withdrawLikeness, nextVersion, ownerLikeness, officialUse, stateOf, PROOF_URL,
} from "../src/household-likeness-state.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";

const TMP = mkdtempSync(join(tmpdir(), "postmark-likeness-state-"));
after(() => rmSync(TMP, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const KEEPER = { login: "secret-sentinel-keeper", id: 7770001 };
const SECOND = { login: "secret-sentinel-second", id: 7770002 };
const STRANGER = { login: "secret-sentinel-other", id: 7770003 };
const REGISTRY = { schema_version: 1, note: "invented for POS-726 slice B", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER, SECOND], residents: ["ash", "birch"] },
  "frost-hall": { name: "Frost Hall", since: "2026-08-03", declared_by: "fern", accounts: [STRANGER], residents: ["fern"] },
} };
const PINS = { ash: { login: KEEPER.login, id: KEEPER.id }, birch: { login: KEEPER.login, id: KEEPER.id }, fern: { login: STRANGER.login, id: STRANGER.id } };
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));
const P1 = "https://media.postmark.town/proofs/ember-one.png";
const P2 = "https://media.postmark.town/proofs/ember-two.png";
const P3 = "https://media.postmark.town/proofs/ember-three.png";
const T = (n) => () => new Date(Date.UTC(2026, 10, 9, 12, n));
const ctx = (over = {}) => ({ answer: "yes", residents: ["ash", "birch"], now: T(0)(), ghId: KEEPER.id, ghLogin: KEEPER.login, ...over });

async function withStore(fn, pool = makePool(seed())) {
  __setPoolForTest(pool);
  const was = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, RECORD_ON);
  try { return await fn(pool); }
  finally {
    __setPoolForTest(null);
    if (was.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = was.pg;
    if (was.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = was.url;
  }
}
const drains = (seen) => async () => { seen.push("drained"); return { ran: true, commit: "c0ffee" }; };
const act = (pool, kind, args, who = KEEPER, extra = {}, slug = "ember-lane", n = 0) =>
  changeLikenessState({ slug, kind, args, ghId: who.id, ghLogin: who.login },
    { drain: drains(extra.seen ?? []), now: T(n), ...extra });
const rowOf = (pool, slug = "ember-lane") => pool.state.households.find((r) => r.slug === slug);
const say = (pool, answer, slug = "ember-lane") => { rowOf(pool, slug).likeness = { answer, at: "2026-11-09T11:00:00.000Z", by: "x", gh_id: KEEPER.id, words: "1" }; };

// ── § 1 pure transitions ────────────────────────────────────────────────────

test("§ 1 a request is not a selection: it makes no official pointer and no selection", () => {
  const s = requestLikeness(null, { depicts: "ash" }, ctx());
  assert.deepEqual(Object.keys(s), ["request"]);
  assert.equal(s.official, undefined);
  assert.equal(officialUse({ likeness: { answer: "yes" }, likeness_state: s }), null, "a yes plus a request is still nothing official");
});

test("§ 1 selection makes the next version; replacement keeps history; versions are never reused", () => {
  let s = requestLikeness(null, { depicts: "ash" }, ctx());
  s = selectProof(s, { proof: P1 }, ctx({ now: T(1)() }));
  assert.equal(s.official.version, 1); assert.equal(s.official.proof, P1); assert.equal(s.official.depicts, "ash");
  s = selectProof(s, { proof: P2 }, ctx({ now: T(2)() }));
  assert.equal(s.official.version, 2);
  assert.deepEqual(s.history.map((h) => [h.version, h.proof, h.ended]), [[1, P1, "replaced"]]);
  s = withdrawLikeness(s, {}, ctx({ now: T(3)() }));
  assert.equal(s.official, undefined); assert.equal(s.selected, undefined, "withdrawal clears the selection");
  assert.deepEqual(s.history.map((h) => [h.version, h.ended]), [[1, "replaced"], [2, "withdrawn"]]);
  assert.equal(nextVersion(s), 3, "a withdrawn version is not reused");
  s = selectProof(s, { proof: P3 }, ctx({ now: T(4)() }));
  assert.equal(s.official.version, 3);
});

test("§ 1 a new request leaves an older official pointer and its selection alone", () => {
  let s = selectProof(requestLikeness(null, { depicts: "ash" }, ctx()), { proof: P1 }, ctx());
  const again = requestLikeness(s, { depicts: "birch" }, ctx({ now: T(5)() }));
  assert.deepEqual(again.official, s.official);
  assert.deepEqual(again.selected, s.selected);
  assert.equal(again.request.depicts, "birch");
});

test("§ 1 answer gating: no and unanswered block request and select; withdrawal is always allowed", () => {
  for (const answer of ["no", null]) {
    assert.throws(() => requestLikeness(null, { depicts: "ash" }, ctx({ answer })), (e) => e.code === 409);
    assert.throws(() => selectProof({ request: { depicts: "ash" } }, { proof: P1 }, ctx({ answer })), (e) => e.code === 409);
  }
  const s = selectProof(requestLikeness(null, { depicts: "ash" }, ctx()), { proof: P1 }, ctx());
  assert.doesNotThrow(() => withdrawLikeness(s, {}, ctx({ answer: "no" })));
});

test("§ 1 select needs a request, a media-door proof, and a different proof than the official one", () => {
  assert.throws(() => selectProof(null, { proof: P1 }, ctx()), (e) => e.code === 409, "no request first");
  const r = requestLikeness(null, { depicts: "ash" }, ctx());
  for (const proof of ["", undefined, "http://media.postmark.town/a/b.png", "https://evil.example/proofs/x.png", "https://media.postmark.town/", "data:image/png;base64,AAAA", "https://media.postmark.town.evil.example/a/b"])
    assert.throws(() => selectProof(r, { proof }, ctx()), (e) => e.code === 422, `${proof} is no proof`);
  assert.ok(PROOF_URL.test(P1));
  const s = selectProof(r, { proof: P1 }, ctx());
  assert.throws(() => selectProof(s, { proof: P1 }, ctx()), (e) => e.code === 409, "the same proof twice spends no version");
});

test("§ 1 a request names one of the house's residents and needs a sign-in", () => {
  assert.throws(() => requestLikeness(null, { depicts: "stranger" }, ctx()), (e) => e.code === 422);
  assert.throws(() => requestLikeness(null, {}, ctx()), (e) => e.code === 422);
  assert.throws(() => requestLikeness(null, { depicts: "ash" }, ctx({ ghId: null })), (e) => e.code === 401);
});

test("§ 1 stateOf reads garbage as nothing and holds shapes", () => {
  for (const g of [null, "x", [], 3, {}]) assert.equal(stateOf(g), null);
  assert.equal(stateOf({ official: { version: "1", proof: P1 } }), null, "an official without an integer version is no pointer");
  assert.deepEqual(stateOf({ official: { version: 1, proof: P1, since: "s", depicts: "ash", extra: "x" } }).official, { version: 1, proof: P1, since: "s", depicts: "ash" });
});

// ── § 2 the writer on a store ───────────────────────────────────────────────

test("§ 2 request -> select -> replace -> withdraw, writer to read to render, and the answer stays the permission", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    const seen = [];
    const r = await act(pool, "request", { depicts: "ash" }, KEEPER, { seen });
    assert.equal(r.official, null); assert.deepEqual(seen, [], "a request prints nothing public: no drain");
    assert.equal(r.likeness.request.depicts, "ash");

    const s1 = await act(pool, "select", { proof: P1 }, SECOND, { seen }, "ember-lane", 1);   // the second bound account may act
    assert.equal(s1.official.version, 1); assert.deepEqual(seen, ["drained"]);
    assert.equal(s1.registry.rendered, true);

    // a new request while P1 is official: the pointer stands, nothing drains
    await act(pool, "request", { depicts: "birch" }, KEEPER, { seen }, "ember-lane", 2);
    assert.equal(rowOf(pool).likeness_state.official.proof, P1);
    assert.deepEqual(seen, ["drained"]);

    const s2 = await act(pool, "select", { proof: P2 }, KEEPER, { seen }, "ember-lane", 3);
    assert.equal(s2.official.version, 2); assert.equal(s2.official.depicts, "birch");
    assert.deepEqual(rowOf(pool).likeness_state.history.map((h) => h.ended), ["replaced"]);

    const w = await act(pool, "withdraw", {}, KEEPER, { seen }, "ember-lane", 4);
    assert.equal(w.official, null);
    assert.deepEqual(rowOf(pool).likeness_state.history.map((h) => h.ended), ["replaced", "withdrawn"]);
    assert.equal(seen.length, 3, "select, replace and withdraw each changed the public pointer: three drains");
    assert.equal(rowOf(pool).likeness.answer, "yes", "the answer is the existing one, untouched by any of it");
  });
});

test("§ 2 the existing consent writer stays authoritative: a no hides the pointer, a yes brings it back, no state write needed", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await act(pool, "request", { depicts: "ash" }); await act(pool, "select", { proof: P1 });
    await setLikeness({ slug: "ember-lane", answer: "no", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: drains([]), now: T(9) });
    const before = JSON.stringify(rowOf(pool).likeness_state);
    assert.equal(officialUse(rowOf(pool)), null, "no blocks future official use");
    assert.equal(await officialLikenessFor("ash"), null);
    assert.equal(JSON.stringify(rowOf(pool).likeness_state), before, "the stored pointer survives a no");
    await assert.rejects(act(pool, "request", { depicts: "ash" }), (e) => e.code === 409);
    await assert.rejects(act(pool, "select", { proof: P2 }), (e) => e.code === 409);
    await setLikeness({ slug: "ember-lane", answer: "yes", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: drains([]), now: T(10) });
    assert.equal((await officialLikenessFor("ash")).proof, P1);
  });
});

// ── § 3 refusals ────────────────────────────────────────────────────────────

test("§ 3 unanswered blocks; cross-household and unbound accounts refuse and write nothing", async () => {
  await withStore(async (pool) => {
    await assert.rejects(act(pool, "request", { depicts: "ash" }), (e) => e.code === 409, "unanswered");
    say(pool, "yes"); say(pool, "yes", "frost-hall");
    const before = JSON.stringify(pool.state.households);
    await assert.rejects(act(pool, "request", { depicts: "ash" }, STRANGER), (e) => e.code === 403, "an account of another house");
    await assert.rejects(act(pool, "request", { depicts: "fern" }, KEEPER, {}, "frost-hall"), (e) => e.code === 403, "writing into another house");
    await assert.rejects(act(pool, "request", { depicts: "ash" }, { id: null, login: null }), (e) => e.code === 401);
    await assert.rejects(act(pool, "request", { depicts: "ash" }, KEEPER, {}, "no-such-house"), (e) => e.code === 404);
    await assert.rejects(changeLikenessState({ slug: "ember-lane", kind: "grant", ghId: KEEPER.id }, {}), (e) => e.code === 422);
    assert.equal(JSON.stringify(pool.state.households), before, "nothing was written");
  });
});

test("§ 3 the store's own write refuses the wrong account, a moved row and a missing yes", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    const to = { request: { depicts: "ash" } };
    assert.deepEqual(await setLikenessState({ slug: "ember-lane", from: null, to, ghId: STRANGER.id, needsYes: true }), { slug: null });
    assert.deepEqual(await setLikenessState({ slug: "ember-lane", from: { request: { depicts: "birch" } }, to, ghId: KEEPER.id, needsYes: true }), { slug: null }, "stale from: compare-and-swap");
    say(pool, "no");
    assert.deepEqual(await setLikenessState({ slug: "ember-lane", from: null, to, ghId: KEEPER.id, needsYes: true }), { slug: null }, "the yes is checked in the row at the write");
    assert.deepEqual(await setLikenessState({ slug: "ember-lane", from: null, to, ghId: KEEPER.id, needsYes: false }), { slug: "ember-lane" });
  });
});

test("§ 3 a row that moved under the writer is re-read and the write retried; a row that keeps moving is refused", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    let calls = 0;
    const racing = async (a, env) => { if (calls++ === 0) rowOf(pool).likeness_state = { request: { at: "x", by: "o", gh_id: 1, depicts: "birch" } }; return setLikenessState(a, env); };
    const done = await act(pool, "request", { depicts: "ash" }, KEEPER, { write: racing });
    assert.equal(calls, 2); assert.equal(done.likeness.request.depicts, "ash");
    const never = async () => ({ slug: null });
    await assert.rejects(act(pool, "request", { depicts: "ash" }, KEEPER, { write: never }), (e) => e.code === 409 && /changed while/.test(e.defect));
  });
});

test("§ 3 a store without 092 says 503 and keeps nothing", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    const missing = async () => ({ missingColumn: true });
    await assert.rejects(act(pool, "request", { depicts: "ash" }, KEEPER, { write: missing }), (e) => e.code === 503);
    assert.equal(rowOf(pool).likeness_state ?? null, null);
  });
});

// ── § 4 the renders ─────────────────────────────────────────────────────────

test("§ 4 the public print and the public registry carry the pointer only: no request, selection, history or account", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await act(pool, "request", { depicts: "ash" }); await act(pool, "select", { proof: P1 }, KEEPER, {}, "ember-lane", 1);
    await act(pool, "select", { proof: P2 }, KEEPER, {}, "ember-lane", 2);
    await act(pool, "request", { depicts: "birch" }, KEEPER, {}, "ember-lane", 3);   // a new, unselected request
    const rows = { ...seed(), households: pool.state.households };
    const printed = renderPublicRegistry(rows).households;
    const house = JSON.parse(printed).households["ember-lane"];
    assert.deepEqual(house.likeness_official, { version: 2, proof: P2, since: house.likeness_official.since, depicts: "ash" });
    // accounts (login, id) are already public in the households file; what must not appear is the request, the selection, the history
    // (the replaced proof) and the request's own stamp.
    for (const leak of ['"request"', '"selected"', '"history"', "likeness_state", P1.split("/").pop(), "2026-11-09T12:03", '"ended"'])
      assert.equal(printed.includes(leak), false, `no ${leak} in the public print`);
    assert.equal(/"gh_id"/.test(JSON.stringify(house.likeness_official)), false);
    const pub = publicRegistry(registryFromRows(rows)).households["ember-lane"];
    assert.deepEqual(Object.keys(pub.likeness_official), ["version", "proof", "since", "depicts"]);
    assert.equal(Object.hasOwn(pub, "likeness_state"), false);
    assert.equal(JSON.stringify(publicRegistry(registryFromRows(rows))).includes("history"), false);
  });
});

test("§ 4 an unselected request alone prints nothing public; a no prints nothing; frost-hall is untouched", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await act(pool, "request", { depicts: "ash" });
    const rows = () => ({ ...seed(), households: pool.state.households });
    let printed = renderPublicRegistry(rows()).households;
    assert.equal(printed.includes("likeness_official"), false);
    assert.equal(printed.includes("request"), false);
    await act(pool, "select", { proof: P1 }, KEEPER, {}, "ember-lane", 1);
    say(pool, "no");
    printed = renderPublicRegistry(rows()).households;
    assert.equal(printed.includes("likeness_official"), false, "a no removes the public pointer");
    assert.equal(publicHouse(registryFromRows(rows()).households["frost-hall"]).likeness_official, undefined);
  });
});

test("§ 4 the owner view carries everything; the public projection is not that view", () => {
  const rec = { likeness: { answer: "yes" }, likeness_state: selectProof(requestLikeness(null, { depicts: "ash" }, ctx()), { proof: P1 }, ctx()) };
  assert.deepEqual(Object.keys(ownerLikeness(rec)), ["answer", "request", "selected", "official", "history"]);
  assert.deepEqual(Object.keys(officialUse(rec)), ["version", "proof", "since", "depicts"]);
  assert.notDeepEqual(ownerLikeness(rec), officialUse(rec));
});

// ── § 5 the drain law ───────────────────────────────────────────────────────

test("§ 5 renderPublicRegistry(rowsFromRegistry(files)) === files with a pointer, and a private round trip keeps the state", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await act(pool, "request", { depicts: "ash" }); await act(pool, "select", { proof: P1 }, KEEPER, {}, "ember-lane", 1);
    const files = renderPublicRegistry({ ...seed(), households: pool.state.households });
    const again = renderPublicRegistry(rowsFromRegistry(JSON.parse(files.households), JSON.parse(files.pins ?? "{}")));
    assert.equal(again.households, files.households, "the drain law holds with a pointer");
    const folded = rowsFromRegistry(JSON.parse(files.households), {}).households.find((r) => r.slug === "ember-lane");
    assert.equal(folded.likeness_state.official.proof, P1, "the file key folds back into the column");
  });
});

test("§ 5 the use gate: yes and a pointer, for a resident of the house; nothing for others", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    assert.equal(await officialLikenessFor("ash"), null, "no pointer yet");
    await act(pool, "request", { depicts: "ash" }); await act(pool, "select", { proof: P1 }, KEEPER, {}, "ember-lane", 1);
    assert.deepEqual(Object.keys(await officialLikenessFor("birch")), ["household", "version", "proof", "since", "depicts"]);
    assert.equal(await officialLikenessFor("fern"), null);
    assert.equal(await officialLikenessFor("nobody"), null);
  });
});

// ── § 6 the screen ──────────────────────────────────────────────────────────

import { questionPage, stateChangedPage } from "../src/likeness-pages.mjs";

test("§ 6 the signed-in screen offers request/select/withdraw only as the state allows, and escapes what it shows", () => {
  const page = (answer, state) => questionPage({ login: "x", houseName: "Ember Lane", residents: ["ash", "birch"], answer, action: "/oauth/likeness", pendingId: "p1", nonce: "n1", state });
  const none = page(null, ownerLikeness({ likeness: null }));
  assert.equal(/name="decision" value="(request|select|withdraw)"/.test(none), false, "unanswered: no picture controls");
  const yes = page("yes", ownerLikeness({ likeness: { answer: "yes" } }));
  assert.match(yes, /value="request"/); assert.equal(/value="select"/.test(yes), false);
  const evil = '"><script>alert(1)</script>';
  const rec = { likeness: { answer: "yes" }, likeness_state: { request: { at: "t", by: evil, gh_id: 1, depicts: "ash" }, official: { version: 1, proof: P1 + "?x=<b>", since: "t", depicts: "ash" }, history: [] } };
  const full = page("yes", ownerLikeness(rec));
  assert.match(full, /value="select"/); assert.match(full, /value="withdraw"/);
  assert.equal(full.includes("<script>alert(1)"), false, "everything shown is escaped");
  assert.equal(full.includes("<b>"), false);
  const done = stateChangedPage({ kind: "select", state: ownerLikeness(rec), official: officialUse(rec), rendered: true, login: "x" });
  assert.equal(typeof done, "string");
});
