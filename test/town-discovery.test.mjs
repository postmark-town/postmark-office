// town-discovery.test.mjs — discover, slice one (POS-497): what it reads, what
// it finds across a piece's seam, and how its bounded pages walk the record.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/town-discovery.test.mjs   (a pool tree's Postgres, or EMBEDDED_PG_DIR)
//
// LAW (Darko, 2026-11-03 09:22 EDT, POS-497/a): "Literal search + common correspondents".
// LAW (Wright, 2026-11-03, POS-497/b): "when discovery can't finish within its
// work bound, it returns the results found so far and says plainly that the
// page is incomplete. It hands a continuation tied to the source generation,
// never guesses an exact total, and never treats an empty page as proof of no
// matches. It never falls back to an unbounded scan."
//
// Every record here is invented. Each town's discovery rows are the
// derivation's own (src/town-discovery.mjs § discoveryRowsOf over the town's
// letters and homes), written into the store as the ingest writes them; the
// ingest's own transitions are test/town-discovery-ingest.test.mjs, and the
// plan's work bound is test/town-discovery-plan.test.mjs. Each expected answer
// is worked out here from the invented town, never read back from the store.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";

import { startStore } from "./helpers/embedded-store.mjs";
import { seedTownIndex } from "./helpers/index-to-store.mjs";
import { emptyTown, put, putValues, setMeta } from "./fixture.mjs";
import { discoveryRowsOf, piecesOf, DISCOVERY_EPOCH, DISCOVERY_LIMITS as L } from "../src/town-discovery.mjs";
import { discoveryRevisionOf, discoverySourcesOf, TOWN_TABLES } from "../src/town-index.mjs";
import * as store from "../src/town-index-store.mjs";

let s = null, w = null, api = null, su = null, skip = false;

before(async () => {
  s = await startStore({ db: "town_discovery" });
  if (s.skip) { skip = s.skip; return; }
  w = await s.connect("law_ingester");
  api = await s.connect("office_api");
  su = await s.connect("postgres");
});

after(async () => {
  for (const c of [w, api, su]) if (c) await c.end().catch(() => {});
  if (s?.stop) await s.stop();
});

// ── an invented town, as the store holds it ──────────────────────────────────

const rowsOf = (t, name) => t[name].map((r) => TOWN_TABLES[name].cols.map((c) => r[c]));

/** Rows by table: residents, letters and homes as given, discovery's two derived from them, and its generation in meta. */
function townOf({ residents = [], letters = [], homes = [], extra = () => {} }) {
  const t = emptyTown();
  for (const h of residents)
    put(t, "residents", { handle: h, json: JSON.stringify({ handle: h, address: { data: { note: "PRIVATE-CARD-SENTINEL" }, body: `# ${h}` } }) });
  for (const l of letters) {
    const box = l.box ?? "inbox";
    const json = { id: l.id, from: l.from, to: l.to ?? null, toList: l.toList ?? [], date: "2026-10-01", box, body: l.body ?? "", ...(l.extra ?? {}) };
    put(t, "letters", { id: l.id, from_h: l.from, to_h: l.to ?? null, date: "2026-10-01", box, owner: l.to ?? null,
      path: l.path ?? `WHITE_PAGES/${box === "inbox" ? l.to : l.from}/${box}/${l.id}.md`, json: JSON.stringify(json), delivered_at: null });
  }
  for (const h of homes)
    put(t, "homes", { handle: h.handle, region: null,
      json: JSON.stringify({ handle: h.handle, title: h.title ?? h.handle, region: null, description: h.description ?? "", images: [], picture: null }) });
  extra(t);
  const d = discoveryRowsOf(discoverySourcesOf(rowsOf(t, "letters"), rowsOf(t, "homes")));
  for (const r of d.chunks) putValues(t, "discovery_chunks", r);
  for (const r of d.edges) putValues(t, "letter_edges", r);
  setMeta(t, "as_of", "fixturesha000000000000000000000000000000");
  setMeta(t, "discovery_epoch", DISCOVERY_EPOCH);
  setMeta(t, "discovery_revision", discoveryRevisionOf(d.chunks, d.edges, residents));
  return t;
}

