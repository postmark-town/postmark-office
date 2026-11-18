// month-close.mjs — the monthly close of the keeping pots, in one reviewed run (POS-851).
//
// MANUAL, and operator-only: not an MCP act, not a door, not a timer. A scheduler
// is a separate go (POS-851: "for now make it a command that we can run
// manually, with the eventual goal of making it scheduled"). The town's own
// tools/epoch-close.mjs keeps its "MANUAL by design" header; this file wraps its
// law and never restates it.
//
//   tools/month-close.mjs plan  --month YYYY-MM --date YYYY-MM-DD [--starforge-file F]
//   tools/month-close.mjs apply --month YYYY-MM --date YYYY-MM-DD --fingerprint <hex> [--starforge-file F]
//
// ── WHAT IT REUSES, AND WHAT IT ADDS ────────────────────────────────────────
// No mint arithmetic lives here. The close is the town's `deriveEpochClose` (the one copy of the
// law, shared with the verifier), reached through the office's pinned copy (src/town-tool.mjs), and
// the real write is the town's own `epoch-close.mjs --close` run as the pinned child, as
// fund-exec.mjs runs `--receipt`. What this file adds is the ORDER and the memory between pots:
//
//   · THE PLANNER. One pure derivation walks the reviewed order, darko-fund → keeping-ec2 →
//     meeps-fund, over an IN-MEMORY LEDGER PREFIX: each pot's close rows are appended to the
//     prefix before the next pot is derived, because an earlier close raises a household's
//     all-sources mint and its holdings and so moves a later close's cap (deriveEpochClose § THE
//     CAP). Independent previews of each pot against today's ledger are the wrong numbers.
//   · THE FINGERPRINT. sha256 over every governing input and every planned row. `apply` takes the
//     fingerprint a reviewer saw, re-reads and re-plans from scratch under the lock, and refuses on
//     any difference. It never recomputes unseen numbers and calls them approved.
//   · ONE STAMPED PEN COMMIT PER POT. The pot's signed rows (the town's CLI), the Starforge
//     provisional entry (if attested), landed through the store-backed planned seam
//     (planStampedCommit / landPlannedVia): the stamp_lines rows and the push in one store
//     transaction. The plain-Git fallback and a later `--sync` are never the normal road.
//   · STOP AT THE FIRST FAILURE. Pots already closed stay closed; later ones are not attempted.
//     A Git landing followed by a failed SQL COMMIT is RECONCILIATION REQUIRED, never retried: that
//     window is stamp-lines.mjs's own (its header), and this command does not claim distributed
//     atomicity across Git and Postgres.
//
// ── STARFORGE (Darko, 2026-11-01; ECONOMY-DIALS law_side.keeping § _starforge_gives) ────────────
// Starforge's dollars are NOT receipts and write nothing to the stamp ledger. Each pot's real close
// is derived WITHOUT them. Only where the operator ATTESTS an amount and a reference
// (--starforge-file: [{ pot, usd, ref }]; never inferred from a shortfall) is the same law run a
// second time, on a throwaway copy of the prefix with that amount as a grant receipt from the
// credited household; its one holo row is read and the copy is dropped. The copy never reaches the
// real append or the seal, and earlier provisional entries are never an input: they are not in the
// ledger. The entry lands in WHITE_PAGES/starforge-provisional.json in the same commit.
//
// ── THE CONTRACT GAP THIS BUILD SAYS ALOUD ──────────────────────────────────────────────────────
// A provisional entry has no field for a contribution identity or a reference. The identity here is
// (pot, epoch), one provisional contribution per pot-month, and the operator's reference rides in the
// entry's own `why` text. A second entry for one (pot, epoch) that differs is a CONFLICT and stops
// the command; a matching one is "already recorded". Nothing is overwritten, nothing is duplicated.
// A reference field would be a change to the public record's schema, which is a ruling, not a build.

import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync, spawnSync } from "node:child_process";
import { join } from "node:path";

import { engineOf, stampLinesOn, stampHeadVia, verifyStampLinesVia, planStampedCommit, landPlannedVia } from "./stamp-lines.mjs";
import { officeRead, officeWrite } from "./world2-pen.mjs";
import { penTransaction } from "./write.mjs";
import { withTownLockHeld, LOCK_HELD_TOO_LONG } from "./town-lock.mjs";
import { cloneDirt, freshenClone } from "./clone-fresh.mjs";
import { isPinStop, readPins, townToolArgv } from "./town-tool.mjs";

/** The reviewed order (Darko, 2026-11-13: "accept" the packet). An addition to it is a ruling. */
export const MONTH_CLOSE_ORDER = Object.freeze(["darko-fund", "keeping-ec2", "meeps-fund"]);
export const TZ = "America/New_York";
export const PLAN_VERSION = 1;
export const PROVISIONAL_REL = join("WHITE_PAGES", "starforge-provisional.json");
/** The batch's one lock hold. The child lets go at this plus 30 s whatever this process is doing (town-lock.mjs). */
export const APPLY_HOLD_SEC = 900;

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const lf = (s) => String(s).replace(/\r\n/g, "\n");
const refusal = (code, message, pot = null) => ({ code, message, ...(pot ? { pot } : {}) });
const MOVED = Symbol("stamp-head-moved");

// ── the calendar: America/New_York, said out loud ───────────────────────────

/** The date on the New York calendar at `now`, YYYY-MM-DD. */
export function etDate(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/** `YYYY-MM` that is a real month, or null. */
export function parseMonth(s) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(s ?? ""));
  return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? { year: Number(m[1]), month: Number(m[2]) } : null;
}

/** `YYYY-MM-DD` that is a real calendar day, or null. */
export function parseDay(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ""));
  if (!m) return null;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? s : null;
}

