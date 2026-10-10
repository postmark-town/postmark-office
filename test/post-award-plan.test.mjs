// post-award-plan.test.mjs — the awards a hand recorded on idea posts, and the reviewed pass that pays them (POS-290, lane C1).
//
//   node --test test/post-award-plan.test.mjs
//   AWARD_MINT_TOWN=<town tree carrying --award-mint> node --test test/post-award-plan.test.mjs
//
// The gate, in the brief's order (POS-290, "Brief, lane C1"):
//
//   1. two award acts in the store and an empty ledger: the plan shows two owed
//      rows; --apply writes two lines, the town's verifier passes, the lines are
//      in the store's stamp_lines and on the town's remote; a second --apply
//      writes nothing;
//   2. a meep recipient's row reads 0 and `meep`, and is never written;
//   3. with the tick's context set (OFFICE_KEEP), the tool refuses, exits non-zero
//      and writes nothing;
//   4. a plan whose printed text was edited between print and parse refuses the
//      whole apply;
//   5. the written line's amount is the act's `stamps`, byte for byte.
//   And: an award over 200, a stage-named label and a `by:` that is not a hand
//   are refused before writing, each with the town's own sentence.
//
// 1, 2, 4 and 5 run the TOWN'S OWN verb, so they need a town whose stamp-mint.mjs
// carries --award-mint (town main 834da240b and later). The office's pinned
// town-clone gains it when its pin moves past that merge; until then they SKIP
// and say why in their own name. Point AWARD_MINT_TOWN at a town tree that
// carries it to run them.
//
// ⚑ THE STORE IS REAL: a database in this tree's own Postgres (the embedded
// store helper). The acts are written by the real doors (postAtTown, awardAtTown
// with IDEA_POSTS=1), read back by the pass's own store query, and the landed
// lines are read back from stamp_lines.
//
// THE FLIPS (NOTES.md in the lane folder holds their red lines): drop the
// already-paid read and 1 goes red; drop the meep check and 2 goes red; drop the
// OFFICE_KEEP guard and 3 goes red; drop the parse-back and 4 goes red.

import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { copyTownTools } from "./helpers/town-tools.mjs";
import { startStore } from "./helpers/embedded-store.mjs";
import { OFFICE_ROOT } from "./fixture-paths.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";

const { planAwards, renderPlan, parseAwardPlan, planDiffers, townEngine, storeFacts, awardMintArgv, lockedArgv, main } =
  await import("../tools/post-award-plan.mjs");
const { verifyStampLinesVia } = await import("../src/stamp-lines.mjs");

const TOOL = join(OFFICE_ROOT, "tools", "post-award-plan.mjs");
const TOWN_SRC = process.env.AWARD_MINT_TOWN ?? join(OFFICE_ROOT, "town-clone");
const TOWN_HAS_VERB = existsSync(join(TOWN_SRC, "tools", "stamp-mint.mjs"))
  && readFileSync(join(TOWN_SRC, "tools", "stamp-mint.mjs"), "utf8").includes("'--award-mint'");
const NO_VERB = TOWN_HAS_VERB ? false : `the town at ${TOWN_SRC} has no --award-mint yet (town main 834da240b); set AWARD_MINT_TOWN to a town tree that carries it`;

const NOW = Date.now();
const DATE = "2026-10-09";
const WRIGHT = { household: "starforge", handles: new Set(["wright"]) };
const KEEMIN = { household: "darko", handles: new Set(["keemin"]) };
const ERRANT = { household: "errant", handles: new Set(["errant"]) };
const ROLL = new Set(["wright", "keemin", "errant", "finn", "ada", "ferry", "nobody"]);
const ROOMS = ["errant", "finn", "ada", "ferry"];   // "nobody" is on the office's roll and has no room in the town
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

// ── a founded synthetic town, a git repo whose origin is a bare repo beside it ──