const seed = async (spec) => { await seedTownIndex(w, townOf(spec)); };

/** Every page of one walk, each held to the page law as it comes. */
async function walkAll(args, { maxPages = 400 } = {}) {
  const pages = [];
  let cursor = null;
  for (let i = 0; i < maxPages; i++) {
    const p = await store.discover(api, { ...args, ...(cursor ? { cursor } : {}) });
    assert.equal(p.error, undefined, `page ${i + 1} was refused: ${JSON.stringify(p)}`);
    assert.ok(Buffer.byteLength(JSON.stringify(p)) <= L.response_bytes, `page ${i + 1} weighs over ${L.response_bytes} bytes`);
    assert.equal(p.shown, p.hits.length, "shown is the hits this page returned");
    assert.equal("matches" in p, false, "no total is guessed");
    assert.equal("next_offset" in p, false, "no offset stands in for the cursor");
    pages.push(p);
    if (p.complete) { assert.equal(p.cursor, null, "a complete page hands no cursor"); return pages; }
    assert.equal(typeof p.cursor, "string", `page ${i + 1} is unfinished and must hand a cursor`);
    cursor = p.cursor;
  }
  throw new Error(`the walk did not finish in ${maxPages} pages`);
}
const handlesOf = (pages) => pages.flatMap((p) => p.hits.map((h) => h.handle));
const C = (a, b) => (Buffer.compare(Buffer.from(a), Buffer.from(b)));
const inC = (xs) => [...xs].sort(C);

// ── what it reads ────────────────────────────────────────────────────────────

test("discover reads letter bodies and home titles and descriptions, never a card, a mailbox or a letter's other fields; search beside it still reads the json", async (t) => {
  if (skip) return t.skip(skip);
  await seed({
    residents: ["ada", "bex", "cyd"],
    letters: [{ id: "ada-to-bex-1", from: "ada", to: "bex", body: "The LAMPLIGHT holds.", extra: { note: "META-SENTINEL" }, path: "WHITE_PAGES/bex/inbox/PATHSENTINEL.md" }],
    homes: [{ handle: "bex", title: "Riverside TITLEWORD", description: "A HOMEWORD by the water." }],
    extra: (town) => put(town, "mail_state", { handle: "cyd", json: JSON.stringify({ handle: "cyd", note: "MAILSTATE-SENTINEL" }) }),
  });
  const one = async (q, extra = {}) => store.discover(api, { mode: "text", q, ...extra });

  const lamp = await one("lamplight");
  assert.deepEqual(lamp.hits, [{ handle: "ada", source: { kind: "letter", id: "ada-to-bex-1" }, excerpt: "The LAMPLIGHT holds." }]);
  assert.equal(lamp.complete, true);
  assert.deepEqual((await one("titleword")).hits.map((h) => [h.handle, h.source]), [["bex", { kind: "home", handle: "bex" }]]);
  assert.deepEqual((await one("homeword")).hits.map((h) => h.handle), ["bex"]);

  for (const q of ["META-SENTINEL", "PRIVATE-CARD-SENTINEL", "MAILSTATE-SENTINEL", "PATHSENTINEL", "ada-to-bex-1"]) {
    const p = await one(q);
    assert.deepEqual([p.hits, p.complete], [[], true], `${q}: discover never reads it`);
  }
  // the control: the same store holds the sentinel where search reads, so the absence above is discover's own
  assert.ok((await store.search(api, "META-SENTINEL")).letters.some((l) => l.id === "ada-to-bex-1"), "search finds the sentinel in the letter's json");

  assert.deepEqual((await one("lamplight", { sources: ["homes"] })).hits, [], "letters only when asked for");
  assert.deepEqual((await one("homeword", { sources: ["letters"] })).hits, [], "homes only when asked for");
  assert.deepEqual((await one("homeword", { sources: ["homes", "letters"] })).scope, { mode: "text", sources: ["letters", "homes"], world_marks: "not in this slice" });
});

