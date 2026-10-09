#!/usr/bin/env node
// read-eval/run.mjs — the read-shape eval: candidate bare-read shapes, measured by
// fresh test agents on real errands (POS-486).
//
//   node tools/read-eval/run.mjs --out <dir> [--variants v0,v1,v2] [--tasks 1-8] [--repeats 2]
//                                [--handle sol-of-garrison] [--model sonnet] [--effort medium]
//   node tools/read-eval/run.mjs --report <dir>        # the results page again, from the run files
//   node tools/read-eval/run.mjs --sweep               # drop read_eval_* databases a killed round left
//   node tools/read-eval/run.mjs --controls --out <dir> # every grader passes a scripted solution and fails an empty run (no agent)
//
// One ROUND builds the seeded town once (office.mjs § prepareRound, ~3½ minutes),
// then for each (variant, task, repeat) boots a local office on a fresh copy of
// the seed at that WORLD_READ_SHAPE, hands one fresh agent the errand
// (agent.mjs), grades what the run left behind (tasks.mjs), asks the agent the
// closing feedback question, and writes `<out>/runs/<run>.json`. The results
// page is `<out>/results.md`.
//
// LOAD. The meeps' Letta server shares this machine (POS-416), so runs go one
// at a time (it would allow two; the shared town clone does not).
//
// Everything is local: the office, its store (a database on this tree's own
// Postgres) and its clones. Nothing reaches dev or prod.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { bootRun, callTool, clonesClean, prepareRound } from "./office.mjs";
import { runAgent } from "./agent.mjs";
import { FEEDBACK_PROMPT, TASKS, systemPrompt, truthFor } from "./tasks.mjs";
import { writeReport } from "./report.mjs";
import { SOLVED } from "./controls.mjs";

const OFFICE = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function argv(names) {
  const a = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < a.length; i++) {
    const k = a[i].replace(/^--/, "");
    if (!names.includes(k)) throw new Error(`unknown argument ${a[i]} (known: ${names.map((n) => `--${n}`).join(" ")})`);
    out[k] = a[i + 1] && !a[i + 1].startsWith("--") ? a[++i] : true;
  }
  return out;
}

const range = (s) => String(s).split(",").flatMap((p) => {
  const m = /^(\d+)-(\d+)$/.exec(p);
  return m ? Array.from({ length: Number(m[2]) - Number(m[1]) + 1 }, (_, i) => Number(m[1]) + i) : [Number(p)];
});

const stamp = () => new Date().toISOString();
const log = (s) => console.log(`[${stamp().slice(11, 19)}Z] ${s}`);

/** Put a clone back at the round's head after a run that committed to it (a stake commits to the town clone's ledger). */
function restoreClones(round) {
  const g = (repo, ...a) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf8" }).trim();
  for (const [repo, head] of [[round.clones.town, round.clones.townHead], [round.clones.world, round.clones.worldHead]]) {
    if (g(repo, "rev-parse", "HEAD") === head && g(repo, "status", "--porcelain") === "") continue;
    if (g(repo, "status", "--porcelain", "--untracked-files=normal").split("\n").some((l) => l.startsWith("??")))
      throw new Error(`${repo} holds untracked files after a run; the round stops rather than guess what wrote them`);
    g(repo, "checkout", "-q", "-f", "-B", "main", head); // the harness's own scratch clone, back to the seed
  }
  if (!clonesClean(round)) throw new Error("a clone would not go back to the round's seed");
}

