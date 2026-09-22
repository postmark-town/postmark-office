#!/usr/bin/env node
// registry-drain.mjs — the store -> the town's two files (POS-187).
//
// The household registry is store-of-record (019_households.sql). This is the
// drain that makes the town repo's two JSON files a RENDERING of it:
//
//   node tools/registry-drain.mjs --check    render, diff against the clone,
//                                            exit 0 on byte-equality or 1
//                                            naming the first differing line
//   node tools/registry-drain.mjs --apply    write and commit both files
//                                            through the town pen, only when
//                                            they differ
//
// ── `--check` IS THE GATE, NOT A REPORT ─────────────────────────────────────
//
// It answers exactly one question — does the store render today's real files,
// byte for byte — and it is the condition on every later step. It runs at the
// crossing, before anything trusts the store, and its red is the whole flip
// stopping. The law it enforces is `src/registry-rows.mjs`'s header:
//
//     renderRegistry(rowsFromRegistry(the files)) === the files
//
// proven there against the 2026-09-22 fixtures, and proven HERE against
// whatever the clone holds this morning. The two are the same law read from
// the two ends: the test proves the fold and unfold compose, `--check` proves
// the STORE still holds what the fold put in it.
//
// ── `--apply` COMMITS THROUGH THE TOWN PEN AND NOTHING ELSE ─────────────────
//
// `penCommit` (src/write.mjs:43) — the one ceremony every office write to the
// town clone goes through: stage, commit as the office bot with the stable
// author string, push when `TOWN_PUSH=1`, and verify the commit is an ancestor
// of `origin/main` before calling it landed. It RETURNS NULL FOR AN EMPTY DIFF,
// so idempotence is not something this file implements — it is something the
// pen already guarantees, and a drain that re-rendered identical bytes commits
// nothing and says so.
//
// A second writer here would be the thing this whole lane exists to end. There
// is one pen and one pool: reads go through `actsQuery`'s pool
// (src/world2-acts.mjs), writes go through `penCommit`.
//
// ── `drainRegistry()` IS EXPORTED FOR POS-158 ───────────────────────────────
//
// The mint writes its house to the table and then calls this, in the same act,
// so the file never lags the row by a crossing. It takes an injected `commit`
// exactly as `declareHousehold` does, so a falsifier can prove the whole
// decision path without a clone or a pen.
//
// ── ENV ─────────────────────────────────────────────────────────────────────
//
//   TOWN_CLONE      the town checkout the files are diffed against / written to
//   TOWN_PUSH=1     push the commit (penCommit's own gate)
//   BOT_NAME / BOT_EMAIL   the pen's author string
//   WORLD2_PG=1 + WORLD2_PG_URL    the office's record connection (office_api)
//
// Nothing is sourced and no secret is printed.

import { readFileSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { renderRegistry, firstDifferingLine } from "../src/registry-rows.mjs";
import { loadRegistryRows } from "../src/registry-store.mjs";
import { REGISTRY_PATH, PINS_PATH } from "../src/residency.mjs";
import { penCommit } from "../src/write.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};

const CLONE = opt("--clone", process.env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));

const readFile = (clone, rel) => {
  try { return readFileSync(join(clone, rel), "utf8"); } catch { return null; }
};

/**
 * Render the store and compare it to a clone's two files.
 *
 * `{ ok, rows, rendered, diffs }`. `diffs` is one entry per file that differs,
 * each carrying the 1-based first differing line and both sides of it, because
 * a red that says only "they differ" is a red nobody can act on at 05:45.
 */
export async function checkRegistry({ clone = CLONE, env = process.env } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null)
    return { ok: false, rows: null, rendered: null, unreachable: true, diffs: [] };

  const rendered = renderRegistry(rows);
  const diffs = [];
  for (const [path, got] of [[REGISTRY_PATH, rendered.households], [PINS_PATH, rendered.pins]]) {
    const actual = readFile(clone, path);
    if (actual === null) { diffs.push({ path, missing: true }); continue; }
    const d = firstDifferingLine(got, actual);
    if (d) diffs.push({ path, ...d });
  }
  return { ok: diffs.length === 0, rows, rendered, diffs };
}

/**
 * Write and commit both files, only when they differ.
 *
 * `commit` is injected (the real `penCommit` in production, a capture in test)
 * so the whole decision path is provable without a clone or a pen — the same
 * seam `declareHousehold` uses for exactly the same reason.
 *
 * Returns `{ ran, commit, changed, counts }`. `commit: null` with
 * `changed: []` is the ordinary idempotent case, not a failure.
 */
