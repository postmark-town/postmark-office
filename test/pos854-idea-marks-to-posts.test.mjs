// pos854-idea-marks-to-posts.test.mjs — the Think Tank's idea marks become their authors' idea posts (POS-854).
//
//   node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs --test test/pos854-idea-marks-to-posts.test.mjs
//
// THE RULING (Darko, 2026-11-16 22:44 EST, POS-844's sitting): "Oh, yeah, no consent chase. And the idea, stakes
// carry over, exactly, like you said." Each standing resident idea mark becomes its author's own idea post, its
// provenance kept, the author told; the escrow on the mark moves to the post with each staker's position intact.
//
// WHAT THESE PIN, over a scratch town (a real signed ledger, the town's own grammar and verifier) and a scratch
// world (a real git repo): the stake on a post is a ledger line, clipped like a mark's; the carry is conservative
// (nothing minted or lost, every handle's liquid stamps equal, the staked total equal) and is refused when its
// positions are not the ones a reviewer read; the plan keeps provenance, never cuts a body, leaves what it cannot
// carry whole standing, and finds its own posts on a rerun; the tool's dry run writes nothing, and its apply
// writes only the plan whose digest it was given.
//
// Synthetic handles, marks and posts throughout.

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { townClone, NO_TOWN } from "./fixture-paths.mjs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { tempDir } from "./helpers/temp-dir.mjs";
import { pinTown } from "./helpers/pinned-town.mjs";
import { importTownTool } from "../src/town-tool.mjs";

const TOWN = townClone();
const skip = NO_TOWN && !TOWN ? "no town clone here" : false;
const git = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const ident = ["-c", "user.name=fixture", "-c", "user.email=fixture@test.invalid"];

// ── the scratch town: a signed ledger the town's own tools wrote ─────────────
const ANA = "sbx-ana", BO = "sbx-bo", CY = "sbx-cy", MEEP = "sbx-meep";
const DAY = "2026-11-10";
let town, pem, keyFile, M;
const ledgerPath = () => join(town, "WHITE_PAGES", "stamp-ledger.md");
const entries = () => M.parseStampLedger(readFileSync(ledgerPath(), "utf8"));

