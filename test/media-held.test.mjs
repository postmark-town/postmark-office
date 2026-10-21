// media-held.test.mjs — POS-738: a door hangs a media URL only when the ledger
// holds its bytes. Two marks hung pictures the town never held (Alta's mooring
// on a path the door never minted, Rook's flag on a right-shaped URL whose
// bytes were never put), and both 404. `mediaUrlOk` read the grammar only.
//
//   node --test test/media-held.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MEDIA_BASE, mediaUrlParts, mediaHeldRefusal, useMediaLedger, mediaUrlOk } from "../src/media.mjs";
import { holdMedia } from "./helpers/media-ledger.mjs";

const SHA = "a".repeat(64), OTHER = "b".repeat(64);
const HELD = `${MEDIA_BASE}/media/garrison/${SHA}.jpg`;
const NEVER_PUT = `${MEDIA_BASE}/media/garrison/${OTHER}.jpg`; // Rook's shape: the grammar is right, no row holds it
const NOT_MINTED = `${MEDIA_BASE}/m/d849fa0eb84fc1399cb1.jpg`; // Alta's shape: a path the door never minted
const KEY = { household: "testers", handles: new Set(["tester"]) };
const MARK = { slug: "picture-test", kind: "sited", at: { x: 0, y: 0 }, extent: { w: 1, h: 1 }, body: "a test mark." };

test("mediaUrlParts reads what a door-minted URL names, its copies included, and nothing else", () => {
  assert.deepEqual(mediaUrlParts(HELD), { household: "garrison", sha: SHA, ext: "jpg", size: null });
  assert.deepEqual(mediaUrlParts(`${MEDIA_BASE}/media/garrison/${SHA}-256.jpg`), { household: "garrison", sha: SHA, ext: "jpg", size: 256 });
  assert.deepEqual(mediaUrlParts(`${MEDIA_BASE}/media/garrison/${SHA}-96.jpg`), { household: "garrison", sha: SHA, ext: "jpg", size: 96 });
  assert.ok(mediaUrlOk(NOT_MINTED), "precondition: the grammar alone admits Alta's URL");
  for (const bad of [NOT_MINTED, `${MEDIA_BASE}/media/garrison/${SHA}-128.jpg`, `${MEDIA_BASE}/media/garrison/abc123.png`,
    `https://evil.example/media/garrison/${SHA}.jpg`, `${MEDIA_BASE}/media/${SHA}.jpg`, "", null])
    assert.equal(mediaUrlParts(bad), null, String(bad));
});

test("no ledger registered: the check refuses 409 rather than hanging a picture it could not look up", async () => {
  useMediaLedger(null);
  assert.deepEqual(await mediaHeldRefusal(HELD), {
    code: 409, defect: "the media ledger is not open",
    hint: "the office could not check that the town holds this file, so nothing was hung — try again in a moment; if it repeats, tell the office (a letter to wright works)",
  });
});

test("the ledger decides: a held original and its copies pass; a URL nobody put, and a path the door never minted, refuse 422", async () => {
  holdMedia(HELD);
  assert.equal(await mediaHeldRefusal(HELD), null);
  assert.equal(await mediaHeldRefusal(`${MEDIA_BASE}/media/garrison/${SHA}-96.jpg`), null, "a copy is held when its original is");
  assert.equal(await mediaHeldRefusal(`  ${HELD}  `), null, "trimmed, as every door trims");

  const never = await mediaHeldRefusal(NEVER_PUT);
  assert.deepEqual([never.code, never.defect], [422, "the town holds no file at that URL"]);
  assert.match(never.hint, /nothing was ever uploaded at .*upload it first \(upload_media\), then hang the URL it returns/);

  const alta = await mediaHeldRefusal(NOT_MINTED);
  assert.deepEqual([alta.code, alta.defect], [422, "the town holds no file at that URL"]);
  assert.match(alta.hint, /is not an address the media door mints/);

  // the row's own household, sha AND ext: the same sha under another house or another ext is not held
  assert.equal((await mediaHeldRefusal(`${MEDIA_BASE}/media/rook/${SHA}.jpg`))?.code, 422, "another household's URL for the same bytes is its own row");
  assert.equal((await mediaHeldRefusal(`${MEDIA_BASE}/media/garrison/${SHA}.png`))?.code, 422, "the ext is part of the address");
});

test("any household's held picture may hang: the check is the ledger's, never the caller's house", async () => {
  holdMedia(HELD);
  assert.equal(await mediaHeldRefusal(HELD, {}), null, "testers hang garrison's picture, as a neighbour always could");
});

