#!/usr/bin/env node
// ballots-backfill.mjs — the town's ballots into the office's record, and the
// check that the record and the ledger hold the same votes (POS-349).
//
//   node tools/ballots-backfill.mjs --town <clone> --hand <wright|keemin>            the plan: writes nothing
//   node tools/ballots-backfill.mjs --town <clone> --hand <wright|keemin> --apply    writes it
//   node tools/ballots-backfill.mjs --town <clone> --check [--json]                  the instrument
//   node tools/ballots-backfill.mjs --town <clone> --hand <wright|keemin> --ingest   the files only (the office tick)
//
//   env: WORLD2_PG_URL (or PG*, or WORLD2_PG), the office's own store.
//   EXIT (--check): 0 equal · 1 DIFFERENT (each difference printed) · 2 cannot run.
//
// ── WHAT IT WRITES ──────────────────────────────────────────────────────────
//
//   1. Every ballot file, taken in as the town's post: src/ballots-store.mjs §
//      ingestBallotFiles, the same ingest the office tick runs. `--hand` is the
//      hand the acts name.
//   2. Every stake line in the ledger whose signature no vote carries, as a
//      vote act (`backfill: true`) and the resident's response, in ledger
//      order. Its household (`mint_key`) is the town engine's for the resident
//      on the stake's date, the key the old tally and the verifier count by.
//      Stakes and returns are NOT written: they are the ledger's, and stay so.
//
// A second --apply writes nothing: the posts stand and every line's signature
// is on a vote.
//
// ── THE CHECK (Wright, S2: "the instrument that catches a commit that failed
//    after the push") ─────────────────────────────────────────────────────────
//
// Per ballot file: the post stands, in the file's status, with the file's
// terms. Per ballot: the ledger's stake lines and the store's stakes are the
// SAME SET by signature (a line the store lacks is a commit that failed after
// the push; a vote the ledger lacks is a stake that never landed), equal in
// count, and equal in stamps per candidate and per resident. It reads; it
// writes nothing.

import { readFileSync, existsSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { officeRead, officeWrite } from "../src/world2-pen.mjs";
import {
  townEngine, ingestBallotFiles, readBallotFiles, ballotRow, voteRows, castVote,
} from "../src/ballots-store.mjs";
import { ballotPostId, ballotFromFile, changedTerms, stakesOf } from "../src/ballots.mjs";

/** The ledger's ballot stake lines, in order: `{ topic, candidate, handle, n, date, via, sig, vote_minted }`. */
export async function ledgerStakes(clone) {
  const { mint } = await townEngine(clone);
  const path = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const entries = existsSync(path) ? mint.parseStampLedger(readFileSync(path, "utf8")) : [];
  const out = [];
  entries.forEach((e, i) => {
    const c = mint.classifyEntry(e.canonical);
    if (c.kind !== "stake") return;
    const next = entries[i + 1] ? mint.classifyEntry(entries[i + 1].canonical) : null;
    out.push({ topic: c.topic, candidate: c.candidate, handle: c.handle, n: c.n, date: c.date, via: c.via, sig: e.sig,
      vote_minted: next?.kind === "vote-mint" && next.handle === c.handle && next.topic === c.topic });
  });
  return out;
}

/** The stakes the store lacks, by signature, in ledger order; and the votes the ledger lacks. */
export function stakeDiff(ledger, storeStakes) {
  const inStore = new Set(storeStakes.map((s) => s.sig));
  const inLedger = new Set(ledger.map((s) => s.sig));
  return { missing: ledger.filter((s) => !inStore.has(s.sig)), extra: storeStakes.filter((s) => !inLedger.has(s.sig)) };
}

const sum = (list, key) => {
  const m = {};
  for (const s of list) m[key(s)] = (m[key(s)] ?? 0) + Number(s.n);
  return m;
};
const sameMap = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort());

/** THE CHECK. Returns `{ equal, differences: [sentences], ballots: [{ topic, ledger, store, staked }] }`. */
export async function check(clone, { env = process.env } = {}) {
  const files = readBallotFiles(clone);
  const ledger = await ledgerStakes(clone);
  const differences = [];
  const ballots = [];
  const topics = new Set([...files.map((f) => f.topic), ...ledger.map((s) => s.topic)]);
  await officeRead(async (client) => {
    for (const topic of [...topics].sort()) {
      const file = files.find((f) => f.topic === topic);
      const post = await ballotRow(client, ballotPostId(topic));
      if (!file) differences.push(`${topic}: the ledger holds stakes and the town has no WHITE_PAGES/ballot-${topic}.json`);
      else if (file.error) differences.push(`${topic}: ${file.error}`);
      else if (!post) differences.push(`${topic}: the file stands and the office's record holds no post ${ballotPostId(topic)}`);
      else {
        const want = ballotFromFile(file.json, topic);
        if (post.state !== want.state) differences.push(`${topic}: the post stands ${post.state} and the file says ${want.state}`);
        const changed = changedTerms(post, want);
        if (changed.length) differences.push(`${topic}: the post's ${changed.join(", ")} differ from the file's`);
      }
      const mine = ledger.filter((s) => s.topic === topic);
      const theirs = post ? stakesOf(await voteRows(client, post.id)) : [];
      const { missing, extra } = stakeDiff(mine, theirs);
      for (const s of missing) differences.push(`${topic}: the ledger's stake ${s.handle} → ${s.candidate} · ${s.n} (${s.date}, via ${s.via}) is on no vote — a commit that failed after its push, or a stake from before the backfill`);
      for (const s of extra) differences.push(`${topic}: the vote ${s.handle} → ${s.candidate} · ${s.n} (act ${s.act}) names a line the ledger does not hold`);
      if (mine.length !== theirs.length) differences.push(`${topic}: ${mine.length} stake line(s) in the ledger, ${theirs.length} stake(s) on votes`);
      const byCand = [sum(mine, (s) => s.candidate), sum(theirs, (s) => s.candidate)];
      if (!sameMap(...byCand)) differences.push(`${topic}: stamps per candidate differ (ledger ${JSON.stringify(byCand[0])}, votes ${JSON.stringify(byCand[1])})`);
      const byHand = [sum(mine, (s) => `${s.handle}|${s.candidate}`), sum(theirs, (s) => `${s.handle}|${s.candidate}`)];
      if (!sameMap(...byHand)) differences.push(`${topic}: stamps per resident differ`);
      ballots.push({ topic, ledger: mine.length, store: theirs.length, staked: byCand[0] });
    }
  }, { env });
  return { equal: differences.length === 0, differences, ballots };
}

