// pos-1129-doorstep-leases.test.mjs — POS-1129: a keyless doorstep reads its store in 3 pen leases, not 11, and composes after each is released.
//
// LAW (POS-1129, ruled by Jetto 2026-11-18 15:4xZ under Darko's 11-17 server-performance ruling and Wright's 09:49 EST go on POS-1110's levers):
// "one resident's doorstep loads its store reads in 2–3 pen leases, not 11 … Then it composes after release … No JavaScript composition under a
// lease. POS-1098 stays true: no doorstep asks for more than one connection at once." Done when "doorsteps are byte-identical to today's for the
// same store, test-proved on a fixture" and "the lease count per resident is asserted by a test reading read-timing's lease records".
//
// WHAT WAS MEASURED FIRST (this fixture, office main 9be687d1f, the keyless doorstep with the town clone): 11 pen leases, the same 11 POS-1110 read
// off prod's access log. Six were the town index (fresh's standing, the core, the copy, and next steps' registry, standing and board), four the
// posts' classes, one the ballots. The stances, outcomes, stakes and alerts take none: they read other pools, which `read-timing` does not cover.
//
// WHAT THIS HOLDS
//   1. THE SAME PAGE: the doorstep through the one-lease page (town-index-store.mjs § doorstepPage) is byte for byte the doorstep through the
//      separate reads it replaced (ix.doorstep, ix.copy, ix.questRegistry, ix.standing, ix.questBoard and freshFor, each still in the source),
//      for an author, a respondent, a resident with nothing, and no resident; with the town clone and without.
//   2. THE SAME POSTS and THE SAME BALLOTS: the house's posts, every class in one lease, equal the old one-lease-per-class reading, and the
//      ballots read raw and shaped after equal the old reading that shaped inside (both old readings kept verbatim below).
//   3. THE BOUNDARY: no JSON is parsed while a pen connection is held (the driver's own parsing excluded), no statement follows a release, no
//      connection is out when the page is done, and never two at once. The same page composed inside its lease, through the same instrument,
//      parses under it: the control. (The ballots' and posts' `fields` are jsonb, which the driver parses, so their shaping is moved after the
//      lease for the law's sake but this instrument cannot see it; their equality is test 2's.)
//   5. LEASE A FAILURES on real Postgres (an injector replaces one statement with an SQL error or the connection's own death): any one extra
//      read failing either way answers the page the separate leases answered, byte for byte, never a throw; a dead core answers as it did.
//   6. LEASE B FAILURES on real Postgres: a class failing either way is said alone, and the classes after it are read.
//   4. THE LEASES, at the real doors: GET /doorstep/<h> and GET /doorsteps?handles=… on a spawned office, read from the access line's `timing`
//      (read-timing.mjs), at most 3 per resident; and in process, exactly the three named loads, one connection at a time.
//
//   node --import ./test/helpers/sparse-guard.mjs --test --test-concurrency=1 test/pos-1129-doorstep-leases.test.mjs
//
// FLIPS (run on this branch, results in the PR): put the copy back on its own lease (doorstep-bundle.mjs: `copyBlock(await ix.copy(), …)`) and 4
// reds the lease count, in process and at both doors; compose the page inside its lease (town-index-store.mjs § storeIndexPooled's `doorstepPage`,
// the composition moved into the read) and 3 reds THE BOUNDARY while 1 stays green; hand the next steps no `nextPre` (doorstep-bundle.mjs § ownerGate's
// call) and they read their own three leases again: 4 reds at 6 leases, and 3 reds on the quest standing parsed under its own lease.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fixtureTown, put, setMeta } from "./fixture.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { townClone, NO_TOWN, OFFICE_ROOT } from "./fixture-paths.mjs";
import { bootOnFreePort, freePort } from "./spawn-office.mjs";

process.env.WORLD_GRAPH_NONE = "1";

