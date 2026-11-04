// canonical-records-store.test.mjs — the canonical record and its render intent
// are ONE transaction, and a retry key is spent once, ON A REAL POSTGRES
// (POS-721 / POS-583, the inert phase; src/canonical-records.mjs,
// world2/schema/090_canonical_records.sql).
//
// Rivet's kit marks (2026-11-04, D and E): "the builder FIRST demonstrates
// real dev-store rollback at both failure boundaries and two-process CAS
// before attaching doors"; "the two-process same-nonce control must return
// one persisted receipt, not merely avoid double mutation". Every fact below
// is read back from the committed rows through a second connection, never
// from the writer's own answer alone. Households, handles and values are
// invented.
//
// THE CAN-FAIL MUTANTS (each run against the committed file, restored, and
// named in the PR): the intent appended outside the transaction (split
// client) reds THE FIRST BOUNDARY; the revision check removed reds THE CAS
// RACE; the receipt read moved after the revision check reds THE RETRY;
// the request left out of the receipt comparison reds THE REUSED NONCE; the
// advisory lock removed reds THE SAME-NONCE RACE.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

import { startStore } from "./helpers/embedded-store.mjs";
import { asPaper, paperOnPool, paperworkPoolTypes } from "../src/paperwork.mjs";
import { appendCanonicalProfileIntent, writeCanonicalRecord, CANONICAL_ACT } from "../src/canonical-records.mjs";
import { NONCE_MAX } from "../src/town-journal.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CHILD = join(ROOT, "test", "helpers", "canonical-race-child.mjs");
const MIGRATION = join(ROOT, "world2", "schema", "090_canonical_records.sql");

let store, pool, paper, owner, failAfter = null;

// A fault AFTER a statement the store took: `failAfter` names a statement
// (by regex); once it has run, on a transaction's client OR on the pool's own
// autocommit road, the caller sees an error instead of its answer. A write
// whose two halves share the transaction rolls back whole; one that took
// the pool's road for a half leaves that half committed, and is seen.
function faultable(p) {
  const fault = (sql, answer) => {
    const text = typeof sql === "string" ? sql : sql?.text ?? "";
    if (failAfter && failAfter.test(text)) { failAfter = null; throw Object.assign(new Error("injected fault after the statement ran"), { injected: true }); }
    return answer;
  };
  const pq = p.query.bind(p);
  p.query = async (sql, args) => fault(sql, await pq(sql, args));
  const connect = p.connect.bind(p);
  p.connect = (cb) => {
    if (typeof cb === "function") return connect(cb);
    return connect().then((client) => {
      if (!client.__faultable) {
        const q = client.query.bind(client);
        client.query = (sql, args, cb2) => {
          if (typeof cb2 === "function" || typeof args === "function") return q(sql, args, cb2);
          return q(sql, args).then((answer) => fault(sql, answer));
        };
        client.__faultable = true;
      }
      return client;
    });
  };
}

const house = (slug, ord) => owner.query(
  "INSERT INTO households (slug, ord, name, residents, since, declared_by) VALUES ($1, $2, $3, ARRAY[$4], '2026-11-04', $4)",
  [slug, ord, `Invented ${slug}`, `${slug}-res`]);
const residentRow = (handle, slug, extra = {}) => owner.query(
  "INSERT INTO resident_records (subject_id, resident_handle, household_slug, revision, display_name, bio) VALUES (gen_random_uuid(), $1, $2, 1, $3, $4)",
  [handle, slug, extra.display_name ?? `Invented ${handle}`, extra.bio ?? null]);
const human = async (slug) => (await owner.query("SELECT * FROM human_records WHERE household_slug = $1", [slug])).rows[0] ?? null;
const resident = async (handle) => (await owner.query("SELECT * FROM resident_records WHERE resident_handle = $1", [handle])).rows[0] ?? null;
const intents = async (slug, handle = null) => (await owner.query(
  "SELECT seq, class, act, household, handle, payload FROM office_town_journal WHERE act = $1 AND household = $2 AND handle IS NOT DISTINCT FROM $3 ORDER BY seq",
  [CANONICAL_ACT, slug, handle])).rows.map((r) => ({ ...r, payload: JSON.parse(r.payload) }));

const humanWrite = (slug, patch, expectedRevision, nonce, p = paper) =>
  writeCanonicalRecord(p, { kind: "human", target: { household: slug }, patch, expectedRevision, nonce, provenance: `human-of-${slug}` });
