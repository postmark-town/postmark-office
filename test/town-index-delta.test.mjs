// town-index-delta.test.mjs — the town index's delta computes only the delta
// (POS-523), and still equals the whole derivation.
//
//   node --test test/town-index-delta.test.mjs     (a pool tree's Postgres, or EMBEDDED_PG_DIR)
//
// THE LAW (Keemin 2026-09-27, POS-277): a snapshot per clearing, and only the
// delta computed live. The delta now derives the letters, the threads and both
// mail-ledger tables from what head..sha changed (world2/tools/town-index-
// ingest.mjs § only the delta). Two things are held here:
//
//   1. EQUALITY. After every transition a resident's mail can make (a reply, the
//      ferry's move, a parent that arrives, a bridge that goes, a duplicate copy
//      that survives, an id that changes, a folder letter's attachment, a path
//      with spaces and accents, a resident who leaves, a commit that changes
//      nothing, a ledger whose prose is edited) every table equals the full
//      derivation (src/town-index.mjs § deriveTownIndex, run in a fresh
//      process, what office.db was built from until POS-656) at the same commit. The seal's
//      --snapshot audit repairs a row the deltas could not see, and counts it.
//   2. ONLY THE DELTA. The same one-letter delta on a town ten times larger
//      derives the same number of letters and threads: the work is the change's,
//      not the record's (`work`, counted; the ms are in the PR body).

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { tmpdir } from "node:os";

import { startStore } from "./helpers/embedded-store.mjs";
import { ingest, readHead, letterPathOf, SEAL_SUBJECT } from "../world2/tools/town-index-ingest.mjs";
import { TOWN_TABLES } from "../src/town-index.mjs";
import { mailLineRows } from "../src/mint-inputs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CLONE = join(ROOT, "town-clone");
const hasClone = existsSync(join(CLONE, "tools", "stamp-mint.mjs")) && existsSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"));

const tmp = mkdtempSync(join(tmpdir(), "town-index-delta-"));
let store = null, c = null, owner = null;
let skip = hasClone ? false : "no town-clone with tools/stamp-mint.mjs beside the office: the fixture copies the town's own tools from it";

const LEDGER_HEAD = "# Mail ledger\n\nAppend-only record of every delivery **and every bounce**.\n\n";
const stampLines = hasClone ? readFileSync(join(CLONE, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n") : [];
const address = (h) => `---\nhandle: ${h}\nagent: ${h}\ngithub: fixture-${h}\nsince: 2026-05-12\n---\n\n# ${h}\n`;
const letter = (id, from, to, date, thread = null) =>
  `---\nid: ${id}\nfrom: ${from}\nto: ${to}\ndate: ${date}\n${thread ? `thread: ${thread}\n` : ""}---\n\n# ${id}\n\nA sentence.\n`;
const delivery = (date, id, from, to, thread = null) => `- ${date} · ${id} · ${from} → ${to} · thread: ${thread ?? "new"}\n`;

/** A throwaway town: its own dir, git, ledger lines kept in order. */
function makeTown(name, handles) {
  const dir = join(tmp, name);
  const t = {
    dir, ledger: [],
    put(p, text) { mkdirSync(dirname(join(dir, p)), { recursive: true }); writeFileSync(join(dir, p), text); },
    rm(p) { rmSync(join(dir, p), { recursive: true, force: true }); },
    mv(a, b) { mkdirSync(dirname(join(dir, b)), { recursive: true }); renameSync(join(dir, a), join(dir, b)); },
    git: (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }),
    writeLedger() { t.put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD + t.ledger.join("")); },
    deliver(...a) { t.ledger.push(delivery(...a)); t.writeLedger(); },
    commit(msg) {
      t.git("add", "-A");
      t.git("-c", "user.name=Postmark Pen", "-c", "user.email=pen@test.invalid", "commit", "-q", "--allow-empty", "-m", msg);
      return t.git("rev-parse", "HEAD").trim();
    },
  };
  cpSync(join(CLONE, "tools"), join(dir, "tools"), { recursive: true });
  cpSync(join(CLONE, "quest-registry.json"), join(dir, "quest-registry.json"));
  for (const h of handles) t.put(`WHITE_PAGES/${h}/ADDRESS.md`, address(h));
  t.put("WHITE_PAGES/stamp-ledger.md", stampLines.slice(0, 60).join("\n") + "\n");
  t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello.\n");
  t.writeLedger();
  t.git("init", "-q");
  t.git("config", "core.autocrlf", "false");
  return t;
}