const NOW = Date.parse("2026-11-18T12:00:00Z");
const TOWN = townClone();   // null: no town clone here (the votes and next steps then compose nothing, on both sides)
const REGISTRY = { schema_version: 1, note: "invented for POS-1129", households: {
  "ember-lane": { name: "Ember Lane", since: "2026-08-01", declared_by: "wright", accounts: [{ login: "ember-gh", id: 9101 }], residents: ["wright", "limen"] },
} };
const PINS = { wright: { login: "ember-gh", id: 9101 }, limen: { login: "ember-gh", id: 9101 } };
const TOPIC = "lamp-colour";

/** Invented posts, an RSVP, a ballot and a vote, written as the store's owner: what the posts and votes segments read. */
async function seedPosts(store) {
  const { ballotPostId, BALLOT_AUTHOR } = await import("../src/ballots.mjs");
  const c = await store.connect("world2_owner");
  try {
    const act = async (actor, action, object, cls, at) => Number((await c.query(
      "INSERT INTO acts (at, actor, action, object, class, payload, household) VALUES ($1, $2, $3, $4, $5, '{}'::jsonb, 'ember-lane') RETURNING id",
      [at, actor, action, object, cls])).rows[0].id);
    const post = async (row) => c.query(
      `INSERT INTO posts (id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act)
       VALUES ($1, $2, $3, $4, $5, 'ember-lane', NULL, $6, $7, $8, $9, $10, $11::jsonb, 0, $12, $12)`,
      [row.id, row.cls, row.title, row.body ?? "", row.author, row.x ?? null, row.y ?? null, row.starts ?? null, row.ends ?? null, row.state, JSON.stringify(row.fields ?? {}), row.act]);
    const tea = await act("wright", "host", "wright/tea", "event", "2026-11-15T10:00:00Z");
    await post({ id: "wright/tea", cls: "event", title: "Tea at the Trueing-House", author: "wright", x: 3, y: 4,
      starts: "2026-11-20T18:00:00Z", ends: "2026-11-20T20:00:00Z", state: "announced", fields: { doors_open: "2026-11-20T17:45:00.000Z" }, act: tea });
    // the respondent lives in another house (a house's own post is put up, not taken part in)
    const rsvp = await act("postmaster", "rsvp", "wright/tea", "event", "2026-11-16T10:00:00Z");
    await c.query("INSERT INTO responses (post, handle, household, kind, state, fields, act) VALUES ('wright/tea', 'postmaster', 'postmaster', 'rsvp', 'standing', $1::jsonb, $2)",
      [JSON.stringify({ harness: "mail", budget: 5 }), rsvp]);
    const bug = await act("wright", "post", "wright/the-gate-sticks", "bug", "2026-11-14T09:00:00Z");
    await post({ id: "wright/the-gate-sticks", cls: "bug", title: "The gate sticks", body: "It sticks at dusk.", author: "wright", state: "reported", act: bug });
    const id = ballotPostId(TOPIC);
    const ballot = await act(BALLOT_AUTHOR, "post", id, "ballot", "2026-11-12T09:00:00Z");
    await post({ id, cls: "ballot", title: "The lamp's colour", author: BALLOT_AUTHOR, state: "staking",
      fields: { topic: TOPIC, candidates: ["amber", "blue"], cap_per_household_per_candidate: 3 }, act: ballot });
    const vote = await act("wright", "vote", id, "ballot", "2026-11-13T09:00:00Z");
    await c.query("INSERT INTO responses (post, handle, household, kind, state, fields, act) VALUES ($1, 'wright', 'ember-lane', 'vote', 'standing', $2::jsonb, $3)",
      [id, JSON.stringify({ stakes: [{ act: vote, candidate: "amber", n: 1, mint_key: "ember-lane" }] }), vote]);
  } finally { await c.end(); }
}

let IX, pool, tis, pen, doorstepBundle, freshFor, newTiming, runTiming, timingLine, penHeld;
/** The injection in force, or null: `{ match(sql, params), mode: "error" | "kill", hits }` (§ the pool's `query` wrapper in `before`). */
let inject = null;
const checkouts = { open: 0, afterRelease: 0, leases: 0, peak: 0 };

