#!/usr/bin/env node
// media-sweep — the daily sweep that frees media nothing hangs any more (POS-737).
//
// The whole law is in src/media-sweep.mjs (the sources, the clock, fail-closed,
// the claim). This file is its CLI: it opens the office's own paper and store,
// runs one sweep and writes the report.
//
//   node tools/media-sweep.mjs                 a DRY run: keeps the clock, names what it would free
//   node tools/media-sweep.mjs --apply         frees what is due (also: MEDIA_SWEEP_APPLY=1)
//
//   --oauth-db <path>     the office's paper (default ./oauth.db, as the office's own)
//   --state-dir <dir>     where the report lands: last.json (the roll-call's heartbeat)
//                         and runs/<at>.json, one per run (default MEDIA_SWEEP_STATE_DIR,
//                         or print only)
//   --max-delete <n>      a live run that finds more files due than this frees none (default 50)
//
// MEDIA_SWEEP_EXTRA_CLONES (comma-separated paths): further clones whose every
// branch keeps the files it names, for work not yet published where the
// world and town clones can see it.
//
// Env (the office's own, /etc/postmark-office.env): WORLD_CLONE, TOWN_CLONE,
// OFFICE_PAPERWORK_STORE, WORLD2_PG, WORLD2_PG_URL, and the R2_* storage keys for
// a live run.
//
// THE FIRST LIVE RUN IS WRIGHT'S, on Darko's go. The unit ships dry.
//
// Exit 0 ran (dry or live) · 1 refused (a source unreadable, no 080, too many due)
// · 2 usage · 3 storage failed on some file (named in the report; retried next run).

import { mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const USAGE = "usage: node tools/media-sweep.mjs [--apply] [--oauth-db <path>] [--state-dir <dir>] [--max-delete <n>]";
const FLAGS = new Set(["--apply", "--oauth-db", "--state-dir", "--max-delete"]);

function isMain() {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
}

/** The report's two files: the heartbeat and the run's own receipt. */
export function writeReport(dir, report) {
  if (!dir) return null;
  mkdirSync(join(dir, "runs"), { recursive: true });
  const body = JSON.stringify(report, null, 2) + "\n";
  const run = join(dir, "runs", `${report.at.replace(/[:.]/g, "-")}.json`);
  writeFileSync(run, body);
  writeFileSync(join(dir, "last.json"), body);
  return run;
}

async function main() {
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a.startsWith("--") && !FLAGS.has(a));
  if (unknown.length) { console.error(`media-sweep: unknown ${unknown.join(", ")}\n${USAGE}`); process.exit(2); }
  const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
  const apply = argv.includes("--apply") || process.env.MEDIA_SWEEP_APPLY === "1";
  const maxDelete = Number(opt("--max-delete", "50"));
  if (!Number.isInteger(maxDelete) || maxDelete < 0) { console.error(`media-sweep: --max-delete is a whole number\n${USAGE}`); process.exit(2); }
  const stateDir = opt("--state-dir", process.env.MEDIA_SWEEP_STATE_DIR ?? null);

  const { openPaper, closePaperworkPools } = await import("../src/paperwork.mjs");
  const { oauthSchema } = await import("../src/oauth.mjs");
  const { runSweep } = await import("../src/media-sweep.mjs");
  const odb = await openPaper(resolve(opt("--oauth-db", "oauth.db")), { schema: oauthSchema });
  // The store sources read through the paper's pool when the office is
  // switched, and through their own when it is not; with no store at all they
  // are unreadable, and the run refuses.
  let pool = odb.pool ?? null, own = null;
  if (!pool && process.env.WORLD2_PG === "1" && process.env.WORLD2_PG_URL) {
    const { default: pg } = await import("pg");
    const { storePoolOptions } = await import("../src/store-pool.mjs");
    own = pool = new pg.Pool(storePoolOptions(process.env, { name: "media-sweep", max: 1 }));
  }
  let report;
  try {
    report = await runSweep({
      odb, pool, apply, maxDelete,
      worldClone: process.env.WORLD_CLONE || null, townClone: process.env.TOWN_CLONE || null,
      extraClones: String(process.env.MEDIA_SWEEP_EXTRA_CLONES ?? "").split(",").map((p) => p.trim()).filter(Boolean),
    });
  } finally {
    await own?.end().catch(() => {});
    await closePaperworkPools();
    odb.close();
  }
  const run = writeReport(stateDir, report);
  const line = report.refused
    ? `REFUSED: ${report.refused}`
    : `${report.mode}: ${report.ledger.live} live, ${report.ledger.unhung} unhung; clock +${report.clock.stamped} −${report.clock.cleared}; `
      + (report.mode === "dry"
        ? `would free ${report.due.files} file(s), ${(report.due.bytes / 1048576).toFixed(1)} MB`
        : `freed ${report.freed.files} file(s), ${(report.freed.bytes / 1048576).toFixed(1)} MB${report.storage_failed ? `; storage failed on ${report.storage_failed.length}` : ""}`);
  console.log(`[media-sweep] ${line}${run ? ` (${run})` : ""}`);
  if (!stateDir) console.log(JSON.stringify(report, null, 2));
  process.exit(report.refused ? 1 : report.storage_failed ? 3 : 0);
}

if (isMain()) main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
