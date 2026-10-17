// usdc-witness.mjs — the USDC witness at the door.
//
// PORTED, check for check, from G:/postmark/usdc-rail/verify-usdc-payment.mjs
// (the founder-manual v0 tool, proven 2026-08-21: happy path $83.93 at block
// 49971166; foreign-recipient and nonexistent-hash both REFUSED). The CLI stays
// the operator's hand-run twin; this is the same law with the network injected,
// so the falsifiers can drive a chain that does not exist.
//
// R9 (amended): Stripe primary, USDC-on-Base the cheap secondary rail. The
// intake address is Wright's agent wallet, Keemin-ruled 2026-08-21.
//
// THE SCOPE OF THE CHECK, and it is deliberately four things:
//   1. the tx exists on Base and SUCCEEDED (status 0x1),
//   2. it emits a USDC Transfer TO one of the town's intake addresses,
//   3. the amount, read from the log (6 decimals),
//   4. confirmations >= MIN_CONF (finality is a claim about depth, not existence).
//
// And what it CANNOT see, named out loud because the disclosure guard
// (`the-town/the-disclosure`: refuse or disclose, never quietly substitute)
// makes silence the wrong answer: which pot the payer meant, whose household
// the payer keeps, and whether this hash was already recorded. Those three are
// the LEDGER's to hold — "one dollar, one mint chance" lives in the ledger's
// receipt-ref uniqueness, not here, and fund.mjs asks the ledger rather than
// asking this file to grow a memory it has no business having.
//
// ── 2026-08-25: WHICH ADDRESS, NOT JUST WHETHER ─────────────────────────────
// "which pot the payer meant" is still not this file's to decide. But since the
// founder minted keeping-ec2 its own intake address, a payer can now SAY which
// pot they meant with the only thing an ERC-20 transfer carries — the recipient
// itself. So the witness gained one field, and only one: `to`, the address the
// tx actually paid, plus `to_pot` when the map names it.
//
// It reports. It does not adjudicate. Whether a chain that says "keeping-ec2"
// agrees with a claim that says "darko-fund" is the DOOR's judgement (fund.mjs
// § THE CHAIN NAMED A POT), for the same reason the pot was never this file's
// to choose: this file knows about Base, and the door knows about the town.

export const INTAKE = "0x2a273b0e5D0648DfF9B9ED7a4A5041E6762b8C78".toLowerCase();
export const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913".toLowerCase(); // native USDC on Base
export const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";
export const RPCS = ["https://mainnet.base.org", "https://base.publicnode.com", "https://1rpc.io/base"];
export const MIN_CONF = 12;

export const TXHASH_RE = /^0x[0-9a-fA-F]{64}$/;

// The real chain, tried across the three public Base RPCs in order — the CLI's
// own fallback, unchanged. Injected as `rpc` so a falsifier never needs a network.
export async function baseRpc(method, params, { urls = RPCS, timeoutMs = 15000, fetchImpl = fetch } = {}) {
  let lastErr;
  for (const url of urls) {
    try {
      const r = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(timeoutMs),
      });
      const j = await r.json();
      if (j.error) throw new Error(j.error.message);
      return j.result;
    } catch (e) { lastErr = e; }
  }
  throw new Error(`all RPCs failed: ${lastErr?.message ?? lastErr}`);
}

// THE TOWN CANNOT SEE BASE (POS-617). The payer reads the town's own sentence;
// what the RPCs said (a public node's error, a timeout) goes to the log, never
// the answer, where it would read as something about their payment.
export const BASE_BLIND = "the town cannot reach Base right now — this says nothing about your payment; try again shortly";
function blind(e, txhash) {
  console.error(`[usdc-witness] Base unreadable for ${txhash}: ${String(e?.message ?? e).slice(0, 300)}`);
  return { verified: false, unreadable: true, refused: BASE_BLIND, txhash };
}