test("the literal: ASCII letters match in either case and nothing else is folded; %, _ and a backslash are plain characters", async (t) => {
  if (skip) return t.skip(skip);
  await seed({
    residents: ["ada", "bex", "cyd", "dee", "eve", "fay", "gus"],
    letters: [
      { id: "a", from: "ada", to: "bex", body: "a 100% sure thing" },
      { id: "b", from: "bex", to: "ada", body: "1000 ways" },
      { id: "c", from: "cyd", to: "ada", body: "a_b, then axb" },
      { id: "d", from: "dee", to: "ada", body: "C:\\path\\here" },
      { id: "e", from: "eve", to: "ada", body: "Éclair, then éclair" },
      { id: "f", from: "fay", to: "ada", body: "ÉCLAIR" },
      { id: "g", from: "gus", to: "ada", body: "only axb here" },
    ],
  });
  const who = async (q) => (await store.discover(api, { mode: "text", q })).hits.map((h) => h.handle);
  assert.deepEqual(await who("100%"), ["ada"], "% is a percent sign");
  assert.deepEqual(await who("a_b"), ["cyd"], "_ is an underscore");
  assert.deepEqual(await who("\\path"), ["dee"], "a backslash is a backslash");
  assert.deepEqual(await who("ÉCLAIR"), ["eve", "fay"], "É matches É, and the ASCII after it in either case");
  assert.deepEqual(await who("éclair"), ["eve"], "é is not folded to or from É");
  assert.deepEqual(await who("1000 WAYS"), ["bex"]);
});

// ── the seam ─────────────────────────────────────────────────────────────────

test("a piece's seam loses nothing: every window of 256 bytes or less in a mixed-width text lies whole in one piece", () => {
  // ASCII, two-, three- and four-byte codepoints, so seams fall at every width
  const body = Array.from({ length: 900 }, (_, i) => ["a", "é", "語", "🦊", " "][i % 5] + String.fromCharCode(65 + (i % 26))).join("");
  const pieces = piecesOf(body);
  assert.ok(pieces.length >= 3, "the body spans several pieces");
  for (const p of pieces) {
    assert.ok(Buffer.byteLength(p) <= L.base_bytes + L.query_bytes - 1, "a piece is at most 1279 bytes");
    assert.ok(body.includes(p), "a piece is the text's own, whole codepoints");
  }
  const cps = Array.from(body);
  let windows = 0;
  for (let i = 0; i < cps.length; i++) {
    let w = "";
    for (let j = i; j < cps.length && Buffer.byteLength(w + cps[j]) <= L.query_bytes; j++) w += cps[j];
    assert.ok(pieces.some((p) => p.includes(w)), `the ${Buffer.byteLength(w)}-byte window at codepoint ${i} is in no piece`);
    windows++;
  }
  assert.equal(windows, cps.length);
  assert.deepEqual(piecesOf("one\0two"), ["one", "two"], "a NUL ends a run");
});

