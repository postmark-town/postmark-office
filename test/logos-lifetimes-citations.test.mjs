// logos-lifetimes-citations.test.mjs — WLD-39: the office's LIVE citations of the
// lifetime doctrine name its new home, LOGOS/lifetimes.md (World: "standing /
// living / fleeting are lifetimes, not kinds"; scope ruled by Wright
// 2026-10-13T08:57:47.829Z). The applied migration that wrote the old path into
// three marks' `source` stays byte for byte as it ran: migrations never change
// after they run, and the old path resolves through the World's seasonal pointer.
//
// Comments and citations only; no code path reads these strings.

import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const OLD = /(?<![\w/.-])(?:LOGOS\/)?kinds\.md/g;

const CITING = ["src/dynamic-emissions.mjs", "src/dynamic-entities.mjs", "src/dynamic-store.mjs", "src/reach.mjs", "src/world-hold.mjs"];

test("the office's live citations of the lifetime doctrine name LOGOS/lifetimes.md, never the old path", () => {
  for (const rel of CITING) {
    const text = read(rel);
    assert.deepEqual(text.match(OLD) ?? [], [], `${rel} still cites the old path`);
    assert.match(text, /lifetimes\.md/, `${rel} cites the new one`);
  }
});

// THE MIGRATION'S CONTENT, line endings set aside (WLD-39 independent review):
// the raw-bytes hash this pinned at first reddened on a Windows checkout, where
// git may write the .sql with CRLF. What is frozen is the text the migration
// applied, so its digest is taken over LF-normalized text. The committed blob
// is held separately below, so normalizing here relaxes nothing about git.
const MIGRATION_017 = join(ROOT, "world2", "schema", "017_source_underscore.sql");
const MIGRATION_017_SHA256 = "fc40156ed7a6ac8977340c41360cc31eb24cb5b005700069432e102760408a0f";
const MIGRATION_017_BLOB = "238e37567f9910e9cfabb20d07d6237018f09db3";
const migrationDigest = (bytes) =>
  createHash("sha256").update(Buffer.from(Buffer.from(bytes).toString("utf8").replace(/\r\n/g, "\n"), "utf8")).digest("hex");

test("the applied migration 017 is content-identical — its old `source` paths are history, not live links", () => {
  const bytes = readFileSync(MIGRATION_017);
  assert.equal(migrationDigest(bytes), MIGRATION_017_SHA256, "an applied migration never changes after it runs (anti-rebake)");
  assert.equal((bytes.toString("utf8").match(/'LOGOS\/kinds\.md'/g) ?? []).length, 3, "its three historical assignments stand as written");
});

test("the digest is the content's, whatever the checkout's line endings: a CRLF rendering of 017 hashes the same; a change to its text does not", () => {
  const lf = readFileSync(MIGRATION_017);
  const crlf = Buffer.from(lf.toString("utf8").replace(/\r?\n/g, "\r\n"), "utf8");
  assert.notEqual(createHash("sha256").update(crlf).digest("hex"), MIGRATION_017_SHA256, "the CRLF rendering's raw bytes differ (the control is real)");
  assert.equal(migrationDigest(crlf), MIGRATION_017_SHA256, "…and its content digest is the frozen one");
  const altered = Buffer.from(lf.toString("utf8").replace("'LOGOS/kinds.md'", "'LOGOS/lifetimes.md'"), "utf8");
  assert.notEqual(altered.toString(), lf.toString(), "the alteration took");
  assert.notEqual(migrationDigest(altered), MIGRATION_017_SHA256, "a changed assignment is a changed migration");
  assert.notEqual(migrationDigest(Buffer.from(altered.toString("utf8").replace(/\n/g, "\r\n"))), MIGRATION_017_SHA256, "…in either line ending");
});

test("the migration's committed blob is the one that ran — a source invariant held apart from the content digest", (t) => {
  let blob;
  try { blob = execFileSync("git", ["-C", ROOT, "rev-parse", "HEAD:world2/schema/017_source_underscore.sql"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); }
  catch { return t.skip("not a git checkout: the committed blob cannot be read here (the content digest above still holds)"); }
  assert.equal(blob, MIGRATION_017_BLOB, "the committed migration is the blob that was applied");
});
