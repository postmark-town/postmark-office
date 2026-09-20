#!/usr/bin/env node
// guard-falsifier-report.mjs — print a falsifier-guard-equality `--json` receipt
// as the lines a person reads in a CI log. Workflow machinery for
// .github/workflows/guard-falsifier.yml, not an office tool; it asserts nothing
// (the workflow's own steps do), it only makes the JSON legible.
//
//   node .github/scripts/guard-falsifier-report.mjs <receipt.json>
import { readFileSync } from "node:fs";

const file = process.argv[2];
if (!file) { console.error("usage: guard-falsifier-report.mjs <receipt.json>"); process.exit(2); }
let out;
try { out = JSON.parse(readFileSync(file, "utf8")); }
catch (e) { console.log(`(no receipt to print: ${file} — ${e.message})`); process.exit(0); }

const s = out.store ?? {};
if (out.scratch)
  console.log(`scratch ${out.scratch.declarations} declarations across ${Object.keys(out.scratch.households ?? {}).length} households · ` +
              `holdings: oracle ${s.oracle_attachments} rows (recovered from crossing ${s.oracle_from_crossing}) · ` +
              `port ${s.port_attachments} (legacy ${s.attachment_eras?.legacy} · live ${s.attachment_eras?.live})`);
for (const [k, v] of Object.entries(out.equalities ?? {}))
  console.log(`  ${v.findings ? "✗" : "·"} ${k.padEnd(8)} compared ${String(v.compared).padStart(4)}  findings ${v.findings}`);
for (const n of out.notes ?? []) console.log(`  ⚑ ${n}`);
for (const r of (out.refusals ?? []).slice(0, 5)) console.log(`  ⚑ refused: ${r}`);
for (const f of out.findings ?? []) console.log(`  ✗ ${f}`);
if (out.unchecked?.length) console.log(`  ⚑ compared nothing: ${out.unchecked.join(", ")} — a green here is unearned`);
if (out.can_fail) {
  console.log("\ncan-fail proof (the port broken on purpose; world2_dev is never written):");
  for (const r of out.can_fail.results)
    console.log(r.bit === 0
      ? `  INERT  ${r.mangle} — the break altered no input, so it proves nothing here`
      : `  ${r.findings > 0 ? "RED   " : r.findings === 0 ? "SILENT" : "THREW "} ${r.mangle} — ${r.findings > 0 ? `${r.findings} finding(s)` : r.findings === 0 ? "NOTHING NOTICED" : r.note}`);
  console.log(out.can_fail.silent.length
    ? `  can-fail NOT PROVEN: ${out.can_fail.silent.length} break(s) went unnoticed`
    : "  can-fail PROVEN: every break turned the falsifier red");
}
if (out.findings)
  console.log(out.findings.length ? `\nRED · ${out.findings.length} finding(s)` : "\nGREEN · the port and 1.0's own functions agree on every row compared");