const residentWrite = (handle, patch, expectedRevision, nonce) =>
  writeCanonicalRecord(paper, { kind: "resident", target: { handle }, patch, expectedRevision, nonce, provenance: `resident-${handle}` });

before(async () => {
  store = await startStore({ db: "canonical_records" });
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: store.url("office_api"), max: 4, types: paperworkPoolTypes(pg) });
  pool.on("error", () => {});
  faultable(pool);
  paper = paperOnPool(pool);
  owner = await store.connect("world2_owner");
  for (const [i, slug] of ["inv-alder", "inv-birch", "inv-cedar", "inv-dune", "inv-elm", "inv-fern", "inv-gorse", "inv-hazel", "inv-iris"].entries()) await house(slug, 9000 + i);
});

after(async () => {
  await pool?.end().catch(() => {});
  await owner?.end().catch(() => {});
  await store?.stop();
});

// ── the migration ─────────────────────────────────────────────────────────────

test("090 lands, applies twice, and grants the office's pen only what the writers run", async () => {
  await owner.query(readFileSync(MIGRATION, "utf8")); // the floor applied it once; a second apply changes nothing
  const { rows: [p] } = await owner.query(`SELECT to_regclass('resident_records') IS NOT NULL AS r, to_regclass('human_records') IS NOT NULL AS h,
    EXISTS (SELECT 1 FROM pg_indexes WHERE tablename = 'office_town_journal' AND indexname = 'office_town_journal_canonical_nonce') AS i`);
  assert.deepEqual(p, { r: true, h: true, i: true });
  const may = async (role, table, priv) => (await owner.query("SELECT has_table_privilege($1, $2, $3) AS ok", [role, table, priv])).rows[0].ok;
  assert.equal(await may("office_api", "human_records", "INSERT"), true);
  assert.equal(await may("office_api", "human_records", "UPDATE"), true);
  assert.equal(await may("office_api", "resident_records", "UPDATE"), true);
  assert.equal(await may("office_api", "resident_records", "INSERT"), false, "a resident's row is made by a later phase, not this one");
  for (const t of ["human_records", "resident_records"]) {
    assert.equal(await may("office_api", t, "DELETE"), false, `${t}: a record is cleared, never removed`);
    for (const r of ["clearing_job", "law_ingester", "snapshot_reader"]) assert.equal(await may(r, t, "SELECT"), false, `${r} reads no ${t} yet`);
  }
  assert.equal(await may("office_api", "office_town_journal", "UPDATE"), false, "the town log stays append-only");
  const { rows } = await owner.query("SELECT object, owner_pen FROM registry WHERE object IN ('resident_records', 'human_records') ORDER BY object");
  assert.deepEqual(rows, [{ object: "human_records", owner_pen: "office_api" }, { object: "resident_records", owner_pen: "office_api" }]);
});

test("a FILE paper is unavailable: no second, best-effort write", async () => {
  const file = asPaper(new DatabaseSync(":memory:"));
  const answer = await humanWrite("inv-alder", { town_name: "Alder" }, 0, "file-1", file);
  assert.equal(answer.refused, "unavailable");
  assert.equal(await human("inv-alder"), null);
});

// ── one transaction ──────────────────────────────────────────────────────────

test("the human's first change: revision 1, one opaque subject, one intent row, in one commit", async () => {
  const answer = await humanWrite("inv-alder", { town_name: "Alder", short_line: "keeps bees", pronouns: "" }, 0, "alder-1");
  assert.equal(answer.applied, true);
  const row = await human("inv-alder");
  assert.match(row.subject_id, /^[0-9a-f-]{36}$/);
  assert.equal(Number(row.revision), 1);
  assert.deepEqual([row.town_name, row.short_line, row.pronouns], ["Alder", "keeps bees", null], "empty is a clear, so nothing is stored for it");
  const [it] = await intents("inv-alder");
  assert.equal(it.class, "update");
  assert.equal(it.handle, null, "the human's intent carries no handle");
  assert.equal(Number(it.seq), answer.seq);
  assert.deepEqual(it.payload.intent, { version: 1, kind: "human", subject_id: row.subject_id, record_revision: 1,
    public_snapshot: { town_name: "Alder", short_line: "keeps bees" }, trusted_provenance: "human-of-inv-alder" });
  assert.deepEqual(Object.keys(it.payload).sort(), ["intent", "receipt"]);
});

