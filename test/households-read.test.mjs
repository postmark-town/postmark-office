// households-read.test.mjs — GET /households answers the registry as the store holds it (POS-345).
//
// The town's tools and CI, the site's build and the PR witness (POS-348) read
// this instead of the printed tools/households.json / tools/github-ids.json.
// Its contract is in src/households-read.mjs's header; these hold it.
//
// THE FLIP: answer from the clone's printed files instead of the store and the
// REST test goes red, because the printout and the store disagree on purpose.

import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { fixtureTown } from "./fixture.mjs";
import { bootOnFreePort } from "./spawn-office.mjs";
import { indexStore, seedRegistry } from "./helpers/office-under-test.mjs";
import { rowsFromRegistry, registryFromRows, pinsFromRows } from "../src/registry-rows.mjs";
import { householdsRead, narrowTo, parseHandles, MAX_HANDLES } from "../src/households-read.mjs";
import { publicRegistry } from "../src/registry-public.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// THE STORE: two houses; kin has moved into ana's house.
const REGISTRY = { schema_version: 1, note: "printed from the store", households: {
  "ana-house": { name: "Ana's", human: "Ana", since: "2026-08-01", declared_by: "ana", accounts: [{ login: "ana-gh", id: 1 }, { login: "kin-gh", id: 2 }], residents: ["ana", "kin"] },
  "zed-house": { name: "Zed's", since: "2026-08-02", declared_by: "zed", accounts: [{ login: "zed-gh", id: 3 }], residents: ["zed"] },
} };
const PINS = { ana: { login: "ana-gh", id: 1, pinned: "2026-08-01" }, kin: { login: "kin-gh", id: 2, pinned: "2026-10-04" }, zed: { login: "zed-gh", id: 3 } };
const ROWS = rowsFromRegistry(REGISTRY, PINS);

test("the whole registry, in the two files' shapes, from the store", async () => {
  const { status, body } = await householdsRead({}, { rows: ROWS });
  assert.equal(status, 200);
  assert.equal(body.read, "households");
  assert.equal(body.from, "the registry store");
  assert.deepEqual(body.registry, publicRegistry(registryFromRows(ROWS)), "the PUBLIC face of the object the drain renders tools/households.json from");
  assert.equal("human" in body.registry.households["ana-house"], false, "POS-394: the public read carries no human key");
  assert.equal(body.registry.households["ana-house"].name, REGISTRY.households["ana-house"].name, "and keeps the display name");
  assert.deepEqual(body.pins, pinsFromRows(ROWS), "the object the drain renders tools/github-ids.json from");
  assert.deepEqual(Object.keys(body.registry), ["schema_version", "note", "households"], "the file's own key order");
  assert.equal(body.handles, undefined);
});

test("?h= keeps only those handles' pins and the houses they stand in", async () => {
  const { status, body } = await householdsRead({ h: "kin,nobody" }, { rows: ROWS });
  assert.equal(status, 200);
  assert.deepEqual(body.handles, ["kin", "nobody"]);
  assert.deepEqual(Object.keys(body.registry.households), ["ana-house"], "kin stands in ana's house; nobody stands nowhere");
  assert.deepEqual(Object.keys(body.pins), ["kin"]);
  assert.equal(body.registry.schema_version, 1, "the registry's own keys always ride");
});

test("a malformed or oversized ?h= is a 422 that says how to ask", async () => {
  assert.equal((await householdsRead({ h: "" }, { rows: ROWS })).status, 422);
  assert.equal((await householdsRead({ h: "a b" }, { rows: ROWS })).status, 422);
  const many = Array.from({ length: MAX_HANDLES + 1 }, (_, i) => `h${i}`).join(",");
  assert.match((await householdsRead({ h: many }, { rows: ROWS })).body.hint, /at most 50/);
  assert.deepEqual(parseHandles("a,a, b"), { handles: ["a", "b"] });
  assert.deepEqual(narrowTo(REGISTRY, PINS, ["zed"]).pins, { zed: PINS.zed });
});

test("a store the office cannot read is a 503, never the printout", async () => {
  const { status, body } = await householdsRead({}, { rows: null });
  assert.equal(status, 503);
  assert.match(body.hint, /not the record/);
});