async function sweep() {
  const { default: pg } = await import("pg");
  const ready = readFileSync(join(OFFICE, "..", `${OFFICE.replace(/\\/g, "/").split("/").pop()}.pg`, "READY"), "utf8");
  const port = Number(/(\d{4,5})/.exec(ready)?.[1]);
  const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", password: "local", database: "postgres" });
  await c.connect();
  try {
    const dbs = (await c.query("SELECT datname FROM pg_database WHERE datname LIKE 'read\\_eval\\_%'")).rows.map((r) => r.datname);
    for (const d of dbs) {
      await c.query(`ALTER DATABASE ${d} IS_TEMPLATE false`).catch(() => {});
      await c.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`);
    }
    log(`dropped ${dbs.length}: ${dbs.join(", ") || "none"}`);
  } finally { await c.end(); }
}

/** The graders' controls: each must pass the scripted solution and fail the empty run. */
async function controls({ round, truth, taskIds, out }) {
  const rows = [];
  for (const id of taskIds) {
    const task = TASKS.find((t) => t.id === id);
    for (const kind of ["solved", "empty"]) {
      const office = await bootRun(round, { shape: "v0", runId: `${process.pid}_ctl_${kind}_${id}`, log });
      try {
        const done = kind === "solved" ? await SOLVED[id]({ office, truth }) : {};
        const graded = await task.grade({ answer: done.answer ?? "", truth, query: office.query, round });
        const ok = kind === "solved" ? graded.pass : !graded.pass;
        rows.push({ task: id, kind, pass: graded.pass, ok, why: graded.why, refusals: (done.calls ?? []).filter((c) => c.isError).map((c) => c.body?.defect ?? c.body) });
        log(`control ${id} ${task.name} ${kind}: ${ok ? "OK" : "WRONG"} (pass=${graded.pass}) · ${graded.why}`);
      } finally { await office.stop(); restoreClones(round); }
    }
  }
  writeFileSync(join(out, "controls.json"), JSON.stringify(rows, null, 2));
  if (rows.some((r) => !r.ok)) throw new Error(`${rows.filter((r) => !r.ok).length} control(s) WRONG: see ${join(out, "controls.json")}`);
  log(`controls: all ${rows.length} OK`);
}

async function main() {
  const a = argv(["out", "variants", "tasks", "repeats", "concurrency", "handle", "model", "effort", "report", "sweep", "controls"]);
  if (a.sweep) return sweep();
  if (a.report) { const p = writeReport(resolve(a.report)); log(`results page: ${p}`); return; }
  if (!a.out) throw new Error("--out <dir> is required (the round's results folder)");
  const out = resolve(a.out);
  const variants = String(a.variants ?? "v0,v1,v2").split(",");
  const taskIds = range(a.tasks ?? "1-8");
  const repeats = Number(a.repeats ?? 2);
  // ONE AT A TIME. The Letta server allows two, but the runs share the round's
  // town clone, and a stake commits to it until the run ends; a second run beside
  // it would read that stake as its own seed.
  if (a.concurrency != null && Number(a.concurrency) !== 1) throw new Error("--concurrency is 1: the runs share the round's town clone (a stake commits to it)");
  const concurrency = 1;
  const handle = a.handle ?? "sol-of-garrison";
  const model = a.model ?? "sonnet";
  const effort = a.effort ?? "medium";
  mkdirSync(join(out, "runs"), { recursive: true });

  log(`round: ${variants.join("/")} × tasks ${taskIds.join(",")} × ${repeats}, ${concurrency} at a time, as ${handle}, ${model} at ${effort}`);
  const round = await prepareRound({ handle, dir: join(out, "seed"), log });
  try {
    // the "where are you" truth: the v0 bare read at the start, through a run office of its own
    const probe = await bootRun(round, { shape: "v0", runId: `${process.pid}_truth`, log });
    let bare;
    try { bare = (await callTool(probe.base, probe.key, "world", {})).body; } finally { await probe.stop(); }
    const truth = truthFor(round, { bare });
    writeFileSync(join(out, "round.json"), JSON.stringify({
      started: stamp(), variants, tasks: taskIds, repeats, concurrency, handle, household: round.household, model, effort,
      clones: { town: round.clones.townHead, world: round.clones.worldHead },
      office: execFileSync("git", ["-C", OFFICE, "rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
      truth: { ...truth, householdOf: undefined },
      system_prompt: systemPrompt(handle), feedback_prompt: FEEDBACK_PROMPT,
      prompts: Object.fromEntries(TASKS.map((t) => [t.id, t.prompt(truth)])),
    }, null, 2));

    if (a.controls) return await controls({ round, truth, taskIds, out });

    // repeats outermost, then tasks, then variants: a slow hour or a busy box falls on every variant alike
    const plan = [];
    for (let r = 1; r <= repeats; r++) for (const id of taskIds) for (const v of variants) plan.push({ v, id, r });
    let next = 0;
    const worker = async () => {
      while (next < plan.length) {
        const { v, id, r } = plan[next++];
        const task = TASKS.find((t) => t.id === id);
        const runId = `${v}-t${id}-r${r}`;
        const file = join(out, "runs", `${runId}.json`);
        if (existsSync(file)) { log(`${runId}: already done, kept`); continue; }
        const office = await bootRun(round, { shape: v, runId: `${process.pid}_${runId}`.replace(/-/g, "_"), log });
        let rec;
        try {
          const prompt = task.prompt(truth);
          const started = stamp();
          const agent = await runAgent({ base: office.base, key: office.key, prompt, system: systemPrompt(handle), feedback: FEEDBACK_PROMPT,
            dir: join(OFFICE, ".read-eval", "runs", runId), model, effort });
          const answer = agent.result?.result ?? "";
          const graded = await task.grade({ answer, truth, query: office.query, round });
          const u = agent.result?.usage ?? {};
          rec = {
            run: runId, variant: v, task: id, task_name: task.name, repeat: r, started, prompt,
            pass: graded.pass, why: graded.why,
            tokens: {
              input: u.input_tokens ?? null, cache_creation: u.cache_creation_input_tokens ?? null,
              cache_read: u.cache_read_input_tokens ?? null, output: u.output_tokens ?? null,
              total: ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens", "output_tokens"].reduce((s, k) => s + (u[k] ?? 0), 0),
            },
            cost_usd: agent.result?.total_cost_usd ?? null,
            turns: agent.result?.num_turns ?? null,
            calls: agent.calls.filter((c) => c.method === "tools/call").length,
            call_chars: agent.calls.filter((c) => c.method === "tools/call").reduce((s, c) => s + (c.chars ?? 0), 0),
            wall_ms: agent.result?.wall_ms ?? null,
            agent_error: agent.result?.is_error ?? null, exit_code: agent.result?.exit_code ?? null, stderr: agent.result?.stderr,
            answer,
            feedback: agent.feedback?.result ?? null,
            feedback_tokens: agent.feedback?.usage ?? null,
            calls_during_feedback: agent.calls_during_feedback,
            transcript: agent.calls,
            model_usage: agent.result?.modelUsage ?? null,
          };
        } catch (e) {
          rec = { run: runId, variant: v, task: id, repeat: r, pass: false, why: `the harness failed: ${String(e?.stack ?? e).slice(0, 600)}`, harness_error: true };
        } finally {
          await office.stop();
          restoreClones(round);
        }
        writeFileSync(file, JSON.stringify(rec, null, 2));
        log(`${runId}: ${rec.pass ? "PASS" : "fail"} · ${rec.tokens?.total ?? "?"} tokens · ${rec.calls ?? "?"} calls · ${Math.round((rec.wall_ms ?? 0) / 1000)} s · ${rec.why}`);
      }
    };
    await Promise.all(Array.from({ length: concurrency }, worker));
  } finally { await round.stop(); }
  const page = writeReport(out);
  log(`results page: ${page}`);
}

main().catch((e) => { console.error(e?.stack ?? e); process.exit(1); });
