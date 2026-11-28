// deploy/uat/migrate-plan.mjs — which of the frozen release's migrations the restored copy still lacks (CORE-165).
//
//   node deploy/uat/migrate-plan.mjs --db world2_uat_new --release /srv/postmark-office
//
// UAT runs the frozen release's code on last night's PROD dump, and prod takes a week's migrations by hand only at the
// ship. So the copy is a week of schema behind the code, every freeze. There is no migrations table in this store
// (world2/tools/README.md § Applying a migration to a live store): world2/tools/migrations-landed.mjs holds one probe per
// schema file, and a test fails the suite if a file has none. This asks those probes of the copy and prints, on stdout, the
// file names that are MISSING, one per line, in the order a store takes them. store-restore-scrub.sh applies each as
// world2_owner (the way every file's own header says), and then scrubs. The rest goes to stderr.
//
// It REFUSES (exit 2, nothing on stdout) when any file has no probe, since a runner that cannot tell whether a migration
// landed would either re-apply it (014 is not idempotent) or skip it.
//
// WHO RUNS IT (CORE-165, review tax 2). The release tree is carried and written by `uat`, whose office faces the internet
// behind Access, so nothing from it may run as root or as the postgres superuser. store-restore-scrub.sh copies the
// schema files and migrations-landed.mjs into a directory of its own and runs THIS file from that copy as `nobody`, with
// a pgpass file for world2_owner: the probes and the migrations reach the copy's database as world2_owner (a role that
// owns only that database's objects), through psql on loopback, never as a superuser and never as root.

import { execFileSync } from "node:child_process";
import { readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** The plan from landedIn's answer: what to apply, in order, and why not if it cannot be planned. */
export function planMigrations(landed) {
  const unknown = landed.filter((r) => r.state === "unknown");
  if (unknown.length) return { apply: [], refuse: unknown.map((r) => `${r.file}: ${r.detail}`) };
  return { apply: landed.filter((r) => r.state === "missing").map((r) => r.file), refuse: [] };
}

/** Ask `db` (psql on loopback as world2_owner; the password is PGPASSFILE's) one boolean probe at a time, the shape landedIn wants. */
export function psqlQuery(db) {
  return async (sql) => {
    const out = execFileSync("psql", ["-h", "127.0.0.1", "-U", "world2_owner", "-X", "-q", "-tA", "-v", "ON_ERROR_STOP=1", "-d", db, "-c", sql], { encoding: "utf8" });
    return { rows: [{ landed: out.trim() === "t" }] };
  };
}

async function main(argv) {
  const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  const db = arg("--db"), release = arg("--release");
  if (!db || !release) { console.error("usage: migrate-plan.mjs --db <database> --release <the carried office tree>"); return 2; }
  const { landedIn } = await import(pathToFileURL(join(release, "world2", "tools", "migrations-landed.mjs")).href);
  const landed = await landedIn(psqlQuery(db), readdirSync(join(release, "world2", "schema")));
  for (const r of landed) console.error(`  ${r.state.padEnd(8)} ${r.file}${r.detail ? ` (${r.detail})` : ""}`);
  const plan = planMigrations(landed);
  if (plan.refuse.length) { for (const l of plan.refuse) console.error(`REFUSED: ${l}`); return 2; }
  for (const f of plan.apply) console.log(f);
  console.error(`${plan.apply.length} migration(s) to apply of ${landed.length} schema files`);
  return 0;
}

// The realpath compare, as world2/tools/await-clearing.mjs does: a path through a junction must still be the entry.
if (process.argv[1] && realpathSync(process.argv[1]).replace(/\\/g, "/").endsWith("/migrate-plan.mjs")) process.exitCode = await main(process.argv.slice(2));
