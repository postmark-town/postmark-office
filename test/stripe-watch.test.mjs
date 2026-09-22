// stripe-watch.test.mjs — falsifiers for the card rail's rule.
//
// THE VALIDATION RULE (Keemin, 2026-08-21): every falsifier CITES THE SENTENCE
// OF LAW IT ASSERTS, quoted verbatim in the test itself.
//
// Stripe is INJECTED. The fake account here answers the query it is HANDED
// rather than replaying a canned list, so a test that claims "only completed
// sessions are read" is asserting something about the request we send and not
// about our own incuriosity — the same distinction usdc-watch.test.mjs draws
// about the chain filter.
//
// The LEDGER is REAL: every recorded receipt in this file is written by the
// TOWN'S OWN epoch-close CLI through the office's own fund-exec recorder, and
// read back through the town's own foldPotReceipts. A hand-rolled ledger scan
// or a hand-written row would be a second copy of the rule, and this whole lane
// exists because there must be exactly one.

import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { isResidentHandle } from "../src/residency.mjs";
import { CROSSING_MS } from "../src/crossings.mjs";
import { townLoginHands } from "../src/household-logins.mjs";
import {
  decide, decodeSession, resolveSession, listCompleteSessions, stripeReader,
  attachSettlement, settlementOf,
  OUTSIDE_FROM, HANDLE_FIELD, RAIL, MIN_USD, SETTLE_CURRENCY,
} from "../tools/stripe-watch.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// The repo's own clone first, then the seam clone the funding falsifiers have
// always used. No process.env read: this suite carries an env-invariance guard
// (test/freshness-ladder.test.mjs) and a fixture that changes shape with an
// exported variable is the exact thing it exists to catch.
const TOWN = [resolve(HERE, "..", "town-clone"), "G:/postmark/seam-overnight/town-clone"]
  .find((p) => existsSync(join(p, "tools", "stamp-mint.mjs")));
const ENGINE = await import(`file:///${TOWN}/tools/stamp-mint.mjs`);

const CS_A = "cs_test_a11111111111111111111111";
const CS_B = "cs_test_b22222222222222222222222";
const CS_C = "cs_test_c33333333333333333333333";

// ── a Stripe account that honours the query ─────────────────────────────────
function stripeAccount({ sessions = [], throws = false } = {}) {
  const calls = [];
  const stripe = async (path, params = {}) => {
    calls.push({ path, params });
    if (throws) throw new Error("Stripe refused the read (401): Invalid API Key provided");
    if (path !== "/checkout/sessions") throw new Error(`unexpected path ${path}`);
    let rows = sessions.slice();
    if (params.status) rows = rows.filter((s) => s.status === params.status);
    if (params["created[gte]"] != null) rows = rows.filter((s) => s.created >= Number(params["created[gte]"]));
    rows.sort((a, b) => b.created - a.created); // Stripe lists newest first
    if (params.starting_after) {
      const i = rows.findIndex((s) => s.id === params.starting_after);
      rows = i > -1 ? rows.slice(i + 1) : rows;
    }
    const limit = Number(params.limit ?? 10);
    return { object: "list", data: rows.slice(0, limit), has_more: rows.length > limit };
  };
  return { stripe, calls };
}

// `settled` is the SETTLED pair, and it is written here exactly where Stripe
// writes it: on the balance transaction of the charge of the payment intent.
// A session with `settled: null` (the default, and every USD fixture in this
// file) leaves `payment_intent` the bare string id it has always been — which
// is the real shape of an unexpanded session, so no USD falsifier below had to
// learn a new fixture to keep passing.
const sess = ({
  id, created, amount = 1000, currency = "usd", pot = "keep", handle = null,
  livemode = true, payment_status = "paid", status = "complete", email = "patron@example.test",
  settled = null,
}) => ({
  id, object: "checkout.session", created, status, payment_status, livemode,
  amount_total: amount, currency, client_reference_id: pot,
  customer_details: { email },
  custom_fields: handle === null ? [] : [{ key: HANDLE_FIELD, type: "text", text: { value: handle } }],
  payment_intent: settled === null ? `pi_${id.slice(3)}` : {
    id: `pi_${id.slice(3)}`, object: "payment_intent",
    latest_charge: {
      id: `ch_${id.slice(3)}`, object: "charge",
      balance_transaction: { id: `txn_${id.slice(3)}`, object: "balance_transaction", ...settled },
    },
  },
});

// ── a throwaway town with a real, sealed ledger ─────────────────────────────
// `pins` is the town's own tools/github-ids.json. The default is the two-handle
// town every falsifier above this line was written against and must not move;
// the login-pin falsifiers below hand in a richer one, because a login that
// binds one hand and a login that binds six are the same file to the reader and
// opposite answers to the rule.
function seamTown({ pots = { keep: 1000, small: 5 }, pins = { paz: { login: "p", id: 2 }, stan: { login: "s", id: 1 } } } = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const repo = mkdtempSync(join(tmpdir(), "stripe-town-"));
  mkdirSync(join(repo, "tools"), { recursive: true });
  mkdirSync(join(repo, "WHITE_PAGES"), { recursive: true });
  writeFileSync(join(repo, "tools", "github-ids.json"), JSON.stringify(pins));
  writeFileSync(join(repo, "WHITE_PAGES", "mail-ledger.md"), "# ledger\n\n- 2026-06-12 · m-1 · stan → paz · thread: new\n");
  writeFileSync(join(repo, "tools", "stamp-pubkey.pem"), publicKey.export({ type: "spki", format: "pem" }));
  writeFileSync(join(repo, "ECONOMY-DIALS.json"), JSON.stringify({
    law_side: { town_issuance: { treasury_handle: "the-town", once_purposes: [] }, keeping: { sigma: 0.5, rho: 0.5, rho_constitutional_ceiling: 0.5 } },
  }));
  for (const [id, target] of Object.entries(pots))
    writeFileSync(join(repo, "WHITE_PAGES", `pot-${id}.json`), JSON.stringify({ pot: id, status: "open", beneficiary: "keeper", target_usd_per_epoch: target, epoch_cadence: "monthly", received_usd: 0 }));
  writeFileSync(join(repo, "WHITE_PAGES", "pot-shut.json"), JSON.stringify({ pot: "shut", status: "draft", beneficiary: null, target_usd_per_epoch: 100, epoch_cadence: "monthly", received_usd: 0 }));
  const keyFile = join(repo, "stamp-key.pem");
  writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }));
  execFileSync(process.execPath, [join(TOWN, "tools", "stamp-mint.mjs"), "--append", "--key", keyFile, "--repo", repo], { encoding: "utf8" });
  return { repo, keyFile };
}

