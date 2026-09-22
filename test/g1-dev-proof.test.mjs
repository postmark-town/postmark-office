// g1-dev-proof.test.mjs — THE PROBE CAN FAIL, AND IT FAILS FOR THE RIGHT HALF.
//
// `tools/g1-dev-proof.mjs` is run by hand against the dev office, so nothing in
// the suite exercises it on the way past. A hand-run script with no test is the
// "a flip that patches nothing runs green" class: it would be discovered to be
// a no-op on the one night it was relied on.
//
// So a STUB OFFICE speaks the six routes the probe reads and writes, and each
// case moves exactly ONE thing:
//
//   · everything right, the journal frozen          → exit 0
//   · everything right, the journal ADVANCING       → exit 1 (the sqlite half)
//   · the journal frozen, a READER that lost the act→ exit 1 (the read-back half)
//   · the journal advancing, --expect-journal       → exit 0 (the pre-G1 run)
//
// The third case is the one that matters most: a probe that only ever watched
// the journal counter would pass an office whose doors had stopped reaching any
// reader at all, which is the failure this lane is about.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, "..", "tools", "g1-dev-proof.mjs");

/**
 * A stub office. `opts.journalPerWrite` is how far `journal_head` moves on each
 * write — 0 is the world after G1. `opts.blindReader` makes the store-backed
 * reads answer 200 with nothing of the act in them, which is the failure mode a
 * counter-only probe would sail past.
 */
function stubOffice({ journalPerWrite = 0, blindReader = false } = {}) {
  let head = 100, journal = 100, movements = 50;
  const spoken = [];
  const marks = [];
  const walkers = [];

  const server = createServer((req, res) => {
    const url = new URL(req.url, "http://x");
    const send = (code, body) => {
      res.writeHead(code, { "content-type": "application/json" });
      res.end(JSON.stringify(body));
    };
    const wrote = () => { head += journalPerWrite; journal += journalPerWrite; };

    if (url.pathname === "/me") return send(200, { handles: ["probe"], households: { probe: "probe" } });
    if (url.pathname === "/world/orient") return send(200, { you: { x: 10, y: 20 } });
    if (url.pathname === "/world/dynamic") return send(200, { db: { journal, journal_head: head, movements } });

    if (url.pathname === "/world/marks" && req.method === "POST") {
      let raw = ""; req.on("data", (c) => { raw += c; });
      return req.on("end", () => { const b = JSON.parse(raw || "{}"); marks.push(b.slug); wrote(); send(200, { id: `probe/${b.slug}` }); });
    }
    if (url.pathname === "/world/walks" && req.method === "POST") {
      return req.on("data", () => {}).on("end", () => {
        walkers.push("probe"); wrote();
        send(200, { position: { x: 10, y: 20 }, movement: { record: "acts (Postgres)" }, log: "acts", seq: null });
      });
    }
    if (url.pathname === "/world/say" && req.method === "POST") {
      let raw = ""; req.on("data", (c) => { raw += c; });
      return req.on("end", () => { const b = JSON.parse(raw || "{}"); spoken.push(b.text); wrote(); send(200, { spoke: true }); });
    }

    if (url.pathname === "/world2/investigate") return send(200, blindReader ? { mark: null } : { mark: marks.at(-1) });
    if (url.pathname === "/world2/walks") return send(200, blindReader ? { records: [] } : { records: walkers.map((h) => ({ handle: h })) });
    if (url.pathname === "/world2/say") return send(200, blindReader ? { voices: [] } : { voices: spoken.map((t) => ({ text: t })) });
    if (url.pathname === "/world2/apex") return send(200, { at: { x: 10, y: 20 } });

    return send(404, { error: "no such door" });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` }));
  });
}

/** Run the probe and hand back its exit code and its whole output. */
function runProbe(base, extra = []) {
  return new Promise((resolve) => {
    execFile(process.execPath, [PROBE, "--base", base, "--key-env", "G1_PROBE_KEY", ...extra],
      { env: { ...process.env, G1_PROBE_KEY: "test-key" }, encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });
}

test("GREEN: the doors round-trip and the journal does not move", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0 });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /GREEN/);
    assert.match(r.out, /nothing was written to the sqlite journal/);
    assert.match(r.out, /the whole run moved journal_head by 0/);
  } finally { server.close(); }
});

test("RED on the SQLITE half: every read-back is right and the journal still advances", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 1 });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /RED/);
    // The failure names the half. A run that reddened without saying the
    // journal moved would send a reader looking at the doors.
    assert.match(r.out, /journal_head \+1/);
    assert.match(r.out, /the whole run moved journal_head by 3/);
  } finally { server.close(); }
});

test("RED on the READ-BACK half: the journal is frozen and no reader holds the act", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 0, blindReader: true });
  try {
    const r = await runProbe(base);
    assert.equal(r.code, 1, `expected exit 1, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /RED/);
    // THE WHOLE POINT. The counter is perfect and the run is still red,
    // because the act reached nobody.
    assert.match(r.out, /the whole run moved journal_head by 0/);
    assert.match(r.out, /did not reach the reader|does not carry the line back/);
  } finally { server.close(); }
});

test("--expect-journal is the PRE-G1 run: an advancing journal is green, and the line says which expectation was held", async () => {
  const { server, base } = await stubOffice({ journalPerWrite: 1 });
  try {
    const r = await runProbe(base, ["--expect-journal"]);
    assert.equal(r.code, 0, `expected exit 0, got ${r.code}:\n${r.out}`);
    assert.match(r.out, /expectation: PRE-G1/);
    assert.match(r.out, /pre-G1 expectation: the journal still grew, as declared/);
  } finally { server.close(); }
});

test("a missing --base exits 2, never 0 — a probe that never ran may not read as a pass", async () => {
  const r = await new Promise((resolve) => {
    execFile(process.execPath, [PROBE], { encoding: "utf8" },
      (err, stdout, stderr) => resolve({ code: err ? (err.code ?? 1) : 0, out: `${stdout}${stderr}` }));
  });
  assert.equal(r.code, 2);
});