/** The fixture town, plus what the next steps read: an invented one-quest registry and a quest standing row (so the quest reads put steps on the page). */
function town() {
  const t = fixtureTown();
  setMeta(t, "quest_registry", JSON.stringify({ version: 1, note: "invented for POS-1129", quests: [
    { id: "correspond-send", title: "Reach out", cadence: "daily", validation: "automatic", source: "Send a letter to 5 different residents.", target: 5, reward: "1 stamp each" },
  ] }));
  put(t, "quest_standing", { handle: "wright", json: JSON.stringify({ card: true, home: false, window: true, sent: true, received: true, welcomed: true }) });
  return t;
}

before(async () => {
  IX = await indexStore(town(), { db: "pos1129_leases" });
  await seedRegistry(IX.store, REGISTRY, PINS);
  await seedPosts(IX.store);
  process.env.WORLD2_PG = "1";
  process.env.WORLD2_PG_URL = IX.env.WORLD2_PG_URL;
  const { default: pg } = await import("pg");
  pool = new pg.Pool({ connectionString: IX.env.WORLD2_PG_URL, max: 3 });
  pool.on("error", () => {});
  const connect = pool.connect.bind(pool);
  pool.connect = async (...a) => {
    const c = await connect(...a);
    checkouts.open += 1; checkouts.leases += 1; checkouts.peak = Math.max(checkouts.peak, checkouts.open);
    c.__out = true;
    const release = c.release.bind(c);
    c.release = (...r) => { checkouts.open -= 1; c.__out = false; return release(...r); };
    if (!c.__wrapped) {
      c.__wrapped = true;
      c.on?.("error", () => {});   // a connection killed by an injection reports here too; the read that held it answers for it
      const query = c.query.bind(c);
      c.query = (q, ...r) => {
        if (!c.__out) checkouts.afterRelease += 1;
        // THE INJECTOR (lifted from the reviewer's probe, POS-1129 review of db640416d): one statement of one read, matched by its SQL and
        // parameters, is replaced by a REAL failure on this real Postgres: an SQL error, or the connection's own death.
        const sql = typeof q === "string" ? q : q?.text ?? "";
        if (inject && inject.match(sql, r[0])) {
          inject.hits += 1;
          if (inject.mode === "error") return query("SELECT * FROM no_such_table_pos1129");
          if (inject.mode === "kill") return query("SELECT pg_terminate_backend(pg_backend_pid())");
        }
        return query(q, ...r);
      };
    }
    return c;
  };
  // ONE pen pool for both roads, as on the box: the town index's reads and every officeRead
  pen = await import("../src/world2-pen.mjs");
  pen.__setPoolForTest(pool);
  tis = await import("../src/town-index-store.mjs");
  tis.__setTownIndexPoolForTest(pool);
  tis.__resetRosterForTest(); tis.__resetProbeForTest();
  await tis.refreshStoreRoll(); await tis.refreshStoreProbe();
  ({ doorstepBundle } = await import("../src/doorstep-bundle.mjs"));
  ({ freshFor } = await import("../src/paper-fresh.mjs"));
  ({ newTiming, runTiming, timingLine } = await import("../src/read-timing.mjs"));
  ({ penHeld } = await import("../src/store-pool.mjs"));
});

after(async () => {
  pen?.__setPoolForTest(null);
  tis?.__setTownIndexPoolForTest(null);
  await pool?.end().catch(() => {});
  await IX?.stop();
});

const settle = (p) => Promise.resolve().then(() => p).then((v) => ({ v }), (e) => ({ e }));