const ledgerText = (repo) => readFileSync(join(repo, "WHITE_PAGES", "stamp-ledger.md"), "utf8");
const entriesOf = (repo) => ENGINE.parseStampLedger(ledgerText(repo));
const ctx = (town, over = {}) => ({
  engine: ENGINE,
  entries: entriesOf(town.repo),
  clone: town.repo,
  households: ENGINE.householdKeys(town.repo),
  // The SECOND channel, derived by the town's own resolver through the office's
  // one projection. Handed in like everything else, so a falsifier can withhold
  // it and watch the rule fall back to the published one.
  loginHands: townLoginHands(town.repo, ENGINE),
  ...over,
});

/** The production recorder, driven straight at fund-exec through the town CLI. */
const cliRecorder = ({ repo, keyFile }, rail = RAIL) => async ({ pot, usd, from, ref }) => {
  execFileSync(process.execPath, [
    join(TOWN, "tools", "epoch-close.mjs"), "--receipt", "--pot", pot, "--rail", rail,
    "--usd", String(usd), "--from", from, "--ref", ref, "--date", "2026-08-01",
    "--key", keyFile, "--repo", repo,
  ], { encoding: "utf8", stdio: "pipe" });
  return { line: entriesOf(repo).at(-1)?.raw ?? "", commit: null };
};

// ════════════════════════════════════════════════════════════════════════════
// THE POT — from the session, never from a guess
// ════════════════════════════════════════════════════════════════════════════

test("the pot comes from the session's own client_reference_id, and a session without one is never guessed at", async () => {
  // LAW (tools/epoch-close.mjs --receipt, verbatim): `no pot file
  //     WHITE_PAGES/pot-${pot}.json — a receipt needs the pot it pays`.
  //
  // The town has more than one pot open, which is exactly what made the shared
  // Stripe link stop carrying intent (2026-08-25, the first real $10). A
  // watcher that fell back to "the only pot" would have been right until the
  // day it silently started being wrong about a stranger's money.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const named = resolveSession(decodeSession(sess({ id: CS_A, created: old, pot: "keep", handle: "paz" })), { ...ctx(town), now });
  assert.equal(named.disposition, "witness");
  assert.equal(named.pot, "keep");

  const bare = resolveSession(decodeSession(sess({ id: CS_B, created: old, pot: null, handle: "paz" })), { ...ctx(town), now });
  assert.equal(bare.disposition, "anomaly");
  assert.equal(bare.anomaly, "needs-pot");
  assert.match(bare.rule, /a receipt needs the pot it pays/);
  assert.equal(bare.pot, undefined, "no pot was invented for it");
  // WHICH ARM answered, and the flip is why this line exists: deleting the
  // missing-reference guard left the suite GREEN, because the pot GATE below it
  // then refused `no pot named "null"` and the disposition came out the same.
  // Two guards can both be right and only one can be the one that speaks to the
  // operator — the reference-shaped defect must say so in its own words, or the
  // queue tells the founder to go open a pot called "null".
  assert.match(bare.why, /names no pot \(no client_reference_id\)/);
  assert.match(bare.resolves, /Sessions created after site main b2260e7a carry the pot automatically/);

  // a pot the town posts but has not opened is refused the same way
  const draft = resolveSession(decodeSession(sess({ id: CS_C, created: old, pot: "shut", handle: "paz" })), { ...ctx(town), now });
  assert.equal(draft.anomaly, "needs-pot");
  assert.match(draft.why, /is draft, not open/);
});

// ════════════════════════════════════════════════════════════════════════════
// THE HAND — a match, or a gift; never a near-match
// ════════════════════════════════════════════════════════════════════════════

test("an exactly-matching handle becomes the payer, and anything else becomes a gift that mints no holo", async () => {
  // LAW (the fund page, the card rail's own warning, verbatim): "Tell the town
  //     which handle it was for when you pay, or write and say so — a payment
  //     the office cannot attach to a hand can still be a gift, but it cannot
  //     mint your holo."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (id, handle) => resolveSession(decodeSession(sess({ id, created: old, handle })), { ...ctx(town), now });

  const mine = at(CS_A, "paz");
  assert.equal(mine.from, "paz");
  assert.equal(mine.attributed, true);
  assert.equal(mine.gift_note, undefined);

  // one letter wrong is not a household, and the office does not go looking for
  // the nearest one — a fuzzy match on a name is the office deciding whose
  // dollar this was
  const typo = at(CS_B, "pazz");
  assert.equal(typo.from, OUTSIDE_FROM);
  assert.equal(typo.attributed, false);
  assert.match(typo.gift_note, /"pazz" is not a household the town knows/);
  assert.match(typo.gift_note, /can still be a gift, but it cannot mint your holo/);

  const none = at(CS_C, null);
  assert.equal(none.from, OUTSIDE_FROM);
  assert.match(none.gift_note, /no handle was given/);
});

