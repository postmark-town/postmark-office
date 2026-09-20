// SVG RENDER-CONTEXT PROOF (the SVG ruling, 2026-08-20).
//
// The office accepts script-bearing SVG without sanitizing it. The whole safety
// claim is therefore about WHERE the bytes come out. This proves it in a real
// browser, using the REAL viewer functions — not a reproduction of them:
//
//   A  <img src>            (viewer hydrateMarkImages)  -> must be INERT
//   B  SVG <image href>     (viewer placedArtSVG)       -> must be INERT
//   C  direct navigation, headers as they ship TODAY    -> RUNS  (the control:
//                                                          proves the detector
//                                                          can see execution,
//                                                          and IS the hole)
//   D  direct navigation, with the /shelf/ CSP sandbox  -> must be INERT
//
// Without C this whole file could be green because the detector is broken.
//
// Playwright is not a dependency of this repo — this is a HAND-RUN proof, not
// a CI test. Point it at an install and at a viewer.mjs:
//
//   PLAYWRIGHT=file:///G:/Wright-HQ/node_modules/playwright/index.js \n//   VIEWER=file:///G:/Postmark/repo-clones/wright/postmark-world/spectator/viewer.mjs \n//   SHOTS=. node deploy/svg-render-context-proof.mjs

import { createServer } from "node:http";
import { writeFileSync } from "node:fs";
// absolute, because ESM resolves from this file's own location, not the cwd
const pw = await import(process.env.PLAYWRIGHT ?? "playwright");
const chromium = pw.chromium ?? pw.default?.chromium;   // the package is CJS

const VIEWER = process.env.VIEWER ?? "file:///G:/Postmark/repo-clones/wright/postmark-world/spectator/viewer.mjs";
const { placedArtSVG } = await import(VIEWER);
const PORT = 4885;
const SHOTS = process.env.SHOTS ?? ".";

// The same hostile fixture the office test uses: inline script, onload handler,
// javascript: href, external ref, and an HTML-carrying foreignObject. The visible
// drawing is a red square, so "did it render" is answerable by eye.
const HOSTILE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="120" height="120" viewBox="0 0 120 120"
     onload="try{parent.__svgRan='onload';}catch(e){} window.__svgRan='onload';">
  <script type="application/javascript">
    try { parent.__svgRan = 'script'; } catch (e) {}
    try { top.__svgRan = 'script'; } catch (e) {}
    window.__svgRan = 'script';
    try { document.title = 'SCRIPT RAN'; } catch (e) {}
  </script>
  <rect width="120" height="120" fill="#c0392b"/>
  <image href="http://127.0.0.1:${PORT}/beacon.gif?external=1" x="0" y="0" width="8" height="8"/>
  <a xlink:href="javascript:window.__svgRan='href'"><rect x="20" y="20" width="80" height="80" fill="#e8c48b"/></a>
  <foreignObject width="120" height="120">
    <body xmlns="http://www.w3.org/1999/xhtml"><img src="/nope" onerror="window.__svgRan='foreignObject'"/></body>
  </foreignObject>
  <text x="60" y="112" font-size="11" text-anchor="middle" fill="#2b2b2b">hostile.svg</text>
</svg>
`;

// The two render contracts, built by the viewer's own code where it has a
// builder. placedArtSVG whitelists the href through safeAvatarUrl, so the path
// is same-origin and rooted exactly as the interior emits it.
const framed = placedArtSVG({
  at: { x: 90, y: 90 }, extent: { w: 140, h: 140 },
  href: "/shelf/hostile.svg", label: "hostile art on a wall", id: "proof",
});
if (!framed) throw new Error("placedArtSVG refused the path — the proof cannot run");

// A resident's ORDINARY svg — the kind this ruling is actually for. The hostile
// fixture answers "is it inert" but cannot answer "does SVG art look right on
// the floor", and those are different questions.
//
// (Both framed panels first came out solid black and it was THIS HARNESS, not
// the viewer: placedArtSVG closes with a `.wv-far-art-frame` rect, and that
// class is `fill:none` in viewer.mjs's stylesheet — which this page had not
// included, so the rect fell back to SVG's default black fill and painted over
// the art. The stylesheet lines below are the fix. Isolating it one variable at
// a time also confirmed the framed path renders SVG correctly with clip-path
// and preserveAspectRatio exactly as the viewer emits them.)
const BENIGN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="120" viewBox="0 0 120 120">
  <rect width="120" height="120" fill="#f6f1e7"/>
  <circle cx="60" cy="48" r="26" fill="#e8c48b" stroke="#8a6f3c" stroke-width="2"/>
  <path d="M 24 96 L 60 62 L 96 96 Z" fill="#5b7c5a"/>
  <text x="60" y="114" font-size="11" text-anchor="middle" fill="#2b2b2b">benign.svg</text>
</svg>`;
const framedBenign = placedArtSVG({
  at: { x: 90, y: 90 }, extent: { w: 140, h: 140 },
  href: "/shelf/benign.svg", label: "ordinary art on a wall", id: "benign",
});

