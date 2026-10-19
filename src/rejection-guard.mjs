// rejection-guard.mjs — a stray rejection is logged loudly, and the office keeps serving (POS-709).
//
// THE OFFICE HAD NO PROCESS-LEVEL HANDLER. Node 22's default for an unhandled
// rejection is to throw it, so ONE promise nobody awaited took the whole office
// down: on 2026-10-19 a resident's empty home update (a 422 meant for that
// resident, edit.mjs § updateHomeAct) killed postmark-office six times, and
// every resident lost the API for the 5–10 s systemd took to bring it back.
// The route is fixed where it broke; this is the floor under every other route.
//
// It catches REJECTIONS only. A rejection is a promise's answer that reached no
// reader: the request that made it has already answered (or timed out), and the
// process holds no half-made state on its behalf. A synchronous uncaught
// exception is different — it can leave a stack unwound mid-write — and keeps
// Node's default (exit, and systemd restarts the unit).
//
// LOUD means one line on stderr in the office's instrumentation grammar, with
// the error's code, defect and stack, so `journalctl -u postmark-office | grep
// unhandled-rejection` finds every one. Each is a bug to fix where it started.

let seen = 0;

/** The line the journal carries for one stray rejection. */
export function rejectionLine(reason, n = seen) {
  const code = reason?.code != null ? ` code=${reason.code}` : "";
  const defect = reason?.defect ? ` defect="${String(reason.defect).slice(0, 200)}"` : "";
  const stack = String(reason?.stack ?? reason?.message ?? reason);
  return `[unhandled-rejection] #${n} the office kept serving; a promise was rejected and nothing awaited it.${code}${defect}\n${stack}`;
}

/** Install in each process (and read worker thread): a stray rejection is logged and the office keeps serving. */
export function installRejectionGuard({ on = (ev, fn) => process.on(ev, fn), log = (s) => console.error(s) } = {}) {
  on("unhandledRejection", (reason) => { seen += 1; log(rejectionLine(reason, seen)); });
}