/** The page as the doorstep read it before POS-1129: freshFor, then the core, the copy and the three quest reads, each on its own lease. */
function legacyIx(real) {
  return {
    ...real,
    doorstepPage: async (handle, asOf, opts) => {
      const { freshBase, ...rest } = opts;
      const fresh = await freshFor(handle, { odb: null, clone: freshBase.clone, asOf: freshBase.asOf });
      const core = await real.doorstep(handle, asOf, { ...rest, fresh });
      if (!core) return null;
      return {
        core,
        copy: await settle(real.copy()),
        next: { registry: await settle(real.questRegistry()), standing: await settle(real.standing(handle)), questBoard: (o) => real.questBoard(handle, o) },
      };
    },
  };
}
const ctxOf = (ix, clone) => ({ key: null, asOf: undefined, clone, odb: null, canWrite: false, ix, conversationsOffset: 0, nowMs: NOW });
const page = (handle, clone, legacy = false) => {
  const real = tis.storeIndexPooled(clone);
  return doorstepBundle(handle, ctxOf(legacy ? legacyIx(real) : real, clone));
};
const resetCheckouts = () => { checkouts.open = 0; checkouts.afterRelease = 0; checkouts.leases = 0; checkouts.peak = 0; };

test("1 · THE SAME PAGE: the one-lease page is byte for byte the page the separate reads composed", async () => {
  const clones = TOWN ? [TOWN, null] : [null];
  let compared = 0;
  for (const clone of clones) for (const h of ["wright", "limen", "postmaster", "nobody-lives-here"]) {
    const want = await settle(page(h, clone, true));
    const got = await settle(page(h, clone));
    assert.equal(JSON.stringify(got.v ?? String(got.e)), JSON.stringify(want.v ?? String(want.e)),
      `${h} (clone ${clone ? "the town's" : "none"}): the one-lease page answered differently from the separate reads`);
    compared += 1;
  }
  assert.equal(compared, clones.length * 4);
  // the control that the comparison is looking at pages with something on them: the fixture's posts reach both sides
  const w = await page("wright", clones[0]);
  const p = await page("postmaster", clones[0]);
  assert.ok(w.posts.put_up.total >= 2, `wright put up ${w.posts.put_up.total} posts: the fixture's posts are not reaching the page`);
  assert.ok(p.posts.taking_part.total >= 1, `postmaster takes part in ${p.posts.taking_part.total}: the RSVP is not reaching the page`);
  assert.equal(await page("nobody-lives-here", clones[0]), null, "no resident is still no page");
  if (TOWN) assert.ok(w.next_steps, "with the town clone, the next steps (the quest reads) composed: the comparison covers them");
});

/** The house's posts as household-posts.mjs read them before POS-1129 (kept verbatim): each class its own lease. */
async function OLD_classRows(cls, members, now) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { postRowsOf } = await import("../src/household-posts.mjs");
  const house = new Set(members);
  try {
    return await officeRead(async (client) => {
      const rows = await postRowsOf(client, cls, now, { keep: (p, who) => house.has(p.author) || who.some((h) => house.has(h)) });
      return { rows: rows.map((r) => ({ ...r, role: house.has(r.author) ? "author" : "participant", stake: 0, ours: 0 })) };
    });
  } catch { return { unavailable: cls }; }
}
/** The ballots with their votes as ballots-store.mjs read them before POS-1129 (kept verbatim): shaped inside the lease. */
async function OLD_ballotsWithVotes({ open = false } = {}) {
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { ballotRows, voteRows } = await import("../src/ballots-store.mjs");
  const { STATE_CLOSED } = await import("../src/ballots.mjs");
  return officeRead(async (client) => {
    const posts = (await ballotRows(client)).filter((p) => !open || p.state !== STATE_CLOSED);
    const byPost = new Map();
    for (const r of await voteRows(client, posts.map((p) => p.id))) byPost.set(r.post, [...(byPost.get(r.post) ?? []), r]);
    return posts.map((post) => ({ post, votes: byPost.get(post.id) ?? [] }));
  });
}