/** The first day of the month after `month`, YYYY-MM-01. */
export function firstOfNext(month) {
  const { year, month: m } = parseMonth(month);
  return m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, "0")}-01`;
}

/**
 * Is this month, on this effective date, a close the clock allows? All the refusals, not the first.
 * The month must have ended on the New York calendar; the date must be a real day on or after the
 * first of the next month, not in the future there, and not before the ledger's own tail (the
 * ledger is append-only and forward-dated).
 */
export function whenRefusals({ month, date, now = new Date(), tailDate = null }) {
  const out = [];
  if (!parseMonth(month)) { out.push(refusal("invalid-month", `--month must be a real calendar month YYYY-MM (got ${JSON.stringify(month)})`)); return out; }
  if (!parseDay(date)) { out.push(refusal("invalid-date", `--date must be a real calendar day YYYY-MM-DD (got ${JSON.stringify(date)})`)); return out; }
  const today = etDate(now), opens = firstOfNext(month);
  if (today < opens) out.push(refusal("month-not-ended", `${month} has not ended on the ${TZ} calendar (it is ${today} there; it ends when ${opens} begins)`));
  if (date < opens) out.push(refusal("date-inside-epoch", `--date ${date} is inside or before ${month}: a close is dated on or after ${opens} (${TZ})`));
  if (date > today) out.push(refusal("date-in-future", `--date ${date} is after today on the ${TZ} calendar (${today})`));
  if (tailDate && date < tailDate) out.push(refusal("date-before-tail", `--date ${date} precedes the ledger's tail (${tailDate}): the ledger is append-only and forward-dated`));
  return out;
}

// ── the attestation: what Starforge gave, said by a hand ────────────────────

/** `[{ pot, usd, ref }]` checked. Returns { list, refusals }. Whole dollars, one per pot, a reference that names the payment. */
export function checkAttestations(raw) {
  const refusals = [], list = [], seen = new Set();
  if (raw == null) return { list, refusals };
  if (!Array.isArray(raw)) return { list, refusals: [refusal("bad-attestation", "the Starforge file must be a JSON array of { pot, usd, ref }")] };
  for (const a of raw) {
    const keys = Object.keys(a ?? {}).sort().join(",");
    if (keys !== "pot,ref,usd") { refusals.push(refusal("bad-attestation", `a Starforge attestation is exactly { pot, usd, ref } (got ${JSON.stringify(a)})`)); continue; }
    if (typeof a.pot !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(a.pot)) { refusals.push(refusal("bad-attestation", `Starforge pot ${JSON.stringify(a.pot)} is not a pot id`)); continue; }
    if (!Number.isInteger(a.usd) || a.usd < 1) { refusals.push(refusal("bad-attestation", `Starforge usd for ${a.pot} must be a whole dollar amount of at least 1 (got ${JSON.stringify(a.usd)})`, a.pot)); continue; }
    if (typeof a.ref !== "string" || !a.ref.trim() || /[\r\n]/.test(a.ref)) { refusals.push(refusal("bad-attestation", `Starforge ref for ${a.pot} must be a one-line reference to the payment`, a.pot)); continue; }
    if (seen.has(a.pot)) { refusals.push(refusal("bad-attestation", `Starforge names ${a.pot} twice: one contribution per pot-month`, a.pot)); continue; }
    seen.add(a.pot);
    list.push({ pot: a.pot, usd: a.usd, ref: a.ref.trim() });
  }
  return { list: list.sort((a, b) => a.pot.localeCompare(b.pot)), refusals };
}

// ── the provisional record: read, extend, serialize, byte-checked ───────────

/** The provisional file as it stands: text, line ending, indent, data, and whether it round-trips. Null `data` when absent or not JSON. */
export function readProvisional(clone) {
  const path = join(clone, PROVISIONAL_REL);
  if (!existsSync(path)) return { path, exists: false, data: null };
  const raw = readFileSync(path, "utf8");
  const text = lf(raw);
  let data = null;
  try { data = JSON.parse(text); } catch { /* reported by the caller */ }
  const indent = /^\n?( +)"/m.exec(text)?.[1].length ?? 1;
  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const roundTrips = data !== null && `${JSON.stringify(data, null, indent)}\n` === text;
  return { path, exists: true, raw, text, data, indent, eol, roundTrips };
}

/** The file's bytes (in its own line ending) for `data`. */
export const serializeProvisional = (prov, data) => `${JSON.stringify(data, null, prov.indent)}\n`.replace(/\n/g, prov.eol);

/** `data` with `entry` added and the total recomputed from the entries (a null holo adds nothing). Pure. */
export function withEntry(data, entry) {
  const entries = [...data.entries, entry];
  return { ...data, entries, total_holo_would_mint: entries.reduce((a, e) => a + (Number.isInteger(e.holo_would_mint) ? e.holo_would_mint : 0), 0) };
}

const refOf = (att) => `ref: ${att.ref}`;
/** Does an existing entry say what this attestation says? The amount, and the reference EXACTLY: it is the whole trailing `(ref: X)` of `why`, so `inv-10` never matches `inv-1`. */
const sameAttested = (e, att) => e.usd === att.usd && String(e.why ?? "").endsWith(`(${refOf(att)})`);

// ── reading the town ────────────────────────────────────────────────────────