test("the seam in the store: a match across the boundary, a 256-byte match from the base's last byte, a codepoint split by the bound, and a match at the far end of a giant body", async (t) => {
  if (skip) return t.skip(skip);
  const q256 = Array.from({ length: 40 }, (_, i) => `Q${String(i).padStart(2, "0")}wxyz`).join("").slice(0, 256);
  assert.equal(Buffer.byteLength(q256), 256);
  const giant = `${"far away ".repeat(44_000)}FARSIDE at last.`;
  assert.ok(Buffer.byteLength(giant) > 390_000);
  await seed({
    residents: ["ada", "bex", "cyd", "dee", "eve"],
    letters: [
      { id: "seam", from: "ada", to: "bex", body: `${"x".repeat(1020)}SEAMWORD and on` },
      { id: "q256", from: "bex", to: "ada", body: `${"y".repeat(1023)}${q256}${"z".repeat(500)}` },
      { id: "split", from: "cyd", to: "ada", body: `${"é".repeat(511)}🦊fox runs` },
      { id: "giant", from: "dee", to: "ada", body: giant },
      { id: "near", from: "eve", to: "ada", body: "FARSIDE is near." },
    ],
  });
  const who = async (q) => handlesOf(await walkAll({ mode: "text", q }));
  assert.deepEqual(await who("seamword"), ["ada"]);
  assert.deepEqual(await who(q256), ["bex"], "a 256-byte literal that starts on the base's last byte");
  assert.deepEqual(await who("🦊fox"), ["cyd"], "a four-byte codepoint the bound would have split");
  const pages = await walkAll({ mode: "text", q: "farside" });
  assert.deepEqual(handlesOf(pages), ["dee", "eve"], "dee once, at the giant body's far end, and eve after her: no author lost, none twice");
  assert.ok(pages.length > 5, `the giant body is walked across pages (${pages.length})`);
  const empties = pages.filter((p) => !p.complete && p.hits.length === 0);
  assert.ok(empties.length >= 5, "an unfinished page with no hits still hands its cursor");
  assert.ok(empties.every((p) => /not the whole answer/.test(p.more_note)), "and says it is not the whole answer");
  assert.ok(pages.every((p) => p.examined.pieces <= L.pieces_per_page), "no page reads more than its bound");
  assert.equal(await store.discover(api, { mode: "text", q: `${q256}z` }).then((p) => p.defect), `q is 257 bytes; the bound is ${L.query_bytes}`);
});

// ── the pages ────────────────────────────────────────────────────────────────

test("pages: each author once, at their first piece that holds the phrase; the hit cap and the work bound each leave the rest to the cursor, and the next author is never lost", async (t) => {
  if (skip) return t.skip(skip);
  const many = Array.from({ length: 30 }, (_, i) => `r${String(i).padStart(2, "0")}`);
  const letters = [];
  for (const h of many) for (let k = 0; k < 3; k++) letters.push({ id: `${h}-${k}`, from: h, to: "ada", body: `${k} the common phrase` });
  // ada says it only in her 150th letter; bex in her first
  for (let k = 0; k < 150; k++) letters.push({ id: `ada-${String(k).padStart(3, "0")}`, from: "ada", to: "bex", body: k === 149 ? "late: the common phrase" : "nothing yet" });
  letters.push({ id: "bex-0", from: "bex", to: "ada", body: "the common phrase, first" });
  await seed({ residents: ["ada", "bex", ...many], letters });

  const want = inC(["ada", "bex", ...many]);
  const capped = await walkAll({ mode: "text", q: "common phrase", limit: 7 });
  assert.deepEqual(handlesOf(capped), want, "every author once, in C order");
  assert.ok(capped.filter((p) => p.shown === 7).length >= 4, "the hit cap filled pages");
  assert.ok(capped.slice(0, -1).every((p) => p.complete === false && p.cursor), "every page but the last is unfinished and hands a cursor");
  const at = capped.flatMap((p) => p.hits).find((h) => h.handle === "ada");
  assert.deepEqual(at.source, { kind: "letter", id: "ada-149" }, "ada's one hit is her first piece that holds it");

  const wide = await walkAll({ mode: "text", q: "common phrase" });
  assert.deepEqual(handlesOf(wide), want);
  assert.equal(wide[0].hits.length, 0, "ada's 150 pieces fill the first page's bound with no hit");
  assert.equal(wide[0].examined.pieces, L.pieces_per_page);
  assert.equal(new Set(handlesOf(wide)).size, handlesOf(wide).length, "no author twice across seams");
});

