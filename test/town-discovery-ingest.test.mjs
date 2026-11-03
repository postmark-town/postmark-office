// town-discovery-ingest.test.mjs — discovery's tables ride the town-index
// ingest (POS-497, 088_town_discovery.sql): written with the rows they come
// from, in one transaction, equal to the whole derivation after every move, and
// the generation moving exactly when a piece, an edge or the roll does.
//
//   node --import ./test/helpers/sparse-guard.mjs --test test/town-discovery-ingest.test.mjs   (a pool tree's Postgres, or EMBEDDED_PG_DIR)
//
// LAW (Rivet's brief, POS-497, 2026-11-03): "Derive/removal in the SAME ingest
// transaction as source letters/homes … Don't leave stale text/edges after
// replacement/move/deletion." "Maintain nonsecret discovery source
// epoch/revision in town_meta … updated atomically with relevant derived
// changes and canonical resident KEY eligibility changes." "Read generation and
// data in the SAME statement/snapshot."
//
// Every town here is invented: its own directory and git, with the town's own
// tools copied from the office's pinned town-clone (the fold the derivation
// imports). Without the clone or a Postgres the file SKIPS and says which.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { ingest, applyDelta, readHead, SEAL_SUBJECT } from "../world2/tools/town-index-ingest.mjs";
import { TOWN_TABLES, rowDigest } from "../src/town-index.mjs";
import { DISCOVERY_EPOCH } from "../src/town-discovery.mjs";
import { LANDED } from "../world2/tools/migrations-landed.mjs";
import * as store from "../src/town-index-store.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const SCHEMA_088 = join(ROOT, "world2", "schema", "088_town_discovery.sql");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));

const tmp = mkdtempSync(join(tmpdir(), "town-discovery-ingest-"));
let s = null, w = null, api = null, owner = null;
let skip = hasClone ? false : "no town-clone with tools/stamp-mint.mjs beside the office: the fixture copies the town's own tools from it";

before(async () => {
  if (skip) return;
  s = await startStore({ db: "town_discovery_ingest" });
  if (s.skip) { skip = s.skip; return; }
  w = await s.connect("law_ingester");
  api = await s.connect("office_api");
  owner = await s.connect("world2_owner");
});

after(async () => {
  for (const c of [w, api, owner]) if (c) await c.end().catch(() => {});
  if (s?.stop) await s.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// ── an invented town ─────────────────────────────────────────────────────────

const LEDGER_HEAD = "# Mail ledger\n\nAppend-only record of every delivery **and every bounce**.\n\n";
const stampLines = hasClone ? readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n") : [];
const address = (h) => `---\nhandle: ${h}\nagent: ${h}\ngithub: fixture-${h}\nsince: 2026-05-12\n---\n\n# ${h}\n`;
const homeMd = (h, title, body) => `---\nresident: ${h}\ntitle: ${title}\n---\n\n${body}\n`;
const letter = (id, from, to, body) => `---\nid: ${id}\nfrom: ${from}\nto: ${to}\ndate: 2026-10-01\n---\n\n${body}\n`;

function makeTown(name, handles) {
  const dir = join(tmp, name);
  const t = {
    dir,
    put(p, text) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); },
    rm(p) { rmSync(join(dir, p), { recursive: true, force: true }); },
    mv(a, b) { mkdirSync(dirname(join(dir, b)), { recursive: true }); renameSync(join(dir, a), join(dir, b)); },
    git: (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    commit(msg) {
      t.git("add", "-A");
      t.git("-c", "user.name=Postmark Pen", "-c", "user.email=pen@test.invalid", "commit", "-q", "--allow-empty", "-m", msg);
      return t.git("rev-parse", "HEAD").trim();
    },
    homes(placed) {
      t.put("PROJECTS/build-the-town/atlas/placements.json", JSON.stringify({ facts: [
        { kind: "region", id: "the-quay", holder: placed[0], bearing: "S", band: "shore", status: "resident-claimed" },
        ...placed.map((h) => ({ kind: "home", resident: h, region: "the-quay" })),
      ] }, null, 2));
    },
  };
  cpSync(join(CLONE, "tools"), join(dir, "tools"), { recursive: true });
  cpSync(join(CLONE, "quest-registry.json"), join(dir, "quest-registry.json"));
  for (const h of handles) t.put(`WHITE_PAGES/${h}/ADDRESS.md`, address(h));
  t.put("WHITE_PAGES/stamp-ledger.md", stampLines.slice(0, 60).join("\n") + "\n");
  t.put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD);
  t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello.\n");
  t.git("init", "-q");
  t.git("config", "core.autocrlf", "false");
  return t;
}

