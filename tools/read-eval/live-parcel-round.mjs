// live-parcel-round.mjs — the POS-686 read-eval round: ONE booted throwaway office (office.mjs prepareRound + bootRun), ONE actor (`wright`, the harness's synthetic static key),
// baseline reads (twice, for the noise), one own-parcel amend (and a second, warm), one dependency-free withdrawal, matched reads during and after, over the doorstep (REST, MCP, bulk),
// the world entry (orient), investigate / find / state, the town's marks and my-marks, for the editing house and an unrelated one, keyed and anonymous. LOCAL and keyless: no box, dev
// or production act, no real credential. It reports what each reader actually SERVED (content fingerprints, where the ids and bodies appear), the office's own timing record per reader
// block (leases, bundle segments incl. `live_parcel`, the act's phases) and the counts, so a fast stale answer is never read as cheapness.
//
//   OUT=<report dir outside the tracked tree> node --import ./test/helpers/sparse-guard.mjs --import ./test/helpers/town-pins-env.mjs tools/read-eval/live-parcel-round.mjs
//
// The control is the accepted instrument head (45828bf4) run through this same script: check it out and run it; the readers the layer adds simply report no `live_parcel` segment. N (default 12) and ND (20) are the
// samples per reader, NB (6) per bulk read. Run it under `run-heavy` on a pool tree; a run takes 10 to 20 minutes on a shared box.
// POS-686 instrument round: ONE booted throwaway office (tools/read-eval/office.mjs prepareRound + bootRun), ONE actor (`wright`, the harness's synthetic static key, nobody else's house),
// baseline reads, one own-parcel amend, one dependency-free withdrawal, matched reads before / during / after, all in that office. LOCAL and keyless: no box, dev or production act, no real credential.

import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
const R = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");   // the office tree this file sits in
const OUT = process.env.OUT; mkdirSync(OUT, { recursive: true });
const N = Number(process.env.N ?? 12);
const { prepareRound, bootRun, mcp } = await import("./office.mjs");
const { steady } = await import(R + "/test/helpers/twin-golden.mjs");
const lines = [];
const say = (s = "") => { lines.push(s); console.log(s); };
const sha = (t) => createHash("sha256").update(t).digest("hex").slice(0, 12);
const stat = (xs) => { if (!xs.length) return "n=0"; const s = [...xs].sort((a, b) => a - b); const p = (f) => s[Math.min(s.length - 1, Math.floor(f * s.length))]; return `n=${s.length} p50 ${p(0.5).toFixed(0)} p95 ${p(0.95).toFixed(0)} max ${s.at(-1).toFixed(0)} ms`; };

const TARGET = "wright/the-drafting-table";      // an authored own-parcel mark with nothing on it, amended
const WITHDRAW = "wright/the-keystone";           // a published own-parcel leaf with nothing on it, withdrawn
const OLD_MARK = "A tilted sheet of working drawings";   // the amended mark's published body begins so
const NEW_TOKEN = "POS686AMEND";
const NEW_TOKEN2 = "POS686SECOND";
const ND = Number(process.env.ND ?? 20);   // samples per doorstep-family reader
const AMENDED = `A tilted sheet of working drawings, re-inked between crossings. ${NEW_TOKEN}`;
const AMENDED2 = `A tilted sheet of working drawings, re-inked again before the crossing. ${NEW_TOKEN2}`;
const UNRELATED = "little-bird";                  // another house's doorstep, read anonymously: must not recompose or move

const dir = mkdtempSync(join(tmpdir(), "r686-round-"));
const accessDir = join(dir, "access"); mkdirSync(accessDir, { recursive: true });
say(`# POS-686 read-eval round, ${new Date().toISOString()}`);
const t00 = Date.now();
const round = await prepareRound({ handle: "wright", dir, log: (l) => console.log("   [prepare]", l) });
round.env.OFFICE_ACCESS_LOG_DIR = accessDir;     // harness-local: the office's own access log (read-timing record) lands here
round.env.OFFICE_READ_WORKERS = "1";
// harness-local: this instrument's own request volume (bulk reads cost 25) must not trip the office's per-IP / per-key bouncer; it is not what is measured
round.env.OFFICE_BOUNCER_KEYLESS_PER_MINUTE = "100000"; round.env.OFFICE_BOUNCER_KEYLESS_BURST = "100000"; round.env.OFFICE_BOUNCER_KEY_READ_PER_MINUTE = "100000";
say(`prepareRound stood up in ${Math.round((Date.now() - t00) / 1000)} s as wright (household ${round.household}); town clone ${round.clones.townHead.slice(0, 10)}, world clone ${round.clones.worldHead.slice(0, 10)}`);
const office = await bootRun(round, { shape: "v0", runId: `${process.pid}_round`, log: (l) => console.log("   [boot]", l) });
const key = office.key;
const base = office.base;

