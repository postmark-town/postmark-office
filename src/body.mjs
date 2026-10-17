// body.mjs — the one reader every request-body door uses (POS-526).
//
// Every door that reads a body (the plain API's JSON routes, POST /residency,
// POST /letters, the MCP endpoint, OAuth's forms) used to append each chunk to
// a string and compare the string's LENGTH to its cap, destroying the request
// when it passed. Three faults in one line: a chunk boundary that fell inside a
// multi-byte character was decoded on its own and became U+FFFD; the cap
// counted UTF-16 units, not the bytes it was sized in; and an oversize body got
// a reset connection instead of an answer.
//
// `readBody(req, cap)` keeps the chunks as Buffers, counts BYTES, concatenates
// once and decodes UTF-8 once, at the end. Over the cap it stops buffering at
// once and rejects with `BodyTooLarge` (code 413), and it keeps the request
// flowing so the rest is drained and discarded rather than reset: the door
// writes its 413 while the client is still sending, and the connection stays
// usable. It is deliberately NOT closed early: closing a socket that still has
// unread upload in it makes the kernel answer with a reset, and a reset can
// swallow the 413 before the client reads it (the very failure this replaces).
// A slow abusive upload is bounded by the server's own requestTimeout instead.
// Each door turns `BodyTooLarge` into its own shape (CONTRACT.md § Error shape:
// a REST bounce, a JSON-RPC error, OAuth's `{ error, error_description }`).
//
// It settles exactly once and removes its own listeners when it does; an
// `error` after settlement is swallowed by a no-op listener so a late socket
// error cannot become an unhandled stream error.

export class BodyTooLarge extends Error {
  constructor(cap) {
    super("the request body is too large");
    this.name = "BodyTooLarge";
    this.code = 413;
    this.cap = cap;
    this.defect = "the request body is too large";
    this.hint = `this door reads at most ${cap} bytes of body; send a smaller one`;
  }
}

/** The body ended before it was complete (the client aborted or the socket closed). */
export class BodyIncomplete extends Error {
  constructor(why) {
    super(`the request body did not arrive whole (${why})`);
    this.name = "BodyIncomplete";
  }
}

export const isBodyTooLarge = (e) => e instanceof BodyTooLarge;

const noop = () => {};

/**
 * Read a request body as UTF-8 text, at most `cap` BYTES. Resolves the text;
 * rejects BodyTooLarge (over the cap), BodyIncomplete (aborted / closed before
 * the end) or the stream's own error. `cap` must be a non-negative safe integer
 * (0 accepts only an empty body); anything else is a programmer error and
 * rejects a TypeError before a byte is read.
 */
export function readBody(req, cap) {
  return new Promise((resolve, reject) => {
    if (!Number.isSafeInteger(cap) || cap < 0) {
      reject(new TypeError(`readBody: cap must be a non-negative integer, got ${String(cap)}`));
      return;
    }
    if (req.readableEnded) { resolve(""); return; }
    if (req.destroyed) { reject(new BodyIncomplete("the request was already closed")); return; }

    const chunks = [];
    let bytes = 0;
    let settled = false;

    const cleanup = () => {
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("error", onError);
      req.off("aborted", onAborted);
      req.off("close", onClose);
    };
    const settle = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      req.on("error", noop); // a late error after settlement is not unhandled
      fn(value);
    };

    function onData(chunk) {
      if (settled) return;
      const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk), "utf8");
      bytes += b.length;
      if (bytes > cap) {
        chunks.length = 0; // never hold more than the cap
        settle(reject, new BodyTooLarge(cap));
        req.resume(); // drain and discard the rest; no reset before the 413 is written
        return;
      }
      chunks.push(b);
    }
    function onEnd() { settle(resolve, Buffer.concat(chunks, bytes).toString("utf8")); }
    function onError(e) { settle(reject, e); }
    function onAborted() { settle(reject, new BodyIncomplete("aborted")); }
    function onClose() { if (!req.readableEnded) settle(reject, new BodyIncomplete("closed before the end")); }

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
    req.on("aborted", onAborted);
    req.on("close", onClose);
  });
}

/**
 * Write a 413 through the door's own writer. `write` answers the door's shape
 * (bounce / JSON-RPC / OAuth); this guards a response already sent, so a
 * refusal can never be a second response.
 */
export function refuseTooLarge(res, write) {
  if (res.headersSent) { res.end(); return; }
  return write();
}