test("THE FIRST BOUNDARY: the intent's append fails after the record changed, and BOTH roll back", async () => {
  // a first create, then an update, each failing after the journal INSERT itself ran
  try {
    failAfter = /INSERT INTO office_town_journal/;
    await assert.rejects(humanWrite("inv-birch", { town_name: "Birch" }, 0, "birch-1"), (e) => e.injected === true);
  } finally { failAfter = null; }
  assert.deepEqual(await intents("inv-birch"), [], "no intent");
  assert.equal(await human("inv-birch"), null, "no record");
  // the control: the same write with no fault commits both
  assert.equal((await humanWrite("inv-birch", { town_name: "Birch" }, 0, "birch-1")).applied, true);
  try {
    failAfter = /INSERT INTO office_town_journal/;
    await assert.rejects(humanWrite("inv-birch", { town_name: "Birch Hollow" }, 1, "birch-2"), (e) => e.injected === true);
  } finally { failAfter = null; }
  assert.equal((await intents("inv-birch")).length, 1, "only the control's intent");
  const row = await human("inv-birch");
  assert.deepEqual([row.town_name, Number(row.revision)], ["Birch", 1], "the update rolled back with its intent");
});

test("THE SECOND BOUNDARY: the record's write fails after the intent was appended, and BOTH roll back", async () => {
  assert.equal((await humanWrite("inv-cedar", { town_name: "Cedar" }, 0, "cedar-1")).applied, true);
  const before = await human("inv-cedar");
  await assert.rejects(paper.tx(async (t) => {
    await appendCanonicalProfileIntent(t, { household: "inv-cedar", intent: { version: 1, kind: "human" }, receipt: { nonce: "cedar-2", request: "{}" } });
    // the record's change, refused by its own foreign key, on the SAME client
    await t.run("UPDATE human_records SET household_slug = ?, revision = revision + 1 WHERE subject_id = ?", "inv-no-such-house", before.subject_id);
  }), (e) => e.code === "23503");
  assert.deepEqual(await human("inv-cedar"), before, "the record is as it was");
  assert.equal((await intents("inv-cedar")).filter((r) => r.payload.receipt.nonce === "cedar-2").length, 0, "the appended intent rolled back with it");
});

// ── two independent processes ───────────────────────────────────────────────

// Hold a table lock no writer can pass, start two writers, wait until BOTH are
// waiting on the database, then let them go: the race is real, not a sequence.
async function race(asks, lockTable) {
  const holder = await store.connect("world2_owner");
  try {
    await holder.query("BEGIN");
    await holder.query(`LOCK TABLE ${lockTable} IN EXCLUSIVE MODE`);
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const runs = asks.map((ask, i) => new Promise((ok, no) => {
      const child = spawn(process.execPath, [CHILD, JSON.stringify({ ...ask, url: store.url("office_api"), appName: `canonical-race-${i}` })], { env, stdio: ["ignore", "pipe", "pipe"] });
      let out = "", err = "";
      // a writer that hangs (a nested pool checkout, a lost lock) is a red, not a wait
      const kill = setTimeout(() => child.kill("SIGKILL"), 30_000);
      child.stdout.on("data", (d) => { out += d; });
      child.stderr.on("data", (d) => { err += d; });
      child.on("error", no);
      child.on("close", (code, signal) => {
        clearTimeout(kill);
        if (code === 0) ok(JSON.parse(out.trim().split("\n").pop()));
        else no(new Error(`writer ${i} ${signal ? `killed (${signal}) after 30 s` : `exited ${code}`}: ${err.slice(0, 400)}`));
      });
    }));
    const deadline = Date.now() + 20_000;
    for (;;) {
      // pg_locks, not pg_stat_activity: another role's wait state is hidden from a
      // non-superuser there, while an ungranted lock request is visible to all
      const { rows: [w] } = await owner.query(
        `SELECT count(DISTINCT l.pid)::int AS n FROM pg_locks l
          WHERE NOT l.granted AND l.pid <> pg_backend_pid()
            AND l.database = (SELECT oid FROM pg_database WHERE datname = $1)`,
        [store.database]);
      if (w.n === asks.length) break;
      if (Date.now() > deadline) throw new Error(`only ${w.n} of ${asks.length} writers reached the database's wait`);
      await new Promise((r) => setTimeout(r, 50));
    }
    await holder.query("COMMIT");
    return await Promise.all(runs);
  } finally {
    await holder.query("ROLLBACK").catch(() => {});
    await holder.end();
  }
}

