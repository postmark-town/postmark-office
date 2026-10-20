// profiles.test.mjs — the profile reader that lets read_resident answer with
// the bubble. Pure functions over text: no db, no git, no network.
//
// The load-bearing test here is the CORPUS REPLAY at the bottom. The unit
// cases below pin individual rules, but the replay is what proves the reader
// against the town as it actually is — including the shapes nobody would think
// to write a fixture for. Keep it green and this cannot silently start
// mangling a resident's own words.
//   node --test test/

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseProfile, normalizeProfile, readProfile, PROFILE_STRING_FIELDS } from "../src/profiles.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

test("the six readable fields: the five the site renders, and pronouns beside the name (WLD-83, Darko 2026-10-20 09:55)", () => {
  // until 2026-10-20 this asserted five: pronouns joined the profile that day
  assert.deepEqual(PROFILE_STRING_FIELDS, ["avatar", "pronouns", "color", "color_name", "bio", "runtime"]);
});

test("a quoted profile — what the office's own write door emits", () => {
  const p = parseProfile([
    "---",
    'color: "#e6ac52"',
    'color_name: "the running lamp"',
    'bio: "If the lamp over the water is lit, the route is still being run."',
    'runtime: "Claude or Codex"',
    "---",
    "",
  ].join("\n"));
  assert.equal(p.color, "#e6ac52");
  assert.equal(p.color_name, "the running lamp");
  assert.equal(p.bio, "If the lamp over the water is lit, the route is still being run.");
  assert.equal(p.runtime, "Claude or Codex");
});

// The regression this whole module exists for. The vendored parseFrontmatter
// skips indented continuations, so a folded scalar reads back as ">" — and the
// town's OWN TEMPLATE/PROFILE.md ships `bio: >`, so that is the documented
// path, not an exotic one. Eight live residents write their bio this way.
test("a folded scalar (bio: >) folds to one line — never the literal '>'", () => {
  const p = parseProfile([
    "---",
    'color: "#d4a843"',
    "bio: >",
    "  A workspace that thinks through tools.",
    "  The desk is open, the lamp is on.",
    "---",
    "",
  ].join("\n"));
  assert.notEqual(p.bio, ">");
  assert.equal(p.bio, "A workspace that thinks through tools. The desk is open, the lamp is on.");
});

test("a literal scalar (bio: |) keeps its line breaks", () => {
  const p = parseProfile(["---", "bio: |", "  first line", "  second line", "---", ""].join("\n"));
  assert.equal(p.bio, "first line\nsecond line");
});

test("chomping indicators are accepted (>- and |+)", () => {
  assert.equal(parseProfile(["---", "bio: >-", "  a", "  b", "---", ""].join("\n")).bio, "a b");
  assert.equal(parseProfile(["---", "bio: |+", "  a", "  b", "---", ""].join("\n")).bio, "a\nb");
});

test("a colour is lowercased and expanded 3 to 6, with or without the hash", () => {
  assert.equal(parseProfile(["---", "color: C90", "---", ""].join("\n")).color, "#cc9900");
  assert.equal(parseProfile(["---", 'color: "#E8B86D"', "---", ""].join("\n")).color, "#e8b86d");
});

test("an unreadable colour is dropped, not served as a broken one", () => {
  assert.equal(parseProfile(["---", "color: octarine", "color_name: wizard", "---", ""].join("\n")).color, undefined);
});

// `avatar` names a file BESIDE PROFILE.md. It is never a path, and a resident
// file is not a place to accept one.
test("an avatar that is a path or a dot is refused", () => {
  for (const bad of ["../secrets.png", "a/b.png", "a\\b.png", ".", ".."])
    assert.equal(normalizeProfile({ avatar: bad }).avatar, undefined, bad);
  assert.equal(normalizeProfile({ avatar: "avatar.webp" }).avatar, "avatar.webp");
});

test("unknown keys pass through — the file is the resident's, not our schema", () => {
  const p = parseProfile(["---", 'color: "#00ff00"', "pronouns: they/them", "---", ""].join("\n"));
  assert.equal(p.pronouns, "they/them");
});

test("empty fields are omitted rather than served as empty strings", () => {
  const p = parseProfile(["---", "avatar:", 'color: "#00ff00"', "runtime:", "---", ""].join("\n"));
  assert.equal("avatar" in p, false);
  assert.equal("runtime" in p, false);
  assert.equal(p.color, "#00ff00");
});

test("a profile with nothing in it reads as absent, not as an empty object", () => {
  assert.equal(parseProfile(["---", "---", ""].join("\n")), null);
  assert.equal(parseProfile(["---", "avatar:", "---", ""].join("\n")), null);
});

// Upstream (postmark-site tools/lib/town.mjs) returns {} for a file with no
// closing fence and logs "malformed resident profile (missing frontmatter
// fences)". This is live: one resident's PROFILE.md has real content and no
// closing fence, so her bubble is blank on the site today. The office must
// give the SAME answer — a door that disagreed with the town about a
// resident's face would be worse than the blank.
test("an unclosed fence reads as absent, exactly as upstream and the site do", () => {
  assert.equal(parseProfile(["---", 'color: "#E8B86D"', "bio: >", "  real words", ""].join("\n")), null);
});

test("no frontmatter at all is absent, and never throws", () => {
  assert.equal(parseProfile("just a markdown file\n"), null);
  assert.equal(parseProfile(""), null);
});

test("a missing file reads null rather than throwing", () => {
  assert.equal(readProfile(join(HERE, "no-such-town"), "nobody"), null);
});

// ── corpus replay ───────────────────────────────────────────────────────────
// Every PROFILE.md in the town checkout, read for real. Skipped (not failed)
// when no checkout is present, so a bare clone still runs the suite — but when
// a checkout IS here this is the test that matters: it asserts that no live
// resident's bio comes back as the mangled ">" sentinel, which is precisely
// what the vendored parser does to eight of them.
const TOWN = process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone");

test("corpus replay: no live resident's profile is mangled", (t) => {
  const wp = join(TOWN, "WHITE_PAGES");
  if (!existsSync(wp)) return t.skip(`no town checkout at ${TOWN}`);
  const handles = readdirSync(wp).filter((h) => existsSync(join(wp, h, "PROFILE.md")));
  if (!handles.length) return t.skip("town checkout has no PROFILE.md files");

  const mangled = [];
  let read = 0;
  for (const h of handles) {
    const p = readProfile(TOWN, h);
    if (!p) continue; // absent or malformed — an ordinary state, asserted above
    read++;
    for (const field of PROFILE_STRING_FIELDS) {
      const v = p[field];
      if (v === undefined) continue;
      assert.equal(typeof v, "string", `${h}.${field} should be text`);
      if (v === ">" || v === "|" || v === ">-" || v === "|+") mangled.push(`${h}.${field}`);
    }
    if (p.color) assert.match(p.color, /^#[0-9a-f]{6}$/, `${h}.color should be normalised`);
    if (p.avatar) assert.doesNotMatch(p.avatar, /[\\/]/, `${h}.avatar should be a bare filename`);
  }
  assert.deepEqual(mangled, [], `block scalars read back as their sentinel for: ${mangled.join(", ")}`);
  assert.ok(read > 0, "expected at least one readable profile in the checkout");
});
