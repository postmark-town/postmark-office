// cosign-page.mjs — THE BERTH CO-SIGN, STYLED TO MATCH THE JOIN (POS-1237; CORE-152's fallback).
//
// RULED (Darko, POS-1237's description): "Fallback, only if that proves hard: the office co-sign page, styled to match the
// flow." Facet chose it (CORE-188), so the human's own part of the join (their human profile and the likeness answer) is
// asked here, on the office's signed-in page, in the approved join's look: the night-sky page, the pixel-art tile, the
// Registrar's portrait and paper speech bubble, the big gold questions, ghost text in the boxes, and a live count under
// each one (site docs/proposals/core-152-join at 4cdbb513, join-flow-full.html's `.site` styles and Step 1 / Step 6).
//
// ONLY THE BERTH CO-SIGN WEARS IT. Every other page this office serves keeps oauth.mjs § page, and the form inside is the
// same form: its method, action, hidden fields, buttons and the order the door judges them in do not change here.
//
// THE COUNT IS THE WRITER'S. A box counts what the human profile's own judge counts (human-profile.mjs §
// judgeHumanProfile: code points of the trimmed value), with the same number it refuses past; a browser's maxlength counts
// UTF-16 units, so it is only a backstop at twice the cap (human-profile-pages.mjs § humanProfileRows). `countedLength`
// below is the one count: the page's script is built from its own source, so the two cannot drift.

import { REGISTRAR_FACE, QUILL_SVG } from "./cosign-art.mjs";

/** How long a box's value is, as the human profile's judge counts it: code points, after the trim. */
export function countedLength(value) { return Array.from(String(value ?? "").trim()).length; }

/** The words under a box: "n / max", and how many too many past it. */
export function countWords(n, max) { return `${n} / ${max}${n > max ? ` — ${n - max} too many` : ""}`; }