/** `meep`: a handle the town's ledger declares a meep (the --meep-law line). */
function syntheticTown({ meep = null } = {}) {
  const repo = tempDir("award-town-");
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN_SRC, repo);
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(Object.fromEntries(ROOMS.map((h, i) => [h, { id: 10 + i }]))));
  for (const h of ROOMS) {
    mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · a-1 · finn → ada · thread: new\n");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  const keyFile = join(`${repo}-key.pem`);
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  const mint = (...a) => execFileSync(process.execPath, [join(repo, "tools", "stamp-mint.mjs"), ...a, "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  mint("--append");
  if (meep) mint("--declare-rules", "stamps-v2", "--meeps", meep, "--date", "2026-06-13");
  git(repo, "init", "-q", "-b", "main"); git(repo, "config", "core.autocrlf", "false");
  git(repo, "add", "-A"); git(repo, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "founded");
  const origin = `${repo}.git`;
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", origin]);
  git(repo, "remote", "add", "origin", origin); git(repo, "push", "-q", "-u", "origin", "main");
  return { repo, keyFile, origin, cleanup: () => { for (const p of [repo, origin, keyFile]) rmSync(p, { recursive: true, force: true }); } };
}
const ledgerOf = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const awardLinesOf = (repo) => ledgerOf(repo).split(/\r?\n/).filter((l) => l.includes("for: post:"));
const verifyTown = (repo) => spawnSync(process.execPath, [join(repo, "tools", "stamp-verify.mjs"), "--repo", repo], { encoding: "utf8" });

// ── the store: one database in this tree's own Postgres, emptied per test ────
// (The office's pen keeps the pool it first dialled, so a test cannot move it to
// a second database; each test starts from empty acts, posts and stamp_lines.)

let store, office, owner;
async function freshStore() {
  if (!store) {
    store = await startStore({ db: "post_award_plan_test" });
    office = await store.connect("office_api");
    owner = await store.connect("world2_owner");
    Object.assign(process.env, { WORLD2_PG: "1", WORLD2_PG_URL: store.url("office_api"), IDEA_POSTS: "1", STAMP_LINES: "store",
      TOWN_PUSH: "1", BOT_NAME: "postmark-office[bot]", BOT_EMAIL: "office@postmark.invalid" });
  }
  delete process.env.OFFICE_KEEP;
  await owner.query("TRUNCATE acts, posts, responses, stamp_lines CASCADE");
  return office;
}
after(async () => { for (const c of [office, owner]) await c?.end().catch(() => {}); await store?.stop?.(); });

let doors;
before(async () => { if (!NO_VERB) doors = { ...(await import("../src/events-store.mjs")), ...(await import("../src/idea-store.mjs")) }; });

/** An idea posted by errant, and the awards recorded on it by the real door. The door's meep law is empty on purpose (6, NOTES). */
async function ideaWithAwards(awards) {
  const env = process.env;
  const r = await doors.postAtTown({ class: "idea", title: "A lantern on the quay", body: "Hang a lantern where the ferry lands." }, ERRANT, { now: NOW, env, roll: ROLL });
  const id = r.post.id;
  for (const [key, a] of awards) await doors.awardAtTown({ post: id, ...a }, key, { now: NOW, env, roll: ROLL, isMeep: () => false });
  return id;
}
const say = () => { const out = []; return { out, log: (s) => out.push(s), err: (s) => out.push(`ERR ${s}`), text: () => out.join("\n") }; };
const storeHeld = async (office) => Number((await office.query("SELECT count(*) n FROM stamp_lines")).rows[0].n);

// ── 1 ───────────────────────────────────────────────────────────────────────

test("1 · two award acts, an empty ledger: two owed rows; --apply writes two lines that verify, land on the remote and in stamp_lines; a second --apply writes nothing", { skip: NO_VERB }, async () => {
  const office = await freshStore();
  const id = await ideaWithAwards([[WRIGHT, { to: "finn", stamps: 25, label: "the-lantern", note: "Built it." }], [KEEMIN, { to: "ada", stamps: 7, label: "the-hook" }]]);
  const town = syntheticTown();
  try {
    const plan = say();
    assert.equal(await main(["--town", town.repo, "--date", DATE], plan), 0, plan.text());
    assert.match(plan.text(), /^idea award plan — 2 award\(s\) recorded, 0 already paid, 0 pay nothing, 2 owed \(32 stamps\), dated 2026-10-09$/m);
    assert.match(plan.text(), new RegExp(`^ {2}${id}/the-lantern · finn · 25 · by wright · owed · act \\d+ on \\d{4}-\\d{2}-\\d{2}$`, "m"));
    assert.match(plan.text(), new RegExp(`^ {2}${id}/the-hook · ada · 7 · by keemin · owed · act \\d+ on \\d{4}-\\d{2}-\\d{2}$`, "m"));
    assert.match(plan.text(), /the plan only — nothing written/);
    assert.equal(awardLinesOf(town.repo).length, 0, "the plan wrote a line");

    const argv = ["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE];
    const first = say();
    assert.equal(await main(argv, first), 0, first.text());
    assert.deepEqual(awardLinesOf(town.repo).map((l) => l.replace(/ · sig: \S+$/, "")), [
      `- ${DATE} · MINT → finn · 25 · for: post:${id}/the-lantern · by: wright`,
      `- ${DATE} · MINT → ada · 7 · for: post:${id}/the-hook · by: keemin`,
    ]);
    const v = verifyTown(town.repo);
    assert.equal(v.status, 0, v.stdout + v.stderr);
    assert.equal(git(town.repo, "status", "--porcelain"), "", "the pass left the clone dirty");
    git(town.repo, "fetch", "-q", "origin", "main");
    assert.equal(git(town.repo, "rev-parse", "HEAD"), git(town.repo, "rev-parse", "origin/main"), "the award commit is not on the remote");
    const inStore = await verifyStampLinesVia(office, town.repo);
    assert.deepEqual(inStore.problems, [], "the store's stamp_lines is not the export");
    assert.equal(inStore.held, ledgerOf(town.repo).split(/\r?\n/).filter((l) => /^- \d{4}-/.test(l)).length);
    const held = await storeHeld(office);

    const second = say();
    assert.equal(await main(argv, second), 0, second.text());
    assert.match(second.text(), /2 already paid, 0 pay nothing, 0 owed \(0 stamps\)/);
    assert.match(second.text(), new RegExp(`ALREADY PAID\\n {2}${id}/the-lantern · finn · 25 · by wright · already paid`));
    assert.match(second.text(), /nothing owed/);
    assert.equal(awardLinesOf(town.repo).length, 2, "a second --apply wrote a line");
    assert.equal(await storeHeld(office), held, "a second --apply recorded a row");
  } finally { town.cleanup(); }
});

// ── 2 ───────────────────────────────────────────────────────────────────────

test("2 · a meep recipient's row reads 0 and meep, and is never written; the others still pay", { skip: NO_VERB }, async () => {
  await freshStore();
  const id = await ideaWithAwards([[WRIGHT, { to: "ferry", stamps: 12, label: "the-crossing" }], [WRIGHT, { to: "finn", stamps: 3, label: "the-wick" }]]);
  const town = syntheticTown({ meep: "ferry" });
  try {
    const out = say();
    assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE], out), 0, out.text());
    assert.match(out.text(), /1 pay nothing, 1 owed \(3 stamps\)/);
    assert.match(out.text(), new RegExp(`PAYS NOTHING\\n {2}${id}/the-crossing · ferry · 0 · by wright · meep: a meep never receives stamps · act \\d+`));
    assert.deepEqual(awardLinesOf(town.repo).map((l) => l.replace(/ · sig: \S+$/, "")), [`- ${DATE} · MINT → finn · 3 · for: post:${id}/the-wick · by: wright`]);
    assert.ok(!ledgerOf(town.repo).includes("MINT → ferry"), "a meep was paid");
    const v = verifyTown(town.repo);
    assert.equal(v.status, 0, v.stdout + v.stderr);
  } finally { town.cleanup(); }
});

