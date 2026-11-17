// paged-reads-one-grammar.test.mjs — every paged read walks on the same word.
//
// THE DRIFT THIS CATCHES, and it caught two of mine (fresh reviewer, 2026-09-07,
// repair 3): a read that answers `next_offset` also answers the sentence telling
// you what is past the cut. Nine reads in this office spell that sentence
// `more_note`. Two new ones spelled it `note` — and `note` is already taken at
// this door for a STATIC teaching line (`commits` answers one on every call,
// paged or not), so the same key meant two things depending on which read you
// were standing at. That is the cross-door grammar rule failing at the exact
// place it is cheapest to keep: a reader who learned the pattern at `letters`
// must not relearn it at `marks`.
//
// THE PROBE IS THE SOURCE, not a hand-kept list of reads. A list would need
// updating by the same person who forgot the convention, and would go stale
// silently; this walks every `next_offset:` the office emits and requires the
// convention beside it, so a read born tomorrow is covered the day it is born.
//
//   node --test test/paged-reads-one-grammar.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SRC = new URL("../src/", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = readdirSync(SRC).filter((f) => f.endsWith(".mjs"));

// The emission sites: an object literal answering a cursor. Prefixed spellings
// count too — `conversations_next_offset` and `letter_threads_next_offset` are
// the same promise under a view's own noun, and each must carry the matching
// prefixed note.
// ⚠ GREEDY, and the first draft was not: `(\w*?)next_offset:` matches the empty
// prefix at the tail of `conversations_next_offset:`, so every site reported
// prefix "" and the pre-convention skip below never fired. A probe whose own
// parse is wrong reports the world as wrong — which is how this one nearly
// filed three findings against the base.
const CURSOR = /(\w*)next_offset:/g;

function sites() {
  const out = [];
  for (const f of files) {
    const text = readFileSync(join(SRC, f), "utf8");
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      // Emissions only — not schema prose describing the field to a caller.
      if (!/next_offset:\s*\w/.test(line)) return;
      if (/description:|type: "number"/.test(line)) return;
      for (const m of line.matchAll(CURSOR)) {
        // The note rides within a few lines of its cursor, in the same literal.
        const window = lines.slice(i, i + 6).join("\n");
        out.push({ file: f, line: i + 1, prefix: m[1].replace(/_$/, ""), window });
      }
    });
  }
  return out;
}

// ── THREE THAT PREDATE THE CONVENTION, NAMED RATHER THAN EXEMPTED ───────────
//
// The awaiting view spells its cursor sentence `conversations_note` and, on the
// slim skin, `letter_threads_note`. Both are at the BASE (queries.mjs § the
// conversation ledger), both are PUBLIC answer shape, and the base even carries
// a rename map between the two spellings — so renaming them changes what a
// frozen consumer already reads, which is the conductor's call and not this
// lane's. They are written down here, with their prefixes, so they are VISIBLE
// rather than invisible: a silent exemption inside this probe would be the same
// defect the probe exists to catch, one level up. Nothing joins this list
// without somebody editing it.
const PREDATES = new Set(["conversations", "letter_threads"]);

test("the pre-convention list does not grow — an old spelling is a debt, not a precedent", () => {
  // A new read adopting one of those prefixes would inherit the exemption by
  // accident, so the sites are counted too: two for `conversations` (the ledger
  // and the slim view's destructure) and one for `letter_threads`.
  const byPrefix = {};
  for (const s of sites()) if (PREDATES.has(s.prefix)) byPrefix[s.prefix] = (byPrefix[s.prefix] ?? 0) + 1;
  assert.deepEqual(byPrefix, { conversations: 2, letter_threads: 1 },
    "a fourth pre-convention site appeared — it is either a new read that must use more_note, or a rename the conductor took");
});

