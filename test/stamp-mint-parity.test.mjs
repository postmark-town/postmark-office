// stamp-mint-parity.test.mjs — THE RULED GATE ON THE LIVE LEDGER (POS-341, Q3).
//
//   node --test test/stamp-mint-parity.test.mjs
//
// Darko's ruling, 2026-10-04: before the mint reads its key base from the store,
// base(store) = base(file) for every handle, and a full replay is green with the
// store's inputs injected. This file runs world2/tools/stamp-mint-parity.mjs §
// parityOf on the office's pinned town-clone, the live ledger and mail ledger
// and pins, after filling a real Postgres the way the box fills it:
//
//   household_pins   the registry rows the drain prints tools/github-ids.json
//                    from (seeded from that print, which is byte-equal by
//                    registry-drain --check)
//   town_rooms,      written by the town-index ingest's own writer
//   town_mail_lines  (src/mint-inputs.mjs § writeMintInputs), as law_ingester
//   stamp_lines      recorded by the pen's own writer (src/stamp-lines.mjs §
//                    syncStampLinesVia), as office_api, every signature checked
//
// Then it shows the gate can fail: one pin missing from the store reds the base,
// and one delivery's `pays` dropped reds the deliveries.
//
// THE QUESTS (POS-341 part 4): the town's quest folds and the crossing's
// snapshot, fed the store's base and the file's, must agree, and the ferry's
// snapshot runner (world2/tools/quest-snapshot-run.mjs) must write the bytes the
// town's --snapshot writes. Needs a town engine that takes a key base (town
// #3540); against a pinned clone that predates it those tests skip by name, and
// PARITY_TOWN=<a town tree with the change> runs the whole file on that tree.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { startStore } from "./helpers/embedded-store.mjs";
import { rowsFromRegistry } from "../src/registry-rows.mjs";
import { keyBaseOf, mintInputsVia, writeMintInputs } from "../src/mint-inputs.mjs";
import { stampLinesVia, syncStampLinesVia, verifyStampLinesVia } from "../src/stamp-lines.mjs";
import { parityOf } from "../world2/tools/stamp-mint-parity.mjs";
import { snapshotFromStore } from "../world2/tools/quest-snapshot-run.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = process.env.PARITY_TOWN ?? join(ROOT, "town-clone");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));
const skip = hasClone ? false : "no town-clone beside the office: the gate runs on the pinned clone's live ledger";

