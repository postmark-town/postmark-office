// ballots-store.mjs — THE BALLOT CLASS'S PEN AND ITS READS (POS-349).
//
// The rules are src/ballots.mjs's, pure. This file is where they meet the
// record: the ingest that takes the founder's ballot file in as the town's
// post, the stake that writes a vote act and a ledger line together, and the
// reads votes.mjs answers from.
//
// ── THE STAKE, IN ITS ORDER (Wright's go on S2, 2026-10-07; reshaped the same
//    day: a write transaction never spans non-SQL work) ───────────────────────
//
// The caller holds the town lock (stake-exec.mjs under the ferry's flock, or
// the ferry's own pass). Then:
//
//   1. the ballot post and its votes are READ (a read-only transaction);
//   2. with NO transaction open: the clip, by the town engine's law (the cap
//      counted from the votes, the balance, the meep law and the household's
//      mint key from the ledger, git being the input, and the first-stake mint
//      as the engine decides it); the stake lines signed onto the export with
//      the town's own builders; the caller's preparation (the office pass's
//      receipt and the town's verify); and the stamp rows the store will hold;
//   3. ONE SHORT store transaction: the post FOR UPDATE and its votes again,
//      and if either moved, everything goes back and step 1 runs again; else
//      the vote act and the resident's response, the stamp rows, the pen's push
//      (the remote holds it), and the store commits, last.
//
// A ledger the pen cannot land throws, and the store rolls back with it. A
// store commit that fails AFTER the push leaves a line the store lacks: the
// answer says so in its own words, and `tools/ballots-backfill.mjs --check`
// is the instrument that names it (the backfill then records it).
//
// ── TWO GUARDS AGAINST A LEDGER LINE THE TOWN WOULD REFUSE ──────────────────
//
// The store judges, and the town's verifier recounts the same ballot from the
// ledger and the file. Where the two inputs could disagree, the stake refuses
// rather than writing a line the verifier would red:
//
//   · the file and the post disagree (status or candidate): the founder moved
//     the file and the office has not taken it in yet. The tick's ingest does.
//   · the household's headroom counted from the votes differs from the town
//     engine's count from the ledger: a stake the store lacks (or holds alone).
//
// Both refuse before anything is written, and say where to look.