before(async () => {
  if (skip) return;
  store = await startStore({ db: "town_index_delta" });
  if (store.skip) { skip = store.skip; return; }
  c = await store.connect("law_ingester");
  owner = await store.connect("world2_owner");
});

after(async () => {
  for (const x of [c, owner]) if (x) await x.end().catch(() => {});
  if (store?.stop) await store.stop();
  rmSync(tmp, { recursive: true, force: true });
});

// The full derivation at the checkout, in a process of its own (the town's
// tools are imported from the checkout, and a module imported once is cached):
// the rows by table, in TOWN_TABLES' column order.
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

/** Every table: the store's rows (without `digest`) against the full derivation's at the town's checkout, as sorted multisets. */
async function assertEqualToDerivation(t, label) {
  const tables = derived(t.dir);
  for (const [name, { cols }] of Object.entries(TOWN_TABLES)) {
    const norm = (rows) => rows.map((r) => JSON.stringify(cols.map((k, i) => (Array.isArray(r) ? r[i] : r[k]) ?? null))).sort();
    const whole = norm(tables[name] ?? []);
    const stored = norm((await c.query(`SELECT ${cols.join(", ")} FROM town_${name}`)).rows);
    assert.deepEqual(stored, whole, `${label}: town_${name} differs from the full derivation's ${name}`);
  }
  const lines = (await c.query("SELECT seq, line FROM town_mail_lines ORDER BY seq")).rows.map((r) => [r.seq, r.line]);
  assert.deepEqual(lines, mailLineRows(t.dir), `${label}: town_mail_lines differs from the mail ledger's lines`);
}

const step = async (t, label, sha, opts = {}) => {
  const out = await ingest(c, { townRepo: t.dir, sha, ...opts });
  await assertEqualToDerivation(t, label);
  return out;
};

test("letterPathOf names the letter a changed path belongs to", () => {
  assert.equal(letterPathOf("WHITE_PAGES/ada/inbox/x.md"), "WHITE_PAGES/ada/inbox/x.md");
  assert.equal(letterPathOf("WHITE_PAGES/ada/outbox/pic/letter.md"), "WHITE_PAGES/ada/outbox/pic/letter.md");
  assert.equal(letterPathOf("WHITE_PAGES/ada/inbox/pic/sketch.png"), "WHITE_PAGES/ada/inbox/pic/letter.md", "an attachment is its letter's");
  assert.equal(letterPathOf("WHITE_PAGES/ada/HOME/HOME.md"), null);
  assert.equal(letterPathOf("WHITE_PAGES/mail-ledger.md"), null);
});