// The full derivation at the checkout, in a process of its own (the town's tools are imported from the checkout, and a module imported once is cached).
const DERIVE = `
import { writeFileSync } from "node:fs";
const { deriveTownIndex } = await import(process.env.DERIVE_MODULE);
const quiet = { log() {}, info() {}, warn() {}, error() {} };
const { tables } = await deriveTownIndex(process.env.DERIVE_TOWN, { log: quiet });
writeFileSync(process.env.DERIVE_OUT, JSON.stringify(tables));
`;
let derivations = 0;
function derived(dir) {
  const out = join(tmp, `derived-${++derivations}.json`);
  execFileSync(process.execPath, ["--input-type=module", "-e", DERIVE], { stdio: "ignore",
    env: { ...process.env, DERIVE_MODULE: pathToFileURL(join(ROOT, "src", "town-index.mjs")).href, DERIVE_TOWN: dir, DERIVE_OUT: out } });
  return JSON.parse(readFileSync(out, "utf8"));
}

/** Every table, discovery's two and town_meta's two keys included, against the full derivation at the town's checkout. */
async function assertEqualToDerivation(t, label) {
  const tables = derived(t.dir);
  for (const [name, { cols }] of Object.entries(TOWN_TABLES)) {
    const norm = (rows) => rows.map((r) => JSON.stringify(cols.map((k, i) => (Array.isArray(r) ? r[i] : r[k]) ?? null))).sort();
    assert.deepEqual(norm((await w.query(`SELECT ${cols.join(", ")} FROM town_${name}`)).rows), norm(tables[name] ?? []), `${label}: town_${name} differs from the full derivation's ${name}`);
  }
  return tables;
}

const revision = async () => (await w.query("SELECT value FROM town_meta WHERE key = 'discovery_revision'")).rows[0]?.value ?? null;
const count = async (table, where = "", params = []) => (await w.query(`SELECT count(*)::int n FROM ${table} ${where}`, params)).rows[0].n;
const writes = (out, name) => out.tally[name] ?? { inserted: 0, deleted: 0 };
const who = async (q) => {
  const p = await store.discover(api, { mode: "text", q });
  assert.equal(p.error, undefined, JSON.stringify(p));
  return p.hits.map((h) => h.handle);
};

// ── the ride ─────────────────────────────────────────────────────────────────

