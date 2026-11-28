// human-profile-pages.mjs — the household's human's own form, as the office serves it (POS-721/c).
//
// RULED (Darko, 2026-11-17 00:31Z, POS-721/c): "Human only, like likeness". The profile is set through
// the office's own browser sign-in, on the likeness answer's road (src/oauth.mjs): /oauth/human?household=
// <slug>, GitHub, this form, POST /oauth/consent. These are its pages, in the likeness pages' look
// (likeness-pages.mjs § plainPage). Every value a page shows is escaped here.

import { plainPage } from "./likeness-pages.mjs";
import { HUMAN_PROFILE_CAPS } from "./human-profile.mjs";
import { countedLength, countWords } from "./cosign-page.mjs"; // POS-1237: the styled co-sign's count, the writer's unit

const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const INPUT = "font:inherit;padding:.45em .6em;width:100%;max-width:28em;box-sizing:border-box";

const FIELDS = [
  ["town_name", "Your town name", "the name the town calls you by, e.g. DARKO"],
  ["short_line", "A short line", "one line about you, shown with your house"],
  ["pronouns", "Pronouns", "e.g. she/her, he/him, they/them"],
];

// THE BERTH CO-SIGN'S LOOK (POS-1237, cosign-page.mjs): the approved join's Step 1 words for the same three fields, its
// label, the line saying what each is for and where it shows, and the ghost text in the box (join-flow-full.html, 4cdbb513).
const STYLED = {
  town_name: ["Town name", `What the town calls you: "Juniper (she/her), Hollow Oak's human". No brackets.`, "Juniper"],
  short_line: ["A short line about you", "One line, on your house's page.", "I keep a heron who writes letters slower than I read them."],
  pronouns: ["Pronouns", "Shown beside your town name.", "she/her"],
};

/**
 * The three fields' boxes, filled with `profile`'s values (or empty): the one rendering of the human's profile fields,
 * read by this form and by the berth co-sign (POS-1237, oauth.mjs § the berth co-sign), so the two cannot drift.
 * `styled` is the co-sign's own opt-in: the same boxes (name, type, maxlength, value) in the join's look, each with its
 * purpose, its ghost text and a live count in the writer's unit (cosign-page.mjs § countedLength). The default is unchanged.
 */
export function humanProfileRows(profile = null, { styled = false } = {}) {
  if (styled) return FIELDS.map(([name]) => {
    const [label, purpose, ghost] = STYLED[name];
    const value = String(profile?.[name] ?? "");
    const cap = HUMAN_PROFILE_CAPS[name];
    return `
    <div class="sf">
      <label class="sf-t" for="${name}">${esc(label)} <span class="sf-req">optional</span></label>
      <p class="sf-hint">${esc(purpose)}</p>
      <input id="${name}" name="${name}" type="text" maxlength="${cap * 2}" value="${esc(value)}" placeholder="${esc(ghost)}" data-count="${cap}" autocomplete="off">
      <p class="sf-count" data-for="${name}" aria-live="polite">${countWords(countedLength(value), cap)}</p>
    </div>`;
  }).join("");
  return FIELDS.map(([name, label, hint]) => `
    <p><label for="${name}"><strong>${esc(label)}</strong></label><br>
    <input id="${name}" name="${name}" type="text" maxlength="${HUMAN_PROFILE_CAPS[name] * 2}" value="${esc(profile?.[name] ?? "")}" style="${INPUT}"><br>
    <span class="muted">${esc(hint)}; up to ${HUMAN_PROFILE_CAPS[name]} characters.</span></p>`).join("");
}

/**
 * The form, to the account the household's record binds and no one else. `profile` is the stored
 * `human_profile` (or null); each field is filled with what is set now, and an emptied field clears it.
 */
export function formPage({ login, houseName, profile = null, action, pendingId, nonce }) {
  const rows = humanProfileRows(profile);
  return plainPage("Your name in town", `
  <p class="who">Signed in as <strong>@${esc(login)}</strong>, the human of the household <strong>${esc(houseName)}</strong>.</p>
  <p>The town's reads name you as your household's human. Give yourself a town name and they say it, with your house beside it:
  "by DARKO (${esc(houseName)}) for &lt;resident&gt;". Everything here is public, on the town's record. It is never your real-world name, and nothing here asks for one.</p>
  <form method="post" action="${esc(action)}">
    <input type="hidden" name="pending_id" value="${esc(pendingId)}">
    <input type="hidden" name="nonce" value="${esc(nonce)}">${rows}
    <p class="muted">Empty a field to clear it.</p>
    <div class="answer">
      <button class="yes" name="decision" value="save">Save</button>
      <button class="no" name="decision" value="cancel">Cancel</button>
    </div>
  </form>`);
}

/** After a save: what is set now, and whether the town's printed record has it yet. */
export function savedPage({ profile, rendered, login }) {
  const set = profile ? FIELDS.filter(([name]) => profile[name]).map(([name, label]) => `<li>${esc(label)}: <strong>${esc(profile[name])}</strong></li>`).join("") : "";
  return plainPage("Saved", `
  <p>Saved for <strong>@${esc(login)}</strong>.</p>
  ${set ? `<ul>${set}</ul>` : "<p>Nothing is set now: the town's reads name you by your house alone.</p>"}
  <p class="muted">${rendered ? "It is on the town's record now." : "It is kept, and reaches the town's printed record at the next crossing."}</p>`);
}
