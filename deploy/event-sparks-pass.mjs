// event-sparks-pass.mjs — the keeping tick's step that turns a staked event that has ended into its spark (POS-1035; call 22).
//
//   node deploy/event-sparks-pass.mjs --town <clone> --key <pem> [--world <clone>] [--registry <file>]
//   node deploy/event-sparks-pass.mjs --town <clone> --dry-run
//
// ── WHAT IT DOES ─────────────────────────────────────────────────────────────
//
// Every event that was posted with its 20-stamp stake, has ended, was not cancelled and is not yet complete is completed by
// src/event-sparks.mjs § completeEvent: one put-forward spark through the mark road, its whole stake home and the spark's own
// 1-stamp stake backing it (19 home, 1 kept), in one signed batch and one store transaction — or not at all. This file decides
// nothing about money or sparks; it finds the due events and asks, once each.
//
// ── WHERE IT RUNS ────────────────────────────────────────────────────────────
//
// In deploy/office-keep.sh, under the town lock, AFTER the mint step has committed, pushed and synced: a completion signs its own
// two ledger lines, lands them in its own store transaction and commits them itself, and when it cannot land, penTransaction puts
// its lines back — which is only true on a clean ledger. So a ledger with lines nobody committed is not touched: the pass says so
// (exit 3) and the next tick asks again. No new scheduler, unit or signing authority: the tick's own key, the tick's own lock.
//
// ── NEVER TWICE, AND NEVER A GUESS ───────────────────────────────────────────
//
// The event's receipt (fields.completed) is written in the same transaction as the spark and the ledger's landing, read FOR
// UPDATE, so a second tick finds it complete and does nothing. An event whose room cannot be told, or where several rooms formed
// (an open Call), is HELD: named in the output, nothing moved, asked again next tick.
//
// ── NEVER ONTO A RED LEDGER ──────────────────────────────────────────────────
//
// When an event is due, the ledger is first judged by the mint's own arrival check (tools/stamp-verify-owed.mjs: owed mints and
// settlements are not red; anything else the town verifier finds is). A red ledger is the mint's refusal too, and no completion
// signs onto it (exit 4). Only when something is due: a quiet tick costs no verify of its own (the tick's lock hold stays as it was).
//
// Exit: 0 every due event completed or held; 1 a completion was refused (non-fatal, the tick goes on); 2 usage; 3 a dirty ledger;
// 4 a red ledger.

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export const DUE_EVENTS_SQL = `SELECT id, class, title, body, author, household, place_mark, place_x, place_y, starts, ends, state, fields, revised, posted_act, last_act
  FROM posts WHERE class = 'event' AND state <> 'cancelled' AND ends <= $1 AND fields ? 'stake'
   AND NOT (fields ? 'completed') AND NOT (fields->'stake' ? 'returned') ORDER BY ends, id`;

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; }

export async function main(argv = process.argv.slice(2), env = process.env) {
  const town = arg(argv, "--town");
  const keyPath = arg(argv, "--key");
  const dry = argv.includes("--dry-run");
  if (!town || (!keyPath && !dry)) {
    console.error("usage: node deploy/event-sparks-pass.mjs --town <clone> --key <pem> [--world <clone>] [--registry <file>] | --town <clone> --dry-run");
    return 2;
  }
  if (!existsSync(join(town, "WHITE_PAGES", "stamp-ledger.md"))) { console.error(`no stamp ledger under ${town}`); return 2; }
  const dirty = execFileSync("git", ["-C", town, "status", "--porcelain", "--", "WHITE_PAGES/stamp-ledger.md"], { encoding: "utf8" }).trim();
  if (dirty) {
    console.error("[event-sparks] the stamp ledger holds lines nobody committed — no completion runs on a ledger it could not put back; the next tick asks again");
    return 3;
  }
  const { officeRead } = await import("../src/world2-pen.mjs");
  const { rowOf } = await import("../src/events-store.mjs");
  const now = Date.now();
  const due = (await officeRead((q) => q.query(DUE_EVENTS_SQL, [new Date(now).toISOString()]), { env })).rows.map(rowOf);
  if (dry) { for (const r of due) console.log(JSON.stringify({ event: r.id, due: true, ends: r.ends })); return 0; }
  if (!due.length) return 0;
  const registry = arg(argv, "--registry");
  const verify = spawnSync(process.execPath, [join(HERE, "..", "tools", "stamp-verify-owed.mjs"), "--repo", town, ...(registry ? ["--registry", registry] : [])],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (verify.status !== 0) {
    process.stderr.write(`${verify.stdout ?? ""}${verify.stderr ?? ""}`);
    console.error(`[event-sparks] the stamp ledger is red (the verify above names the line) — ${due.length} due event(s) wait; no completion signs onto it`);
    return 4;
  }

  const { completeEvent } = await import("../src/event-sparks.mjs");
  const { penTransaction } = await import("../src/write.mjs");
  const { townDay } = await import("../src/votes.mjs");
  const { createHearingWindow } = await import("../src/hearing-window.mjs");
  const world = arg(argv, "--world") ?? env.WORLD_CLONE ?? resolve(HERE, "..", "world-clone");
  let edges = [];
  try { const h = createHearingWindow({ repo: world }); await h.refresh(); edges = h.settlements() ?? []; } catch { edges = []; }
  const keyPem = readFileSync(keyPath, "utf8");
  let refused = 0;
  for (const row of due) {
    const out = await penTransaction(town, () => completeEvent(row, { clone: town, keyPem, env, now, date: townDay(), edges }));
    if (out?.error) refused += 1;
    console.log(JSON.stringify(out));
  }
  return refused ? 1 : 0;
}

const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
})();
if (isMain) main().then((code) => process.exit(code), (e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