test("the seed and every delta keep discovery equal to the whole derivation; the revision moves with a piece, an edge or the roll, and only then", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("ride", ["ada", "bex", "cyd"]);
  t.homes(["ada", "bex"]);
  t.put("WHITE_PAGES/ada/HOME/HOME.md", homeMd("ada", "The Lantern House", "Ada keeps BEESWAX candles."));
  t.put("WHITE_PAGES/bex/HOME/HOME.md", homeMd("bex", "Bex's Boathouse", "Rope and tar."));
  t.put("WHITE_PAGES/bex/inbox/l1.md", letter("l1", "ada", "bex", "The tide brings MARGINALIA."));
  t.put("WHITE_PAGES/ada/inbox/l2.md", letter("l2", "bex", "ada", "Fog over the quay."));
  t.put("WHITE_PAGES/ada/inbox/l3.md", letter("l3", "cyd", "ada, bex, ada", "To both of you, twice over."));
  const seeded = await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
  assert.equal(seeded.discovery.mode, "seed");
  await assertEqualToDerivation(t, "seed");
  assert.ok(await count("town_discovery_chunks") >= 5, "the seed wrote pieces (three letters, two homes' titles and descriptions)");
  assert.deepEqual((await w.query(`SELECT sender, recipient FROM town_letter_edges WHERE letter_id = 'l3' ORDER BY recipient COLLATE "C"`)).rows.map((r) => [r.sender, r.recipient]),
    [["cyd", "ada"], ["cyd", "bex"]], "a toList's repeated recipient is one edge");
  assert.deepEqual(await who("beeswax"), ["ada"]);
  let rev = await revision();
  assert.match(rev, /^[0-9a-f]{64}$/, "the revision is a 256-bit fingerprint, 64 hex characters");
  assert.equal((await w.query("SELECT value FROM town_meta WHERE key = 'discovery_epoch'")).rows[0].value, DISCOVERY_EPOCH);

  const step = async (label, sha, { moves }) => {
    const out = await ingest(w, { townRepo: t.dir, sha });
    await assertEqualToDerivation(t, label);
    const now = await revision();
    assert.equal(now !== rev, moves, `${label}: the revision ${moves ? "moves" : "stays"}`);
    rev = now;
    return out;
  };

  t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello again.\n");
  const bulletin = await step("a bulletin edit", t.commit("bulletin"), { moves: false });
  assert.deepEqual([writes(bulletin, "discovery_chunks"), writes(bulletin, "letter_edges")], [{ inserted: 0, deleted: 0 }, { inserted: 0, deleted: 0 }]);

  t.put("WHITE_PAGES/bex/inbox/l1.md", letter("l1", "ada", "bex", "The tide brings PALIMPSEST."));
  const replaced = await step("a letter's words replaced", t.commit("ada: l1 reworded"), { moves: true });
  assert.equal(writes(replaced, "discovery_chunks").deleted, 1, "the old piece went");
  assert.deepEqual(await who("marginalia"), [], "no stale text after a replacement");
  assert.deepEqual(await who("palimpsest"), ["ada"]);

  t.put("WHITE_PAGES/cyd/outbox/l4.md", letter("l4", "cyd", "bex", "Waiting for the ferry: SEMAPHORE."));
  await step("an outbox letter", t.commit("cyd -> bex"), { moves: true });
  assert.deepEqual(await who("semaphore"), ["cyd"], "an unsailed outbox letter is public text");
  t.mv("WHITE_PAGES/cyd/outbox/l4.md", "WHITE_PAGES/bex/inbox/l4.md");
  const moved = await step("the ferry moves it", t.commit("ferry: 1 delivered"), { moves: false });
  assert.equal(writes(moved, "letters").inserted, 1, "the letter's row moved with its path");
  assert.deepEqual([writes(moved, "discovery_chunks"), writes(moved, "letter_edges")], [{ inserted: 0, deleted: 0 }, { inserted: 0, deleted: 0 }],
    "a move changes no piece and no edge, so no cursor is reset by it");

  t.put("WHITE_PAGES/ada/inbox/l2.md", letter("l2b", "bex", "ada", "Fog over the quay."));
  await step("an id changes in place", t.commit("ada: l2 renamed"), { moves: true });
  assert.equal(await count("town_discovery_chunks", "WHERE source_id = 'l2'"), 0, "no piece under the old id");
  assert.equal(await count("town_letter_edges", "WHERE letter_id = 'l2'"), 0, "no edge under the old id");

  t.rm("WHITE_PAGES/bex/inbox/l4.md");
  await step("a letter withdrawn", t.commit("bex: l4 filed away"), { moves: true });
  assert.deepEqual(await who("semaphore"), [], "no stale text after a deletion");

  t.put("WHITE_PAGES/bex/HOME/HOME.md", homeMd("bex", "Bex's Ropewalk", "Rope and tar."));
  await step("a home retitled", t.commit("bex: home retitled"), { moves: true });
  assert.deepEqual(await who("ropewalk"), ["bex"]);
  assert.deepEqual(await who("boathouse"), []);

  t.put("WHITE_PAGES/dee/ADDRESS.md", address("dee"));
  const joined = await step("a resident joins with nothing written", t.commit("dee: joined"), { moves: true });
  assert.equal(writes(joined, "discovery_chunks").inserted + writes(joined, "letter_edges").inserted, 0, "the roll moved the revision; no row did");

  t.put("WHITE_PAGES/dee/inbox/l5.md", letter("l5", "Not-A-Handle", "dee", "A visitor's SIGNPOST."));
  t.put("WHITE_PAGES/dee/inbox/l6.md", letter("l6", "dee", "ada", "Before the nul\u0000NULWORD after it."));
  const odd = await step("a sender who is no handle, and a NUL", t.commit("dee: odd mail"), { moves: true });
  assert.equal(odd.discovery.skipped.sender, 1, "the sender that is no handle is counted, not dropped quietly");
  assert.deepEqual(await who("signpost"), []);
  assert.deepEqual(await who("nulword"), ["dee"], "a NUL ends a run; the text after it is kept");

  // a resident leaves: their inbox and home go; what they sent stays in the record, but they are off the roll
  t.rm("WHITE_PAGES/cyd");
  await step("a resident leaves", t.commit("cyd: moved away"), { moves: true });
  assert.ok(await count("town_discovery_chunks", "WHERE author = 'cyd'") > 0, "cyd's letter to ada still stands in ada's inbox");
  assert.deepEqual(await who("twice over"), [], "but cyd is off the roll, so the door never names them");
});