/** THE BACKFILL: the ingest, then every ledger stake no vote carries. `apply: false` plans and writes nothing. */
export async function backfill(clone, { hand, apply = false, now = Date.now(), env = process.env } = {}) {
  const ingest = await ingestBallotFiles(clone, { hand, now, env, dryRun: !apply });
  const { ballot: engine } = await townEngine(clone);
  const state = engine.ballotState(clone);
  const ledger = await ledgerStakes(clone);
  const out = { ingest, recorded: [], would_record: [], refused: [] };
  for (const topic of [...new Set(ledger.map((s) => s.topic))].sort()) {
    const id = ballotPostId(topic);
    const run = async (client) => {
      const post = await ballotRow(client, id, { forUpdate: apply });
      // A plan's ingest wrote nothing: a post it would write takes every stake.
      const planned = !apply && ingest.topics.some((t) => t.topic === topic && t.did.includes("post"));
      if (!post && !planned) { out.refused.push({ topic, defect: `no post ${id} to record its stakes on` }); return; }
      const { missing } = stakeDiff(ledger.filter((s) => s.topic === topic), post ? stakesOf(await voteRows(client, id)) : []);
      for (const s of missing) {
        const mint_key = state.householdOf(s.handle, s.date);
        if (!apply) { out.would_record.push({ topic, handle: s.handle, candidate: s.candidate, n: s.n, via: s.via, mint_key }); continue; }
        const act = await castVote(client, post, { handle: s.handle, candidate: s.candidate, n: s.n, mint_key,
          date: s.date, via: s.via, sig: s.sig, vote_minted: s.vote_minted, backfill: true, now });
        out.recorded.push({ topic, handle: s.handle, candidate: s.candidate, n: s.n, act });
      }
    };
    if (apply) await officeWrite(run, { env }); else await officeRead(run, { env });
  }
  return out;
}

async function main() {
  const argv = process.argv.slice(2);
  const arg = (n) => { const i = argv.indexOf(`--${n}`); return i === -1 ? null : argv[i + 1]; };
  const town = arg("town");
  if (!town || !existsSync(join(town, "tools", "ballot.mjs"))) {
    console.error("usage: ballots-backfill.mjs --town <clone> (--hand <wright|keemin> [--apply] | --check [--json]) — the clone must hold tools/ballot.mjs");
    process.exit(2);
  }
  const clone = resolve(town);
  try {
    if (argv.includes("--check")) {
      const r = await check(clone);
      if (argv.includes("--json")) console.log(JSON.stringify(r, null, 2));
      else {
        for (const b of r.ballots) console.log(`${b.topic}: ${b.ledger} stake line(s) in the ledger, ${b.store} on votes · staked ${JSON.stringify(b.staked)}`);
        console.log(r.equal ? "equal · the office's record and the ledger hold the same ballots and the same votes" : `DIFFERENT · ${r.differences.length} difference(s):`);
        for (const d of r.differences) console.log(`  ${d}`);
      }
      process.exit(r.equal ? 0 : 1);
    }
    const hand = arg("hand");
    if (argv.includes("--ingest")) {
      const r = await ingestBallotFiles(clone, { hand });
      for (const t of r.topics) if (t.did.length) console.log(`${t.topic}: ${t.did.join(", ")} (acts ${t.act_ids.join(", ")})`);
      for (const x of r.refused) console.log(`${x.topic}: REFUSED ${x.defect}`);
      process.exit(r.refused.length ? 1 : 0);
    }
    const apply = argv.includes("--apply");
    const r = await backfill(clone, { hand, apply });
    for (const t of r.ingest.topics) console.log(`${t.topic}: ${t.did.length ? `${apply ? "" : "would "}${t.did.join(", ")}` : "the post stands as its file says"}`);
    for (const x of r.ingest.refused) console.log(`${x.topic}: REFUSED ${x.defect}`);
    for (const x of r.refused) console.log(`${x.topic}: REFUSED ${x.defect}`);
    console.log(apply
      ? `recorded ${r.recorded.length} stake(s) as votes (hand ${hand})`
      : `would record ${r.would_record.length} stake(s) as votes; nothing was written (add --apply)`);
    process.exit(r.ingest.refused.length || r.refused.length ? 1 : 0);
  } catch (e) {
    console.error(`ballots-backfill: cannot run — ${String(e?.defect ?? e?.message ?? e).slice(0, 240)}`);
    process.exit(2);
  }
}

// Script only when run as one (the realpath compare: deploy/welcome-pass.mjs § entry guard).
const isMain = (() => {
  if (!process.argv[1]) return false;
  try { return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return pathToFileURL(process.argv[1]).href === import.meta.url; }
})();
if (isMain) main();
