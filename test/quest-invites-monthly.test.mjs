// quest-invites-monthly.test.mjs — POS-961: the board MEASURES "Bring a neighbour".
//
// The w46 board listed `bring-a-neighbour` (monthly, target 10) with `progress: null, measured: false` even after the
// invite pass paid a household (three on the 11-08 15:22Z tick). The town's fold already counts it (tools/quest-progress.mjs §
// invitesPaidByHouse: the household's INVITER-side payouts dated in the town month, by canonical inviting house, "counted in
// the month paid"); the office dropped that answer at the index. Wright, 2026-11-14 22:34Z: "the office quest fold measures
// bring-a-neighbour from the town ledger's inviter-side lines in the town month, so the board shows progress and completion.
// The smallest shape, with a test."
//
// THE CHAIN UNDER TEST IS THE REAL ONE, end to end: a synthetic town whose ledger holds the town's own inviter and invited lines
// (written by stamp-mint's own line builders) → the real derivation (`questRows`, which runs the pinned town's own fold) →
// the rows and meta seeded into the suite's embedded store → the real board read (`storeIndexPooled(...).questBoard`, the SQL and
// `questBoardWith`). Take away the projection (`invitesOf`, the meta row) or the join (`inviteEntry`, the store's meta read) and
// the household loses its 2 at the end of the chain. The town and the store are the pinned clone's and the suite's; without
// either the file skips and says so.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { storeIndexPooled } from "../src/town-index-store.mjs";
import { questRows, invitesOf } from "../src/town-index.mjs";
import { inviteEntry } from "../src/queries.mjs";
import { TOWN_TABLES } from "../src/town-tables.mjs";
import { NO_TOWN, townClone } from "./fixture-paths.mjs";
import { putValues, emptyTown, setMeta } from "./fixture.mjs";
import { indexStore } from "./helpers/office-under-test.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const TOWN = townClone();
const SKIP = !TOWN && NO_TOWN;

const seated = emptyTown();
const IX = await indexStore(seated);
after(async () => { await IX.stop(); });