test("the real record's hidden surfaces: a card's frontmatter and a mailbox's bounce reason are held in the store and never found, while the same terms in a letter body are (POS-497 FIX 3)", async (tt) => {
  if (skip) return tt.skip(skip);
  // Both terms ride the town's own derivation: ADDRESS.md's frontmatter lands in the resident's
  // card, and a ledger BOUNCE line's reason lands in the sender's mail_state (the town's
  // mailState, `unplaced_bounces`). Neither is a letter body or a home's text.
  const t = makeTown("hidden", ["ada", "bex", "cyd", "dee", "eve"]);
  t.put("WHITE_PAGES/ada/ADDRESS.md", address("ada").replace("since: 2026-05-12", "since: 2026-05-12\nnote: CARDSENTINEL"));
  t.put("WHITE_PAGES/mail-ledger.md", `${LEDGER_HEAD}- 2026-10-01 · BOUNCE · WHITE_PAGES/cyd/outbox/lost.md (from cyd): BOUNCESENTINEL, not delivered\n`);
  // the admitting controls: the same terms as plain letter text, written by residents on the roll
  t.put("WHITE_PAGES/bex/inbox/p1.md", letter("p1", "dee", "bex", "I wrote CARDSENTINEL in a letter."));
  t.put("WHITE_PAGES/bex/inbox/p2.md", letter("p2", "eve", "bex", "And BOUNCESENTINEL in mine."));
  await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });

  const held = async (table, handle, term) => (await w.query(`SELECT count(*)::int n FROM ${table} WHERE handle = $1 AND json LIKE $2`, [handle, `%${term}%`])).rows[0].n;
  const check = async (label) => {
    assert.equal(await held("town_residents", "ada", "CARDSENTINEL"), 1, `${label}: ada's card holds CARDSENTINEL in the store`);
    assert.equal(await held("town_mail_state", "cyd", "BOUNCESENTINEL"), 1, `${label}: cyd's mail_state holds BOUNCESENTINEL in the store`);
    assert.deepEqual(await who("cardsentinel"), ["dee"], `${label}: a card's frontmatter is never discovery's text; the same word in dee's letter is`);
    assert.deepEqual(await who("bouncesentinel"), ["eve"], `${label}: a mailbox's bounce reason is never discovery's text; the same word in eve's letter is`);
  };
  await check("the seed");
  // a public cursor in hand, then a private-only edit: it must not rotate the generation or reset the cursor
  const rev0 = await revision();
  const page1 = await store.discover(api, { mode: "text", q: "sentinel", limit: 1 });
  assert.deepEqual([page1.hits.map((h) => h.handle), page1.complete], [["dee"], false]);
  t.put("WHITE_PAGES/ada/ADDRESS.md", address("ada").replace("since: 2026-05-12", "since: 2026-05-12\nnote: CARDSENTINEL, edited"));
  await ingest(w, { townRepo: t.dir, sha: t.commit("ada: card edited") });
  await assertEqualToDerivation(t, "after the card edit");
  await check("a delta");
  assert.equal(await revision(), rev0, "a private-only edit (a card's frontmatter) does not rotate the generation");
  const page2 = await store.discover(api, { mode: "text", q: "sentinel", limit: 1, cursor: page1.cursor });
  assert.equal(page2.reset, undefined, "and the public cursor from before it reads on, not reset");
  assert.deepEqual(page2.hits.map((h) => h.handle), ["eve"]);
});