test("the mark door: a picture the town never held is refused before the clone is touched; a held one passes the door's media gate", async () => {
  holdMedia(HELD);
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  for (const image of [NEVER_PUT, NOT_MINTED])
    await assert.rejects(leaveMarkViaOffice("/nonexistent-clone", { ...MARK, image }, KEY),
      (e) => e.code === 422 && e.defect === "the town holds no file at that URL", image);
  // A held picture gets past the image gate; whatever stops it next (here, the
  // missing clone) is not the media refusal.
  await assert.rejects(leaveMarkViaOffice("/nonexistent-clone", { ...MARK, image: HELD }, KEY),
    (e) => e.defect !== "the town holds no file at that URL" && !/media door/.test(String(e.defect)));
});

// A world clone whose main carries one published mark with a picture.
function worldWith(marks) {
  const dir = mkdtempSync(join(tmpdir(), "media-held-world-"));
  mkdirSync(join(dir, "WORLD"), { recursive: true });
  writeFileSync(join(dir, "WORLD", "world-state.json"), JSON.stringify({ tick: 1, marks }));
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { stdio: ["ignore", "pipe", "pipe"] });
  git("init", "-q", "-b", "main");
  git("-c", "user.name=t", "-c", "user.email=t@t", "add", ".");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "world");
  return dir;
}

test("an amend that re-sends the picture its published mark already carries hangs nothing new, so it is not refused; a changed one is", async () => {
  holdMedia(HELD);
  const { leaveMarkViaOffice } = await import("../src/world.mjs");
  const world = worldWith([{ id: "tester/picture-test", by: "tester", image: NOT_MINTED }]);
  try {
  // the same legacy picture, re-sent by an amend (a set-down carries every field):
  // past the gate, whatever the rest of the door then says
  const same = await leaveMarkViaOffice(world, { ...MARK, amend: true, image: NOT_MINTED }, KEY).then(() => null, (e) => e);
  assert.notEqual(same?.defect, "the town holds no file at that URL");
  // the same picture on a NEW mark is a new hang, and refused
  await assert.rejects(leaveMarkViaOffice(world, { ...MARK, slug: "another", image: NOT_MINTED }, KEY),
    (e) => e.defect === "the town holds no file at that URL");
  // an amend that CHANGES the picture to one the town never held is refused
  await assert.rejects(leaveMarkViaOffice(world, { ...MARK, amend: true, image: NEVER_PUT }, KEY),
    (e) => e.defect === "the town holds no file at that URL");
  } finally { rmSync(world, { recursive: true, force: true }); }
});

test("the server registers its own paper as the ledger, beside opening it", () => {
  const src = readFileSync(new URL("../src/server.mjs", import.meta.url), "utf8");
  assert.match(src, /odb = await openPaper\(OAUTH_DB_PATH[\s\S]{0,1200}useMediaLedger\(odb\);/);
});

test("the profile door residents reach checks the ledger; the drain's replay door does not", async () => {
  holdMedia(HELD);
  const { updateProfileAtDoor, updateProfile } = await import("../src/edit.mjs");
  const { TOWN_DOORS } = await import("../src/town-bridge.mjs");
  await assert.rejects(updateProfileAtDoor({ handle: "tester", image: NEVER_PUT }, KEY, null, "/no/clone"),
    (e) => e.code === 422 && e.defect === "the town holds no file at that URL");
  assert.equal(TOWN_DOORS.update_profile, updateProfile, "a replay re-applies what a door admitted, unjudged");
  // WLD-83: the skins reach updateProfileAct (the sheet split), which judges through updateProfileAtDoor on both paths.
  const { updateProfileAct } = await import("../src/edit.mjs");
  await assert.rejects(updateProfileAct({ handle: "tester", image: NEVER_PUT }, KEY, null, "/no/clone"),
    (e) => e.code === 422 && e.defect === "the town holds no file at that URL", "the act a skin calls judges the picture");
  const act = readFileSync(new URL("../src/edit.mjs", import.meta.url), "utf8").replace(/\r\n/g, "\n").split("export async function updateProfileAct")[1].split("\n}\n")[0];
  assert.equal((act.match(/updateProfileAtDoor\(/g) ?? []).length, 2, "both of its paths go through the judged door");
  assert.doesNotMatch(act, /await updateProfile\(/);
  for (const f of ["household-apex.mjs", "mcp.mjs", "server.mjs"]) {
    const src = readFileSync(new URL(`../src/${f}`, import.meta.url), "utf8");
    assert.match(src, /updateProfileAct|updateProfileAtDoor/, `${f} reaches the judged door`);
    assert.doesNotMatch(src, /profile: updateProfile\b|update_profile: updateProfile\b|await updateProfile\(/, `${f} never calls the unjudged one`);
  }
});
