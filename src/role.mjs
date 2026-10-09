// role.mjs — what THIS office process is allowed to be (runbook DEC-4, G3).
//
// "We are paying for four cores so we should use them." — Keemin, 2026-08-29.
//
// The party's brownout was READ cost: one apex read is ~1.2s of wall on one
// core with three idle beside it (measured again on dev 2026-09-08 — five
// serial reads, 1.15–1.34s). Full N-worker serving waits for G1, because the
// reverse mirror is a sqlite writer with a per-process serial queue and N
// queues on one journal file red the reverse-parity arm (P-152). DEC-4 rules
// the earlier, cheaper placement: read-only workers behind nginx NOW.
//
// A read worker is defined by three refusals, and the falsifier DEC-4 asks for
// checks all three:
//
//   1. it serves only worker-safe routes and refuses the rest by name,
//   2. it opens no sqlite handle in write mode,
//   3. it holds no write grant — no pen token, no push.
//
// ⚑ WHY THE SAFE SET IS A METHOD RULE WITH THREE NAMED HOLES, and not a list
// of paths. A path list is a second copy of the router that drifts the first
// time somebody adds a door, and it drifts SILENTLY toward danger: a new write
// door absent from the list is a write door a read worker will happily serve.
// The method rule fails the other way — a new door is unsafe until somebody
// says otherwise, which is the direction a mistake should fall.

export const ROLES = ["write", "read"];

/**
 * The three doors a GET reaches that are NOT reads, each excluded by the line
 * that makes it a write:
 *
 *   /mcp                     — POST-only in practice, but it also mints
 *                              sessions and dispatches every `do:` verb; the
 *                              door REQUIRES a credential even for reads
 *                              (server.mjs's own note) and its writes are the
 *                              whole reason a second writer is forbidden.
 *   /oauth*                  — every handleOauth request ends in `sweep(odb)`,
 *                              the housekeeping DELETEs (run after the answer
 *                              since POS-480), and the dance goes on to INSERT
 *                              tokens. A GET here is a write.
 *   /.well-known/oauth-*     — same handler, same sweep. Discovery looks like
 *   /.well-known/openid-…      a read and is not one.
 *
 * Everything else a GET can reach was measured on 2026-09-08 against the real
 * server, one route at a time with the dynamic store deleted between them:
 * 41 GET routes, ZERO created or touched dynamic.db. The one write every read
 * does is the telemetry line, which is not sqlite — see the note in
 * `server.mjs` where `logAccess` is wired.
 */
export function workerSafe(method, path) {
  if (method !== "GET" && method !== "HEAD") return false;
  if (path === "/mcp") return false;
  if (path.startsWith("/oauth")) return false;
  if (path.startsWith("/.well-known/oauth-")) return false;
  if (path.startsWith("/.well-known/openid-configuration")) return false;
  return true;
}

/** The role this process was started as. Anything but "read" is the writer. */
export function roleFrom(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--role");
  const raw = String((i !== -1 ? argv[i + 1] : undefined) ?? env.OFFICE_ROLE ?? "write").trim().toLowerCase();
  if (!ROLES.includes(raw))
    throw new Error(`unknown --role "${raw}" — roles are ${ROLES.join(" | ")}`);
  return raw;
}

/**
 * Where a refused write should be sent. A 405 that will not say where the
 * writer is makes every caller a guesser, and the whole point of the pool is
 * that a caller cannot tell which worker it reached.
 */
export function writerAddressFrom(argv = process.argv, env = process.env) {
  const i = argv.indexOf("--writer");
  return String((i !== -1 ? argv[i + 1] : undefined) ?? env.OFFICE_WRITER_URL ?? env.PUBLIC_BASE ?? "https://postmark.town/api").replace(/\/+$/, "");
}

/**
 * The pen a process of this role may hold.
 *
 * ⚑ THIS IS A FUNCTION BECAUSE THE FLIP PROVED THE CLAIM WAS UNWATCHED. The
 * first draft of `test/read-worker.test.mjs § 4` asserted three things — the
 * token is in the boot env, POST /residency answers 405, and the boot line says
 * "no write grant" — and F6 (keep the token in the read role) left every one of
 * them TRUE, so the suite stayed green with a read worker holding a live pen.
 * The route refusal is §1's claim, not §4's; the boot line is a sentence about
 * the role, not a reading of the grant. Nothing anywhere looked at the token.
 *
 * The grant decision lives here so it can be driven directly, and the office
 * DISCLOSES the answer at `/release` so the end-to-end leg reads the running
 * process rather than a sentence about it. Two checks, one fact, both able to
 * fail — which is what the last three lanes' carry keeps asking for.
 */
export function penTokenFor(role, env = process.env) {
  return role === "read" ? "" : (env.POSTMARK_PEN_TOKEN ?? "");
}

/** What this process will admit about itself at `/release`. */
export const roleDisclosure = (role, writer) => ({
  role,
  write_grant: role !== "read",
  ...(role === "read" ? { writes_at: writer } : {}),
});

/** The bounce a read worker answers every unsafe door with. */
export const readRoleBounce = (writer) => ({
  code: 405,
  defect: "this office reads only",
  hint: `you reached a read-only worker; writes and the MCP door are served by the writer at ${writer} — the same request there will be answered`,
});
