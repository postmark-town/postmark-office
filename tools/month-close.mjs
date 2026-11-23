#!/usr/bin/env node
// month-close.mjs — close the month's keeping pots in one reviewed run (POS-851).
//
// MANUAL by design, and operator-only: not an MCP act, not a public endpoint, not a timer. The town's
// own tools/epoch-close.mjs keeps its "MANUAL by design" header; scheduling this at 00:00 America/New_York
// on the 2nd is a separate go (Darko, 2026-11-01), and this command is built so that run could call it.
//
//   node tools/month-close.mjs plan  --month YYYY-MM --date YYYY-MM-DD [--starforge-file F] [--json]
//   node tools/month-close.mjs apply --month YYYY-MM --date YYYY-MM-DD --fingerprint <64 hex> [--starforge-file F] [--json]
//
//   plan   the dry run: reads, derives every pot in the reviewed order over an in-memory ledger prefix,
//          prints each close report and a plan fingerprint. Appends, pushes and signs nothing; loads no key.
//   apply  a separate invocation, bound to the fingerprint a reviewer saw. Takes the town lock once, brings the
//          clone to the town, re-plans, refuses unless the fingerprint is unchanged, then lands one stamped
//          pen commit per pot and stops at the first failure.
//
//   --starforge-file  a JSON array [{ "pot": "keeping-ec2", "usd": 41, "ref": "<what the payment is>" }]: what
//          Starforge gave, attested by the operator. Never inferred from a shortfall. Its dollars are never receipts.
//   --clone  the town clone (default TOWN_CLONE, else ./town-clone beside the office)
//   --key    the pen's key file, apply only (default STAMP_KEY, else /srv/postmark-office/stamp-key.pem)
//
// env: STAMP_LINES=store (required), TOWN_PUSH=1 (apply), WORLD2_PG / WORLD2_PG_URL (the pen's own store),
//      BOT_NAME / BOT_EMAIL (the pen commit's).
// exit: 0 done, 2 usage, 10 refused (nothing written), 11 partial (stopped; earlier pots stay closed),
//       12 reconciliation required (Git landed and the store may be behind its export: do not run it again).

import { readFileSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EXIT, applyMonthClose, planMonthClose, renderApply, renderPlan } from "../src/month-close.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const USAGE = "usage: month-close.mjs plan --month YYYY-MM --date YYYY-MM-DD [--starforge-file F] [--clone PATH] [--json] | apply --month YYYY-MM --date YYYY-MM-DD --fingerprint <64 hex> [--starforge-file F] [--clone PATH] [--key FILE] [--json]";

function parse(argv) {
  const [verb, ...rest] = argv;
  const opts = { verb, json: false };
  const valued = new Set(["--month", "--date", "--fingerprint", "--starforge-file", "--clone", "--key"]);
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i];
    if (a === "--json") opts.json = true;
    else if (valued.has(a) && rest[i + 1] !== undefined && !rest[i + 1].startsWith("--")) opts[a.slice(2)] = rest[++i];
    else return { error: `unknown or incomplete argument ${JSON.stringify(a)}` };
  }
  return opts;
}

export async function main(argv, env = process.env) {
  const o = parse(argv);
  if (o.error || !["plan", "apply"].includes(o.verb) || !o.month || !o.date) { console.error(o.error ? `${o.error}\n${USAGE}` : USAGE); return EXIT.usage; }
  let attestations = null;
  if (o["starforge-file"]) {
    try { attestations = JSON.parse(readFileSync(o["starforge-file"], "utf8")); }
    catch (e) { console.error(`--starforge-file ${o["starforge-file"]} could not be read as JSON: ${e.message}`); return EXIT.usage; }
  }
  const clone = resolve(o.clone ?? env.TOWN_CLONE ?? resolve(HERE, "..", "town-clone"));
  const common = { clone, month: o.month, date: o.date, attestations, env };

  if (o.verb === "plan") {
    const r = await planMonthClose(common);
    if (o.json) console.log(JSON.stringify({ ok: r.ok, refusals: r.refusals, plan: r.plan, fingerprint: r.fingerprint }, null, 2));
    else console.log(renderPlan(r));
    return r.ok ? EXIT.ok : EXIT.refused;
  }

  if (!o.fingerprint) { console.error(`apply needs --fingerprint: the plan someone reviewed.\n${USAGE}`); return EXIT.usage; }
  const res = await applyMonthClose({ ...common, fingerprint: o.fingerprint, keyPath: o.key ?? env.STAMP_KEY ?? "/srv/postmark-office/stamp-key.pem" });
  console.log(o.json ? JSON.stringify(res, null, 2) : renderApply(res));
  return { completed: EXIT.ok, refused: EXIT.refused, partial: EXIT.partial, "reconciliation-required": EXIT.reconciliation }[res.status];
}

// the junction lesson (test/cli-guard.test.mjs): compare real paths, so the entry fires through a link too
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url)); }
})();

if (isMain) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (e) => { console.error(String(e?.stack ?? e)); process.exitCode = 1; },
  );
}