test("every transition a letter can make: the delta equals the full derivation, and the seal's audit repairs what a delta cannot see", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("matrix", ["ada", "bex", "cyd", "dee"]);
  t.put("WHITE_PAGES/ada/inbox/l1.md", letter("l1", "bex", "ada", "2026-09-01"));
  t.put("WHITE_PAGES/bex/inbox/l2.md", letter("l2", "ada", "bex", "2026-09-02", "l1"));
  t.put("WHITE_PAGES/dee/inbox/l3.md", letter("l3", "cyd", "dee", "2026-09-02"));
  t.put("WHITE_PAGES/cyd/inbox/l4.md", letter("l4", "dee", "cyd", "2026-09-03", "p0"));    // its parent is not in the town yet
  t.deliver("2026-09-01", "l1", "bex", "ada"); t.deliver("2026-09-02", "l2", "ada", "bex", "l1");
  t.deliver("2026-09-02", "l3", "cyd", "dee"); t.deliver("2026-09-03", "l4", "dee", "cyd", "p0");
  const seed = t.commit("the town at its seed");
  await ingest(c, { townRepo: t.dir, sha: seed, seed: true, reseed: true });
  await assertEqualToDerivation(t, "seed");

  // a reply waits in the outbox, then the ferry moves it and writes the ledger
  t.put("WHITE_PAGES/ada/outbox/l5.md", letter("l5", "ada", "bex", "2026-09-04", "l2"));
  const reply = await step(t, "reply in the outbox", t.commit("ada -> bex: reply"));
  assert.equal(reply.work.ledger, "unchanged");
  t.mv("WHITE_PAGES/ada/outbox/l5.md", "WHITE_PAGES/bex/inbox/l5.md");
  t.deliver("2026-09-04", "l5", "ada", "bex", "l2");
  const ferry = await step(t, "the ferry", t.commit("ferry: 1 delivered"));
  assert.equal(ferry.work.ledger, "append");

  // the parent arrives: l4's thread joins it (a merge)
  t.put("WHITE_PAGES/dee/inbox/p0.md", letter("p0", "cyd", "dee", "2026-09-01"));
  t.deliver("2026-09-05", "p0", "cyd", "dee");
  await step(t, "a missing parent arrives", t.commit("ferry: the parent"));

  // the bridge goes: l2 joined l1 and l5, and without it they split
  t.rm("WHITE_PAGES/bex/inbox/l2.md");
  await step(t, "a bridge goes", t.commit("bex: l2 withdrawn"));

  // a duplicate copy: an outbox copy of l1 loses to the inbox copy, then survives it
  t.put("WHITE_PAGES/bex/outbox/l1.md", letter("l1", "bex", "ada", "2026-09-01").replace("A sentence.", "The draft."));
  await step(t, "a losing outbox copy", t.commit("bex: a copy of l1"));
  t.rm("WHITE_PAGES/ada/inbox/l1.md");
  await step(t, "the surviving copy", t.commit("ada: l1 filed away"));

  // an id changes in place
  t.put("WHITE_PAGES/dee/inbox/l3.md", letter("l3b", "cyd", "dee", "2026-09-02"));
  await step(t, "an id changes", t.commit("dee: l3 renamed"));

  // a folder letter, then an attachment added to it
  t.put("WHITE_PAGES/cyd/inbox/pic/letter.md", letter("pic", "ada", "cyd", "2026-09-06"));
  t.put("WHITE_PAGES/cyd/inbox/pic/one.png", "png");
  await step(t, "a folder letter", t.commit("ada -> cyd: a picture"));
  t.put("WHITE_PAGES/cyd/inbox/pic/two.png", "png");
  const attach = await step(t, "an attachment", t.commit("cyd: a second picture"));
  assert.equal(attach.work.letters, 1, "the attachment re-derives its one letter");

  // a path with a space and accents
  t.put("WHITE_PAGES/ada/inbox/a letter for ádá.md", letter("ada-accents", "cyd", "ada", "2026-09-07"));
  t.deliver("2026-09-07", "ada-accents", "cyd", "ada");
  await step(t, "an unusual path", t.commit("ferry: accents"));

  // a resident leaves, mail and all
  t.rm("WHITE_PAGES/dee");
  await step(t, "a resident leaves", t.commit("dee: moved away"));

  // nothing changes
  const noop = await step(t, "a commit with no change", t.commit("an empty commit"));
  assert.equal(noop.work.letters, 0); assert.equal(noop.work.threads, 0);

  // the ledger's prose is edited: no entry moved, so the whole check takes it, as it always did
  t.put("WHITE_PAGES/mail-ledger.md", LEDGER_HEAD.replace("Append-only", "Append-only (always)") + t.ledger.join(""));
  const prose = await step(t, "the ledger's prose", t.commit("mail ledger: the header"));
  assert.equal(prose.work.ledger, "whole");

  // THE AUDIT: rows the deltas cannot see (here, deleted under them) stay gone
  // on a delta that does not touch them, and the seal's --snapshot puts them back
  const head = await readHead(c);
  const goneLetter = (await owner.query("DELETE FROM town_letters WHERE id = 'l3b' RETURNING id")).rowCount;
  const goneThread = (await owner.query("DELETE FROM town_threads WHERE json LIKE '%\"ada-accents\"%' RETURNING root")).rowCount;
  assert.equal(goneLetter + goneThread, 1, "dee left with l3b, so only the thread is there to lose");
  t.put("TOWN_BULLETIN/welcome.md", "---\ntitle: welcome\n---\n\nHello again.\n");
  const blind = await ingest(c, { townRepo: t.dir, sha: t.commit("bulletin: warmer") });
  assert.equal(blind.tally.threads.inserted, 0, "a delta derives only what it changed: the lost thread stays lost");
  assert.notEqual(blind.head, null); assert.equal(blind.head, head);
  const seal = await step(t, "the seal's audit", t.commit(SEAL_SUBJECT), { snapshot: true });
  assert.deepEqual(seal.audit, { letters: 0, threads: 1, ledger: 0, mail_lines: 0 }, "the audit wrote the one thread back, and counted it");
  const kept = (await c.query("SELECT kind, digests FROM town_index_snapshots WHERE sha = $1", [seal.sha])).rows[0];
  assert.equal(kept?.kind, "crossing");
  assert.deepEqual(kept.digests.audit, seal.audit, "the record keeps the seal's audit beside its digests, past the state file's next run");
  assert.equal(typeof kept.digests.letters, "string", "and the table digests are where they were");
});

