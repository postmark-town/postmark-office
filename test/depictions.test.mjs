// depictions.test.mjs — the six-panel sheets: one record, the door, the gated anchor, Iris's list, the seed (WLD-83).
//
// Darko, 2026-10-19: the household submits its own sheet from the town's
// template and it is canon (18:24); the existing sheets are seeded (18:26, D6);
// a sheet is unused until the household's human says yes, then welcomed
// (18:30); a no stops made media, never display (D1); the template's style
// image has no resident in it (D5); the town's seeds cost no household storage
// (D7). Every house, handle and URL here is invented or the fixture's.
//
//   node --test test/depictions.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  keepDepiction, depictionsOf, sheetRead, keepSheet, withSheetTemplate, missingSheets, anchorOf, stylePlate,
  SHEET_TEMPLATE, TOWN,
} from "../src/depictions.mjs";
import { seedSheets, toWebp } from "../tools/seed-sheets.mjs";
import { startStore } from "./helpers/embedded-store.mjs";

const M = "https://media.postmark.town/media";
// The registry as likenessRegistry hands it: houses by slug, and a resolver.
const registry = (answers = {}) => {
  const houses = {
    "lantern-row": { residents: ["wick", "postmaster"], likeness: answers["lantern-row"] ?? null },
    "moss-cottage": { residents: ["fennel", "sorrel"], likeness: answers["moss-cottage"] ?? null },
  };
  return { houses, houseOf: (h) => Object.entries(houses).find(([, r]) => r.residents.includes(h))?.[0] ?? null };
};
const yes = { answer: "yes" }, no = { answer: "no" };

async function withStore(name, fn) {
  const s = await startStore({ db: name });
  const api = await s.connect("office_api");
  const query = async (t, p) => (await api.query(t, p)).rows;
  try { await fn({ s, api, query }); } finally { await api.end(); await s.stop(); }
}

// ── the record ──────────────────────────────────────────────────────────────

test("082 · a depiction is kept once per subject and URL, never changed or removed, and the pen holds no DELETE", async () => {
  await withStore("depictions_record", async ({ s, api, query }) => {
    const env = {};
    const a = await keepDepiction({ subject: "wick", url: `${M}/the-town/a1.webp`, made_by: TOWN, source: "a seed" }, env, query);
    assert.equal(a.kept, true);
    assert.equal(a.subject, "wick");
    const again = await keepDepiction({ subject: "wick", url: `${M}/the-town/a1.webp`, made_by: TOWN }, env, query);
    assert.deepEqual([again.kept, again.id], [false, a.id], "the same bytes again answer the row that stands");
    await keepDepiction({ subject: "wick", url: `${M}/lantern-row/b2.webp`, made_by: "lantern-row", source: "the household's own" }, env, query);
    assert.deepEqual((await depictionsOf("wick", "sheet", env, query)).map((r) => r.made_by), ["lantern-row", TOWN], "newest first");
    await assert.rejects(keepDepiction({ subject: "wick", kind: "portrait", url: `${M}/x.webp`, made_by: TOWN }, env, query), (e) => e.code === 422);
    await assert.rejects(api.query("UPDATE depictions SET url = 'https://elsewhere' WHERE subject = 'wick'"), /permission denied/);
    await assert.rejects(api.query("DELETE FROM depictions WHERE subject = 'wick'"), /permission denied/, "the pen holds no DELETE");
    const owner = await s.connect("world2_owner");
    try {
      await assert.rejects(owner.query("DELETE FROM depictions WHERE subject = 'wick'"), /never changed or removed/, "and the trigger refuses even the owner");
      await assert.rejects(owner.query("UPDATE depictions SET made_by = 'x'"), /never changed or removed/);
    } finally { await owner.end(); }
    await assert.rejects(api.query("INSERT INTO depictions (subject, kind, url, made_by) VALUES ('Wick!', 'sheet', 'https://x', 'y')"), /check constraint/);
  });
});

// ── the anchor: the one gate (D1) ───────────────────────────────────────────

