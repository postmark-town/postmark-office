// spark-property-carriage.test.mjs — POS-1035, WLD-173's office half: a class's properties carried by name, the spark's `parent`
// kept off the containment edge, the property serialization round trip through the World's own reader, and a spark draft kept on
// the household-private road and out of the public export.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const S = await import("../src/event-sparks.mjs");
const { markRecord } = await import("../src/mark-record.mjs");
const ROOT = join(import.meta.dirname, "..");
const fold = await import(pathToFileURL(join(ROOT, "world-clone", "tools", "marks-fold.mjs")));

// WLD-173's property table (postmark-world#391 at 3dee06d4, tools/spark.mjs § SPARK_FIELDS): the names the class declares — `rooms`,
// the room ids, since the room-set wire (POS-1035; no singular `room`)
const SPARK_PROPS = ["recounting", "experienced_at", "experienced_until", "rooms", "circle", "circle_path", "event", "picture", "image_prompt", "acts", "present", "parent_spark"];

test("properties are carried by NAME — only the class's own; the record's own fields can never ride in as one", () => {
  const ok = S.carriedProperties("spark", { recounting: "the sorbet ran out first", experienced_at: "2026-11-14T20:01:00.000Z", circle: 50101, circle_path: [50101], present: ["pica-house", "seth-house"] }, SPARK_PROPS);
  assert.deepEqual(ok.fields, { recounting: "the sorbet ran out first", experienced_at: "2026-11-14T20:01:00.000Z", circle: 50101, circle_path: [50101], present: ["pica-house", "seth-house"] });
  assert.match(S.carriedProperties("spark", { mood: "warm" }, SPARK_PROPS).refused.defect, /class spark has no property "mood"/);
  assert.match(S.carriedProperties("spark", { mood: "warm" }, SPARK_PROPS).refused.hint, /its own properties: acts, circle, circle_path/);
  for (const core of ["tier", "kind", "at", "extent", "by", "household", "body", "stamps", "put_forward", "parent_id"])
    assert.match(S.carriedProperties("spark", { [core]: "x" }, [...SPARK_PROPS, core]).refused.defect, new RegExp(`${core} is the record's own field`), core);
  assert.match(S.carriedProperties("spark", ["recounting"], SPARK_PROPS).refused.defect, /an object/);
  assert.deepEqual(S.carriedProperties("spark", undefined, SPARK_PROPS), { fields: {} });
  assert.deepEqual(S.carriedProperties("spark", { picture: null }, SPARK_PROPS), { fields: {} }, "an empty value writes nothing");
});

