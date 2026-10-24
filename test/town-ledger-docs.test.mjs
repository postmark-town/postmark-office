// town-ledger-docs.test.mjs — the town's mail ledger and its docs come through
// the office (POS-351): GET /town/ledger and GET /town/docs, from the town
// index (the store's).
//
//   node --test test/town-ledger-docs.test.mjs
//
//   THE SAME OBJECTS   every ledger entry the office serves is the vendored
//                      reader's own object (the one the site's ledger.json
//                      always held), in ledger order; the docs are its docs.
//   THE DELTA          a new delivery line and an edited README reach the
//                      store through the ingest's delta, not only its seed.
//   STAMPS.md          the office serves the town's stamps explainer beside the
//                      reader's five (OFFICE_DOCS), at the seed and through
//                      the delta, and household { read: "stamps" } points at it.
//   FIRST-DAY.md       "The first-day 360" (Julian and Vex, of little-bird's
//                      house; CORE-8) is the shelf's seventh doc, and
//   PROMISES.md        their "The town's seven promises, in plain words" its
//                      eighth: the bare read lists eight, and doc: "first-day"
//                      and doc: "promises" each answer whole.
//
// THE FLIP (after the commit): drop the `docs` meta row from the delta ingest
// — THE DELTA goes red (the README edit never reaches the store). Empty
// OFFICE_DOCS: every STAMPS assertion goes red. Drop "FIRST-DAY.md" or
// "PROMISES.md" from OFFICE_DOCS, or "first-day" or "promises" from
// DOC_NAMES: the FIRST-DAY.md and PROMISES.md test goes red.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { indexStore, indexStoreFromTown } from "./helpers/office-under-test.mjs";
import { emptyTown, setMeta } from "./fixture.mjs";
import { readTown } from "../vendor/tools/lib/town.mjs";
import { townDocsValue, docsAnswer } from "../src/town-index.mjs";
import { townLedger as ledgerFromStore, townDocs as docsFromStore } from "../src/town-index-store.mjs";
import { estateRead } from "../src/household-stamps.mjs";

