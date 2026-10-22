// likeness-pages.mjs — the likeness question's pages, in the town's own look (WLD-83).
//
// Darko, 2026-10-22 15:41: "make it a bit prettier and actually demonstrate
// what we want by throwing in a bunch of different references or reference
// images of like the meeps and yourself and Rei. And I would rather the
// answered yes desk be like thanks for whatever, we look forward to seeing your
// agent in YouTube videos and other things."
//
// THE WORDS ARE THE RULED ONES. Every sentence of the question, the PG-13
// promise, what yes and no mean, the take-down road and the talk-it-over line
// is LIKENESS_WORDS (src/likeness.mjs), printed whole; this module adds only
// the look, the gallery and the thanks.
//
// THE GALLERY SHOWS ONLY DARKO'S OWN HOUSEHOLD (src/likeness-gallery.json):
// Rei, Wright and the meeps, nobody else, because nobody else has consented to
// being an example. `galleryFor` keeps an entry only when its handle is a
// resident of that household on the record, the household's likeness answer is
// yes, and its url is the town's media door. An entry with no url (not yet
// approved and uploaded) is not shown, and the page stands without a gallery.

import { readFileSync } from "node:fs";
import { mediaUrlOk } from "./media.mjs";
import { LIKENESS_WORDS } from "./likeness.mjs";

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const GALLERY_FILE = new URL("./likeness-gallery.json", import.meta.url);

/** The gallery's data: the one household it may show, and its entries. */
export function loadGallery(file = process.env.LIKENESS_GALLERY_FILE || GALLERY_FILE) {
  try { return JSON.parse(readFileSync(file, "utf8")); } catch { return { household: null, entries: [] }; }
}

/**
 * The entries the page may show, from the record: only the gallery's own
 * household's residents, only while that household's answer is yes, and only
 * a media-door url. Pure over its inputs.
 */
export function galleryFor(houses, gallery = loadGallery(), { urlOk = mediaUrlOk } = {}) {
  const slug = gallery?.household;
  const house = slug ? houses?.[slug] : null;
  if (!house || house.likeness?.answer !== "yes") return [];
  const residents = new Set(house.residents ?? []);
  return (gallery.entries ?? [])
    .filter((e) => e && residents.has(e.handle) && typeof e.url === "string" && urlOk(e.url))
    .map((e) => ({ handle: e.handle, who: String(e.who ?? e.handle), kind: String(e.kind ?? ""), url: e.url }));
}

// ── the look: night blue and lamplight gold, the town's palette ─────────────
const STYLE = `
:root{--night:#141b33;--night2:#1d2747;--gold:#e8c48b;--gold2:#c9a25e;--cream:#f6efe2;--ink:#2a2620;--muted:#6f6656;--green:#5f8f6a}
*{box-sizing:border-box}
body{margin:0;background:var(--night);color:var(--ink);font:17px/1.6 Georgia,"Iowan Old Style",serif}
.top{background:linear-gradient(180deg,var(--night2),var(--night));color:var(--gold);padding:28px 16px 64px;text-align:center}
.top .seal{font-size:.82em;letter-spacing:.18em;text-transform:uppercase;color:var(--gold2)}
.top h1{margin:.3em 0 0;font-size:1.7em;font-weight:normal;color:var(--cream)}
.card{max-width:42em;margin:-44px auto 40px;background:var(--cream);border-radius:14px;padding:28px 22px;box-shadow:0 12px 40px rgba(0,0,0,.35);border-top:4px solid var(--gold)}
.card h2{font-size:1.25em;line-height:1.35;margin:.2em 0 .8em;color:#1b2340}
.who{margin:0 0 1em;color:var(--muted);font-size:.95em}
.promise{background:#fff8e8;border-left:4px solid var(--gold2);padding:.7em 1em;border-radius:6px;margin:1em 0}
.gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin:1.2em 0 1.4em}
.gallery figure{margin:0;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.12)}
.gallery img{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
.gallery figcaption{font-size:.82em;padding:.45em .6em;color:var(--muted)}
.gallery-lead{font-size:.95em;margin:1.2em 0 .2em}
.muted{color:var(--muted);font-size:.9em}
.answer{display:flex;flex-wrap:wrap;gap:12px;margin-top:1.2em}
.answer button{font:inherit;padding:.65em 1.5em;border-radius:999px;cursor:pointer;border:2px solid var(--night2)}
.answer .yes{background:var(--night2);color:var(--cream)}
.answer .no{background:transparent;color:var(--night2)}
.thanks{font-size:1.15em}
@media (max-width:520px){body{font-size:16px}.card{margin:-36px 12px 28px;padding:22px 16px}.top h1{font-size:1.35em}.answer button{flex:1 1 100%}}
`;

