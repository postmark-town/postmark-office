// household-likeness-state.test.mjs — a household's likeness REQUEST and its READ-ONLY OFFICIAL POINTER (POS-726 slice B).
//
// Wright 2026-11-09 12:43Z: the request record and the current-official pointer as a read-only field with NO writer in B; no selectProof and
// no write path that can publish any media URL; depicts is roster handles, validated on write, never free text; nothing from a request is
// copied into a public key. Every house, handle, login, id and proof here is INVENTED. The fixture pointer is SEEDED into the row by the
// test itself, because nothing in B can write one: that is the point.
//
//   § 1  the pure request: roster validation, the answer gate, the pointer left alone
//   § 2  the writer on a store: request -> read -> render, and every attempt at the pointer
//   § 3  refusals: no/unanswered, another house, an unbound account, a store without 092, a moved row
//   § 4  the renders: the public print and the registry carry the pointer only, and only for a named resident
//   § 5  the use gate and the drain law
//   § 6  the screen
//   § 7  no writer of the pointer exists
//
//   node --test test/household-likeness-state.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { rowsFromRegistry, registryFromRows, renderPublicRegistry } from "../src/registry-rows.mjs";
import { publicRegistry, publicHouse } from "../src/registry-public.mjs";
import { requestLikenessState, setLikeness, officialLikenessFor } from "../src/likeness.mjs";
import { setLikenessRequest } from "../src/registry-store.mjs";
import * as State from "../src/household-likeness-state.mjs";
import { requestLikeness, ownerLikeness, officialUse, officialUseFor, stateOf, PROOF_URL } from "../src/household-likeness-state.mjs";
import { questionPage, stateChangedPage } from "../src/likeness-pages.mjs";
import { __setPoolForTest } from "../src/world2-acts.mjs";
import { makePool, RECORD_ON } from "./registry-pool-stub.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const KEEPER = { login: "secret-sentinel-keeper", id: 7770001 };
const SECOND = { login: "secret-sentinel-second", id: 7770002 };
const STRANGER = { login: "secret-sentinel-other", id: 7770003 };
const REGISTRY = { schema_version: 1, note: "invented for POS-726 slice B", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "ash", accounts: [KEEPER, SECOND], residents: ["ash", "birch", "cedar"] },
  "frost-hall": { name: "Frost Hall", since: "2026-08-03", declared_by: "fern", accounts: [STRANGER], residents: ["fern"] },
} };
const PINS = { ash: { login: KEEPER.login, id: KEEPER.id }, birch: { login: KEEPER.login, id: KEEPER.id }, cedar: { login: KEEPER.login, id: KEEPER.id },
  fern: { login: STRANGER.login, id: STRANGER.id } };
const seed = () => rowsFromRegistry(structuredClone(REGISTRY), structuredClone(PINS));
const P1 = "https://media.postmark.town/proofs/ember-one.png";
/** A pointer as a LATER service would publish it. Only a test can put one in a row here. */
const POINTER = { version: 4, proof: P1, since: "2026-11-01T10:00:00.000Z", depicts: ["ash"] };
const HISTORY = [{ version: 3, proof: "https://media.postmark.town/proofs/old.png", since: "2026-10-01T10:00:00.000Z", until: "2026-11-01T10:00:00.000Z", ended: "replaced" }];
const T = (n) => () => new Date(Date.UTC(2026, 10, 9, 12, n));
const ctx = (over = {}) => ({ answer: "yes", residents: ["ash", "birch", "cedar"], now: T(0)(), ghId: KEEPER.id, ghLogin: KEEPER.login, ...over });

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
const rowOf = (pool, slug = "ember-lane") => pool.state.households.find((r) => r.slug === slug);
const say = (pool, answer, slug = "ember-lane") => { rowOf(pool, slug).likeness = { answer, at: "2026-11-09T11:00:00.000Z", by: "x", gh_id: KEEPER.id, words: "1" }; };
const plant = (pool, slug = "ember-lane", extra = {}) => { rowOf(pool, slug).likeness_state = { official: structuredClone(POINTER), history: structuredClone(HISTORY), ...extra }; };
const ask = (depicts, who = KEEPER, slug = "ember-lane", n = 0, extra = {}) =>
  requestLikenessState({ slug, depicts, ghId: who.id, ghLogin: who.login }, { now: T(n), ...extra });

// ── § 1 the pure request ────────────────────────────────────────────────────