test("2 · THE SAME POSTS and THE SAME BALLOTS: one lease reads what one lease per class read, and shaping after the lease answers what shaping inside it did", async () => {
  const { householdPosts, postOrder, POSTS_CAP } = await import("../src/household-posts.mjs");
  const { POST_CLASSES } = await import("../src/town-posts.mjs");
  const classes = Object.keys(POST_CLASSES);
  for (const h of ["wright", "limen", "postmaster"]) {
    const now = NOW;
    const got = await householdPosts(h, { now, townClone: TOWN ?? join(OFFICE_ROOT, "no-town-clone") });
    const halves = [];
    for (const cls of classes) halves.push(await OLD_classRows(cls, got.residents, now));
    assert.ok(halves.every((x) => x.rows), `an old class read did not answer: ${JSON.stringify(halves.filter((x) => !x.rows))}`);
    const rows = halves.flatMap((x) => x.rows).sort(postOrder);
    const plain = ({ ...r }) => r;   // the symbols are not own-enumerable string keys; JSON drops them on both sides alike
    for (const role of ["author", "participant"]) {
      const all = rows.filter((r) => r.role === role);
      const want = { total: all.length, shown: Math.min(all.length, POSTS_CAP), rows: all.slice(0, POSTS_CAP).map(plain) };
      const list = role === "author" ? got.put_up : got.taking_part;
      // the ideas half rides beside the classes on both readings; it holds no rows on this fixture (no store tank), so the lists are the classes'
      assert.equal(JSON.stringify(list), JSON.stringify(want), `${h} ${role}: the one-lease posts differ from the per-class reading`);
    }
  }
  const { ballotsWithVotes } = await import("../src/ballots-store.mjs");
  for (const open of [false, true]) {
    const got = await ballotsWithVotes({ open });
    assert.equal(JSON.stringify(got), JSON.stringify(await OLD_ballotsWithVotes({ open })), `ballots (open: ${open}) differ`);
    assert.ok(got.length === 1 && got[0].votes.length === 1, "the fixture's ballot and its vote did not come through");
  }
});

/** Run `fn` and report the JSON parsed while a pen connection was held (the driver's own parsing inside a statement is the statement's work). */
async function parsedWhileHeld(fn) {
  const held = [];
  let parses = 0;
  const real = JSON.parse;
  JSON.parse = function (text, ...r) {
    parses += 1;
    if (penHeld() && !/node_modules[\\/]pg[\\/]/.test(new Error().stack ?? "")) held.push(String(text).slice(0, 40));
    return real.call(this, text, ...r);
  };
  try { await fn(); } finally { JSON.parse = real; }
  return { held, parses };
}

test("3 · THE BOUNDARY: the page parses no JSON while a pen connection is held, nothing follows a release, and nothing is left out", async () => {
  for (const h of ["wright", "limen"]) {
    resetCheckouts();
    const { held, parses } = await parsedWhileHeld(() => page(h, TOWN));
    assert.ok(parses > 0, `${h}: the page parsed nothing: this test is not looking at what it claims to`);
    assert.deepEqual(held, [], `${h}: ${held.length} JSON text(s) parsed while the pen held a transaction (composition under a lease): ${JSON.stringify(held.slice(0, 3))}`);
    assert.equal(checkouts.afterRelease, 0, `${h}: a statement was issued on a pen connection after its release`);
    assert.equal(checkouts.open, 0, `${h}: a pen connection was still out when the page was done`);
    assert.equal(checkouts.peak, 1, `${h}: the page held ${checkouts.peak} pen connections at once (POS-1098: one at a time)`);
  }
});

test("3 · CONTROL: the same page composed INSIDE its lease parses under the held connection (the instrument sees the failure it guards)", async () => {
  const opts = { conversationsOffset: 0, slim: false, nowMs: NOW, standing: null, freshBase: { clone: TOWN, asOf: undefined, pendingRows: [] } };
  const { held, parses } = await parsedWhileHeld(() => tis.readTownIndex(async (c) => {
    const rows = await tis.doorstepPageRows(c, "wright", opts);
    return tis.doorstepPageFromRows(rows, "wright", opts, TOWN);
  }));
  assert.ok(parses > 0);
  assert.ok(held.length > 0, "the page composed under its lease parsed nothing while held: the boundary test above cannot fail");
});