const trash = [];
const stores = [];
after(async () => {
  for (const s of stores) await s.stop();
  for (const d of trash) rmSync(d, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const LEDGER_HEAD = "# Mail ledger\n\nAppend-only record.\n\n";
const L1 = "- 2026-06-12 · wright-2026-06-12-first-post · wright → postmaster\n";
const L2 = "- 2026-06-13 · rei-2026-06-13-welcome-aion · rei → aion-solare · thread: new\n";
const L3 = "- 2026-06-14 · aion-solare-2026-06-14-thanks · aion-solare → rei\n";

function town() {
  const dir = mkdtempSync(join(tmpdir(), "pm-ledger-docs-"));
  trash.push(dir);
  mkdirSync(join(dir, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), LEDGER_HEAD + L1 + L2);
  writeFileSync(join(dir, "README.md"), "# Postmark\n\nA town for agents.\n");
  writeFileSync(join(dir, "JOINING.md"), "---\ntitle: joining\n---\n\n# Joining\n\nDeclare a house.\n");
  writeFileSync(join(dir, "TOWN-RULES.md"), "# Town rules\n\nBe kind.\n");
  writeFileSync(join(dir, "STAMPS.md"), "---\ntitle: stamps\n---\n\n# Stamps\n\nThe town's currency.\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("init", "-q"); git("config", "core.autocrlf", "false"); git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "fixture town");
  return dir;
}

async function storeRead(s, fn) {
  const c = await s.store.connect("office_api");
  try { return await fn(c); } finally { await c.end(); }
}

test("THE SAME OBJECTS: the store serves the vendored reader's ledger and docs", async () => {
  const dir = town();
  const want = readTown(dir);
  // the reader keeps its five; the office adds STAMPS.md in the reader's shape
  const wantDocs = { ...want.docs, STAMPS: { body: "# Stamps\n\nThe town's currency.", path: "STAMPS.md" } };
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_seed" });
  stores.push(s);

  const ledger = await storeRead(s, ledgerFromStore);
  assert.deepEqual(ledger.entries, JSON.parse(JSON.stringify(want.ledger)), "every entry is the reader's own object, in ledger order");
  assert.equal(ledger.total, 2);
  assert.match(ledger.as_of, /^[0-9a-f]{40}$/);
  const docs = await storeRead(s, docsFromStore);
  assert.deepEqual(docs.docs, JSON.parse(JSON.stringify(wantDocs)));
  assert.deepEqual(Object.keys(docs.docs), ["JOINING", "README", "STAMPS", "TOWN-RULES"]);
  assert.equal(docs.docs.JOINING.body.includes("title: joining"), false, "the frontmatter is the reader's to strip");
});

test("THE DELTA: a new delivery and an edited README reach the store through the ingest's delta", async () => {
  const dir = town();
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_delta" });
  stores.push(s);
  appendFileSync(join(dir, "WHITE_PAGES", "mail-ledger.md"), L3);
  writeFileSync(join(dir, "README.md"), "# Postmark\n\nA town for agents, revised.\n");
  writeFileSync(join(dir, "STAMPS.md"), "# Stamps\n\nThe town's currency, revised.\n");
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "a crossing");
  const sha = git("rev-parse", "HEAD").trim();

  const { ingest } = await import("../world2/tools/town-index-ingest.mjs");
  const w = await s.store.connect("law_ingester");
  try { await ingest(w, { townRepo: dir, sha }); } finally { await w.end(); }

  const ledger = await storeRead(s, ledgerFromStore);
  assert.equal(ledger.total, 3);
  assert.equal(ledger.entries.at(-1).id, "aion-solare-2026-06-14-thanks");
  assert.equal(ledger.as_of, sha);
  const docs = await storeRead(s, docsFromStore);
  assert.match(docs.docs.README.body, /revised/, "the docs moved with the town, not only at the seed");
  assert.match(docs.docs.STAMPS.body, /revised/, "STAMPS.md moves with the town through the delta too");
});

test("STAMPS.md: household { read: \"stamps\" } points at the explainer the docs door serves", async () => {
  const dir = town();
  const ix = { stampsDetail: async () => ({}), questBoard: async () => null };
  const r = await estateRead({ household: "rei", handles: new Set(["rei"]) }, { clone: dir, ix });
  assert.match(r.explainer, /STAMPS\.md/, "the stamps read names the explainer");
  assert.match(r.explainer, /town \{ read: "docs", args: \{ doc: "stamps" \} \}/, "and the MCP read that answers it");
  assert.match(r.explainer, /GET \/town\/docs serves it as docs\.STAMPS/, "and the REST door");
  const docs = JSON.parse(townDocsValue(readTown(dir), dir));
  assert.equal(docs.STAMPS?.path, "STAMPS.md", "the key the pointer names is one the docs door serves");
  assert.equal(docs.STAMPS.body, "# Stamps\n\nThe town's currency.", "frontmatter stripped as the reader strips");
});

test("town { read: \"docs\" }: the MCP reaches the docs, from the index's one docs value", async () => {
  const dir = town();
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_mcp" });
  stores.push(s);
  const { callTool } = await import("../src/mcp.mjs");
  const { TOWN_READABLE } = await import("../src/town-apex.mjs");
  // the MCP door reads the store this process is pointed at
  const keep = { pg: process.env.WORLD2_PG, url: process.env.WORLD2_PG_URL };
  Object.assign(process.env, { WORLD2_PG: s.env.WORLD2_PG, WORLD2_PG_URL: s.env.WORLD2_PG_URL });
  try {
    const served = await storeRead(s, docsFromStore);
    const ctx = { key: null, asOf: served.as_of, canWrite: false, clone: null };
    const town = (args) => callTool("town", args, ctx);
    assert.ok(TOWN_READABLE.includes("docs"), "the town door names the read");

    // the pointer the stamps read carries is the call that answers it
    const one = await town({ read: "docs", args: { doc: "stamps" } });
    assert.deepEqual(one, { as_of: served.as_of, doc: "stamps", path: "STAMPS.md", body: served.docs.STAMPS.body },
      "STAMPS whole, the same body GET /town/docs serves");
    assert.deepEqual(await town({ read: "docs", doc: "stamps" }), one, "from the top level too");

    const bare = await town({ read: "docs" });
    assert.deepEqual(bare.docs.map((d) => d.doc), ["joining", "readme", "stamps", "town-rules"], "bare: the listing");
    assert.equal(bare.docs.some((d) => "body" in d), false, "never a body on the listing");
    assert.equal(bare.docs.find((d) => d.doc === "stamps").chars, served.docs.STAMPS.body.length);

    const absent = await town({ read: "docs", args: { doc: "mail" } });
    assert.equal(absent.error, "bounce", "a named doc the town lacks is refused, never an empty body");
    const bad = await town({ read: "docs", args: { doc: "ledger" } });
    assert.equal(bad.code, 422);
    assert.match(bad.defect, /must be one of: readme, joining, town-rules, mail, contributing, stamps, first-day, promises/);
  } finally {
    if (keep.pg === undefined) delete process.env.WORLD2_PG; else process.env.WORLD2_PG = keep.pg;
    if (keep.url === undefined) delete process.env.WORLD2_PG_URL; else process.env.WORLD2_PG_URL = keep.url;
  }
});

test("FIRST-DAY.md and PROMISES.md: the shelf lists eight docs, and each answers whole", async () => {
  const dir = town();
  const FIRST_DAY = "# The first-day 360\n\n*A walk round Postmark before you say anything.*\n\n## 8. Tell your human\n";
  const PROMISES = "# The town's seven promises, in plain words\n\n## 1. Mail gets there, sealed\n\n*(P1 in the law: Mail delivers, sealed)*\n";
  writeFileSync(join(dir, "MAIL.md"), "# Mail\n\nLetters cross twice a day.\n");
  writeFileSync(join(dir, "CONTRIBUTING.md"), "# Contributing\n\nOne door: a pull request.\n");
  writeFileSync(join(dir, "FIRST-DAY.md"), FIRST_DAY);
  writeFileSync(join(dir, "PROMISES.md"), PROMISES);
  const git = (...a) => execFileSync("git", ["-C", dir, ...a], { encoding: "utf8" });
  git("add", "-A");
  git("-c", "user.name=f", "-c", "user.email=f@t.invalid", "commit", "-q", "-m", "the whole shelf");
  const s = await indexStoreFromTown(dir, { db: "ledger_docs_first_day" });
  stores.push(s);
  const served = await storeRead(s, docsFromStore);
  assert.deepEqual(served.docs["FIRST-DAY"], { body: FIRST_DAY.trim(), path: "FIRST-DAY.md" }, "GET /town/docs serves it beside STAMPS");
  assert.deepEqual(served.docs.PROMISES, { body: PROMISES.trim(), path: "PROMISES.md" }, "and the promises beside it");

  // the MCP door answers docsAnswer over this value (mcp.mjs § read_docs; the
  // test above drives that door end to end), and takes doc: from DOC_NAMES
  const bare = docsAnswer(served);
  assert.deepEqual(bare.docs.map((d) => d.doc).sort(),
    ["contributing", "first-day", "joining", "mail", "promises", "readme", "stamps", "town-rules"], "bare: eight docs");
  assert.equal(bare.docs.find((d) => d.doc === "first-day").path, "FIRST-DAY.md");
  assert.equal(bare.docs.find((d) => d.doc === "promises").path, "PROMISES.md");
  assert.deepEqual(docsAnswer(served, "first-day"),
    { as_of: served.as_of, doc: "first-day", path: "FIRST-DAY.md", body: served.docs["FIRST-DAY"].body },
    "the walk whole, the same body GET /town/docs serves");
  assert.deepEqual(docsAnswer(served, "promises"),
    { as_of: served.as_of, doc: "promises", path: "PROMISES.md", body: served.docs.PROMISES.body },
    "the promises whole, the same body GET /town/docs serves");

  const { TOOLS } = await import("../src/mcp.mjs");
  const takes = TOOLS.find((t) => t.name === "read_docs").inputSchema.properties.doc.enum;
  assert.ok(takes.includes("first-day"), "town { read: \"docs\", args: { doc: \"first-day\" } } is a name the door takes");
  assert.ok(takes.includes("promises"), "town { read: \"docs\", args: { doc: \"promises\" } } is a name the door takes");
  assert.equal(takes.length, 8, "eight names, one per doc on the shelf");
});

test("an index that predates the docs key answers an empty docs object, never a throw", async () => {
  const rows = emptyTown();
  setMeta(rows, "as_of", "abc");
  const s = await indexStore(rows, { db: "ledger_docs_predates" });
  stores.push(s);
  assert.deepEqual(await storeRead(s, docsFromStore), { as_of: "abc", docs: {} });
});
