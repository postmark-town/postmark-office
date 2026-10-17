// fault-words.mjs — THE OFFICE'S OWN WORDS FOR ITS OWN FAULT, at every door.
//
// POS-568 (office #483) gave the REST doors one rule: when the office trips,
// the resident reads the door's own sentence ("the drafts door tripped") and one
// fixed hint, and what failed (the raw error, a SQL fragment, a path on the box,
// pg's own hint, a child's stderr) goes to the office's log. Those words lived
// in server.mjs, which nothing else can import (it imports everything). The MCP
// door (POS-573) and the modules that build their own 5xx bounces (POS-578) say
// the same words, so the words moved here: a leaf, importing only store-pool's
// classifier, with one owner. server.mjs imports them back unchanged.

import { isStoreLostCode } from "./store-pool.mjs";

export const STORE_LOST = "the town's store went away mid-request; nothing is wrong with your request, retry";
export const READ_RETRY = "the office lost its connection to the town's store while answering: an outage, not your request. A read is safe to repeat; send the same request again after Retry-After seconds.";
export const ACT_RETRY = "the office lost its connection to the town's store while performing this act, so it may not have been recorded: read before you send it again (an act with a nonce is safe to repeat), after Retry-After seconds.";
// What tripped is the defect, and this is the hint. The error itself is in the office's log.
export const FAULT_LOGGED = "nothing in your request caused it. What failed is in the office's log, not in this answer; try again shortly, and if it keeps happening, tell the town.";

// THE PLAIN REASONS (POS-657; RULED A, Darko 2026-10-16 20:04 EDT). A read that
// says a count "could not be read — unknown, not zero" keeps that promise, and
// its parenthetical is one of these fixed reasons, never the error's own text.
// The raw error goes to the office's log. Map a site by what it was reading:
//   record  the office's store (the acts, the docket, the registry, a projection)
//   files   the world's files (the world clone, git, the engine at a ref)
//   parse   a saved file that does not parse (a file read whose JSON is bad)
//   chain   the Base chain (its RPCs)
export const PLAIN_REASONS = Object.freeze({
  record: "the record did not answer",
  files: "the world's files could not be read",
  parse: "a saved file does not parse",
  chain: "the chain could not be reached",
});

/**
 * An error in the office's OWN words, thrown inside a read to end it (the
 * engine giving no Mists state, say). It is not a raw error, so a disclosure
 * may say it as it is: plainReason hands its sentence back.
 */
export const ownWordsError = (sentence) => Object.assign(new Error(sentence), { own_words: true });

/**
 * The reason an error's own CAUSE names, when it names one (Wright's brief: map
 * each raw cause to one reason): pg's own code outranks its text (a json
 * column's 22P02 is the record); a parser's error is `parse`; pg's SQLSTATE, a
 * lost or unconfigured store or a refused connection is `record`; git, a missing
 * file or a clone is `files`. Anything else is null, and the site's kind stands.
 */
export function causeKind(e) {
  const said = `${e?.name ?? ""} ${e?.message ?? ""} ${e?.cause?.message ?? ""}`;
  if (isStoreLostCode(e?.code) || (typeof e?.code === "string" && /^[0-9A-Z]{5}$/.test(e.code))) return "record";
  if (e instanceof SyntaxError || /\bJSON\b|Unexpected token|is not valid JSON|parse error/i.test(said)) return "parse";
  if (/ECONNREFUSED|ETIMEDOUT|ECONNRESET|connection|\bpool\b|\brelation\b|\bcolumn\b|PenUnreachable|GuardsUnreachable|NoRecord|not pointed at a record|record (cannot|is not) (be )?reach/i.test(said)) return "record";
  if (e?.stderr || e?.code === "ENOENT" || e?.code === "EACCES" || /ENOENT|EACCES|\bgit\b|fatal:|\bclone\b|\brefs?\/|\bref\b|worktree|checkout/i.test(said)) return "files";
  return null;
}

/** The plain reason for a read that failed on `kind`, with the raw error logged beside `what`. The error's own cause, when it names one, outranks the site's kind (`causeKind`); the chain stays the chain; the office's own words (ownWordsError) are said as they are. */
export function plainReason(e, kind, what = "a read") {
  if (e?.own_words === true) return String(e.message);
  const site = Object.hasOwn(PLAIN_REASONS, kind) ? kind : "record";
  const k = site === "chain" ? "chain" : (causeKind(e) ?? site);
  console.error(`[office] ${String(what).slice(0, 160)} could not be read (${PLAIN_REASONS[k]}): ${errorSaid(e)}`);
  return PLAIN_REASONS[k];
}

// How long a lost store asks a caller to wait: REST's Retry-After header, and
// the MCP body's `retry_after` (a JSON-RPC answer carries no header).
export const STORE_RETRY_AFTER_S = 30;

export const isHttpStatus = (code) => Number.isInteger(code) && code >= 100 && code <= 599;

// What an error said, for the LOG only: a child's stderr when it printed one
// (a crashed exec prints its stack there), else the message.
export const errorSaid = (e) => {
  const err = String(e?.stderr ?? "").trim();
  return String(err || (e?.message ?? e ?? "(no error)")).slice(0, 600);
};

// A TRIPPED STEP KEEPS ITS ERROR IN THE LOG (POS-578). Logs what failed beside
// the door's own sentence, and hands back the hint the resident reads instead.
export function faultLogged(defect, e) {
  const foreignHint = e?.hint && !e?.defect ? ` (its hint: ${String(e.hint).slice(0, 300)})` : "";
  console.error(`[office] ${String(defect).slice(0, 160)}: ${errorSaid(e)}${foreignHint}`);
  return FAULT_LOGGED;
}

// The error a tripped step throws, in the office's own words: a refusal-shaped
// error (code, defect, hint) that every door's catch already knows how to send.
export const trippedError = (defect, e, code = 500) =>
  Object.assign(new Error(defect), { code, defect, hint: faultLogged(defect, e) });

// A FOREIGN CODE IS CLASSIFIED, NEVER SAID (POS-544, POS-568). A `code` that is
// not an HTTP status came from pg, Node or the pool, never from a refusal: a
// lost store is an outage (503, in the read's or the act's words); anything
// else is the office's own 500. REST's j (server.mjs § notAStatus) and the MCP
// door (mcp.mjs § the answer) both answer it from here.
export function foreignAnswer(code, obj, { read = true } = {}) {
  if (isStoreLostCode(code)) return { status: 503, body: { error: "bounce", defect: STORE_LOST, hint: read ? READ_RETRY : ACT_RETRY } };
  return { status: 500, body: { error: "bounce", defect: obj?.defect ?? "the office tripped",
    hint: `a handler's error carried code ${JSON.stringify(code)}, which is not an HTTP status; ${FAULT_LOGGED}`.slice(0, 300) } };
}

// A CAUGHT ERROR, AS A DISPATCHER RETURNS IT (POS-573). The callTool catches and
// the apexes' rebuilds turned any error with a truthy `code` into a bounce of
// its own fields, so pg's SQLSTATE arrived with pg's `hint` and no defect, and
// Node's ENOENT with neither. A refusal (its code a status) is rebuilt exactly as
// each catch always did; a foreign code keeps only the code, so the door that
// answers classifies it (above), and its message and hint go to the log here.
export function caughtBounce(e, fields) {
  if (isHttpStatus(e?.code)) return { error: "bounce", ...fields };
  faultLogged(`a caught error carried code ${JSON.stringify(e?.code)}`, e);
  return { error: "bounce", code: e?.code };
}