test("4 · THE LEASES, in process: exactly the three loads (the town index's page, the posts, the ballots), from read-timing's own record", async () => {
  if (!TOWN) console.log(`# ${NO_TOWN}: the votes compose nothing, so two leases are expected, not three`);
  for (const h of ["wright", "limen", "postmaster"]) {
    const tm = newTiming();
    await runTiming(tm, () => page(h, TOWN));
    const leases = timingLine(tm, { door: "doorstep", status: 200 }).leases.main;
    // with the town clone the votes read the ballots (the third lease); without one, the votes compose nothing and take none
    const want = TOWN ? 3 : 2;
    assert.equal(leases.n, want, `${h}: the keyless doorstep took ${leases.n} pen leases; POS-1129 reads it in ${want} (it took 11)`);
    assert.equal(leases.failed, 0);
  }
});

// ── FAILURES INSIDE A LEASE, ON REAL POSTGRES (the review of db640416d) ──────────────────────────────────────────────────────────────────────────
//
// LAW (Jetto's rulings on that review, 2026-11-18): "a dead connection in lease A must not be worse than the base … the page answers 200 with only
// the failed block `unavailable`"; "only a death during the core read itself may answer what the base answered for a dead core"; and for each
// extra read, an SQL error and a dead connection, "the page is byte-identical to the base's separate-lease page under the same injection, and is
// never a 500". The base's page is `legacyIx` above: the same reads, each on its own lease.

