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
//   · holds it cannot read (087 not landed) pay no inviter side.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { main, inviteMintArgv } from "../deploy/invite-pass.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PINNED_TOWN = join(ROOT, "town-clone");
const INVITE_TOWN = process.env.INVITE_TOWN_CLONE || null;

// ── the invented town ───────────────────────────────────────────────────────
const INVITED_AT = "2026-10-27T20:39:04.552Z";
const HOUSEHOLDS = {
  keep: { residents: ["dora"], accounts: [{ id: 4 }], invited_by: { by: "castle", named: "cleo", at: INVITED_AT } },
  castle: { residents: ["carl", "cleo"], accounts: [{ id: 5 }] },
};
const PINS = { dora: { id: 4 }, carl: { id: 5 }, cleo: { id: 5 } };
const REGISTRY = { households: HOUSEHOLDS, pins: PINS };
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

const E2E = INVITE_TOWN ? false : "needs postmark#4424's --invite-mint (unshipped): set INVITE_TOWN_CLONE to a town checkout carrying it";

function invitedTown() {
  const repo = mkdtempSync(join(tmpdir(), "invite-pass-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  for (const f of ["stamp-mint.mjs", "stamp-verify.mjs", "registry-source.mjs"]) copyFileSync(join(INVITE_TOWN, "tools", f), join(repo, "tools", f));
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(PINS));
  writeFileSync(join(repo, "tools", "households.json"), JSON.stringify({ households: HOUSEHOLDS }));
  for (const h of Object.keys(PINS)) {
    mkdirSync(join(repo, "WHITE_PAGES", h), { recursive: true });
    writeFileSync(join(repo, "WHITE_PAGES", h, "ADDRESS.md"), `---\nhandle: ${h}\n---\n`);
  }
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"),
    "# ledger\n\n- 2026-10-27 · a-1 · dora → carl · thread: new\n- 2026-10-27 · b-1 · carl → dora · thread: new\n");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pub = publicKey.export({ type: "spki", format: "pem" });
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), pub);
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  const mint = (args) => execFileSync(process.execPath, [join(repo, "tools", "stamp-mint.mjs"), ...args, "--repo", repo], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  mint(["--append", "--key", keyFile]);
  mint(["--welcome", "dora", "--household", "gh:4", "--date", "2026-10-28", "--key", keyFile]);
  return { repo, keyFile, pub };
}
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