test("§ 1 a request is a request: it makes no pointer, and a yes plus a request is nothing official", () => {
  const s = requestLikeness(null, { depicts: "ash" }, ctx());
  assert.deepEqual(Object.keys(s), ["request"]);
  assert.deepEqual(s.request.depicts, ["ash"], "one handle or a list: always stored as a list");
  assert.equal(officialUse({ likeness: { answer: "yes" }, residents: ["ash"], likeness_state: s }), null);
});

test("§ 1 depicts is the household's own roster handles exactly: free text, off-roster, other houses, empties and look-alikes are refused", () => {
  for (const depicts of [undefined, null, "", [], "stranger", "fern", ["ash", "fern"], " ash", "ASH", "ash ", "ash,birch", "<b>ash</b>", { 0: "ash" }, 7, [["ash"]], ["ash", 3], "https://media.postmark.town/proofs/x.png", Array(13).fill("ash")])
    assert.throws(() => requestLikeness(null, { depicts }, ctx()), (e) => e.code === 422, `${JSON.stringify(depicts)} is no roster handle`);
  assert.deepEqual(requestLikeness(null, { depicts: ["birch", "ash", "birch"] }, ctx()).request.depicts, ["birch", "ash"], "a duplicate names one resident once");
});

test("§ 1 answer gating: no and unanswered block a request; a sign-in is needed", () => {
  for (const answer of ["no", null]) assert.throws(() => requestLikeness(null, { depicts: "ash" }, ctx({ answer })), (e) => e.code === 409);
  assert.throws(() => requestLikeness(null, { depicts: "ash" }, ctx({ ghId: null })), (e) => e.code === 401);
});

test("§ 1 a new request leaves a stored pointer and history exactly as found, whatever shape they are", () => {
  for (const stored of [{ official: POINTER, history: HISTORY }, { official: { version: "x", proof: 3, odd: true }, history: "odd" }]) {
    const next = requestLikeness(stored, { depicts: "birch" }, ctx({ now: T(5)() }));
    assert.deepEqual(next.official, stored.official); assert.deepEqual(next.history, stored.history);
    assert.deepEqual(next.request.depicts, ["birch"], "the request names who IT asks for; the pointer's depicts is not retargeted");
  }
});

test("§ 1 stateOf reads garbage as nothing and holds shapes; a selected key is no fact here", () => {
  for (const g of [null, "x", [], 3, {}]) assert.equal(stateOf(g), null);
  assert.equal(stateOf({ official: { version: "1", proof: P1 } }), null);
  assert.equal(stateOf({ selected: { proof: P1 } }), null, "there is no selection fact in this slice");
  assert.deepEqual(stateOf({ official: { ...POINTER, extra: "x" } }).official, POINTER);
});

// ── § 2 the writer on a store ───────────────────────────────────────────────

test("§ 2 request -> read -> render: kept privately, no drain, nothing public, the answer untouched", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    const done = await ask(["birch"], SECOND);                    // the second bound account may ask
    assert.deepEqual(done.likeness.request, { at: "2026-11-09T12:00:00.000Z", by: SECOND.login, gh_id: SECOND.id, depicts: ["birch"] });
    assert.equal(done.likeness.official, null);
    assert.deepEqual(rowOf(pool).likeness_state.request.depicts, ["birch"]);
    assert.equal(rowOf(pool).likeness.answer, "yes");
    assert.equal(Object.hasOwn(done, "registry"), false, "a request prints nothing the town shows, so there is nothing to drain");
    const printed = renderPublicRegistry({ ...seed(), households: pool.state.households }).households;
    assert.equal(printed.includes("likeness_official"), false);
    assert.equal(printed.includes("request"), false);
  });
});

test("§ 2 a request never makes, moves, retargets or removes the pointer: the stored pointer and history are byte-identical after any request", async () => {
  await withStore(async (pool) => {
    say(pool, "yes"); plant(pool);
    const before = JSON.stringify(rowOf(pool).likeness_state);
    await ask(["birch", "cedar"]); await ask(["ash"], KEEPER, "ember-lane", 1);
    const after = rowOf(pool).likeness_state;
    assert.deepEqual({ official: after.official, history: after.history }, { official: JSON.parse(before).official, history: JSON.parse(before).history }, "(jsonb reorders keys; equality is by value)");
    assert.deepEqual(after.official.depicts, ["ash"], "the pointer still names ash only, after a request for birch and cedar");
    assert.deepEqual(after.request.depicts, ["ash"]);
    assert.deepEqual((await officialLikenessFor("birch")), null, "a request for birch does not give birch an official likeness");
    assert.equal((await officialLikenessFor("ash")).proof, P1);
  });
});