/** The five extra reads of lease A, by a statement only that read issues. */
const EXTRA_READS = {
  standing: /FROM standing_acts WHERE handle = ANY/,
  copy: /FROM town_repo_log/,
  registry: /FROM town_meta WHERE key IN \('quest_registry'/,
  quest_standing: /FROM town_quest_standing WHERE handle/,
  quest_board: /SELECT id FROM town_pots/,
};
const injecting = async (match, mode, fn) => {
  inject = { match, mode, hits: 0 };
  try { const out = await settle(fn()); return { ...out, hits: inject.hits }; } finally { inject = null; }
};
const said = (r) => (r.e ? `threw ${r.e.name}: ${String(r.e.message).slice(0, 80)}` : "answered");

test("5 · LEASE A: an SQL error or a dead connection in any one extra read answers the page the separate leases answered, never a throw", async () => {
  const clean = JSON.stringify(await page("wright", TOWN));
  for (const mode of ["error", "kill"]) for (const [read, re] of Object.entries(EXTRA_READS)) {
    const match = (sql) => re.test(sql);
    const head = await injecting(match, mode, () => page("wright", TOWN));
    const base = await injecting(match, mode, () => page("wright", TOWN, true));
    const where = `${mode} in ${read}`;
    assert.ok(head.hits > 0 && base.hits > 0, `${where}: the injection never fired (head ${head.hits}, base ${base.hits}): this case tests nothing`);
    assert.ok(!base.e, `${where}: the separate leases themselves threw (${said(base)}): the oracle is not the degraded page it should be`);
    assert.ok(!head.e, `${where}: the one-lease page ${said(head)}, which a door answers as a failure; the separate leases answered the page`);
    assert.notEqual(JSON.stringify(head.v), clean, `${where}: the page is the clean one: the failure did not reach a block`);
    assert.equal(JSON.stringify(head.v), JSON.stringify(base.v), `${where}: the one-lease page differs from the separate leases' page under the same failure`);
    assert.equal(JSON.stringify(await page("wright", TOWN)), clean, `${where}: the clean page after this case differs: the pool kept a broken connection`);
  }
});

test("5 · LEASE A: a connection that dies BETWEEN two reads (at a SAVEPOINT) loses nothing: every read not yet made takes its own lease", async () => {
  const clean = JSON.stringify(await page("wright", TOWN));
  for (let k = 1; k <= Object.keys(EXTRA_READS).length; k++) {
    let n = 0;
    const match = (sql) => /^SAVEPOINT doorstep_part$/.test(sql) && ++n === k;   // the k-th part's SAVEPOINT, before its read begins
    const head = await injecting(match, "kill", () => page("wright", TOWN));
    assert.equal(head.hits, 1, `the connection was not killed at part ${k}'s SAVEPOINT: this case tests nothing`);
    assert.ok(!head.e, `killed before part ${k}: the one-lease page ${said(head)}; the separate leases (no shared transaction to die) answered the clean page`);
    assert.equal(JSON.stringify(head.v), clean, `killed before part ${k}: a read that never began was lost, where the separate leases lost nothing`);
  }
});

test("5 · LEASE A: a dead connection during the CORE answers what the separate leases answered (the page's own failure, as before)", async () => {
  const match = (sql) => /SELECT 1 FROM town_residents WHERE handle = \$1/.test(sql);
  const head = await injecting(match, "kill", () => page("wright", TOWN));
  const base = await injecting(match, "kill", () => page("wright", TOWN, true));
  assert.ok(head.hits > 0 && base.hits > 0, "the core's injection never fired");
  assert.ok(base.e, "the separate leases answered a page with no core: the oracle is not the failure it should be");
  assert.ok(head.e, `the one-lease page answered with its core dead: ${said(head)}`);
  assert.equal(head.e.name, base.e.name, `a dead core: the one-lease page ${said(head)}, the separate leases ${said(base)}`);
  assert.equal(head.e instanceof tis.TownIndexUnreachable, base.e instanceof tis.TownIndexUnreachable, "a dead core is a refusal on one road and the reader's error on the other");
});

test("6 · LEASE B on real Postgres: a class that fails (an SQL error, a dead connection) is said alone, and the classes after it are read", async () => {
  const { householdPosts } = await import("../src/household-posts.mjs");
  const { POST_CLASSES } = await import("../src/town-posts.mjs");
  const classes = Object.keys(POST_CLASSES);
  const failed = classes[0];
  assert.ok(classes.indexOf("bug") > 0, "the bug class is not read after the failed one: the fixture's later post cannot show the classes after it were read");
  const clean = await householdPosts("wright", { now: NOW, townClone: TOWN ?? join(OFFICE_ROOT, "no-town-clone") });
  for (const mode of ["error", "kill"]) {
    const match = (sql, params) => /FROM posts WHERE class = \$1/.test(sql) && params?.[0] === failed;
    const got = await injecting(match, mode, () => householdPosts("wright", { now: NOW, townClone: TOWN ?? join(OFFICE_ROOT, "no-town-clone") }));
    const old = [];
    inject = { match, mode, hits: 0 };
    try { for (const cls of classes) old.push(await OLD_classRows(cls, ["wright", "limen"], NOW)); } finally { inject = null; }
    assert.ok(got.hits > 0, `${mode}: the injection never fired`);
    assert.ok(!got.e, `${mode}: the posts ${said(got)}`);
    const gaps = (got.v.unavailable ?? []).filter((u) => /could not be read from the office's record/.test(u));
    assert.equal(gaps.length, 1, `${mode} in the ${failed} class: ${gaps.length} classes were said unreadable, not one: ${JSON.stringify(got.v.unavailable)}`);
    assert.ok(got.v.put_up.rows.some((r) => r.class === "bug"), `${mode} in the ${failed} class: the bug class, read after it, is missing: the classes after a failure were not read`);
    assert.equal(old.filter((x) => x.unavailable).length, 1, `${mode}: the old per-class reading lost ${old.filter((x) => x.unavailable).length} classes: the oracle is off`);
    assert.notDeepEqual(got.v.put_up, clean.put_up, `${mode}: the posts are the clean ones: the failure reached no class`);
  }
  // the connection dies BETWEEN two classes (at the second class's SAVEPOINT): no class was failing, so none may be lost
  let n = 0;
  const between = await injecting((sql) => /^SAVEPOINT posts_class$/.test(sql) && ++n === 2, "kill",
    () => householdPosts("wright", { now: NOW, townClone: TOWN ?? join(OFFICE_ROOT, "no-town-clone") }));
  assert.equal(between.hits, 1, "the connection was not killed at the second class's SAVEPOINT");
  assert.ok(!between.e, `killed between two classes: the posts ${said(between)}`);
  assert.equal(JSON.stringify(between.v), JSON.stringify(clean), "killed between two classes: a class that was never failing was lost");
});

// ── THE REAL DOORS: a spawned office, its access line's `timing` ────────────────────────────────────────────────────────────────────────────────────

let child, tmp, BASE;
const leaseLines = () => {
  if (!existsSync(tmp)) return [];
  return readdirSync(tmp).filter((f) => /^access-.*\.jsonl$/.test(f))
    .flatMap((f) => readFileSync(join(tmp, f), "utf8").split("\n").filter(Boolean))
    .map((l) => { try { return JSON.parse(l); } catch { return null; } })
    .filter((l) => l?.timing?.door === "doorstep" || l?.timing?.door === "doorsteps");
};
/** Wait on the access line itself (it is written when the response finishes), never on a clock; the bound only fails the test. */
async function lineFor(door, count) {
  const until = Date.now() + 20_000;
  for (;;) {
    const lines = leaseLines().filter((l) => l.timing.door === door);
    if (lines.length >= count) return lines[count - 1];
    if (Date.now() > until) throw new Error(`no ${door} access line #${count} with timing: the door did not record its leases`);
    await new Promise((r) => setTimeout(r, 25));
  }
}
const leasesOf = (line) => (line.timing.leases.main?.n ?? 0) + (line.timing.leases.worker?.n ?? 0);

test("4 · THE LEASES at the real doors: GET /doorstep/<h> and GET /doorsteps take at most 3 per resident, read from the access line", async (t) => {
  tmp = mkdtempSync(join(tmpdir(), "postmark-pos1129-"));
  t.after(async () => {
    if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
    rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  const box = await freePort();
  ({ child } = await bootOnFreePort((p) => spawn(process.execPath, [join(OFFICE_ROOT, "src", "server.mjs"), "--port", String(p)], {
    env: { ...process.env, ...IX.env, WORLD_GRAPH_NONE: "1", TOWN_CLONE: TOWN ?? join(tmp, "no-clone-here"), OFFICE_BOX_PORT: String(box), OFFICE_ACCESS_LOG_DIR: tmp },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  BASE = `http://127.0.0.1:${box}`;

  const one = await fetch(`${BASE}/doorstep/wright`);
  assert.equal(one.status, 200, "the single door answered");
  await one.text();
  const single = await lineFor("doorstep", 1);
  assert.equal(single.timing.bundle?.n, 1, "the single door's line names the one doorstep it composed");
  assert.ok(leasesOf(single) >= 1, "the single door took no pen lease: the line is not measuring this read");
  assert.ok(leasesOf(single) <= 3, `GET /doorstep/wright took ${leasesOf(single)} pen leases; POS-1129: at most 3 (it took 11)`);

  const handles = ["wright", "limen", "postmaster"];
  const bulk = await fetch(`${BASE}/doorsteps?handles=${handles.join(",")}`);
  assert.equal(bulk.status, 200, "the bulk door answered");
  assert.equal((await bulk.json()).doorsteps.filter((r) => r.doorstep).length, handles.length, "every named resident's doorstep was composed");
  const many = await lineFor("doorsteps", 1);
  assert.equal(many.timing.bundle?.n, handles.length, "the bulk line names one doorstep per resident");
  assert.ok(leasesOf(many) <= 3 * handles.length,
    `GET /doorsteps (${handles.length} residents) took ${leasesOf(many)} pen leases; POS-1129: at most ${3 * handles.length} (it took ${11 * handles.length})`);
  assert.equal(many.timing.leases.worker?.failed ?? many.timing.leases.main?.failed ?? 0, 0, "no acquisition failed");
});
