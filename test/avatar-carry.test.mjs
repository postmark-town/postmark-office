// avatar-carry.test.mjs — every profile picture carried once into the one picture key (WLD-83).
//
// Darko, 2026-10-19 18:24: "one picture, not two". The carry keeps the face
// each resident shows today: a file avatar is minted and kept as a URL, a
// profile already showing its URL has the older key cleared, and nothing else
// is touched. Every handle here is the fixture's or invented.
//
//   node --test test/avatar-carry.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

import { MEDIA_BASE } from "../src/media.mjs";
import { updateProfile } from "../src/edit.mjs";
import { avatarPlan, carryAvatars } from "../tools/avatar-carry.mjs";
import { editClone, fixtureTown } from "./fixture.mjs";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR42mMQKHAAIgYIBQAUTgMBVe7jVwAAAABJRU5ErkJggg==", "base64");
const urlOf = (bytes) => `${MEDIA_BASE}/media/keemin/${createHash("sha256").update(bytes).digest("hex")}.png`;
const SHOWN = `${MEDIA_BASE}/media/keemin/${"c3".repeat(32)}.png`;

function town() {
  const clone = editClone();
  const put = (h, fm, files = {}) => {
    const dir = join(clone, "WHITE_PAGES", h);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "PROFILE.md"), `---\n${fm}\n---\n`);
    for (const [name, bytes] of Object.entries(files)) writeFileSync(join(dir, name), bytes);
  };
  put("filed", 'avatar: "avatar.png"\ncolor: "#aabbcc"', { "avatar.png": PNG });
  put("both", `avatar: "avatar.png"\navatar_url: "${SHOWN}"`, { "avatar.png": PNG });
  put("linked", `avatar_url: "${SHOWN}"`);
  put("lost", 'avatar: "gone.png"');
  put("plain", 'bio: "no picture"');
  put("homeless", 'avatar: "avatar.png"', { "avatar.png": PNG });
  return clone;
}
const keyFor = (h) => (h === "homeless" ? null : { household: "keemin", handles: new Set([h]) });

test("the plan reads each profile as it stands: mint a file, clear beside a URL, leave the rest", () => {
  const clone = town();
  try {
    assert.equal(avatarPlan(clone, "filed").act, "mint");
    assert.deepEqual(avatarPlan(clone, "both"), { handle: "both", act: "clear", url: SHOWN });
    assert.equal(avatarPlan(clone, "linked").act, "none");
    assert.deepEqual(avatarPlan(clone, "lost"), { handle: "lost", act: "missing", file: "gone.png" });
    assert.equal(avatarPlan(clone, "plain").act, "none");
    assert.equal(avatarPlan(clone, "nobody").act, "none");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("the carry mints a file avatar on its household's wall, keeps the URL, clears the older key, and keeps every face", async () => {
  const clone = town();
  const db = fixtureTown();
  const minted = [];
  try {
    const out = await carryAvatars({
      clone, householdFor: keyFor,
      upload: async (args, key, odb, { bytes }) => { minted.push([args.by, key.household]); return { url: urlOf(bytes) }; },
      write: (args, key) => updateProfile(args, key, db, clone),
    });
    assert.deepEqual(minted, [["filed", "keemin"]], "one mint, for the file-only profile, as itself on its own household");
    assert.deepEqual(out.minted.map((m) => [m.handle, m.url]), [["filed", urlOf(PNG)]]);
    assert.deepEqual(out.cleared.map((c) => c.handle), ["both"]);
    assert.deepEqual(out.skipped.missing.map((m) => m.handle), ["lost", "wright"], "the fixture's wright names a portrait that is not there, like lost");
    assert.deepEqual(out.skipped.noHousehold, ["homeless"]);
    const read = (h) => readFileSync(join(clone, "WHITE_PAGES", h, "PROFILE.md"), "utf8");
    assert.equal(read("filed"), `---\ncolor: "#aabbcc"\navatar_url: "${urlOf(PNG)}"\n---\n`, "one key, the same face, the colour kept");
    assert.equal(read("both"), `---\navatar_url: "${SHOWN}"\n---\n`, "the URL every reader already showed, alone");
    assert.equal(read("linked"), `---\navatar_url: "${SHOWN}"\n---\n`, "untouched");
    assert.equal(read("lost"), '---\navatar: "gone.png"\n---\n', "a broken pointer is reported, never guessed at");
    assert.deepEqual(readFileSync(join(clone, "WHITE_PAGES", "filed", "avatar.png")), PNG, "the file stays as history");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("a refused mint is a row in the report, and the profile is left as it was", async () => {
  const clone = town();
  try {
    const out = await carryAvatars({
      clone, householdFor: keyFor,
      upload: async () => { throw Object.assign(new Error("your household's media is full"), { code: 413, defect: "your household's media is full" }); },
      write: (args, key) => updateProfile(args, key, fixtureTown(), clone),
    });
    assert.deepEqual(out.skipped.refused.map((r) => [r.handle, r.code]), [["filed", 413]]);
    assert.match(readFileSync(join(clone, "WHITE_PAGES", "filed", "PROFILE.md"), "utf8"), /^avatar: "avatar\.png"$/m);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