let store, owner, ingester, office, engine, quests, report;
before(async () => {
  if (skip) return;
  engine = await import(pathToFileURL(join(CLONE, "tools", "stamp-mint.mjs")).href);
  quests = await import(pathToFileURL(join(CLONE, "tools", "quest-progress.mjs")).href);
  store = await startStore({ db: "stamp_mint_parity" });
  owner = await store.connect("world2_owner");
  ingester = await store.connect("law_ingester");
  office = await store.connect("office_api");

  // household_pins, from the drain's own print of them
  const rows = rowsFromRegistry(JSON.parse(readFileSync(join(CLONE, "tools", "households.json"), "utf8")),
    JSON.parse(readFileSync(join(CLONE, "tools", "github-ids.json"), "utf8")));
  for (const p of rows.pins)
    await owner.query(`INSERT INTO household_pins (handle, login, gh_id, pinned, renamed, note, retired, renamed_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [p.handle, p.login ?? "", p.gh_id, p.pinned ?? null, p.renamed ?? null, p.note ?? null, p.retired ?? null, p.renamed_to ?? null]);

  await ingester.query("BEGIN");
  await writeMintInputs(ingester, CLONE);
  await ingester.query("COMMIT");

  await office.query("BEGIN");
  await syncStampLinesVia(office, CLONE, { engine });
  await office.query("COMMIT");

  report = parityOf(engine, CLONE, { ...(await mintInputsVia(office)), entries: await stampLinesVia(office) }, { quests });
});
after(async () => {
  for (const c of [owner, ingester, office]) if (c) await c.end().catch(() => {});
  if (store?.stop) await store.stop();
});

test("THE GATE: base(store) = base(file) for every handle, the deliveries equal (pays included), the ledger equal, the replay green on both", (t) => {
  if (skip) return t.skip(skip);
  console.log(`# parity: base ${report.base.handles} handles, ${report.base.differ} differ · deliveries ${report.deliveries.store} (${report.deliveries.with_pays} with pays) · ledger ${report.ledger.store} lines · replay store ${report.replay.store.mints} mints, owed ${report.replay.store.owed}+${report.replay.store.owed_settlements}`);
  assert.deepEqual(report.base.diffs, [], "every handle keys the same from the store as from the file");
  assert.equal(report.base.store, report.base.file);
  assert.equal(report.deliveries.first_difference, null, "the store's mail lines read to the file's deliveries");
  assert.ok(report.deliveries.with_pays > 0, "the deliveries that carry pays are compared, pays and all");
  assert.equal(report.ledger.first_difference, null, "stamp_lines is the file, line for line");
  assert.deepEqual(report.replay.store.problems, [], "the replay on the store's inputs is green");
  assert.deepEqual(report.replay.file.problems, [], "the replay on the file's inputs is green");
  assert.equal(report.replay.same_owed, true, "both sides owe the same mints and settlements");
  assert.equal(report.ok, true);
});

test("the store's chain verifies on its own and is its export byte for byte", async (t) => {
  if (skip) return t.skip(skip);
  const v = await verifyStampLinesVia(office, CLONE, { engine });
  assert.deepEqual(v.problems, []);
  assert.equal(v.held, v.exported);
});

// ── WHICH PIN IS ACTIVE (POS-896) — the oracle's own spelling of the ledger's rule ─────────────────────────────────────────────
// LAW (tools/stamp-mint.mjs § householdKeys): "a pin whose own `pinned:` date falls ON OR AFTER the earliest sealed `registry:` line
// for that handle is INERT HERE … A pin dated BEFORE the line (or carrying no `pinned:` date at all) is the genesis fact the line was
// written on top of, and it stands." The ledger outranks the file, as of the sealed line's date: this is the AS-OF key domain, so
// the earliest sealed date comes from the town's own `parseLaws` revisions, not from the current membership of any house.
const sealedOf = (entries) => {
  const out = new Map();
  for (const r of engine.parseLaws(entries).revisions) { const prev = out.get(r.handle); if (!prev || r.date < prev) out.set(r.handle, r.date); }
  return out;
};
/** A pin counts for a handle's key unless a sealed registry line for it is dated on or before the pin. */
const pinIsActive = (pins, sealed, handle) => { const line = sealed.get(handle), pinned = pins[handle]?.pinned; return !(line && pinned && pinned >= line); };
/** Handles on the roll with a pin that counts, sorted (never the first key an object happens to hold; an integer-like key sorts first in JS). */
const activePinHandles = (inputs, entries) => {
  const sealed = sealedOf(entries);
  return Object.keys(inputs.pins).filter((h) => inputs.rooms.has(h) && inputs.pins[h]?.id && pinIsActive(inputs.pins, sealed, h)).sort();
};

test("the gate can fail: a pin missing from the store reds the base; a delivery's pays dropped reds the deliveries", async (t) => {
  if (skip) return t.skip(skip);
  const inputs = await mintInputsVia(office);
  const entries = await stampLinesVia(office);
  // The store loses one ACTIVE pin: that room then keys by its ADDRESS login or as solo, which the file does not.
  // The handle is chosen by the pin's status in the ledger's own domain (activePinHandles, below), never by the first key of an
  // object: a pin dated on or after its handle's earliest sealed registry line is INERT, and removing an inert pin changes no
  // key on either side, so a gate that removed one could only ever report parity (POS-896).
  const handle = activePinHandles(inputs, entries)[0];
  assert.ok(handle, "the live roll has at least one active pin, or this case proves nothing");
  assert.equal(pinIsActive(inputs.pins, sealedOf(entries), handle), true, `${handle}'s pin is active (the precondition of the case)`);
  const pins = { ...inputs.pins }; delete pins[handle];
  const r1 = parityOf(engine, CLONE, { ...inputs, pins, entries });
  assert.equal(r1.ok, false);
  assert.ok(r1.base.diffs.some((d) => d.handle === handle), `${handle} is named as differing`);

  const i = inputs.mailLines.findIndex((l) => / · pays: \d+/.test(l));
  assert.ok(i >= 0, "a delivery with pays in the live mail ledger");
  const mailLines = inputs.mailLines.slice(); mailLines[i] = mailLines[i].replace(/ · pays: \d+/, "");
  const r2 = parityOf(engine, CLONE, { ...inputs, mailLines, entries });
  assert.equal(r2.ok, false);
  assert.ok(r2.deliveries.first_difference, "the dropped pays is the first difference");
});

const questSkip = () => (report?.quests?.compared ? false : report?.quests?.note ?? "no report");

test("THE QUESTS: fed the store's base, the four quest folds and the crossing's snapshot equal the folds fed the file's", (t) => {
  if (skip) return t.skip(skip);
  if (questSkip()) return t.skip(questSkip());
  console.log(`# quests: ${report.quests.folds.map((f) => `${f.fold} ${f.equal ? "equal" : "DIFFERS"}`).join(" · ")} (${report.quests.today})`);
  assert.deepEqual(report.quests.differ, []);
  assert.equal(report.quests.folds.length, 5);
});

test("the quest gate can fail: a pin missing from the store moves the folds", async (t) => {
  if (skip) return t.skip(skip);
  if (questSkip()) return t.skip(questSkip());
  const inputs = await mintInputsVia(office);
  const entries = await stampLinesVia(office);
  const handle = activePinHandles(inputs, entries)[0];
  assert.ok(handle, "the live roll has at least one active pin, or this case proves nothing");
  assert.equal(pinIsActive(inputs.pins, sealedOf(entries), handle), true, `${handle}'s pin is active (the precondition of the case)`);
  const pins = { ...inputs.pins }; delete pins[handle];
  const r = parityOf(engine, CLONE, { ...inputs, pins, entries }, { quests, today: report.quests.today });
  assert.equal(r.ok, false);
  assert.ok(r.quests.differ.includes("foldQuestProgress"), `${handle} unpinned moves the progress fold: ${r.quests.differ.join(", ")}`);
});

test("the ferry's snapshot runner writes, from the store, the bytes the town's --snapshot writes", async (t) => {
  if (skip) return t.skip(skip);
  if (questSkip()) return t.skip(questSkip());
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
  const { next } = await snapshotFromStore(CLONE, { env });
  assert.equal(next, quests.renderSnapshot(CLONE), "the store's base, the town's bytes");
  assert.ok(next.length > 0);
});

test("the snapshot runner reads the store: a pin the store loses moves its bytes", async (t) => {
  if (skip) return t.skip(skip);
  if (questSkip()) return t.skip(questSkip());
  const env = { ...process.env, WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api") };
  // The board prints a bar for a shared house that minted that day, naming its
  // residents. Take the newest delivery day, a pinned resident of a house with a
  // bar that day, and take the pin out of the store: the house splits on the board.
  const today = engine.parseDeliveries(CLONE).at(-1).date;
  const bars = quests.foldHouseholdBars(CLONE, { today });
  const pinned = new Set((await owner.query("SELECT handle FROM household_pins WHERE gh_id IS NOT NULL")).rows.map((r) => r.handle));
  const handle = bars.flatMap((b) => b.residents).find((h) => pinned.has(h) && String(b0Key(bars, h)).startsWith("gh:"));
  assert.ok(handle, `a pinned resident of a shared house with a bar on ${today}`);
  const { rows: [p] } = await owner.query("SELECT handle, login, gh_id, pinned, renamed, note, retired, renamed_to FROM household_pins WHERE handle = $1", [handle]);
  await owner.query("DELETE FROM household_pins WHERE handle = $1", [handle]);
  try {
    const { next } = await snapshotFromStore(CLONE, { env, today });
    assert.notEqual(next, quests.renderSnapshot(CLONE, { today }), `${handle} unpinned in the store moves the snapshot (${today})`);
  } finally {
    await owner.query("INSERT INTO household_pins (handle, login, gh_id, pinned, renamed, note, retired, renamed_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
      [p.handle, p.login, p.gh_id, p.pinned, p.renamed, p.note, p.retired, p.renamed_to]);
  }
});
const b0Key = (bars, h) => bars.find((b) => b.residents.includes(h))?.key;

// ── THE INVENTED CONTROLS (POS-896): an ACTIVE pin, an INERT pin, and an INERT numeric-looking handle, on a checkout this file writes ──
// The two "gate can fail" cases above run on the pinned town's live ledger, so which pin they remove depends on that ledger. These
// cases hold the ledger's rule fixed instead, on a few invented handles: removing an ACTIVE pin from the store must red the base for
// that handle (and only it), removing an INERT pin must not (it keys nothing on either side), and the selector must not be fooled by
// an inert handle that happens to sort or order first. The retired selector (the first object key with a room and a pin) is kept
// below only to show what it picked: an inert pin whose removal can never red anything.
const SEAL_DATE = "2026-10-17";
const INVENTED_PINS = {
  "1234": { id: 9003, login: "inv-numeric-gh", pinned: SEAL_DATE },            // numeric-looking, INERT: pinned on its sealed line's date
  "inv-active": { id: 9001, login: "inv-active-gh", pinned: "2026-07-05" },     // no sealed line: ACTIVE
  "inv-inert": { id: 9002, login: "inv-inert-gh", pinned: SEAL_DATE },         // pinned on its sealed line's date: INERT
};
const INVENTED_ROOMS = new Map([["1234", "inv-numeric-gh"], ["inv-active", "inv-active-gh"], ["inv-inert", "inv-inert-gh"], ["inv-free", null]]);

/** An invented town checkout on disk (pins, rooms, a sealed ledger, an empty mail ledger) and the store-side inputs that match it. */
function withInventedCheckout(fn) {
  const dir = mkdtempSync(join(tmpdir(), "mint-parity-invented-"));
  try {
    mkdirSync(join(dir, "tools"), { recursive: true });
    writeFileSync(join(dir, "tools", "github-ids.json"), JSON.stringify(INVENTED_PINS));
    for (const [room, login] of INVENTED_ROOMS) {
      mkdirSync(join(dir, "WHITE_PAGES", room), { recursive: true });
      writeFileSync(join(dir, "WHITE_PAGES", room, "ADDRESS.md"), login ? `---\ngithub: ${login}\n---\n` : "---\n---\n");
    }
    const ledger = [engine.rulesLine("2026-06-12"),
      `- ${SEAL_DATE} · registry: inv-inert = hh:inv-house · sig: invented`,
      `- ${SEAL_DATE} · registry: 1234 = hh:inv-other-house · sig: invented`].join("\n") + "\n";
    writeFileSync(join(dir, "WHITE_PAGES", "stamp-ledger.md"), ledger);
    writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), "# mail ledger (invented)\n");
    const entries = engine.parseStampLedger(ledger);
    return fn({ dir, entries, inputs: { pins: { ...INVENTED_PINS }, rooms: new Map(INVENTED_ROOMS), mailLines: [] } });
  } finally { rmSync(dir, { recursive: true, force: true, maxRetries: 5 }); }
}
const without = (pins, handle) => { const p = { ...pins }; delete p[handle]; return p; };

