// pos1202-sheet-name.test.mjs — POS-1202: a reference sheet can say who it shows.
//
// Darko, 2026-11-23: one resident can be several characters (little-bird: three men and a dog), and its sheets say nothing of who each shows.
// Wright, 2026-11-24 04:26Z: the name is a SEPARATE LABEL beside the immutable picture; the household can set or change it on any sheet it keeps,
// including ones kept before; each change is an act in the record. This file drives the REAL profile act (`updateProfileAct`, the door
// update_profile / household profile / PATCH /profile reach) and the REAL sheet read against an embedded store, with the real acts pen: the
// name round-trips through the persisted act and back out of `sheetRead`. Houses, handles and URLs are invented.
//
//   node --test --test-concurrency=1 test/pos1202-sheet-name.test.mjs

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { startStore } from "./helpers/embedded-store.mjs";

const store = await startStore({ db: "pos1202_sheet_name" });
const FLAGS = ["WORLD2_PG", "WORLD2_PG_URL"];
const saved = Object.fromEntries(FLAGS.map((k) => [k, process.env[k]]));
Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") });
after(async () => {
  for (const k of FLAGS) { if (saved[k] == null) delete process.env[k]; else process.env[k] = saved[k]; }
  await store.stop();
});

const { updateProfileAct } = await import("../src/edit.mjs");
const { sheetRead, sheetNames, depictionsOf, SHEET_NAME_MAX } = await import("../src/depictions.mjs");
const M = "https://media.postmark.town/media/lantern-row";
const A = `${M}/a-julian.webp`, B = `${M}/b-vex.webp`, C = `${M}/c-alaric.webp`, D = `${M}/d-unnamed.webp`;
const KEY = { household: "lantern-row", handles: new Set(["wick", "postmaster"]) };
const OTHER = { household: "moss-cottage", handles: new Set(["fennel"]) };

{
  const o = await store.connect("world2_owner");
  try {
    await o.query("TRUNCATE depictions, households CASCADE").catch(async () => { await o.query("TRUNCATE households CASCADE"); });
    await o.query(`INSERT INTO households (slug, ord, name, residents, since, declared_by, likeness) VALUES
      ('lantern-row', 0, 'Lantern Row', ARRAY['wick','postmaster'], '2026-07-01', 'wick', '{"answer":"yes"}'),
      ('moss-cottage', 1, 'Moss Cottage', ARRAY['fennel'], '2026-07-01', 'fennel', '{"answer":"yes"}')`);
  } finally { await o.end(); }
}

const held = async () => {};   // the media sweep's "the town holds the file" check is not under test here
const profile = (args, key = KEY) => updateProfileAct(args, key, null, null, null, { held });
const count = async (sql, params = []) => {
  const c = await store.connect("office_api");
  try { return Number((await c.query(sql, params)).rows[0].n); } finally { await c.end(); }
};
const nameActs = (id) => count("SELECT count(*)::int AS n FROM acts WHERE class = 'appearance' AND action = 'name-sheet' AND object = $1", [String(id)]);
const depictions = () => count("SELECT count(*)::int AS n FROM depictions");
const read = (handle = "wick") => sheetRead({ handle });
const byUrl = (r) => Object.fromEntries(r.sheets.map((s) => [s.url, s]));

test("a new sheet kept with sheet_name round-trips through the persisted act and out of the sheet read; two sheets of one resident keep their own names", async () => {
  const a = await profile({ handle: "wick", sheet: A, sheet_name: "Julian" });
  assert.equal(a.sheet.name, "Julian", "the keep answers with the name that stands");
  const b = await profile({ handle: "wick", sheet: B, sheet_name: "  Vex " });
  assert.equal(b.sheet.name, "Vex", "trimmed");
  const r = await read();
  assert.equal(byUrl(r)[A].name, "Julian");
  assert.equal(byUrl(r)[B].name, "Vex");
  assert.equal(r.anchor, B, "the anchor is still the household's newest sheet, whatever its name");
  assert.equal(await nameActs(a.sheet.id), 1, "one act in the record for the naming");
  assert.deepEqual([...(await sheetNames([a.sheet.id, b.sheet.id]))].sort(), [[String(a.sheet.id), "Julian"], [String(b.sheet.id), "Vex"]].sort());
});

test("the old call and an unnamed sheet are exactly as they were: the URL alone keeps the sheet, no name is guessed, no name act is written", async () => {
  const before = await count("SELECT count(*)::int AS n FROM acts WHERE action = 'name-sheet'");
  const d = await profile({ handle: "wick", sheet: D });
  assert.equal("name" in d.sheet, false);
  assert.equal(d.sheet.canon, "at once: your household's own sheet is the one used first");
  assert.equal(("name" in byUrl(await read())[D]), false, "the read has no name for it");
  assert.equal(await count("SELECT count(*)::int AS n FROM acts WHERE action = 'name-sheet'"), before, "no act");
});