// ── WHAT IS RUNNING: effective code and data refs, fold mode, flags (an allowlist of names, no values that are secrets) ──────────────────────────────────────────────────────────────────────
const OFFICE_HEAD = execFileSync("git", ["-C", R, "rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const release = await (await fetch(base + "/release")).json();
const worldTags = execFileSync("git", ["-C", round.clones.world, "tag", "-l", "settlement/S*", "--sort=-v:refname"], { encoding: "utf8" }).split("\n").filter(Boolean);
say("");
say("## 0. What ran");
say(`- office code: ${OFFICE_HEAD.slice(0, 12)} (this tree; train b63d96b3 + the pin repair), booted by bootRun at shape v0, role ${release.role}, write_grant ${release.write_grant}`);
say(`- served data: town clone ${round.clones.townHead.slice(0, 12)} (scratch of the suite pin), world clone ${round.clones.worldHead.slice(0, 12)}, newest settlement tag in it ${worldTags[0]}; /release as_of ${String(release.as_of).slice(0, 12)}`);
say(`- flags: ${JSON.stringify(Object.fromEntries(Object.entries(round.env).filter(([k]) => /^(W2_|WORLD_APEX|WORLD_MOVEMENT_V2|WORLD_POSITIONS|STAMP_LINES|TOWN_PUSH|OFFICE_READ_WORKERS)/.test(k))))} ; W2_FOLD is ${Object.hasOwn(round.env, "W2_FOLD") ? "set" : "NOT set, so /world/state serves the published FILE state, not the store fold"}`);
say(`- actor: wright (synthetic static key ${key.slice(0, 5)}..., household ${round.household}); anonymous where a read is keyless; one throwaway store, one office process + 1 read worker`);

// ── the instrument: one request, timed, fingerprinted ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
async function GET(path, { auth = true } = {}) {
  const t0 = performance.now();
  const r = await fetch(base + path, { headers: auth ? { authorization: `Bearer ${key}` } : {} });
  const text = await r.text();
  return { status: r.status, text, ms: performance.now() - t0, reader: r.headers.get("x-pm-reader") ?? "main", bytes: Buffer.byteLength(text), t0w: Date.now() - (performance.now() - t0), t1w: Date.now() };
}
async function MCP(name, args) {
  const t0 = performance.now();
  const tw = Date.now();
  const r = await mcp(base, key, "tools/call", { name, arguments: args });
  return { t0w: tw, t1w: Date.now(), status: r.status, text: r.text, ms: performance.now() - t0, reader: "mcp", bytes: Buffer.byteLength(r.text), body: (() => { try { return JSON.parse(JSON.parse(r.text).result?.content?.[0]?.text ?? "null"); } catch { return null; } })() };
}
const fp = (text) => { try { return sha(steady(JSON.parse(text))); } catch { return sha(text); } };
const doorsteps = (text) => { try { const d = JSON.parse(text); return d; } catch { return null; } };
// `amended` counts the token beyond its echo in a query string (a find by the token echoes it in `q` and in the request path only)
const seen = (text) => ({ amended2: text.includes(NEW_TOKEN2), old: text.includes(OLD_MARK), amended: (text.split(NEW_TOKEN).length - 1) > (text.includes(`"q":"${NEW_TOKEN}"`) || text.includes(`"q": "${NEW_TOKEN}"`) ? 1 : 0), target: text.includes(TARGET), keystone: text.includes(WITHDRAW) });

const roster = JSON.parse((await GET("/residents?limit=60", { auth: false })).text);
const rosterHandles = (Array.isArray(roster) ? roster : roster.residents ?? roster.rows ?? []).map((r) => r.handle ?? r).filter((h) => typeof h === "string" && /^[a-z0-9-]+$/.test(h));
const BULK = [...new Set(["wright", UNRELATED, ...rosterHandles])].slice(0, 25);
say(`- bulk set: ${BULK.length} handles (wright, ${UNRELATED}, then the roster's first)`);
// the readers, as a resident's page and agent reach them (actor, method, path)
const READERS = [
  { id: "doorstep REST (wright, key)", actor: "wright", how: "GET /doorstep/wright", n: ND, run: () => GET("/doorstep/wright") },
  { id: "doorstep REST (anonymous)", actor: "anonymous", how: "GET /doorstep/wright", n: ND, run: () => GET("/doorstep/wright", { auth: false }) },
  { id: "doorstep MCP household doorstep (wright)", actor: "wright", how: "POST /mcp household {read:doorstep}", n: ND, run: () => MCP("household", { read: "doorstep", handle: "wright" }) },
  { id: "doorstep REST of an UNRELATED house (anonymous)", actor: "anonymous", how: `GET /doorstep/${UNRELATED}`, n: ND, run: () => GET(`/doorstep/${UNRELATED}`, { auth: false }) },
  { id: "BULK doorsteps, 25 handles incl. the editing house and the unrelated one (anonymous)", actor: "anonymous", how: "GET /doorsteps?handles=<25>", n: Number(process.env.NB ?? 6), run: () => GET(`/doorsteps?handles=${BULK.join(",")}`, { auth: false }) },
  { id: "town marks of the editing house (wright, key)", actor: "wright", how: "POST /mcp town {read:marks, handle:wright}", n: N, run: () => MCP("town", { read: "marks", args: { handle: "wright" } }) },
  { id: "town marks of the UNRELATED house (wright, key)", actor: "wright", how: `POST /mcp town {read:marks, handle:${UNRELATED}}`, n: N, run: () => MCP("town", { read: "marks", args: { handle: UNRELATED } }) },
  { id: "world orient (anonymous)", actor: "anonymous", how: "GET /world/orient", n: N, run: () => GET("/world/orient", { auth: false }) },
  { id: "world orient (wright, key)", actor: "wright", how: "GET /world/orient", n: N, run: () => GET("/world/orient") },
  { id: "world investigate the amended mark (wright, key)", actor: "wright", how: `GET /world/investigate?mark=${TARGET}`, n: N, run: () => GET(`/world/investigate?mark=${TARGET}`) },
  { id: "world investigate the amended mark (anonymous)", actor: "anonymous", how: `GET /world/investigate?mark=${TARGET}`, n: N, run: () => GET(`/world/investigate?mark=${TARGET}`, { auth: false }) },
  { id: "world find by the slug word (anonymous)", actor: "anonymous", how: "GET /world/find?q=drafting", n: N, run: () => GET(`/world/find?q=${encodeURIComponent("drafting")}`, { auth: false }) },
  { id: "world find by the new token (anonymous)", actor: "anonymous", how: `GET /world/find?q=${NEW_TOKEN}`, n: N, run: () => GET(`/world/find?q=${NEW_TOKEN}`, { auth: false }) },
  { id: "world state (anonymous; published FILE state)", actor: "anonymous", how: "GET /world/state", n: 4, run: () => GET("/world/state", { auth: false }) },
  { id: "my marks (wright, key)", actor: "wright", how: "GET /world/my-marks", n: N, run: () => GET("/world/my-marks") },
  { id: "my marks, store twin (wright, key)", actor: "wright", how: "GET /world2/my-marks", n: N, run: () => GET("/world2/my-marks") },
  { id: "find the withdrawn leaf (anonymous)", actor: "anonymous", how: "GET /world/find?q=keystone", n: N, run: () => GET(`/world/find?q=${encodeURIComponent("keystone")}`, { auth: false }) },
  { id: "investigate the withdrawn leaf (wright, key)", actor: "wright", how: `GET /world/investigate?mark=${WITHDRAW}`, n: N, run: () => GET(`/world/investigate?mark=${WITHDRAW}`) },
];

const J = (t) => { try { return JSON.parse(t); } catch { return null; } };
const where = (text, needle, max = 5) => { const out = []; const walk = (v, p, d) => { if (out.length >= max) return; if (typeof v === "string") { if (v.includes(needle)) out.push(p); } else if (v && typeof v === "object" && d < 7) for (const [k, x] of Object.entries(v)) walk(x, p + "/" + k, d + 1); }; walk(J(text), "", 0); return out; };
const phases = {};
// which JSON paths (depth <= 4) differ between two served answers, ignoring the paths that already differ between two BASELINE samples (the clock and rotating text)
const pathsOf = (v, p = "", d = 0, out = new Map()) => {
  if (v && typeof v === "object" && d < 4) { for (const [k, x] of Object.entries(v)) pathsOf(x, p + "/" + k, d + 1, out); if (Array.isArray(v)) out.set(p + "#len", String(v.length)); }
  else out.set(p, JSON.stringify(v)?.slice(0, 160));
  return out;
};
const changedPaths = (a, b, noise) => { const A = pathsOf(J(a)), B = pathsOf(J(b)); const out = []; for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k) && !noise.has(k)) out.push(`${k}: ${A.get(k) ?? "(absent)"} → ${B.get(k) ?? "(absent)"}`); return out; };
const CAPTURE = ["town marks of the editing house (wright, key)", "doorstep REST (wright, key)", "doorstep REST (anonymous)", "my marks (wright, key)", "my marks, store twin (wright, key)", "world investigate the amended mark (wright, key)", "investigate the withdrawn leaf (wright, key)"];
async function phase(name, { cold = false } = {}) {
  const t0 = Date.now(); const rows = {};
  for (const r of READERS) {
    const samples = [];
    for (let i = 0; i < r.n; i++) samples.push(await r.run());
    rows[r.id] = { r, samples, w0: samples[0]?.t0w, w1: samples.at(-1)?.t1w };
  }
  phases[name] = { t0, t1: Date.now(), rows, text: Object.fromEntries(CAPTURE.map((id) => { const t = (x) => (x?.body ? JSON.stringify(x.body) : x?.text); return [id, [t(rows[id].samples[1]), t(rows[id].samples.at(-1))]]; })) };
  return rows;
}
const summarise = (name) => {
  const ph = phases[name];
  say("");
  say(`### ${name}`);
  say("| reader (actor, method path) | status | served by | bytes | content fp | sees old body / new token / amended id / keystone | wall ms |");
  say("|---|---|---|---|---|---|---|");
  for (const { r, samples } of Object.values(ph.rows)) {
    const first = samples[0], last = samples.at(-1), s = seen(last.text);
    const fps = [...new Set(samples.map((x) => fp(x.text)))];
    say(`| ${r.id} (${r.actor}; ${r.how}) | ${last.status} | ${last.reader} | ${last.bytes} | ${fps.join("/")}${fps.length > 1 ? " (varies)" : ""} | ${s.old ? "old" : "-"} / ${s.amended ? "NEW" : "-"} / ${s.target ? "id" : "-"} / ${s.keystone ? "yes" : "no"} | cold ${first.ms.toFixed(0)}; ${stat(samples.slice(1).map((x) => x.ms))} |`);
  }
};

