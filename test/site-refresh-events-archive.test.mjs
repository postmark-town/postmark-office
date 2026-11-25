// site-refresh-events-archive.test.mjs — the box's site refresh keeps the events archive OUTSIDE the trees it resets (POS-1203, with CORE-174).
//
// THE INSTANCE. build_once force-checks-out and cleans the extract tree at the top of every pass, so src/data/postmark/events.json goes back to the empty
// COMMITTED file before every fetch, and the site's capped events feed could never accumulate. The site (CORE-174) reads, merges and atomically writes an archive
// at POSTMARK_EVENTS_ARCHIVE; the publisher's contract (this file) is only that the path is handed to the fetch child, lives outside the reset trees, is SEEDED
// from the retained pre-reset input BEFORE the reset takes it (and only when no archive exists), and is never clobbered. The site's merge and provenance tests
// are the site's.
//
// The shipped build_once() runs VERBATIM, under bash, over REAL git trees (a forced checkout and a clean really happen), with only the extractors shimmed: the
// shim for `tools/fetch-town.mjs` records what the fetch child was handed and what the tree and the archive held AT THAT MOMENT, after the real reset.
//
//   node --test test/site-refresh-events-archive.test.mjs

import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { tempDir } from "./helpers/temp-dir.mjs";

const SCRIPT = readFileSync(new URL("../deploy/site-refresh.sh", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const grab = (re, what) => { const m = SCRIPT.match(re); assert.ok(m, `deploy/site-refresh.sh no longer defines ${what}`); return m[0]; };
const FUNCS = [
  grab(/^EVENTS_ARCHIVE=.*\n/m, "EVENTS_ARCHIVE"),
  grab(/^EVENTS_INPUT_REL=.*\n/m, "EVENTS_INPUT_REL"),
  grab(/^events_input_usable\(\) \{\n[\s\S]*?\n\}\n/m, "events_input_usable()"),
  grab(/^seed_events_archive\(\) \{\n[\s\S]*?\n\}\n/m, "seed_events_archive()"),
  grab(/^build_once\(\) \{\n[\s\S]*?\n\}\n/m, "build_once()"),
].join("\n");

const REL = "src/data/postmark/events.json";
const EMPTY = '{"events":[]}\n';
const RETAINED = '{"events":[{"id":"quill/lantern-night","title":"Lantern night"}],"read_at":"2026-11-20T00:00:00Z","source":"office"}\n';
const posix = (p) => p.replace(/\\/g, "/");
const sh = (cwd, ...args) => { const r = spawnSync("git", args, { cwd, encoding: "utf8" }); assert.equal(r.status, 0, `${args.join(" ")}: ${r.stderr}`); return r.stdout.trim(); };

/** A root with a real extract tree (site @ main, the empty events file committed) and a real town clone. `retained` is the input the previous pass's fetch left. */
function fixture(retained) {
  const root = tempDir("site-refresh-events-archive-");
  const site = join(root, "site"), town = join(root, "town"), bin = join(root, "bin");
  for (const d of [site, town, bin, join(root, "tmp")]) mkdirSync(d, { recursive: true });
  for (const d of [site, town]) { sh(d, "init", "-q", "-b", "main"); sh(d, "config", "user.email", "t@t"); sh(d, "config", "user.name", "t"); }
  mkdirSync(join(site, "src/data/postmark"), { recursive: true });
  writeFileSync(join(site, REL), EMPTY);
  sh(site, "add", "-A"); sh(site, "commit", "-qm", "site");
  writeFileSync(join(town, "README"), "town\n"); sh(town, "add", "-A"); sh(town, "commit", "-qm", "town");
  if (retained != null) writeFileSync(join(site, REL), retained);   // a pass's fetch wrote it; nothing has reset it yet
  // the extractors, shimmed. `node -e` (the script's own JSON probe) is the real node; the fetch records its world AFTER the real reset; the pass is stopped at sync-renditions
  const realNode = process.execPath;
  writeFileSync(join(bin, "node"), `#!/usr/bin/env bash
if [ "$1" = "-e" ]; then exec ${JSON.stringify(posix(realNode))} "$@"; fi
case "$1" in
  tools/fetch-town.mjs)
    { echo "archive_env=\${POSTMARK_EVENTS_ARCHIVE-UNSET}"; echo "letter_env=\${POSTMARK_LETTER_CACHE-UNSET}";
      echo "tree_events=$(tr -d '\\n' < ${REL})"; echo "archive_exists_at_fetch=$([ -f "\${POSTMARK_EVENTS_ARCHIVE:-/nonexistent}" ] && echo yes || echo no)";
      echo "archive_at_fetch=$(tr -d '\\n' < "\${POSTMARK_EVENTS_ARCHIVE:-/nonexistent}" 2>/dev/null)"; } > "$ROOT/fetch-seen.txt" ;;
  tools/sync-renditions.mjs) exit 1 ;;
esac
exit 0
`);
  chmodSync(join(bin, "node"), 0o755);
  return { root, site, town, bin, siteMain: sh(site, "rev-parse", "HEAD"), townSha: sh(town, "rev-parse", "HEAD") };
}

function pass(fx, env = {}) {
  const script = [
    "set -u",
    `ROOT=${JSON.stringify(posix(fx.root))}`, `SITE="$ROOT/site"`, `BUILD="$ROOT/build"`, `TOWN="$ROOT/town"`,
    `TOWN_SHA=${fx.townSha}`, `SITE_MAIN=${fx.siteMain}`, "TAG=release/test", "CODEREF=HEAD", "PASSES=0", "INDEX_AS_OF=", `API=http://127.0.0.1:1`,
    `say() { echo "[say] $*"; }`, `die() { echo "[die] $1" >&2; exit 9; }`, "ensure_deps() { :; }", `crossing_now() { echo 7; }`,
    FUNCS,
    "build_once",
  ].join("\n");
  const r = spawnSync("bash", ["-c", script], { encoding: "utf8", env: { ...process.env, ...env, ROOT: posix(fx.root), PATH: `${posix(fx.bin)}:${process.env.PATH}` } });
  const seen = existsSync(join(fx.root, "fetch-seen.txt")) ? Object.fromEntries(readFileSync(join(fx.root, "fetch-seen.txt"), "utf8").trim().split("\n").map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])) : null;
  return { ...r, seen };
}

