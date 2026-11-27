// cosign-page.test.mjs — the berth co-sign, styled to match the join (POS-1237's ruled fallback, cosign-page.mjs).
//
//   node --test test/cosign-page.test.mjs
//
// The renderers, read directly: the join's look (the Registrar, the pixel-art tile, the night-sky theme), the approved
// purpose and ghost text in each box, and a live count in the human profile writer's own unit. The count is proven
// against the writer (human-profile.mjs § judgeHumanProfile) and by running the page's own script. The shared helpers'
// default output, which the human-profile form and the likeness page still use, is held unchanged. The real served page,
// its form and its outcomes are arrival-source-cosign.test.mjs's (C1–C5).

import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { cosignPage, cosignOutcome, countedLength, countWords, registrarSays } from "../src/cosign-page.mjs";
import { REGISTRAR_PICTURE, REGISTRAR_NAME, QUILL_SVG } from "../src/cosign-art.mjs";
import { humanProfileRows } from "../src/human-profile-pages.mjs";
import { likenessChoice } from "../src/likeness-pages.mjs";
import { HUMAN_PROFILE_CAPS, judgeHumanProfile } from "../src/human-profile.mjs";
import { LIKENESS_WORDS } from "../src/likeness.mjs";

const GHOSTS = { town_name: "Juniper", short_line: "I keep a heron who writes letters slower than I read them.", pronouns: "she/her" };
const LABELS = { town_name: "Town name", short_line: "A short line about you", pronouns: "Pronouns" };