// The audit's other half (#527 review): a held line that drifted from the
// checkout is a changed past, and the seal's whole check REFUSES it, for the
// parsed ledger and for the mint's raw lines alike. A plain delta whose diff
// does not name the ledger reads no held line, so only the audit can see it.
test("the seal's audit refuses a drifted held ledger line and a drifted mail line, and writes nothing", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("audit-refuses", ["ada", "bex"]);
  t.put("WHITE_PAGES/ada/inbox/n1.md", letter("n1", "bex", "ada", "2026-09-01"));
  t.put("WHITE_PAGES/bex/inbox/n2.md", letter("n2", "ada", "bex", "2026-09-02", "n1"));
  t.deliver("2026-09-01", "n1", "bex", "ada"); t.deliver("2026-09-02", "n2", "ada", "bex", "n1");
  const seed = t.commit("seed");
  await ingest(c, { townRepo: t.dir, sha: seed, seed: true, reseed: true });

  for (const [table, refusal] of [
    ["town_ledger", /the mail ledger's line 2 is not the line the index holds: its past changed, and it is append-only by town law/],
    ["town_mail_lines", /the mail ledger's line 2 is not the line the store holds: its past changed, and it is append-only by town law/],
  ]) {
    const head = await readHead(c);
    const was = (await owner.query(`SELECT digest FROM ${table} WHERE seq = 2`)).rows[0].digest;
    await owner.query(`UPDATE ${table} SET digest = 'drifted' WHERE seq = 2`);
    try {
      t.put("TOWN_BULLETIN/welcome.md", `---\ntitle: welcome\n---\n\nHello, ${table}.\n`);
      const plain = t.commit(`bulletin: ${table}`);
      t.put("PROJECTS/the-town-seal/seal.json", `{"seal":"${table}"}\n`);
      const sealed = t.commit(SEAL_SUBJECT);
      await assert.rejects(ingest(c, { townRepo: t.dir, sha: sealed, snapshot: true }), refusal, `${table}: the audit refuses`);
      assert.equal(await readHead(c), head, `${table}: the head did not move`);
      assert.equal((await c.query("SELECT count(*)::int n FROM town_index_snapshots WHERE sha = $1", [sealed])).rows[0].n, 0, `${table}: no snapshot recorded`);
      const blind = await ingest(c, { townRepo: t.dir, sha: plain });
      assert.equal(blind.work.ledger, "unchanged", `${table}: the plain delta read no held line`);
    } finally {
      await owner.query(`UPDATE ${table} SET digest = $1 WHERE seq = 2`, [was]);
    }
  }
});

test("the ledger refuses a changed past and a shrink, and writes nothing", async (tt) => {
  if (skip) return tt.skip(skip);
  const t = makeTown("ledger", ["ada", "bex"]);
  t.put("WHITE_PAGES/ada/inbox/m1.md", letter("m1", "bex", "ada", "2026-09-01"));
  t.put("WHITE_PAGES/bex/inbox/m2.md", letter("m2", "ada", "bex", "2026-09-02", "m1"));
  t.put("WHITE_PAGES/ada/inbox/m3.md", letter("m3", "bex", "ada", "2026-09-03", "m2"));
  t.deliver("2026-09-01", "m1", "bex", "ada"); t.deliver("2026-09-02", "m2", "ada", "bex", "m1"); t.deliver("2026-09-03", "m3", "bex", "ada", "m2");
  const seed = t.commit("seed");
  await ingest(c, { townRepo: t.dir, sha: seed, seed: true, reseed: true });

  t.ledger[1] = t.ledger[1].replace("2026-09-02", "2026-09-01");     // an interior line, edited in place
  t.writeLedger();
  await assert.rejects(ingest(c, { townRepo: t.dir, sha: t.commit("an interior line edited") }), /line 2 is not the line the index holds.*append-only by town law/);
  assert.equal(await readHead(c), seed, "the head did not move");

  t.git("checkout", "-q", "--detach", seed);
  t.ledger = t.ledger.slice(0, 2);
  t.writeLedger();
  await assert.rejects(ingest(c, { townRepo: t.dir, sha: t.commit("the last line dropped") }), /shrank \(3 lines held, 2 now\)/);
  assert.equal(await readHead(c), seed);
});

/** A town with `n` unrelated two-letter conversations, then one new reply: the same delta at any size. */
async function grownDelta(n) {
  const t = makeTown(`grown-${n}`, ["ada", "bex"]);
  for (let i = 0; i < n; i++) {
    const id = `old-${String(i).padStart(5, "0")}`;
    t.put(`WHITE_PAGES/ada/inbox/${id}.md`, letter(id, "bex", "ada", "2026-08-01"));
    t.put(`WHITE_PAGES/bex/inbox/${id}-re.md`, letter(`${id}-re`, "ada", "bex", "2026-08-02", id));
    t.deliver("2026-08-01", id, "bex", "ada"); t.deliver("2026-08-02", `${id}-re`, "ada", "bex", id);
  }
  t.put("WHITE_PAGES/ada/inbox/today.md", letter("today", "bex", "ada", "2026-09-01"));
  t.deliver("2026-09-01", "today", "bex", "ada");
  const seed = t.commit("seed");
  await ingest(c, { townRepo: t.dir, sha: seed, seed: true, reseed: true });
  t.put("WHITE_PAGES/bex/inbox/today-re.md", letter("today-re", "ada", "bex", "2026-09-02", "today"));
  t.deliver("2026-09-02", "today-re", "ada", "bex", "today");
  const out = await ingest(c, { townRepo: t.dir, sha: t.commit("ferry: the reply") });
  await assertEqualToDerivation(t, `grown ${n}`);
  return out;
}

test("only the delta: the same reply on a town ten times larger derives the same letters and threads", async (tt) => {
  if (skip) return tt.skip(skip);
  const small = await grownDelta(40);
  const large = await grownDelta(400);
  const workOf = (o) => ({ letters: o.work.letters, threads: o.work.threads, threads_scanned: o.work.threads_scanned, ledger: o.work.ledger });
  assert.deepEqual(workOf(small), { letters: 1, threads: 1, threads_scanned: 1, ledger: "append" }, "one letter, its one thread, the ledger appended");
  assert.deepEqual(workOf(large), workOf(small), "the work is the change's, not the record's");
  assert.equal(large.tally.ledger.inserted, 1);
  assert.equal(large.tally.mail_lines.inserted, 1);
});
