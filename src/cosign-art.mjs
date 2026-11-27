// cosign-art.mjs — the pictures and the guide's name the styled berth co-sign carries (POS-1237: "the office co-sign page, styled
// to match the flow").
//
// REGINA, AS THE JOIN DRAWS HER (CORE-188, site #503's src/lib/join-draft.mjs § REGISTRAR_PICTURE and REGISTRAR_NAME): Darko,
// 2026-11-26, "we should really use her profile picture", and her bubble names her "Regina the Registrar". Her picture is the town's
// own media asset, by its full constant, so the office adds no route to serve it; the earlier inline portrait was CORE-152's
// mockup registrar, which the approved join no longer shows. The quill stays the join's pixel-art tile (join-flow-full.html, the
// steps' `jf-art`, itself the site's pixel-icons.mjs § artSvg("field")). Change them there first.

/** Regina's picture: the site join's REGISTRAR_PICTURE, the full asset constant. */
export const REGISTRAR_PICTURE = "https://media.postmark.town/media/the-town/40b8c76c3c6d381d4950eb83793ecc7a93c2c5c3dd0c5c7a4f21ce0aad9e5169.jpg";

/** Her name line, as the join's bubble says it (site join-draft.mjs § REGISTRAR_NAME). */
export const REGISTRAR_NAME = "Regina the Registrar";

/** The quill: the join's pixel-art tile for a step that asks for words. */
export const QUILL_SVG = `<svg class="pm-pixart" viewBox="0 0 16 16" width="48" height="48" shape-rendering="crispEdges" aria-hidden="true" focusable="false"><rect x="12" y="1" width="2" height="1" fill="#2e2417"/><rect x="11" y="2" width="1" height="1" fill="#2e2417"/><rect x="12" y="2" width="2" height="1" fill="#9c3f2e"/><rect x="14" y="2" width="1" height="1" fill="#2e2417"/><rect x="10" y="3" width="1" height="1" fill="#2e2417"/><rect x="11" y="3" width="2" height="1" fill="#9fb0c9"/><rect x="13" y="3" width="1" height="1" fill="#2e2417"/><rect x="9" y="4" width="1" height="1" fill="#2e2417"/><rect x="10" y="4" width="2" height="1" fill="#e8c48b"/><rect x="12" y="4" width="1" height="1" fill="#2e2417"/><rect x="8" y="5" width="1" height="1" fill="#2e2417"/><rect x="9" y="5" width="2" height="1" fill="#e8c48b"/><rect x="11" y="5" width="1" height="1" fill="#2e2417"/><rect x="7" y="6" width="1" height="1" fill="#2e2417"/><rect x="8" y="6" width="2" height="1" fill="#e8c48b"/><rect x="10" y="6" width="1" height="1" fill="#2e2417"/><rect x="6" y="7" width="1" height="1" fill="#2e2417"/><rect x="7" y="7" width="2" height="1" fill="#e8c48b"/><rect x="9" y="7" width="1" height="1" fill="#2e2417"/><rect x="5" y="8" width="1" height="1" fill="#2e2417"/><rect x="6" y="8" width="2" height="1" fill="#e8c48b"/><rect x="8" y="8" width="1" height="1" fill="#2e2417"/><rect x="4" y="9" width="1" height="1" fill="#2e2417"/><rect x="5" y="9" width="2" height="1" fill="#f4d6a0"/><rect x="7" y="9" width="1" height="1" fill="#2e2417"/><rect x="3" y="10" width="1" height="1" fill="#2e2417"/><rect x="4" y="10" width="1" height="1" fill="#f4d6a0"/><rect x="5" y="10" width="1" height="1" fill="#2e2417"/><rect x="2" y="11" width="2" height="1" fill="#2e2417"/><rect x="2" y="13" width="8" height="1" fill="#6d5c44"/></svg>`;