// ── 3 ───────────────────────────────────────────────────────────────────────

test("3 · on the tick (OFFICE_KEEP set) the tool refuses, exits non-zero and writes nothing — in-process and as a process", async () => {
  const town = tempDir("award-tick-");
  try {
    writeFileSync(join(town, "ledger-sentinel"), "x");
    const out = say();
    const code = await main(["--town", town, "--apply", "--key", join(town, "ledger-sentinel"), "--date", DATE],
      { ...out, env: { ...process.env, OFFICE_KEEP: "1" }, facts: { acts: [] }, spawn: () => { throw new Error("the tick ran the verb"); } });
    assert.equal(code, 2, out.text());
    assert.match(out.text(), /^ERR post-award-plan: refused — OFFICE_KEEP is set, so this is the keeping tick/m);
    const child = spawnSync(process.execPath, [TOOL, "--town", town], { encoding: "utf8", env: { ...process.env, OFFICE_KEEP: "1", WORLD2_PG_URL: "" } });
    assert.equal(child.status, 2, child.stdout + child.stderr);
    assert.match(child.stderr, /never runs on the tick/);
    assert.equal(child.stdout, "", "the tick's run printed a plan");
  } finally { rmSync(town, { recursive: true, force: true }); }
});

test("3 · the tick says it is the tick: office-keep.sh exports OFFICE_KEEP=1 before its first step, and never runs the pass", () => {
  const sh = readFileSync(join(OFFICE_ROOT, "deploy", "office-keep.sh"), "utf8");
  const exported = sh.indexOf("\nexport OFFICE_KEEP=1\n");
  assert.ok(exported !== -1, "office-keep.sh does not export OFFICE_KEEP=1");
  assert.ok(exported < sh.indexOf("flock -w 300 9"), "the marker is exported after the tick's first locked step");
  assert.doesNotMatch(sh, /node\s+\S*post-award-plan/, "the award pass is wired into the tick");
});