test("a rule change costs one whole derivation, named and measured: another epoch, or a revision that is not this epoch's width, is re-derived whole once; a reseed of the same content keeps its generation (POS-497 FIX 4)", async (tt) => {
  if (skip) return tt.skip(skip);
  const handles = Array.from({ length: 40 }, (_, i) => `r${String(i).padStart(2, "0")}`);
  const t = makeTown("epoch", handles);
  for (let i = 0; i < 400; i++)
    t.put(`WHITE_PAGES/${handles[(i + 1) % 40]}/inbox/e${i}.md`, letter(`e${i}`, handles[i % 40], handles[(i + 1) % 40], `Letter ${i}. ${"The tide keeps its own counsel. ".repeat(60)}`));
  const seedSha = t.commit("seed");
  await ingest(w, { townRepo: t.dir, sha: seedSha, seed: true, reseed: true });
  const rev = await revision();
  const pieces = await count("town_discovery_chunks"), edges = await count("town_letter_edges");
  assert.ok(pieces >= 400 && edges === 400, `${pieces} pieces and ${edges} edges`);

  // byte-identical effective public content keeps its generation across a reseed
  await ingest(w, { townRepo: t.dir, sha: seedSha, seed: true, reseed: true });
  assert.equal(await revision(), rev, "a reseed of the same content does not rotate the generation");

  const setMeta = (key, value) => owner.query("UPDATE town_meta SET value = $1, digest = $2 WHERE key = $3", [value, rowDigest([key, value]), key]);
  const bulletin = (n) => { t.put("TOWN_BULLETIN/welcome.md", `---\ntitle: welcome\n---\n\nBulletin ${n}.\n`); return t.commit(`bulletin ${n}`); };

  // a store written under epoch 1 (a 128-bit revision): the next ingest re-derives whole, names why, and moves no row
  await setMeta("discovery_epoch", "1");
  await setMeta("discovery_revision", "0".repeat(32));
  const viaEpoch = await ingest(w, { townRepo: t.dir, sha: bulletin(1) });
  assert.equal(viaEpoch.discovery.mode, "whole");
  assert.match(viaEpoch.discovery.reason, /epoch 1, not 2/);
  assert.equal(viaEpoch.discovery.letters, 400);
  assert.equal(await revision(), rev, "the same rows fingerprint to the same revision");
  assert.deepEqual([writes(viaEpoch, "discovery_chunks"), writes(viaEpoch, "letter_edges")], [{ inserted: 0, deleted: 0 }, { inserted: 0, deleted: 0 }], "only the stamp was old: no piece or edge moved");
  assert.equal((await w.query("SELECT value FROM town_meta WHERE key = 'discovery_epoch'")).rows[0].value, DISCOVERY_EPOCH);
  await assertEqualToDerivation(t, "after the epoch change");

  // ... once: the next ingest is a delta again
  t.put("WHITE_PAGES/r05/inbox/e4.md", letter("e4", "r04", "r05", "Letter 4, reworded. The tide turns."));
  const delta = await ingest(w, { townRepo: t.dir, sha: t.commit("e4 reworded") });
  assert.equal(delta.discovery.mode, "delta");
  assert.deepEqual([delta.discovery.removed, delta.discovery.added].map((n) => n > 0), [true, true], "the delta removed the old rows' digests and added the new rows'");
  assert.notEqual(await revision(), rev);
  await assertEqualToDerivation(t, "after the one-letter delta");
  console.log(`# measured: ${pieces} pieces, ${edges} edges, 400 letters: the whole derivation on an epoch change took ${viaEpoch.ms.discovery} ms; a one-letter delta took ${delta.ms.discovery} ms (removed ${delta.discovery.removed} rows, added ${delta.discovery.added})`);

  // a revision that is not this epoch's width, under this epoch: the same whole pass, named differently
  await setMeta("discovery_revision", "0".repeat(32));
  const viaWidth = await ingest(w, { townRepo: t.dir, sha: bulletin(2) });
  assert.equal(viaWidth.discovery.mode, "whole");
  assert.match(viaWidth.discovery.reason, /not a fingerprint of this epoch's width/);
  await assertEqualToDerivation(t, "after the width repair");
  assert.match(await revision(), /^[0-9a-f]{64}$/);
});

test("a giant body rides one delta: its pieces are written in the ingest's own transaction, timed, and its far end is found", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("giant", ["ada", "bex"]);
  t.put("WHITE_PAGES/bex/inbox/small.md", letter("small", "ada", "bex", "hello"));
  await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
  const body = `${"a long letter, ".repeat(140_000)}THE LAST WORD`;
  const bytes = Buffer.byteLength(body);
  t.put("WHITE_PAGES/bex/inbox/giant.md", letter("giant", "ada", "bex", body));
  const t0 = Date.now();
  const out = await ingest(w, { townRepo: t.dir, sha: t.commit("ada -> bex: a giant") });
  const total = Date.now() - t0;
  const pieces = writes(out, "discovery_chunks").inserted;
  const stored = JSON.parse((await w.query("SELECT json FROM town_letters WHERE id = 'giant'")).rows[0].json).body;
  assert.equal(pieces, Math.ceil(Buffer.byteLength(stored) / 1024), `a ${Buffer.byteLength(stored)}-byte body, all ASCII, is one piece per 1024 bytes`);
  assert.equal(out.discovery.mode, "delta");
  assert.ok(Number.isFinite(out.ms.discovery));
  console.log(`# measured: a ${bytes}-byte body, ${pieces} pieces, discovery ${out.ms.discovery} ms of a ${total} ms delta (${JSON.stringify(out.ms)})`);
  const pages = [];
  for (let cursor = null, i = 0; i < 100; i++) {
    const p = await store.discover(api, { mode: "text", q: "the last word", ...(cursor ? { cursor } : {}) });
    pages.push(p);
    if (p.complete) break;
    cursor = p.cursor;
  }
  assert.deepEqual(pages.flatMap((p) => p.hits.map((h) => h.handle)), ["ada"]);
  assert.equal(pages.at(-1).complete, true);
  assert.ok(pages.length >= Math.floor(pieces / 64), `the walk took ${pages.length} bounded pages`);

  // The giant body EDITED, which is the expensive delta: its old pieces are read back (a removal's digest is over
  // the columns it held), removed from the fingerprint, and the new ones added. Work in the touched rows.
  const before = await revision();
  const edited = `${"another long letter, ".repeat(100_000)}THE LAST WORD`;
  t.put("WHITE_PAGES/bex/inbox/giant.md", letter("giant", "ada", "bex", edited));
  const rewriteSha = t.commit("ada -> bex: the giant, rewritten");
  const t1 = Date.now();
  const out2 = await ingest(w, { townRepo: t.dir, sha: rewriteSha });
  const total2 = Date.now() - t1;
  assert.equal(out2.discovery.mode, "delta");
  assert.equal(out2.discovery.removed, pieces + 0, "every old piece of the body went (the edge stayed)");
  assert.ok(out2.discovery.added > 1_000, `${out2.discovery.added} new rows came in`);
  assert.notEqual(await revision(), before);
  await assertEqualToDerivation(t, "after the giant is rewritten");
  console.log(`# measured: the same giant letter rewritten (${Buffer.byteLength(edited)} bytes): discovery ${out2.ms.discovery} ms of a ${total2} ms delta; removed ${out2.discovery.removed} rows, added ${out2.discovery.added}`);
});

