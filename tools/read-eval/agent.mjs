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
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

/** Run `cmd` with `args` in `cwd`, stdin closed; answers its stdout, stderr and exit code. */
function proc(cmd, args, { cwd, env, timeoutMs }) {
  return new Promise((ok) => {
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true, shell: false });
    let stdout = ""; let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr = (stderr + d).slice(-8000); });
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("close", (code) => { clearTimeout(timer); ok({ code, stdout, stderr }); });
    child.on("error", (e) => { clearTimeout(timer); ok({ code: -1, stdout, stderr: String(e?.message ?? e) }); });
  });
}

const claude = (args, opts) => proc("claude", args, opts);
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

// ── THE SECOND RUNTIME: Codex (Darko, 2026-10-09) ───────────────────────────
//
// `codex exec --json`, GPT Terra 5.6 (`gpt-5.6-terra`, the id in Codex's own
// model list) at medium reasoning effort. Its home is the eval's own CODEX_HOME
// (`.read-eval/codex-home`, gitignored): a config written by the harness and a
// copy of the auth file, nothing else, so none of Darko's own Codex settings,
// servers, hooks, plugins, memories or AGENTS.md reach the agent, and nothing
// is written back to his home. The office's MCP door is set per run with -c.
//
// WHAT COULD NOT BE TURNED OFF, said plainly: in codex-cli 0.160.1
// `unified_exec` stays on and the collaboration tools (spawn_agent, wait, ...)
// are always listed. The shell is off all the same: its host is disabled, so
// an exec fails closed, and there is no apply_patch, web search, image or
// browser tool. Any non-MCP item the agent makes is counted in `codex_items`.
//
// ITS ACCOUNTING IS NOT CLAUDE'S:
//   - tokens: `input_tokens` INCLUDES `cached_input_tokens`, and
//     `output_tokens` includes `reasoning_output_tokens`; so a run's total is
//     input + output. Claude's input EXCLUDES its cache reads and writes, and
//     its total is input + cache writes + cache reads + output.
//   - turns: Codex reports one turn per prompt, not one per model request, so
//     `turns` here is the count of agent messages and tool items instead.
//   - cost: Codex reports none (ChatGPT sign-in), so cost is null.
//   - tool calls are counted by the same proxy at the door for both.

const CODEX_JS = join(process.env.APPDATA ?? "", "npm", "node_modules", "@openai", "codex", "bin", "codex.js");

const CODEX_CONFIG = `# The read-shape eval's own Codex home (tools/read-eval/agent.mjs, POS-486).
# Written by the harness; the only other file here is a copy of the auth.
model = "gpt-5.6-terra"
model_reasoning_effort = "medium"
approval_policy = "never"
sandbox_mode = "read-only"
project_doc_max_bytes = 0
web_search = "disabled"

[features]
shell_tool = false
unified_exec = false
shell_snapshot = false
code_mode = false
code_mode_host = false
view_image = false
image_generation = false
browser_use = false
browser_use_external = false
computer_use = false
in_app_browser = false
multi_agent = false
multi_agent_v2 = false
plugins = false
apps = false
hooks = false
memories = false
sleep_tool = false
tool_suggest = false
goals = false
skill_search = false
skill_mcp_dependency_install = false
workspace_dependencies = false
`;

/** The eval's Codex home: the harness's config and a copy of the auth file (read, never written back). */
export function codexHome(dir) {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "config.toml"), CODEX_CONFIG);
  const auth = join(dir, "auth.json");
  if (!existsSync(auth)) copyFileSync(join(homedir(), ".codex", "auth.json"), auth);
  return dir;
}

/** The JSONL events of one `codex exec --json`, folded to what the eval records. */
export function foldCodexEvents(stdout) {
  const ev = stdout.split(/\r?\n/).filter((l) => l.startsWith("{")).map(parse).filter(Boolean);
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0 };
  for (const e of ev.filter((x) => x.type === "turn.completed"))
    for (const k of Object.keys(usage)) usage[k] += e.usage?.[k] ?? 0;
  const items = ev.filter((x) => x.type === "item.completed").map((x) => x.item);
  const messages = items.filter((i) => i.type === "agent_message");
  const kinds = {};
  for (const i of items) kinds[i.type] = (kinds[i.type] ?? 0) + 1;
  return {
    session_id: ev.find((x) => x.type === "thread.started")?.thread_id ?? null,
    result: messages.at(-1)?.text ?? "",
    usage,
    num_turns: messages.length + items.filter((i) => i.type !== "agent_message" && i.type !== "error" && i.type !== "reasoning").length,
    codex_items: kinds,
    errors: items.filter((i) => i.type === "error").map((i) => String(i.message).slice(0, 200)),
    is_error: ev.some((x) => x.type === "turn.failed" || x.type === "error"),
    total_cost_usd: null,
  };
}

/** One errand on Codex: the same shape of answer as runAgent's. */
export async function runCodexAgent({ base, key, prompt, system, feedback, dir, home, model = "gpt-5.6-terra", effort = "medium", timeoutMs = 15 * 60_000 }) {
  mkdirSync(dir, { recursive: true });
  const calls = [];
  const proxy = await countingProxy(base, calls);
  const env = { ...agentEnv(), CODEX_HOME: home, POSTMARK_EVAL_KEY: key };
  const common = ["--json", "--skip-git-repo-check", "-m", model, "-c", `model_reasoning_effort="${effort}"`,
    "-c", `mcp_servers.postmark.url="${proxy.url}/mcp"`, "-c", 'mcp_servers.postmark.bearer_token_env_var="POSTMARK_EVAL_KEY"',
    "-c", `developer_instructions=${JSON.stringify(system)}`];
  try {
    const t0 = Date.now();
    const task = await proc(process.execPath, [CODEX_JS, "exec", ...common, prompt], { cwd: dir, env, timeoutMs });
    const result = { ...foldCodexEvents(task.stdout), exit_code: task.code, wall_ms: Date.now() - t0 };
    if (task.code !== 0 || !result.session_id) result.stderr = task.stderr.slice(-2000);
    const callsDuringTask = calls.length;
    let fb = null;
    if (result.session_id && feedback) {
      const r = await proc(process.execPath, [CODEX_JS, "exec", "resume", ...common, result.session_id, feedback], { cwd: dir, env, timeoutMs: 5 * 60_000 });
      fb = { ...foldCodexEvents(r.stdout), exit_code: r.code };
    }
    return { result, feedback: fb, calls: calls.slice(0, callsDuringTask), calls_during_feedback: calls.slice(callsDuringTask).filter((c) => c.method === "tools/call").length };
  } finally { await proxy.close(); }
}
