#!/usr/bin/env node
// read-eval/html-report.mjs — the round's report for Darko, one self-contained
// HTML file (POS-486): no external script, font or style, readable on a phone.
//
//   node tools/read-eval/html-report.mjs --notes <notes.json> --out <report.html> <door dir> [<door dir> ...]
//   node tools/read-eval/html-report.mjs --notes <notes.json> --into <report.html> <door dir> ...
//       a later round, written into the earlier round's report above it (between
//       <!-- round:<n> --> markers, so a re-run replaces it); notes add `round`
//       and `blocks` ([{ h, html }]), and `skipped` ({ <door>: [run id] }) quotes
//       each run's answer to "what did you ignore?" verbatim
//
// The numbers come from the run files (runs/*.json, sizes-*.json, round-*.json
// in each door's folder); the words come from <notes.json>, written by a person
// who read every answer and every feedback: the summary, the recommended
// default per door and its evidence, the themes, which quotes to show, and what
// to change next round. Nothing here summarizes the agents itself.
//
// notes.json:
//   { title, summary: [para], recommend: { <door>: { pick, why: [para] } },
//     themes: { <door>: { <variant>: [sentence] } }, quotes: { <door>: { <variant>: [run id] } },
//     notes: [para], next: [sentence] }

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const median = (xs) => {
  const v = xs.filter((x) => typeof x === "number" && Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
};
const k = (n) => (n == null ? "–" : n >= 1000 ? `${(n / 1000).toFixed(n >= 100000 ? 0 : 1)}k` : String(Math.round(n)));
const sec = (ms) => (ms == null ? "–" : `${Math.round(ms / 1000)}s`);
const json = (f) => JSON.parse(readFileSync(f, "utf8"));

function loadDoor(dir) {
  const files = readdirSync(dir);
  const runs = existsSync(join(dir, "runs")) ? readdirSync(join(dir, "runs")).filter((f) => f.endsWith(".json")).map((f) => json(join(dir, "runs", f))) : [];
  const rounds = files.filter((f) => /^round(-[a-z]+)?\.json$/.test(f)).map((f) => json(join(dir, f)));
  const sizes = Object.assign({}, ...files.filter((f) => /^sizes(-[a-z]+)?\.json$/.test(f)).map((f) => json(join(dir, f))));
  const door = rounds[0]?.door ?? runs[0]?.door ?? basename(dir);
  for (const r of runs) r.runtime ??= "claude";
  return { dir, door, runs, rounds, sizes };
}

const RUNTIME = { claude: "Sonnet (Claude Code)", codex: "GPT Terra 5.6 (Codex)" };

function cell(rs) {
  if (!rs.length) return `<td class="na">–</td>`;
  const pass = rs.filter((r) => r.pass).length;
  const cls = pass === rs.length ? "ok" : pass === 0 ? "bad" : "mid";
  return `<td class="${cls}"><b>${pass}/${rs.length}</b><span>${k(median(rs.map((r) => r.tokens?.total)))} tok</span><span>${k(median(rs.map((r) => r.calls)))} calls · ${sec(median(rs.map((r) => r.wall_ms)))}</span></td>`;
}

function doorTables(d) {
  const variants = [...new Set(d.runs.map((r) => r.variant))].sort();
  const tasks = [...new Set(d.runs.map((r) => r.task))].sort((a, b) => a - b);
  const runtimes = [...new Set(d.runs.map((r) => r.runtime))].sort();
  const name = (t) => d.runs.find((r) => r.task === t)?.task_name ?? `task ${t}`;
  const out = [];
  for (const rt of runtimes) {
    const rs = d.runs.filter((r) => r.runtime === rt);
    out.push(`<h4>${esc(RUNTIME[rt] ?? rt)}</h4><div class="scroll"><table><thead><tr><th>errand</th>${variants.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>`);
    for (const t of tasks) out.push(`<tr><th>${t}. ${esc(name(t))}</th>${variants.map((v) => cell(rs.filter((r) => r.variant === v && r.task === t))).join("")}</tr>`);
    out.push(`<tr class="all"><th>all</th>${variants.map((v) => cell(rs.filter((r) => r.variant === v))).join("")}</tr></tbody></table></div>`);
    const tot = variants.map((v) => {
      const x = rs.filter((r) => r.variant === v);
      const sum = (f) => x.reduce((s, r) => s + (f(r) ?? 0), 0);
      return `<li><b>${esc(v)}</b>: ${x.filter((r) => r.pass).length}/${x.length} passed, ${k(sum((r) => r.tokens?.total))} tokens in all, ${sum((r) => r.calls)} tool calls${rt === "claude" ? `, $${sum((r) => r.cost_usd).toFixed(2)}` : ""}.</li>`;
    });
    out.push(`<ul class="tot">${tot.join("")}</ul>`);
    // round 2's question: what each variant's agents read first, and whether any read the door bare
    if (rs.some((r) => "first_call" in r)) {
      const fr = variants.map((v) => {
        const x = rs.filter((r) => r.variant === v && !r.harness_error);
        const firsts = {};
        for (const r of x) firsts[r.first_call ?? "(no call)"] = (firsts[r.first_call ?? "(no call)"] ?? 0) + 1;
        return `<tr><th>${esc(v)}</th><td>${Object.entries(firsts).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<code>${esc(c)}</code> ×${n}`).join("<br>")}</td><td><b>${x.filter((r) => r.bare_reads > 0).length} of ${x.length}</b></td></tr>`;
      });
      out.push(`<h4>What they read first</h4><div class="scroll"><table><thead><tr><th>variant</th><th>first call (runs)</th><th>any bare read of the ${esc(d.door)} door</th></tr></thead><tbody>${fr.join("")}</tbody></table></div>`);
    }
  }
  return out.join("\n");
}

function sizeTable(d) {
  const variants = Object.keys(d.sizes).sort();
  if (!variants.length) return "";
  const keys = [...new Set(variants.flatMap((v) => Object.keys(d.sizes[v].sections ?? {})))];
  const rows = keys.map((key) => `<tr><th>${esc(key)}</th>${variants.map((v) => `<td>${d.sizes[v].sections?.[key] == null ? "–" : d.sizes[v].sections[key].toLocaleString("en-US")}</td>`).join("")}</tr>`);
  return `<div class="scroll"><table class="sizes"><thead><tr><th>section (characters)</th>${variants.map((v) => `<th>${esc(v)}</th>`).join("")}</tr></thead><tbody>${rows.join("")}<tr class="all"><th>whole answer</th>${variants.map((v) => `<td><b>${d.sizes[v].total.toLocaleString("en-US")}</b></td>`).join("")}</tr></tbody></table></div>`;
}

function quotes(d, notes) {
  const pick = notes.quotes?.[d.door] ?? {};
  const out = [];
  for (const [v, ids] of Object.entries(pick)) {
    const qs = ids.map((id) => d.runs.find((r) => r.run === id)).filter(Boolean);
    if (!qs.length) continue;
    out.push(`<h5>${esc(v)}</h5>`);
    for (const r of qs) out.push(`<blockquote><p>${esc(r.feedback ?? "").replace(/\n+/g, "</p><p>")}</p><cite>${esc(RUNTIME[r.runtime] ?? r.runtime)}, errand ${r.task} (${esc(r.task_name)}), ${r.pass ? "passed" : "failed"}</cite></blockquote>`);
  }
  return out.join("\n");
}

/** The part of an agent's feedback that answers "(3) What in the answers did you ignore?", verbatim. */
function skippedOf(feedback) {
  const fb = String(feedback ?? "");
  const i = fb.search(/\(3\)|\*\*3[.)]|^\s*3[.)]/m);
  if (i < 0) return null;
  // the answer, without the question's own words
  return fb.slice(i).replace(/^[\s*#]*\(?3[.)][\s*]*(\*\*)?\s*(what[^?\n]*\?|what i ignored[.:]?)?[\s*:]*/i, "").trim();
}

function skipped(d, notes) {
  const ids = notes.skipped?.[d.door] ?? [];
  return ids.map((id) => d.runs.find((r) => r.run === id)).filter(Boolean).map((r) =>
    `<blockquote><p>${esc(skippedOf(r.feedback) ?? "").replace(/\n+/g, "</p><p>")}</p><cite>run ${esc(r.run)}: errand ${r.task} (${esc(r.task_name)}), ${r.pass ? "passed" : "failed"}, first call <code>${esc(r.first_call ?? "–")}</code></cite></blockquote>`).join("\n");
}

/** A later round's sections: its summary and picks, the notes' own blocks, then each door. */
function roundSections(doors, notes) {
  const p = (xs) => (xs ?? []).map((x) => `<p>${x}</p>`).join("");
  const out = [];
  out.push(`<section class="round"><h2>${esc(notes.title)}</h2><p class="meta">${esc(notes.meta ?? "")}</p>${p(notes.summary)}</section>`);
  out.push(`<section><h2>Round ${esc(notes.round)}: the recommendation, per door</h2>${doors.map((d) => { const r = notes.recommend?.[d.door]; return r ? `<div class="pick"><h3>${esc(d.door)}: <span>${esc(r.pick)}</span></h3>${p(r.why)}</div>` : ""; }).join("")}</section>`);
  for (const b of notes.blocks ?? []) out.push(`<section><h2>${esc(b.h)}</h2>${b.html}</section>`);
  for (const d of doors) {
    const prompts = d.rounds[0]?.prompts ?? {};
    out.push(`<section><h2>Round ${esc(notes.round)}: the ${esc(d.door)} door</h2><p class="key">The errands, as each agent was handed them:</p><ol>${Object.values(prompts).map((t) => `<li>${esc(t)}</li>`).join("")}</ol><p class="key">Each cell: errands passed / runs, then the median total tokens, tool calls and wall time per run.</p>${doorTables(d)}`);
    const th = notes.themes?.[d.door];
    if (th) out.push(`<h3>What the agents did</h3><ul>${th.map((x) => `<li>${x}</li>`).join("")}</ul>`);
    const sk = skipped(d, notes);
    if (sk) out.push(`<h3>What they said they skipped, in their words</h3>${sk}`);
    out.push(`<h3>The bare read's size, per variant</h3>${sizeTable(d)}</section>`);
  }
  if (notes.notes?.length) out.push(`<section><h2>Round ${esc(notes.round)}: how it was measured</h2>${p(notes.notes)}</section>`);
  return out.join("\n");
}

function main() {
  const a = process.argv.slice(2);
  const opt = (n) => { const i = a.indexOf(`--${n}`); return i < 0 ? null : a.splice(i, 2)[1]; };
  const notes = json(resolve(opt("notes")));
  const into = opt("into");
  if (into) {
    // a later round, written into the earlier report above its first section (a re-run replaces it between the markers)
    const doors = a.map((d) => loadDoor(resolve(d)));
    const file = resolve(into);
    const page = readFileSync(file, "utf8");
    const open = `<!-- round:${notes.round} -->`, close = `<!-- /round:${notes.round} -->`;
    const block = `${open}\n${roundSections(doors, notes)}\n<section class="round"><h2>Round 1</h2><p class="meta">Everything below is round 1, as first written.</p></section>\n${close}`;
    const i = page.indexOf(open), j = page.indexOf(close);
    const next = i >= 0 && j > i ? page.slice(0, i) + block + page.slice(j + close.length) : page.replace("</header>", `</header>\n${block}`);
    if (next === page) throw new Error(`no </header> in ${file} to write round ${notes.round} after`);
    writeFileSync(file, next);
    console.log(`report: round ${notes.round} written into ${file} (${next.length.toLocaleString("en-US")} characters)`);
    return;
  }
  const out = resolve(opt("out"));
  const doors = a.map((d) => loadDoor(resolve(d)));
  const p = (xs) => (xs ?? []).map((x) => `<p>${x}</p>`).join("");
  const body = [];
  body.push(`<header><h1>${esc(notes.title ?? "Read-shape eval")}</h1><p class="meta">${esc(notes.meta ?? "")}</p></header>`);
  body.push(`<section><h2>Summary</h2>${p(notes.summary)}</section>`);
  body.push(`<section><h2>The recommended default, per door</h2>${doors.map((d) => { const r = notes.recommend?.[d.door]; return r ? `<div class="pick"><h3>${esc(d.door)}: <span>${esc(r.pick)}</span></h3>${p(r.why)}</div>` : ""; }).join("")}</section>`);
  for (const d of doors) {
    body.push(`<section><h2>The ${esc(d.door)} door</h2><p class="key">Each cell: errands passed / runs, then the median total tokens, tool calls and wall time per run.</p>${doorTables(d)}`);
    const th = notes.themes?.[d.door];
    if (th) body.push(`<h3>What the agents said</h3>${Object.entries(th).map(([v, xs]) => `<h4>${esc(v)}</h4><ul>${xs.map((x) => `<li>${x}</li>`).join("")}</ul>`).join("")}`);
    const q = quotes(d, notes);
    if (q) body.push(`<h3>In their words</h3>${q}`);
    body.push(`</section>`);
  }
  body.push(`<section><h2>The bare read's size, per variant</h2>${doors.map((d) => `<h3>${esc(d.door)}</h3>${sizeTable(d)}`).join("")}</section>`);
  if (notes.notes?.length) body.push(`<section><h2>How it was measured</h2>${p(notes.notes)}</section>`);
  body.push(`<section><h2>What I'd change next round</h2><ul>${(notes.next ?? []).map((x) => `<li>${x}</li>`).join("")}</ul></section>`);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(notes.title ?? "Read-shape eval")}</title><style>
:root{--bg:#fbfaf7;--fg:#1d1d1b;--mute:#6b6a65;--line:#e3e0d8;--ok:#e3f1e4;--mid:#fbf1d9;--bad:#f8e1df;--acc:#2f5d50}
@media (prefers-color-scheme:dark){:root{--bg:#161615;--fg:#ecebe6;--mute:#a19f98;--line:#33322f;--ok:#1f3326;--mid:#3a321c;--bad:#3d2422;--acc:#8fc3b0}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}
header,section{max-width:860px;margin:0 auto;padding:0 16px}header{padding-top:24px}h1{font-size:1.6rem;margin:.2em 0}h2{font-size:1.3rem;margin-top:2em;border-bottom:1px solid var(--line);padding-bottom:.2em}
h3{font-size:1.1rem;margin-top:1.4em}h4{font-size:1rem;margin:1.2em 0 .4em;color:var(--acc)}h5{margin:1em 0 .3em}.meta,.key{color:var(--mute);font-size:.9rem}
.scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}table{border-collapse:collapse;width:100%;font-size:.88rem}th,td{border:1px solid var(--line);padding:6px 8px;text-align:left;vertical-align:top}
thead th{background:var(--line)}td span{display:block;color:var(--mute);font-size:.8rem;white-space:nowrap}td.ok{background:var(--ok)}td.mid{background:var(--mid)}td.bad{background:var(--bad)}
tr.all th,tr.all td{border-top:2px solid var(--fg)}table.sizes td{text-align:right;font-variant-numeric:tabular-nums}
.pick{border-left:4px solid var(--acc);padding:2px 0 2px 12px;margin:1em 0}.pick h3{margin:.2em 0}.pick h3 span{color:var(--acc)}
blockquote{margin:.6em 0;padding:.4em 12px;border-left:3px solid var(--line);font-size:.92rem}blockquote p{margin:.3em 0}cite{display:block;color:var(--mute);font-size:.8rem;font-style:normal}
ul.tot{font-size:.88rem;color:var(--mute)}code{font-size:.88em}footer{max-width:860px;margin:3em auto;padding:0 16px;color:var(--mute);font-size:.8rem}
</style></head><body>${body.join("\n")}<footer>${esc(notes.footer ?? "")}</footer></body></html>`;
  writeFileSync(out, html);
  console.log(`report: ${out} (${html.length.toLocaleString("en-US")} characters)`);
}

main();