export async function drainRegistry({ clone = CLONE, env = process.env, commit = penCommit } = {}) {
  const rows = await loadRegistryRows(env);
  if (rows === null)
    return { ran: false, skipped: "this office is not pointed at the record — nothing was rendered and nothing was written", commit: null, changed: [] };

  const rendered = renderRegistry(rows);
  const counts = { households: rows.households.length, pins: rows.pins.length };

  const changed = [];
  const paths = [];
  for (const [rel, content] of [[REGISTRY_PATH, rendered.households], [PINS_PATH, rendered.pins]]) {
    const abs = join(clone, rel);
    if (readFile(clone, rel) !== content) { writeFileSync(abs, content); changed.push(rel); }
    paths.push(abs);
  }

  // Both paths are staged either way. `penCommit` returns null on an empty
  // diff, so handing it the unchanged one costs nothing and keeps the commit a
  // single act over both files — which is the shape every other town write
  // holds (src/declare.mjs § ONE COMMIT, BOTH OR NEITHER).
  const sha = changed.length
    ? commit(clone, paths, `registry: ${counts.households} households, ${counts.pins} pins rendered from the store (via postmark-office, registry-drain)`)
    : null;

  return { ran: true, commit: sha, changed, counts };
}

async function main() {
  const CHECK = flag("--check");
  const APPLY = flag("--apply");
  if (CHECK === APPLY) {
    console.error("registry-drain: pass exactly one of --check or --apply\n"
      + "  --check  renders the store and diffs it against the clone's two files; 0 = byte-equal, 1 = names the first differing line\n"
      + "  --apply  writes and commits both files through the town pen, only when they differ");
    process.exit(1);
  }

  if (CHECK) {
    const r = await checkRegistry({ clone: CLONE });
    if (r.unreachable) {
      console.error("registry-drain --check: this office is not pointed at the record (WORLD2_PG=1 and WORLD2_PG_URL are what point it) — the gate did not run, and an un-run gate is not a pass");
      process.exit(1);
    }
    if (r.ok) {
      console.error(`registry-drain --check: byte-equal — ${r.rows.households.length} households, ${r.rows.pins.length} pins render ${REGISTRY_PATH} and ${PINS_PATH} exactly as ${CLONE} holds them`);
      process.exit(0);
    }
    for (const d of r.diffs) {
      if (d.missing) { console.error(`registry-drain --check: ${d.path} is missing from ${CLONE}`); continue; }
      console.error(`registry-drain --check: ${d.path} differs at line ${d.line}`);
      console.error(`  store renders: ${d.rendered}`);
      console.error(`  the clone has: ${d.actual}`);
    }
    console.error("the store does not render the town's files — nothing may read it as the record until this exits 0");
    process.exit(1);
  }

  const r = await drainRegistry({ clone: CLONE });
  if (!r.ran) { console.error(`registry-drain --apply: ${r.skipped}`); process.exit(1); }
  if (!r.changed.length) {
    console.error(`registry-drain --apply: both files already match the store (${r.counts.households} households, ${r.counts.pins} pins) — nothing written, nothing committed`);
    process.exit(0);
  }
  console.error(`registry-drain --apply: wrote ${r.changed.join(", ")} (${r.counts.households} households, ${r.counts.pins} pins), commit ${r.commit ?? "(empty diff — the pen committed nothing)"}`);
  process.exit(0);
}

// ── the entrypoint ──────────────────────────────────────────────────────────
//
// Only run when invoked as a script: this module is imported by POS-158's mint
// and by `test/registry-drain.test.mjs`, and an import that ran a drain would
// be a door nobody opened.
//
// THE JUNCTION LESSON (HQ memory `junctions-defeat-main-guards`, and this
// repo's own `test/cli-guard.test.mjs`): `pathToFileURL(process.argv[1]).href
// === import.meta.url` is FALSE when the entry reaches this file through a
// Windows junction — the ESM loader realpaths the entry, argv[1] does not — and
// the tool then exits 0 having done nothing, which for a GATE reads exactly
// like "byte-equal". Compare REAL paths; the URL compare is only the fallback
// for an argv[1] that cannot be realpath'd. This tool is on that test's roster.
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();

if (isMain) main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