// Returns { verified: true, ... } or { verified: false, refused: <reason> }.
// It RETURNS a refusal rather than throwing, for the same reason foldFunding
// surfaces invalid rows: a refusal is an answer the payer is owed verbatim, not
// an exception someone might swallow into a 500.
export async function verifyUsdcPayment({
  txhash,
  rpc = baseRpc,
  intake = INTAKE,
  // Map(lowercased address -> pot id), from src/intake-map.mjs. Every address in
  // it is a town intake address and is accepted here; which pot the CLAIM may
  // name against it is the door's call, not this file's. Null means the town has
  // no per-pot addresses, which was true until 2026-08-25 and is the shape every
  // existing caller and falsifier still passes.
  potMap = null,
  usdcToken = USDC,
  minConf = MIN_CONF,
} = {}) {
  const refuse = (why) => ({ verified: false, refused: why, txhash });
  const standing = String(intake).toLowerCase();
  const accepted = new Set([standing, ...(potMap?.keys() ?? [])]);
  if (!TXHASH_RE.test(txhash ?? ""))
    return refuse("that is not a transaction hash — a Base tx hash is 0x followed by 64 hex characters");

  let receipt;
  try {
    receipt = await rpc("eth_getTransactionReceipt", [txhash]);
  } catch (e) {
    // NOT a refusal: the payer's tx may be perfectly good and the town simply
    // cannot see the chain this minute. Refusing here would tell a patron their
    // real payment was not real. Disclose the blindness instead.
    return blind(e, txhash);
  }
  if (!receipt) return refuse("no such transaction on Base (or not yet mined)");
  if (receipt.status !== "0x1") return refuse("transaction exists but FAILED (status != 1) — a failed tx moves nothing");

  const recipientOf = (l) => ("0x" + (l.topics?.[2] ?? "").slice(-40)).toLowerCase();
  const landed = (receipt.logs ?? []).filter(
    (l) =>
      (l.address ?? "").toLowerCase() === usdcToken &&
      l.topics?.[0] === TRANSFER_TOPIC &&
      accepted.has(recipientOf(l)),
  );
  if (!landed.length)
    return refuse("no USDC Transfer to the town's intake address in this tx (wrong token, wrong recipient, or not a transfer)");

  // ONE TX, ONE INTAKE ADDRESS. A tx that paid two of the town's addresses at
  // once carries two different answers to "which pot did you mean", and this
  // file's whole posture is that it does not choose between a payer's meanings.
  // Refusing here costs the payer a letter to the postmaster; guessing costs
  // them a witnessed payment on a pot they did not name, which the ledger
  // cannot undo.
  const paidTo = [...new Set(landed.map(recipientOf))];
  if (paidTo.length > 1)
    return refuse(`this transaction paid ${paidTo.length} different town intake addresses (${paidTo.join(", ")}) — the town cannot tell which pot you meant, so it will not choose. Send the hash to the postmaster and it will be recorded by hand`);

  const to = paidTo[0];
  const hits = landed;

  let head;
  try {
    head = BigInt(await rpc("eth_blockNumber", []));
  } catch (e) {
    return blind(e, txhash);
  }
  const conf = Number(head - BigInt(receipt.blockNumber));
  if (conf < minConf)
    return refuse(`only ${conf} confirmations (< ${minConf}) — call again in a minute; depth is part of the witness`);

  const total = hits.reduce((s, l) => s + BigInt(l.data), 0n);
  const usd = Number(total) / 1e6;
  const from = "0x" + hits[0].topics[1].slice(-40);
  const block = Number(receipt.blockNumber);

  // THE REF IS THE IDENTITY OF THE DOLLAR, so it is normalised HERE — at the
  // one place a ref is ever minted — and nowhere else.
  //
  // A tx hash is hex, and hex has two spellings. TXHASH_RE admits both cases,
  // Base answers eth_getTransactionReceipt for either, and the ledger's
  // uniqueness check (`receipts.find((r) => r.ref === ref)`, in the door AND in
  // the town's own epoch-close) is an exact string compare. Composed, those
  // three facts defeated the law they were built to keep: "ref is unique
  // forever: one dollar, one mint chance, a re-recorded receipt bounces".
  // Pasting 0xab… and then 0xAB… recorded ONE $50 payment TWICE — two receipts,
  // two holo rows, twice the mint, $100 witnessed against the pot for $50 of
  // real money. Reproduced against the town's own CLI, 2026-08-24, on a ledger
  // that (checked) holds no receipt rows yet, which is why normalising here
  // orphans nothing.
  //
  // Lowercase is the chain's own spelling — it is what eth_getLogs returns — so
  // a ref minted here and a ref derived from a log are the same string, which
  // is what lets any watcher of the intake address recognise an arrival the
  // door has already witnessed.
  const canonical = String(txhash).toLowerCase();

  return {
    verified: true,
    txhash,
    usd,
    from_address: from,
    // The address the tx ACTUALLY paid, read off the recipient topic rather
    // than echoed back from the parameter. Before per-pot addresses these were
    // the same string; now they are not, and it is the difference that names
    // the pot.
    to,
    // The pot that address names, or null for the standing shared intake —
    // which is a real answer, not a missing field: it means the chain said
    // nothing about the pot and the claim is all the town has.
    to_pot: potMap?.get(to) ?? null,
    token: "USDC (Base native)",
    block,
    confirmations: conf,
    receipt_ref: `usdc:base:${canonical}`,
    cannot_see: "which pot was meant, the payer's household, or whether this ref was already recorded — those are the ledger's to hold",
  };
}
