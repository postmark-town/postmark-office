// invite-pass.test.mjs — the office pays Bring a neighbour by rule (POS-816).
//   node --import ./test/helpers/sparse-guard.mjs --test test/invite-pass.test.mjs
//   INVITE_TOWN_CLONE=<a town checkout carrying --invite-mint> for the end-to-end arm
//
// Every household, letter and ledger line here is invented.
//
// ── TWO ARMS ────────────────────────────────────────────────────────────────
// THE REFUSALS run everywhere: no --town, a town with no invite grammar (the
// pinned town clone, before POS-816's town half ships), and a store or registry
// it cannot read. Each pays nothing and spawns nothing.
// END TO END needs the town's own verb, which is postmark#4424 (unshipped):
// TEST-DESIGN's rule, a falsifier that needs another repo's unshipped code skips
// and says why, and takes an env override pointing at a tree that has it. It
// builds an invented town from that tree's three mint files, runs this pass
// with the real verb, and reads the result with the town's own verifier:
//   · the invited household's 5 more and its inviter's 10, each one line, green;
//   · a second pass writes nothing (never twice);
//   · a held invitation pays its 5 more and not its inviter's 10;
//   · holds it cannot read (087 not landed) pay no inviter side;
//   · THE FOUNDERS' household pays both sides like any other (POS-816/d), and the
//     town's meep law keeps its meeps from being the recipient.

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main, inviteMintArgv } from "../deploy/invite-pass.mjs";
import { HOUSEHOLDS, PINS, INVITED_AT, REGISTRY, INVITE_TOWN_SKIP, invitedTown } from "./helpers/invite-town.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PINNED_TOWN = join(ROOT, "town-clone");

// ── the invented town (test/helpers/invite-town.mjs) ─────────────────────────
const STORE = (holds = new Map()) => ({
  rows: [{ slug: "keep", name: "The Keep", residents: ["dora"], invited_by: HOUSEHOLDS.keep.invited_by }],
  houses: [{ slug: "keep", residents: ["dora"], formerly: [] }, { slug: "castle", residents: ["carl", "cleo"], formerly: [] }],
  facts: { letters: new Map([["keep", "2026-10-28T12:00:00.000Z"]]), homes: new Map(), ashore: new Map([["keep", "2026-10-27T21:00:00.000Z"]]) },
  holds,
});
const NOW = new Date("2026-11-05T00:00:00.000Z"); // past the week: due at the 2026-11-04 18:00Z settlement
const quiet = () => { const out = []; return { out, log: (s) => out.push(s), err: (s) => out.push(s) }; };
const noSpawn = () => { throw new Error("the pass spawned the town's verb when it should have paid nothing"); };

// ── the refusals (everywhere) ───────────────────────────────────────────────

test("no --town: nothing planned, nothing paid", async () => {
  const q = quiet();
  assert.equal(await main([], { store: STORE(), registry: REGISTRY, spawn: noSpawn, now: NOW, env: {}, ...q }), 1);
  assert.match(q.out.join("\n"), /--town <town-clone> is required/);
});

test("a town with no invite grammar (the pinned town clone): nothing paid, and it says what the town must carry", { skip: existsSync(join(PINNED_TOWN, "tools", "stamp-mint.mjs")) ? false : "no pinned town clone in this tree" }, async () => {
  const engine = await import(pathToFileURL(join(PINNED_TOWN, "tools", "stamp-mint.mjs")).href);
  if (typeof engine.inviteInvitedLine === "function") return; // the pin moved past POS-816's town half: the end-to-end arm covers it
  const q = quiet();
  assert.equal(await main(["--town", PINNED_TOWN, "--dry-run"], { store: STORE(), registry: REGISTRY, spawn: noSpawn, now: NOW, env: {}, ...q }), 1);
  assert.match(q.out.join("\n"), /has no invite grammar .* the town must carry --invite-mint first .* nothing planned, nothing paid/);
});

test("a store or registry it cannot read: nothing paid", async () => {
  const town = existsSync(join(PINNED_TOWN, "tools")) ? PINNED_TOWN : ROOT;
  for (const [what, opts] of [["store", { store: null, registry: REGISTRY }], ["registry", { store: STORE(), registry: null, registryRows: null }]]) {
    const q = quiet();
    assert.equal(await main(["--town", town, "--dry-run"], { ...opts, spawn: noSpawn, now: NOW, env: {}, ...q }), 1, what);
    assert.match(q.out.join("\n"), /nothing planned, nothing paid/, what);
  }
});