if (!skip) {
  town = tempDir("pos854-town-");
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });
  copyTownTools(TOWN, town);
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  writeFileSync(join(town, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  pem = privateKey.export({ type: "pkcs8", format: "pem" });
  keyFile = join(tempDir("pos854-key-"), "stamp-key.pem");
  writeFileSync(keyFile, pem);
  execFileSync("git", ["init", "-q", "-b", "main", town]);
  process.env.TOWN_PINS_DIR = pinTown(town);   // the fixture town's own files, pinned to themselves (it has its own pubkey), as a box clone is
  M = await importTownTool(town, "stamp-mint.mjs");
}

/** A fresh ledger: gifts, then the stakes the carry will move. Rewrites the file whole (scratch only). */
function seed({ extra = [] } = {}) {
  writeFileSync(ledgerPath(), "");
  const gift = (handle, n) => M.giftLine({ date: "2026-09-01", handle, n, slug: `seed-${handle}`, by: "the-town" });
  const lines = [M.rulesLine("2026-06-12"), gift(ANA, 100), gift(BO, 100), gift(CY, 100),
    M.worldStakeLine({ date: DAY, handle: ANA, mark: "sbx-ana/m1", n: 3, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: BO, mark: "sbx-ana/m1", n: 2, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: ANA, mark: "sbx-ana/m2", n: 1, via: "api" }),
    M.worldStakeLine({ date: DAY, handle: CY, mark: "sbx-cy/other", n: 7, via: "api" }), ...extra];
  M.appendSigned(town, lines, pem);
  git(town, "add", "-A"); git(town, ...ident, "commit", "-q", "--allow-empty", "-m", "fixture ledger");
}
const bal = (h) => M.foldBalances(entries()).get(h) ?? 0;
const verify = () => spawnSync(process.execPath, [join(town, "tools", "stamp-verify.mjs"), "--repo", town], { encoding: "utf8" });

const ENG = await import("../src/post-stake-engine.mjs");

// ── the stake on a post, at the ledger ───────────────────────────────────────

test("a stake on a post is a ledger line, clipped to the staker's balance, and its position and escrow are the ledger's", { skip }, () => {
  seed();
  const before = bal(ANA);
  const r = ENG.postStakeApply(M, town, { handle: ANA, post: "sbx-ana/p1", n: 5, date: DAY }, pem);
  assert.deepEqual([r.applied, r.clipped, r.post_escrow_after, r.position_after], [5, false, 5, 5]);
  assert.equal(bal(ANA), before - 5, "the stamps left the staker's liquid balance");
  const state = ENG.postStakeState(M, entries());
  assert.deepEqual(state.positions.get("sbx-ana/p1|sbx-ana"), { n: 5, side: "for" });
  assert.equal(state.escrow.get("sbx-ana/p1"), 5);
  // the clip: ask for more than is held
  const big = ENG.postStakeApply(M, town, { handle: CY, post: "sbx-ana/p1", n: 5000, date: DAY }, pem);
  assert.deepEqual([big.requested, big.applied, big.clipped], [5000, bal(CY) + big.applied, true], "a stake past the balance is clipped to it, and says so");
  assert.equal(bal(CY), 0);
  const none = ENG.postStakeApply(M, town, { handle: CY, post: "sbx-ana/p1", n: 1, date: DAY }, pem);
  assert.equal(none.applied, 0); assert.match(none.reason, /no stamps free/, "an empty purse moves nothing and says why");
  assert.equal(verify().status, 0, `the town's verifier reads the ledger lawful: ${verify().stdout}${verify().stderr}`);
});

test("an unstake clips to the staker's OWN position, never another resident's", { skip }, () => {
  seed();
  ENG.postStakeApply(M, town, { handle: ANA, post: "sbx-ana/p1", n: 3, date: DAY }, pem);
  ENG.postStakeApply(M, town, { handle: BO, post: "sbx-ana/p1", n: 4, date: DAY }, pem);
  const r = ENG.postUnstakeApply(M, town, { handle: ANA, post: "sbx-ana/p1", n: 99, date: DAY }, pem);
  assert.deepEqual([r.applied, r.clipped, r.position_after], [3, true, 0], "ana takes out what she put in, no more");
  const state = ENG.postStakeState(M, entries());
  assert.equal(state.positions.get("sbx-ana/p1|sbx-bo").n, 4, "bo's stake stands: an unstake is the staker's own act");
  assert.equal(state.escrow.get("sbx-ana/p1"), 4);
  const stranger = ENG.postUnstakeApply(M, town, { handle: CY, post: "sbx-ana/p1", n: 1, date: DAY }, pem);
  assert.equal(stranger.applied, 0); assert.match(stranger.reason, /no stamps staked on/);
});

test("a meep's stake is refused, and a position stays on the side it was taken", { skip }, () => {
  seed({ extra: [M.rulesV2Line("2026-10-01", [MEEP])] });
  assert.throws(() => ENG.postStakeApply(M, town, { handle: MEEP, post: "sbx-ana/p1", n: 1, date: DAY }, pem), (e) => e.code === 403 && /meep/.test(e.defect));
  // a position taken against cannot be added to for: the door never offers it, the engine still refuses
  M.appendSigned(town, [M.postStakeLine({ date: DAY, handle: BO, post: "sbx-ana/p1", n: 1, side: "against", via: "api" })], pem);
  assert.throws(() => ENG.postStakeApply(M, town, { handle: BO, post: "sbx-ana/p1", n: 1, date: DAY }, pem), (e) => e.code === 409 && /one side/.test(e.defect));
});

// ── the carry: nothing minted, nothing lost, nothing moved that was not read ─

test("THE CARRY moves each staker's escrow from the mark to the post, whole: balances equal, staked total equal, the town's verifier lawful", { skip }, () => {
  seed();
  const before = M.foldBalances(entries());
  const r = ENG.carryApply(M, town, [{ mark: "sbx-ana/m1", post: "sbx-ana/p1" }, { mark: "sbx-ana/m2", post: "sbx-ana/p2" }],
    { date: DAY, expect: new Map([["sbx-ana/m1|sbx-ana", 3], ["sbx-ana/m1|sbx-bo", 2], ["sbx-ana/m2|sbx-ana", 1]]) }, pem);
  assert.equal(r.appended, 6, "a world-unstake and a post-stake for each of three positions");
  assert.deepEqual(r.moves.map((m) => [m.mark, m.handle, m.n]), [["sbx-ana/m1", "sbx-ana", 3], ["sbx-ana/m1", "sbx-bo", 2], ["sbx-ana/m2", "sbx-ana", 1]]);
  const after = M.foldBalances(entries());
  for (const h of [ANA, BO, CY]) assert.equal(after.get(h), before.get(h), `${h}'s liquid stamps are what they were`);
  assert.equal(after.get("MINT"), before.get("MINT"), "nothing minted");
  assert.equal(after.get("BURN") ?? 0, before.get("BURN") ?? 0, "nothing burned");
  const marks = M.foldWorldMarkPositions(entries());
  assert.equal(marks.get("sbx-ana/m1|sbx-ana"), undefined, "the mark holds no stake of ana's now");
  assert.equal(marks.get("sbx-cy/other|sbx-cy"), 7, "a stake on a mark nobody converted is untouched");
  const posts = ENG.postStakeState(M, entries());
  assert.deepEqual([...posts.positions].map(([k, v]) => [k, v.n, v.side]).sort(),
    [["sbx-ana/p1|sbx-ana", 3, "for"], ["sbx-ana/p1|sbx-bo", 2, "for"], ["sbx-ana/p2|sbx-ana", 1, "for"]], "each position is where it was, with its own n");
  assert.equal(r.proof.carried, 6);
  assert.deepEqual(r.proof.staked_before, { marks: 13, posts: 0 }); assert.deepEqual(r.proof.staked_after, { marks: 7, posts: 6 });
  assert.equal(verify().status, 0, `the town's verifier reads the carried ledger lawful: ${verify().stdout}${verify().stderr}`);
  // run again: nothing left on those marks, so nothing to carry
  assert.equal(ENG.carryApply(M, town, [{ mark: "sbx-ana/m1", post: "sbx-ana/p1" }], { date: DAY }, pem).appended, 0, "a rerun moves nothing");
});

test("the carry REFUSES positions that are not the ones the manifest read, and writes nothing", { skip }, () => {
  seed();
  const head = readFileSync(ledgerPath(), "utf8");
  assert.throws(() => ENG.carryApply(M, town, [{ mark: "sbx-ana/m1", post: "sbx-ana/p1" }], { date: DAY, expect: new Map([["sbx-ana/m1|sbx-ana", 3], ["sbx-ana/m1|sbx-bo", 9]]) }, pem),
    (e) => e.code === 409 && /not what the manifest read/.test(e.defect));
  assert.throws(() => ENG.carryApply(M, town, [{ mark: "sbx-ana/m1", post: "sbx-ana/p1" }], { date: DAY, expect: new Map([["sbx-ana/m1|sbx-ana", 3]]) }, pem),
    (e) => e.code === 409 && /does not list/.test(e.defect), "a staker the manifest never saw refuses it too");
  assert.equal(readFileSync(ledgerPath(), "utf8"), head, "a refused carry leaves the ledger byte for byte as it was");
});

// ── the plan ────────────────────────────────────────────────────────────────
const CONV = await import("../src/idea-mark-conversion.mjs");
const mk = (by, slug, body, over = {}) => ({ mark: `${by}/${slug}`, by, kind: "sited", date: "2026-10-01T00:00:00.000Z", body, path: `WORLD/marks/${by}/${slug}/mark.md`, ...over });
const meepLaw = () => M.meepChecker(M.parseLaws(entries()).laws);
const plan = (marks, over = {}) => CONV.planConversion({ marks, M, entries: entries(), date: DAY, isMeep: (h, d) => meepLaw()(h, d), ...over });

test("THE PLAN keeps each mark's provenance, mints an id that is not the mark's, and carries the stakes it read", { skip }, () => {
  seed();
  const p = plan([mk(ANA, "m1", "A lantern on the quay: the quay is dark after the late ferry."), mk(ANA, "m2", "Ring a bell.")]);
  assert.deepEqual([p.totals.planned, p.totals.to_create, p.totals.stamps_carried, p.totals.stake_positions], [2, 2, 6, 3]);
  const [a] = p.items;
  assert.equal(a.title, "A lantern on the quay"); assert.equal(a.post, "sbx-ana/a-lantern-on-the-quay");
  assert.notEqual(a.post, a.mark, "a post never takes the mark's id: the mark stands until the world half withdraws it");
  assert.deepEqual(a.stakes, [{ handle: ANA, n: 3 }, { handle: BO, n: 2 }]);
  assert.equal(a.origin.mark, "sbx-ana/m1"); assert.equal(a.origin.date, "2026-10-01T00:00:00.000Z");
  assert.equal(a.origin.body_sha256, createHash("sha256").update(a.body).digest("hex"), "the body is carried whole, and its digest is on the post");
  assert.deepEqual(p.proof.staked_after, { marks: 7, posts: 6 });
  assert.ok(p.proof.liquid.every((l) => l.before === l.after));
});

test("a mark it cannot carry whole stays standing, named: a body over the limit, a meep's, no title, an id that will not mint", { skip }, () => {
  seed({ extra: [M.rulesV2Line("2026-10-01", [MEEP])] });
  const long = "x".repeat(601);
  const p = plan([mk(ANA, "long", long), mk(MEEP, "mine", "A meep's thought."), mk(ANA, "cjk", "镇上该有一份路程册"), mk(ANA, "ok", "A fine idea. With a second sentence.")]);
  assert.deepEqual(p.items.map((i) => i.mark), ["sbx-ana/ok"], "only the one that can be carried whole is planned");
  const why = Object.fromEntries(p.problems.map((x) => [x.mark, x.reason]));
  assert.match(why["sbx-ana/long"], /601 characters.*not cut, not summarised/);
  assert.match(why["sbx-meep/mine"], /meep/);
  assert.match(why["sbx-ana/cjk"], /no id mints/, "a title with no letters or digits in the town's alphabet mints no id: left standing for a person, not renamed");
});

test("ids are collision-safe offline and a rerun finds its own post by the mark it came from", { skip }, () => {
  seed();
  const marks = [mk(ANA, "a", "Same title. One"), mk(ANA, "b", "Same title. Two")];
  const p = plan(marks);
  assert.deepEqual(p.items.map((i) => i.post), ["sbx-ana/same-title", "sbx-ana/same-title-2"], "two marks with one title get two ids, in order");
  const held = plan(marks, { heldIds: new Set(["sbx-ana/same-title"]) });
  assert.deepEqual(held.items.map((i) => i.post), ["sbx-ana/same-title-2", "sbx-ana/same-title-3"], "an id a post or mark already holds is skipped");
  const again = plan(marks, { posts: new Map([["sbx-ana/a", "sbx-ana/same-title"], ["sbx-ana/b", "sbx-ana/same-title-2"]]), heldIds: new Set(["sbx-ana/same-title", "sbx-ana/same-title-2"]) });
  assert.deepEqual(again.items.map((i) => [i.post, i.state]), [["sbx-ana/same-title", "posted"], ["sbx-ana/same-title-2", "posted"]], "its own posts are found, never minted again");
  const sha = CONV.manifestSha(p, { ledgerHead: "h", ref: "r" });
  assert.equal(sha, CONV.manifestSha(plan(marks), { ledgerHead: "h", ref: "r" }), "the digest is stable");
  assert.notEqual(sha, CONV.manifestSha(plan([mk(ANA, "a", "Same title. One!"), marks[1]]), { ledgerHead: "h", ref: "r" }), "a changed body changes the digest");
  assert.notEqual(sha, CONV.manifestSha(p, { ledgerHead: "h2", ref: "r" }), "a moved ledger changes the digest");
});

test("each author gets one drafted notice naming every idea, its new id and the stamps that moved with it", { skip }, () => {
  seed();
  const p = plan([mk(ANA, "m1", "Lantern. Quay."), mk(ANA, "m2", "Bell. Ferry."), mk(BO, "z", "Solo. Idea.")]);
  assert.deepEqual(p.notices.map((n) => n.to), [ANA, BO]);
  const ana = p.notices[0];
  assert.match(ana.subject, /Your 2 ideas are now posts/);
  assert.match(ana.body, /sbx-ana\/m1/); assert.match(ana.body, /✦5 staked behind it moved with it/); assert.match(ana.body, /sbx-ana\/m2/);
  assert.equal(p.notices[1].subject, "Your idea is now a post");
});

// ── the world reader ────────────────────────────────────────────────────────

test("the reader takes the standing idea marks at a ref through git, leaves the class mark out, and names a predicate's parent", { skip }, () => {
  const world = tempDir("pos854-world-");
  const put = (path, fm, body) => { mkdirSync(join(world, path, ".."), { recursive: true }); writeFileSync(join(world, path), `---\n${fm}\n---\n\n${body}\n`); };
  execFileSync("git", ["init", "-q", "-b", "main", world]);
  put("WORLD/marks/sbx-ana/m1/mark.md", "kind: sited\nby: sbx-ana\ndate: 2026-10-01T00:00:00.000Z\nclass: idea", "A sited idea.");
  put("WORLD/marks/sbx-ana/not-an-idea/mark.md", "kind: sited\nby: sbx-ana\nclass: home", "A home.");
  put("WORLD/marks/the-town/the-parent/mark.md", "kind: sited\nby: the-town\nclass: home", "The parent.");
  put("WORLD/marks/the-town/the-parent/sbx-bo-claim/mark.md", "kind: predicated\nby: sbx-bo\nclass: idea", "A claim about the parent.");
  put("WORLD/marks/the-town/the-keeping-works/idea/mark.md", "kind: class\nby: the-town\nclass: idea", "The class itself.");
  git(world, "add", "-A"); git(world, ...ident, "commit", "-q", "-m", "w");
  const marks = CONV.readIdeaMarks({ worldClone: world, ref: "HEAD" });
  assert.deepEqual(marks.map((m) => [m.mark, m.kind, m.by, m.of ?? null]),
    [["sbx-ana/m1", "sited", "sbx-ana", null], ["sbx-bo/sbx-bo-claim", "predicated", "sbx-bo", "the-town/the-parent"]],
    "two ideas: the class mark is not an idea, a home is not an idea, and the predicate names the mark it stands under");
  assert.equal(marks[0].body, "A sited idea."); assert.equal(marks[0].date, "2026-10-01T00:00:00.000Z");
});

// ── the tool ────────────────────────────────────────────────────────────────

const TOOL = await import("../tools/convert-idea-marks.mjs");
const run = async (argv, deps = {}) => {
  const out = [], errs = [];
  const code = await TOOL.main(argv, { log: (s) => out.push(s), err: (s) => errs.push(s), env: { ...process.env, TOWN_PUSH: undefined, STAMP_LINES: undefined, BOT_NAME: "fixture", BOT_EMAIL: "fixture@test.invalid", OFFICE_KEEP: undefined, INVOCATION_ID: undefined }, ...deps });
  return { code, text: out.join("\n"), err: errs.join("\n") };
};
const MARKS = () => [mk(ANA, "m1", "A lantern on the quay: dark after the ferry."), mk(ANA, "m2", "Ring a bell.")];
const digestOf = (t) => /^digest: ([0-9a-f]{64})$/m.exec(t)[1];
const dir = (p) => join(tempDir("pos854-out-"), p);

test("THE DRY RUN writes nothing, signs nothing, and prints what it would do with its digest and the one command that applies it", { skip }, async () => {
  seed();
  const ledger = readFileSync(ledgerPath(), "utf8"), head = git(town, "rev-parse", "HEAD");
  const r = await run(["--town", town, "--world", "unused", "--date", DAY], { marks: MARKS(), store: null, facts: await TOOL.townFacts(town) });
  assert.equal(r.code, 0, r.err);
  assert.match(r.text, /2 idea mark\(s\) become their authors' idea posts \(2 to create, 0 already posted\)/);
  assert.match(r.text, /STAKES {2}2 mark\(s\) carry stamps: 3 position\(s\), ✦6 to carry/);
  assert.match(r.text, /PROOF .*staked before: marks 13, posts 0; after: marks 7, posts 6; 2 staker\(s\)' liquid stamps unchanged: yes; minted 0, burned 0/);
  assert.match(r.text, /make {2}sbx-ana\/m1 {2}→ {2}sbx-ana\/a-lantern-on-the-quay/);
  assert.match(r.text, /posts store: NOT read/);
  assert.match(r.text, /NOTICES {2}1 drafted, none sent/);
  assert.match(r.text, /--apply --key .* --expect [0-9a-f]{64}/);
  assert.equal(readFileSync(ledgerPath(), "utf8"), ledger, "the ledger is byte for byte what it was");
  assert.equal(git(town, "rev-parse", "HEAD"), head, "no commit");
});

test("the tool refuses to run from the tick, and an apply with no digest, no key or an existing receipt writes nothing", { skip }, async () => {
  seed();
  const base = ["--town", town, "--world", "unused", "--date", DAY];
  assert.equal((await run(base, { env: { OFFICE_KEEP: "1" } })).code, 2);
  assert.equal((await run(base, { env: { INVOCATION_ID: "x" } })).code, 2);
  assert.match((await run([...base, "--apply"], { marks: MARKS() })).err, /--apply needs --key/);
  assert.match((await run([...base, "--apply", "--key", keyFile], { marks: MARKS() })).err, /--apply needs --expect/);
  assert.match((await run([...base, "--apply", "--key", keyFile, "--expect", "x"], { marks: MARKS() })).err, /--apply needs --receipt/);
  const have = dir("receipt.json"); writeFileSync(have, "{}");
  assert.match((await run([...base, "--apply", "--key", keyFile, "--expect", "x", "--receipt", have], { marks: MARKS() })).err, /already exists/);
});

test("THE APPLY writes only the plan whose digest it was handed: a wrong digest writes nothing; the right one makes the posts, carries the stakes, lands, and leaves a receipt", { skip }, async () => {
  seed();
  const facts = await TOOL.townFacts(town);
  const dry = await run(["--town", town, "--world", "unused", "--date", DAY], { marks: MARKS(), store: null, facts });
  const digest = digestOf(dry.text);
  const ledger = readFileSync(ledgerPath(), "utf8");
  const receipt = dir("receipt.json");
  const made = [];
  const convert = async (m, o) => { made.push([m.mark, m.title, o.planned, o.hand, m.origin.mark]); return { existed: false, post: o.planned, act_id: made.length }; };
  const args = (expect) => ["--town", town, "--world", "unused", "--date", DAY, "--apply", "--key", keyFile, "--expect", expect, "--receipt", receipt];

  const wrong = await run(args("0".repeat(64)), { marks: MARKS(), store: null, facts, convert });
  assert.equal(wrong.code, 1); assert.match(wrong.err, /not the plan that was reviewed/);
  assert.equal(made.length, 0, "a wrong digest made no post"); assert.equal(readFileSync(ledgerPath(), "utf8"), ledger, "…and moved no stamp"); assert.ok(!existsSync(receipt));

  const ok = await run(args(digest), { marks: MARKS(), store: null, facts: await TOOL.townFacts(town), convert });
  assert.equal(ok.code, 0, ok.err);
  assert.deepEqual(made.map((m) => [m[0], m[2], m[3], m[4]]), [["sbx-ana/m1", "sbx-ana/a-lantern-on-the-quay", "wright", "sbx-ana/m1"], ["sbx-ana/m2", "sbx-ana/ring-a-bell", "wright", "sbx-ana/m2"]],
    "each post is put up by the town's hand at the id the plan named, carrying the mark it was");
  const posts = ENG.postStakeState(M, entries());
  assert.equal(posts.escrow.get("sbx-ana/a-lantern-on-the-quay"), 5); assert.equal(posts.escrow.get("sbx-ana/ring-a-bell"), 1);
  assert.equal(M.foldWorldMarkPositions(entries()).get("sbx-ana/m1|sbx-bo"), undefined, "the mark's stake is gone from the mark");
  assert.equal(verify().status, 0, "the ledger is lawful after the carry");
  assert.match(git(town, "log", "-1", "--format=%s"), /^convert: 3 stake position\(s\) carried from idea marks to idea posts · ✦6 \(POS-854\)$/, "one commit, one carry");
  const rec = JSON.parse(readFileSync(receipt, "utf8"));
  assert.equal(rec.digest, digest); assert.equal(rec.notices_sent, 0); assert.equal(rec.notices_drafted.length, 1);
  assert.deepEqual([rec.stakes.proof.carried, rec.stakes.moves.length], [6, 3]);
  // a second apply of the same digest: the receipt exists, and the digest would differ anyway (the stakes moved)
  const again = await run(args(digest), { marks: MARKS(), store: null, facts: await TOOL.townFacts(town), convert });
  assert.equal(again.code, 1);
});

test("an apply whose carry is refused leaves the posts that stand and moves no stamp", { skip }, async () => {
  seed();
  const facts = await TOOL.townFacts(town);
  const digest = digestOf((await run(["--town", town, "--world", "unused", "--date", DAY], { marks: MARKS(), store: null, facts })).text);
  const ledger = readFileSync(ledgerPath(), "utf8");
  const refusing = () => { throw Object.assign(new Error("x"), { code: 409, defect: "the stakes moved", hint: "again" }); };
  const r = await run(["--town", town, "--world", "unused", "--date", DAY, "--apply", "--key", keyFile, "--expect", digest, "--receipt", dir("r.json")],
    { marks: MARKS(), store: null, facts: await TOOL.townFacts(town), convert: async (m, o) => ({ post: o.planned }), carry: refusing });
  assert.equal(r.code, 1); assert.match(r.err, /the stakes were refused: the stakes moved.*Posts stand; no stamp has moved/);
  assert.equal(readFileSync(ledgerPath(), "utf8"), ledger);
});

after(() => { /* the scratch folders are tempDir's */ });
void pathToFileURL;