test("every read that answers next_offset answers `more_note` beside it — one grammar, all doors", () => {
  const found = sites();
  assert.ok(found.length >= 8, `expected the office's paged reads to be found; saw ${found.length}`);
  const wrong = [];
  for (const s of found) {
    if (PREDATES.has(s.prefix)) continue;
    const want = s.prefix ? `${s.prefix}_more_note` : "more_note";
    if (!s.window.includes(`${want}:`)) wrong.push(`${s.file}:${s.line} answers ${s.prefix ? s.prefix + "_" : ""}next_offset with no ${want}`);
  }
  assert.deepEqual(wrong, [], `paged reads spelling their walk-on sentence something other than more_note:\n${wrong.join("\n")}`);
});

test("`note` is not used as a cursor sentence anywhere a cursor is answered", () => {
  // The other half of the same rule: it is not enough to ADD `more_note`; the
  // ambiguous spelling must not survive beside it, or both are served and the
  // drift is preserved under a fixed name.
  //
  // ⚠ BUILT WITHOUT A REGEX LITERAL, and there is a scar behind that. The first
  // draft composed this pattern inside a template literal, where `\w` and `\s`
  // are escape sequences that collapse to bare `w` and `s` — the compiled
  // pattern was `(^|[^_w])note:s*` and matched nothing, so the probe passed by
  // being unable to fail. `String.raw` keeps the backslashes, and the
  // can-fail assertion at the end of this test proves the pattern still bites.
  const noteRe = (prefix) => new RegExp(
    String.raw`(^|[^_\w])` + (prefix ? `${prefix}_` : "") + String.raw`note:\s*` + "`" + String.raw`\$\{`, "m");
  const wrong = [];
  for (const s of sites()) {
    // The same two, exempted by the same named list and for the same reason —
    // public answer shape at the base, with a rename map already written for
    // them. The list is above and visible; this is not a second exemption.
    if (PREDATES.has(s.prefix)) continue;
    if (noteRe(s.prefix).test(s.window))
      wrong.push(`${s.file}:${s.line} still answers an interpolated ${s.prefix ? s.prefix + "_" : ""}note beside its cursor`);
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));

  // THE PROBE CAN FAIL. A line in exactly the shape this hunts is fed through
  // the same matcher, so a future edit that flattens the escapes again reds
  // here instead of going quietly green.
  assert.ok(noteRe("").test("      note: `${total - next} further thing`"),
    "the matcher must bite on a bare interpolated note beside a cursor");
  assert.ok(noteRe("conversations").test("      conversations_note: `${n} further`"),
    "…and on a prefixed one");
  assert.ok(!noteRe("").test("      more_note: `${n} further`"),
    "…and must NOT bite on the correct spelling, or every read would look wrong");
});

// ── EVERY READ THAT LISTS THINGS TAKES `limit` AND `offset` (POS-732) ───────
//
// LAW (Darko, 2026-11-16 22:58 EST, POS-844 sitting): "Ooh, yes, paging unification. That sounds really good. We need
// to do this." — `limit` (default 20, held under the ~10K ceiling) and `offset` in; `next_offset` and `more_note` out,
// on every door.
//
// The probe above holds the spelling where a read ANSWERS a cursor. This holds the other half: that a read which lists
// takes `limit` and `offset` at all. THE REGISTRIES ARE THE SOURCE (the household and town doors' own read tables), and
// every read in them is CLASSIFIED below, so a read born tomorrow fails here until somebody says what it is:
//   list     lists things: must declare `limit` and `offset` (a read with no `limit` fails)
//   cursor   lists things and walks by a cursor instead (the feed's and stances', ruled): must declare `limit` and `cursor`
//   bounded  one thing, or a fixed set the door itself names: says why
//   debt     lists things and does not take `limit` + `offset` yet: named, and it can only shrink (a debt read that
//            now takes both fails until it moves to `list`)
// The world door's reads are not classified here: they follow under the same test (POS-732 stays open on them).
import { HOUSEHOLD_READ_FIELDS } from "../src/household-apex.mjs";
import { TOWN_READS } from "../src/town-apex.mjs";
import { TOOLS } from "../src/mcp.mjs";