// ── a synthetic town, with the pinned town's own tools ───────────────────────
// Two houses: `hh:inviters` (alpha, under the account gh:111, which the registry also lists, so a line naming `gh:111` is
// the same house as `hh:inviters`) and `hh:quiet` (beta). The month is the town's current one, from the town's own clock.
async function syntheticTown() {
  const dir = tempDir("quest-invites-");
  cpSync(join(TOWN, "tools"), join(dir, "tools"), { recursive: true });
  cpSync(join(TOWN, "quest-registry.json"), join(dir, "quest-registry.json"));
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  const mint = await import(pathToFileURL(join(dir, "tools", "stamp-mint.mjs")));
  const qp = await import(pathToFileURL(join(dir, "tools", "quest-progress.mjs")));
  const today = qp.townDay();
  const month = today.slice(0, 7);
  const [y, m] = month.split("-").map(Number);
  const lastMonth = m === 1 ? `${y - 1}-12-15` : `${y}-${String(m - 1).padStart(2, "0")}-15`;
  return { dir, mint, today, month, lastMonth, qp };
}
function writeTown(t, lines, { houses = true } = {}) {
  writeFileSync(join(t.dir, "WHITE_PAGES", "stamp-ledger.md"), lines.join("\n") + "\n");
  writeFileSync(join(t.dir, "tools", "github-ids.json"), JSON.stringify({ alpha: { login: "alpha-gh", id: 111 }, beta: { login: "beta-gh", id: 222 } }));
  writeFileSync(join(t.dir, "tools", "households.json"), JSON.stringify({
    households: houses ? { inviters: { name: "Inviters", accounts: [{ login: "alpha-gh", id: 111 }], residents: ["alpha"] } } : {},
  }));
  for (const h of ["alpha", "beta"]) {
    mkdirSync(join(t.dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(t.dir, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\ngithub: ${h}-gh\n---\n`);
  }
}
const LOG = { log() {}, warn() {} };
const TOWN_DOC = { residents: [{ handle: "alpha" }, { handle: "beta" }] };

// The rows the derivation writes, seeded and read back through the real store and the real board.
async function boardOf(t, handle, { dropInvites = false, day = t.today, invites = undefined } = {}) {
  const q = await questRows(t.dir, TOWN_DOC, { log: LOG });
  const db = emptyTown();
  for (const r of q.progress) putValues(db, "quest_progress", r, TOWN_TABLES.quest_progress.cols);
  setMeta(db, "quest_registry", q.questRegistry);
  setMeta(db, "quest_day", day);
  const value = invites ?? q.invites;
  if (value && !dropInvites) setMeta(db, "quest_invites", value);
  for (const k of Object.keys(seated)) seated[k] = db[k] ?? [];
  await IX.reseed();
  const board = await storeIndexPooled(TOWN, { env: IX.env }).questBoard(handle, {});
  return { q, row: board.quests.find((x) => x.id === "bring-a-neighbour") };
}

const inviter = (t, n, { date = t.today, key = "hh:inviters", activated = `${t.month}-01` } = {}) =>
  t.mint.inviteInviterLine({ date, handle: "alpha", invited: `hh:new-${n}`, inviter: key, activated });

test("POS-961 · a household paid twice in the town month reads progress 2, measured, and not complete", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, [inviter(t, 1), inviter(t, 2)]);
  const { row } = await boardOf(t, "alpha");
  assert.equal(row.progress, 2, "the household's two inviter-side payouts");
  assert.equal(row.measured, true);
  assert.equal(row.complete, false, "2 of 10");
  assert.equal(row.household.total, 2);
  assert.equal(row.target, 10);
  // the same house, asked by a housemate or by the quiet house
});

test("POS-961 · BEFORE: without the projection the row is the old unmeasured one (the falsifier's red)", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, [inviter(t, 1), inviter(t, 2)]);
  const { row } = await boardOf(t, "alpha", { dropInvites: true });
  assert.equal(row.progress, null, "no quest_invites in the index: the row cannot count and says so");
  assert.equal(row.measured, false);
});

test("POS-961 · what is NOT counted: invited-side payouts, another month's, another house's; a quiet house reads a counted zero", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, [
    inviter(t, 1), inviter(t, 2),
    inviter(t, 3, { date: t.lastMonth, activated: t.lastMonth }),                              // paid LAST month: the cap's own month rule, not this month's
    t.mint.inviteInvitedLine({ date: t.today, handle: "newbie", invited: "hh:new-1", inviter: "hh:inviters" }), // the invited side's 5: not capped, not counted
    t.mint.inviteInviterLine({ date: t.today, handle: "beta", invited: "hh:new-9", inviter: "hh:someone-else", activated: `${t.month}-01` }), // another house's
  ]);
  const a = (await boardOf(t, "alpha")).row;
  assert.equal(a.progress, 2, "only this month's inviter-side lines of THIS house");
  const b = (await boardOf(t, "beta")).row;
  assert.equal(b.progress, 0, "a house nobody paid is a COUNTED zero for the month, not an unknown");
  assert.equal(b.measured, true);
});

test("POS-961 · a line naming the house by its account spelling counts as that house", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, [inviter(t, 1, { key: "hh:inviters" }), inviter(t, 2, { key: "gh:111" })]);       // one house, two spellings (stamp-mint.mjs § houseCanonOf)
  assert.equal((await boardOf(t, "alpha")).row.progress, 2);
  const apart = await syntheticTown();
  writeTown(apart, [inviter(apart, 1, { key: "hh:inviters" }), inviter(apart, 2, { key: "gh:111" })], { houses: false });
  assert.equal((await boardOf(apart, "alpha")).row.progress, 1, "CONTROL: with no declared house the two spellings are two houses, and the key `gh:111` is alpha's own: only that one is hers");
});

test("POS-961 · completion follows the existing target rule, at 10 and past it", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, Array.from({ length: 10 }, (_, i) => inviter(t, i + 1)));
  const { row } = await boardOf(t, "alpha");
  assert.deepEqual([row.progress, row.complete, row.measured], [10, true, true]);
  const nine = await syntheticTown();
  writeTown(nine, Array.from({ length: 9 }, (_, i) => inviter(nine, i + 1)));
  assert.deepEqual([(await boardOf(nine, "alpha")).row.complete], [false], "9 of 10 is not complete");
});

test("POS-961 · the month does not reset at a day change: last month's lines never read as this month's, and a day-old index stays unmeasured", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  // two lines earlier in the month than today are still the month's (a count that reset daily would lose them)
  writeTown(t, [inviter(t, 1, { date: `${t.month}-01` }), inviter(t, 2, { date: `${t.month}-01` })]);
  assert.equal((await boardOf(t, "alpha")).row.progress, 2, "dated earlier this month: still counted");
  // an index folded on another day is stale: the daily bars zero, and the monthly row stays UNCOUNTED rather than a stale number
  const stale = (await boardOf(t, "alpha", { day: "1970-01-01" })).row;
  assert.deepEqual([stale.progress, stale.measured], [null, false]);
  // an index whose value names another month is no value for this one: the town's own board refuses it, on the real board
  const q = await questRows(t.dir, TOWN_DOC, { log: LOG });
  assert.equal(JSON.parse(q.invites).month, t.month, "the derivation names the town's month");
  const other = (await boardOf(t, "alpha", { invites: JSON.stringify({ month: "1999-01", paid: { alpha: 7 } }) })).row;
  assert.deepEqual([other.progress, other.measured], [null, false], "another month's count is never shown as this month's");
});

test("POS-961 · the carriage: invitesOf and inviteEntry, and every bent value is no value", () => {
  const prog = new Map([
    ["zed", { invite: { month: "2026-11", paid: 2 } }],
    ["abe", { invite: { month: "2026-11", paid: 2 } }],
    ["mid", { invite: { month: "2026-11", paid: 0 } }],
    ["old", { send: 1 }],                       // an entry from a fold that predates the field
  ]);
  assert.equal(invitesOf(prog), '{"month":"2026-11","paid":{"abe":2,"zed":2}}', "sorted, paid > 0 only, the month once");
  assert.equal(invitesOf(new Map([["x", { send: 1 }]])), null, "a fold that predates the field writes nothing, so the row stays unmeasured");
  assert.equal(invitesOf(new Map()), null);
  const v = invitesOf(prog);
  assert.deepEqual(inviteEntry(v, "abe"), { invite: { month: "2026-11", paid: 2 } });
  assert.deepEqual(inviteEntry(v, "mid"), { invite: { month: "2026-11", paid: 0 } }, "unlisted in a counted month is a counted zero");
  for (const bent of [undefined, null, "", "not json", "{}", '{"month":"x","paid":{}}', '{"month":"2026-11"}', '{"month":"2026-11","paid":{"abe":"2"}}', '{"month":"2026-11","paid":{"abe":-1}}', '[]'])
    assert.deepEqual(inviteEntry(bent, "abe"), {}, `bent value ${JSON.stringify(bent)}`);
});

test("POS-961 · the other quest rows are untouched by the new meta key", { skip: SKIP }, async () => {
  const t = await syntheticTown();
  writeTown(t, [inviter(t, 1)]);
  const withInvites = await boardOf(t, "alpha");
  const without = await boardOf(t, "alpha", { dropInvites: true });
  // build the whole boards once more and compare every row but this one
  const rest = async (opts) => {
    const q = await questRows(t.dir, TOWN_DOC, { log: LOG });
    const db = emptyTown();
    for (const r of q.progress) putValues(db, "quest_progress", r, TOWN_TABLES.quest_progress.cols);
    setMeta(db, "quest_registry", q.questRegistry); setMeta(db, "quest_day", t.today);
    if (!opts.dropInvites) setMeta(db, "quest_invites", q.invites);
    for (const k of Object.keys(seated)) seated[k] = db[k] ?? [];
    await IX.reseed();
    return (await storeIndexPooled(TOWN, { env: IX.env }).questBoard("alpha", {})).quests.filter((x) => x.id !== "bring-a-neighbour");
  };
  assert.deepEqual(await rest({}), await rest({ dropInvites: true }), "every other row is byte for byte the same with or without the invite meta");
  assert.ok(withInvites.row && without.row);
});
