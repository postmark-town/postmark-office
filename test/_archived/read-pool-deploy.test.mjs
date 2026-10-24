// ARCHIVED 2026-10-20 (POS-729), with the kit it tested, now in deploy/_archived/.
// Every assertion here reads the process-pool kit (the template, the slice and the
// two nginx confs), which was never installed: the office's read workers are
// worker_threads in the writer (src/read-workers.mjs, POS-266). The suite runs
// test/*.test.mjs only, so this file no longer runs, and its paths are as they
// stood at retirement. workerSafe keeps its own coverage in test/read-worker.test.mjs.
//
// read-pool-deploy.test.mjs — the deploy kit's own falsifier (DEC-4 / G3).
//
// THE GAP THIS CLOSES, in the reviewer's words: "No test names either" — the
// slice and the nginx confs had no check anywhere in `test/`, so the two
// artifacts that decide what a read worker RECEIVES were the only part of this
// lane nothing could contradict.
//
// It cost a real defect. The method map sends every GET under /api/ to the
// pool; the office's `workerSafe` correctly refuses /oauth* there. Both halves
// were right on their own and disagreed with each other, and the disagreement
// was invisible because nothing compared them. `§ 1` below is that comparison,
// and it is mechanical: it asks the CONF which upstream a path reaches, asks
// `workerSafe` whether a worker would serve it, and fails on any path where the
// two answers differ.
//
// What it cannot see, said plainly: this parses the conf, it does not run
// nginx. Directive semantics (does `^~` really beat the regex on this build?)
// are proven by driving a scratch nginx, which the report records; this file
// catches the class of mistake that survives a green drive because nobody
// thought to drive that path.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { workerSafe } from "../src/role.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "deploy");
const SNIPPET = join(DEPLOY, "nginx-postmark-read-pool.conf");
const UPSTREAMS = join(DEPLOY, "nginx-postmark-read-pool-upstreams.conf");
const TEMPLATE = join(DEPLOY, "postmark-office-read@.service");
const SLICE = join(DEPLOY, "postmark-reads.slice");

const read = (p) => readFileSync(p, "utf8");

/**
 * Which upstream a GET for `path` reaches, decided the way nginx decides it:
 * exact `=` first, then `^~` prefixes longest-first, then regexes in file
 * order, then the longest plain prefix.
 */
function upstreamFor(conf, path) {
  const blocks = [...conf.matchAll(/^location\s+(=\s+|\^~\s+|~\s+)?(\S+)\s*\{([\s\S]*?)^\}/gm)]
    .map((m) => ({ kind: (m[1] ?? "").trim(), pat: m[2], body: m[3] }));
  const target = (b) => (/proxy_pass\s+http:\/\/postmark_office_writer/.test(b.body) ? "writer"
    : /proxy_pass\s+http:\/\/\$postmark_upstream/.test(b.body) ? "pool"
    : /proxy_pass/.test(b.body) ? "other" : "none");

  const exact = blocks.find((b) => b.kind === "=" && b.pat === path);
  if (exact) return target(exact);
  const carets = blocks.filter((b) => b.kind === "^~" && path.startsWith(b.pat))
    .sort((a, b) => b.pat.length - a.pat.length);
  if (carets.length) return target(carets[0]);
  const rx = blocks.find((b) => b.kind === "~" && new RegExp(b.pat).test(path));
  if (rx) return target(rx);
  const plain = blocks.filter((b) => !b.kind && path.startsWith(b.pat))
    .sort((a, b) => b.pat.length - a.pat.length);
  if (plain.length) return target(plain[0]);
  return "unmatched";
}

// ── § 1 · the two halves must agree ─────────────────────────────────────────

test("§1 no path the office refuses on a worker is routed to the pool", () => {
  const conf = read(SNIPPET);
  // Real advertised URLs, not synthetic ones. PUBLIC_BASE defaults to
  // https://postmark.town/api (src/oauth.mjs), so every OAuth door lives under
  // /api/ — live discovery answers
  // "authorization_endpoint": "https://postmark.town/api/oauth/authorize".
  const paths = [
    "/api/oauth/authorize",
    "/api/oauth/github/callback",
    "/api/oauth/berth-cosign",
    "/api/oauth/token",
    "/api/.well-known/openid-configuration",
    "/api/.well-known/oauth-protected-resource",
    "/api/mcp",
  ];
  const wrong = [];
  for (const p of paths) {
    const officePath = p.replace(/^\/api/, "");     // nginx strips /api before the office sees it
    const servedByWorker = workerSafe("GET", officePath);
    const routed = upstreamFor(conf, p);
    if (!servedByWorker && routed === "pool") wrong.push(`${p} -> pool, but workerSafe("GET","${officePath}") is false`);
  }
  assert.equal(wrong.length, 0,
    "the map and the office disagree — a GET routed to a worker that the worker refuses is a 405 in a resident's face:\n  " + wrong.join("\n  "));
});

test("§1b ...and the check can fail — an ordinary read still reaches the pool", () => {
  // Without this, § 1 passes just as happily against a conf that pins
  // EVERYTHING to the writer, which would be no pool at all.
  const conf = read(SNIPPET);
  assert.equal(upstreamFor(conf, "/api/town"), "pool");
  assert.equal(upstreamFor(conf, "/api/world/apex"), "pool");
  assert.equal(workerSafe("GET", "/town"), true);
});

// ── § 2 · a replacement file must carry what it replaces ────────────────────