// ── 4 ───────────────────────────────────────────────────────────────────────

test("4 · a plan whose printed text was edited between print and parse refuses the whole apply: nothing written, nothing recorded", { skip: NO_VERB }, async () => {
  const office = await freshStore();
  const id = await ideaWithAwards([[WRIGHT, { to: "finn", stamps: 25, label: "the-lantern" }], [KEEMIN, { to: "ada", stamps: 7, label: "the-hook" }]]);
  const town = syntheticTown();
  try {
    const before = ledgerOf(town.repo);
    const head = git(town.repo, "rev-parse", "HEAD");
    const edits = [
      // the amount alone: the header's stamps no longer add up
      [(t) => t.replace(" · finn · 25 · ", " · finn · 26 · "), /the plan says 32 stamps owed and its rows add to 33/],
      // the amount and the header together: the parse is whole, and the rows are not the plan's
      [(t) => t.replace(" · finn · 25 · ", " · finn · 26 · ").replace("(32 stamps)", "(33 stamps)"), /owed row 1 \(act \d+\), n: printed 26, planned 25/],
      // a recipient swapped
      [(t) => t.replace(" · ada · 7 · ", " · errant · 7 · "), /owed row 2 \(act \d+\), handle: printed "errant", planned "ada"/],
      // the date the lines carry
      [(t) => t.replace("dated 2026-10-09", "dated 2026-10-10"), /the lines' date: printed 2026-10-10, planned 2026-10-09/],
    ];
    for (const [printed, why] of edits) {
      const out = say();
      assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE], { ...out, printed }), 1, out.text());
      assert.match(out.text(), why);
      assert.equal(ledgerOf(town.repo), before, "a refused apply changed the ledger");
      assert.equal(git(town.repo, "rev-parse", "HEAD"), head, "a refused apply committed");
      assert.equal(await storeHeld(office), 0, "a refused apply recorded a row");
    }
    assert.ok(id);
  } finally { town.cleanup(); }
});

// ── 5 ───────────────────────────────────────────────────────────────────────

test("5 · the amount is the act's: each written line's n is the act's stamps, byte for byte, and the verb was handed exactly that", { skip: NO_VERB }, async () => {
  await freshStore();
  const amounts = [1, 200, 37];
  await ideaWithAwards(amounts.map((stamps, i) => [WRIGHT, { to: "finn", stamps, label: `piece-${i}` }]));
  const facts = await storeFacts();
  const town = syntheticTown();
  try {
    const handed = [];
    const spawn = (cwd, argv) => { if (argv.includes("--award-mint")) handed.push(argv[argv.indexOf("--amount") + 1]); return spawnSync(process.execPath, argv, { cwd, encoding: "utf8" }); };
    const out = say();
    assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE], { ...out, facts, spawn }), 0, out.text());
    const acts = facts.acts.map((a) => (typeof a.payload === "string" ? JSON.parse(a.payload) : a.payload));
    assert.deepEqual(handed, acts.map((p) => String(p.stamps)));
    assert.deepEqual(awardLinesOf(town.repo).map((l) => / · MINT → finn · (\d+) · for: post:\S+\/(piece-\d)/.exec(l).slice(1)),
      acts.map((p) => [String(p.stamps), p.label]));
  } finally { town.cleanup(); }
});