// ── without 088, then with it ────────────────────────────────────────────────

test("without 088 the ingest skips discovery and says so and the door says not installed; applying 088 fills both tables whole at the next ingest; applying it twice is a no-op; dropping them is the rollback", async (tt) => {
  if (skip) return tt.skip(skip);
  const landed = async () => (await owner.query(`SELECT (${LANDED["088_town_discovery.sql"].probe}) AS landed`)).rows[0].landed;
  const rollback = async () => {
    await owner.query("BEGIN");
    await owner.query("DROP TABLE town_discovery_chunks, town_letter_edges");
    await owner.query("DELETE FROM registry WHERE object IN ('town_discovery_chunks', 'town_letter_edges')");
    await owner.query("COMMIT");
  };
  const apply = async () => owner.query(readFileSync(SCHEMA_088, "utf8"));
  await rollback();
  try {
    assert.equal(await landed(), false);
    const t = makeTown("absent", ["ada", "bex"]);
    t.put("WHITE_PAGES/bex/inbox/x.md", letter("x", "ada", "bex", "an ABSENT word"));
    const seeded = await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
    assert.deepEqual(seeded.discovery, { mode: "absent" });
    assert.equal(await revision(), null, "no generation is written for tables that are not there");
    assert.equal((await store.discover(api, { mode: "text", q: "absent" })).defect, "discovery is not installed in this store yet");
    t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nStill here.\n");
    const delta = await ingest(w, { townRepo: t.dir, sha: t.commit("bulletin") });
    assert.deepEqual(delta.discovery, { mode: "absent" });

    await apply();
    assert.equal(await landed(), true, "088's own probe says it landed");
    assert.equal((await store.discover(api, { mode: "text", q: "absent" })).defect, "discovery's index has not been built yet");
    t.put("WHITE_PAGES/bex/inbox/y.md", letter("y", "bex", "ada", "a second word"));
    const filled = await ingest(w, { townRepo: t.dir, sha: t.commit("bex -> ada") });
    assert.equal(filled.discovery.mode, "whole", "no epoch yet: the first ingest fills both tables whole from the stored rows");
    assert.equal(filled.discovery.letters, 2);
    await assertEqualToDerivation(t, "filled after 088");
    assert.deepEqual(await who("absent"), ["ada"]);

    await apply();
    t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nAgain.\n");
    const again = await ingest(w, { townRepo: t.dir, sha: t.commit("bulletin again") });
    assert.equal(again.discovery.mode, "delta", "088 applied twice changes nothing");
    await assertEqualToDerivation(t, "088 twice");

    await rollback();
    t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nRolled back.\n");
    const back = await ingest(w, { townRepo: t.dir, sha: t.commit("bulletin, rolled back") });
    assert.deepEqual(back.discovery, { mode: "absent" });
    assert.equal(await revision(), null, "the rollback's next ingest drops both meta keys");
    assert.equal((await store.discover(api, { mode: "text", q: "absent" })).defect, "discovery is not installed in this store yet");
  } finally {
    if (!(await landed())) await apply();
  }
});

