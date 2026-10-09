// read-eval/agent.mjs — one fresh test agent on one errand (POS-486).
//
// The agent is a headless `claude -p`: Sonnet at medium effort (Darko's ruling,
// 10-09), a short system prompt that says who it is and nothing about the door,
// and ONE tool server, the run's local office at /mcp with the test household's
// key. Every built-in tool is off (--tools ""), no other MCP server loads
// (--strict-mcp-config), no CLAUDE.md, memory, skill or hook reaches it, and it
// runs in a folder under this tree, never the Starstory or Wright-HQ roots.
//
// THE COUNTING PROXY. The agent's MCP server is a loopback proxy in front of
// the office, which writes one line per JSON-RPC call: the method, the tool,
// the arguments, the answer's size, and how long it took. That is the call
// count and the transcript, measured at the door rather than taken from the
// agent. `--output-format json` gives the tokens, turns, cost and time.
//
// THE FEEDBACK is a second turn on the same session (--resume), asked to call
// no tools (any it calls are counted), so its tokens are counted apart from the
// errand's.

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** A loopback proxy to `base`; `log` gets one entry per call. Answers `{ url, close }`. */
export function countingProxy(base, log) {
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const t0 = Date.now();
    let rpc = null;
    try { rpc = JSON.parse(body.toString("utf8")); } catch { /* not JSON */ }
    const headers = {};
    for (const [k, v] of Object.entries(req.headers)) if (!["host", "content-length", "connection"].includes(k)) headers[k] = v;
    let upstream;
    try {
      upstream = await fetch(base + req.url, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
    } catch (e) {
      log.push({ at: new Date().toISOString(), method: rpc?.method ?? req.method, error: String(e?.message ?? e) });
      res.writeHead(502); res.end(); return;
    }
    const text = await upstream.text();
    const out = {};
    upstream.headers.forEach((v, k) => { if (!["content-length", "content-encoding", "transfer-encoding", "connection"].includes(k)) out[k] = v; });
    res.writeHead(upstream.status, out);
    res.end(text);
    if (req.method !== "POST") return;
    let answer = null;
    try { answer = JSON.parse(text); } catch { const m = /^data: (.*)$/m.exec(text); try { answer = m ? JSON.parse(m[1]) : null; } catch { answer = null; } }
    const content = answer?.result?.content?.find((c) => c.type === "text")?.text ?? null;
    log.push({
      at: new Date(t0).toISOString(), ms: Date.now() - t0, status: upstream.status,
      method: rpc?.method ?? null,
      tool: rpc?.method === "tools/call" ? rpc.params?.name : null,
      args: rpc?.method === "tools/call" ? rpc.params?.arguments ?? {} : undefined,
      chars: content?.length ?? text.length,
      is_error: Boolean(answer?.result?.isError),
      // the answer's opening, for the transcript summary; the whole answer is not kept
      head: content ? content.slice(0, 400) : undefined,
    });
  });
  return new Promise((ok) => server.listen(0, "127.0.0.1", () => ok({
    url: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((done) => server.close(done)),
  })));
}

/** Run `claude` with `args` in `cwd`; answers its stdout, stderr and exit code. */
function claude(args, { cwd, env, timeoutMs }) {
  return new Promise((ok) => {
    const child = spawn("claude", args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-8000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); ok({ code, stdout, stderr }); });
    child.on("error", (e) => { clearTimeout(timer); ok({ code: -1, stdout, stderr: String(e?.message ?? e) }); });
  });
}

const parse = (s) => { try { return JSON.parse(s); } catch { return null; } };

/** The agent's environment: no CLAUDE.md, no auto-memory, nothing that points at a store or key. */
function agentEnv() {
  const e = { ...process.env, CLAUDE_CODE_DISABLE_CLAUDE_MDS: "1", CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1" };
  for (const k of Object.keys(e)) if (/^(PG[A-Z]*|WORLD2_[A-Z_]*|OFFICE_KEYS|GH_TOKEN|GITHUB_TOKEN)$/.test(k)) delete e[k];
  return e;
}

/**
 * One errand. `dir` is the run's folder under the tree (the agent's cwd);
 * answers { result, feedback, calls } with the json outputs and the proxy log.
 */
export async function runAgent({ base, key, prompt, system, feedback, dir, model = "sonnet", effort = "medium", timeoutMs = 15 * 60_000 }) {
  mkdirSync(dir, { recursive: true });
  const calls = [];
  const proxy = await countingProxy(base, calls);
  try {
    const config = join(dir, "mcp.json");
    writeFileSync(config, JSON.stringify({ mcpServers: { postmark: { type: "http", url: `${proxy.url}/mcp`, headers: { Authorization: `Bearer ${key}` } } } }, null, 2));
    const common = ["--model", model, "--effort", effort, "--output-format", "json", "--strict-mcp-config",
      "--tools", "", "--setting-sources", "", "--disable-slash-commands", "--permission-mode", "dontAsk"];
    const t0 = Date.now();
    const task = await claude(["-p", prompt, ...common, "--mcp-config", config, "--allowedTools", "mcp__postmark", "--system-prompt", system],
      { cwd: dir, env: agentEnv(), timeoutMs });
    const result = { ...(parse(task.stdout) ?? { parse_error: true, stdout: task.stdout.slice(-2000) }), exit_code: task.code, wall_ms: Date.now() - t0 };
    if (task.code !== 0 || !result.session_id) result.stderr = task.stderr.slice(-2000);
    const callsDuringTask = calls.length;
    let fb = null;
    if (result.session_id && feedback) {
      // the same tools in reach (a resumed history holds their calls); the prompt asks for none, and any made are counted
      const r = await claude(["-p", feedback, "--resume", result.session_id, ...common, "--mcp-config", config, "--allowedTools", "mcp__postmark", "--system-prompt", system],
        { cwd: dir, env: agentEnv(), timeoutMs: 5 * 60_000 });
      fb = { ...(parse(r.stdout) ?? { parse_error: true, stdout: r.stdout.slice(-2000) }), exit_code: r.code };
    }
    // the feedback turn reconnects (discover, initialize, tools/list); only its tool calls count
    return { result, feedback: fb, calls: calls.slice(0, callsDuringTask), calls_during_feedback: calls.slice(callsDuringTask).filter((c) => c.method === "tools/call").length };
  } finally { await proxy.close(); }
}
