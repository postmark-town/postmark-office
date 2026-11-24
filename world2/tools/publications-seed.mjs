#!/usr/bin/env node
// publications-seed.mjs — THE CUTOVER'S ONE COPY OF THE SWEEP'S REGISTRY INTO THE STORE (POS-1025, 095).
//
//   node world2/tools/publications-seed.mjs --world-repo <clone> --sha <the cutover's world main> [--dry-run]
//
//   env: PG* as the owner role, as marks-ingest and backfill-register take it:
//        . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD
//
// EXIT CODES: 0 seeded, or already seeded with exactly these rows · 1 REFUSED (the store already holds a
//             different registry, or the file cannot be read) · 2 a bad argument or no PG environment.
//
// The sweep kept `WORLD/settlement-publications.json` on world main: which marks a settlement admitted, and
// as what class. From the cutover the settlement decides the commons rule before its seal, so the registry
// is the store's (`settlement_publications`, 095) and the clearing keeps it (settlement-decides.mjs). This
// copies the file as it stands at the cutover's world main, ONCE, in one transaction:
//
//   slug    the file's key            class   the row's class, as written
//   ord     its place in the file     stale   its registered path is NOT on main at that sha
//   from_window 0 (it held before the store kept it)
//
// STALE is the world rule's own test (tools/unpublish-verdict.mjs: "its registered path is on main"), asked
// once, here, at the cutover's sha: a row the sweep skipped every crossing (kinofire's re-filed fireplace,
// postmark#3757) is skipped by the clearing too, until its mark is published again. Nothing else in the row
// is read or rewritten; the household and path the file carries stay in the file, byte for byte, and the
// printout keeps them.
//
// IT REFUSES TO OVERWRITE. A store already holding live rows equal to these is "already seeded" and changes
// nothing (a re-run is safe). A store holding DIFFERENT live rows is refused with the first differences named:
// after the cutover the clearing is the registry's writer, and a second seed over its work would undo
// settlements.

import { execFileSync } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";

export const REGISTRY_REL = "WORLD/settlement-publications.json";

/**
 * The seed rows from the file's text, PURE: `pathOnMain(path)` answers whether a path is on main at the
 * cutover's sha. Throws on a file that is not the registry's shape.
 */
export function seedRowsOf(text, pathOnMain) {
  const reg = JSON.parse(text);
  if (!reg || typeof reg !== "object" || !reg.published || typeof reg.published !== "object" || Array.isArray(reg.published))
    throw new Error(`${REGISTRY_REL} is not the registry's shape ({ version, published: { <slug>: { household, path, class } } })`);
  return Object.entries(reg.published).map(([slug, row], ord) => {
    if (!row || typeof row.class !== "string" || !row.class) throw new Error(`${REGISTRY_REL}: the row for ${slug} names no class`);
    return { slug, class: row.class, stale: !(typeof row.path === "string" && row.path && pathOnMain(row.path)), ord };
  });
}

const sameRows = (a, b) => a.slug === b.slug && a.class === b.class && a.stale === b.stale && Number(a.ord) === Number(b.ord);

/** Seed `rows` into the store in the caller's transaction; or say it is already done; or refuse by name. */
export async function seedPublications(q, rows, { dryRun = false } = {}) {
  const { rows: live } = await q("SELECT slug, class, stale, ord FROM settlement_publications WHERE to_window IS NULL ORDER BY ord");
  if (live.length) {
    const want = new Map(rows.map((r) => [r.slug, r]));
    const differ = [];
    for (const l of live) if (!want.has(l.slug) || !sameRows(l, want.get(l.slug))) differ.push(l.slug);
    for (const r of rows) if (!live.some((l) => l.slug === r.slug)) differ.push(r.slug);
    if (!differ.length) return { status: "already-seeded", rows: live.length };
    return { status: "refused", why: `the store already holds a registry of ${live.length} row(s) that differs from the file at ${differ.length} slug(s) (first: ${differ.slice(0, 5).join(", ")}); after the cutover the clearing keeps it, and a second seed would undo its settlements`, differ: differ.slice(0, 50) };
  }
  if (dryRun) return { status: "would-seed", rows: rows.length };
  for (const r of rows)
    await q("INSERT INTO settlement_publications (slug, class, stale, ord, from_window) VALUES ($1, $2, $3, $4, 0)", [r.slug, r.class, r.stale, r.ord]);
  return { status: "seeded", rows: rows.length };
}

const argOf = (name) => { const i = process.argv.indexOf(name); return i !== -1 ? process.argv[i + 1] : null; };

async function main() {
  const worldRepo = argOf("--world-repo"), sha = argOf("--sha");
  if (!worldRepo || !existsSync(worldRepo) || !/^[0-9a-f]{40}$/.test(sha ?? "")) {
    console.error("usage: publications-seed.mjs --world-repo <clone> --sha <full commit sha of the cutover's world main> [--dry-run]");
    process.exit(2);
  }
  if (!process.env.PGDATABASE && !process.env.PGUSER) {
    console.error("no PG* environment. For the owner role:\n  . /srv/world2-lab/ops/world2-lib.sh && w2_pgenv world2_owner PG_WORLD2_OWNER_PASSWORD");
    process.exit(2);
  }
  const git = (...a) => execFileSync("git", ["-C", worldRepo, ...a], { encoding: "utf8", maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "pipe"] });
  let rows;
  try {
    const paths = new Set(git("ls-tree", "-r", "--name-only", sha, "--", "WORLD/marks").split("\n").filter(Boolean));
    rows = seedRowsOf(git("show", `${sha}:${REGISTRY_REL}`), (p) => paths.has(p));
  } catch (e) {
    console.error(`SEED REFUSED — nothing was written: the registry at ${sha.slice(0, 12)} could not be read: ${String(e?.message ?? e).slice(0, 300)}`);
    process.exit(1);
  }
  const { default: pg } = await import("pg");
  const client = new pg.Client();
  await client.connect();
  const q = (text, args) => client.query(text, args);
  try {
    await q("BEGIN");
    const out = await seedPublications(q, rows, { dryRun: process.argv.includes("--dry-run") });
    await q(out.status === "seeded" ? "COMMIT" : "ROLLBACK");
    const classes = {};
    for (const r of rows) classes[r.class] = (classes[r.class] ?? 0) + 1;
    console.log(JSON.stringify({ ...out, sha, file_rows: rows.length, classes, stale: rows.filter((r) => r.stale).map((r) => r.slug) }, null, 1));
    process.exitCode = out.status === "refused" ? 1 : 0;
  } catch (e) {
    await q("ROLLBACK").catch(() => {});
    console.error(`SEED REFUSED — nothing was written: ${e?.message ?? e}`);
    process.exitCode = 1;
  } finally {
    await client.end().catch(() => {});
  }
}

const invokedDirectly = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (invokedDirectly) await main();