const HOUSEHOLD_CLASSES = {
  doorstep: ["bounded", "a bundle of named segments, each a bounded read; its offset walks the correspondence ledger"],
  mail: ["list"], window: ["bounded", "one pane"],
  stances: ["cursor", "pages by size with a cursor (CORE-88)"],
  outcomes: ["debt", "`crossings` sets how far back, and every row of those crossings comes (audit item 6)"],
  rulings: ["bounded", "the old name of outcomes: a renamed pointer"],
  stakes: ["debt", "bare is every row, ruled in POS-902; `limit` is the doorstep's newest-few preview and there is no offset"],
  address: ["bounded", "one card"], home: ["bounded", "one page"], standing: ["bounded", "one fixed block of numbers"],
  stamps: ["list"],
  quests: ["debt", "the board lists every pot, closed ones included (audit item 4)"],
  fund: ["debt", "each open pot with all its patrons and stakers (audit item 4)"],
  media: ["list"],
  letter: ["bounded", "one letter"],
  earpiece: ["debt", "every wake for one event, newest first, and no page"],
  house: ["list"],
  "needs-you": ["bounded", "pages by size, by part and cursor (CORE-88)"],
  posts: ["list"],
  closer: ["list"], correspondents: ["list"], happened: ["list"],
  day: ["bounded", "one UTC day"], hearth: ["bounded", "one house's bundle"],
  waiting: ["bounded", "groups with counts; its stubs open the paged reads (CORE-88)"],
  marks: ["list"],
  blocks: ["debt", "a house's mail blocks, one row each, uncapped"],
  settings: ["bounded", "a fixed set of the house's settings"],
  refusals: ["list"],
};
const TOWN_CLASSES = {
  town: ["bounded", "the town at a glance"], bulletin: ["list"], metrics: ["bounded", "a fixed set of counts"],
  residents: ["list"], resident: ["bounded", "one card"], home: ["bounded", "one page"],
  votes: ["debt", "every open topic, no page"], stamps: ["list"], regions: ["list"], letters: ["list"],
  letter: ["bounded", "one letter"],
  commits: ["list"],
  search: ["list"],
  discover: ["debt", "takes `limit` (1 to 20) but no `offset`"],
  marks: ["list"],
  quests: ["debt", "the board lists every pot, closed ones included (audit item 4)"],
  bounties: ["debt", "every notice on the board, no page"],
  ideas: ["debt", "every published idea mark and every idea post beside it, no page"],
  calendar: ["debt", "now, soon and ended, whole"], event: ["debt", "the calendar under the post machine's name"],
  posts: ["list"], quest: ["list"],
  asks: ["bounded", "the five buildings' plaques"],
  feed: ["cursor", "the feed pages by cursor, ruled (POS-844)"],
  pair: ["bounded", "two residents' summary"], docs: ["bounded", "the town's own docs, a fixed set"],
};
const schemaFields = (read) => {
  const tool = TOOLS.find((t) => t.name === TOWN_READS[read].tool);
  return Object.keys(tool?.inputSchema?.properties ?? {});
};
const FIELDS_OF = {
  household: (read) => Object.keys(HOUSEHOLD_READ_FIELDS[read] ?? {}),
  town: schemaFields,
};
const DOORS = { household: [HOUSEHOLD_CLASSES, Object.keys(HOUSEHOLD_READ_FIELDS)], town: [TOWN_CLASSES, Object.keys(TOWN_READS)] };

test("every read on the household and town doors is classified: a new read must say whether it lists", () => {
  const lost = [];
  for (const [door, [classes, reads]] of Object.entries(DOORS)) {
    for (const r of reads) if (!classes[r]) lost.push(`${door} { read: "${r}" } is unclassified: list, cursor, bounded or debt`);
    for (const r of Object.keys(classes)) if (!reads.includes(r)) lost.push(`${door} { read: "${r}" } is classified but the door has no such read`);
  }
  assert.deepEqual(lost, [], lost.join("\n"));
});