test("the gift spelling can never collide with a handle, and the ledger still takes it", async () => {
  // LAW (src/funding.mjs, the pot-receipt grammar, verbatim): the payer rides
  //     `from: (\S+)` — anything without whitespace. And (src/residency.mjs) a
  //     handle is lowercase letters, digits and single hyphens.
  //
  // So `outside:stripe` is legible BY SHAPE as a payer that is not a household,
  // with no list to consult, and cannot ever be minted as a name.
  assert.equal(isResidentHandle(OUTSIDE_FROM), false, "no household can ever be called this");

  const town = seamTown();
  await cliRecorder(town)({ pot: "keep", usd: 7, from: OUTSIDE_FROM, ref: `${RAIL}:${CS_A}` });
  const rows = ENGINE.foldPotReceipts(entriesOf(town.repo)).receipts;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].from, OUTSIDE_FROM);
  assert.match(ledgerText(town.repo), new RegExp(`pot-receipt · pot:keep · rail: ${RAIL} · usd: 7 · from: outside:stripe`));
});

// ════════════════════════════════════════════════════════════════════════════
// THE HAND, SECOND CHANNEL — a login the town has ALREADY PINNED
// ════════════════════════════════════════════════════════════════════════════
//
// THE LIVE CASE these were written from (2026-08-26, session cs_live_a1VF2VOB…,
// $20 to darko-fund): the payer typed `herzfunke-martina`, which is not a
// resident handle — it is their GITHUB LOGIN. The town's own pins bind that
// login to household gh:305439322, whose one resident handle is
// `sol-am-lichterfenster`. Filed as a gift, that dollar mints no holo, and
// "one dollar, one mint chance, forever" means there is no second try.
//
// The rule these assert is NOT "look harder for a name". It is that the town
// already wrote this binding down, under review, in its own pins file — so
// reading it is reading the record, and the only thing being added is that the
// office stops throwing away an answer it already has.