test("THE CAS RACE: two processes, one expected revision, two nonces: one winner, and the loser writes nothing", async () => {
  assert.equal((await humanWrite("inv-dune", { town_name: "Dune" }, 0, "dune-0")).applied, true);
  const answers = await race([
    { kind: "human", target: { household: "inv-dune" }, patch: { short_line: "first" }, expectedRevision: 1, nonce: "dune-a", provenance: "human-of-inv-dune" },
    { kind: "human", target: { household: "inv-dune" }, patch: { short_line: "second" }, expectedRevision: 1, nonce: "dune-b", provenance: "human-of-inv-dune" },
  ], "human_records");
  const won = answers.filter((a) => a.applied), lost = answers.filter((a) => a.refused === "conflict");
  assert.equal(won.length, 1, `one winner: ${JSON.stringify(answers)}`);
  assert.equal(lost.length, 1, "one loser");
  assert.equal(lost[0].why, "revision");
  const row = await human("inv-dune");
  assert.equal(Number(row.revision), 2, "exactly one change on top of revision 1");
  assert.equal((await intents("inv-dune")).length, 2, "the first write's intent and the winner's, no more");
});

test("THE SAME-NONCE RACE: two processes, one first create, one nonce: one subject, one row, and both answer the ONE receipt", async () => {
  const ask = { kind: "human", target: { household: "inv-elm" }, patch: { town_name: "Elm" }, expectedRevision: 0, nonce: "elm-1", provenance: "human-of-inv-elm" };
  const answers = await race([ask, ask], "human_records");
  assert.ok(answers.every((a) => a.ok === true), `both answered: ${JSON.stringify(answers)}`);
  assert.deepEqual(answers.map((a) => (a.applied ? "applied" : a.replayed ? "replayed" : "?")).sort(), ["applied", "replayed"]);
  assert.equal(answers[0].subject_id, answers[1].subject_id, "one subject");
  assert.equal(answers[0].seq, answers[1].seq, "one receipt");
  assert.equal(Number((await human("inv-elm")).revision), 1);
  assert.equal((await intents("inv-elm")).length, 1);
});

// ── the nonce ────────────────────────────────────────────────────────────────

test("THE RETRY: the same nonce and request answer the first receipt, even once the expected revision is old", async () => {
  const first = await humanWrite("inv-fern", { town_name: "Fern" }, 0, "fern-1");
  assert.equal(first.applied, true);
  assert.equal((await humanWrite("inv-fern", { short_line: "moved on" }, 1, "fern-2")).applied, true);
  const again = await humanWrite("inv-fern", { town_name: "Fern" }, 0, "fern-1");
  assert.deepEqual({ ...again }, { ok: true, replayed: true, subject_id: first.subject_id, revision: 1, seq: first.seq, public_snapshot: { town_name: "Fern" } });
  assert.equal(Number((await human("inv-fern")).revision), 2, "nothing changed");
  assert.equal((await intents("inv-fern")).length, 2, "no second act");
});

test("THE REUSED NONCE: the same nonce with a different request conflicts and changes nothing", async () => {
  const answer = await humanWrite("inv-fern", { town_name: "Not Fern" }, 2, "fern-1");
  assert.deepEqual(answer, { ok: false, refused: "conflict", why: "nonce-reused" });
  assert.equal((await human("inv-fern")).town_name, "Fern");
  assert.equal((await intents("inv-fern")).length, 2);
});

test("scopes are not conflated: one nonce spent by two houses' humans and a resident, each once", async () => {
  await residentRow("inv-gorse-res", "inv-gorse");
  const a = await humanWrite("inv-gorse", { town_name: "Gorse" }, 0, "shared");
  const b = await residentWrite("inv-gorse-res", { model: "invented-model" }, 1, "shared");
  const c = await humanWrite("inv-hazel", { town_name: "Hazel" }, 0, "shared");
  assert.deepEqual([a.applied, b.applied, c.applied], [true, true, true]);
  assert.equal((await resident("inv-gorse-res")).model, "invented-model");
  assert.equal((await intents("inv-gorse", "inv-gorse-res"))[0].payload.intent.kind, "resident");
});