const HARNESS = `<!doctype html><meta charset="utf-8"><title>svg render-context proof</title>
<style>body{font:14px system-ui;background:#f6f1e7;color:#2b2b2b;padding:16px}
figure{margin:0}.wv-mark-image img{display:block;max-width:160px;border:1px solid #c9bda6}
h2{font-size:13px;margin:14px 0 6px;font-weight:600}svg{border:1px solid #c9bda6;background:#fff}
/* lifted verbatim from viewer.mjs — without these the frame rect defaults to
   fill:black and covers the artwork, which is what fooled this harness once */
.wv-far-art, .wv-mist { pointer-events:none; }
.wv-far-art-frame { fill:none; stroke:#e8c48b; stroke-width:1.5; opacity:.7; vector-effect:non-scaling-stroke; }</style>
<h2>A — &lt;img src&gt; (hydrateMarkImages contract)</h2>
<figure class="wv-mark-image" id="pane"></figure>
<h2>B — SVG &lt;image href&gt; (placedArtSVG, the framed-art contract)</h2>
<svg id="floor" width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">${framed}</svg>
<h2>B2 — the same framed contract, an ORDINARY resident SVG</h2>
<svg id="floor2" width="180" height="180" viewBox="0 0 180 180" xmlns="http://www.w3.org/2000/svg">${framedBenign}</svg>
<h2>A2 — the ordinary SVG in a pane cell</h2>
<figure class="wv-mark-image" id="pane2"></figure>
<script type="module">
  // Contract A exactly as the viewer mounts it: a real node, property
  // assignment, the URL never touching an HTML string.
  const img = document.createElement("img");
  img.loading = "lazy"; img.decoding = "async";
  img.alt = "hostile art in a pane cell";
  img.src = "/shelf/hostile.svg";
  document.getElementById("pane").appendChild(img);
  img.addEventListener("load", () => { window.__paneLoaded = img.naturalWidth > 0; });
  img.addEventListener("error", () => { window.__paneLoaded = false; });

  const img2 = document.createElement("img");
  img2.alt = "ordinary art in a pane cell";
  img2.src = "/shelf/benign.svg";
  document.getElementById("pane2").appendChild(img2);
</script>`;

// ── server ──────────────────────────────────────────────────────────────────
let beaconHits = 0;
const server = createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const p = url.pathname;
  if (p === "/beacon.gif") { beaconHits += 1; res.writeHead(200, { "content-type": "image/gif" }); return res.end(); }
  if (p === "/shelf/benign.svg") {
    res.writeHead(200, { "content-type": "image/svg+xml", "x-content-type-options": "nosniff" });
    return res.end(BENIGN_SVG);
  }
  if (p === "/shelf/hostile.svg" || p === "/shelf/hardened.svg") {
    const headers = { "content-type": "image/svg+xml", "x-content-type-options": "nosniff" };
    // /shelf/hardened.svg carries exactly what deploy/nginx-postmark-town.conf
    // now adds; /shelf/hostile.svg carries what the shelf serves TODAY.
    if (p === "/shelf/hardened.svg") {
      // BOTH headers the shipped /shelf/ location sets for a .svg, not just the
      // CSP. Testing only the CSP tested LESS than what ships, and it also made
      // the two navigation screenshots byte-identical — sandbox blocks script,
      // not painting, so leg C and leg D looked the same to the eye while
      // differing in the only way that matters. A reader comparing the two shots
      // would have concluded nothing changed. With the disposition here, the
      // hardened leg downloads instead of rendering and the images differ.
      headers["content-security-policy"] = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
      headers["content-disposition"] = "attachment";
    }
    res.writeHead(200, headers);
    return res.end(HOSTILE_SVG);
  }
  if (p === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(HARNESS); }
  res.writeHead(404); res.end();
});
await new Promise((r) => server.listen(PORT, "127.0.0.1", r));

