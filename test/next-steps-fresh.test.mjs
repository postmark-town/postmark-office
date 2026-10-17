// next-steps-fresh.test.mjs — the owner's next steps stop asking for card, home and window once the record shows them done (POS-603).
//
//   node --test --test-concurrency=1 test/next-steps-fresh.test.mjs
//
// THE CASE. A paper act's own reads now read through to the written record, but
// nextStepsFor built the onboarding line from the INDEXED standing facts, and
// the town's composeNextSteps drops a paper row whose id is an onboarding id —
// so a stale index kept "write your card", "tend your home" and "hang your
// window" on the owner's next steps after the record showed them done.
//
// WHAT RUNS. The REAL nextStepsFor (src/queries.mjs) and the REAL town composer:
// each synthetic clone's tools/quest-progress.mjs is a SYMLINK to the suite's
// pinned town clone's own file (test/clone-pins.json), so onboardingBoard,
// composeNextSteps, ownProse and CARD_MIN_CHARS are the town's code, never a copy
// or a stub. This is its own file (its own process) because queries.mjs caches
// the first quest-progress module it imports. Every input is a fixed literal in a
// temp dir: the office index (test/fixture.mjs plus a synthetic quest registry
// and a STALE quest_standing row), the card template, the cards, the pages. Both
// indexes: office.db, and the suite's embedded store seeded from it.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fixtureTown } from "./fixture.mjs";

delete process.env.TOWN_INDEX_READS;
delete process.env.WORLD2_PG;
delete process.env.WORLD2_PG_URL;

const { tempDir } = await import("./helpers/temp-dir.mjs");
const { NO_TOWN, townClone } = await import("./fixture-paths.mjs");
const { fixtureDb } = await import("./fixture.mjs");
const { indexStore, testIndex } = await import("./helpers/office-under-test.mjs");
const { nextStepsFor, home: homeQ } = await import("../src/queries.mjs");
const tis = await import("../src/town-index-store.mjs");

const TOWN = townClone();
const QP = TOWN ? join(TOWN, "tools", "quest-progress.mjs") : null;
const SKIP = !TOWN ? NO_TOWN : (!existsSync(QP) && "the town clone has no tools/quest-progress.mjs");

const scratch = tempDir("postmark-pos603-steps-");
const dbPath = join(scratch, "office.db");

// ── the synthetic office index ──────────────────────────────────────────────
const ONE_TIME = [
  ["write-your-card", "write_card"], ["tend-your-home", "update_home"], ["hang-your-window", "update_window"],
  ["first-letter-out", "send_letter"], ["first-answer", null], ["walk-the-world", null], ["welcome-to-postmark", null],
];
const REGISTRY = { quests: ONE_TIME.map(([id, tool]) => ({ id, title: `the ${id} row`, cadence: "one-time", source: `fixture: ${id}`, ...(tool ? { door: { tool } } : {}) })) };
// STALE on purpose: the index says card, home and window are not done; sent is
// not done either (an unrelated fact that must stay as the index says).
const STALE = { card: false, home: false, window: false, sent: false, received: true, welcomed: true };
if (!SKIP) {
  fixtureTown().close();
  const w = new DatabaseSync(dbPath);
  w.prepare("INSERT OR REPLACE INTO meta VALUES (?, ?)").run("quest_registry", JSON.stringify(REGISTRY));
  for (const h of ["wright", "limen"]) w.prepare("INSERT INTO quest_standing VALUES (?, ?)").run(h, JSON.stringify(STALE));
  // limen has no indexed home row (the first-home case of this PR's first pass)
  w.prepare("DELETE FROM homes WHERE handle = ?").run("limen");
  w.close();
}
const db = SKIP ? null : new DatabaseSync(dbPath, { readOnly: true });
const IX = SKIP ? null : await indexStore(dbPath);
const STORE = !SKIP && testIndex() === "store";
after(async () => { db?.close(); await IX?.stop(); });
const meta = () => Object.fromEntries(db.prepare("SELECT key, value FROM meta").all().map((r) => [r.key, r.value]));

// ── the synthetic clone ─────────────────────────────────────────────────────
// A card template whose prompt lines are boilerplate the town strikes out.
const TEMPLATE = "---\nhandle: your-handle\n---\n\n# Your name here\n\n(Who you are, in your own words.)\n(What you are building.)\n";
const OWN_250 = "I keep the lamp at the end of the quay and write to anyone who passes. "
  + "Most evenings I answer letters from the terrace, and on Sundays I walk the shore road to see what the tide left. "
  + "This card is mine, written for the town, and it is longer than the bar.";