// ── the seal's audit ─────────────────────────────────────────────────────────

test("the seal's audit puts back discovery rows a delta cannot see, counts them, and makes the revision true again", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("audit", ["ada", "bex"]);
  t.put("WHITE_PAGES/bex/inbox/a1.md", letter("a1", "ada", "bex", "an AUDITED word"));
  t.put("WHITE_PAGES/ada/inbox/a2.md", letter("a2", "bex", "ada", "another"));
  await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
  const lost = (await owner.query("DELETE FROM town_discovery_chunks WHERE source_id = 'a1' RETURNING id")).rowCount
    + (await owner.query("DELETE FROM town_letter_edges WHERE letter_id = 'a2' RETURNING id")).rowCount;
  assert.equal(lost, 2);
  t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nBlind.\n");
  const blind = await ingest(w, { townRepo: t.dir, sha: t.commit("bulletin") });
  assert.equal(writes(blind, "discovery_chunks").inserted, 0, "a delta derives only what it touched: the lost rows stay lost");
  assert.deepEqual(await who("audited"), []);
  t.put("PROJECTS/the-town-seal/seal.json", "{\"seal\":\"audit\"}\n");
  const seal = await ingest(w, { townRepo: t.dir, sha: t.commit(SEAL_SUBJECT), snapshot: true });
  assert.deepEqual(seal.discovery.audit, { repaired: 2, revision_was_true: true },
    "the audit wrote the two back and counted them; the revision already named the rows that should be there");
  await assertEqualToDerivation(t, "after the seal's audit");
  assert.deepEqual(await who("audited"), ["ada"]);
  const snap = (await w.query("SELECT counts, digests FROM town_index_snapshots WHERE sha = $1", [seal.sha])).rows[0];
  assert.equal(snap.counts.discovery_chunks, await count("town_discovery_chunks"), "the seal's snapshot counts discovery's pieces");
  assert.equal(typeof snap.digests.letter_edges, "string", "and digests its edges");

  // a revision that drifted from its rows, written as a writer writes it (value and digest): the next seal finds it and makes it true again
  const drifted = ["discovery_revision", "0".repeat(64)];
  await owner.query("UPDATE town_meta SET value = $1, digest = $2 WHERE key = 'discovery_revision'", [drifted[1], rowDigest(drifted)]);
  t.put("PROJECTS/the-town-seal/seal.json", "{\"seal\":\"audit again\"}\n");
  const second = await ingest(w, { townRepo: t.dir, sha: t.commit(SEAL_SUBJECT), snapshot: true });
  assert.deepEqual(second.discovery.audit, { repaired: 0, revision_was_true: false });
  await assertEqualToDerivation(t, "after the second seal");
});

// ── isolation ────────────────────────────────────────────────────────────────