// the approved join's tokens and rules (join-flow-full.html § .site), set on the page itself. Two treatments are deeper than
// the mockup's, so they read (the lead's FIX at 07fdf3d1, measured on the served render): the ghost text's cream at .6, not .3
// (2.37:1 before), and the Registrar's label in a darker shade of her accent, #87501f, not #a4632a (4.17:1 on her paper)
const STYLE = `
:root{--pm-gold:#e8c48b;--pm-paper:#f7efdc;--pm-ink:#2e2417;--pm-ink-soft:#6d5c44;--pm-accent:#a4632a;
  --pm-serif:"Iowan Old Style","Palatino Linotype",Palatino,Georgia,Charter,serif;--pm-mono:ui-monospace,"SF Mono",Consolas,monospace;
  --jf-gold:#f6dcae;--jf-cream:#efe6d2;--jf-soft:#b9ad95;color-scheme:dark}
*{box-sizing:border-box}
html{background:#070b15}
body{margin:0;min-height:100vh;background:radial-gradient(120% 90% at 50% -10%,#1c2c4f 0%,#0d1426 48%,#070b15 100%) fixed,#070b15;
  color:var(--jf-cream);font-family:var(--pm-serif);font-size:16px;line-height:1.5}
main{max-width:640px;margin:0 auto;padding:40px 22px 56px}
@media (max-width:620px){main{padding:28px 16px 44px}}
a{color:var(--pm-gold)}
.jf-art{display:inline-flex;margin:0 0 1.1em;padding:6px;border-radius:6px;background:var(--pm-paper);box-shadow:0 8px 24px rgba(0,0,0,.35);transform:rotate(-3deg)}
.jf-art svg{display:block}
.reg{display:flex;align-items:flex-start;gap:12px;margin:0 0 1.5em}
.reg-face{flex:none;width:64px;height:64px;border-radius:50%;border:2px solid var(--pm-gold);box-shadow:0 6px 18px rgba(0,0,0,.4);object-fit:cover;background:var(--pm-paper)}
.reg-bubble{position:relative;background:var(--pm-paper);color:var(--pm-ink);border-radius:12px;padding:10px 14px;font-size:1rem;line-height:1.5;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.reg-bubble::before{content:"";position:absolute;left:-8px;top:20px;border:8px solid transparent;border-left:0;border-right-color:var(--pm-paper)}
.reg-name{display:block;font-family:var(--pm-mono);font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:#87501f;margin-bottom:2px}
.jf-kicker{margin:0 0 .9em;font-family:var(--pm-mono);font-size:.74rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(232,196,139,.75)}
.jf-q{margin:0 0 .5em;font-size:clamp(1.7rem,4.2vw,2.6rem);line-height:1.12;font-weight:700;color:var(--jf-gold);text-shadow:0 0 34px rgba(232,196,139,.28)}
.jf-sub{margin:0 0 1.2em;max-width:56ch;font-size:clamp(1rem,1.9vw,1.12rem);line-height:1.55;color:var(--jf-soft)}
.jf-sub b,.jf-sub strong{color:var(--pm-gold);font-weight:600}
.pm-paper{background:linear-gradient(180deg,rgba(255,252,244,.5),rgba(255,252,244,0) 90px),var(--pm-paper);color:var(--pm-ink);border-radius:12px;
  box-shadow:0 22px 70px rgba(0,0,0,.55),0 0 0 1px rgba(232,196,139,.24),0 0 80px rgba(232,196,139,.08);padding:1em 1.2em;margin:0 0 1.6em}
.pm-paper p{margin:.45em 0}
.pm-paper .quote{font-style:italic;color:var(--pm-ink-soft);overflow-wrap:anywhere}
.pm-paper strong{color:var(--pm-ink)}
.sf{margin:0 0 1.7em;border:0;padding:0;min-width:0}
.sf-t{display:block;padding:0;font-size:clamp(1.25rem,2.6vw,1.55rem);line-height:1.2;font-weight:700;color:var(--jf-gold);text-shadow:0 0 34px rgba(232,196,139,.28);margin:0 0 .3em}
.sf-req{font-family:var(--pm-mono);font-size:.62rem;letter-spacing:.14em;text-transform:uppercase;color:rgba(232,196,139,.6);text-shadow:none;margin-left:.6em;vertical-align:3px;font-weight:400}
.sf-hint{margin:0 0 .8em;max-width:56ch;font-size:1rem;line-height:1.55;color:var(--jf-soft)}
.sf input[type=text]{width:100%;font-family:inherit;font-size:clamp(1.15rem,2.6vw,1.5rem);line-height:1.4;color:var(--jf-cream);background:transparent;
  border:0;border-bottom:2px solid rgba(232,196,139,.45);border-radius:0;padding:.3em .05em}
.sf input[type=text]:focus{outline:none;border-color:var(--jf-gold)}
.sf input::placeholder{color:rgba(239,230,210,.6);opacity:1}
.sf-count{margin:.45em 0 0;text-align:right;font-family:var(--pm-mono);font-size:.72rem;letter-spacing:.06em;color:rgba(185,173,149,.8)}
.sf-count[data-over="1"]{color:var(--jf-gold);font-weight:700}
.lk-pick{display:flex;gap:.8em;flex-wrap:wrap;margin:.2em 0 .9em}
.lk-opt{position:relative;display:inline-flex}
.lk-opt input{position:absolute;opacity:0;width:1px;height:1px}
.lk-opt span{display:inline-block;font-family:var(--pm-mono);font-weight:700;font-size:1.02rem;letter-spacing:.06em;color:var(--pm-gold);background:rgba(13,20,38,.55);
  box-shadow:inset 0 0 0 1px rgba(232,196,139,.45);border-radius:999px;padding:13px 28px;cursor:pointer}
.lk-opt input:checked+span{color:#241505;background:linear-gradient(180deg,#f6dcae,#e8c48b);box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 22px rgba(232,196,139,.25)}
.lk-opt input:focus-visible+span{outline:2px solid var(--jf-gold);outline-offset:3px}
.jf-go{display:flex;align-items:center;gap:1.1em;flex-wrap:wrap;margin:1.6em 0 0}
.pm-btn{display:inline-block;border:0;cursor:pointer;font-family:var(--pm-mono);font-weight:700;font-size:1.02rem;letter-spacing:.06em;color:#241505;
  background:linear-gradient(180deg,#f6dcae,#e8c48b);border-radius:999px;padding:13px 28px;box-shadow:0 8px 26px rgba(0,0,0,.45),0 0 22px rgba(232,196,139,.25)}
.pm-btn.ghost{color:var(--pm-gold);background:rgba(13,20,38,.55);box-shadow:inset 0 0 0 1px rgba(232,196,139,.45)}
.jf-small{margin:1em 0 0;font-size:.86rem;color:rgba(185,173,149,.85)}
main>p,main li{max-width:56ch;font-size:1.05rem;line-height:1.6}
main>p strong,main li strong{color:var(--pm-gold)}
main ul{padding-left:1.2em}
main li::marker{color:var(--pm-gold)}
main code{font-family:var(--pm-mono);font-size:.86em}
.muted{color:var(--jf-soft);font-size:.95rem}`;

// every box with a data-count keeps its count live, by countedLength's own source
const COUNT_SCRIPT = `<script>(function(){var countedLength=${countedLength.toString()};var countWords=${countWords.toString()};
document.querySelectorAll("[data-count]").forEach(function(el){var out=document.querySelector('[data-for="'+el.id+'"]');if(!out)return;
var max=Number(el.getAttribute("data-count"))||0;var show=function(){var n=countedLength(el.value);out.textContent=countWords(n,max);out.setAttribute("data-over",n>max?"1":"")};
el.addEventListener("input",show);show();});})();</script>`;

/** The Registrar, speaking: her portrait and her words in a paper bubble. `words` is HTML the caller has escaped. */
export function registrarSays(words) {
  return `<div class="reg"><img class="reg-face" src="${REGISTRAR_FACE}" width="64" height="64" alt="The Registrar"><div class="reg-bubble"><span class="reg-name">The Registrar</span>${words}</div></div>`;
}

/** The pixel-art tile a step opens with. */
export const quillTile = () => `<div class="jf-art">${QUILL_SVG}</div>`;

/** What the co-sign answers once the human has pressed a button, in the same look: the tile, the title, then `body`. */
export function cosignOutcome(title, body) {
  return cosignPage(title, `${quillTile()}<p class="jf-kicker">The town office · co-sign</p><h1 class="jf-q">${title}</h1>${body}`);
}

/** A whole co-sign page: `title` (escaped by the caller) for the tab, `body` the HTML inside the night-sky column. */
export function cosignPage(title, body) {
  return `<!doctype html><html lang="en"><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>${STYLE}</style>
<body><main>${body}</main>${COUNT_SCRIPT}</body></html>`;
}