test("§ 2 the store statement itself refuses to write a pointer or history: a writer that tried would match no row", async () => {
  await withStore(async (pool) => {
    say(pool, "yes"); plant(pool);
    const stored = rowOf(pool).likeness_state;
    const req = { at: "t", by: "x", gh_id: KEEPER.id, depicts: ["ash"] };
    const attempts = {
      "a new pointer": { ...stored, request: req, official: { ...POINTER, proof: "https://media.postmark.town/proofs/other.png", version: 5 } },
      "a retargeted pointer": { ...stored, request: req, official: { ...POINTER, depicts: ["ash", "birch"] } },
      "a removed pointer": { request: req, history: stored.history },
      "an edited history": { ...stored, request: req, history: [] },
    };
    for (const [what, to] of Object.entries(attempts))
      assert.deepEqual(await setLikenessRequest({ slug: "ember-lane", from: stored, to, ghId: KEEPER.id, depicts: ["ash"] }), { slug: null }, `${what} writes nothing`);
    assert.deepEqual(rowOf(pool).likeness_state, stored);
    assert.deepEqual(await setLikenessRequest({ slug: "ember-lane", from: stored, to: { ...stored, request: req }, ghId: KEEPER.id, depicts: ["ash"] }), { slug: "ember-lane" });
  });
});

test("§ 2 the existing consent writer stays authoritative: a no hides the pointer and blocks requests; a yes brings the pointer back untouched", async () => {
  await withStore(async (pool) => {
    say(pool, "yes"); plant(pool);
    const before = JSON.stringify(rowOf(pool).likeness_state);
    await setLikeness({ slug: "ember-lane", answer: "no", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: async () => ({ ran: true }), now: T(9) });
    assert.equal(officialUse(rowOf(pool)), null, "no blocks future official use");
    assert.equal(await officialLikenessFor("ash"), null);
    assert.equal(JSON.stringify(rowOf(pool).likeness_state), before, "the stored pointer survives a no");
    await assert.rejects(ask("ash"), (e) => e.code === 409);
    await setLikeness({ slug: "ember-lane", answer: "yes", ghId: KEEPER.id, ghLogin: KEEPER.login }, { drain: async () => ({ ran: true }), now: T(10) });
    assert.equal((await officialLikenessFor("ash")).proof, P1);
  });
});

// ── § 3 refusals ────────────────────────────────────────────────────────────

test("§ 3 unanswered blocks; off-roster, cross-household and unbound accounts refuse and write nothing", async () => {
  await withStore(async (pool) => {
    await assert.rejects(ask("ash"), (e) => e.code === 409, "unanswered");
    say(pool, "yes"); say(pool, "yes", "frost-hall");
    const before = JSON.stringify(pool.state.households);
    await assert.rejects(ask("ash", STRANGER), (e) => e.code === 403, "an account of another house");
    await assert.rejects(ask("fern", KEEPER, "frost-hall"), (e) => e.code === 403, "writing into another house");
    await assert.rejects(ask("fern"), (e) => e.code === 422, "another house's resident, in this house");
    await assert.rejects(ask("ash", { id: null, login: null }), (e) => e.code === 401);
    await assert.rejects(ask("ash", KEEPER, "no-such-house"), (e) => e.code === 404);
    await assert.rejects(ask("not-a-resident"), (e) => e.code === 422);
    assert.equal(JSON.stringify(pool.state.households), before, "nothing was written");
  });
});

test("§ 3 the store's own write refuses the wrong account, a moved row, a missing yes and an off-roster handle", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    const to = { request: { depicts: ["ash"] } };
    const w = (o) => setLikenessRequest({ slug: "ember-lane", from: null, to, ghId: KEEPER.id, depicts: ["ash"], ...o });
    assert.deepEqual(await w({ ghId: STRANGER.id }), { slug: null });
    assert.deepEqual(await w({ from: { request: { depicts: ["birch"] } } }), { slug: null }, "stale from: compare-and-swap");
    assert.deepEqual(await w({ depicts: ["ash", "fern"] }), { slug: null }, "the roster is checked in the row at the write");
    say(pool, "no");
    assert.deepEqual(await w({}), { slug: null }, "the yes is checked in the row at the write");
    say(pool, "yes");
    assert.deepEqual(await w({}), { slug: "ember-lane" });
  });
});