test("a list read with no `limit` fails: every `list` read declares `limit` and `offset`, every `cursor` read `limit` and `cursor`", () => {
  const wrong = [];
  for (const [door, [classes]] of Object.entries(DOORS)) {
    for (const [read, [kind]] of Object.entries(classes)) {
      const has = FIELDS_OF[door](read);
      const need = kind === "list" ? ["limit", "offset"] : kind === "cursor" ? ["limit", "cursor"] : [];
      for (const f of need) if (!has.includes(f)) wrong.push(`${door} { read: "${read}" } lists things and does not take \`${f}\``);
    }
  }
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("the debt can only shrink: a read in debt that now takes `limit` and `offset` moves to `list`", () => {
  const paid = [];
  for (const [door, [classes]] of Object.entries(DOORS)) {
    for (const [read, [kind]] of Object.entries(classes)) {
      if (kind !== "debt") continue;
      const has = FIELDS_OF[door](read);
      if (has.includes("limit") && has.includes("offset")) paid.push(`${door} { read: "${read}" } takes limit and offset: classify it \`list\``);
    }
  }
  assert.deepEqual(paid, [], paid.join("\n"));
});

// A DOOR HONOURS WHAT IT DECLARES (review of #1085). Declaring `limit` and `offset` in a table proves the table; media declared nothing and said "call again
// with offset", which is a different failure, and a read can declare both and drop them. So each door is driven with the fields: the town apex hands each
// list read's fields to its tool (a spy at the dispatcher, after the real validator), and the household apex's own validator is asked and must not refuse
// either by name. The grammar's behaviour past the door is held where the read is built (page-rows.test.mjs, household-media, household-posts, quest-posts, idea-post 7f).
import { townApex } from "../src/town-apex.mjs";
import { householdApex } from "../src/household-apex.mjs";

test("every `list` read's door honours `limit` and `offset`: the town apex delivers them to the read, the household apex does not refuse them", async () => {
  const schemas = Object.fromEntries(TOOLS.map((t) => [t.name, t.inputSchema.properties]));
  const wrong = [];
  let checked = 0;
  for (const [read, [kind]] of Object.entries(TOWN_CLASSES)) {
    if (kind !== "list") continue;
    const got = [];
    const args = { ...(read === "posts" ? { class: "bug" } : {}), limit: 3, offset: 2 };
    const r = await townApex({ read, args }, null, { schemas, call: async (tool, fields) => { got.push(fields); return { ok: true }; } });
    checked++;
    if (r?.error) wrong.push(`town { read: "${read}" } refused limit and offset: ${r.defect}`);
    else if (got.length !== 1 || got[0].limit !== 3 || got[0].offset !== 2) wrong.push(`town { read: "${read}" } did not deliver limit and offset to its read: ${JSON.stringify(got)}`);
  }
  for (const [read, [kind]] of Object.entries(HOUSEHOLD_CLASSES)) {
    if (kind !== "list") continue;
    const r = await householdApex({ read, args: { limit: 3, offset: 2 } }, null, { key: null, clone: null, odb: null }).catch((e) => ({ thrown: String(e?.message ?? e) }));
    checked++;
    if (/unknown argument "(limit|offset)"/.test(JSON.stringify(r))) wrong.push(`household { read: "${read}" } refused limit or offset by name: ${r.defect}`);
  }
  assert.ok(checked >= 20, `the check ran over the door's list reads (${checked})`);
  assert.deepEqual(wrong, [], wrong.join("\n"));
});

test("the probe can fail: a list read missing `limit` is found, and the pagers' own fields are read, not assumed", () => {
  // CONTROLS. A table that could not name a bad read would pass by being unable to fail.
  assert.ok(!FIELDS_OF.household("closer").includes("nonesuch") && FIELDS_OF.household("closer").includes("limit"),
    "closer's field list is read from the door's own table");
  assert.ok(FIELDS_OF.household("quests").length === 0 || !FIELDS_OF.household("quests").includes("limit"),
    "a debt read really lacks `limit` today: the classification is measured, not copied");
  assert.ok(FIELDS_OF.town("posts").includes("limit") && FIELDS_OF.town("posts").includes("offset"),
    "the town posts read takes both, for every class (POS-732 was: the bug class only)");
  assert.ok(FIELDS_OF.household("media").includes("offset"), "media said \"call again with offset\" and its door refused offset: both fields are now declared");
});