test("the pre-reset retained input becomes an external seed, the fetch child is handed the path, and the reset that follows cannot erase it", () => {
  const fx = fixture(RETAINED);
  const r = pass(fx);
  assert.equal(r.status, 9, `the stub stops the pass at sync-renditions (die): ${r.stdout}${r.stderr}`);
  const archive = join(fx.root, "events-archive.json");
  assert.equal(readFileSync(archive, "utf8"), RETAINED, "the retained input, byte for byte: its own evidence and read stamps, never restamped");
  assert.equal(r.seen.archive_env, posix(archive), "the fetch child is handed the archive beside the letter cache");
  assert.equal(r.seen.letter_env, `${posix(fx.root)}/letter-cache.json`);
  // the REAL reset happened before the fetch: the tree's input is the committed empty file again, and the archive still holds the retained records
  assert.equal(r.seen.tree_events, EMPTY.trim(), "the forced checkout and clean put the committed file back");
  assert.equal(r.seen.archive_exists_at_fetch, "yes");
  assert.equal(r.seen.archive_at_fetch, RETAINED.trim(), "the archive survived the reset, seeded before it");
  assert.equal(readFileSync(join(fx.site, REL), "utf8"), EMPTY, "and the tree really is reset (the seed is not a fixture injected after the wipe)");
  // honest provenance: the source named, labelled a retained pre-reset input and never a verified last-published snapshot
  const note = JSON.parse(readFileSync(`${archive}.seed-note.json`, "utf8"));
  assert.equal(note.source, `${posix(fx.site)}/${REL}`);
  assert.equal(note.source_kind, "retained pre-reset input");
  assert.match(note.source_note, /not a verified last-published snapshot/);
  assert.equal(note.bytes_copied_as_they_were, true);
  assert.match(r.stdout, /events archive: seeded .* retained before this pass's reset/);
});

test("an existing archive is never clobbered (not by a retained input, not by the committed empty file)", () => {
  const fx = fixture(RETAINED);
  const archive = join(fx.root, "events-archive.json");
  const held = '{"events":[{"id":"older"},{"id":"older-2"}],"read_at":"2026-11-01T00:00:00Z"}\n';
  writeFileSync(archive, held);
  const r = pass(fx);
  assert.equal(readFileSync(archive, "utf8"), held, "the archive the site merged is the archive");
  assert.equal(r.seen.archive_at_fetch, held.trim());
  assert.equal(existsSync(`${archive}.seed-note.json`), false, "nothing was seeded, so no note claims it was");
  const again = pass(fx);
  assert.equal(readFileSync(archive, "utf8"), held, "a second pass over the reset tree changes nothing");
  assert.equal(again.seen.archive_env, posix(archive));
});

test("an input that is the committed empty file, or empty, or not JSON, is no seed; with nothing to seed from the pass names the bootstrap coverage limit and writes no archive", () => {
  for (const [name, input] of [["committed-empty", null], ["empty events", '{"events":[],"read_at":"2026-11-20T00:00:00Z"}\n'], ["not json", "<html>"]]) {
    const fx = fixture(input);
    const r = pass(fx);
    assert.equal(existsSync(join(fx.root, "events-archive.json")), false, `${name}: no archive is written from nothing`);
    assert.match(r.stdout, /events archive: nothing to seed from .* bootstrap coverage limit, not proof nothing was lost/, name);
    assert.equal(r.seen.archive_env, `${posix(fx.root)}/events-archive.json`, `${name}: the fetch is still handed the path, for the site to start the archive`);
  }
});

test("an explicitly configured archive path is respected; one inside a tree the script resets is refused", () => {
  const fx = fixture(RETAINED);
  const elsewhere = join(fx.root, "state", "events.json");
  const ok = pass(fx, { POSTMARK_EVENTS_ARCHIVE: posix(elsewhere) });
  assert.equal(ok.seen.archive_env, posix(elsewhere));
  assert.equal(readFileSync(elsewhere, "utf8"), RETAINED);
  assert.equal(existsSync(join(fx.root, "events-archive.json")), false, "the default path was not used");
  const fx2 = fixture(RETAINED);
  const bad = pass(fx2, { POSTMARK_EVENTS_ARCHIVE: `${posix(fx2.site)}/archive.json` });
  assert.equal(bad.status, 9);
  assert.match(bad.stderr, /is inside a tree this script resets/);
  assert.equal(bad.seen, null, "the fetch never ran");
});

test("the fetch invocation carries the archive and the letter cache together, and the seed runs before the extract tree's first reset (the shipped order)", () => {
  const body = FUNCS.slice(FUNCS.indexOf("build_once() {"));
  const fetch = body.split("\n").find((l) => /tools\/fetch-town\.mjs/.test(l) && /POSTMARK_LETTER_CACHE/.test(l));
  assert.match(fetch, /POSTMARK_EVENTS_ARCHIVE="\$EVENTS_ARCHIVE"/, "the same child that is handed the letter cache is handed the events archive");
  const seeded = body.indexOf("seed_events_archive");
  assert.ok(seeded > 0 && seeded < body.indexOf('git -C "$SITE" checkout -qf -B refresh-main'), "seeded before the extract tree is force-checked-out");
});