/** Every pot file, raw and parsed, in name order. */
export function readPotFiles(clone) {
  const dir = join(clone, "WHITE_PAGES");
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => /^pot-[a-z0-9][a-z0-9-]*\.json$/.test(n)).sort().map((name) => {
    const text = lf(readFileSync(join(dir, name), "utf8"));
    let meta = null, error = null;
    try { meta = JSON.parse(text); } catch (e) { error = String(e?.message ?? e).slice(0, 120); }
    if (!error && (meta === null || typeof meta !== "object" || Array.isArray(meta))) { meta = null; error = "not a JSON object"; }
    return { id: name.slice(4, -5), name, text, meta, error };
  });
}

/** The ledger, the registry, the dial, the pots and the provisional record, as one frozen reading. */
export function readTown(clone, engine) {
  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(ledgerPath) ? engine.parseStampLedger(readFileSync(ledgerPath, "utf8")) : [];
  return {
    entries,
    households: engine.householdKeys(clone),
    dial: engine.keepingDial(clone),
    pots: readPotFiles(clone),
    provisional: readProvisional(clone),
  };
}

const tailDateOf = (entries) => entries.reduce((mx, e) => { const d = /^- (\d{4}-\d{2}-\d{2}) /.exec(e.canonical)?.[1]; return d && d > mx ? d : mx; }, "0000-00-00");

// ── THE PLANNER (pure) ──────────────────────────────────────────────────────

const holoFor = (derived, ref) => derived.rows.find((r) => r.kind === "holo" && r.ref === ref);

/**
 * Derive the whole month, in order, over an in-memory prefix. Pure: reads nothing, writes nothing,
 * loads no signer. `town` is readTown's answer, `engine` the town's pinned engine, `attested` the
 * checked attestations. Returns { refusals, pots, fingerprintInput }: a pot's status is
 * "selected" (will be closed), "already-complete", "skipped" (not this command's: once, draft,
 * closed, no file) or "blocked" (the plan cannot be applied while this stands).
 */