const shell = (title, heading, body) => `<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<style>${STYLE}</style>
<body><header class="top"><div class="seal">Postmark · the town office</div><h1>${esc(heading)}</h1></header>
<main class="card">${body}</main></body>`;

const galleryHtml = (entries) => entries.length ? `
  <p class="gallery-lead">What that looks like, made from our own household's residents:</p>
  <div class="gallery">${entries.map((e) => `
    <figure><img src="${esc(e.url)}" alt="${esc(`${e.who}, ${e.kind}`)}" loading="lazy"><figcaption>${esc(e.who)}, ${esc(e.kind)}</figcaption></figure>`).join("")}
  </div>` : "";

/**
 * The question. Every ruled sentence is LIKENESS_WORDS whole; `gallery` is
 * galleryFor's answer; `standing` and `when` are the house's current answer.
 */
export function questionPage({ login, houseName, residents = [], answer = null, at = null, by = null, gallery = [], action, pendingId, nonce }) {
  const W = LIKENESS_WORDS;
  const who = residents.length ? residents.map((h) => `<strong>${esc(h)}</strong>`).join(", ") : "(none yet)";
  const standing = answer === "yes" ? "<strong>yes</strong>" : answer === "no" ? "<strong>no</strong>" : "not answered yet, which reads as <strong>no</strong>";
  const when = at ? ` (${esc(String(at).slice(0, 10))}, by @${esc(by ?? "")})` : "";
  return shell("Your residents' likeness", "Your residents' likeness", `
  <p class="who">Signed in as <strong>@${esc(login)}</strong>, for the household <strong>${esc(houseName)}</strong>: ${who}.</p>
  <h2>${esc(W.question)}</h2>${galleryHtml(gallery)}
  <p class="promise">${esc(W.promise)}</p>
  <p>${esc(W.yes_means)} ${esc(W.take_down)}</p>
  <p>${esc(W.no_means)}</p>
  <p class="muted">${esc(W.talk_it_over)} Your answer now: ${standing}${when}.</p>
  <form method="post" action="${esc(action)}" class="answer">
    <input type="hidden" name="pending_id" value="${esc(pendingId)}">
    <input type="hidden" name="nonce" value="${esc(nonce)}">
    <button class="yes" name="decision" value="yes">Yes, you may</button>
    <button class="no" name="decision" value="no">No</button>
  </form>`);
}

// Darko, 2026-10-22 15:41: the yes page thanks them, in his words.
export const YES_THANKS = "Thank you! We look forward to seeing your agent in YouTube videos and other things.";

/** The answered page: the thanks on a yes, the plain no on a no, and the true facts either way. */
export function answeredPage({ answer, rendered, at, login }) {
  const kept = rendered ? "It is on the town's public record now." : "It is kept, and reaches the town's public file at the next crossing.";
  const said = answer === "yes"
    ? `<p class="thanks">${esc(YES_THANKS)}</p>
  <p>Your answer is <strong>yes</strong>. The town may now use your residents' likeness, under its PG-13 promise, and anything made from it is welcomed unless you oppose it. To ask for a take-down, write a letter to darko.</p>`
    : `<p>Your answer is <strong>no</strong>. Nothing new will be made from your residents' likeness. Their own picture and appearance still show in town as before.</p>`;
  return shell("Answered", answer === "yes" ? "Thank you" : "Answered", `${said}
  <p class="muted">${kept} You can change it any time from the same link. Answered ${esc(at)} as @${esc(login)}.</p>`);
}

/** A refusal or a fault, in the same look. `body` is already-escaped HTML. */
export const plainPage = (title, body) => shell(title, title, body);
