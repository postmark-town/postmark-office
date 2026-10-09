// economy-report.test.mjs — the /ops/economy generator's falsifiers.
//   node --test
//
// The point of these is that they can FAIL. A monitoring page that silently
// under-reports is worse than none, so every guard on the page is proven here to
// go RED when the ledger breaks it, not merely to go green on today's good data.
//
// One of them did not survive that standard. The page originally rendered
// `liquid + escrow = M` as a conservation check; the falsifier below could not
// make it red, because with MINT/BURN/stake:* excluded a double-entry fold sums
// to M however broken the ledger is. It was replaced by two guards that can go
// red — a household below zero, and an account that moved stamps while never
// minting and never being pinned — and the identity is now printed as
// arithmetic. The dead check is kept in mind, not in the page.
//
// Builds a town-in-a-bottle and a world-in-a-bottle (real git repos, the town's
// OWN stamp tools copied in — the live-import contract the ops/votes tests use).
// Nothing here can reach a network or a real ledger.

import test from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { copyTownTools } from "./helpers/town-tools.mjs";
import { join, resolve, dirname } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { tempDir } from "./helpers/temp-dir.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");
const GEN = join(ROOT, "tools", "economy-report.mjs");

// The town tools this generator imports live. Sourced from the office's town
// clone exactly like ops.test.mjs; if it is absent the suite says so rather than
// silently passing on a stub.
const TOWN_TOOLS = process.env.TOWN_CLONE
  ? join(process.env.TOWN_CLONE, "tools")
  : resolve(ROOT, "town-clone", "tools");
const NEEDED = ["stamp-mint.mjs", "world-stake.mjs"];
const haveTools = NEEDED.every((f) => existsSync(join(TOWN_TOOLS, f)));