test("a spark's maker-facing `parent` is stored as parent_spark — NEVER the core `parent:` containment edge", () => {
  const c = S.carriedProperties("spark", { parent: "pica/the-first-sorbet" }, SPARK_PROPS);
  assert.deepEqual(c.fields, { parent_spark: "pica/the-first-sorbet" });
  assert.equal("parent" in c.fields, false);
  assert.match(S.carriedProperties("spark", { parent: "a/b", parent_spark: "c/d" }, SPARK_PROPS).refused.defect, /name the same link/);
  assert.match(S.carriedProperties("bounty", { parent: "a/b" }, ["parent_spark"]).refused.defect, /parent is the record's own field/, "only a spark maps it; elsewhere `parent` is the containment edge and refused");
  const record = markRecord({ kind: "spark", by: "pica", date: "2026-11-14", at: { x: 1, y: 2 }, extent: { w: 0, h: 0 }, ...c.fields }, "the opening night");
  assert.doesNotMatch(record, /^parent:/m, "no core parent line is written");
  assert.match(record, /^parent_spark: pica\/the-first-sorbet$/m);
});

test("THE ROUND TRIP (WLD-173 Q2): the office's writer, read back by the World's own parser, gives every carried property back whole", () => {
  const carried = S.carriedProperties("spark", {
    recounting: "Pica opened the counter; Seth found the lemon one sour, and Claran asked who painted the sign.",
    experienced_at: "2026-11-14T19:30:00.000Z", experienced_until: "2026-11-14T22:00:00.000Z",
    rooms: ["t1794686460000-pica", "t1794686520000-seth"], event: "pica/sorbet-opening",
    circle: 50101, circle_path: [50101, 50105, 50110], acts: [50101, 50102, 50113],
    present: ["pica-house", "seth-house", "the-town"], picture: "https://example.invalid/sorbet.jpg", parent: "pica/the-first-sorbet",
  }, SPARK_PROPS).fields;
  const frame = S.roomFrame({ id: "t1794686460000-pica", extent: { x0: 10, y0: 20, x1: 41, y1: 20, span_m: 31 } });
  const record = { kind: "spark", by: "pica", household: "pica-house", date: "2026-11-14T22:07:00.000Z", at: frame.at, extent: frame.extent, ...carried };
  const text = markRecord(record, "Little Pica's opening");
  assert.deepEqual(fold.lossyValues(text), [], "the World's own lint finds nothing lost");
  const back = fold.parseRecord(text, "WORLD/marks/pica/sorbet-night.md");
  for (const [k, v] of Object.entries(carried)) assert.deepEqual(back[k], v, `${k} reads back whole`);
  assert.deepEqual(back.at, { x: 25.5, y: 20 }, "the frame's half survives");
  assert.deepEqual(back.extent, { w: 31, h: 0 }, "and its explicit zero");
  assert.equal(back.kind, "spark");
  assert.equal("class" in back, false, "the new form: kind: spark, no class: line");
  assert.equal("parent" in back, false);
  assert.equal("tier" in back, false);
});

test("values that LOOK risky but read back whole are carried: opaque ids, exponent-free decimals, words that are not numbers, a mid-text bracket", () => {
  const keep = {
    rooms: ["t1794686460000-pica"], event: "pica/sorbet-opening", parent: "pica/the-first-sorbet",
    recounting: "true", image_prompt: "1e5 lemons, 3.5 metres of counter, and [a toast] mid-sentence", circle: -0.5, acts: [1, "2", { k: "v" }],
    picture: "https://example.invalid/sorbet.jpg?w=640&h=480", experienced_at: "2026-11-14T19:30:00.000Z",
  };
  const fields = S.carriedProperties("spark", keep, SPARK_PROPS).fields;
  const text = markRecord({ kind: "spark", by: "a", date: "2026-11-14", ...fields }, "b");
  assert.deepEqual(fold.lossyValues(text), []);
  const back = fold.parseRecord(text, "x.md");
  for (const [k, v] of Object.entries(fields)) assert.deepEqual(back[k], v, `${k}: value and type`);
  assert.equal(typeof back.recounting, "string", "the word true stays a word");
  assert.deepEqual(S.carriedProperties("spark", { picture: "" }, SPARK_PROPS), { fields: {} }, "an empty text writes nothing, as null does (the record writes no empty line)");
});

test("the round trip's EXACT INCOMPATIBILITIES are refused at the door, by field, never written to be lost", () => {
  const cases = [
    ["recounting", "we sang #3 twice", /a # is read as the start of a comment/],
    ["picture", "https://example.invalid/clip#t=30", /a # is read as the start of a comment/],
    ["recounting", "line one\nline two", /a line break ends the field/],
    ["image_prompt", "2026", /a number-shaped text is read back as a number/],
    ["rooms", ["t1794686460000-pica#2"], /a # inside it/],
    ["recounting", "{the toast}", /starts with \{/],
    ["recounting", "[an aside]", /read back as a list, or refused by the World's lint/],
    ["recounting", " padded ", /trimmed/],
    ["present", ["pica#house"], /a # inside it/],
    // Bevel 16:32:27Z: numeric and JSON coercion, opaque ids, URL fragments
    ["event", "007", /number-shaped/],
    ["image_prompt", "-12.5", /number-shaped/],
    ["recounting", "{\"toast\": 1}", /starts with \{/],
    ["recounting", "[1, 2]", /read back as a list/],
    ["picture", "https://example.invalid/a.jpg#frag", /a # is read/],
    ["circle", 1e21, /is not read back as the same number/],
    ["circle", Number.NaN, /is not read back as the same number/],
    ["acts", true, /a true\/false is read back as text/],
  ];
  for (const [k, v, re] of cases) {
    const r = S.carriedProperties("spark", { [k]: v }, SPARK_PROPS);
    assert.match(r.refused?.defect ?? "", re, `${k}: ${JSON.stringify(v)}`);
    assert.match(r.refused.defect, new RegExp(`properties\\.${k} would not read back whole`));
    // the control: the World's reader really does lose it, or the World's own lint refuses the line (so the refusal is not over-cautious)
    const text = markRecord({ kind: "spark", by: "a", date: "2026-11-14", [k]: v }, "b");
    const back = fold.parseRecord(text, "x.md");
    assert.ok(JSON.stringify(back[k]) !== JSON.stringify(v) || fold.lossyValues(text).length > 0, `the World's reader or lint would have lost ${k}`);
  }
});

// ── a spark draft, on the household-private road (007's row policy) and out of the public export ──

const { startStore } = await import("./helpers/embedded-store.mjs");
const store = await startStore({ db: "pos1035_spark_carriage_test" });
after(() => store.stop());
const owner = await store.connect("world2_owner");
const api = await store.connect("office_api");
after(async () => { await owner.end(); await api.end(); });

test("a spark DRAFT stays on the household's private road: its own household reads it, another does not, and the export never sees it", async () => {
  const { rows: [w] } = await owner.query("SELECT id FROM windows ORDER BY id DESC LIMIT 1");
  let windowId = w?.id;
  if (windowId == null) {
    const { rows: [nw] } = await owner.query("INSERT INTO windows (id, opens_at, closes_at, status) VALUES (1, now(), now() + interval '12 hours', 'open') RETURNING id");
    windowId = nw.id;
  }
  const data = { kind: "spark", ...S.carriedProperties("spark", { recounting: "a private memory", experienced_at: "2026-11-14T20:00:00.000Z", present: ["pica-house"] }, SPARK_PROPS).fields };
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data)
    VALUES ($1, 'mark', 'pica', 'pica-house', 'draft', 'a quiet night', $2, 0, $3)`,
    [windowId, JSON.stringify({ at: { x: 1, y: 2 }, extent: { w: 120, h: 120 } }), JSON.stringify(data)]);
  const as = async (household) => {
    await api.query("BEGIN");
    try {
      await api.query("SELECT set_config('app.household_keys', $1, true)", [household]); // the door's own setting (024 § THE READ)
      const { rows } = await api.query("SELECT body, data FROM claims WHERE claimant = 'pica' AND status = 'draft'");
      return rows;
    } finally { await api.query("ROLLBACK"); }
  };
  const mine = await as("pica-house");
  assert.equal(mine.length, 1, "its own household reads its draft");
  assert.deepEqual(mine[0].data.present, ["pica-house"], "the list property is carried as a list on the private road");
  assert.deepEqual(await as("otter-house"), [], "another household does not — the row policy, not a WHERE clause");
  // the public export reads acts, closed windows and marks — never claims — so a draft (which wrote no act) cannot leave
  const { readActs } = await import("../world2/tools/snapshot-export.mjs");
  const acts = await readActs(owner, { after: 0, upto: Number.MAX_SAFE_INTEGER });
  assert.ok(!JSON.stringify(acts).includes("a private memory"), "no act carries the draft's recounting");
  const { rows: marks } = await owner.query("SELECT slug FROM marks");
  assert.ok(!marks.some((m) => String(m.slug).includes("quiet")), "and no mark row holds it");
});

test("THE SITE'S SPARKS (CORE-82): accepted = standing in marks; a circle's sparks by the spine (on / below); credit is the maker, the picture is the spark's own; an event's spark by its recorded identity", async () => {
  const { rows: [w] } = await owner.query("SELECT id FROM windows ORDER BY id DESC LIMIT 1");
  const mark = async (slug, owner_, data, status = "standing") => owner.query(
    `INSERT INTO marks (id, slug, kind, owner, household, body, geometry, bbox, status, locked_window, data)
     VALUES (gen_random_uuid(), $1, 'spark', $2, $3, $4, $5, box(point(0,0), point(1,1)), $6, $7, $8)`,
    [slug, owner_, `${owner_}-house`, `the ${slug}`, JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 0, h: 0 } }), status, w.id, JSON.stringify(data)]);
  await mark("pica/x-on-a", "pica", { kind: "spark", recounting: "x", experienced_at: "2026-11-14T20:00:00.000Z", circle: 50101, circle_path: [50101], picture: "https://example.invalid/x.jpg" });
  await mark("seth/y-on-a", "seth", { kind: "spark", recounting: "y", experienced_at: "2026-11-14T20:00:00.000Z", circle: 50101, circle_path: [50101], parent_spark: "pica/x-on-a" });
  await mark("amia/z-on-b", "amia", { kind: "spark", recounting: "z", experienced_at: "2026-11-14T20:00:00.000Z", circle: 50105, circle_path: [50101, 50105] });
  await mark("liv/gone", "liv", { kind: "spark", recounting: "g", experienced_at: "2026-11-14T20:00:00.000Z", circle: 50101, circle_path: [50101] }, "retired");
  // a spark still waiting on acceptance is a claim, not a mark: never in the collection. As the pen writes one: its class is
  // the mark's kind and its slug the whole <by>/<slug> id (world2-claims § claimTxFromJournal)
  await owner.query(`INSERT INTO claims (window_id, class, claimant, household, status, body, geometry, stake, data, slug)
    VALUES ($1, 'spark', 'noe', 'noe-house', 'pending', 'waiting', $2, 1, $3, 'noe/w-pending')`,
    [w.id, JSON.stringify({ at: { x: 0, y: 0 }, extent: { w: 0, h: 0 } }), JSON.stringify({ kind: "spark", circle: 50101, circle_path: [50101] })]);

  const a = await S.acceptedSparksOfCircle(owner, 50101);
  assert.deepEqual(a.on.map((s) => s.id).sort(), ["pica/x-on-a", "seth/y-on-a"], "X and Y stand on A");
  assert.deepEqual(a.below.map((s) => s.id), ["amia/z-on-b"], "Z (on reply circle B) shows below A — nothing orphaned");
  assert.ok(![...a.on, ...a.below].some((s) => s.id === "liv/gone" || s.id === "noe/w-pending"), "retired and pending are not accepted");
  const x = a.on.find((s) => s.id === "pica/x-on-a");
  assert.deepEqual(x.credit, { by: "pica", household: "pica-house" }, "credit is the maker");
  assert.equal(x.picture, "https://example.invalid/x.jpg", "the picture is the spark's own property");
  assert.equal(x.accepted, true);
  assert.equal(a.on.find((s) => s.id === "seth/y-on-a").own_link, "pica/x-on-a", "its own link is shown as itself, never as placement");
  assert.deepEqual((await S.acceptedSparksOfCircle(owner, 50105)).on.map((s) => s.id), ["amia/z-on-b"]);

  assert.equal(await S.eventSparkOf(owner, { fields: {} }), null, "before completion: no spark");
  assert.equal((await S.eventSparkOf(owner, { fields: { completed: { spark: "pica/x-on-a" } } })).accepted, true);
  assert.deepEqual(await S.eventSparkOf(owner, { fields: { completed: { spark: "noe/w-pending" } } }), { id: "noe/w-pending", accepted: false, status: "pending" });
});