test("§2 every location in the live snippet is present in the replacement", () => {
  // The lap-2 file carried a section claiming five locations were "NOT
  // TOUCHED"; all five live in the file it replaces, so installing it as its
  // own header instructs would have DELETED them — including the two root
  // discovery blocks MCP clients fetch. A comment cannot carry a location
  // forward; only the file can.
  //
  // The live snippet's seven locations, read off the box on 2026-09-08.
  const LIVE = [
    "/.well-known/oauth-",
    "/.well-known/openid-configuration",
    "~ ^/api/world/(apex|conversations|walkers|state|present)$",
    "/api/",
    "= /mcp",
    "= /mcp/",
    "@postmark_keyless_rate",
  ];
  const conf = read(SNIPPET);
  const missing = LIVE.filter((l) => !conf.includes(`location ${l} {`));
  assert.equal(missing.length, 0,
    "the replacement would DELETE these locations from the live config:\n  " + missing.join("\n  "));
});

// ── § 3 · the unit's bound must actually ship ───────────────────────────────

test("§3 the template names a slice, and that slice file is in the kit", () => {
  // The install-order hazard, mechanically: a `Slice=` naming a unit that does
  // not exist does not fail — it drops the worker into the default slice with
  // no bound, which reads exactly like success.
  const unit = read(TEMPLATE);
  const m = /^Slice=(\S+)$/m.exec(unit);
  assert.ok(m, "the template must name a slice, or the pool has no CPU envelope at all");
  const sliceUnit = m[1];
  assert.ok(existsSync(join(DEPLOY, sliceUnit)),
    `the template names ${sliceUnit} and the kit does not ship it — installing this template alone gives the pool no bound, silently`);
});

test("§3b the slice carries a real quota, and the recipe's expected cpu.max matches it", () => {
  // The recipe's own number was wrong: it said `2500000 100000`, which is the
  // per-SECOND figure written beside the per-PERIOD instrument, so a correct
  // install would have read as broken at the only check that could fail.
  // cpu.max is quota-and-period in microseconds; the default period is 100000.
  const slice = read(SLICE);
  const q = /^CPUQuota=(\d+)%$/m.exec(slice);
  assert.ok(q, "the slice must carry a CPUQuota, or it is not an envelope");
  const pct = Number(q[1]);
  const expectedQuota = pct * 1000;              // percent -> microseconds of a 100000us period
  const unit = read(TEMPLATE);
  assert.ok(unit.includes(`${expectedQuota} 100000`),
    `the recipe tells the operator to expect a cpu.max the slice cannot produce — CPUQuota=${pct}% is "${expectedQuota} 100000"`);
  assert.ok(/^CPUWeight=\d+$/m.test(slice), "the weight is what protects a crossing under contention; the quota is only the backstop");
});

test("§3c the recipe's own envelope check is one that CAN fail", () => {
  // Reviewer's repair 3, and it is this file's turn to be caught by a flip: D3
  // put the always-passing `systemctl show -p Slice` check back into the recipe
  // and every leg here stayed green. I had CORRECTED that check in lap 3 and
  // then written no test that would notice it coming back — a fix with no
  // guard is a fix that lasts until the next edit.
  //
  // `-p Slice` echoes the name the unit asked for whether or not the slice
  // exists, so it cannot fail. `FragmentPath` is empty when there is no unit
  // file, which is exactly the "named a slice that does not ship" case.
  const unit = read(TEMPLATE);
  assert.ok(/systemctl show -p FragmentPath --value postmark-reads\.slice/.test(unit),
    "the recipe must check FragmentPath — it is the only one of the three that goes empty when the bound is absent");
  assert.ok(/ControlGroup/.test(unit),
    "and it must check the worker is actually IN the slice, not merely that it asked for one");
  assert.ok(!/systemctl show .*-p Slice/.test(unit),
    "`-p Slice` echoes the requested name whether or not the slice exists — a check that cannot fail must not sit in a recipe as though it can");
});

// ── § 4 · the verify list must name what broke ─────────────────────────────

test("§4 the kit's verify list drives the OAuth doors", () => {
  // Neither the drive table nor the verify list would have caught the sign-in
  // break, because neither mentioned an OAuth URL. A recipe that omits the
  // thing that broke last time teaches the next operator to omit it too.
  const conf = read(SNIPPET);
  for (const url of ["/api/oauth/authorize", "/api/oauth/github/callback", "/api/.well-known/openid-configuration"]) {
    assert.ok(conf.includes(url), `the verify list must drive ${url} — it was 405 at the last pin and nothing checked it`);
  }
  assert.ok(/must NOT be 405|not be 405/i.test(conf), "and it must say what a wrong answer looks like");
});

// ── § 5 · the two files know they are two files ────────────────────────────

test("§5 the http-context half is named by the server-context half", () => {
  // upstream and map cannot live in a snippet included inside server{}; an
  // earlier draft had all of it in one file, which fails `nginx -t` with a
  // context error at install time.
  const conf = read(SNIPPET);
  const up = read(UPSTREAMS);
  assert.ok(/upstream postmark_office_reads/.test(up) && /^map \$request_method/m.test(up));
  assert.ok(!/^upstream /m.test(conf) && !/^map /m.test(conf),
    "http-context directives in the server-context snippet would fail nginx -t at install");
  assert.ok(conf.includes("nginx-postmark-read-pool-upstreams.conf"),
    "the server half must tell the operator the other file exists and goes first");
});
