// pos757-reports.test.mjs — residents can report a resident or ask the town to
// adjudicate, and the report is private (POS-757).
//
// RULED (Darko, 2026-10-22 17:53 EDT): one post class, `report`:
// town { do: "post", args: { class: "report", about, body, asks? } }. The town's
// hands move it filed → heard → resolved (or dismissed), with a note. No stake,
// no stamps, no new tool. Private: the filing household and the town's hands
// read it, it is never on the public record, the site or any public post list,
// and the household it is about is not told at filing.
//
// WHAT IS ON TRIAL, on a real Postgres with every migration (084 included):
//   FILE      a resident files through the town door; the row is the filer's
//             household's, its id names neither filer nor words.
//   NO TRACE  filing writes no `acts` row and no `posts` row, so nothing reaches
//             the STATE/log journal, the notary, /ops/activity or a posts read;
//             `snapshot_reader` cannot read the table at all.
//   PUBLIC    the keyless posts read (MCP, GET /posts) refuses the class, and the
//             household posts read (and with it the doorstep) never lists one.
//   PRIVATE   the filer's household reads it; the household it is about and a
//             stranger read nothing, and a report they may not read answers
//             exactly as one that does not exist.
//   HANDS     only wright, keemin and the Worldkeeper move it, one legal step
//             at a time, each with a note the filer reads.
//   LAW       about, body, asks, stamps and stray fields are judged by name;
//             amend and close are refused; explain: "report" teaches the fields.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/pos757-reports.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "reports_test" });
after(() => store.stop?.());
const skip = store.skip ?? false;

const asRole = async (role, sql, params = []) => {
  const c = await store.connect(role);
  try { return (await c.query(sql, params)).rows; } finally { await c.end(); }
};
const asOwner = (sql, params) => asRole("world2_owner", sql, params);

let callTool, postsAtOffice, householdPosts, amendAtTown, closeAtTown, REPORT_EXPLAIN;
if (!skip) {
  await asOwner("TRUNCATE households, household_pins CASCADE");
  await asOwner(
    `INSERT INTO households (slug, ord, name, residents, since, declared_by)
     VALUES ('hearth', 0, 'The Hearth', ARRAY['alpha','aleph'], '2026-08-01', 'alpha'),
            ('yonder', 1, 'Yonder', ARRAY['beta'], '2026-08-01', 'beta'),
            ('third', 2, 'Third', ARRAY['gamma'], '2026-08-01', 'gamma'),
            ('starforge', 3, 'Starforge', ARRAY['wright','worldkeeper'], '2026-08-01', 'wright')`);
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = store.url("office_api");
  ({ callTool } = await import("../src/mcp.mjs"));
  ({ postsAtOffice } = await import("../src/town-posts.mjs"));
  ({ householdPosts } = await import("../src/household-posts.mjs"));
  ({ amendAtTown, closeAtTown } = await import("../src/events-store.mjs"));
  ({ REPORT_EXPLAIN } = await import("../src/reports.mjs"));
}

const hearth = { household: "house-a", handles: new Set(["alpha", "aleph"]) };
const aleph = { household: "house-a", handles: new Set(["aleph"]) };
const yonder = { household: "house-b", handles: new Set(["beta"]) };
const third = { household: "house-c", handles: new Set(["gamma"]) };
const founders = { household: "the-founders", handles: new Set(["wright", "worldkeeper"]) };
const worldkeeper = { household: "the-founders", handles: new Set(["worldkeeper"]) };

const town = (args, key) => callTool("town", args, { key });
const file = (args, key = hearth) => town({ do: "post", args: { class: "report", ...args }, handle: "alpha" }, key);
const read = (args, key) => town({ read: "posts", args: { class: "report", ...args } }, key);
const move = (args, key = founders) => town({ do: "advance", args: { class: "report", ...args }, handle: "wright" }, key);
const fresh = () => asOwner("TRUNCATE reports");
const count = async (sql) => Number((await asOwner(sql))[0].n);

// ── FILE ─────────────────────────────────────────────────────────────────────