test("NONCE_MAX: a nonce is bounded in bytes and refused, never trimmed; at the bound it is kept whole", async () => {
  const over = "ü".repeat(NONCE_MAX / 2) + "x"; // 201 bytes
  assert.equal((await humanWrite("inv-iris", { town_name: "Iris" }, 0, over)).refused, "invalid");
  assert.equal(await human("inv-iris"), null);
  const at = "n".repeat(NONCE_MAX);
  assert.equal((await humanWrite("inv-iris", { town_name: "Iris" }, 0, at)).applied, true);
  assert.equal((await intents("inv-iris"))[0].payload.receipt.nonce, at);
});

// ── no-ops, refusals, the resident ────────────────────────────────────────────

test("a no-op writes no record, no act and no intent", async () => {
  const absent = await humanWrite("inv-hazel-none", { town_name: null }, 0, "n-1");
  assert.equal(absent.refused, "no-target", "an unknown house is refused before anything");
  const before = (await intents("inv-hazel")).length;
  const same = await humanWrite("inv-hazel", { town_name: "Hazel" }, 1, "hazel-noop");
  assert.deepEqual(same, { ok: true, noop: true, revision: 1, public_snapshot: { town_name: "Hazel" } });
  assert.equal((await intents("inv-hazel")).length, before);
  // a house with no human record, asked to clear what it never set: no record is made
  await house("inv-juniper", 9100);
  assert.equal((await humanWrite("inv-juniper", { pronouns: "  " }, 0, "j-1")).noop, true);
  assert.equal(await human("inv-juniper"), null);
});

test("refused before anything is opened: an unknown field, a non-string value, a missing resident", async () => {
  assert.match((await humanWrite("inv-hazel", { real_name: "x" }, 1, "h-x")).why, /unknown field/);
  assert.match((await humanWrite("inv-hazel", { town_name: 7 }, 1, "h-y")).why, /not a string/);
  assert.equal((await residentWrite("inv-nobody", { bio: "x" }, 1, "r-1")).refused, "no-target");
  assert.equal((await intents("inv-hazel")).length, 1);
});

test("the resident's CAS: a stale revision conflicts with the current public view; the right one changes only what it names", async () => {
  await residentRow("inv-hazel-res", "inv-hazel", { bio: "a long bio ".repeat(80) });
  const stale = await residentWrite("inv-hazel-res", { platform: "invented-platform" }, 0, "hr-1");
  assert.equal(stale.why, "revision");
  assert.equal(stale.revision, 1);
  const ok = await residentWrite("inv-hazel-res", { platform: "invented-platform" }, 1, "hr-1");
  assert.equal(ok.applied, true);
  const row = await resident("inv-hazel-res");
  assert.equal(row.platform, "invented-platform");
  assert.equal(row.bio, "a long bio ".repeat(80), "an untouched field keeps its whole value");
  assert.equal(ok.public_snapshot.bio.length, 880);
});

// ── the bounded lookup ────────────────────────────────────────────────────────

test("the receipt lookup the writer actually sends is bounded by 090's index on an invented history", async () => {
  await owner.query(`INSERT INTO office_town_journal (class, act, household, handle, payload, written_at)
    SELECT 'update', CASE WHEN g % 3 = 0 THEN 'profile' ELSE $1 END, 'inv-hist-' || (g % 400), NULL,
           json_build_object('receipt', json_build_object('nonce', 'h-' || g, 'request', '{}'))::text, '2026-11-04T00:00:00Z'
      FROM generate_series(1, 6000) g`, [CANONICAL_ACT]);
  await owner.query("ANALYZE office_town_journal");
  // capture the statement the writer sends, then explain exactly that text
  const sent = [];
  const connect = pool.connect;
  pool.connect = (cb) => (typeof cb === "function" ? connect(cb) : connect().then((c) => {
    const cq = c.query;
    c.query = (sql, args, cb2) => {
      if (typeof sql === "string" && /payload::jsonb #>>/.test(sql)) sent.push({ sql, args });
      return cq(sql, args, cb2);
    };
    return c;
  }));
  try {
    assert.equal((await humanWrite("inv-hazel", { short_line: "explained" }, 1, "h-explain")).applied, true);
  } finally { pool.connect = connect; }
  assert.equal(sent.length, 1, "one receipt lookup per write");
  const api = await store.connect("office_api");
  try {
    const { rows } = await api.query(`EXPLAIN ${sent[0].sql}`, sent[0].args);
    const plan = rows.map((r) => r["QUERY PLAN"]).join("\n");
    assert.match(plan, /office_town_journal_canonical_nonce/, plan);
    assert.doesNotMatch(plan, /Seq Scan on office_town_journal/);
  } finally { await api.end(); }
});
