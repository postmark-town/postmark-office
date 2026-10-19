#!/usr/bin/env node
// admin-refresh.mjs — the town admin role's ONE writer (WLD-21; Darko
// 2026-10-18 19:38–19:52, G1–G6 ruled 21:23). src/admin-role.mjs holds the law
// and the logic; this is its door on the box.
//
//   node tools/admin-refresh.mjs --check     what would move, nothing written (the default)
//   node tools/admin-refresh.mjs --apply     grant and revoke role `admin`, each with its audit row
//        [--db <roles.db>] [--token-file <path>] [--json]
//
// One GitHub read: the owners of the postmark-town organisation, with the box's
// read token (/srv/postmark-office/git-metrics-token, as bug-credit.mjs reads
// it; GITHUB_READ_TOKEN_FILE overrides). The owners are matched against every
// house's OWN accounts in the store's registry, never a resident's pin, so a
// resident's own GitHub account confers nothing. A read that fails, or an owner
// list that comes back empty, changes nothing: the receipt says UNVERIFIED and
// the last answer stands.
//
// THE CALLER IS THE CROSSING: deploy/settlement-auto.sh runs `--apply` before
// the household export (which prints the role into WORLD/households.json §
// admins), behind SETTLEMENT_ADMIN_REFRESH=1, and never refuses the crossing
// over it. Exit 0 whenever it ran, verified or not; 2 when the store's
// registry or the role book could not be read (nothing written).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_ROLES_DB, rolesSchema } from "../src/roles.mjs";
import { openPaper, closePaperworkPools } from "../src/paperwork.mjs";
import { readOrgOwners, refreshAdmins } from "../src/admin-role.mjs";

const args = process.argv.slice(2);
const opt = (name, def = null) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const APPLY = args.includes("--apply");
const JSON_OUT = args.includes("--json");
const DB = resolve(opt("--db", DEFAULT_ROLES_DB));
const TOKEN_FILE = opt("--token-file", process.env.GITHUB_READ_TOKEN_FILE ?? "/srv/postmark-office/git-metrics-token");

const out = (r) => { console.log(JSON_OUT ? JSON.stringify(r) : r.receipt); };

const { loadRegistry } = await import("../src/registry-store.mjs");
const registry = await loadRegistry().catch((e) => { console.error(`admin-refresh: the store's registry could not be read (${e?.message ?? e}); nothing written`); process.exit(2); });
if (!registry) { console.error("admin-refresh: this office is not pointed at the store (WORLD2_PG=1 and WORLD2_PG_URL), so it cannot read the households' accounts; nothing written"); process.exit(2); }

const paper = await openPaper(DB, APPLY ? { schema: rolesSchema } : { readOnly: true }).catch((e) => {
  console.error(`admin-refresh: the role book could not be opened (${e?.message ?? e}); nothing written`); process.exit(2);
});

let owners = null;
let why = null;
try {
  let token = "";
  try { token = readFileSync(TOKEN_FILE, "utf8").trim(); } catch { throw new Error(`no read token at ${TOKEN_FILE}`); }
  owners = await readOrgOwners({ token, apiBase: process.env.GITHUB_API_URL ?? "https://api.github.com" });
} catch (e) { why = String(e?.message ?? e).slice(0, 200); }

try {
  out(await refreshAdmins({ owners, registry, paper, apply: APPLY, note: why }));
} finally { await closePaperworkPools(); }