test("the byte bound: a page that cannot carry its next hit stops before it, says so, and the next page starts from that hit", async (t) => {
  if (skip) return t.skip(skip);
  const people = Array.from({ length: 20 }, (_, i) => `b${String(i).padStart(2, "0")}`);
  // a letter id at the 1024-byte bound and an excerpt, both of control characters (six bytes each as JSON): about 7.5 KB a hit
  const ctl = "\u0001".repeat(200);
  const letters = people.map((h) => ({ id: `${h}-${"\u0001".repeat(1020)}`, from: h, to: "ada", body: `${ctl}BYTEWORD${ctl}` }));
  await seed({ residents: ["ada", ...people], letters });
  const pages = await walkAll({ mode: "text", q: "byteword" });
  assert.deepEqual(handlesOf(pages), people, "every author once, none lost at the cut");
  const cut = pages.find((p) => /size bound/.test(p.more_note));
  assert.ok(cut, "a page stopped at the size bound and said so");
  assert.ok(cut.shown > 0 && cut.shown < 20, `it carried what fit (${cut.shown})`);
  assert.ok(Buffer.byteLength(JSON.stringify(cut)) <= L.response_bytes);
});

// ── common correspondents ───────────────────────────────────────────────────

test("common correspondents: each shared resident once, in C order, through a run of duplicate letters, a toList, an outbox letter and a synthetic id; never someone off the roll", async (t) => {
  if (skip) return t.skip(skip);
  const cs = Array.from({ length: 300 }, (_, i) => `c${String(i + 1).padStart(3, "0")}`);
  const letters = cs.map((c) => ({ id: `ada-${c}`, from: "ada", to: c, body: "hello" }));
  for (let k = 0; k < 500; k++) letters.push({ id: `ada-dup-${k}`, from: "ada", to: "c005", body: "again" });
  letters.push({ id: "ada-gone", from: "ada", to: "gone", body: "to someone who left" });
  letters.push({ id: "bex-many", from: "bex", to: "c150, c299, c150", toList: ["c150", "c299", "c150"], body: "to three" });
  letters.push({ id: "bex-out", from: "bex", to: "c005", box: "outbox", body: "not yet sailed" });
  letters.push({ id: "unidentified-1", from: "bex", to: "gone", body: "a letter the town never named" });
  await seed({ residents: ["ada", "bex", ...cs], letters });

  // worked out from the letters above: whom ada writes to, whom bex writes to, both on the roll
  const toOf = (from) => new Set(letters.filter((l) => l.from === from).flatMap((l) => (l.toList?.length ? l.toList : [l.to])));
  const roll = new Set(["ada", "bex", ...cs]);
  const want = inC([...toOf("ada")].filter((c) => toOf("bex").has(c) && roll.has(c)));
  assert.deepEqual(want, ["c005", "c150", "c299"]);

  const pages = await walkAll({ mode: "common_correspondents", people: ["ada", "bex"] });
  assert.deepEqual(handlesOf(pages), want);
  assert.equal(pages.length, 3, "301 distinct recipients, 128 a page");
  assert.ok(pages.every((p) => p.examined.candidates <= L.candidates_per_page));
  assert.equal(pages.reduce((n, p) => n + p.examined.candidates, 0), 301, "each distinct recipient checked once, the 500 duplicates as one");
  const flipped = await walkAll({ mode: "common_correspondents", people: ["bex", "ada"] });
  assert.deepEqual(handlesOf(flipped), want, "the same answer driven from the other side");
  assert.equal(flipped.length, 1, "bex writes to four");

  assert.deepEqual(await store.discover(api, { mode: "common_correspondents", people: ["ada", "nobody"] }),
    { error: "bounce", code: 404, defect: 'no resident "nobody"', hint: 'people names two residents of the town; town { read: "residents" } is the roll' });
  assert.match((await store.discover(api, { mode: "common_correspondents", people: ["ada", "ada"] })).defect, /same resident twice/);
  assert.match((await store.discover(api, { mode: "common_correspondents", people: ["ada"] })).defect, /exactly two resident handles/);
});