// ── whole or nothing ────────────────────────────────────────────────────────

test("whole or nothing: a verb that refuses the second row, or a verifier that goes red, puts the first line back; a clone whose ledger is already dirty is refused before anything", { skip: NO_VERB }, async () => {
  const office = await freshStore();
  await ideaWithAwards([[WRIGHT, { to: "finn", stamps: 25, label: "the-lantern" }], [KEEMIN, { to: "ada", stamps: 7, label: "the-hook" }]]);
  const town = syntheticTown();
  try {
    const before = ledgerOf(town.repo);
    const head = git(town.repo, "rev-parse", "HEAD");
    const real = (cwd, argv) => spawnSync(process.execPath, argv, { cwd, encoding: "utf8" });
    const cases = [
      [(cwd, argv) => (argv.includes("ada") ? { status: 1, stderr: "FATAL: refused for the test\n" } : real(cwd, argv)), /REFUSED post:\S+\/the-hook → ada — FATAL: refused for the test\. The whole apply is put back/],
      [(cwd, argv) => (argv[0].endsWith("stamp-verify.mjs") ? { status: 1, stdout: "LAWFUL fails — for the test\n" } : real(cwd, argv)), /stamp-verify is red after the award lines — LAWFUL fails — for the test/],
    ];
    for (const [spawn, why] of cases) {
      const out = say();
      assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE], { ...out, spawn }), 1, out.text());
      assert.match(out.text(), why);
      assert.equal(ledgerOf(town.repo), before, "the first line stayed");
      assert.equal(git(town.repo, "rev-parse", "HEAD"), head);
      assert.equal(git(town.repo, "status", "--porcelain"), "");
      assert.equal(await storeHeld(office), 0);
    }
    writeFileSync(join(town.repo, "WHITE_PAGES", "stamp-ledger.md"), `${before}- 2026-10-09 · an uncommitted line\n`);
    const out = say();
    assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE], { ...out, spawn: () => { throw new Error("ran a verb on a dirty ledger"); } }), 1);
    assert.match(out.text(), /has changes nobody committed .* Nothing written/);
  } finally { town.cleanup(); }
});

// ── refused before writing, with the town's own sentence ────────────────────