import { officeRead, officeWrite, insertAct } from "./world2-pen.mjs";
import { householdKeyFor } from "./world2-claims.mjs";
import { currentCrossing } from "./crossings.mjs";
import {
  refuse, applyPostAct, responseKey, ACT_POST, ACT_AMEND_POST, ACT_ADVANCE, ACT_CLOSE, ACT_VOTE,
  RESPONSE_VOTE, RESPONSE_STANDING,
} from "./events.mjs";
import { POST_COLUMNS, rowOf, insertPost, updatePost } from "./events-store.mjs";
import {
  BALLOT_CLASS, BALLOT_AUTHOR, BALLOT_HANDS, BALLOT_STATES, STATE_STAKING, STATE_CLOSED, STATE_SUBMISSIONS,
  ballotPostId, ballotFileName, ballotFilePath, ballotFromFile, changedTerms, headroomOf, tallyOf, TOPIC_RE,
  judgeTermsMove, composeBallotAct, choiceStanding, topicOfPost,
} from "./ballots.mjs";
import { existsSync, readdirSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { planStampedCommit, landPlannedVia } from "./stamp-lines.mjs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { plainReason } from "./fault-words.mjs"; // POS-657: a read's plain reason, the raw error to the log

const isRefusal = (e) => e && typeof e.code === "number" && typeof e.defect === "string";

const UNREACHABLE = () => refuse(503, "the ballots live in the office's record, and the record cannot be reached",
  "nothing was written; ask again shortly");

async function read(fn, env) {
  try { return await officeRead(fn, { env }); }
  catch (e) { if (isRefusal(e)) throw e; throw Object.assign(UNREACHABLE(), { cause: String(e?.message ?? e).slice(0, 160) }); }
}
async function write(fn, env) {
  try { return await officeWrite(fn, { env }); }
  catch (e) {
    if (isRefusal(e)) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a candle the record will not take; nothing was written");
    throw Object.assign(UNREACHABLE(), { cause: String(e?.message ?? e).slice(0, 160) });
  }
}

/** The town's own engine and line builders, from the clone (the same live import votes.mjs has always made). */
export async function townEngine(clone) {
  const [ballot, mint] = await Promise.all([
    import(pathToFileURL(join(clone, "tools", "ballot.mjs")).href),
    import(pathToFileURL(join(clone, "tools", "stamp-mint.mjs")).href),
  ]);
  return { ballot, mint };
}

// ── the rows ────────────────────────────────────────────────────────────────

export async function ballotRow(client, id, { forUpdate = false } = {}) {
  const { rows } = await client.query(
    `SELECT ${POST_COLUMNS} FROM posts WHERE id = $1 AND class = $2${forUpdate ? " FOR UPDATE" : ""}`, [id, BALLOT_CLASS]);
  return rowOf(rows[0]);
}
export async function ballotRows(client) {
  const { rows } = await client.query(`SELECT ${POST_COLUMNS} FROM posts WHERE class = $1 ORDER BY id`, [BALLOT_CLASS]);
  return rows.map(rowOf);
}
const responseOf = (r) => ({ ...r, act: Number(r.act), fields: typeof r.fields === "string" ? JSON.parse(r.fields) : { ...(r.fields ?? {}) } });
export async function voteRows(client, ids) {
  const list = Array.isArray(ids) ? ids : [ids];
  if (!list.length) return [];
  const { rows } = await client.query(
    "SELECT post, handle, household, kind, state, fields, act FROM responses WHERE post = ANY($1) AND kind = $2 ORDER BY post, handle",
    [list, RESPONSE_VOTE]);
  return rows.map(responseOf);
}
const byPost = (rows) => {
  const m = new Map();
  for (const r of rows) m.set(r.post, [...(m.get(r.post) ?? []), r]);
  return m;
};

function actRow({ action, actor, object, payload, now }) {
  return {
    written_at: new Date(now).toISOString(), crossing: currentCrossing(now),
    actor, action, object,
    at_anchor: null, at_dx: null, at_dy: null, witnesses: null,
    class: BALLOT_CLASS, payload: JSON.stringify(payload),
    effect: null, household: actor,   // insertAct resolves the actor's house
  };
}

// ── the ingest: the founder's file, taken in as the town's post ─────────────

/** Every ballot file in the clone: `{ topic, json }`, or `{ topic, error }` when it does not parse. */
export function readBallotFiles(clone) {
  const dir = join(clone, "WHITE_PAGES");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((f) => /^ballot-([a-z0-9-]+)\.json$/.exec(f)?.[1])
    .filter(Boolean).sort()
    .map((topic) => {
      try { return { topic, json: JSON.parse(readFileSync(join(dir, ballotFileName(topic)), "utf8")) }; }
      catch (e) { return { topic, error: `${ballotFilePath(topic)}: ${plainReason(e, "files", "a ballot file")}` }; }
    });
}

/**
 * The acts that bring a post to what its file says, as `{ action, payload }`,
 * in the order they are written: the post; or an amendment of the terms that
 * changed, then the move. A ballot moves forward only: a file that goes back
 * is refused by name and nothing is planned for it.
 */
export function planIngest(post, want, { topic, hand }) {
  const id = ballotPostId(topic);
  if (!post)
    return [{ action: ACT_POST, payload: { post: id, class: BALLOT_CLASS, title: want.title, body: want.body,
      state: want.state, fields: want.fields, hand } }];
  const acts = [];
  const from = BALLOT_STATES.indexOf(post.state);
  const to = BALLOT_STATES.indexOf(want.state);
  if (to < from)
    throw refuse(409, `ballot "${topic}" stands ${post.state} and its file says ${want.state}`,
      "a ballot moves forward only (submissions, staking, closed); nothing was taken in");
  judgeTermsMove(post, want, topic);   // POS-983: once staking opens, its terms only grow
  const changed = changedTerms(post, want);
  if (changed.length) {
    const payload = { post: id, changed, hand };
    for (const k of changed) {
      if (k === "title" || k === "body") payload[k] = want[k];
      else (payload.fields ??= {})[k] = want.fields[k] ?? null;
    }
    acts.push({ action: ACT_AMEND_POST, payload });
  }
  if (to > from)
    acts.push(want.state === STATE_CLOSED
      ? { action: ACT_CLOSE, payload: { post: id, state: STATE_CLOSED, hand } }
      : { action: ACT_ADVANCE, payload: { post: id, from: post.state, to: want.state, hand } });
  return acts;
}

/**
 * Bring `post` (held FOR UPDATE by the caller) to what its file says, on the
 * caller's transaction: the acts planIngest plans, each folded into the row.
 * `{ post, did, act_ids }`.
 */
async function takeInVia(client, post, want, { topic, hand, now }) {
  const id = ballotPostId(topic);
  const plan = planIngest(post, want, { topic, hand });
  const ids = [];
  for (const a of plan) {
    const actId = await insertAct(client, actRow({ action: a.action, actor: BALLOT_AUTHOR, object: id, payload: a.payload, now }));
    const household = post?.household ?? await householdKeyFor(client, BALLOT_AUTHOR);
    const row = applyPostAct({ posts: new Map(post ? [[id, post]] : []), responses: new Map() },
      { id: actId, action: a.action, actor: BALLOT_AUTHOR, object: id, payload: a.payload, household });
    if (post) await updatePost(client, row); else await insertPost(client, row);
    post = row;
    ids.push(actId);
  }
  return { post, did: plan.map((a) => a.action), act_ids: ids };
}

function judgeHand(hand) {
  if (!BALLOT_HANDS.includes(hand))
    throw refuse(403, `"${hand}" is not a hand that moves the town's ballots`, `the hands are ${BALLOT_HANDS.join(" and ")}`);
  return hand;
}

/**
 * Take every ballot file in the clone in: a file with no post is posted, and
 * a post its file has moved past is amended and moved, each file in its own
 * transaction. `dryRun` reads and writes nothing in the store.
 * `inTransaction(client, post, topic)` runs inside each file's transaction
 * after its acts, so what it writes lands with the post or not at all (the
 * backfill records a ballot's stakes there: no reader ever sees a post
 * without its votes).
 * Returns `{ topics: [{ topic, did: [actions], act_ids }], refused: [{ topic, defect }] }`.
 */
export async function ingestBallotFiles(clone, { hand, now = Date.now(), env = process.env, dryRun = false, inTransaction = null } = {}) {
  judgeHand(hand);
  const out = { hand, topics: [], refused: [] };
  for (const f of readBallotFiles(clone)) {
    if (f.error) { out.refused.push({ topic: f.topic, defect: f.error }); continue; }
    try {
      const want = ballotFromFile(f.json, f.topic);
      const id = ballotPostId(f.topic);
      if (dryRun) {
        const post = await read((c) => ballotRow(c, id), env);
        out.topics.push({ topic: f.topic, did: planIngest(post, want, { topic: f.topic, hand }).map((a) => a.action), act_ids: [] });
        continue;
      }
      const done = await write(async (client) => {
        const post = await ballotRow(client, id, { forUpdate: true });
        const took = await takeInVia(client, post, want, { topic: f.topic, hand, now });
        const also = inTransaction ? await inTransaction(client, took.post, f.topic) : undefined;
        return { did: took.did, act_ids: took.act_ids, ...(also !== undefined ? { also } : {}) };
      }, env);
      out.topics.push({ topic: f.topic, ...done });
    } catch (e) {
      if (!isRefusal(e)) throw e;
      out.refused.push({ topic: f.topic, defect: e.defect, hint: e.hint });
    }
  }
  return out;
}

// ── a hand's act: the file it means, taken in, in one landing (POS-983) ─────
//
// The town's hands put a ballot up, amend it, advance it and close it at the
// town door (src/ballot-acts.mjs, under the town lock). The act does what the
// founder's hand-written file always did, in one step: it writes the ballot
// file and takes it in. So:
//
//   1. the post and the file are READ; they must already agree (a file the
//      office has not taken in is the tick's to take, never carried in under
//      another act's name), and the act composes the file it means
//      (ballots.mjs § composeBallotAct), judged as the ingest judges a file;
//   2. ONE store transaction: the post FOR UPDATE (moved since 1: refused,
//      nothing written), the file written, the ingest's acts and row, the
//      pen's commit and push (the remote holds the file), and the store
//      commits, last. A file the pen cannot land rolls the store back, and the
//      file is put back as it stood.
//
// Nothing signs a ledger line here: a ballot's acts move no stamp. The stakes
// and the returns stay the engine's and the close tool's.

const putBackFile = (path, arrived) => {
  if (arrived != null) { if (!existsSync(path) || readFileSync(path, "utf8") !== arrived) writeFileSync(path, arrived); }
  else if (existsSync(path)) unlinkSync(path);
};

/**
 * One hand's act on a ballot. `verb` is post | amend | advance | close and
 * `args` the door's (post: `{ topic, title, … }`, the others `{ post, … }`);
 * `hand` is judged here as the ingest judges it (the door has already judged
 * that the caller's credential holds it). `today` is the town day a choice
 * joins on. `commit: { message(answer) }` lands the file with the pen;
 * `land(answer, client)` replaces it (a test seam). Answers
 * `{ topic, post, did, act_ids, file, commit? }`; throws a refusal.
 */
export async function ballotActInStore({ clone, verb, args = {}, hand, today, commit = null, land = null, now = Date.now(), env = process.env }) {
  judgeHand(hand);
  const named = String((verb === "post" ? args.topic : args.post) ?? "").trim();
  const topic = verb === "post" ? named : topicOfPost(named);
  if (verb === "post" && !TOPIC_RE.test(topic))
    throw refuse(422, named ? `"${named}" is not a ballot topic` : "which topic?", "topic: lowercase letters, digits and hyphens (it names the file, WHITE_PAGES/ballot-<topic>.json)", { field: "topic" });
  if (verb !== "post" && !topic)
    throw refuse(named ? 404 : 422, named ? `no ballot "${named}"` : "which ballot?", `post: "${ballotPostId("<topic>")}", as town { read: "posts", args: { class: "ballot" } } names it`, { field: "post" });
  const id = ballotPostId(topic);
  const path = join(clone, "WHITE_PAGES", ballotFileName(topic));

  // 1 · the read, and the act's file
  const post = await read((c) => ballotRow(c, id), env);
  const arrived = existsSync(path) ? readFileSync(path, "utf8") : null;
  let file = null;
  if (arrived != null) {
    try { file = JSON.parse(arrived); }
    catch { throw refuse(409, `${ballotFilePath(topic)} does not parse`, "the founder's file is the ballot's entrance; mend it first; nothing was written", { held: true }); }
  }
  if (file || post) {
    const was = file ? ballotFromFile(file, topic) : null;
    if (!file || !post || was.state !== post.state || changedTerms(post, was).length)
      throw refuse(409, `ballot "${topic}"'s file and its post disagree (the file: ${file ? file.status : "missing"}; the post: ${post ? post.state : "missing"})`,
        "the office takes the founder's ballot file in at its next tick (tools/ballots-backfill.mjs --apply); act again after it; nothing was written", { held: true });
  }
  const { json } = composeBallotAct(verb, args, { file, post, topic, today });
  const want = ballotFromFile(json, topic);
  const planned = planIngest(post, want, { topic, hand });   // refuses here, before the file is touched
  if (!planned.length) throw refuse(422, `that ${verb} changes nothing on ballot "${topic}"`, "nothing was written");
  const bytes = JSON.stringify(json, null, 2) + "\n";

  // 2 · the landing: one store transaction, the file and the push inside it
  try {
    return await officeWrite(async (client) => {
      const nowPost = await ballotRow(client, id, { forUpdate: true });
      if (JSON.stringify([nowPost?.state, nowPost?.last_act]) !== JSON.stringify([post?.state, post?.last_act]))
        throw refuse(409, `ballot "${topic}" moved under this ${verb}`, "another act on it landed first; read it again and act again; nothing was written", { held: true });
      writeFileSync(path, bytes);
      const took = await takeInVia(client, nowPost, want, { topic, hand, now });
      const answer = { topic, post: took.post, did: took.did, act_ids: took.act_ids, file: ballotFilePath(topic) };
      let out = null;
      try {
        if (land) out = await land(answer, client);
        else if (commit) out = await landPlannedVia(client, clone, null, [path], commit.message(answer), { env });
      } catch (e) { throw Object.assign(e, { fromLand: true }); }
      if (out?.error) throw refuse(out.error.code ?? 503, out.error.defect, out.error.hint, { held: true });
      if (out?.commit !== undefined) answer.commit = out.commit;
      return answer;
    }, { env });
  } catch (e) {
    putBackFile(path, arrived);
    if (isRefusal(e) || e?.fromLand) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a candle the record will not take; nothing was written");
    throw Object.assign(UNREACHABLE(), { cause: String(e?.message ?? e).slice(0, 160) });
  }
}

// ── the vote: one act, the resident's one response ──────────────────────────

/**
 * Write one stake as a vote act and fold it into the resident's response, on
 * the caller's client (inside the caller's transaction). Returns the act id.
 */
export async function castVote(client, post, { handle, candidate, n, requested = null, mint_key, date, via, sig, vote_minted = false, backfill = false, now }) {
  const payload = { post: post.id, candidate, n, ...(requested != null ? { requested } : {}), mint_key, date, via, sig,
    ...(vote_minted ? { vote_minted: true } : {}), ...(backfill ? { backfill: true } : {}) };
  const actId = await insertAct(client, actRow({ action: ACT_VOTE, actor: handle, object: post.id, payload, now }));
  const household = await householdKeyFor(client, handle);
  const { rows } = await client.query(
    "SELECT post, handle, household, kind, state, fields, act FROM responses WHERE post = $1 AND handle = $2 AND kind = $3",
    [post.id, handle, RESPONSE_VOTE]);
  const before = rows[0] ? responseOf(rows[0]) : null;
  const key = responseKey(post.id, handle, RESPONSE_VOTE);
  const row = applyPostAct({ posts: new Map(), responses: new Map(before ? [[key, before]] : []) },
    { id: actId, action: ACT_VOTE, actor: handle, object: post.id, payload, household });
  await client.query(
    `INSERT INTO responses (post, handle, household, kind, state, fields, act)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (post, handle, kind) DO UPDATE SET household = EXCLUDED.household, state = EXCLUDED.state,
       fields = EXCLUDED.fields, act = EXCLUDED.act`,
    [row.post, row.handle, row.household, RESPONSE_VOTE, RESPONSE_STANDING, JSON.stringify(row.fields), row.act]);
  return actId;
}

const sigOf = (line) => / · sig: (\S+)$/.exec(line)?.[1] ?? null;

export const DRIFT_HINT = "nothing was written; node tools/ballots-backfill.mjs --town <clone> --check names the difference";

/** How many times a stake judges again when its ballot moved under it, before it refuses. */
export const STAKE_TRIES = 3;
class Moved extends Error { constructor() { super("the ballot moved under the stake"); this.name = "Moved"; } }

/** What the stake judged against: the post as it stood and every vote on it. Any change moves it. */
const fingerprintOf = (post, votes) => JSON.stringify([post.state, post.last_act, post.fields,
  votes.map((v) => [v.handle, v.act]).sort()]);

/**
 * THE STAKE (§ the header's order). `payload` is the clip's own input,
 * `{ handle, topic, candidate, n, via, date }`.
 *
 * A WRITE TRANSACTION NEVER SPANS NON-SQL WORK (Wright's review of #415):
 *
 *   1. a READ ONLY transaction reads the ballot post and its votes;
 *   2. with NO transaction open: the town engine's judgement (the guards, the
 *      clip, the household's mint key), the signed lines onto the export, the
 *      caller's `prepare(result)` (the office pass's receipt and the town's
 *      verify), and the stamp rows the store will hold
 *      (src/stamp-lines.mjs § planStampedCommit);
 *   3. one short write transaction: the post FOR UPDATE and its votes again,
 *      and if either moved from what step 2 judged, everything is put back and
 *      judged again (STAKE_TRIES, then a refusal by name); else the vote act,
 *      the response, the stamp rows and the push, the store committing last.
 *
 * `commit: { message(result), paths? }` lands the ledger (and `paths`) with
 * the pen; `land(result, client)` replaces it (a test seam), answering
 * `{ commit }` or `{ error }`. With neither, the lines are appended and left
 * for the caller to commit. `prepare` answers `{ paths?, undo? }` or
 * `{ error }` (a refusal, nothing written).
 *
 * Answers the town engine's clip result (requested, applied, clipped, the
 * headroom and balance before and after, vote_minted), plus `act_id` and
 * `commit` when it wrote. Throws `{ code, defect, hint }` for a refusal.
 */
export async function stakeInStore({ clone, keyPem, payload, prepare = null, commit = null, land = null, now = Date.now(), env = process.env }) {
  const { handle, topic, candidate, via, date } = payload ?? {};
  if (!handle || !topic || !candidate || !via || !date)
    throw refuse(422, "incomplete stake", "required: handle, topic, candidate, n, via, date");
  const n = Number(payload.n);
  if (!Number.isInteger(n) || n < 1) throw refuse(422, "stamps must be a whole number of at least 1", "stakes move whole stamps");
  if (!TOPIC_RE.test(topic)) throw refuse(404, `no ballot topic "${topic}"`, "open topics: see /votes (or WHITE_PAGES/ballot-*.json)");
  const { ballot: engine, mint } = await townEngine(clone);
  const id = ballotPostId(topic);
  const ledgerPath = join(clone, "WHITE_PAGES", "stamp-ledger.md");
  const arrived = existsSync(ledgerPath) ? readFileSync(ledgerPath, "utf8") : null;
  const putBack = () => { if (arrived != null && readFileSync(ledgerPath, "utf8") !== arrived) writeFileSync(ledgerPath, arrived); };
  let landed = null;
  try {
    for (let attempt = 1; attempt <= STAKE_TRIES; attempt++) {
      // 1 · the read
      const seen = await read(async (c) => {
        const post = await ballotRow(c, id);
        return { post, votes: post ? await voteRows(c, id) : [] };
      }, env);
      const { post, votes } = seen;

      // 2 · the judgement, with no transaction open
      if (!post) throw refuse(404, `no ballot topic "${topic}"`, "open topics: see /votes (or WHITE_PAGES/ballot-*.json)");
      if (post.state !== STATE_STAKING)
        throw refuse(409, `ballot "${topic}" is not staking (status: ${post.state})`,
          post.state === STATE_SUBMISSIONS ? "candidates are still being gathered — watch the board" : "this vote has closed");
      if (!(post.fields.candidates ?? []).includes(candidate))
        throw refuse(422, `"${candidate}" is not on the ballot`, `candidates: ${(post.fields.candidates ?? []).join(", ")}`);

      // Git is the input: the founder's file must say what the post says.
      const file = engine.readBallot(clone, topic);
      if (!file || file.status !== post.state || !(file.candidates ?? []).includes(candidate))
        throw refuse(409, `ballot "${topic}"'s file and its post disagree (the file: ${file ? `${file.status}, ${(file.candidates ?? []).includes(candidate) ? "lists" : "does not list"} "${candidate}"` : "missing"}; the post: ${post.state})`,
          "the office takes the founder's ballot file in at its next tick; nothing was written", { held: true });

      const state = engine.ballotState(clone);
      if (state.lawAt(date).meeps.has(handle))
        throw refuse(403, `meep accounts cannot stake (${handle})`, "stamps-v2 law: meeps neither mint nor stake");

      const mintKey = state.householdOf(handle, date);
      const room = headroomOf(post, votes, candidate, mintKey);
      const ledgerRoom = engine.headroom(clone, topic, candidate, handle, date, state);
      if (room !== ledgerRoom)
        throw refuse(503, `the office's record and the ledger disagree on ballot "${topic}" (headroom ${room} from the votes, ${ledgerRoom} from the ledger)`, DRIFT_HINT, { held: true });

      const balance = state.balances.get(handle) ?? 0;
      const applied = Math.min(n, room, balance);
      // POS-983: the answer names the choice in its own words (credit, link, note) and its standing
      // (staked, backing_households), as every reader does: here as it stood, and once the vote lands, with it
      const result = { requested: n, applied, clipped: applied < n,
        household_headroom_before: room, balance_before: balance, vote_minted: false, choice: choiceStanding(post, votes, candidate) };
      if (applied <= 0) {
        result.reason = room <= 0
          ? "your household has no headroom left on this candidate"
          : "your balance has no stamps free to stake";
        return result;
      }

      const canonicals = [mint.stakeLine({ date, handle, topic, candidate, n: applied, via })];
      if (!state.voteMinted.has(`${handle}|${topic}`) && state.lawAt(date).rules === "stamps-v2") {
        canonicals.push(mint.voteMintLine({ date, handle, topic }));
        result.vote_minted = true;
      }
      const lines = mint.appendSigned(clone, canonicals, keyPem);
      result.household_headroom_after = room - applied;
      result.balance_after = balance - applied + (result.vote_minted ? 1 : 0);
      // the choice's standing WITH this stake, judged here, before `prepare` writes the mail receipt from it:
      // the landing below refuses and judges again if the ballot moved, so what lands is what this says
      result.choice = choiceStanding(post, [...votes, { handle, fields: { stakes: [{ act: Number.MAX_SAFE_INTEGER, candidate, n: applied, mint_key: mintKey }] } }], candidate);
      const prepared = prepare ? await prepare(result) : null;
      if (prepared?.error) throw refuse(prepared.error.code ?? 503, prepared.error.defect, prepared.error.hint, prepared.error.held ? { held: true } : {});
      const plan = commit ? await planStampedCommit(clone, { env, engine: mint }) : null;

      // 3 · the landing: one short write transaction
      try {
        return await officeWrite(async (client) => {
          const nowPost = await ballotRow(client, id, { forUpdate: true });
          const nowVotes = nowPost ? await voteRows(client, id) : [];
          if (!nowPost || fingerprintOf(nowPost, nowVotes) !== fingerprintOf(post, votes)) throw new Moved();
          result.act_id = await castVote(client, nowPost, { handle, candidate, n: applied, requested: n, mint_key: mintKey,
            date, via, sig: sigOf(lines[0]), vote_minted: result.vote_minted, now });
          let out = null;
          // A land that throws is the pen's own trip, passed on as itself (the
          // store rolls back with it), never mistaken for an unreachable record.
          try {
            if (land) out = await land(result, client);
            else if (commit) out = await landPlannedVia(client, clone, plan, [ledgerPath, ...(prepared?.paths ?? [])], commit.message(result), { env });
          } catch (e) { throw Object.assign(e, { fromLand: true }); }
          if (out?.moved) throw new Moved();
          if (out?.error) throw refuse(out.error.code ?? 503, out.error.defect, out.error.hint, out.error.held ? { held: true } : {});
          if (out) { landed = out; if (out.commit !== undefined) result.commit = out.commit; }
          return result;
        }, { env });
      } catch (e) {
        if (!(e instanceof Moved)) throw e;
        putBack();
        prepared?.undo?.();
      }
    }
    throw refuse(409, `ballot "${topic}" moved under this stake ${STAKE_TRIES} times running`,
      "another stake or a change to the ballot kept landing first; nothing was written — stake again", { held: true });
  } catch (e) {
    if (landed)
      throw refuse(503, "the stake landed in the town's ledger, and the office's record did not take its vote",
        "do not stake it again: the ledger holds it, and node tools/ballots-backfill.mjs --check names it until the backfill records it",
        { landed: true, held: true, commit: landed.commit ?? null });
    if (isRefusal(e) || e?.fromLand) throw e;
    if (e?.name === "LateCrossingError") throw refuse(409, e.message, "the act was stamped for a candle the record will not take; nothing was written");
    throw Object.assign(UNREACHABLE(), { cause: String(e?.message ?? e).slice(0, 160) });
  }
}

// ── the reads votes.mjs answers ─────────────────────────────────────────────

/** Every ballot post with its votes: `[{ post, votes }]`, by id. */
export async function ballotsWithVotes({ env = process.env, open = false } = {}) {
  return read(async (client) => {
    const posts = (await ballotRows(client)).filter((p) => !open || p.state !== STATE_CLOSED);
    const votes = byPost(await voteRows(client, posts.map((p) => p.id)));
    return posts.map((post) => ({ post, votes: votes.get(post.id) ?? [] }));
  }, env);
}

/** One ballot by topic, with its votes, or null. */
export async function ballotWithVotes(topic, { env = process.env } = {}) {
  if (!TOPIC_RE.test(topic ?? "")) return null;
  return read(async (client) => {
    const post = await ballotRow(client, ballotPostId(topic));
    return post ? { post, votes: await voteRows(client, post.id) } : null;
  }, env);
}

export { tallyOf };