// ── 1. BASELINE: the first read of each is cold (this office has served nothing yet), then warm repeats ──────────────────────────────────────────────────────────────────────────
say(""); say("## 1. Baseline (before any act)");
await phase("baseline");
summarise("baseline");
await phase("baseline 2 (same state, the noise)");
const baseDoor = READERS.slice(0, 4).map((r) => phases.baseline.rows[r.id].samples.at(-1));
const doorBefore = doorsteps(baseDoor[0].text);
say(`- doorstep rev before (wright REST): ${doorBefore?.rev ?? "(none)"}; unrelated house rev: ${doorsteps(baseDoor[3].text)?.rev ?? "(none)"}`);
const stateOnce = JSON.parse(phases.baseline.rows["world state (anonymous; published FILE state)"].samples.at(-1).text);
say(`- /world/state meta.source: ${JSON.stringify(stateOnce.meta?.source ?? null)}; marks ${stateOnce.marks?.length}; the amended mark's served body begins "${String(stateOnce.marks?.find((m) => m.id === TARGET)?.body ?? "").slice(0, 40)}"`);

// ── 2. THE AMEND, with matched reads DURING it ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
say(""); say("## 2. One own-parcel amend (authored content of an existing mark), reads during and after");
const aboutTarget = stateOnce.marks.find((m) => m.id === TARGET);
say(`- target ${TARGET}: kind ${aboutTarget?.kind}, at ${JSON.stringify(aboutTarget?.at)}, extent ${JSON.stringify(aboutTarget?.extent)}`);
let actDone = false;
const duringReads = [];
const actStart = performance.now();
const during = (async () => {   // a continuous matched stream of the paths that show content, while the act runs
  while (!actDone) {
    for (const rid of ["doorstep REST (wright, key)", "world investigate the amended mark (wright, key)", "world find by the new token (anonymous)", "my marks (wright, key)"]) {
      const r = READERS.find((x) => x.id === rid); const t = performance.now(); const x = await r.run();
      duringReads.push({ id: rid, at: t - actStart, ms: x.ms, amended: seen(x.text).amended, old: seen(x.text).old, status: x.status });
    }
  }
})();
const amend = await MCP("world", { do: "leave-mark", args: { slug: "the-drafting-table", kind: aboutTarget.kind, by: "wright", at: aboutTarget.at, extent: aboutTarget.extent, body: AMENDED, amend: true } });
const actMs = performance.now() - actStart;
actDone = true; await during;
say(`- act: MCP tools/call world {do:"leave-mark", args:{slug:"the-drafting-table", amend:true, body:"${AMENDED.slice(0, 40)}...", at/extent unchanged}} as wright → status ${amend.status}, ${actMs.toFixed(0)} ms`);
say(`- act answer: ${JSON.stringify(amend.body ?? amend.text).slice(0, 700)}`);
say(`- reads made DURING the act (${duringReads.length}): ${["doorstep REST (wright, key)", "world investigate the amended mark (wright, key)", "world find by the new token (anonymous)", "my marks (wright, key)"].map((id) => { const xs = duringReads.filter((d) => d.id === id); return `${id}: n=${xs.length}, saw NEW in ${xs.filter((d) => d.amended).length}, ${stat(xs.map((d) => d.ms))}`; }).join("; ")}`);
await phase("after the amend");
summarise("after the amend");
const afterAmend = phases["after the amend"].rows;
const doorAfter = doorsteps(afterAmend["doorstep REST (wright, key)"].samples.at(-1).text);
say(`- doorstep rev after the amend (wright REST): ${doorAfter?.rev ?? "(none)"} (before ${doorBefore?.rev ?? "(none)"}); unrelated house rev after: ${doorsteps(afterAmend["doorstep REST of an UNRELATED house (anonymous)"].samples.at(-1).text)?.rev ?? "(none)"}`);