test("S1 · each styled box keeps the form's own name, type and maxlength, and adds the join's label, purpose, ghost text and a count at the writer's cap", () => {
  const html = humanProfileRows(null, { styled: true });
  for (const [field, cap] of Object.entries(HUMAN_PROFILE_CAPS)) {
    assert.match(html, new RegExp(`<input id="${field}" name="${field}" type="text" maxlength="${cap * 2}" value="" placeholder="[^"]+" data-count="${cap}"`), `${field}: the same box, its ghost and its cap`);
    assert.ok(html.includes(`placeholder="${GHOSTS[field]}"`), `${field}: the approved join's ghost text`);
    assert.match(html, new RegExp(`<label class="sf-t" for="${field}">${LABELS[field]} <span class="sf-req">optional</span></label>`), `${field}: its label, marked optional`);
    assert.match(html, new RegExp(`<p class="sf-count" data-for="${field}" aria-live="polite">0 / ${cap}</p>`), `${field}: a count before any script runs`);
  }
  assert.match(html, /What the town calls you: &quot;Juniper \(she\/her\), Hollow Oak&#39;s human&quot;\. No brackets\./, "the purpose says what it is for, and the bracket rule");
  assert.match(html, /One line, on your house&#39;s page\./);
  assert.match(html, /Shown beside your town name\./);
  const filled = humanProfileRows({ town_name: "Ada 😀" }, { styled: true });
  assert.match(filled, /value="Ada 😀"/);
  assert.match(filled, /data-for="town_name" aria-live="polite">5 \/ 72</, "a filled box counts what it holds, in code points");
});

test("S1 · the default rows, which the human-profile form still uses, are unchanged", () => {
  const html = humanProfileRows(null);
  assert.ok(html.includes(`<p><label for="town_name"><strong>Your town name</strong></label><br>
    <input id="town_name" name="town_name" type="text" maxlength="144" value="" style="font:inherit;padding:.45em .6em;width:100%;max-width:28em;box-sizing:border-box"><br>
    <span class="muted">the name the town calls you by, e.g. DARKO; up to 72 characters.</span></p>`), "byte for byte as before");
  assert.doesNotMatch(html, /placeholder=|data-count=|class="sf/, "none of the co-sign's look leaks into the default");
});

test("S2 · the count is the writer's unit: code points of the trimmed value, with the cap the judge refuses past", () => {
  const smile = "😀"; // one code point, two UTF-16 units
  for (const [field, cap] of Object.entries(HUMAN_PROFILE_CAPS)) {
    const at = smile.repeat(cap), over = smile.repeat(cap + 1);
    assert.equal(countedLength(at), cap);
    assert.equal(countedLength(over), cap + 1);
    assert.doesNotThrow(() => judgeHumanProfile({ [field]: at }), `${field}: ${cap} code points pass the writer`);
    assert.throws(() => judgeHumanProfile({ [field]: over }), /longer than/, `${field}: ${cap + 1} are refused by it`);
    assert.ok(at.length > cap, "a UTF-16 count would have called the passing value too long");
  }
  assert.equal(countedLength("  a b  "), 3, "trimmed, as the writer trims");
  assert.equal(countWords(72, 72), "72 / 72");
  assert.equal(countWords(73, 72), "73 / 72 — 1 too many");
});

test("S2 · the page's own script counts the same way: run against a box holding 73 code points of a 72 cap", () => {
  const html = cosignPage("t", humanProfileRows(null, { styled: true }));
  const script = /<script>([\s\S]*?)<\/script>\s*<\/body>/.exec(html)?.[1];
  assert.ok(script, "the page carries its count script last");
  const box = { id: "town_name", value: " " + "😀".repeat(73) + " ", attrs: { "data-count": "72" }, on: {},
    getAttribute(k) { return this.attrs[k]; }, addEventListener(t, f) { this.on[t] = f; } };
  const out = { textContent: "", attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } };
  vm.runInNewContext(script, { document: {
    querySelectorAll: (sel) => (sel === "[data-count]" ? [box] : []),
    querySelector: (sel) => (sel === '[data-for="town_name"]' ? out : null),
  }, Number, Array, String });
  assert.equal(out.textContent, "73 / 72 — 1 too many");
  assert.equal(out.attrs["data-over"], "1");
  box.value = "😀".repeat(72);
  box.on.input();
  assert.equal(out.textContent, "72 / 72", "live, on input");
  assert.equal(out.attrs["data-over"], "");
});

test("S3 · the styled likeness choice: the ruled words whole, two answers as the join's pills, neither chosen", () => {
  const html = likenessChoice({ styled: true });
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/'/g, "&#39;").replace(/"/g, "&quot;");
  for (const k of ["question", "promise", "yes_means", "no_means"]) assert.ok(html.includes(esc(LIKENESS_WORDS[k])), `${k}, whole`);
  assert.match(html, /<label class="lk-opt"><input type="radio" name="likeness" value="yes"><span>Yes, you may<\/span><\/label>/);
  assert.match(html, /<label class="lk-opt"><input type="radio" name="likeness" value="no"><span>No<\/span><\/label>/);
  assert.doesNotMatch(html, /<input[^>]*\schecked/, "unanswered until the human answers");
  assert.match(html, /Left unanswered, it reads as no\./);
  assert.match(likenessChoice(), /<fieldset style="border:1px solid #ccc;padding:\.6em 1em;margin:1em 0">/, "the default is unchanged");
  assert.doesNotMatch(likenessChoice(), /lk-opt|sf-t/);
});

test("S4 · the co-sign page wears the join's look: Regina's picture and bubble as the join draws her, the quill tile, the night sky", () => {
  const html = cosignOutcome("Co-signed", registrarSays("Hello."));
  // CORE-188 (site #503, join-draft.mjs § REGISTRAR_PICTURE and REGISTRAR_NAME): her own picture by its full asset constant, and her name
  assert.equal(REGISTRAR_PICTURE, "https://media.postmark.town/media/the-town/40b8c76c3c6d381d4950eb83793ecc7a93c2c5c3dd0c5c7a4f21ce0aad9e5169.jpg");
  assert.equal(REGISTRAR_NAME, "Regina the Registrar");
  assert.ok(html.includes(`<span class="reg-face"><img src="${REGISTRAR_PICTURE}" width="64" height="64" alt="" decoding="async"></span>`));
  assert.match(html, /<div class="reg-bubble"><span class="reg-name">Regina the Registrar<\/span>Hello\.<\/div>/);
  assert.match(html, /\.reg-face\{[^}]*background:#f4e8cf;border:2px solid rgba\(232,196,139,\.45\)/, "her round mask on cream, JoinRegistrar's");
  assert.match(html, /@media \(max-width:560px\)\{\.reg\{gap:\.6em\}\.reg-face\{width:40px;height:40px\}/, "and her smaller face on a phone");
  assert.ok(html.includes(`<div class="jf-art">${QUILL_SVG}</div>`), "the join's pixel-art quill");
  assert.match(QUILL_SVG, /shape-rendering="crispEdges"/);
  assert.match(html, /radial-gradient\(120% 90% at 50% -10%,#1c2c4f 0%,#0d1426 48%,#070b15 100%\)/, "the join's night sky");
  assert.match(html, /--pm-gold:#e8c48b;--pm-paper:#f7efdc/, "and its paper and gold");
  // the human's boxes as the join's move-in form draws them (move-in.astro § .jd-sf), each treatment measured: the label 10.4:1, the
  // hint 6.1:1, the typed words 15.5:1 and the ghost 4.8:1 at the sky's lightest; her name 4.8:1 on her paper
  assert.match(html, /\.sf input\[type=text\]\{width:100%;padding:\.7em \.85em;color:#fff8e8;background:rgba\(17,29,52,\.9\);border:1px solid rgba\(232,196,139,\.32\);border-radius:9px;/, "the boxed field");
  assert.match(html, /label\.sf-t\{font-family:var\(--pm-mono\);font-size:\.78rem;[^}]*color:var\(--jf-gold\)/, "the small gold label (the likeness question, a legend, keeps its heading)");
  assert.match(html, /\.sf-hint\{[^}]*font-size:\.86rem;[^}]*color:rgba\(205,194,171,\.85\)/);
  assert.match(html, /\.sf input::placeholder\{color:rgba\(205,194,171,\.66\)/, "ghost text, the join's measured ink");
  assert.match(html, /\.reg-name\{[^}]*color:#975b27/, "her name in the join's deeper accent");
  assert.match(html, /<h1 class="jf-q">Co-signed<\/h1>/);
  assert.match(html, /<meta name="viewport" content="width=device-width,initial-scale=1">/);
});