const git = (repo, args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8" });
function initRepo(dir) {
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-q", "-b", "main"]);
  git(dir, ["config", "user.email", "test@example.invalid"]);
  git(dir, ["config", "user.name", "test"]);
}
function commitAll(dir, msg) {
  git(dir, ["add", "-A"]);
  git(dir, ["commit", "-q", "-m", msg]);
}

// A ledger line, canonical form. Unsigned: this generator folds, it does not
// verify seals (stamp-verify.mjs owns that), so an unsigned line parses and
// folds exactly like a signed one — which is what lets these fixtures be small.
const mintLine = (date, handle, cause, side) => `- ${date} · MINT → ${handle} · 1 · for: ${cause} (${side})`;
const giftLine = (date, handle, n, slug, by) => `- ${date} · MINT → ${handle} · ${n} · for: gift:${slug} · by: ${by}`;
const issuanceLine = (date, handle, n, purpose, by, note) => `- ${date} · MINT → ${handle} · ${n} · for: issuance:${purpose} · by: ${by} · note: ${note}`;

function buildTown(root, { extraLines = [] } = {}) {
  const town = join(root, "town");
  initRepo(town);
  mkdirSync(join(town, "tools"), { recursive: true });
  copyTownTools(join(TOWN_TOOLS, ".."), town);
  mkdirSync(join(town, "WHITE_PAGES"), { recursive: true });

  const lines = [
    "- 2026-06-12 · rules: stamps-v1",
    mintLine("2026-06-12", "ada", "ada-2026-06-12-hello", "sent"),
    mintLine("2026-06-12", "bo", "ada-2026-06-12-hello", "received"),
    mintLine("2026-06-13", "bo", "bo-2026-06-13-reply", "sent"),
    mintLine("2026-06-13", "ada", "bo-2026-06-13-reply", "received"),
    giftLine("2026-06-14", "ada", 10, "welcome", "founder"),
    // ada stakes 4 on a mark she does not own: escrow leaves her liquid balance
    "- 2026-06-15 · ada → stake:world-mark/bo/the-hill · 4 · via: mail:ada-2026-06-15-stake",
    ...extraLines,
  ];
  writeFileSync(join(town, "WHITE_PAGES", "stamp-ledger.md"), "# stamp-ledger\n\n" + lines.join("\n") + "\n");
  // Household pins: ada and bo are separate households.
  writeFileSync(join(town, "tools", "github-ids.json"), JSON.stringify({ ada: 1001, bo: 1002 }, null, 2));
  commitAll(town, "town fixture");
  return town;
}

function buildWorld(root) {
  const world = join(root, "world");
  initRepo(world);
  mkdirSync(join(world, "WORLD"), { recursive: true });
  writeFileSync(join(world, "WORLD", "world-state.json"), JSON.stringify({
    marks: [
      { id: "bo/the-hill", by: "bo", household: "bo", tier: "market", sovereign: false, stamps: 4, date: "2026-06-14" },
      { id: "ada/the-shed", by: "ada", household: "ada", tier: "market", sovereign: true, stamps: 0, date: "2026-06-14" },
      { id: "the-town/the-quay", by: "the-town", household: "the-town", tier: "constitution", sovereign: false, stamps: 0, date: "2026-06-14" },
    ],
  }, null, 2));
  commitAll(world, "world fixture");
  return world;
}

function run(town, world, out) {
  execFileSync(process.execPath, [GEN], {
    encoding: "utf8",
    env: { ...process.env, TOWN_CLONE: town, WORLD_CLONE: world, ECONOMY_REPORT_OUT: out, WORLD_REF: "HEAD" },
  });
  return {
    data: JSON.parse(readFileSync(join(out, "data.json"), "utf8")),
    html: readFileSync(join(out, "index.html"), "utf8"),
  };
}

const skip = haveTools ? false : `town tools not found at ${TOWN_TOOLS} — set TOWN_CLONE`;

test("the equity table is cumulative mint, past tense", { skip }, () => {
  const root = tempDir("econ-");
  try {
    const { data, html } = run(buildTown(root), buildWorld(root), join(root, "out"));
    // 4 correspondence stamps + a 10-stamp gift = 14 minted, all time.
    assert.equal(data.supply.minted, 14);
    // ada: 2 correspondence + 10 gift = 12 minted; 4 of it is escrowed, so 8 liquid.
    const ada = data.equity.rows.find((r) => r.handles.includes("ada"));
    assert.equal(ada.minted, 12);
    assert.equal(ada.escrow, 4);
    assert.equal(ada.liquid, 8);
    // Equity is PAST TENSE: staking away 4 did not reduce what ada ever generated.
    assert.equal(ada.minted, ada.liquid + ada.escrow);
    assert.equal(data.supply.liquid + data.supply.escrow, data.supply.minted);
    assert.equal(data.supply.clean, true);
    assert.match(html, /no household is below zero/);
    assert.match(html, /every account is a pinned household or a minter/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("issuance classifies every minted stamp", { skip }, () => {
  const root = tempDir("econ-");
  try {
    const { data, html } = run(buildTown(root), buildWorld(root), join(root, "out"));
    assert.equal(data.issuance.totals.correspondence, 4);
    assert.equal(data.issuance.totals.discretionary, 10);
    const classified = Object.values(data.issuance.totals).reduce((a, b) => a + b, 0);
    assert.equal(classified, data.supply.minted);
    assert.match(html, /every minted stamp is classified/);
    assert.doesNotMatch(html, /UNCLASSIFIED ISSUANCE/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

// ── THE FALSIFIERS: each guard is shown going red ────────────────────────────

test("FALSIFIER — an unknown mint class turns issuance RED rather than shrinking every share", { skip }, () => {
  const root = tempDir("econ-");
  try {
    // A mint line in a shape this page does not classify. It is a real MINT →
    // handle movement, so it counts toward M and toward equity — but no issuance
    // source claims it. That gap is exactly what must be shouted, not swallowed.
    const town = buildTown(root, { extraLines: ["- 2026-06-16 · MINT → ada · 7 · for: harvest:autumn · by: founder"] });
    const { data, html } = run(town, buildWorld(root), join(root, "out"));
    assert.equal(data.supply.minted, 21, "the 7 stamps did enter supply");
    const classified = Object.values(data.issuance.totals).reduce((a, b) => a + b, 0);
    assert.equal(classified, 14, "no issuance source claimed them");
    assert.notEqual(classified, data.supply.minted);
    assert.match(html, /UNCLASSIFIED ISSUANCE/);
    assert.match(html, /7 stamp\(s\) entered supply/);
    assert.doesNotMatch(html, /every minted stamp is classified/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FALSIFIER — escrow on a mark the world does not hold is flagged, not hidden", { skip }, () => {
  const root = tempDir("econ-");
  try {
    // Escrow implies existence: staking a mark the register does not carry is a
    // fold error waiting to happen, and the page must name it.
    const town = buildTown(root, { extraLines: ["- 2026-06-16 · bo → stake:world-mark/ada/nowhere · 2 · via: mail:bo-2026-06-16-stake"] });
    const { data, html } = run(town, buildWorld(root), join(root, "out"));
    const ghost = data.top_backed.marks.find((m) => m.mark === "ada/nowhere");
    assert.ok(ghost, "the ghost mark is listed");
    assert.equal(ghost.exists, false);
    assert.match(html, /absent/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FALSIFIER — money from an account that never minted turns the supply chips RED", { skip }, () => {
  const root = tempDir("econ-");
  try {
    // A payment OUT of an account that never minted and was never pinned. The
    // fold still balances — that is the point: `liquid + escrow = M` cannot see
    // this, which is why it is not a guard. These two chips can.
    const town = buildTown(root, { extraLines: ["- 2026-06-16 · ghost-account → ada · 5 · via: mail:ghost-2026-06-16"] });
    const { data, html } = run(town, buildWorld(root), join(root, "out"));
    assert.equal(data.supply.liquid + data.supply.escrow, data.supply.minted,
      "the identity still holds — proving it is arithmetic, not a check");
    assert.equal(data.supply.clean, false);
    assert.equal(data.supply.negative.length, 1);
    assert.deepEqual(data.supply.negative[0].handles, ["ghost-account"]);
    assert.equal(data.supply.unknown_accounts.length, 1);
    assert.match(html, /NEGATIVE BALANCE/);
    assert.match(html, /UNKNOWN ACCOUNT/);
    assert.doesNotMatch(html, /no household is below zero/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("the transition set is un-sovereign marks with no escrow, split by tier", { skip }, () => {
  const root = tempDir("econ-");
  try {
    const { data } = run(buildTown(root), buildWorld(root), join(root, "out"));
    // three marks: bo/the-hill is commons WITH escrow (anchored, not eligible),
    // ada/the-shed is sovereign (not commons at all), the-town/the-quay is
    // commons with no escrow — the only eligible one.
    assert.equal(data.transition.commons, 2);
    assert.equal(data.transition.zero_escrow, 1);
    assert.deepEqual(data.transition.marks.map((m) => m.id), ["the-town/the-quay"]);
    assert.deepEqual(data.transition.by_tier, { constitution: 1 });
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("town issuance is its own cumulative series, not just a row", () => {
  const root = tempDir("econ-");
  try {
    const town = buildTown(root, { extraLines: [
      issuanceLine("2026-08-10", "the-town", 100, "founding-grant", "k", "the founding act"),
      issuanceLine("2026-08-11", "the-town", 40, "ferry-repairs", "k", "the gangway plank"),
      issuanceLine("2026-08-12", "the-town", 10, "ferry-repairs", "k", "the second plank"),
    ] });
    const { data, html } = run(town, buildWorld(root), join(root, "out"));
    assert.equal(data.town_issuance.cumulative, 150);
    assert.deepEqual(data.town_issuance.lines.map((l) => l.cumulative), [100, 140, 150],
      "the running total is the honest measure under mint-at-demand");
    assert.deepEqual(data.town_issuance.by_purpose, { "founding-grant": 100, "ferry-repairs": 50 });
    // and it is still classified issuance, so the completeness guard stays green
    assert.equal(data.issuance.totals["town issuance"], 150);
    const classified = Object.values(data.issuance.totals).reduce((a, b) => a + b, 0);
    assert.equal(classified, data.supply.minted);
    assert.match(html, /every minted stamp is classified/);
    assert.match(html, /mint-at-demand/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("FALSIFIER — constitution-tier marks are kept OUT of the top-backed ranking", () => {
  // The root and the terrain bind without stamps and absorb fan-up from
  // everything beneath them, so ranking them beside earned backing is a category
  // error. They must be named, not hidden — a silent exclusion is its own lie.
  const root = tempDir("econ-");
  try {
    // the fixture's the-town/the-quay is constitution tier; stake it heavily
    const town = buildTown(root, { extraLines: [
      "- 2026-06-16 · bo → stake:world-mark/the-town/the-quay · 99 · via: mail:bo-2026-06-16",
    ] });
    const { data, html } = run(town, buildWorld(root), join(root, "out"));
    const ids = data.top_backed.marks.map((m) => m.mark);
    assert.ok(!ids.includes("the-town/the-quay"), "the constitution mark is not in the ranking");
    assert.ok(ids.includes("bo/the-hill"), "market marks still rank");
    const excluded = data.top_backed.constitution_excluded.map((m) => m.mark);
    assert.deepEqual(excluded, ["the-town/the-quay"], "and it is reported, not dropped");
    assert.match(html, /excluded from this ranking by design/);
    assert.match(html, /the-town\/the-quay/, "the excluded mark is named on the page");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