test("FALSIFIER: a resident files a report through the town door, as its household's, under an opaque id", { skip }, async () => {
  await fresh();
  const r = await file({ about: "beta", body: "They keep leaving marks on our parcel.", asks: "adjudication" });
  assert.equal(r.did, "post", JSON.stringify(r).slice(0, 400));
  const filed = r.result;
  assert.match(filed.filed, /^report\/[0-9a-f]{8}$/, "the id is opaque");
  assert.equal(filed.report.state, "filed");
  assert.equal(filed.report.asks, "adjudication");
  assert.equal(filed.report.filed_by, "alpha");
  assert.match(filed.note, /private/);
  const [row] = await asOwner("SELECT * FROM reports WHERE id = $1", [filed.filed]);
  assert.equal(row.household, "hh:hearth");
  assert.equal(row.about_household, "hh:yonder");
  assert.doesNotMatch(row.id, /alpha|beta|marks/, "the id carries neither the filer nor the words");
});

// ── NO TRACE ─────────────────────────────────────────────────────────────────

test("FALSIFIER: filing and moving a report writes no act and no post, so no public record can carry it", { skip }, async () => {
  await fresh();
  const acts = await count("SELECT count(*) AS n FROM acts");
  const posts = await count("SELECT count(*) AS n FROM posts");
  const { result: { filed } } = await file({ about: "yonder", body: "A dispute over the shared path." });
  await move({ post: filed, to: "heard", note: "We have it and will look." });
  assert.equal(await count("SELECT count(*) AS n FROM acts"), acts,
    "a report wrote an act, and every act with a crossing goes to the public STATE/log journal, the notary and /ops/activity");
  assert.equal(await count("SELECT count(*) AS n FROM posts"), posts, "a report wrote a posts row, which the public posts reads and snapshot_reader serve");
  assert.equal(await count("SELECT count(*) AS n FROM reports"), 1);
});

test("the table is office_api's alone: the notary's and the clearing's roles cannot read it, and an undeclared session reads none of it", { skip }, async () => {
  await fresh();
  await file({ about: "beta", body: "One more." });
  for (const role of ["snapshot_reader", "clearing_job"])
    await assert.rejects(() => asRole(role, "SELECT * FROM reports"), /permission denied/, `${role} read reports`);
  assert.equal((await asRole("office_api", "SELECT * FROM reports")).length, 0, "the row policy let an undeclared session read a report");
});

// ── PUBLIC ───────────────────────────────────────────────────────────────────

test("FALSIFIER: the public posts reads never list a report — the keyless read refuses the class, and the house's posts (and its doorstep) hold none", { skip }, async () => {
  await fresh();
  await file({ about: "beta", body: "Something happened." });
  await assert.rejects(() => postsAtOffice({ class: "report" }), (e) => { assert.equal(e.code, 403); assert.match(e.defect, /private/); return true; },
    "GET /posts?class=report and the keyless read answered the class");
  const keyless = await read({}, null);
  assert.equal(keyless.error, "bounce");
  assert.match(keyless.defect, /private/);
  for (const h of ["alpha", "beta"]) {
    const house = await householdPosts(h);
    const all = [...(house.put_up?.rows ?? []), ...(house.taking_part?.rows ?? [])];
    assert.ok(Array.isArray(house.put_up?.rows), `${h}'s house posts did not answer`);
    assert.ok(!all.some((p) => p.class === "report" || String(p.id).startsWith("report/")), `${h}'s house posts listed a report`);
  }
});

// ── PRIVATE ──────────────────────────────────────────────────────────────────

test("FALSIFIER: the filing household reads its report; the household it is about and a stranger read nothing", { skip }, async () => {
  await fresh();
  const { result: { filed } } = await file({ about: "beta", body: "Private words." });
  const mine = (await read({}, hearth));
  assert.equal(mine.total, 1);
  assert.equal(mine.reports[0].id, filed);
  assert.equal((await read({}, aleph)).total, 1, "a housemate reads the household's report");
  const theirs = (await read({}, yonder));
  assert.equal(theirs.total, 0, "the household the report is about was told");
  assert.equal((await read({}, third)).total, 0, "a stranger read the report");
});