test("invented · the control is live: with every pin present the store keys every handle as the file does", (t) => {
  if (skip) return t.skip(skip);
  withInventedCheckout(({ dir, entries, inputs }) => {
    const r = parityOf(engine, dir, { ...inputs, entries });
    assert.deepEqual(r.base.diffs, []);
    assert.equal(r.base.handles, 4, "the four invented rooms are compared");
  });
});

test("invented · removing the ACTIVE pin reds the base for that handle, and only it", (t) => {
  if (skip) return t.skip(skip);
  withInventedCheckout(({ dir, entries, inputs }) => {
    assert.deepEqual(activePinHandles(inputs, entries), ["inv-active"], "the one active pin among the three");
    const r = parityOf(engine, dir, { ...inputs, pins: without(inputs.pins, "inv-active"), entries });
    assert.deepEqual(r.base.diffs, [{ handle: "inv-active", file: "gh:9001", store: "login:inv-active-gh" }]);
  });
});

test("invented · removing an INERT pin, numeric-looking or not, reds nothing: it keys the handle on neither side", (t) => {
  if (skip) return t.skip(skip);
  withInventedCheckout(({ dir, entries, inputs }) => {
    for (const handle of ["inv-inert", "1234"]) {
      assert.equal(pinIsActive(inputs.pins, sealedOf(entries), handle), false, `${handle} is inert (the precondition)`);
      assert.deepEqual(parityOf(engine, dir, { ...inputs, pins: without(inputs.pins, handle), entries }).base.diffs, [], `${handle}: no difference`);
    }
  });
});