export function derivePlan({ engine, town, month, date, attested, order = MONTH_CLOSE_ORDER }) {
  const refusals = [];
  const { dial, households } = town;
  if (!dial) refusals.push(refusal("no-dial", "no readable law_side.keeping in ECONOMY-DIALS.json: the split must be declared before a close"));
  if (!town.entries.length) refusals.push(refusal("ledger-unfounded", "the stamp ledger holds no lines: nothing to close onto"));
  const byId = new Map(town.pots.map((p) => [p.id, p]));
  const attestOf = new Map(attested.map((a) => [a.pot, a]));
  const pots = [];
  let prefix = town.entries.map((e) => ({ canonical: e.canonical }));
  const lineCount = [prefix.length];
  let prov = town.provisional;
  let provData = prov.data;
  const credited = provData?.credited_to;

  // every pot the file system says could be closed this month, and is not in the reviewed order
  for (const p of town.pots) {
    if (order.includes(p.id) || p.id === "treasury") continue;
    if (p.error) { pots.push({ pot: p.id, status: "blocked", code: "unreadable-pot", reason: `WHITE_PAGES/${p.name} is not JSON (${p.error})` }); continue; }
    const once = p.meta?.closes_at_fill === true || p.meta?.epoch_cadence === "once";
    // a once pot closes at fill, and a draft or closed pot takes no close: never this command's, and said so
    if (once) { pots.push({ pot: p.id, status: "skipped", code: "once", reason: "a once pot (closes at fill)" }); continue; }
    if (p.meta?.status !== "open") { pots.push({ pot: p.id, status: "skipped", code: "not-open", reason: `${p.meta?.status ?? "no status"}, not open` }); continue; }
    pots.push({ pot: p.id, status: "blocked", code: "unordered-pot", reason: p.meta?.epoch_cadence === "monthly"
      ? `an open monthly pot that is not in the reviewed order (${order.join(" → ")}): adding it is a ruling, and it is never closed in file order`
      : `an open pot whose cadence ${JSON.stringify(p.meta?.epoch_cadence ?? null)} is neither monthly nor once: this command cannot tell what it should do with it` });
  }
  for (const a of attested) if (!order.includes(a.pot)) pots.push({ pot: a.pot, status: "blocked", code: "attested-unknown-pot", reason: `Starforge attests ${a.pot}, which is not in the reviewed order` });

  for (const pot of order) {
    const file = byId.get(pot);
    const att = attestOf.get(pot) ?? null;
    const row = { pot, order: order.indexOf(pot) + 1, attested: att };
    const skip = (reason, code = "skipped") => { pots.push({ ...row, status: "skipped", code, reason }); };
    if (!file) { if (att) pots.push({ ...row, status: "blocked", code: "attested-no-pot", reason: `Starforge attests ${pot}, which has no pot file` }); else skip(`no WHITE_PAGES/pot-${pot}.json`, "no-pot-file"); continue; }
    if (file.error) { pots.push({ ...row, status: "blocked", code: "unreadable-pot", reason: `WHITE_PAGES/${file.name} is not JSON (${file.error})` }); continue; }
    const meta = file.meta;
    if (meta.closes_at_fill === true || meta.epoch_cadence === "once") { att ? pots.push({ ...row, status: "blocked", code: "attested-once-pot", reason: `Starforge attests ${pot}, a once pot: it closes at fill, not in a month` }) : skip("a once pot (closes at fill)", "once"); continue; }
    if (meta.epoch_cadence !== "monthly") { pots.push({ ...row, status: "blocked", code: "not-monthly", reason: `${pot} is in the reviewed order but its cadence is ${JSON.stringify(meta.epoch_cadence ?? null)}, not monthly` }); continue; }
    const entryAt = (Array.isArray(provData?.entries) ? provData.entries : []).filter((e) => e.pot === pot && e.epoch === month);
    const closed = engine.foldClosedEpochs(prefix).has(`${pot}|${month}`);

    if (closed) {
      if (att && !entryAt.length) { pots.push({ ...row, status: "blocked", code: "closed-without-provisional", reason: `${pot} ${month} is already closed and Starforge attests ${att.usd} dollars, but no provisional entry stands: an inconsistent pair is a reconciliation, never an append` }); continue; }
      if (att && (entryAt.length !== 1 || !sameAttested(entryAt[0], att))) { pots.push({ ...row, status: "blocked", code: "provisional-conflict", reason: `${entryAt.length} provisional entr${entryAt.length === 1 ? "y stands" : "ies stand"} for ${pot} ${month} and ${entryAt.length === 1 ? "it differs from" : "they do not match"} what Starforge attests (${att.usd} dollars, ${refOf(att)}): a conflict is never overwritten or duplicated` }); continue; }
      pots.push({ ...row, status: "already-complete", reason: att ? `closed, and its provisional entry stands (${refOf(att)})` : "already closed", provisional_entry: entryAt[0] ?? null });
      continue;
    }
    if (meta.status !== "open") { att ? pots.push({ ...row, status: "blocked", code: "attested-not-open", reason: `Starforge attests ${pot}, which is ${meta.status}, not open` }) : skip(`${meta.status}, not open`, "not-open"); continue; }

    // an entry for a pot this run is about to close: only a matching attestation may find it, and then it is a reconciliation
    if (entryAt.length) { pots.push({ ...row, status: "blocked", code: "provisional-without-close", reason: `a provisional entry stands for ${pot} ${month} but the pot is not closed: an inconsistent pair is a reconciliation, never an append` }); continue; }

    const derived = engine.deriveEpochClose({ entries: prefix, households, pot, potMeta: meta, epoch: month, date, dial });
    if (!derived.ok) { pots.push({ ...row, status: "blocked", code: "close-refused", reason: derived.error }); continue; }
    const lines = derived.rows.map(engine.keepingLine);
    const result = { ...row, status: "selected", lines, report: derived.report, ledger_before: lineCount.at(-1) };
    // The town's close takes the WHOLE unsettled roll and windows nothing by date (deriveEpochClose § dollars). A receipt dated
    // on or after the first of the next month is the next epoch's by its date and is swept into this close by the law. Said, not refused.
    const { receipts: allReceipts, settled } = engine.foldPotReceipts(prefix);
    const late = allReceipts.filter((r) => r.pot === pot && !settled.has(r.ref) && r.date >= firstOfNext(month)).map(({ date: d, usd, from, ref }) => ({ date: d, usd, from, ref }));
    if (late.length) result.late_receipts = late;

    if (att) {
      if (!provData) { pots.push({ ...row, status: "blocked", code: "no-provisional-record", reason: "Starforge dollars are attested but WHITE_PAGES/starforge-provisional.json does not exist: this command never creates the public record" }); continue; }
      if (!credited || typeof credited !== "string") { pots.push({ ...row, status: "blocked", code: "no-credited-household", reason: "the provisional record names no credited_to: the counterfactual has no household to run as" }); continue; }
      const synth = `starforge-provisional:${month}:${pot}`;
      if (prefix.some((e) => e.canonical.includes(`ref: ${synth}`))) { pots.push({ ...row, status: "blocked", code: "synthetic-ref-taken", reason: `the counterfactual's reference ${synth} is already in the ledger` }); continue; }
      // the same law, once more, on a COPY of the prefix with the attested dollars as a grant receipt: read its one holo row, drop the copy
      const copy = [...prefix, { canonical: engine.potReceiptLine({ date, pot, rail: "grant", usd: att.usd, from: credited, ref: synth }) }];
      const cf = engine.deriveEpochClose({ entries: copy, households, pot, potMeta: meta, epoch: month, date, dial });
      const holo = cf.ok ? holoFor(cf, synth) : null;
      if (!cf.ok || !holo) { pots.push({ ...row, status: "blocked", code: "counterfactual-refused", reason: cf.ok ? "the counterfactual close wrote no row for the attested dollars" : cf.error }); continue; }
      const payer = cf.report.payers.find((p) => p.handle === credited);
      const funded = (cf.report.fundedFraction * 100).toFixed(1);
      const entry = {
        date, pot, epoch: month, usd: att.usd, holo_would_mint: holo.n,
        why: `operator-attested Starforge contribution toward ${pot}'s ${month} epoch (${refOf(att)})`,
        computed: `tools/month-close.mjs: the close run again as if ${att.usd} dollars were a grant receipt from ${credited}, on the in-memory ledger prefix of ${lineCount.at(-1)} line(s) (real closes only, Starforge excluded): funded ${funded}%, mass ${cf.report.stakesOpen}, ${credited} mint ${holo.n} under a cap room of ${payer?.roomLeft ?? "n/a"}; town pins ${readPins().town_commit.slice(0, 8)}`,
      };
      result.provisional = { credited_to: credited, entry, before_sha: sha256(serializeProvisional(prov, provData)) };
      provData = withEntry(provData, entry);
      result.provisional.after_sha = sha256(serializeProvisional(prov, provData));
      result.provisional.counterfactual = { funded_fraction: cf.report.fundedFraction, stakes_open: cf.report.stakesOpen, mint: holo.n, room_left: payer?.roomLeft ?? null };
    }
    prefix = [...prefix, ...lines.map((canonical) => ({ canonical }))];
    lineCount.push(prefix.length);
    result.ledger_after = prefix.length;
    pots.push(result);
  }

  if (!pots.some((p) => p.status === "selected" || p.status === "already-complete") && !pots.some((p) => p.status === "blocked"))
    refusals.push(refusal("nothing-to-close", `none of the reviewed pots has a ${month} close to make: an empty month is an error here, never a silent success`));
  for (const p of pots) if (p.status === "blocked") refusals.push(refusal(p.code, p.reason, p.pot));
  const seals = engine.sealChain(prefix.map((e) => e.canonical));
  for (const p of pots) if (p.status === "selected") { p.tail_seal_before = p.ledger_before ? seals[p.ledger_before - 1] ?? null : null; p.tail_seal_after = seals[p.ledger_after - 1]; }
  const ordered = [...pots].sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.pot.localeCompare(b.pot));
  return { refusals, pots: ordered, ledger: { lines_before: town.entries.length, lines_after: prefix.length, tail_date: tailDateOf(town.entries) }, seals };
}