test("the anchor rule: given → the household's own newest, else the town's; not given → none", () => {
  const rows = [
    { url: "own-2", made_by: "lantern-row" }, { url: "town-1", made_by: TOWN }, { url: "own-1", made_by: "lantern-row" },
  ];
  assert.equal(anchorOf(rows, { household: "lantern-row", given: true }), "own-2");
  assert.equal(anchorOf(rows.filter((r) => r.made_by === TOWN), { household: "lantern-row", given: true }), "town-1");
  assert.equal(anchorOf(rows, { household: "lantern-row", given: false }), null);
  assert.equal(anchorOf([], { household: "lantern-row", given: true }), null);
  assert.equal(anchorOf([{ url: "other", made_by: "moss-cottage" }], { household: "lantern-row", given: true }), null,
    "another household's sheet is never this resident's anchor");
});

test("the sheet read: the household's own sheets always show; the town's wait on the yes, as does the anchor, and it says why", async () => {
  await withStore("depictions_read", async ({ query }) => {
    const env = {};
    await keepDepiction({ subject: "wick", url: `${M}/the-town/seed.webp`, made_by: TOWN, source: "a seed" }, env, query);
    await keepDepiction({ subject: TOWN, kind: "plate", url: `${M}/the-town/plate.webp`, made_by: TOWN }, env, query);

    const blind = await sheetRead({ handle: "wick" }, { env, query, registry: registry() });
    assert.equal(blind.likeness, "not given");
    assert.deepEqual(blind.sheets, [], "the town's seed is made media: unshown until the yes (18:26, 18:30)");
    assert.equal(blind.held_until_yes, 1);
    assert.match(blind.held_why, /unused and unshown until its human says yes/);
    assert.equal(blind.anchor, null);
    assert.match(blind.anchor_why, /has not said yes to the likeness question/);
    assert.match(blind.anchor_why, /oauth\/likeness\?household=lantern-row/);
    assert.equal(blind.template, SHEET_TEMPLATE);
    assert.equal(blind.style_plate, `${M}/the-town/plate.webp`);
    assert.equal(await stylePlate(env, query), `${M}/the-town/plate.webp`);

    const said = await sheetRead({ handle: "wick" }, { env, query, registry: registry({ "lantern-row": yes }) });
    assert.equal(said.anchor, `${M}/the-town/seed.webp`, "a yes makes the seed the anchor");
    assert.deepEqual(said.sheets.map((r) => [r.url, r.own]), [[`${M}/the-town/seed.webp`, false]], "and shows it");
    assert.equal("held_until_yes" in said, false);
    await keepDepiction({ subject: "wick", url: `${M}/lantern-row/own.webp`, made_by: "lantern-row" }, env, query);
    assert.equal((await sheetRead({ handle: "wick" }, { env, query, registry: registry({ "lantern-row": yes }) })).anchor,
      `${M}/lantern-row/own.webp`, "the household's own is canon over the town's");
    const refused = await sheetRead({ handle: "wick" }, { env, query, registry: registry({ "lantern-row": no }) });
    assert.equal(refused.anchor, null, "a no takes it back");
    assert.deepEqual(refused.sheets.map((r) => r.url), [`${M}/lantern-row/own.webp`], "the household's own sheet still shows on a no (D1); the town's does not");

    const none = await sheetRead({ handle: "fennel" }, { env, query, registry: registry({ "moss-cottage": yes }) });
    assert.deepEqual([none.anchor, none.sheets], [null, []]);
    assert.match(none.anchor_why, /no sheet yet/);
  });
});