test("an award over 200, a stage-named label and a by: that is not a hand are refused before writing, each with the town's sentence; a second act on one label is refused too", { skip: NO_VERB }, async () => {
  const town = syntheticTown();
  try {
    const engine = await townEngine(town.repo);
    const act = (id, to, stamps, label, hand = "wright") => ({ id, actor: hand, action: "award", object: "errant/a-lamp", at: new Date(NOW).toISOString(),
      payload: { post: "errant/a-lamp", to, stamps, label, hand } });
    const acts = [act(1, "finn", 201, "too-much"), act(2, "finn", 5, "fixed"), act(3, "finn", 5, "by-hand", "architect"),
      act(4, "nobody", 5, "no-room"), act(5, "finn", 4, "fine"), act(6, "ada", 4, "fine")];
    const rows = planAwards({ acts, ...engine, date: DATE });
    assert.deepEqual(rows.map((r) => [r.act, r.n, r.owed]), [[1, 0, false], [2, 0, false], [3, 0, false], [4, 0, false], [5, 4, true], [6, 0, false]]);
    assert.match(rows[0].why, /^refused: award: 201 is over the most one award may pay \(200\)$/);
    assert.match(rows[1].why, /^refused: award: "fixed" is a bug stage's name/);
    assert.match(rows[2].why, /^refused: award: by: must be one of the hands/);
    assert.match(rows[3].why, /^unresolved: nobody has no room in the town; an award needs a resident to receive it$/);
    assert.match(rows[5].why, /^refused: post:errant\/a-lamp\/fine is already awarded by act 5; one line per post and label/);

    const before = ledgerOf(town.repo);
    const out = say();
    const verbs = [];
    const spawn = (cwd, argv) => { verbs.push(argv[1]); return spawnSync(process.execPath, argv, { cwd, encoding: "utf8" }); };
    assert.equal(await main(["--town", town.repo, "--apply", "--key", town.keyFile, "--date", DATE],
      { ...out, facts: { acts: acts.filter((a) => a.id !== 5 && a.id !== 6) }, spawn, env: { ...process.env, STAMP_LINES: "", TOWN_PUSH: "" } }), 0, out.text());
    assert.match(out.text(), /4 pay nothing, 0 owed \(0 stamps\)/);
    assert.deepEqual(verbs, [], "a refused row reached the town's verb");
    assert.equal(ledgerOf(town.repo), before);
  } finally { town.cleanup(); }
});

// ── the pure parts ──────────────────────────────────────────────────────────

const fakeEngine = { isMeep: () => false, paid: new Map(), hasRoom: () => true, lineOf: () => "" };
const pureActs = [
  { id: 7, actor: "wright", action: "award", object: "errant/x", at: "2026-10-09T15:00:00Z", payload: { post: "errant/x", to: "finn", stamps: 25, label: "the-lantern", hand: "wright" } },
  { id: 8, actor: "keemin", action: "award", object: "errant/x", at: "2026-10-09T15:00:00Z", payload: JSON.stringify({ post: "errant/x", to: "ada", stamps: 7, label: "the-hook", hand: "keemin" }) },
];

test("the printed plan parses back to the plan's own rows; a count, a sum, a header or a row it cannot read refuses", () => {
  const rows = planAwards({ acts: pureActs, ...fakeEngine, date: DATE, tz: "America/New_York" });
  const text = renderPlan(rows, { date: DATE });
  const parsed = parseAwardPlan(text);
  assert.equal(planDiffers(parsed, rows, DATE), null);
  assert.deepEqual(parsed.owed.map((r) => [r.post, r.label, r.handle, r.n, r.hand, r.act]),
    [["errant/x", "the-lantern", "finn", 25, "wright", 7], ["errant/x", "the-hook", "ada", 7, "keemin", 8]]);
  assert.throws(() => parseAwardPlan(text.replace("2 owed (32 stamps)", "3 owed (32 stamps)")), /the plan says 3 owed and this pass parsed 2/);
  assert.throws(() => parseAwardPlan(text.replace("idea award plan —", "award plan —")), /printed no header/);
  assert.throws(() => parseAwardPlan(text.replace(" · finn · 25 · by wright · owed · ", " · finn · 25 · by wright · due · ")), /unreadable owed row/);
});

test("a ledger line that already pays the (post, label) is already paid, and says so when it pays someone or something else", () => {
  const paid = new Map([["errant/x/the-lantern", { handle: "finn", n: 25, date: "2026-10-08" }], ["errant/x/the-hook", { handle: "finn", n: 9, date: "2026-10-08" }]]);
  const rows = planAwards({ acts: pureActs, ...fakeEngine, paid, date: DATE });
  assert.deepEqual(rows.map((r) => [r.why, r.owed, r.n]), [
    ["already paid", false, 25],
    ["already paid: the ledger pays post:errant/x/the-hook 9 to finn on 2026-10-08, not this act's 7 to ada", false, 7],
  ]);
  assert.match(renderPlan(rows, { date: DATE }), /2 already paid, 0 pay nothing, 0 owed \(0 stamps\)/);
});

test("the verb is the town's --award-mint, handed the act's own hand, amount and label; on linux the apply runs under the town's exclusive flock", () => {
  const r = { post: "errant/x", label: "the-hook", handle: "ada", n: 7, hand: "keemin" };
  const argv = awardMintArgv("/town", r, { date: DATE, keyPath: "/k.pem" });
  assert.deepEqual(argv.slice(1), ["--award-mint", "ada", "--post", "errant/x", "--label", "the-hook", "--amount", "7", "--by", "keemin",
    "--date", DATE, "--key", "/k.pem", "--repo", "/town"]);
  assert.match(argv[0].replace(/\\/g, "/"), /\/town\/tools\/stamp-mint\.mjs$/);
  const [file, args] = lockedArgv("/srv/postmark-office/tools/post-award-plan.mjs", ["--town", "/t", "--apply"], "/srv/postmark-office/town.lock");
  assert.equal(file, "/usr/bin/flock");
  assert.deepEqual(args, ["-w", "300", "/srv/postmark-office/town.lock", process.execPath, "/srv/postmark-office/tools/post-award-plan.mjs", "--town", "/t", "--apply"],
    "exclusive (no -s), on the lock the tick takes");
});
