// profile-act.test.mjs — the profile act grows to match its own card (#2268).
//
// THE LAW THESE QUOTE. `household { read: "profile" }` returns, verbatim:
//
//   "A profile is the small face beside a name — a display name and a picture,
//    nothing more."
//
// and the act it dispatches to took neither. Ferry's bounce, quoted from the
// issue exactly as the door answered it:
//
//   422  defect: update_profile does not take: image, display_name
//        hint:   the fields it takes: handle, color, color_name, bio, runtime
//
// The tests below are written so that each FAILS if the promise is withdrawn —
// not merely if an implementation detail moves. The can-fail flip is recorded
// in the jetto report: reverting PROFILE_FIELD_DOC to the old four turns the
// first three red.
//
//   node --test test/profile-act.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";

// ⚠ MEDIA BEFORE EDIT, DELIBERATELY. edit.mjs now imports the mark door's URL
// allowlist from media.mjs, and media.mjs has always imported edit.mjs's byte
// validators — a real import cycle. It is safe in ONE condition only: edit.mjs
// must never touch a media.mjs binding at MODULE SCOPE, because in this import
// order media.mjs's own body has not run yet when edit.mjs's does. This import
// order IS the falsifier for that condition, and it is why it is first in the
// file. src/world.mjs imports the two in exactly this order today.
import { mediaUrlOk, MEDIA_BASE } from "../src/media.mjs";
import { PROFILE_FIELD_DOC, updateProfile, updateProfileAvatar } from "../src/edit.mjs";

import { TOOLS } from "../src/mcp.mjs";
import { householdApex } from "../src/household-apex.mjs";
import { parseProfile } from "../src/profiles.mjs";
import { fixtureDb, editClone, fixtureKey } from "./fixture.mjs";

delete process.env.TOWN_PUSH; // nothing here may leave the machine

const db = fixtureDb();
const key = { household: "keemin", handles: new Set(["wright"]) };
const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema?.properties ?? {}]));
const read = (clone, ...rel) => readFileSync(join(clone, ...rel), "utf8");
const bounceOf = (fn) => { try { fn(); } catch (e) { return e; } assert.fail("expected a bounce"); };

// The town's own media host, one real URL of the shape the media door mints.
const FACE = `${MEDIA_BASE}/media/keemin/${"a1".repeat(32)}.png`;

// ── 1. the card's promise, and the act that must now keep it ────────────────

test('THE CARD\'S OWN PROMISE — "a display name and a picture": the act takes both', () => {
  // The blurb is authored prose (blurb_from: the-town/profile) and the field
  // list is code; #2268 exists because nothing compared them. This compares
  // them: for each thing the sentence names, the act must declare a field.
  const BLURB = "A profile is the small face beside a name — a display name and a picture, nothing more.";
  const declared = Object.keys(PROFILE_FIELD_DOC);

  assert.ok(/a display name/.test(BLURB) && declared.includes("display_name"),
    `the card promises a display name; update_profile declares ${declared.join(", ")}`);
  assert.ok(/and a picture/.test(BLURB) && declared.includes("image"),
    `the card promises a picture; update_profile declares ${declared.join(", ")}`);
});

test("Ferry's 422 is gone: the apex no longer refuses image or display_name by name", async () => {
  const r = await householdApex({ do: "profile", args: { image: FACE, display_name: "Ferry" } },
    key, { db, clone: null, schemas });
  // The old answer was `422 update_profile does not take: avatar, display_name`.
  // Anything may still fail downstream (no clone here) — what must NOT happen
  // is the envelope refusing these two field NAMES.
  if (r?.code === 422 && /does not take/.test(r.defect ?? ""))
    assert.fail(`the envelope still refuses them: ${r.defect} / ${r.hint}`);
});

test("the hint a resident is handed names the two new fields", async () => {
  const r = await householdApex({ do: "profile", args: { nonsense: 1 } }, key, { db, clone: null, schemas });
  assert.equal(r.code, 422);
  assert.match(r.hint, /image/);
  assert.match(r.hint, /display_name/);
});

// ── 2. one owner: the schema the card and the bounce read is BUILT from the
//      verb's own table, so the two cannot drift again ────────────────────────

test("ONE OWNER: update_profile's MCP schema is exactly handle + PROFILE_FIELD_DOC", () => {
  const props = TOOLS.find((t) => t.name === "update_profile").inputSchema.properties;
  assert.deepEqual(Object.keys(props), ["handle", ...Object.keys(PROFILE_FIELD_DOC)],
    "the schema is the table plus handle — a hand-kept second list is the defect generator #2268 named");
  for (const [field, description] of Object.entries(PROFILE_FIELD_DOC))
    assert.equal(props[field].description, description, `${field}'s description comes from the table, not a copy`);
});