test("invented · the retired selector picked the inert numeric handle first, and removing it could only report parity; the new one cannot", (t) => {
  if (skip) return t.skip(skip);
  withInventedCheckout(({ dir, entries, inputs }) => {
    const retired = Object.keys(inputs.pins).find((h) => inputs.rooms.has(h) && inputs.pins[h]?.id);
    assert.equal(retired, "1234", "an integer-like key is first in a JS object, whatever the order it was written in");
    assert.deepEqual(parityOf(engine, dir, { ...inputs, pins: without(inputs.pins, retired), entries }).base.diffs, [], "so the old case could not red");
    assert.equal(activePinHandles(inputs, entries)[0], "inv-active", "the new selector skips the inert handles, numeric or not");
  });
});

test("invented · the quest gate moves the intended fold for an ACTIVE pin and not for an INERT one", (t) => {
  if (skip) return t.skip(skip);
  if (questSkip()) return t.skip(questSkip());
  const textOf = (v) => JSON.stringify(v, (_, x) => (x instanceof Map ? [...x] : x));
  withInventedCheckout(({ dir, entries, inputs }) => {
    const today = quests.townDay();
    const fileBase = engine.householdKeys(dir);
    const progressOn = (pins) => textOf(quests.foldQuestProgress(dir, { today, base: keyBaseOf({ pins, rooms: inputs.rooms, sealed: sealedOf(entries) }) }));
    const onFile = textOf(quests.foldQuestProgress(dir, { today, base: fileBase }));
    assert.equal(progressOn(inputs.pins), onFile, "the control: every pin present, the fold is the file's");
    assert.notEqual(progressOn(without(inputs.pins, "inv-active")), onFile, "an active pin gone moves foldQuestProgress");
    assert.equal(progressOn(without(inputs.pins, "inv-inert")), onFile, "an inert pin gone does not");
    assert.equal(progressOn(without(inputs.pins, "1234")), onFile, "nor does the inert numeric handle's");
  });
});