// ── the cursor ───────────────────────────────────────────────────────────────

test("the cursor is read whole and grants nothing: another request's, a tampered one and an oversized one are refused; one from before the record moved is an explicit reset", async (t) => {
  if (skip) return t.skip(skip);
  const people = Array.from({ length: 6 }, (_, i) => `p${i}`);
  await seed({ residents: people, letters: people.map((h) => ({ id: `${h}-1`, from: h, to: "p0", body: "cursor word" })) });
  const first = await store.discover(api, { mode: "text", q: "cursor word", limit: 2 });
  assert.equal(first.complete, false);
  const c = first.cursor;
  const asked = (args) => store.discover(api, { mode: "text", q: "cursor word", limit: 2, ...args });
  const refusedFor = async (args) => (await asked(args)).defect ?? "";
  const body = JSON.parse(Buffer.from(c, "base64url").toString("utf8"));
  const forge = (o) => Buffer.from(JSON.stringify({ ...body, ...o }), "utf8").toString("base64url");

  assert.match(await refusedFor({ cursor: "!!!" }), /this cursor cannot be read: it is not one this door wrote/);
  assert.match(await refusedFor({ cursor: c, q: "other words" }), /belongs to a different request/);
  assert.match(await refusedFor({ cursor: c, sources: ["homes"] }), /belongs to a different request/);
  assert.match((await store.discover(api, { mode: "common_correspondents", people: ["p0", "p1"], cursor: c })).defect, /belongs to a different request/);
  assert.match(await refusedFor({ cursor: forge({ v: 2 }) }), /not one this door wrote/);
  assert.match(await refusedFor({ cursor: forge({ g: "1:nothex" }) }), /generation is not one this door writes/);
  assert.match(await refusedFor({ cursor: forge({ at: ["Not A Handle", "letter", "x", 0, "row"] }) }), /place in the walk/);
  assert.match(await refusedFor({ cursor: forge({ at: ["p1", "mark", "x", 0, "row"] }) }), /place in the walk/);
  assert.match(await refusedFor({ cursor: "A".repeat(L.cursor_bytes + 1) }), /longer than 16384 bytes/);
  assert.match(await refusedFor({ cursor: 7 }), /cursor must be the string/);

  // the record moves: a letter's words change, and with them the generation
  const second = await asked({ cursor: c });
  assert.equal(second.reset, undefined, "the same generation reads on");
  assert.deepEqual(handlesOf([first, second]), ["p0", "p1", "p2", "p3"]);
  await seed({ residents: people, letters: people.map((h) => ({ id: `${h}-1`, from: h, to: "p0", body: h === "p5" ? "other words" : "cursor word" })) });
  const moved = await asked({ cursor: second.cursor });
  assert.deepEqual(moved.reset?.from, second.source_generation);
  assert.equal(moved.reset?.to, moved.source_generation);
  assert.notEqual(moved.source_generation, second.source_generation);
  assert.deepEqual(moved.hits.map((h) => h.handle), ["p0", "p1"], "a reset page is the walk from its beginning, in the new generation");
});

test("a store without discovery's tables says it is not installed; one whose index is not built says that", async (t) => {
  if (skip) return t.skip(skip);
  const town = townOf({ residents: ["ada"], letters: [{ id: "x", from: "ada", to: "ada", body: "word" }] });
  town.meta = town.meta.filter((r) => !r.key.startsWith("discovery_"));
  await seedTownIndex(w, town);
  assert.deepEqual(await store.discover(api, { mode: "text", q: "word" }),
    { error: "bounce", code: 503, defect: "discovery's index has not been built yet", hint: 'the town-index ingest builds it on its next run, within about fifteen minutes; town { read: "search" } answers meanwhile' });
  await su.query("ALTER TABLE town_letter_edges RENAME TO town_letter_edges_away");
  try {
    assert.equal((await store.discover(api, { mode: "text", q: "word" })).defect, "discovery is not installed in this store yet");
  } finally { await su.query("ALTER TABLE town_letter_edges_away RENAME TO town_letter_edges"); }
});