say(""); say("## 2b. A second amend of the same mark (warm: the first act's cold cost is behind this office)");
const amend2Start = performance.now();
const amend2 = await MCP("world", { do: "leave-mark", args: { slug: "the-drafting-table", kind: aboutTarget.kind, by: "wright", at: aboutTarget.at, extent: aboutTarget.extent, body: AMENDED2, amend: true } });
const amend2Ms = performance.now() - amend2Start;
say(`- act: second amend as wright → status ${amend2.status}, ${amend2Ms.toFixed(0)} ms (the first took ${actMs.toFixed(0)} ms)`);
const f2 = ["world investigate the amended mark (anonymous)", "world investigate the amended mark (wright, key)"].map((id) => { const x = READERS.find((r) => r.id === id); return x.run().then((o) => [id, seen(o.text)]); });
for (const [id, sn] of await Promise.all(f2)) say(`- right after the second amend, ${id}: new token 2 ${sn.amended2 ? "SEEN" : "not seen"}, token 1 ${sn.amended ? "still seen (stale)" : "gone"}`);
await phase("after the re-amend");
summarise("after the re-amend");

// ── 3. THE WITHDRAWAL of a published leaf with nothing on it ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
say(""); say("## 3. One dependency-free withdrawal (a published own-parcel leaf), reads during and after");
actDone = false; duringReads.length = 0;
const keyAt = stateOnce.marks.find((m) => m.id === WITHDRAW)?.at ?? { x: 0, y: 0 };
const tellAt = async () => { const t = JSON.parse((await GET(`/world/eyes?x=${keyAt.x}&y=${keyAt.y}`, { auth: false })).text); return { names: String(t.telling ?? "").includes(`[${WITHDRAW}`), objects: (t.objects ?? []).some((o) => o.id === WITHDRAW) }; };
const tellBefore = await tellAt();
const wStart = performance.now();
const during2 = (async () => {
  while (!actDone) {
    for (const rid of ["world find the withdrawn leaf (anonymous)".replace("world find", "find"), "investigate the withdrawn leaf (wright, key)", "my marks (wright, key)", "doorstep REST (wright, key)"]) {
      const r = READERS.find((x) => x.id === rid); if (!r) continue; const t = performance.now(); const x = await r.run();
      duringReads.push({ id: rid, at: t - wStart, ms: x.ms, keystone: seen(x.text).keystone, status: x.status });
    }
  }
})();
const withdraw = await MCP("world", { do: "withdraw", args: { mark: WITHDRAW } });
const wMs = performance.now() - wStart;
actDone = true; await during2;
say(`- act: MCP tools/call world {do:"withdraw", args:{mark:"${WITHDRAW}"}} as wright → status ${withdraw.status}, ${wMs.toFixed(0)} ms`);
say(`- act answer: ${JSON.stringify(withdraw.body ?? withdraw.text).slice(0, 700)}`);
say(`- reads made DURING the withdrawal (${duringReads.length}): ${[...new Set(duringReads.map((d) => d.id))].map((id) => { const xs = duringReads.filter((d) => d.id === id); return `${id}: n=${xs.length}, still show the leaf in ${xs.filter((d) => d.keystone).length}, ${stat(xs.map((d) => d.ms))}`; }).join("; ")}`);
await phase("after the withdrawal");
summarise("after the withdrawal");
{
  const tellAfter = await tellAt();
  say(""); say("### The telling (anonymous `GET /world/eyes` at the withdrawn leaf's own spot)");
  say(`- before the withdrawal: the telling names ${WITHDRAW} ${tellBefore.names ? "YES" : "no"}, the compact objects list it ${tellBefore.objects ? "YES" : "no"}; after: names ${tellAfter.names ? "YES (still named)" : "no (not named)"}, objects ${tellAfter.objects ? "YES" : "no"}`);
}
say(""); say("### Where the marks appear in the served answers (JSON paths holding the id or the new body)");
for (const id of ["doorstep REST (wright, key)", "doorstep REST (anonymous)", "my marks (wright, key)"]) {
  const t = phases["after the withdrawal"].text[id][1];
  say(`- ${id}: target id at ${JSON.stringify(where(t, TARGET))}; keystone at ${JSON.stringify(where(t, WITHDRAW))}; token 2 at ${JSON.stringify(where(t, NEW_TOKEN2))}`);
}
for (const [id, t] of [["doorstep REST (wright, key), baseline", phases.baseline.text["doorstep REST (wright, key)"][1]]]) say(`- ${id}: target id at ${JSON.stringify(where(t, TARGET))}; keystone at ${JSON.stringify(where(t, WITHDRAW))}`);