test("§ 3 a row that moved under the writer is re-read and the write retried; a row that keeps moving is refused", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    let calls = 0;
    const racing = async (a, env) => { if (calls++ === 0) rowOf(pool).likeness_state = { request: { at: "x", by: "o", gh_id: 1, depicts: ["birch"] } }; return setLikenessRequest(a, env); };
    const done = await ask("ash", KEEPER, "ember-lane", 0, { write: racing });
    assert.equal(calls, 2); assert.deepEqual(done.likeness.request.depicts, ["ash"]);
    await assert.rejects(ask("ash", KEEPER, "ember-lane", 0, { write: async () => ({ slug: null }) }), (e) => e.code === 409 && /changed while/.test(e.defect));
  });
});

test("§ 3 a store without 092 says 503 and keeps nothing", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await assert.rejects(ask("ash", KEEPER, "ember-lane", 0, { write: async () => ({ missingColumn: true }) }), (e) => e.code === 503);
    assert.equal(rowOf(pool).likeness_state ?? null, null);
  });
});

// ── § 4 the renders ─────────────────────────────────────────────────────────

test("§ 4 the public print carries the pointer only: no request, no history, no account of the clicker, nothing copied from a request", async () => {
  await withStore(async (pool) => {
    say(pool, "yes"); plant(pool);
    await ask(["birch", "cedar"]);                                 // a new, different request beside the planted pointer
    const rows = { ...seed(), households: pool.state.households };
    const printed = renderPublicRegistry(rows).households;
    const house = JSON.parse(printed).households["ember-lane"];
    assert.deepEqual(house.likeness_official, POINTER, "the pointer, as it is, naming ash only");
    for (const leak of ['"request"', '"history"', "likeness_state", '"ended"', "old.png", "2026-11-09T12:00"])
      assert.equal(printed.includes(leak), false, `no ${leak} in the public print`);
    const pub = publicRegistry(registryFromRows(rows)).households["ember-lane"];
    assert.deepEqual(Object.keys(pub.likeness_official), ["version", "proof", "since", "depicts"]);
    assert.equal(Object.hasOwn(pub, "likeness_state"), false);
    assert.equal(JSON.stringify(publicRegistry(registryFromRows(rows))).includes("history"), false);
  });
});

test("§ 4 a request alone prints nothing; a no prints nothing; a malformed or foreign pointer prints nothing; another house is untouched", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    await ask("ash");
    const print = () => renderPublicRegistry({ ...seed(), households: pool.state.households }).households;
    assert.equal(print().includes("likeness_official"), false, "no pointer yet: nothing official shows");
    plant(pool);
    assert.equal(print().includes("likeness_official"), true);
    say(pool, "no");
    assert.equal(print().includes("likeness_official"), false, "a no removes the public pointer");
    say(pool, "yes");
    for (const bad of [{ ...POINTER, proof: "https://evil.example/a/b.png" }, { ...POINTER, proof: "javascript:alert(1)" }, { ...POINTER, depicts: ["fern"] }, { ...POINTER, depicts: [] }, { ...POINTER, depicts: "ash" }, { ...POINTER, depicts: ["ash", "stranger"] }]) {
      rowOf(pool).likeness_state = { official: bad };
      assert.equal(print().includes("likeness_official"), false, `${JSON.stringify(bad.depicts)} ${bad.proof} is not a usable pointer`);
    }
    assert.equal(publicHouse(registryFromRows({ ...seed(), households: pool.state.households }).households["frost-hall"]).likeness_official, undefined);
  });
});

test("§ 4 the owner view carries the request and the pointer; the public projection is not that view", () => {
  const rec = { likeness: { answer: "yes" }, residents: ["ash", "birch"], likeness_state: { request: requestLikeness(null, { depicts: "birch" }, ctx()).request, official: POINTER, history: HISTORY } };
  assert.deepEqual(Object.keys(ownerLikeness(rec)), ["answer", "request", "official"]);
  assert.deepEqual(Object.keys(officialUse(rec)), ["version", "proof", "since", "depicts"]);
  assert.notDeepEqual(ownerLikeness(rec), officialUse(rec));
});

// ── § 5 the use gate and the drain law ──────────────────────────────────────