/** The sha256 of every governing input and every planned row. A reviewer's number; apply binds to it. */
export function fingerprintOf({ month, date, town, plan, attested, townCommit, engineSeals }) {
  const inputs = {
    version: PLAN_VERSION, month, date, tz: TZ, order: MONTH_CLOSE_ORDER, town_commit: townCommit,
    dial: town.dial,
    ledger: { lines: town.entries.length, tail_seal: town.entries.length ? engineSeals[town.entries.length - 1] : null },
    registry: sha256(JSON.stringify([...town.households.entries()].sort((a, b) => a[0].localeCompare(b[0])))),
    pot_files: town.pots.map((p) => [p.id, sha256(p.text)]),
    provisional: town.provisional.exists ? sha256(town.provisional.text) : null,
    attested,
    plan: plan.pots.map((p) => ({ pot: p.pot, status: p.status, code: p.code ?? null, lines: p.lines ?? null, provisional: p.provisional ? { entry: p.provisional.entry, after: p.provisional.after_sha } : null })),
  };
  return sha256(JSON.stringify(inputs));
}

// ── the preflight: the store and the verifier, read-only ────────────────────

/** The town's pinned verifier over the clone, as the ferry runs it. { ok, output }. A pin stop is not green. */
export function verifyTownDefault(clone) {
  let argv;
  try { argv = townToolArgv(clone, "stamp-verify.mjs"); }
  catch (e) { return { ok: false, output: `${isPinStop(e) ? "the town's code is not the office's pinned copy: " : ""}${e?.message ?? e}` }; }
  const r = spawnSync(process.execPath, argv, { cwd: clone, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return { ok: r.status === 0, output: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };
}

/**
 * Everything the plan stands on that is not a pure derivation: the clone is clean, the store
 * write is the store-backed one, the store is reachable and equals the export, and the town's own
 * verifier is green (which is also what "the tail is settled" means). Reads only. Never loads a signer.
 */
export async function preflight({ clone, engine, env = process.env, verifyTown = verifyTownDefault }) {
  const out = [];
  if (!stampLinesOn(env)) out.push(refusal("store-not-on", "STAMP_LINES is not `store`: this command lands only through the store-backed seam and never through the plain-Git fallback"));
  let dirt = [];
  try { dirt = cloneDirt(clone); } catch (e) { out.push(refusal("clone-unreadable", `the town clone cannot be read: ${String(e?.message ?? e).slice(0, 160)}`)); }
  if (dirt.length) out.push(refusal("clone-dirty", `the town clone has uncommitted paths (${dirt.slice(0, 4).join(", ")}): nothing is planned over dirt`));
  if (stampLinesOn(env)) {
    try {
      const v = await officeRead((q) => verifyStampLinesVia(q, clone, { engine }), { env });
      if (!v.ok) out.push(refusal("store-unverified", `the store and the export disagree (${v.held} held, ${v.exported} exported): ${v.problems[0]}`));
    } catch (e) { out.push(refusal("store-unreachable", `the store cannot be read: ${String(e?.message ?? e).slice(0, 160)}`)); }
  }
  const t = verifyTown(clone);
  if (!t.ok) out.push(refusal("ledger-unsettled", `the town's verifier is not green (a ledger behind the mail is red here): ${t.output.split("\n").slice(0, 3).join(" | ")}`));
  return out;
}

/**
 * THE DRY RUN. Reads, derives, fingerprints; appends nothing, pushes nothing, loads no signer, and
 * runs no sync. `{ ok, refusals, plan, fingerprint }`; a refused plan carries no fingerprint, so
 * there is nothing to apply.
 */
export async function planMonthClose({ clone, month, date, attestations = null, now = new Date(), env = process.env, verifyTown = verifyTownDefault, engine = null }) {
  const att = checkAttestations(attestations);
  let eng = engine;
  if (!eng) {
    try { eng = await engineOf(clone); }
    catch (e) { return { ok: false, refusals: [refusal(isPinStop(e) ? "town-pin-mismatch" : "no-engine", `the town's engine cannot be loaded: ${String(e?.message ?? e).slice(0, 200)}`)], plan: null, fingerprint: null }; }
  }
  const town = readTown(clone, eng);
  const refusals = [...att.refusals, ...whenRefusals({ month, date, now, tailDate: town.entries.length ? tailDateOf(town.entries) : null })];
  if (town.provisional.exists && (town.provisional.data === null || !town.provisional.roundTrips))
    refusals.push(refusal("provisional-unreadable", `WHITE_PAGES/starforge-provisional.json ${town.provisional.data === null ? "is not JSON" : "does not round-trip through JSON byte for byte"}: it is never rewritten on a guess`));
  if (att.list.length && town.provisional.data && !Array.isArray(town.provisional.data.entries)) refusals.push(refusal("provisional-unreadable", "the provisional record has no entries array"));
  if (refusals.some((r) => ["invalid-month", "invalid-date"].includes(r.code))) return { ok: false, refusals, plan: null, fingerprint: null };
  refusals.push(...(await preflight({ clone, engine: eng, env, verifyTown })));
  const derived = derivePlan({ engine: eng, town, month, date, attested: att.list });
  refusals.push(...derived.refusals);
  const plan = { month, date, tz: TZ, order: MONTH_CLOSE_ORDER, pots: derived.pots, ledger: derived.ledger, attested: att.list, town_commit: readPins().town_commit };
  const ok = refusals.length === 0;
  const fingerprint = ok ? fingerprintOf({ month, date, town, plan, attested: att.list, townCommit: plan.town_commit, engineSeals: derived.seals }) : null;
  return { ok, refusals, plan, fingerprint, _town: town, _engine: eng };
}

/** The plan as the operator reads it. */
export function renderPlan({ ok, refusals, plan, fingerprint }) {
  const L = [];
  if (plan) {
    L.push(`── monthly close · epoch ${plan.month} · effective ${plan.date} (${plan.tz} calendar) ──`);
    L.push(`reviewed order: ${plan.order.join(" → ")}   town pins: ${plan.town_commit.slice(0, 8)}   ledger: ${plan.ledger.lines_before} line(s) → ${plan.ledger.lines_after}`);
    for (const p of plan.pots) {
      L.push("", `[${p.status.toUpperCase()}] ${p.pot}${p.order ? ` (#${p.order})` : ""}${p.reason ? ` — ${p.reason}` : ""}`);
      if (p.report) {
        const r = p.report;
        L.push(`  beneficiary ${r.beneficiary}; ${r.elastic ? `elastic, floor $${r.closeFloor}` : `posted need $${r.potTarget}`}; dollars witnessed $${r.dollarsWitnessed} (funding $${r.dollarsFunding}) over ${r.receipts} receipt(s); funded ${(r.fundedFraction * 100).toFixed(1)}%`);
        L.push(`  stakes open ${r.stakesOpen}, returned whole ${r.returned}; mass sizes ${r.fundingMintSized}; minted to givers ${r.fundingMint}; un-minted ${r.unmintedRemainder}`);
        for (const g of r.payers) L.push(`  giver ${g.handle}: $${g.usd}, mass ${g.massForPayer}, mint ${g.mint}, cap room ${g.roomLeft}`);
        L.push(`  rows (${p.lines.length}), real ledger only:`, ...p.lines.map((l) => `    ${l}`));
      }
      if (p.late_receipts) L.push(`  NOTE: ${p.late_receipts.length} unsettled receipt(s) dated on or after ${firstOfNext(plan.month)} (${p.late_receipts.map((r) => `${r.date} $${r.usd} ${r.ref}`).join("; ")}): the town's close takes the whole unsettled roll and windows nothing by date, so they are swept into this close`);
      if (p.provisional) L.push(`  Starforge PROVISIONAL (never minted, never a receipt): $${p.provisional.entry.usd} attested → ${p.provisional.entry.holo_would_mint} stamps the law would credit ${p.provisional.credited_to}`, `    ${p.provisional.entry.why}`);
      else if (p.status === "selected") L.push("  Starforge: nothing attested for this pot");
    }
  }
  L.push("");
  if (refusals.length) { L.push("REFUSED — nothing can be applied:", ...refusals.map((r) => `  · ${r.code}${r.pot ? ` (${r.pot})` : ""}: ${r.message}`)); }
  else L.push(`plan fingerprint: ${fingerprint}`, "dry run: nothing was appended, pushed or signed.");
  return L.join("\n");
}

// ── THE APPLY ───────────────────────────────────────────────────────────────

const git = (clone, ...a) => execFileSync("git", ["-C", clone, ...a], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const remoteTip = (clone) => { try { return git(clone, "ls-remote", "origin", "refs/heads/main").split(/\s+/)[0] || null; } catch { return null; } };
const onRemote = (clone, sha) => {
  if (git(clone, "cat-file", "-t", sha) !== "commit") return false;
  const r = spawnSync("git", ["-C", clone, "merge-base", "--is-ancestor", sha, "origin/main"], { encoding: "utf8" });
  if (r.status === 0) return true;
  if (r.status === 1) return false;
  throw new Error(`merge-base --is-ancestor exited ${r.status}: ${r.stderr}`);
};

/** The town's own close, as the pinned child (the one seam law). The key is read by the child, only here. */
export function runCloseDefault({ clone, pot, month, date, keyPath }) {
  const argv = townToolArgv(clone, "epoch-close.mjs", ["--close", "--pot", pot, "--epoch", month, "--date", date, "--key", keyPath, "--repo", clone]);
  return execFileSync(process.execPath, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

const ledgerLines = (clone, engine) => {
  const p = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  return existsSync(p) ? engine.parseStampLedger(readFileSync(p, "utf8")) : [];
};

/**
 * Close one planned pot: the town's CLI appends the signed rows, they are held to the plan's rows
 * byte for byte, the provisional entry is written, and the pen lands both in one stamped commit
 * through the store-backed planned seam. Returns { outcome, ... }; outcome is "closed",
 * "not-landed" (nothing anywhere changed) or "reconciliation-required" (Git landed or may have).
 * `hooks` are test failpoints, never set by the CLI.
 */
async function closeOnePot({ clone, engine, entry, month, date, keyPath, env, runClose, hooks }) {
  let stage = "pre-write", gitLanded = null;
  const base = remoteTip(clone);
  const fail = (code, defect) => ({ error: { code, defect, stage } });
  let answer;
  try {
    answer = await penTransaction(clone, async () => {
      if (hooks.beforeWrite) await hooks.beforeWrite(entry);
      const have = ledgerLines(clone, engine);
      const seal = have.length ? engine.sealChain(have.map((e) => e.canonical)).at(-1) : null;
      if (have.length !== entry.ledger_before || seal !== entry.tail_seal_before) return fail(409, `the ledger is not the prefix the plan stood on (${have.length} line(s), expected ${entry.ledger_before})`);
      let prov = null;
      if (entry.provisional) {
        prov = readProvisional(clone);
        if (!prov.roundTrips || sha256(serializeProvisional(prov, prov.data)) !== entry.provisional.before_sha) return fail(409, "the provisional record is not the one the plan stood on");
      }
      stage = "closing";
      try { runClose({ clone, pot: entry.pot, month, date, keyPath }); }
      catch (e) { return fail(500, `the town's close did not run: ${String(e?.stderr ?? e?.message ?? e).split("\n").find((l) => l.trim()) ?? "no output"}`); }
      const after = ledgerLines(clone, engine);
      const added = after.slice(have.length).map((e) => e.canonical);
      if (after.length !== entry.ledger_after || JSON.stringify(added) !== JSON.stringify(entry.lines))
        return fail(500, `the town's close did not append the planned rows (${added.length} appended, ${entry.lines.length} planned): nothing is landed`);
      if (entry.provisional) {
        const next = serializeProvisional(prov, withEntry(prov.data, entry.provisional.entry));
        if (sha256(next) !== entry.provisional.after_sha) return fail(500, "the provisional record would not be the one the plan computed");
        writeFileSync(prov.path, next);
      }
      stage = "planning";
      const plan = await planStampedCommit(clone, { env, engine });
      if (!plan) return fail(409, "the store-backed landing is off: refusing the plain-Git road");
      if (hooks.afterPlan) await hooks.afterPlan(plan);
      if (plan.rows.length !== entry.lines.length || plan.rows[0]?.[0] !== entry.ledger_before + 1)
        return fail(409, `the store does not hold the ledger up to the plan's prefix (it would record ${plan.rows.length} row(s) from ${plan.rows[0]?.[0] ?? "none"}, expected ${entry.lines.length} from ${entry.ledger_before + 1})`);
      stage = "landing";
      const paths = [join(clone, "WHITE_PAGES", "stamp-ledger.md"), ...(entry.provisional ? [join(clone, PROVISIONAL_REL)] : [])];
      const message = `close: ${entry.pot} ${month} (the monthly close, ${entry.lines.length} row(s)${entry.provisional ? "; Starforge provisional recorded" : ""})`;
      const landed = await officeWrite(async (client) => {
        const out = await landPlannedVia(client, clone, plan, paths, message, { env });
        if (out.moved) throw MOVED;
        if (out.error) throw Object.assign(new Error(out.error.defect), { notLanded: out.error });
        gitLanded = out.commit;
        if (hooks.afterGitLanded) await hooks.afterGitLanded(out.commit);
        return out;
      }, { env });
      return { commit: landed.commit };
    });
  } catch (e) {
    if (gitLanded) return { outcome: "reconciliation-required", pot: entry.pot, commit: gitLanded, detail: `Git landed ${gitLanded} and the store's COMMIT then failed (${String(e?.message ?? e).slice(0, 160)}): the store is behind its export` };
    if (e === MOVED) return { outcome: "not-landed", pot: entry.pot, detail: "the store's stamp head moved between the plan and the landing: nothing was written" };
    if (e?.notLanded) return { outcome: "not-landed", pot: entry.pot, detail: `the push could not land (${e.notLanded.defect}): nothing was recorded` };
    if (stage === "landing") {
      const now = remoteTip(clone);
      if (now !== null && now === base) return { outcome: "not-landed", pot: entry.pot, detail: `${String(e?.message ?? e).slice(0, 160)} (the remote's tip is unchanged: nothing landed)` };
      return { outcome: "reconciliation-required", pot: entry.pot, commit: null, detail: `the landing failed at the push or the store (${String(e?.message ?? e).slice(0, 160)}) and the remote's tip ${now === null ? "could not be read" : "moved"}: whether Git landed is not proven` };
    }
    return { outcome: "not-landed", pot: entry.pot, detail: `${stage}: ${String(e?.message ?? e).slice(0, 200)}` };
  }
  if (answer?.error) return { outcome: "not-landed", pot: entry.pot, detail: `${answer.error.stage}: ${answer.error.defect}` };
  // verify the expected result before the next pot: the clone, the store and the remote all say the plan
  try {
    const have = ledgerLines(clone, engine);
    const seal = engine.sealChain(have.map((e) => e.canonical)).at(-1);
    const head = await officeRead((q) => stampHeadVia(q), { env });
    const v = await officeRead((q) => verifyStampLinesVia(q, clone, { engine }), { env });
    const problems = [];
    if (have.length !== entry.ledger_after || seal !== entry.tail_seal_after) problems.push(`the clone's ledger is ${have.length} line(s), expected ${entry.ledger_after}, or its tail seal differs`);
    if ((head?.seq ?? 0) !== entry.ledger_after || head?.seal !== entry.tail_seal_after) problems.push(`the store's head is ${head?.seq ?? 0}, expected ${entry.ledger_after}, or its seal differs`);
    if (!v.ok) problems.push(`the verifier: ${v.problems[0]}`);
    if (!answer.commit || !onRemote(clone, answer.commit)) problems.push(`commit ${answer.commit} is not on origin/main`);
    if (problems.length) return { outcome: "reconciliation-required", pot: entry.pot, commit: answer.commit, detail: `landed, but the result is not the planned one: ${problems.join("; ")}` };
  } catch (e) {
    return { outcome: "reconciliation-required", pot: entry.pot, commit: answer.commit, detail: `landed, but the result could not be verified (${String(e?.message ?? e).slice(0, 160)})` };
  }
  return { outcome: "closed", pot: entry.pot, commit: answer.commit, ledger_after: entry.ledger_after, rows: entry.lines.length };
}

/**
 * THE APPLY. Bound to a reviewed fingerprint. Takes the town lock once for the batch, brings the
 * clone to the town, re-plans from scratch and refuses unless the fingerprint is the one reviewed,
 * then closes each selected pot in order, one stamped commit each, stopping at the first failure.
 * Status: "completed", "partial" (stopped after some pots, or none, with nothing landing for the
 * failing pot), "reconciliation-required" (Git landed, or may have, and the result is not proven),
 * "refused" (nothing written). Never a blanket success.
 */
export async function applyMonthClose({ clone, month, date, attestations = null, fingerprint, keyPath, now = new Date(), env = process.env, verifyTown = verifyTownDefault, runClose = runCloseDefault, hooks = {}, engine = null, lock = withTownLockHeld }) {
  const refused = (refusals) => ({ status: "refused", refusals, pots: [], not_attempted: [] });
  if (!/^[0-9a-f]{64}$/.test(String(fingerprint ?? ""))) return refused([refusal("no-fingerprint", "apply takes the fingerprint of a plan someone reviewed (--fingerprint, 64 hex): it never plans and applies in one breath")]);
  if (env.TOWN_PUSH !== "1") return refused([refusal("push-off", "TOWN_PUSH is not 1: a close that does not reach the town's remote is not a close")]);
  if (!stampLinesOn(env)) return refused([refusal("store-not-on", "STAMP_LINES is not `store`: this command never runs the plain-Git fallback")]);
  if (!keyPath || !existsSync(keyPath)) return refused([refusal("no-key", "the pen's key file is not there (STAMP_KEY / --key): nothing was written")]);
  const section = async ({ signal } = {}) => {
    try { freshenClone(clone); }
    catch (e) { return refused([refusal("clone-not-fresh", `the town clone could not be brought to the town: ${String(e?.defect ?? e?.message ?? e).slice(0, 200)}`)]); }
    const re = await planMonthClose({ clone, month, date, attestations, now, env, verifyTown, engine });
    if (!re.ok) return refused(re.refusals);
    if (re.fingerprint !== fingerprint) return refused([refusal("plan-changed", `the inputs are not the ones that were reviewed: the plan is now ${re.fingerprint}, not ${fingerprint}. A changed head, receipt, registry, metadata, law or ordered set needs a fresh dry run`)]);
    const eng = re._engine;
    const selected = re.plan.pots.filter((p) => p.status === "selected");
    const pots = [], notAttempted = [];
    let stopped = null;
    for (const entry of selected) {
      if (stopped) { notAttempted.push(entry.pot); continue; }
      if (signal?.aborted) { stopped = { outcome: "not-landed", pot: entry.pot, detail: "the lock's hold ran out: nothing more is written" }; pots.push(stopped); continue; }
      const r = await closeOnePot({ clone, engine: eng, entry, month, date, keyPath, env, runClose, hooks });
      pots.push(r);
      if (r.outcome !== "closed") stopped = r;
    }
    const complete = re.plan.pots.filter((p) => p.status === "already-complete").map((p) => p.pot);
    const status = !stopped ? "completed" : stopped.outcome === "reconciliation-required" ? "reconciliation-required" : "partial";
    return { status, refusals: [], pots, not_attempted: notAttempted, already_complete: complete, fingerprint };
  };
  try { return await lock(section, { shared: false, holdSec: APPLY_HOLD_SEC }); }
  catch (e) {
    // the lock was never taken (busy, unlockable): nothing was written. The hold ran out under a running section: what it had landed is unknown, so it is a reconciliation, never a retry.
    if (e?.defect === LOCK_HELD_TOO_LONG.defect) return { status: "reconciliation-required", refusals: [refusal("lock-hold-ran-out", `${e.defect}: ${e.hint}`)], pots: [], not_attempted: [] };
    if (typeof e?.code === "number" && typeof e?.defect === "string") return refused([refusal("lock-not-taken", `${e.defect}: ${e.hint ?? ""}`.trim())]);
    throw e;
  }
}

/** The apply's result as the operator reads it. */
export function renderApply(res) {
  const L = [`monthly close: ${res.status.toUpperCase()}`];
  for (const r of res.refusals ?? []) L.push(`  · ${r.code}${r.pot ? ` (${r.pot})` : ""}: ${r.message}`);
  for (const p of res.pots ?? []) L.push(`  ${p.pot}: ${p.outcome}${p.commit ? ` — commit ${p.commit}` : ""}${p.rows ? `, ${p.rows} row(s), ledger now ${p.ledger_after} line(s)` : ""}${p.detail ? ` — ${p.detail}` : ""}`);
  if (res.not_attempted?.length) L.push(`  not attempted: ${res.not_attempted.join(", ")}`);
  if (res.already_complete?.length) L.push(`  already complete: ${res.already_complete.join(", ")}`);
  if (res.status === "partial") L.push("  Earlier pots stay closed. A continuation needs a NEW dry run against the ledger as it stands.");
  if (res.status === "reconciliation-required") L.push("  Do NOT run the close again. Git holds the landing and the store may be behind its export: an authorized owner reads world2/tools/stamp-lines.mjs --verify and reconciles (--sync records the lines the export holds past the store, after checking their signatures) before any further write.");
  return L.join("\n");
}

/** Exit codes: 0 done, 2 usage, 10 refused (nothing written), 11 partial, 12 reconciliation required. */
export const EXIT = { ok: 0, usage: 2, refused: 10, partial: 11, reconciliation: 12 };