// ── POS-726: the read sends the named list, at every level ──────────────────
//
// LAW (Darko's picker answer on POS-845, 2026-11-03 05:53Z): the public line is a "Named list".
// Wright's hand-back on POS-726: only fields named public are sent; a new field is private until named.
//
// Every sentinel here reaches the read THROUGH THE REAL FOLD (`rowsFromRegistry` -> `registryFromRows`
// / `pinsFromRows`, which hand a named column's value over as it arrived and keep unnamed jsonb keys):
// a scalar registry meta key, an unnamed key in an account, a likeness answer and an invitation, an
// object under a resident's handle in `home_images`, an object under the named house key `name`, and
// an object under the named pin key `note`. Invented houses, handles, logins and ids throughout.

const S726 = Object.freeze({
  meta: "SENT_P726_meta", account: "SENT_P726_account", likeness: "SENT_P726_likeness", invite: "SENT_P726_invite",
  image: "SENT_P726_image", underNamed: "SENT_P726_under_named", underPin: "SENT_P726_under_pin", human: "SENT_P726_human",
});
const leaks726 = (x) => Object.entries(S726).filter(([, s]) => JSON.stringify(x).includes(s)).map(([k]) => k).sort();
const deepFreeze = (o) => {
  if (o !== null && typeof o === "object" && !Object.isFrozen(o)) { Object.freeze(o); for (const v of Object.values(o)) deepFreeze(v); }
  return o;
};
const IMG = "https://media.postmark.town/media/p726/pell.png";
const REG_726 = { schema_version: 1, note: "invented for POS-726", extra_meta: S726.meta, households: {
  "ember-loft": { name: "Ember Loft", human: S726.human, accounts: [{ login: "el-gh", id: 9811, secret: S726.account }],
    residents: ["pell", "otter-q"], since: "2026-09-01", declared_by: "pell",
    home_images: { pell: IMG, "otter-q": { url: IMG, secret: S726.image } },
    likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1", secret: S726.likeness },
    invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z", secret: S726.invite } },
  "tarn-yard": { name: { shown: "Tarn Yard", secret: S726.underNamed }, accounts: [{ login: "ty-gh", id: 9813 }],
    residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" },
} };
const PINS_726 = { pell: { login: "el-gh", id: 9811, pinned: "2026-09-01" }, "otter-q": { login: "el-gh", id: 9811 },
  tarn: { login: "ty-gh", id: 9813, pinned: "2026-09-02", note: { text: "n", secret: S726.underPin } } };
const PUBLIC_EMBER = { name: "Ember Loft", accounts: [{ login: "el-gh", id: 9811 }], residents: ["pell", "otter-q"],
  since: "2026-09-01", declared_by: "pell", home_images: { pell: IMG },
  likeness: { answer: "yes", at: "2026-10-20T00:00:00.000Z", by: "el-gh", gh_id: 9811, words: "v1" },
  invited_by: { by: "wren-c", named: "wren-c", at: "2026-09-01T00:00:00.000Z" } };
const PUBLIC_TARN = { accounts: [{ login: "ty-gh", id: 9813 }], residents: ["tarn"], since: "2026-09-02", declared_by: "tarn" };
const PUBLIC_PINS_726 = { "otter-q": { login: "el-gh", id: 9811 }, pell: { login: "el-gh", id: 9811, pinned: "2026-09-01" },
  tarn: { login: "ty-gh", id: 9813, pinned: "2026-09-02" } };

test("POS-726: /households sends only the named fields, whole and narrowed; the store's fold still holds the rest", async () => {
  const rows = deepFreeze(rowsFromRegistry(REG_726, PINS_726));
  const before = JSON.stringify(rows);
  assert.deepEqual(leaks726({ registry: registryFromRows(rows), pins: pinsFromRows(rows) }), Object.keys(S726).sort(),
    "CONTROL: the store's fold carries every sentinel to the read (the instrument can see them)");

  const whole = await householdsRead({}, { rows });
  assert.equal(whole.status, 200);
  assert.deepEqual(leaks726(whole.body), [], "whole: no sentinel reaches the public answer (the list names each one that does)");
  assert.equal(JSON.stringify(whole.body.registry), JSON.stringify({ schema_version: 1, note: "invented for POS-726",
    households: { "ember-loft": PUBLIC_EMBER, "tarn-yard": PUBLIC_TARN } }), "whole: exactly the named public values, in order");
  assert.equal(JSON.stringify(whole.body.pins), JSON.stringify(PUBLIC_PINS_726), "whole: the pins' named values, in order");

  const some = await householdsRead({ h: "tarn,otter-q" }, { rows });
  assert.equal(some.status, 200);
  assert.deepEqual(leaks726(some.body), [], "narrowed: no sentinel either");
  assert.deepEqual(some.body.registry, { schema_version: 1, note: "invented for POS-726",
    households: { "ember-loft": PUBLIC_EMBER, "tarn-yard": PUBLIC_TARN } }, "narrowed: the houses those handles stand in, named values only");
  assert.deepEqual(some.body.pins, { "otter-q": PUBLIC_PINS_726["otter-q"], tarn: PUBLIC_PINS_726.tarn });

  assert.equal(JSON.stringify(rows), before, "the rows handed in are unchanged");
  assert.equal((await householdsRead({}, { rows: null })).status, 503, "an unread store is still a 503, never an empty answer or the printout");
});

// ── over REST, public, on a real store ──────────────────────────────────────

let ix, child, base, tmp;
before(async () => {
  tmp = mkdtempSync(join(tmpdir(), "pos345-door-"));
  const town = fixtureTown();
  // The clone's PRINTOUT disagrees with the store: kin alone in a house of their own.
  const clone = join(tmp, "town-clone");
  mkdirSync(join(clone, "tools"), { recursive: true });
  mkdirSync(join(clone, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(clone, "tools", "households.json"), JSON.stringify({ schema_version: 1, households: {
    "kin-alone": { accounts: [{ login: "kin-gh", id: 2 }], residents: ["kin"] } } }));
  writeFileSync(join(clone, "tools", "github-ids.json"), JSON.stringify({ kin: { login: "kin-gh", id: 2 } }));
  ix = await indexStore(town);
  await seedRegistry(ix.store, REGISTRY, PINS);
  ({ child, port: base } = await bootOnFreePort((port) => spawn(process.execPath, [join(ROOT, "src", "server.mjs"), "--port", String(port),
    "--oauth-db", join(tmp, "oauth.db")], {
    env: { ...process.env, WORLD2_PG: ix.env.WORLD2_PG, WORLD2_PG_URL: ix.env.WORLD2_PG_URL, TOWN_CLONE: clone, TOWN_PUSH: "", OFFICE_READ_WORKERS: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  })));
  base = `http://127.0.0.1:${base}`;
});
after(async () => {
  if (child && child.exitCode === null) { const gone = new Promise((ok) => child.on("exit", ok)); child.kill(); await gone; }
  await ix?.stop();
  rmSync(tmp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

test("GET /households needs no key, and answers the store's houses, not the clone's printout", async () => {
  const r = await fetch(`${base}/households?h=kin`);
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.deepEqual(Object.keys(body.registry.households), ["ana-house"], "the store's house for kin, not the printout's kin-alone");
  assert.deepEqual(body.registry.households["ana-house"].residents, ["ana", "kin"]);
  const all = await (await fetch(`${base}/households`)).json();
  assert.deepEqual(Object.keys(all.registry.households), ["ana-house", "zed-house"]);
  assert.deepEqual(Object.keys(all.pins).sort(), ["ana", "kin", "zed"]);
});

// ── the file the office hands the town's tools (deploy/registry-file.mjs) ───

test("registry-file writes the read's own document, and writes NOTHING when the store cannot be read", async () => {
  const { writeRegistryFile } = await import("../deploy/registry-file.mjs");
  const { existsSync, readFileSync: rf } = await import("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "pos345-file-"));
  try {
    const ok = await writeRegistryFile(join(dir, "registry.json"), { rows: ROWS });
    assert.equal(ok.written, true);
    const doc = JSON.parse(rf(join(dir, "registry.json"), "utf8"));
    assert.deepEqual(doc, (await householdsRead({}, { rows: ROWS })).body, "the same document GET /households answers");
    const no = await writeRegistryFile(join(dir, "none.json"), { rows: null });
    assert.equal(no.written, false);
    assert.equal(existsSync(join(dir, "none.json")), false, "a refused read leaves no file a tool could mistake for the record");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("the keep tick hands its town tools the store's registry", async () => {
  const { readFileSync: rf } = await import("node:fs");
  const sh = rf(new URL("../deploy/office-keep.sh", import.meta.url), "utf8");
  assert.match(sh, /node \/srv\/postmark-office\/deploy\/registry-file\.mjs "\$REGISTRY_FILE"/);
  assert.equal((sh.match(/node tools\/stamp-verify\.mjs(?! --registry "\$REGISTRY_FILE")/g) ?? []).length, 0, "every stamp-verify the tick runs reads the store's registry");
  assert.match(sh, /household-keys\.mjs" --json --repo "\$SNAP\/town" --registry "\$REGISTRY_FILE"/);
});