test("a typed GitHub login the town has pinned to ONE household with ONE hand is the hand — attributed, not guessed", async () => {
  // LAW (tools/world-households-export.mjs, verbatim): "logins: lowercased
  //     GitHub login → household key … Pinned handles contribute their pin's
  //     login; login-keyed households bind their own name by construction."
  //     And the pins are "the town's own resolver — stamp-mint.mjs … never by a
  //     second implementation."
  //
  // The fixture is the herzfunke shape exactly: `pazmartina` is nobody's handle,
  // and it is the login pinned to `paz`, who is the only hand in gh:2.
  const town = seamTown({ pins: { paz: { login: "pazmartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const r = resolveSession(decodeSession(sess({ id: CS_A, created: old, handle: "pazmartina" })), { ...ctx(town), now });

  assert.equal(r.disposition, "witness");
  assert.equal(r.from, "paz", "the pinned hand, not the typed string and not a gift");
  assert.equal(r.attributed, true);
  assert.equal(r.attributed_via, "login-pin");
  assert.equal(r.gift_note, undefined, "nothing about this hand was unknown, so nothing is disclosed as a gift");
  assert.match(r.pin_note, /town's own verified pin is the hand — attributed, not guessed/);
  assert.match(r.pin_note, /pazmartina/, "the note says which string was typed");
  assert.match(r.pin_note, /paz/, "and which hand it resolved to");
  // the typed string is kept verbatim beside the resolution, because the
  // operator round's whole job is to be able to disagree with this
  assert.equal(r.handle_typed, "pazmartina");
});

test("a login whose household holds SEVERAL hands is a household and not a hand, so it stays a gift that says why", async () => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): "a payment the office
  //     cannot attach to a hand can still be a gift, but it cannot mint your
  //     holo." A pin that names six people names no one of them.
  //
  // This is the majority shape in the live town: 17 of 93 pinned logins today
  // carry more than one hand (six behind `darkelf381` alone). Picking the first
  // would be the office deciding whose deed grew, which is the exact thing the
  // exact-match rule exists to refuse.
  const town = seamTown({ pins: { stan: { login: "twohands", id: 7 }, wren: { login: "twohands", id: 7 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const r = resolveSession(decodeSession(sess({ id: CS_A, created: old, handle: "twohands" })), { ...ctx(town), now });

  assert.equal(r.from, OUTSIDE_FROM);
  assert.equal(r.attributed, false);
  assert.equal(r.attributed_via, undefined);
  assert.match(r.gift_note, /twohands/);
  assert.match(r.gift_note, /household/, "the note says the reason is the household, not a misspelling");
  assert.match(r.gift_note, /stan/);
  assert.match(r.gift_note, /wren/, "and names the hands, so the operator can ask which one paid");
  assert.match(r.gift_note, /cannot mint your holo/);
});

test("a resident handle OUTRANKS a login of the same spelling — the handle channel is asked first", async () => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): the hand is "the
  //     session's custom field `handle`, if it EXACTLY names a registered
  //     household". Exact match is the first question and it keeps its
  //     precedence; the pin channel only ever answers where that one is silent.
  //
  // NOT hypothetical: EIGHT logins in the live pins file are also somebody's
  // resident handle today (`ethan-thorne`, `orion-by-the-fire`,
  // `vertas-marginalia`, `qthedreaming`, …). If the pin channel went first,
  // typing your own handle could pay a stranger's deed.
  const town = seamTown({ pins: { stan: { login: "s", id: 1 }, fern: { login: "stan", id: 9 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  // `stan` is a resident handle AND the login pinned to `fern`.
  const r = resolveSession(decodeSession(sess({ id: CS_A, created: old, handle: "stan" })), { ...ctx(town), now });

  assert.equal(r.from, "stan", "the handle wins; fern's deed is not touched");
  assert.equal(r.attributed, true);
  assert.equal(r.attributed_via, "handle");
  assert.equal(r.pin_note, undefined, "nothing was resolved through a pin, so nothing claims it was");
});

test("the login channel is case-insensitive, because a login is not case-sensitive and a payer types what they remember", async () => {
  // LAW (tools/world-households-export.mjs, verbatim): "logins: LOWERCASED
  //     GitHub login → household key". The map is built lowercased, so the
  //     lookup must be too, or the map's own spelling silently excludes the
  //     capitalisation GitHub itself shows the payer on their profile.
  const town = seamTown({ pins: { paz: { login: "PazMartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (id, handle) => resolveSession(decodeSession(sess({ id, created: old, handle })), { ...ctx(town), now });

  for (const [id, typed] of [[CS_A, "PazMartina"], [CS_B, "pazmartina"], [CS_C, "PAZMARTINA"]]) {
    const r = at(id, typed);
    assert.equal(r.from, "paz", `${typed} resolves to the pinned hand`);
    assert.equal(r.attributed_via, "login-pin");
  }
});

test("a login TWO different accounts claim is ambiguous, and ambiguity is a gift rather than a winner", async () => {
  // LAW (src/household-logins.mjs, verbatim): "A consumer that picks the first
  //     of several is guessing with somebody's deed."
  //
  // The pins file is keyed by handle, so nothing in its shape stops two handles
  // binding one login to two different accounts. Last-wins would pick a hand
  // out of file order. There are zero such collisions in the live pins today —
  // which is exactly when the guard is cheap to write and impossible to test
  // later.
  const town = seamTown({ pins: { rook: { login: "clash", id: 11 }, dove: { login: "clash", id: 12 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const r = resolveSession(decodeSession(sess({ id: CS_A, created: old, handle: "clash" })), { ...ctx(town), now });
  assert.equal(r.from, OUTSIDE_FROM);
  assert.equal(r.attributed, false);
});

test("an unknown string is still a gift, and the pin channel did not loosen the old rule", async () => {
  // LAW (the fund page, the card rail's own warning, verbatim): "a payment the
  //     office cannot attach to a hand can still be a gift, but it cannot mint
  //     your holo."
  //
  // The regression this guards: a second channel that answers "close enough"
  // for a string neither channel knows. `pazz` is a typo of a handle AND a typo
  // of a login, and it must land exactly where it landed before this lane.
  const town = seamTown({ pins: { paz: { login: "pazmartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (id, handle) => resolveSession(decodeSession(sess({ id, created: old, handle })), { ...ctx(town), now });

  const typo = at(CS_A, "pazz");
  assert.equal(typo.from, OUTSIDE_FROM);
  assert.equal(typo.attributed, false);
  assert.match(typo.gift_note, /"pazz" is not a household the town knows/);

  const none = at(CS_B, null);
  assert.equal(none.from, OUTSIDE_FROM);
  assert.match(none.gift_note, /no handle was given/);
});

test("the disclosure rides the PLAN through decide(), so the held row the operator reads carries it too", async () => {
  // LAW (tools/stripe-watch.mjs, the header, verbatim): "A HELD session carries
  //     its provisional resolution, not just 'wait'. That is the whole value of
  //     the window: the operator round must be able to read [the resolution]
  //     and fix it, rather than learning after the ref is spent."
  //
  // A resolution the operator cannot SEE is not reviewable, and a login-pin
  // attribution is precisely the one a human should be able to veto — it is the
  // only channel that pays a hand the payer did not type.
  const town = seamTown({ pins: { paz: { login: "pazmartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const now = 2_000_000_000_000;
  const fresh = Math.floor(now / 1000) - 60; // inside the grace window

  const { report, todo } = decide({
    sessions: [sess({ id: CS_A, created: fresh, handle: "pazmartina" })],
    ...ctx(town), now,
  });

  assert.equal(todo.length, 0, "nothing witnesses inside the window");
  assert.equal(report.hold.length, 1);
  const plan = report.hold[0].plan;
  assert.equal(plan.from, "paz");
  assert.equal(plan.attributed, true);
  assert.equal(plan.attributed_via, "login-pin");
  assert.equal(plan.handle_typed, "pazmartina", "what was typed, kept beside what it became");
  assert.match(plan.pin_note, /attributed, not guessed/);
});

test("with NO pins map handed in, the rule is exactly the rule it was before this lane", async () => {
  // LAW (src/household-logins.mjs, verbatim): "An engine without
  //     `currentHouseholds` yields an EMPTY map, which is the honest answer: no
  //     pins were read, so no login is a hand."
  //
  // The office is not the only caller shape, and a missing map must degrade to
  // the published rule rather than throwing on a money path.
  const town = seamTown({ pins: { paz: { login: "pazmartina", id: 2 }, stan: { login: "s", id: 1 } } });
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const bare = { engine: ENGINE, entries: entriesOf(town.repo), clone: town.repo, households: ENGINE.householdKeys(town.repo) };

  const r = resolveSession(decodeSession(sess({ id: CS_A, created: old, handle: "pazmartina" })), { ...bare, now });
  assert.equal(r.from, OUTSIDE_FROM, "no map, no second channel");
  assert.equal(r.attributed, false);

  const still = resolveSession(decodeSession(sess({ id: CS_B, created: old, handle: "paz" })), { ...bare, now });
  assert.equal(still.from, "paz", "and the first channel is untouched");
});

// ════════════════════════════════════════════════════════════════════════════
// THE GRACE WINDOW
// ════════════════════════════════════════════════════════════════════════════

test("a session younger than one crossing is HELD, and the hold carries the plan the operator must be able to veto", async () => {
  // LAW (src/crossings.mjs, the ratified derivation, verbatim): "crossings run
  //     00:00 / 12:00 UTC (the ferry's clock), counted from the mail-ledger's
  //     first delivery day (2026-06-12). This derivation IS the town clock".
  //
  // The window exists so a mistyped handle is caught before the ref is spent,
  // which means the held row must SAY what it is about to do — "wait" alone
  // would give the operator nothing to veto.
  const town = seamTown();
  const created = 1_800_000_000;
  const born = created * 1000;

  const young = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "pazz" })), { ...ctx(town), now: born + CROSSING_MS - 1 });
  assert.equal(young.disposition, "hold");
  assert.equal(young.plan.pot, "keep");
  assert.equal(young.plan.from, OUTSIDE_FROM, "the hold already knows the typo will cost the holo");
  assert.equal(young.plan.handle_typed, "pazz");
  assert.equal(young.email, "patron@example.test", "the operator can reach the payer inside the window");
  assert.equal(young.witnesses_after, new Date(born + CROSSING_MS).toISOString());

  const ripe = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "pazz" })), { ...ctx(town), now: born + CROSSING_MS });
  assert.equal(ripe.disposition, "witness", "one crossing exactly is old enough — the boundary is >=, not >");
});

test("the grace is ELAPSED AGE, not a crossing boundary — a payment made a minute before 12:00 UTC still gets its window", async () => {
  // The interpretive call, asserted so it cannot be quietly changed back. "≥1
  // crossing old" could have meant "a boundary has passed", and under that
  // reading a session created at 11:59 UTC would witness one minute later —
  // which is not a window, and the window is the stated reason the delay exists.
  const town = seamTown();
  // 2026-08-01T11:59:00Z — one minute before a crossing boundary
  const created = Math.floor(Date.UTC(2026, 7, 1, 11, 59, 0) / 1000);
  const justAfterTheBoundary = Date.UTC(2026, 7, 1, 12, 0, 30);
  const r = resolveSession(decodeSession(sess({ id: CS_A, created, handle: "paz" })), { ...ctx(town), now: justAfterTheBoundary });
  assert.equal(r.disposition, "hold", "a boundary passed, and it bought the payer nothing — the age has not");
  assert.equal(r.witnesses_after, new Date(Date.UTC(2026, 7, 1, 23, 59, 0)).toISOString());
});

// ════════════════════════════════════════════════════════════════════════════
// THE CAP
// ════════════════════════════════════════════════════════════════════════════

test("an over-target arrival on a capped pot journals as an anomaly rather than witnessing", async () => {
  // LAW (D5, Keemin 2026-08-21, verbatim as the /fund door quotes it): "intake
  //     refuses dollars past a pot's posted target, mechanically (recording
  //     tool / door bounce), except pots explicitly marked uncapped."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  // "small" posts $5. $9 is past it before a dollar has landed.
  const over = resolveSession(decodeSession(sess({ id: CS_A, created: old, amount: 900, pot: "small", handle: "paz" })), { ...ctx(town), now });
  assert.equal(over.disposition, "anomaly");
  assert.equal(over.anomaly, "over-cap");
  assert.match(over.rule, /intake refuses dollars past a pot's posted target/);
  assert.match(over.why, /past pot "small"'s posted target|fully funded for this epoch/);

  // and the headroom that IS available witnesses
  const fits = resolveSession(decodeSession(sess({ id: CS_B, created: old, amount: 500, pot: "small", handle: "paz" })), { ...ctx(town), now });
  assert.equal(fits.disposition, "witness");
  assert.equal(fits.usd, 5);
});

// ════════════════════════════════════════════════════════════════════════════
// IDEMPOTENCE — the ledger decides, not the journal
// ════════════════════════════════════════════════════════════════════════════

test("once the ref is a receipt the same session reports `already`, and a second tick writes nothing", async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //
  // Idempotence is the LEDGER's here, never the journal's — so a journal lost to
  // a wiped disk costs the operator their window and cannot cause a double
  // witness.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const sessions = [sess({ id: CS_A, created: old, handle: "paz" })];

  const first = decide({ sessions, ...ctx(town), now });
  assert.equal(first.todo.length, 1);
  const before = ledgerText(town.repo);
  assert.equal(first.report.witness.length, 1);
  assert.equal(ledgerText(town.repo), before, "decide() decides and records nothing");

  await cliRecorder(town)(first.todo[0]);

  const second = decide({ sessions, ...ctx(town), now });
  assert.equal(second.todo.length, 0, "nothing to do the second time");
  assert.equal(second.report.already.length, 1);
  assert.equal(second.report.already[0].pot, "keep");
  assert.equal(second.report.already[0].from, "paz");

  const rows = ledgerText(town.repo).split("\n").filter((l) => l.includes("pot-receipt"));
  assert.equal(rows.length, 1, "one payment, one receipt");
  assert.match(rows[0], new RegExp(`rail: ${RAIL}`), "and it rode the card rail");
});

// ════════════════════════════════════════════════════════════════════════════
// WHAT IS NEVER A RECEIPT
// ════════════════════════════════════════════════════════════════════════════

test("test-mode money, unpaid sessions, unsettled foreign payments and sub-dollar amounts are named, never witnessed", async () => {
  // LAW (fund.mjs, guard 5, verbatim): "the ledger records whole dollars, so a
  //     payment under $1 cannot be witnessed as a receipt. It reached the town
  //     and it is not lost — write to the postmaster."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (o) => resolveSession(decodeSession(sess({ created: old, handle: "paz", ...o })), { ...ctx(town), now });

  assert.equal(at({ id: CS_A, livemode: false }).anomaly, "testmode");
  assert.equal(at({ id: CS_A, payment_status: "unpaid" }).anomaly, "unpaid");
  // A foreign session with NOTHING SETTLED YET is still named — but the reason
  // moved, and the difference is the whole of postmark#3183. It is no longer
  // "this money is foreign"; foreign money is fine. It is "no settled amount
  // could be read for it", which Stripe fixes by itself on the next tick.
  assert.equal(at({ id: CS_A, currency: "eur" }).anomaly, "not-usd");
  assert.match(at({ id: CS_A, currency: "eur" }).why, /no settled amount could be read/);
  const dust = at({ id: CS_A, amount: 50 });
  assert.equal(dust.anomaly, "under-a-dollar");
  assert.match(dust.rule, /cannot be witnessed as a receipt/);
  assert.equal(MIN_USD, 1, "exactly $1 is not dust — the floor is under a dollar");
  assert.equal(at({ id: CS_A, amount: 100 }).disposition, "witness");
});

test("cents are witnessed as whole dollars and the remainder is disclosed, never dropped in silence", async () => {
  // LAW (src/funding.mjs, verbatim): "Dollars are whole: `usd` is [1-9]\\d* in
  //     the landed grammar. $10.50 is not a smaller payment, it is not a row."
  const town = seamTown();
  const now = 2_000_000_000_000;
  const r = resolveSession(decodeSession(sess({ id: CS_A, created: Math.floor(now / 1000) - 86_400, amount: 1050, handle: "paz" })), { ...ctx(town), now });
  assert.equal(r.usd, 10);
  assert.match(r.cents_note, /\$0\.50 is money the town holds that priced nothing/);
});

// ════════════════════════════════════════════════════════════════════════════
// THE SETTLED DOLLARS — a foreign payment is a receipt, not a queue (#3183)
// ════════════════════════════════════════════════════════════════════════════

test("a EUR session is witnessed for the dollars that SETTLED, and the record keeps what the payer actually paid", async () => {
  // LAW (Keemin, 2026-09-21, verbatim): "let's accept other currencies, no need
  //     to block it on our end."
  // LAW (the pot-receipt grammar, tools/epoch-close.mjs, verbatim): "`usd:` is
  //     a whole number of US dollars."
  //
  // Account-level Adaptive Pricing presents the payment link in the payer's own
  // money, so the session says `eur` / 2500 minor units. The town holds no rate
  // and must never invent one — but it does not need one: Stripe converted at
  // settlement and wrote the answer on the charge's balance transaction. €25.00
  // landed as $27.31, and $27 is the receipt.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const eur = resolveSession(decodeSession(sess({
    id: CS_A, created: old, handle: "paz", currency: "eur", amount: 2500,
    settled: { amount: 2731, currency: "usd" },
  })), { ...ctx(town), now });

  assert.equal(eur.disposition, "witness", "a foreign payment is a receipt now, not a queue for the founder");
  assert.equal(eur.usd, 27, "the SETTLED dollars, floored — never the presentment number, which would have read 25");
  assert.deepEqual(eur.paid, { currency: "eur", amount: 2500 }, "and the record still says what the payer agreed to");
  // The remainder is disclosed against the SETTLED amount, the same way a
  // domestic $27.31 would be. A sentence about €0.31 would be a rate the town
  // does not have, quietly asserted.
  assert.match(eur.cents_note, /\$27\.31 arrived/);
  assert.match(eur.cents_note, /\$0\.31 is money the town holds that priced nothing/);

  // AND THE WHOLE WAY DOWN: the row the town's own CLI actually writes.
  const { report, todo } = decide({
    sessions: [sess({ id: CS_A, created: old, handle: "paz", currency: "eur", amount: 2500, settled: { amount: 2731, currency: "usd" } })],
    ...ctx(town), now,
  });
  assert.equal(report.witnessed_now, 1);
  const record = cliRecorder(town);
  const { line } = await record(todo[0]);
  assert.match(line, /· pot-receipt · pot:keep · rail: stripe · usd: 27 · from: paz · ref: stripe:cs_test_a11111111111111111111111 · sig: /,
    "the ledger line is an ORDINARY receipt in whole dollars — the euro never reaches it");
  // AND IT CANNOT. `POT_RECEIPT_RE` is `^…$`-anchored in both copies of the
  // grammar (the town's tools/stamp-mint.mjs and this office's src/funding.mjs),
  // so a `· paid: eur/2500` appended here would not parse as a receipt at all —
  // the fold would see no money. The presentment pair lives on the operator's
  // record instead, which is why this assertion is the ONLY shape allowed.
  assert.ok(!/paid/.test(line), "nothing about euros reaches the signed row");
  const folded = ENGINE.foldPotReceipts(entriesOf(town.repo)).receipts.at(-1);
  assert.equal(folded.usd, 27, "and the town's own fold reads it back as 27 dollars");
});

test("a foreign session with no settled amount, or one settled in a third currency, is named and never guessed at", async () => {
  // LAW (the anomaly this narrows, verbatim): "there is no rate anywhere in the
  //     town to convert it."
  //
  // The rule reads a rate Stripe already applied; it never applies one. So the
  // two ways a foreign session can arrive without a settled USD figure are both
  // anomalies, and they are NOT the same anomaly to an operator: one is Stripe
  // being a few hours behind and fixes itself, the other is an account setting
  // and needs a person. The shared kind is `not-usd` because the report, the
  // operator round and the journal all already read that name.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;
  const at = (o) => resolveSession(decodeSession(sess({ created: old, handle: "paz", ...o })), { ...ctx(town), now });

  const unsettled = at({ id: CS_A, currency: "gbp", amount: 2000 });
  assert.equal(unsettled.anomaly, "not-usd");
  assert.match(unsettled.why, /GBP and no settled amount could be read/);
  assert.match(unsettled.resolves, /the next tick re-reads the session/, "it resolves itself, and the queue must say so");
  assert.equal(unsettled.usd, undefined, "no dollars were invented for it");

  const thirdCurrency = at({ id: CS_B, currency: "gbp", amount: 2000, settled: { amount: 1800, currency: "eur" } });
  assert.equal(thirdCurrency.anomaly, "not-usd");
  assert.match(thirdCurrency.why, /settled in EUR, not USD/);
  assert.match(thirdCurrency.resolves, /no rate anywhere in the town to convert it/, "this one is the founder's, and keeps the original sentence");
  assert.equal(thirdCurrency.usd, undefined);
});

test("a USD session is the row it has always been: the settled read never touches it, and it costs no extra Stripe call", async () => {
  // The whole safety of #3183 is that the common path did not move. A USD
  // session carries no balance transaction in any fixture in this file — that
  // is the real shape of an unexpanded session — and it must resolve to exactly
  // the receipt it resolved to before, because `amount_total` already IS the
  // settled amount when presentment and settlement are the same currency.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const old = Math.floor(now / 1000) - 86_400;

  const plain = decodeSession(sess({ id: CS_A, created: old, handle: "paz", amount: 1000 }));
  assert.equal(settlementOf(sess({ id: CS_A, created: old })), null, "an unexpanded session has no balance transaction to read");
  assert.equal(plain.settled, null);
  const r = resolveSession(plain, { ...ctx(town), now });
  assert.equal(r.disposition, "witness");
  assert.equal(r.usd, 10, "the same ten dollars, from the same field, as before the rule learned about settlement");
  assert.deepEqual(r.paid, { currency: "usd", amount: 1000 }, "`paid` is carried even when it restates `usd` — a field that appears only sometimes teaches readers that its absence means something");

  const { line } = await cliRecorder(town)(r);
  assert.match(line, /· pot-receipt · pot:keep · rail: stripe · usd: 10 · from: paz · ref: stripe:cs_test_a11111111111111111111111 · sig: /);

  // AND THE READ: no second call is made for it.
  const acct = stripeAccount({ sessions: [sess({ id: CS_A, created: old }), sess({ id: CS_B, created: old + 1 })] });
  await listCompleteSessions({ stripe: acct.stripe, createdGte: old });
  assert.ok(acct.calls.every((c) => c.path === "/checkout/sessions"),
    "every USD session was answered by the listing alone — the settled read is asked only of the sessions that need it");
});

test("the settled read is a RETRIEVE, asked once per foreign session, and a refusal there is an anomaly rather than a dead rail", async () => {
  // `data.payment_intent.latest_charge.balance_transaction` sits at Stripe's
  // documented four-level expansion limit on a LIST, and a request at a limit
  // fails with an API error rather than a null — which on the list would blind
  // the whole rail. So the expansion is asked on the SESSION, three levels
  // deep, and only of a session whose presentment currency is not the account's.
  const old = 1_700_000_000;
  const rows = [
    sess({ id: CS_A, created: old }),
    sess({ id: CS_B, created: old + 1, currency: "eur", amount: 2500 }),
  ];
  const full = { ...rows[1], payment_intent: { id: "pi_x", latest_charge: { id: "ch_x", balance_transaction: { amount: 2731, currency: "usd" } } } };
  const calls = [];
  const stripe = async (path, params = {}) => {
    calls.push({ path, params });
    if (path === "/checkout/sessions") return { object: "list", data: rows.slice().sort((a, b) => b.created - a.created), has_more: false };
    if (path === `/checkout/sessions/${CS_B}`) return full;
    throw new Error(`unexpected path ${path}`);
  };
  const got = await listCompleteSessions({ stripe, createdGte: old });
  const retrieves = calls.filter((c) => c.path !== "/checkout/sessions");
  assert.equal(retrieves.length, 1, "one retrieve, for the one foreign session");
  assert.equal(retrieves[0].path, `/checkout/sessions/${CS_B}`);
  assert.equal(retrieves[0].params["expand[]"], "payment_intent.latest_charge.balance_transaction",
    "the request itself names what it needs, three levels and not four");
  assert.deepEqual(settlementOf(got.find((s) => s.id === CS_B)), { amount: 2731, currency: "usd" });

  // THE REFUSAL. A watcher that threw here would stop witnessing every good
  // session queued behind one unreadable payment.
  const angry = async (path) => {
    if (path === "/checkout/sessions") return { object: "list", data: rows.slice().sort((a, b) => b.created - a.created), has_more: false };
    throw new Error("Stripe refused the read (400): no such payment_intent");
  };
  const survived = await listCompleteSessions({ stripe: angry, createdGte: old });
  assert.equal(survived.length, 2, "the tick still has both sessions");
  assert.equal(settlementOf(survived.find((s) => s.id === CS_B)), null, "and the one it could not read carries no settlement, so the rule names it");
  assert.equal(SETTLE_CURRENCY, "usd", "the account settles in dollars, and that is the one currency the ledger records");
});

test("attachSettlement asks nothing of a session it was not given, and leaves a mismatched answer alone", async () => {
  // A retrieve that comes back as a DIFFERENT session is not a session this
  // reader may substitute — the settled dollars would be another payer's.
  const wrong = async () => ({ id: "cs_somebody_else", payment_intent: { latest_charge: { balance_transaction: { amount: 9999, currency: "usd" } } } });
  const [only] = await attachSettlement({ stripe: wrong, sessions: [sess({ id: CS_B, created: 1, currency: "eur", amount: 2500 })] });
  assert.equal(only.id, CS_B);
  assert.equal(settlementOf(only), null, "the mismatched answer was discarded, not grafted on");
});

// ════════════════════════════════════════════════════════════════════════════
// THE READ
// ════════════════════════════════════════════════════════════════════════════

test("only COMPLETED sessions are asked for, and the pages are followed to the end", async () => {
  // The refusing is done by Stripe rather than by our incuriosity: an open or
  // expired session is never in the answer because it was never in the request.
  const created = 1_700_000_000;
  const rows = [];
  for (let i = 0; i < 7; i++) rows.push(sess({ id: `cs_test_${String(i).padStart(24, "0")}`, created: created + i }));
  rows.push({ ...sess({ id: "cs_test_open", created: created + 99 }), status: "open" });
  const acct = stripeAccount({ sessions: rows });

  const got = await listCompleteSessions({ stripe: acct.stripe, createdGte: created, limit: 3 });
  assert.equal(got.length, 7, "every page was followed and the open session was never returned");
  assert.ok(got.every((s) => s.status === "complete"));
  assert.equal(acct.calls[0].params.status, "complete", "the request itself names it");
  assert.ok(acct.calls.length > 1, "the pages were followed");
  // oldest first: the ledger's order is arrival order, not Stripe's display order
  assert.deepEqual(got.map((s) => s.created), got.map((s) => s.created).slice().sort((a, b) => a - b));
});

test("the cursor is INCLUSIVE, so two sessions in the same second cannot fall through it", async () => {
  const created = 1_700_000_000;
  const twins = [sess({ id: CS_A, created }), sess({ id: CS_B, created })];
  const acct = stripeAccount({ sessions: twins });
  const got = await listCompleteSessions({ stripe: acct.stripe, createdGte: created });
  assert.equal(got.length, 2, "a `gt` cursor would have dropped the sibling");
  assert.equal(acct.calls[0].params["created[gte]"], created);
});

test("the page cap REFUSES rather than truncating — a partial read decides nothing", async () => {
  // LAW (tools/usdc-watch.mjs, on an unreachable chain, verbatim): "a silent
  //     empty report from a blind watcher is indistinguishable from a quiet day,
  //     and the second one is a lie." A watcher that quietly stopped paginating
  //     tells the same lie about the sessions it never reached.
  const created = 1_700_000_000;
  const rows = [];
  for (let i = 0; i < 20; i++) rows.push(sess({ id: `cs_test_${String(i).padStart(24, "0")}`, created: created + i }));
  const acct = stripeAccount({ sessions: rows });
  await assert.rejects(
    () => listCompleteSessions({ stripe: acct.stripe, createdGte: created, limit: 2, maxPages: 3 }),
    /stopped after 3 pages .* and Stripe still had more/,
  );
  // and the cap is not hit when the pages genuinely end
  const all = await listCompleteSessions({ stripe: acct.stripe, createdGte: created, limit: 2, maxPages: 50 });
  assert.equal(all.length, 20);
});

test("a Stripe read that fails throws, and no key means no reader at all", async () => {
  // Same law as usdc-watch's unreachable chain: "a silent empty report from a
  // blind watcher is indistinguishable from a quiet day, and the second one is
  // a lie."
  const acct = stripeAccount({ throws: true });
  await assert.rejects(() => listCompleteSessions({ stripe: acct.stripe, createdGte: 0 }), /Stripe refused the read/);
  assert.throws(() => stripeReader({ key: null }), /no STRIPE_KEY/);
});

test("the ref is stripe:<session id>, and it is the only ref this rail can ever mint", async () => {
  // LAW (stamp-mint.mjs, the pot-receipt grammar, verbatim): "ref is unique
  //     forever: one dollar, one mint chance, a re-recorded receipt bounces."
  //     The card rail has no payer paste-path (the fund page: "Step 2 — there
  //     isn't one"), so nothing else in the town can mint this string.
  const d = decodeSession(sess({ id: CS_A, created: 1 }));
  assert.equal(d.receipt_ref, `stripe:${CS_A}`);
  assert.ok(!/\s|·/.test(d.receipt_ref), "the town CLI refuses a ref carrying whitespace or the field separator");
});

test("NO DOOR IN THE TOWN CAN MINT A `stripe:` REF — the premise the whole auto-witness rests on", async () => {
  // LAW (the fund page, the card rail's step 2, verbatim): "There is nothing
  //     for you to paste. The hash form belongs to the USDC rail — it reads
  //     Base directly and cannot see a card payment."
  //
  // usdc-watch may not auto-witness because a patron's own paste could be
  // front-run and the ref's one mint chance spent under the wrong name. That
  // objection only exists if there IS a claim to front-run. Here there is not,
  // and this is that claim tested rather than asserted: the only ref-minting
  // door in the office is fundVerify, and every ref it can produce is
  // `usdc:base:<hash>` by construction — a hash it will not even look at unless
  // it matches TXHASH_RE, which a Stripe session id never can.
  const { TXHASH_RE } = await import("../src/usdc-witness.mjs");
  const { fundVerify } = await import("../src/fund.mjs");
  const town = seamTown();

  assert.ok(!TXHASH_RE.test(CS_A), "a checkout session id is not a tx hash");
  const e = await (async () => { try {
    await fundVerify(town.repo, { txhash: CS_A, pot: "keep", handle: "paz" }, { engine: ENGINE, record: cliRecorder(town) });
  } catch (err) { return err; } })();
  assert.ok(e, "the door refuses a session id outright");
  assert.equal(e.code, 422);
  assert.match(e.defect, /that is not a transaction hash/);

  // and the ref the door DOES mint is prefixed by its own rail, so the two
  // namespaces can never meet
  const { verifyUsdcPayment, USDC, TRANSFER_TOPIC, MIN_CONF } = await import("../src/usdc-witness.mjs");
  const hash = "0x" + "a1".repeat(32);
  const pad = (a) => "0x" + "0".repeat(24) + String(a).replace(/^0x/, "").toLowerCase();
  const w = await verifyUsdcPayment({
    txhash: hash,
    rpc: async (m) => m === "eth_blockNumber" ? "0x" + (1000 + MIN_CONF).toString(16)
      : { status: "0x1", blockNumber: "0x3e8", logs: [{ address: USDC, topics: [TRANSFER_TOPIC, pad("0x1"), pad((await import("../src/usdc-witness.mjs")).INTAKE)], data: "0x1e8480" }] },
  });
  assert.ok(w.receipt_ref.startsWith("usdc:base:"), "the door's own refs live under its own rail");
  assert.ok(!w.receipt_ref.startsWith(`${RAIL}:`));
});

test("the payer's email is journalled for the operator and never reaches a ledger row", async () => {
  // The journal is a private operator surface; the ledger is public forever.
  const town = seamTown();
  const now = 2_000_000_000_000;
  const r = resolveSession(decodeSession(sess({ id: CS_A, created: Math.floor(now / 1000) - 86_400, handle: "paz" })), { ...ctx(town), now });
  assert.equal(r.email, "patron@example.test");
  await cliRecorder(town)(r);
  assert.ok(!ledgerText(town.repo).includes("patron@example.test"), "no email on the public ledger");
});