test("§ 5 the use gate: yes, a well-formed pointer, and the pointer NAMING that resident: never the whole household", async () => {
  await withStore(async (pool) => {
    say(pool, "yes");
    assert.equal(await officialLikenessFor("ash"), null, "no pointer yet");
    plant(pool);
    const got = await officialLikenessFor("ash");
    assert.deepEqual(Object.keys(got), ["household", "version", "proof", "since", "depicts"]);
    for (const other of ["birch", "cedar", "fern", "nobody"]) assert.equal(await officialLikenessFor(other), null, `${other} is not named by the pointer`);
    rowOf(pool).likeness_state = { official: { ...POINTER, depicts: ["ash", "cedar"] } };
    assert.notEqual(await officialLikenessFor("cedar"), null);
    assert.equal(await officialLikenessFor("birch"), null);
  });
});

test("§ 5 renderPublicRegistry(rowsFromRegistry(files)) === files with a pointer, and the file key folds back into the column", async () => {
  await withStore(async (pool) => {
    say(pool, "yes"); plant(pool);
    const files = renderPublicRegistry({ ...seed(), households: pool.state.households });
    const again = renderPublicRegistry(rowsFromRegistry(JSON.parse(files.households), JSON.parse(files.pins ?? "{}")));
    assert.equal(again.households, files.households, "the drain law holds with a pointer");
    const folded = rowsFromRegistry(JSON.parse(files.households), {}).households.find((r) => r.slug === "ember-lane");
    assert.deepEqual(folded.likeness_state.official, POINTER);
  });
});

// ── § 6 the screen ──────────────────────────────────────────────────────────

test("§ 6 the signed-in screen offers ONE thing, a request, and shows nothing official until a pointer exists; everything shown is escaped", () => {
  const page = (answer, state) => questionPage({ login: "x", houseName: "Ember Lane", residents: ["ash", "birch"], answer, action: "/oauth/likeness", pendingId: "p1", nonce: "n1", state });
  const decisions = (h) => [...h.matchAll(/name="decision" value="([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(decisions(page(null, ownerLikeness({ likeness: null }))), ["yes", "no"], "unanswered: no request form");
  const yes = page("yes", ownerLikeness({ likeness: { answer: "yes" }, residents: ["ash"] }));
  assert.deepEqual(decisions(yes), ["yes", "no", "request"]);
  assert.equal(yes.includes("official now"), false, "nothing official until a pointer exists");
  const evil = '"><script>alert(1)</script>';
  const rec = { likeness: { answer: "yes" }, residents: ["ash", "birch"], likeness_state: { request: { at: "t", by: evil, gh_id: 1, depicts: ["ash"] }, official: POINTER } };
  const full = page("yes", ownerLikeness(rec));
  assert.deepEqual(decisions(full), ["yes", "no", "request"], "with a pointer present there is still no choose, replace or withdraw door");
  assert.match(full, /official now/);
  assert.equal(full.includes("<script>alert(1)"), false);
  assert.equal(/name="proof"|type="text"/.test(full), false, "no media URL input anywhere");
  assert.equal(typeof stateChangedPage({ state: ownerLikeness(rec), login: "x" }), "string");
});

// ── § 7 no writer of the pointer exists ─────────────────────────────────────

test("§ 7 nothing exports a way to choose, change or withdraw an official pointer, and no source file names one", () => {
  const names = Object.keys(State).concat(Object.keys(await_likeness()));
  for (const n of names) assert.equal(/select|withdraw|setOfficial|publishOfficial|official.*(set|write|change)/i.test(n) && !/^officialUse(For)?$|^officialLikenessFor$|PUBLIC_OFFICIAL|OFFICIAL_KEYS/.test(n), false, `${n} would be a pointer writer`);
  const src = ["household-likeness-state.mjs", "likeness.mjs", "registry-store.mjs", "likeness-pages.mjs", "oauth.mjs"].map((f) => readFileSync(join(ROOT, "src", f), "utf8")).join("\n");
  assert.equal(/selectProof|withdrawLikeness|changeLikenessState|setLikenessState/.test(src), false);
  assert.equal(/value="(select|withdraw)"/.test(src), false);
  const store = readFileSync(join(ROOT, "src", "registry-store.mjs"), "utf8");
  assert.equal([...store.matchAll(/SET\s+likeness_state\s*=/g)].length, 1, "one statement sets the column, and it is the request writer");
  for (const f of readdirSync(join(ROOT, "src")).filter((f) => f.endsWith(".mjs") && f !== "registry-store.mjs"))
    assert.equal(/SET\s+likeness_state\b/.test(readFileSync(join(ROOT, "src", f), "utf8")), false, `${f} writes the column`);
  assert.equal(PROOF_URL.test(P1), true);
});
import * as LikenessModule from "../src/likeness.mjs";
function await_likeness() { return LikenessModule; }