test("the verb's argv: the town's own tool by absolute path, the side, both houses, the activation on the inviter side only, the store's registry", () => {
  const at = { date: "2026-11-04", keyPath: "/k.pem", registryFile: "/r.json" };
  assert.deepEqual(inviteMintArgv("/town", { side: "invited", handle: "dora", invited: "hh:keep", inviter: "hh:castle" }, at),
    [join("/town", "tools", "stamp-mint.mjs"), "--invite-mint", "dora", "--side", "invited", "--invited", "hh:keep", "--inviter", "hh:castle",
      "--date", "2026-11-04", "--key", "/k.pem", "--registry", "/r.json", "--repo", "/town"]);
  assert.deepEqual(inviteMintArgv("/town", { side: "inviter", handle: "cleo", invited: "hh:keep", inviter: "hh:castle", activated: "2026-10-28" }, at).slice(1, 12),
    ["--invite-mint", "cleo", "--side", "inviter", "--invited", "hh:keep", "--inviter", "hh:castle", "--activated", "2026-10-28", "--date"]);
});

// ── end to end (INVITE_TOWN_CLONE) ──────────────────────────────────────────

const E2E = INVITE_TOWN_SKIP;
const inviteLines = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8").split("\n").filter((l) => l.includes("for: invite:"));
const verify = async (repo, pub) => (await import(pathToFileURL(join(repo, "tools", "stamp-verify.mjs")).href)).verifyStampLedger(repo, { pubkeyPem: pub });