test("the template asks for the two images, the resident-free plate second, and stays in the media door's bound", () => {
  assert.match(SHEET_TEMPLATE, /six-panel character reference sheet/);
  assert.match(SHEET_TEMPLATE, /FIRST is this character's own picture/);
  assert.match(SHEET_TEMPLATE, /SECOND is the town's style plate/);
  assert.match(SHEET_TEMPLATE, /do not copy anything in it/);
  assert.match(SHEET_TEMPLATE, /under 1\.5 MB/);
  assert.equal((SHEET_TEMPLATE.match(/\[/g) ?? []).length, 2, "two brackets for the agent to fill");
});

// ── the household's own sheet: the profile act's `sheet` ────────────────────

test("keepSheet: the household's own, a media URL kept as canon at once; another household's resident, a bad URL and a clear are refused", async () => {
  const kept = [];
  const keep = async (row) => { kept.push(row); return { id: "9", ...row, made_at: "2026-10-21T12:00:00.000Z", kept: true }; };
  const key = { household: "lr-gh", handles: new Set(["wick", "postmaster"]) };
  const deps = { keep, registry: registry(), urlOk: (u) => u.startsWith(M) };
  const out = await keepSheet({ handle: "wick", url: `${M}/lr-gh/new.webp` }, key, deps);
  assert.deepEqual(kept, [{ subject: "wick", kind: "sheet", url: `${M}/lr-gh/new.webp`, made_by: "lantern-row", source: "the household's own" }],
    "made_by is the household on the record, not the key's login");
  assert.equal(out.own, true);
  assert.match(out.canon, /at once/);
  for (const [args, k, code, re] of [
    [{ handle: "fennel", url: `${M}/a.webp` }, key, 403, /not one of your residents/],
    [{ handle: "wick", url: "https://elsewhere.invalid/a.webp" }, key, 422, /media-door URL/],
    [{ handle: "wick", url: "" }, key, 422, /never cleared/],
    [{ handle: "stray", url: `${M}/a.webp` }, { household: "x", handles: new Set(["stray"]) }, 409, /no household holds/],
  ]) await assert.rejects(keepSheet(args, k, deps), (e) => e.code === code && re.test(e.defect), JSON.stringify(args));
  assert.equal(kept.length, 1, "a refused call keeps nothing");
});

test("the profile act splits the sheet off before the paper: a sheet alone writes no paper, a bad sheet refuses the whole call", async () => {
  const { updateProfileAct } = await import("../src/edit.mjs");
  const { editClone, fixtureKey, fixtureTown } = await import("./fixture.mjs");
  const { readFileSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { MEDIA_BASE } = await import("../src/media.mjs");
  const clone = editClone();
  const was = process.env.TOWN_PUSH; delete process.env.TOWN_PUSH;
  try {
    const profile = () => readFileSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), "utf8");
    const before = profile();
    const seen = [];
    const keep = async (args) => { seen.push(args); return { url: args.url, own: true }; };
    const sheet = `${MEDIA_BASE}/media/keemin/${"d4".repeat(32)}.webp`;
    const alone = await updateProfileAct({ handle: "wright", sheet }, fixtureKey, fixtureTown(), clone, null, { keep, held: async () => {} });
    assert.deepEqual(alone, { updated: "wright", sheet: { url: sheet, own: true } });
    assert.equal(profile(), before, "a sheet alone writes no paper");
    const both = await updateProfileAct({ handle: "wright", sheet, bio: "a line" }, fixtureKey, fixtureTown(), clone, null, { keep, held: async () => {} });
    assert.match(profile(), /a line/);
    assert.doesNotMatch(profile(), /sheet/, "the sheet never reaches PROFILE.md");
    assert.equal(both.sheet.url, sheet);
    await assert.rejects(updateProfileAct({ handle: "wright", sheet: "https://elsewhere.invalid/x.webp", bio: "never" }, fixtureKey, fixtureTown(), clone, null, { keep, held: async () => {} }),
      (e) => e.code === 422 && /media-door URL/.test(e.defect));
    assert.doesNotMatch(profile(), /never/, "a bad sheet refuses the whole call before any paper");
    const notHeld = async () => { throw Object.assign(new Error("the town holds no file at that URL"), { code: 422, defect: "the town holds no file at that URL" }); };
    await assert.rejects(updateProfileAct({ handle: "wright", sheet, bio: "unheld" }, fixtureKey, fixtureTown(), clone, null, { keep, held: notHeld }),
      (e) => e.code === 422 && /holds no file/.test(e.defect), "POS-738's rule: the town must hold the sheet's file");
    assert.doesNotMatch(profile(), /unheld/);
    assert.equal(seen.length, 2);
  } finally { if (was !== undefined) process.env.TOWN_PUSH = was; rmSync(clone, { recursive: true, force: true }); }
});

test("the template rides a picture's answer until the household keeps its own sheet (18:24)", async () => {
  await withStore("depictions_template", async ({ query }) => {
    const env = {};
    await keepDepiction({ subject: TOWN, kind: "plate", url: `${M}/the-town/plate.webp`, made_by: TOWN }, env, query);
    await keepDepiction({ subject: "wick", url: `${M}/the-town/seed.webp`, made_by: TOWN }, env, query);
    const handed = await withSheetTemplate({ updated: "wick" }, "wick", { env, query, registry: registry() });
    assert.equal(handed.sheet_template.template, SHEET_TEMPLATE);
    assert.equal(handed.sheet_template.style_plate, `${M}/the-town/plate.webp`);
    assert.match(handed.sheet_template.how, /update_profile \{ sheet/);
    await keepDepiction({ subject: "wick", url: `${M}/lantern-row/own.webp`, made_by: "lantern-row" }, env, query);
    assert.deepEqual(await withSheetTemplate({ updated: "wick" }, "wick", { env, query, registry: registry() }), { updated: "wick" },
      "a household with its own sheet is not handed the template again");
    assert.deepEqual(await withSheetTemplate({ updated: "stray" }, "stray", { env, query, registry: registry() }), { updated: "stray" });
  });
});

test("Iris's list: households that said yes, and their residents with no sheet of any maker", async () => {
  await withStore("depictions_iris", async ({ query }) => {
    await keepDepiction({ subject: "wick", url: `${M}/the-town/seed.webp`, made_by: TOWN }, {}, query);
    const list = await missingSheets({ env: {}, query, registry: registry({ "lantern-row": yes, "moss-cottage": no }) });
    assert.deepEqual(list.households, [{ household: "lantern-row", residents: ["postmaster"] }],
      "a no is never on the list; a resident with a seed already has one");
  });
});

// ── the seed ────────────────────────────────────────────────────────────────

test("the seed: re-encoded to WebP, minted on the town's own wall, kept as the town's; an unknown handle is refused", async () => {
  const require = createRequire(import.meta.url);
  const sharp = require("sharp");
  const png = await sharp({ create: { width: 64, height: 36, channels: 3, background: { r: 120, g: 90, b: 60 } } }).png().toBuffer();
  const minted = [], kept = [];
  const out = await seedSheets({
    manifest: { plate: { file: "plate.png", source: "the plate" }, sheets: [
      { handle: "wick", file: "wick.png", source: "a seed" }, { handle: "nobody", file: "nobody.png", source: "a seed" }] },
    read: () => png, holds: (h) => h === "wick",
    upload: async (args, key, odb, { bytes }) => { minted.push({ by: args.by, household: key.household, webp: bytes.subarray(8, 12).toString() }); return { url: `${M}/the-town/${args.by}.webp` }; },
    keep: async (row) => { kept.push(row); return { ...row, kept: true }; },
  });
  assert.deepEqual(minted, [
    { by: TOWN, household: TOWN, webp: "WEBP" }, { by: "wick", household: TOWN, webp: "WEBP" },
  ], "every object is a WebP on the town's wall, named for whom it depicts");
  assert.deepEqual(kept.map((r) => [r.subject, r.kind, r.made_by]), [[TOWN, "plate", TOWN], ["wick", "sheet", TOWN]]);
  assert.deepEqual(out.refused.map((r) => [r.subject, r.code]), [["nobody", 404]], "a handle the record does not hold is refused, never guessed");
  assert.ok((await toWebp(png)).length < 1.5 * 1024 * 1024);
});