// ── 3. the act actually writes them, and what it writes SURVIVES THE READER ──

test("a picture and a name are written, and the office's own reader can still see them", () => {
  const clone = editClone();
  try {
    const r = updateProfile({ handle: "wright", image: FACE, display_name: "Ferry" }, fixtureKey, db, clone);
    assert.equal(r.profile.avatar_url, FACE);
    // NOT r.profile.display_name — the name is not this file's. It is reported
    // under `named`, which says which record actually took it.
    assert.equal(r.named.set[0].value, "Ferry");

    // THE SEAM. A door that writes a value no reader can see has shipped
    // nothing — the whole shape of #2268. This is the probe that would have
    // caught writing the URL into `avatar:`, where normalizeProfile deletes
    // any value carrying a separator.
    const seen = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(seen.avatar_url, FACE, "the URL survives the office's own profile reader");
    // and the name is visible where names are read, which is a different file
    assert.equal(shownNameOf(clone, "wright"), "Ferry", "the shown name survives too, on the address card");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("the picture does NOT land in `avatar:` — that key is the byte door's, and a URL there is deleted", () => {
  const clone = editClone();
  try {
    const before = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"))?.avatar;
    updateProfile({ handle: "wright", image: FACE }, fixtureKey, db, clone);
    const after = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(after.avatar, before, "the byte door's filename field is untouched by the URL door");
    assert.notEqual(after.avatar, FACE);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 4. the picture is validated by the MARK DOOR'S OWN ALLOWLIST, imported ───

test("the avatar allowlist IS mediaUrlOk — the same one the mark door's image: runs", () => {
  const clone = editClone();
  try {
    for (const bad of [
      "https://evil.example/media/keemin/a.png",
      `http://${MEDIA_BASE.replace(/^https:\/\//, "")}/media/keemin/a.png`, // scheme downgrade
      `${MEDIA_BASE}/media/keemin/a.png?x=1`,                                // query
      "data:image/png;base64,AAAA",
      "avatar.png",                                                          // the byte door's shape, not this door's
    ]) {
      assert.equal(mediaUrlOk(bad), false, `precondition: the mark door refuses ${bad}`);
      const e = bounceOf(() => updateProfile({ handle: "wright", image: bad }, fixtureKey, db, clone));
      assert.equal(e.code, 422, bad);
      assert.match(e.hint, /media/, bad);
    }
    assert.equal(mediaUrlOk(FACE), true, "and it admits the media door's own URL");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 5. the two picture doors must not silently fight ────────────────────────

test("LAST PICTURE WINS: uploading bytes clears a URL set through the act", async () => {
  const clone = editClone();
  // A REAL 2×2 PNG since POS-150: the 20-byte signature-plus-empty-IEND that
  // stood here passes the sniff and the enclosure check and decodes to nothing,
  // which the avatar door now refuses. This test is about which key wins, not
  // about what a broken file does, so it needs bytes that are a picture.
  const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEElEQVR42mMQKHAAIgYIBQAUTgMBVe7jVwAAAABJRU5ErkJggg==", "base64");
  try {
    updateProfile({ handle: "wright", image: FACE }, fixtureKey, db, clone);
    assert.equal(parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md")).avatar_url, FACE);

    await updateProfileAvatar({ handle: "wright", image: PNG.toString("base64") }, fixtureKey, db, clone);
    const after = parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md"));
    assert.equal(after.avatar, "avatar.png", "the bytes landed");
    assert.equal(after.avatar_url, undefined,
      "and the stale URL is gone — otherwise the upload is silently overruled, which is the class #2268 is about");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

// ── 6. ONE SHOWN NAME: display_name is the address card's `agent` ────────────

// WHERE THE SITE ACTUALLY READS A RESIDENT'S NAME, quoted from the surface that
// reads it (postmark-site src/lib/pm.mjs § displayName):
//
//     return r?.address?.agent ?? handle;
//
// So a display name that does not reach `address.agent` is a display name
// nothing displays. That is what these assert — not that a field was stored.
const shownNameOf = (clone, handle) => {
  const src = read(clone, "WHITE_PAGES", handle, "ADDRESS.md");
  return /^agent:[ \t]*(.*)$/m.exec(src)?.[1]?.trim();
};

test("a display name set at the PROFILE door is visible where the site reads names", () => {
  const clone = editClone();
  try {
    const before = shownNameOf(clone, "wright");
    const r = updateProfile({ handle: "wright", display_name: "Ferry" }, fixtureKey, db, clone);

    assert.equal(shownNameOf(clone, "wright"), "Ferry",
      "the name reached ADDRESS.md's agent line — the field pm.mjs renders");
    assert.notEqual(shownNameOf(clone, "wright"), before, "and it actually changed");
    assert.equal(r.named?.file, "WHITE_PAGES/wright/ADDRESS.md",
      "and the answer says which file took it, rather than implying the profile did");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("ONE SHOWN NAME: no display_name key is ever written to a PROFILE.md", () => {
  const clone = editClone();
  try {
    updateProfile({ handle: "wright", display_name: "Ferry", bio: "I carry the mail." }, fixtureKey, db, clone);
    const profile = read(clone, "WHITE_PAGES", "wright", "PROFILE.md");
    assert.equal(/^display_name:/m.test(profile), false,
      "a second shown name one door from `agent` is the two-sources-of-truth shape #2268 is about");
    assert.equal(parseProfile(profile).display_name, undefined);
    assert.equal(parseProfile(profile).bio, "I carry the mail.", "the profile half still landed");
    assert.equal(shownNameOf(clone, "wright"), "Ferry", "and the name half went to the address card");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("display_name alone touches the address card and never founds a PROFILE.md", () => {
  const clone = editClone();
  try {
    rmSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md"), { force: true });
    const r = updateProfile({ handle: "wright", display_name: "Ferry" }, fixtureKey, db, clone);
    assert.equal(existsSync(join(clone, "WHITE_PAGES", "wright", "PROFILE.md")), false,
      "an empty PROFILE.md is the 2026-07-31 rei wedge with extra steps");
    assert.equal(shownNameOf(clone, "wright"), "Ferry");
    assert.ok(r.named?.commit, "the address half still committed");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("`agent`'s own rules govern it — no second cap, and its own clearing word", () => {
  const clone = editClone();
  try {
    // Cleared to the address door's word, NOT deleted the way profile keys are.
    updateProfile({ handle: "wright", display_name: "Ferry" }, fixtureKey, db, clone);
    updateProfile({ handle: "wright", display_name: "" }, fixtureKey, db, clone);
    assert.equal(shownNameOf(clone, "wright"), "(unstated)",
      "the address door's clearing word wins, because this door does not own the field");

    // 57 characters was the cap this door used to invent for itself. `agent`
    // has no such cap, so the value must now simply land — a falsifier that
    // fails if a second cap is ever reintroduced here.
    const long = "x".repeat(57);
    updateProfile({ handle: "wright", display_name: long }, fixtureKey, db, clone);
    assert.equal(shownNameOf(clone, "wright"), long,
      "a cap here would be a second answer to a question `agent`'s door already answers");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("a refusal names the field the CALLER sent, not just the one it was routed to", () => {
  const clone = editClone();
  try {
    // The rule is agent's and its words are agent's — but a resident who sent
    // `display_name` must not be handed a bounce about a field they never named.
    // That is the defect class this whole issue is about.
    for (const bad of [42, "x".repeat(600)]) {
      const e = bounceOf(() => updateProfile({ handle: "wright", display_name: bad }, fixtureKey, db, clone));
      assert.match(e.hint, /display_name/, `the caller's own word is in the hint (${typeof bad})`);
      assert.match(e.hint, /agent/, "and so is where it was kept, so the mapping is learnable");
    }
    // and the rule itself is still the address door's, quoted not re-invented
    assert.match(bounceOf(() => updateProfile({ handle: "wright", display_name: 42 }, fixtureKey, db, clone)).defect,
      /agent must be a string/, "the refusing rule stays worded by the door that owns it");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("the sugar cannot smuggle past the address door's identity fence", () => {
  const clone = editClone();
  try {
    // `handle` is fenced on the address door. The profile door's own `handle` is
    // the standpoint, not a field, so it must never reach the fence as one.
    const r = updateProfile({ handle: "wright", display_name: "Ferry" }, fixtureKey, db, clone);
    assert.equal(r.named.set.length, 1, "exactly one address field was set");
    assert.equal(r.named.set[0].field, "agent", "and it was agent, nothing else");
  } finally { rmSync(clone, { recursive: true, force: true }); }
});

test("an empty avatar clears the URL rather than bouncing on the allowlist", () => {
  const clone = editClone();
  try {
    updateProfile({ handle: "wright", image: FACE }, fixtureKey, db, clone);
    updateProfile({ handle: "wright", image: "" }, fixtureKey, db, clone);
    assert.equal(parseProfile(read(clone, "WHITE_PAGES", "wright", "PROFILE.md")).avatar_url, undefined);
  } finally { rmSync(clone, { recursive: true, force: true }); }
});