// ── 3b. WHAT EACH EDIT CHANGED IN WHAT IS SERVED (JSON paths, depth <= 4; baseline noise removed) ──────────────────────────────────────────────────────────────────────────────────────────
say(""); say("## 3b. What changed in the served answers (JSON paths; paths that already differ between two baseline samples are removed as noise)");
for (const id of CAPTURE) {
  const [b1, b2] = phases.baseline.text[id]; const noiseMap = new Map(); const A = pathsOf(J(b1)), B = pathsOf(J(b2));
  const noise = new Set(); for (const k of new Set([...A.keys(), ...B.keys()])) if (A.get(k) !== B.get(k)) noise.add(k);
  const aAmend = phases["after the amend"].text[id][1], aWith = phases["after the withdrawal"].text[id][1];
  const d1 = changedPaths(b2, aAmend, noise), d2 = changedPaths(aAmend, aWith, noise);
  say(`- ${id}: baseline noise paths ${noise.size}; changed by the AMEND ${d1.length}${d1.length ? ": " + d1.slice(0, 8).join(" | ") : ""}; changed by the WITHDRAWAL ${d2.length}${d2.length ? ": " + d2.slice(0, 8).join(" | ") : ""}`);
}

// ── 3c. THE PUBLIC MARKET-MARK PROBE (scope): another author's MARKET mark has an amend and a withdraw owed in the store (rows written here, in this throwaway store, as the act road would) ─────────
say(""); say("## 3c. Scope probe: a common-ground (market) mark, edited and withdrawn in the store, must be served as canon");
{
  const ALDER = "alden/the-alder-at-the-green-lamp";
  const ALDER_NEW = "POS686MARKETPROBE";
  const canonAlder = JSON.parse((await GET("/world/state", { auth: false })).text).marks.find((m) => m.id === ALDER);
  say(`- canon: ${ALDER} tier ${canonAlder?.tier}, kind ${canonAlder?.kind}`);
  await office.query("world2_owner", "INSERT INTO acts (at, crossing, actor, action, object, class) VALUES (now(), 321, 'alden', 'amend', $1, 'mark'), (now(), 321, 'alden', 'withdraw', $1, 'mark')", [ALDER]);
  await office.query("world2_owner", "INSERT INTO windows (id, opens_at, closes_at, status) SELECT 321, now(), now() + interval '12 hours', 'open' WHERE NOT EXISTS (SELECT 1 FROM windows WHERE id = 321)");
  const inv = await GET(`/world/investigate?mark=${ALDER}`, { auth: false });
  const fnd = await GET(`/world/find?q=alder`, { auth: false });
  const st = JSON.parse((await GET("/world/state", { auth: false })).text).marks.find((m) => m.id === ALDER);
  say(`- investigate (anon): ${inv.status}, serves the canon body ${inv.text.includes(String(canonAlder?.body ?? "").slice(0, 30)) ? "YES" : "NO"}, new body ${inv.text.includes(ALDER_NEW) ? "SEEN (leak)" : "not seen"}`);
  say(`- find (anon): ${fnd.text.includes(ALDER) ? "still found (canon's)" : "NOT FOUND (leak)"}; /world/state: ${st ? "mark present with canon body " + (st.body === canonAlder?.body ? "YES" : "NO") : "mark MISSING (leak)"}`);
}