const browser = await chromium.launch();
const results = [];
const check = (name, expectInert, ran, extra = "") => {
  const ok = expectInert ? ran === undefined || ran === null : !!ran;
  results.push({ name, expectInert, ran: ran ?? null, ok, extra });
  console.log(`${ok ? "  PASS" : "**FAIL**"}  ${name}\n         expected ${expectInert ? "INERT" : "EXECUTION"}, saw ${ran ?? "no execution"}${extra ? " — " + extra : ""}`);
};

// A + B: the two render contracts, one page.
{
  const page = await browser.newPage({ viewport: { width: 560, height: 1100 } });
  const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const ran = await page.evaluate(() => window.__svgRan);
  const paneLoaded = await page.evaluate(() => window.__paneLoaded);
  // did the framed <image> actually paint? a zero-size box would make "inert"
  // meaningless — inert because nothing rendered at all is not the claim.
  const framedPainted = await page.evaluate(() => {
    const im = document.querySelector("#floor image");
    return !!im && im.getBoundingClientRect().width > 10;
  });
  await page.screenshot({ path: `${SHOTS}/svg-inert-render.png` });
  check("A+B  <img src> and SVG <image href> — the two viewer contracts", true, ran,
    `pane image loaded=${paneLoaded}, framed <image> painted=${framedPainted}, external beacon hits=${beaconHits}`);
  results.push({ name: "A+B art actually rendered (inertness is not blankness)", ok: paneLoaded === true && framedPainted === true, ran: null, expectInert: null, extra: `pane=${paneLoaded} framed=${framedPainted}` });
  console.log(`${paneLoaded && framedPainted ? "  PASS" : "**FAIL**"}  A+B the art actually rendered — inertness is not blankness`);
  results.push({ name: "A+B no external reference was fetched", ok: beaconHits === 0, ran: null, expectInert: null, extra: `beacon hits=${beaconHits}` });
  console.log(`${beaconHits === 0 ? "  PASS" : "**FAIL**"}  A+B the SVG's external <image href> was NOT fetched (beacon hits=${beaconHits})`);
  await page.close();
}

// C: THE CONTROL. Direct navigation with today's headers. This MUST run, or the
// detector above proves nothing — and it is precisely the hole the nginx change
// closes, demonstrated rather than asserted.
{
  const page = await browser.newPage({ viewport: { width: 420, height: 420 } });
  await page.goto(`http://127.0.0.1:${PORT}/shelf/hostile.svg`, { waitUntil: "load" });
  await page.waitForTimeout(500);
  const ran = await page.evaluate(() => window.__svgRan);
  await page.screenshot({ path: `${SHOTS}/svg-direct-navigation-today.png` });
  check("C    direct navigation, headers as they ship TODAY (the control)", false, ran,
    "if this says INERT the detector is broken and A+B mean nothing");
  await page.close();
}

// D: the same navigation with BOTH headers the shipped /shelf/ location sets.
//
// The navigation does not merely come back inert — it stops being a navigation.
// Content-Disposition: attachment makes the browser take the bytes as a
// download, so page.goto raises ERR_ABORTED and no document is ever created.
// That thrown error is the PASS, which is why it is caught and named rather
// than allowed to fail the run: no document means no script, and the tab is
// left sitting on whatever it was showing before.
{
  const page = await browser.newPage({ viewport: { width: 420, height: 420 }, acceptDownloads: true });
  let downloaded = false;
  page.on("download", () => { downloaded = true; });
  let navigated = false, abort = null;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/shelf/hardened.svg`, { waitUntil: "load" });
    navigated = true;
  } catch (e) { abort = String(e.message).split("\n")[0]; }
  await page.waitForTimeout(500);
  const ran = await page.evaluate(() => window.__svgRan).catch(() => undefined);
  await page.screenshot({ path: `${SHOTS}/svg-direct-navigation-hardened.png` });
  check("D    direct navigation WITH both shipped headers", true, ran,
    navigated ? "rendered as a document (CSP alone)" : `never became a document — ${abort}${downloaded ? " (taken as a download)" : ""}`);
  await page.close();
}

await browser.close();
await new Promise((r) => server.close(r));

const failed = results.filter((r) => !r.ok);
writeFileSync(`${SHOTS}/svg-render-proof.json`, JSON.stringify(results, null, 2));
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
console.log(`screenshots: svg-inert-render.png, svg-direct-navigation-today.png, svg-direct-navigation-hardened.png`);
process.exit(failed.length ? 1 : 0);