test("a report you may not read answers exactly as one that does not exist", { skip }, async () => {
  await fresh();
  const { result: { filed } } = await file({ about: "beta", body: "Private words." });
  const real = await read({ post: filed }, yonder);
  const none = await read({ post: "report/00000000" }, yonder);
  const strip = (r) => ({ code: r.code, defect: r.defect.replace(/report\/[0-9a-f]{8}/, "<id>"), hint: r.hint });
  assert.equal(real.error, "bounce");
  assert.deepEqual(strip(real), strip(none), "a stranger can tell a real report from a missing one");
  const asBeta = (post) => town({ do: "advance", args: { class: "report", post, to: "heard", note: "n" }, handle: "beta" }, yonder);
  const movedReal = await asBeta(filed);
  const movedNone = await asBeta("report/00000000");
  assert.equal(movedReal.code, 404, JSON.stringify(movedReal).slice(0, 300));
  assert.deepEqual(strip(movedReal), strip(movedNone), "the move door tells a stranger a report exists");
});

// ── HANDS ────────────────────────────────────────────────────────────────────

test("FALSIFIER: only the town's hands move a report, one legal step at a time, each with a note the filer reads", { skip }, async () => {
  await fresh();
  const { result: { filed } } = await file({ about: "beta", body: "Please rule on the fence." , asks: "adjudication" });
  const all = (await read({}, founders));
  assert.equal(all.total, 1, "the hands read every report");
  const byFiler = await move({ post: filed, to: "heard", note: "x" }, hearth);
  assert.equal(byFiler.code, 403, "the filer moved its own report");
  assert.match(byFiler.defect, /only the town's hands/);
  const noNote = await move({ post: filed, to: "heard" });
  assert.equal(noNote.code, 422);
  const leap = await move({ post: filed, to: "resolved", note: "skip ahead" });
  assert.equal(leap.code, 409, "a filed report jumped to resolved");
  const heard = await move({ post: filed, to: "heard", note: "Heard; the Worldkeeper will walk it." });
  assert.equal(heard.result.to, "heard");
  const done = await town({ do: "advance", args: { class: "report", post: filed, to: "resolved", note: "Ruled: the fence stays." } }, worldkeeper);
  assert.equal(done.result.to, "resolved", JSON.stringify(done).slice(0, 300));
  const again = await move({ post: filed, to: "dismissed", note: "no" });
  assert.equal(again.code, 409, "a finished report moved again");
  const seen = (await read({ post: filed }, hearth)).report;
  assert.equal(seen.state, "resolved");
  assert.deepEqual(seen.moves.map((m) => [m.from, m.to, m.hand, m.note]), [
    ["filed", "heard", "wright", "Heard; the Worldkeeper will walk it."],
    ["heard", "resolved", "worldkeeper", "Ruled: the fence stays."],
  ], "the filer does not read the hands' notes");
});

// ── LAW ──────────────────────────────────────────────────────────────────────

test("the report's fields are judged by name: about, body, asks, a stake and a stray field", { skip }, async () => {
  await fresh();
  const refusedWith = async (args, code, re) => {
    const r = await file(args);
    assert.equal(r.code, code, JSON.stringify(r).slice(0, 300));
    assert.match(r.defect, re);
  };
  await refusedWith({ about: "aleph", body: "b" }, 422, /your own household/);
  await refusedWith({ about: "hearth", body: "b" }, 422, /your own household/);
  await refusedWith({ about: "nobody-here", body: "b" }, 404, /no household or resident/);
  await refusedWith({ about: "Not A Name", body: "b" }, 422, /not a household or a handle/);
  await refusedWith({ about: "beta" }, 422, /needs a body/);
  await refusedWith({ about: "beta", body: "x".repeat(601) }, 422, /at most 600/);
  await refusedWith({ about: "beta", body: "b", asks: "money" }, 422, /not something a report asks/);
  await refusedWith({ about: "beta", body: "b", stamps: 1 }, 422, /no stake/);
  await refusedWith({ about: "beta", body: "b", title: "t" }, 422, /does not take: title/);
  assert.equal(await count("SELECT count(*) AS n FROM reports"), 0, "a refused report was filed");
});

test("a report is never amended or closed, and explain: \"report\" teaches its fields and its privacy", { skip }, async () => {
  await assert.rejects(() => amendAtTown({ post: "report/0000aaaa", body: "b" }, hearth), /not amended/);
  await assert.rejects(() => closeAtTown({ post: "report/0000aaaa" }, founders), /not closed/);
  const ex = await town({ explain: "report" }, null);
  assert.deepEqual(ex, REPORT_EXPLAIN);
  assert.deepEqual(Object.keys(ex.fields).sort(), ["about", "asks", "body", "handle"]);
  assert.match(ex.private, /not told/);
});