// ── 4. WHAT THE STORE HOLDS NOW (the carrier rows) and the act ledger ────────────────────────────────────────────────────────────────────────────────────────────────────────────
say(""); say("## 4. What the acts left in the store");
const claims = await office.query("world2_owner", "SELECT id, status, window_id, claimant, household, left(body, 60) AS body, supersedes IS NOT NULL AS supersedes_a_claim FROM claims ORDER BY submitted_at DESC LIMIT 5");
const acts = await office.query("world2_owner", "SELECT id, action, object, actor, crossing, household, left(payload::text, 140) AS payload FROM acts WHERE action IN ('amend','withdraw','leave-mark') ORDER BY id DESC LIMIT 5");
const marksRow = await office.query("world2_owner", "SELECT slug, status, locked_window, retired_window, left(body, 50) AS body FROM marks WHERE slug IN ($1, $2)", [TARGET, WITHDRAW]);
say(`- claims (newest 5): ${JSON.stringify(claims)}`);
say(`- acts (amend/withdraw/leave-mark, newest 5): ${JSON.stringify(acts)}`);
say(`- marks table rows for the two marks: ${JSON.stringify(marksRow)}  (empty = the store's marks table holds no row for them: canon is the published file state)`);

// ── 5. THE OFFICE'S OWN TIMING RECORD for the doorstep family (read-timing): compose / lease observations per phase ───────────────────────────────────────────────────────────────
say(""); say("## 5. read-timing records from the office's access log (doorstep family only)");
const accessLines = readdirSync(accessDir).flatMap((f) => readFileSync(join(accessDir, f), "utf8").split("\n").filter(Boolean)).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
const timed = accessLines.filter((l) => l.timing);
const bucket = (t) => { for (const [name, p] of Object.entries(phases)) if (t >= p.t0 - 50 && t <= p.t1 + 50) return name; return "during an act"; };
const agg = {};
for (const l of timed) {
  const k = `${bucket(Date.parse(l.ts))} | ${l.method} ${l.path.replace(/\/doorstep\/.+/, "/doorstep/<h>")} | route ${l.timing.route}${l.timing.worker != null ? " w" + l.timing.worker : ""}`;
  (agg[k] ??= []).push(l.timing);
}
say("| phase | request | n | total_ms p50/p95 | exec_ms p50 | queue_ms p50 | bundle sum_ms p50 | worker leases n / held sum ms p50 | main leases n / held sum ms p50 |");
say("|---|---|---|---|---|---|---|---|---|");
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const p95 = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(0.95 * s.length))] : null; };
for (const [k, ts] of Object.entries(agg)) {
  const [ph, req, route] = k.split(" | ");
  say(`| ${ph} | ${req} (${route}) | ${ts.length} | ${med(ts.map((t) => t.total_ms))}/${p95(ts.map((t) => t.total_ms))} | ${med(ts.map((t) => t.exec_ms))} | ${med(ts.map((t) => t.queue_ms))} | ${med(ts.map((t) => t.bundle?.sum_ms))} | ${med(ts.map((t) => t.leases?.worker?.n))} / ${med(ts.map((t) => t.leases?.worker?.held_ms?.sum))} | ${med(ts.map((t) => t.leases?.main?.n))} / ${med(ts.map((t) => t.leases?.main?.held_ms?.sum))} |`);
}
say(`(${timed.length} timed lines of ${accessLines.length}; cov: pen pool only; world and my-marks paths carry no timing record by design)`);