// ── the doors ────────────────────────────────────────────────────────────────

test("the doors: discover_town and town { read: \"discover\" } answer the store's own page, refuse what does not belong, and say so when the store cannot be reached", async (t) => {
  if (skip) return t.skip(skip);
  await seed({ residents: ["ada", "bex"], letters: [{ id: "x", from: "ada", to: "bex", body: "door word" }, { id: "y", from: "bex", to: "ada", body: "door word too" }] });
  const { callTool, toolList, TOOLS, DELISTED } = await import("../src/mcp.mjs");
  const keep = { WORLD2_PG: process.env.WORLD2_PG, WORLD2_PG_URL: process.env.WORLD2_PG_URL };
  const { default: pg } = await import("pg");
  const pool = new pg.Pool({ connectionString: s.url("office_api"), max: 2 });
  const pen = await import("../src/world2-pen.mjs");
  try {
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: s.url("office_api") });
    pen.__setPoolForTest(pool);
    const args = { mode: "text", q: "door word", limit: 1 };
    const direct = await store.discover(api, args);
    assert.deepEqual(direct.hits.map((h) => h.handle), ["ada"]);
    assert.deepEqual(await callTool("discover_town", args, {}), direct, "the flat verb is the store's page");
    const viaTown = await callTool("town", { read: "discover", args }, {});
    assert.deepEqual(viaTown, direct, "town { read: \"discover\" } is the same page");
    const next = await callTool("town", { read: "discover", args: { ...args, cursor: viaTown.cursor } }, {});
    assert.deepEqual(next.hits.map((h) => h.handle), ["bex"]);

    const unknown = await callTool("town", { read: "discover", args: { ...args, zz: 1 } }, {});
    assert.match(String(unknown.defect), /unknown argument "zz"/, "an unknown argument is refused by name at the apex");
    assert.match(String((await callTool("discover_town", { mode: "text", q: "x", people: ["ada", "bex"] }, {})).defect), /people belongs to mode "common_correspondents"/);
    const marks = await callTool("discover_town", { mode: "text", q: "x", sources: ["marks"] }, {});
    assert.match(String(marks.defect), /"marks" is not a source in this slice/);
    assert.match(String(marks.hint), /world marks are not searched in this slice/);
    assert.match(String((await callTool("discover_town", { mode: "text", q: "x", limit: 21 }, {})).defect), /from 1 to 20/);
    assert.match(String((await callTool("discover_town", { mode: "text", q: "   " }, {})).defect), /empty or only whitespace/);

    assert.ok(TOOLS.some((x) => x.name === "discover_town") && DELISTED.has("discover_town"), "born behind the town apex: defined, delisted");
    const { apexEnabled } = await import("../src/world-apex.mjs");
    if (apexEnabled()) assert.ok(!toolList().some((x) => x.name === "discover_town"), "not listed flat while the apex serves it");
    assert.match(TOOLS.find((x) => x.name === "discover_town").description, /World marks are not searched in this slice/);
    const bare = await callTool("town", {}, {});
    assert.ok(bare.reading.some((r) => r.read === "discover" && r.serves === "discover_town" && /World marks are not searched/.test(r.blurb)), "the town's bare read names it");

    pen.__setPoolForTest({ connect: async () => { throw new Error("ECONNREFUSED"); } });
    assert.match(String((await callTool("discover_town", args, {})).defect), /town index \(the store\) cannot be reached/);
  } finally {
    pen.__setPoolForTest(null); await pool.end();
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});