test("a reader never sees half an ingest: mid-transaction it reads the old generation with the old rows, after the commit the new with the new; a cursor across a roll change is reset", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("isolation", ["ada", "bex", "cyd"]);
  t.put("WHITE_PAGES/cyd/inbox/i1.md", letter("i1", "ada", "cyd", "OLDWORD and SHARED"));
  t.put("WHITE_PAGES/ada/inbox/i2.md", letter("i2", "bex", "ada", "SHARED"));
  t.put("WHITE_PAGES/ada/inbox/i3.md", letter("i3", "cyd", "ada", "SHARED"));
  await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
  const before = await store.discover(api, { mode: "text", q: "shared", limit: 1 });
  assert.deepEqual(before.hits.map((h) => h.handle), ["ada"]);

  t.put("WHITE_PAGES/cyd/inbox/i1.md", letter("i1", "ada", "cyd", "NEWWORD and SHARED"));
  t.rm("WHITE_PAGES/bex");   // bex leaves the roll in the same commit; the letter bex sent stays in ada's inbox
  const sha = t.commit("ada: i1 reworded; bex leaves");
  const head = await readHead(w);
  await w.query("BEGIN");
  try {
    await applyDelta(w, { townRepo: t.dir, head, sha });
    const mid = await store.discover(api, { mode: "text", q: "oldword" });
    assert.deepEqual([mid.source_generation, mid.hits.map((h) => h.handle)], [before.source_generation, ["ada"]], "the uncommitted ingest is invisible: old generation, old rows");
    assert.deepEqual((await store.discover(api, { mode: "text", q: "newword" })).hits, []);
    await w.query("COMMIT");
  } catch (e) { await w.query("ROLLBACK").catch(() => {}); throw e; }
  const after = await store.discover(api, { mode: "text", q: "newword" });
  assert.notEqual(after.source_generation, before.source_generation);
  assert.deepEqual(after.hits.map((h) => h.handle), ["ada"]);
  const resumed = await store.discover(api, { mode: "text", q: "shared", limit: 1, cursor: before.cursor });
  assert.equal(resumed.reset?.from, before.source_generation, "the roll changed under the cursor: an explicit reset");
  assert.deepEqual(resumed.hits.map((h) => h.handle), ["ada"], "from the beginning, in the new generation");
  const rest = await store.discover(api, { mode: "text", q: "shared", cursor: resumed.cursor });
  assert.deepEqual(rest.hits.map((h) => h.handle), ["cyd"], "bex is off the roll now");
});

test("one statement per page: an ingest that commits right after the page's first read of the record cannot split the generation it names from the rows it returns", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("one-statement", ["ada", "bex"]);
  t.put("WHITE_PAGES/bex/inbox/o1.md", letter("o1", "ada", "bex", "FIRSTWORD"));
  await ingest(w, { townRepo: t.dir, sha: t.commit("seed"), seed: true, reseed: true });
  const was = await revision();
  t.put("WHITE_PAGES/bex/inbox/o1.md", letter("o1", "ada", "bex", "SECONDWORD"));
  const sha = t.commit("ada: o1 reworded");
  const head = await readHead(w);
  await w.query("BEGIN");
  await applyDelta(w, { townRepo: t.dir, head, sha });
  // The reader's client records every statement, and the ingest COMMITS as soon
  // as the first statement that reads the record has answered. A reader that
  // took its generation in one statement and its rows in another would name the
  // old generation over the new rows here; the page must name the generation of
  // the rows it holds.
  const reads = (text) => /town_discovery_chunks|town_meta|town_letter_edges/.test(text) && !/to_regclass/.test(text);
  const sent = [];
  let committed = false;
  const q = { query: async (text, params) => {
    sent.push(text);
    const out = await api.query(text, params);
    if (!committed && reads(text)) { committed = true; await w.query("COMMIT"); }
    return out;
  } };
  const page = await store.discover(q, { mode: "text", q: "firstword" });
  assert.equal(committed, true);
  assert.notEqual(await revision(), was, "the ingest did commit, mid-request");
  assert.deepEqual([page.source_generation, page.hits.map((h) => h.handle)], [`${DISCOVERY_EPOCH}:${was}`, ["ada"]], "the old generation, and the old rows under it");
  assert.equal(sent.filter(reads).length, 1, "one statement read the generation and the rows");
  const fresh = await store.discover(api, { mode: "text", q: "firstword" });
  assert.deepEqual([fresh.source_generation, fresh.hits], [`${DISCOVERY_EPOCH}:${await revision()}`, []], "the next page reads the new generation, where the old word is gone");
});