// ── 5b. PER READER BLOCK (so the editing house and the unrelated house are never mixed): the office's own bundle segments, leases, totals ─────────────────────────────
say(""); say("## 5b. Composition by reader block (access-log lines inside each block's own wall-clock window; the REST /doorstep/<h> rows are never pooled across houses)");
say("| phase | reader block | n lines | total_ms p50 | bundle sum_ms p50 | core n / ms | stances n / ms | stakes n / ms | live_parcel watch n / ms | live_parcel_scan n / ms | worker leases n / held ms p50 | main leases n / held ms |");
say("|---|---|---|---|---|---|---|---|---|---|---|---|");
const DOORFAM = [...READERS.filter((r) => /doorstep|BULK|town marks/.test(r.id)).map((r) => r.id)];
const compo = {};
for (const [pn, p] of Object.entries(phases)) for (const rid of DOORFAM) {
  const b = p.rows[rid]; if (!b?.w0) continue;
  const lns = timed.filter((l) => { const t = Date.parse(l.ts); return t >= b.w0 - 40 && t <= b.w1 + 40 && (rid.includes("town marks") ? l.path === "/mcp" && l.call?.tool === "town" : rid.includes("MCP") ? l.path === "/mcp" && l.call?.tool === "household" : rid.includes("BULK") ? l.path === "/doorsteps" : l.path.startsWith("/doorstep/")); });
  const seg = (n, k) => med(lns.map((l) => l.timing.bundle?.seg?.[n]?.[k]));
  compo[`${pn} | ${rid}`] = { n: lns.length, total: med(lns.map((l) => l.timing.total_ms)), bundle: med(lns.map((l) => l.timing.bundle?.sum_ms)), core: [seg("core", "n"), seg("core", "sum_ms")], stances: [seg("stances", "n"), seg("stances", "sum_ms")], stakes: [seg("stakes", "n"), seg("stakes", "sum_ms")], live: [seg("live_parcel", "n"), seg("live_parcel", "sum_ms")], scan: [seg("live_parcel_scan", "n"), seg("live_parcel_scan", "sum_ms")] };
  say(`| ${pn} | ${rid} | ${lns.length} | ${med(lns.map((l) => l.timing.total_ms))} | ${med(lns.map((l) => l.timing.bundle?.sum_ms))} | ${seg("core", "n")} / ${seg("core", "sum_ms")} | ${seg("stances", "n")} / ${seg("stances", "sum_ms")} | ${seg("stakes", "n")} / ${seg("stakes", "sum_ms")} | ${seg("live_parcel", "n")} / ${seg("live_parcel", "sum_ms")} | ${seg("live_parcel_scan", "n")} / ${seg("live_parcel_scan", "sum_ms")} | ${med(lns.map((l) => l.timing.leases?.worker?.n))} / ${med(lns.map((l) => l.timing.leases?.worker?.held_ms?.sum))} | ${med(lns.map((l) => l.timing.leases?.main?.n))} / ${med(lns.map((l) => l.timing.leases?.main?.held_ms?.sum))} |`);
}
say(""); say("## 5c. Where each act's time went (the office's act segments, access log)");
for (const l of timed.filter((x) => x.timing.act)) {
  const sg = l.timing.act.seg; say(`- ${l.call?.do}: total ${l.timing.total_ms} ms; handler ${sg.handler?.sum_ms ?? "-"} ms; dispatch ${sg.dispatch?.sum_ms ?? "-"} ms; orient ${sg.orient?.sum_ms ?? "-"}; eyes ${sg.eyes?.sum_ms ?? "-"}; pen leases ${l.timing.leases?.main?.n} (held ${l.timing.leases?.main?.held_ms?.sum} ms)`);
}

writeFileSync(join(OUT, "round-report.md"), lines.join("\n") + "\n");
writeFileSync(join(OUT, "round-raw.json"), JSON.stringify({ phases: Object.fromEntries(Object.entries(phases).map(([n, p]) => [n, Object.fromEntries(Object.entries(p.rows).map(([id, { samples }]) => [id, samples.map((s) => ({ status: s.status, ms: Math.round(s.ms), bytes: s.bytes, fp: fp(s.text), seen: seen(s.text), reader: s.reader }))]))])), amend: amend.body ?? amend.text, withdraw: withdraw.body ?? withdraw.text, amend2: amend2.body ?? amend2.text, compo, timed }, null, 1));
say(`\nreport written to ${OUT}/round-report.md and round-raw.json`);
await office.stop(); await round.stop();
process.exit(0);