test("a sheet kept BEFORE can be named by the same call with its url, and the picture row is not touched", async () => {
  const c = await profile({ handle: "wick", sheet: C });                 // kept unnamed, as little-bird's 40 and 41 were
  const pictures = await depictions();
  const row = (await depictionsOf("wick", "sheet", process.env, async (t, p) => (await (await store.connect("office_api")).query(t, p)).rows)).find((r) => r.url === C);
  const named = await profile({ handle: "wick", sheet: C, sheet_name: "Alaric" });
  assert.equal(named.sheet.name, "Alaric");
  assert.equal(named.sheet.already, true, "the picture stood already: the keep says so, as it always did");
  assert.equal(named.sheet.id, c.sheet.id, "the same sheet");
  assert.equal(await depictions(), pictures, "no new picture row");
  assert.equal(byUrl(await read())[C].name, "Alaric");
  assert.equal(String(row.id), String(c.sheet.id));
  assert.equal(await nameActs(c.sheet.id), 1);
});

test("a correction is one more act and the read shows the latest; the same name again writes nothing; omitting it shows the name that stands", async () => {
  const id = (await profile({ handle: "wick", sheet: C })).sheet.id;      // no name sent: shows what stands, writes nothing
  assert.equal((await profile({ handle: "wick", sheet: C })).sheet.name, "Alaric");
  assert.equal(await nameActs(id), 1, "an omitted name wrote nothing");
  const same = await profile({ handle: "wick", sheet: C, sheet_name: "Alaric" });
  assert.equal(same.sheet.name, "Alaric");
  assert.equal(same.sheet.already, true);
  assert.equal(await nameActs(id), 1, "the same name again: idempotent, no act");
  const fixed = await profile({ handle: "wick", sheet: C, sheet_name: "Alaric the Younger" });
  assert.equal(fixed.sheet.name, "Alaric the Younger");
  assert.equal(await nameActs(id), 2, "a correction is an act, and the first is still in the record");
  assert.equal(byUrl(await read())[C].name, "Alaric the Younger", "the read shows the latest");
  const back = await profile({ handle: "wick", sheet: C, sheet_name: "Alaric" });   // a name that stood before is still a name that can be set
  assert.equal(back.sheet.name, "Alaric");
  assert.equal(await nameActs(id), 3);
});

test("the authority is the existing one: a key that does not hold the resident names nothing; a name is judged before anything is written", async () => {
  const before = { acts: await count("SELECT count(*)::int AS n FROM acts WHERE action = 'name-sheet'"), pics: await depictions() };
  await assert.rejects(profile({ handle: "wick", sheet: A, sheet_name: "Hijacked" }, OTHER), (e) => e.code === 403, "another household's key");
  const refused = (re) => (e) => e.code === 422 && re.test(e.defect);
  await assert.rejects(profile({ handle: "wick", sheet_name: "Julian" }), refused(/a sheet's name rides with its sheet/), "a name with no sheet to name");
  for (const bad of ["", "   ", "x".repeat(SHEET_NAME_MAX + 1), "two\nlines", "tab\there", 7, true, {}, [], { toString: 1 }, null])
    await assert.rejects(profile({ handle: "wick", sheet: A, sheet_name: bad }), refused(/a sheet's name is/), `a bad name is refused: ${typeof bad}`);
  assert.equal((await profile({ handle: "wick", sheet: A, sheet_name: "x".repeat(SHEET_NAME_MAX) })).sheet.name.length, SHEET_NAME_MAX, "the bound is inclusive");
  await profile({ handle: "wick", sheet: A, sheet_name: "Julian" });   // put it back
  assert.equal(await count("SELECT count(*)::int AS n FROM acts WHERE action = 'name-sheet'"), before.acts + 2, "only the two lawful namings above were written");
  assert.equal(await depictions(), before.pics, "and no picture");
  assert.equal(byUrl(await read())[A].name, "Julian");
});

test("the likeness and anchor policy are unchanged by a name: a household whose human has not said yes still reads its own sheet named, with no anchor", async () => {
  const o = await store.connect("world2_owner");
  try {
    await o.query("UPDATE households SET likeness = NULL WHERE slug = 'moss-cottage'");
    const kept = await updateProfileAct({ handle: "fennel", sheet: `${M.replace("lantern-row", "moss-cottage")}/f-fennel.webp`, sheet_name: "Fennel (the elder)" }, OTHER, null, null, null, { held });
    assert.equal(kept.sheet.name, "Fennel (the elder)");
    const r = await read("fennel");
    assert.equal(r.anchor, null, "no anchor without the likeness, named or not");
    assert.equal(r.sheets[0].name, "Fennel (the elder)", "its own sheet always shows, with its name");
    assert.match(r.anchor_why, /has not said yes to the likeness question/);
  } finally { await o.end(); }
});

test("the name rides the read's failure honestly: when the record cannot be asked for names, the read is a 503, not a list of unnamed sheets", async () => {
  const api = await store.connect("office_api");
  try {
    const registry = { houses: { "lantern-row": { residents: ["wick"], likeness: { answer: "yes" } } }, houseOf: () => "lantern-row" };
    const query = async (sql, params) => (/FROM acts/.test(sql) ? null : (await api.query(sql, params)).rows);
    await assert.rejects(sheetRead({ handle: "wick" }, { env: process.env, query, registry }), (e) => e.code === 503);
  } finally { await api.end(); }
});