test(`END TO END: the pass pays both sides through the town's own verb, each once, and the town's verifier reads it green ${E2E ? "(skipped: " + E2E + ")" : ""}`, { skip: E2E }, async () => {
  const { repo, keyFile, pub } = invitedTown();
  try {
    const q = quiet();
    const dry = await main(["--town", repo, "--dry-run"], { store: STORE(), registry: REGISTRY, now: NOW, env: {}, ...q });
    assert.equal(dry, 0, q.out.join("\n"));
    assert.equal(inviteLines(repo).length, 0, "a dry run writes nothing");
    const r = await main(["--town", repo, "--key", keyFile], { store: STORE(), registry: REGISTRY, now: NOW, env: {}, ...q });
    assert.equal(r, 0, q.out.join("\n"));
    const lines = inviteLines(repo);
    // LAW POS-576/a "10 and 10": the 5 more beside the welcome's 5, and the inviter's 10
    assert.equal(lines.length, 2, q.out.join("\n"));
    assert.match(lines[0], /^- 2026-11-04 · MINT → dora · 5 · for: invite:hh:keep\/hh:castle\/invited · by: the-town · sig: /);
    assert.match(lines[1], /^- 2026-11-04 · MINT → cleo · 10 · for: invite:hh:keep\/hh:castle\/inviter\/2026-10-28 · by: the-town · sig: /);
    const v = await verify(repo, pub);
    assert.equal(v.ok, true, v.problems.join("\n"));
    // never twice: the second pass reads both sides paid off the ledger and asks for nothing
    const again = quiet();
    assert.equal(await main(["--town", repo, "--key", keyFile], { store: STORE(), registry: REGISTRY, spawn: noSpawn, now: NOW, env: {}, ...again }), 0, again.out.join("\n"));
    assert.match(again.out.join("\n"), /nothing owed/);
    assert.equal(inviteLines(repo).length, 2);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

test(`END TO END: a held invitation pays its 5 more and not its inviter's 10; holds it cannot read pay no inviter side ${E2E ? "(skipped: " + E2E + ")" : ""}`, { skip: E2E }, async () => {
  for (const [why, holds] of [["held by Little Bird", new Map([["keep", { state: "held", moves: [{ from: "open", to: "held", note: "a second account?", hand: "little-bird", at: "2026-11-01T00:00:00.000Z" }] }]])], ["087 not landed", null]]) {
    const { repo, keyFile, pub } = invitedTown();
    try {
      const q = quiet();
      await main(["--town", repo, "--key", keyFile], { store: STORE(holds), registry: REGISTRY, now: NOW, env: {}, ...q });
      const lines = inviteLines(repo);
      assert.equal(lines.length, 1, `${why}: ${q.out.join("\n")}`);
      assert.match(lines[0], /· 5 · for: invite:hh:keep\/hh:castle\/invited ·/, why);
      assert.equal((await verify(repo, pub)).ok, true, why);
      if (holds === null) assert.match(q.out.join("\n"), /holds cannot be read .* 1 inviter payout\(s\) wait/);
    } finally { rmSync(repo, { recursive: true, force: true }); }
  }
  // the control: the same town, no hold, the week not yet over, pays the 5 more alone too, and in its week the 10 waits
  const { repo, keyFile } = invitedTown();
  try {
    const q = quiet();
    await main(["--town", repo, "--key", keyFile], { store: STORE(), registry: REGISTRY, now: new Date("2026-11-04T17:00:00.000Z"), env: {}, ...q });
    assert.deepEqual(inviteLines(repo).map((l) => / · (\d+) · /.exec(l)[1]), ["5"], "in its week: the 10 waits for the settlement");
  } finally { rmSync(repo, { recursive: true, force: true }); }
});

// ── the founders' household pays like any other (POS-816/d) ─────────────────
//
// LAW POS-816/d (Darko 2026-11-03 09:31 EDT): "this should pay like any other under the new NOMOS".
// Until 2026-11-03 an invitation naming starforge paid neither side (POS-576/e, "No, never"). Two
// houses are invited by it, both invented: nook names the house whole ("hh:starforge"), hall names
// a resident ("wren"). The Starforge household lists a meep FIRST, as the live one does
// (architect), and the town's law names it: POS-655, "meeps are credited, not paid".
const FOUNDERS_HOUSES = Object.freeze({
  ...HOUSEHOLDS,
  starforge: { residents: ["architect", "wren"], accounts: [{ id: 7 }] },
  nook: { residents: ["nell"], accounts: [{ id: 6 }], invited_by: { by: "starforge", named: "hh:starforge", at: INVITED_AT } },
  hall: { residents: ["hal"], accounts: [{ id: 8 }], invited_by: { by: "starforge", named: "wren", at: INVITED_AT } },
});
const FOUNDERS_PINS = Object.freeze({ ...PINS, nell: { id: 6 }, architect: { id: 7 }, wren: { id: 7 }, hal: { id: 8 } });
const FOUNDERS_REGISTRY = Object.freeze({ households: FOUNDERS_HOUSES, pins: FOUNDERS_PINS });
const FOUNDERS_TOWN = Object.freeze({ households: FOUNDERS_HOUSES, pins: FOUNDERS_PINS, welcomes: [["dora", "gh:4"], ["nell", "gh:6"], ["hal", "gh:8"]], meeps: ["architect"] });
const FOUNDERS_STORE = () => ({
  rows: ["nook", "hall"].map((slug) => ({ slug, name: slug, residents: FOUNDERS_HOUSES[slug].residents, invited_by: FOUNDERS_HOUSES[slug].invited_by })),
  houses: Object.entries(FOUNDERS_HOUSES).map(([slug, h]) => ({ slug, residents: h.residents, formerly: [] })),
  facts: { letters: new Map([["nook", "2026-10-28T12:00:00.000Z"], ["hall", "2026-10-28T12:00:00.000Z"]]), homes: new Map(), ashore: new Map() },
  holds: new Map(),
});

test(`END TO END: an invitation from the founders' household pays both sides through the town's own verb, and a house named whole pays a resident who is no meep ${E2E ? "(skipped: " + E2E + ")" : ""}`, { skip: E2E }, async () => {
  const { repo, keyFile, pub } = invitedTown(undefined, FOUNDERS_TOWN);
  try {
    const q = quiet();
    const r = await main(["--town", repo, "--key", keyFile], { store: FOUNDERS_STORE(), registry: FOUNDERS_REGISTRY, now: NOW, env: {}, ...q });
    assert.equal(r, 0, `every owed line was written, none refused: ${q.out.join("\n")}`);
    const lines = inviteLines(repo);
    // both sides of both invitations: the 5 more to each welcome's own recipient, then the 10 to wren,
    // never to architect, the Starforge household's first resident and a meep of the town's law
    assert.deepEqual(lines.map((l) => /^- (\S+) · MINT → (\S+) · (\d+) · for: (invite:\S+) · by: the-town · sig: /.exec(l)?.slice(1)), [
      ["2026-11-04", "hal", "5", "invite:hh:hall/hh:starforge/invited"],
      ["2026-11-04", "nell", "5", "invite:hh:nook/hh:starforge/invited"],
      ["2026-11-04", "wren", "10", "invite:hh:hall/hh:starforge/inviter/2026-10-28"],
      ["2026-11-04", "wren", "10", "invite:hh:nook/hh:starforge/inviter/2026-10-28"],
    ], q.out.join("\n"));
    const v = await verify(repo, pub);
    assert.equal(v.ok, true, v.problems.join("\n"));
    // never twice, the founders' lines included
    const again = quiet();
    assert.equal(await main(["--town", repo, "--key", keyFile], { store: FOUNDERS_STORE(), registry: FOUNDERS_REGISTRY, spawn: noSpawn, now: NOW, env: {}, ...again }), 0, again.out.join("\n"));
    assert.equal(inviteLines(repo).length, 4);
  } finally { rmSync(repo, { recursive: true, force: true }); }
});