let seq = 0;
function clone({ card = null, home = false, window = false } = {}) {
  const dir = join(scratch, `clone-${++seq}`);
  mkdirSync(join(dir, "tools"), { recursive: true });
  symlinkSync(QP, join(dir, "tools", "quest-progress.mjs"));
  mkdirSync(join(dir, "WHITE_PAGES", "TEMPLATE"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "TEMPLATE", "ADDRESS.md"), TEMPLATE);
  for (const h of ["wright", "limen"]) {
    mkdirSync(join(dir, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(dir, "WHITE_PAGES", h, "ADDRESS.md"), card ?? TEMPLATE);
    if (home) {
      mkdirSync(join(dir, "WHITE_PAGES", h, "HOME"), { recursive: true });
      writeFileSync(join(dir, "WHITE_PAGES", h, "HOME", "HOME.md"), "---\ntitle: the Lamp House\n---\n\nThe lamp is lit and the door is open.\n");
    }
    if (window) {
      mkdirSync(join(dir, "WHITE_PAGES", h, "WINDOW"), { recursive: true });
      writeFileSync(join(dir, "WHITE_PAGES", h, "WINDOW", "window.html"), "<!doctype html><html><body>lit</body></html>");
    }
  }
  return dir;
}
const keyFor = (h) => ({ household: `house-${h}`, handles: new Set([h]) });
const stepIds = (ns) => (ns?.steps ?? []).map((s) => s.id);

/** Every scenario on both indexes. */
function both(name, fn) {
  test(`${name} [office.db]`, { skip: SKIP }, () => fn(null));
  test(`${name} [store]`, { skip: SKIP || (!STORE && "OFFICE_TEST_INDEX=office: no store variant in this run") }, async () => {
    const restore = await IX.useInProcess();
    try { await fn(true); } finally { await restore(); }
  });
}
const steps = (handle, dir, { own = true, store = null } = {}) =>
  nextStepsFor(db, meta(), handle, dir, { own, key: own ? keyFor(handle) : keyFor("limen"), worldBlock: async () => null, ix: store ? tis.storeIndexPooled(dir) : null });

// ═══ the owner, stale index, fresh record ═══════════════════════════════════

both("OWNER · the record shows card, home and window done: the next steps stop asking, though the index still says not", async (store) => {
  const dir = clone({ card: `---\nhandle: limen\n---\n\n${OWN_250}\n`, home: true, window: true });
  const ns = await steps("limen", dir, { store });
  assert.ok(ns, "next steps were composed");
  const ids = stepIds(ns);
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window"]) assert.equal(ids.includes(id), false, `${id} is done on the record: ${ids}`);
  assert.equal(ids.includes("first-letter-out"), true, "an unrelated indexed fact stays as the index says");
  assert.equal(ids.includes("welcome-to-postmark"), false, "and a complete one stays complete");
});

both("OWNER · still owed stays owed: a template-only card, a short card, no home page and no window", async (store) => {
  for (const card of [TEMPLATE, `${TEMPLATE}\nToo short to count.\n`]) {
    const ids = stepIds(await steps("limen", clone({ card }), { store }));
    for (const id of ["write-your-card", "tend-your-home", "hang-your-window"]) assert.equal(ids.includes(id), true, `${id} is still owed: ${ids}`);
  }
});

// ═══ a stranger stays on the index ══════════════════════════════════════════

both("STRANGER · the same fresh record changes nothing: the line is the index's", async (store) => {
  const dir = clone({ card: `---\nhandle: limen\n---\n\n${OWN_250}\n`, home: true, window: true });
  const ns = await steps("limen", dir, { own: false, store });
  const ids = stepIds(ns);
  for (const id of ["write-your-card", "tend-your-home", "hang-your-window"]) assert.equal(ids.includes(id), true, `${id} stays as indexed for a stranger: ${ids}`);
  assert.match(ns.withheld ?? "", /OWN doorstep only/);
});

// ═══ the founded home's shape ═══════════════════════════════════════════════

test("FIRST HOME · the founded page carries picture: null, the /homes/:h shape [office.db]", { skip: SKIP }, () => {
  const dir = clone({ home: true });
  const h = homeQ(db, "limen", { clone: dir });
  assert.ok(h, "the founded page composes");
  assert.equal(Object.hasOwn(h, "picture"), true, "picture is a field of the answer");
  assert.equal(h.picture, null);
});
