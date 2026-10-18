// nginx-cache-keys.test.mjs — a cached location keys on the question its door
// reads (POS-620, 2026-10-15).
//
// THE DEFECT THIS CLOSES. `/api/world2/walks` was cached with
// `proxy_cache_key "$host$uri|$http_authorization"`: no args. The office honours
// `?since=` and `?last=` (src/world2-serve.mjs § THE WALK WINDOW), but nginx
// answered every query with whatever window the World page had last cached, so
// prod's `?since=2026-08-01T00:00:00Z` came back with `window.since` 09-30 and
// the World page's own "more" never widened. Measured 2026-10-15 22:48 EDT: the
// same query with a cache-busting header answered `window.since` as asked.
//
// What it cannot see, said plainly: this parses the confs, it does not run
// nginx. It holds the one thing a green office test cannot: that the key in
// front of a door carries the args that door reads.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONFS = ["nginx-api.conf", "nginx-postmark-read-pool.conf"].map((f) => join(ROOT, "deploy", f));

/** Every top-level `location … { … }` in a conf: `{ where, body }`, comments stripped. */
function locations(text) {
  const src = text.replace(/#[^\n]*/g, "");
  const out = [];
  const re = /location\s+([^{]+?)\s*\{/g;
  let m;
  while ((m = re.exec(src))) {
    let depth = 1, i = re.lastIndex;
    for (; i < src.length && depth; i++) depth += src[i] === "{" ? 1 : src[i] === "}" ? -1 : 0;
    out.push({ where: m[1].trim(), body: src.slice(re.lastIndex, i - 1) });
    re.lastIndex = i;
  }
  return out;
}

const cacheKeyOf = (body) => /proxy_cache_key\s+"([^"]*)"/.exec(body)?.[1] ?? null;

// A cached location whose key leaves the args out, and why that is right. The
// door must read no args, or the key must name the ones it reads.
const ARGLESS = {
  "= /api/world/walkers": "the office computes walkers with no args and no key (server.mjs § /world/walkers)",
  "= /api/world/present": "keyed on the camera rounded to a 100 m grid ($pm_qx, $pm_qy), the only args the door reads",
};

test("POS-620 · /api/world2/walks keys its cache on the args, so ?since= and ?last= reach the office", () => {
  const walks = locations(readFileSync(CONFS[0], "utf8")).find((l) => l.where === "= /api/world2/walks");
  assert.ok(walks, "nginx-api.conf has no exact location for /api/world2/walks");
  const key = cacheKeyOf(walks.body);
  assert.ok(key, "the walks location is no longer cached; drop this test only with the cache");
  assert.match(key, /\$is_args\$args/, `the walks cache key "${key}" ignores the query, so every window is served whichever one was cached`);
});

test("POS-620 · every cached location keys on its args, or says why its door reads none", () => {
  let cached = 0;
  for (const conf of CONFS) {
    for (const { where, body } of locations(readFileSync(conf, "utf8"))) {
      const key = cacheKeyOf(body);
      if (!key) continue;
      cached++;
      if (/\$is_args\$args|\$args/.test(key)) continue;
      assert.ok(Object.hasOwn(ARGLESS, where),
        `${conf.split(/[\\/]/).pop()} § location ${where}: its cache key "${key}" leaves out the query; key on $is_args$args, or name in ARGLESS why its door reads no args`);
    }
  }
  assert.ok(cached >= 6, `only ${cached} cached locations were found; the parser has lost the confs`);
});

/** The location nginx picks for `uri` in one conf: an exact match, else the first
 *  regex in order, else the longest prefix (no `^~` prefixes in these confs). */
function servedBy(locs, uri) {
  const exact = locs.find((l) => l.where === `= ${uri}`);
  if (exact) return exact;
  for (const l of locs) {
    const m = /^~(\*?)\s+(.+)$/.exec(l.where);
    if (m && new RegExp(m[2], m[1] ? "i" : "").test(uri)) return l;
  }
  return locs.filter((l) => !/^[=~]/.test(l.where) && uri.startsWith(l.where)).sort((a, b) => b.where.length - a.where.length)[0] ?? null;
}

// THE WORLD PAGE'S CREATURES (world #240, play fix 35; review-240, 2026-10-18). Every
// open page asks `?find=creature` keyless and `?investigate=creature:<id>` on a click,
// and each runs a whole bare world read in the office. They ride the brownout
// shield's apex location: cached, keyed on the args (so a find and an investigate
// never share a copy) and on the Authorization header (so a keyless copy is never a
// resident's). Measured on prod 2026-10-18 ~00:05 EDT: a second keyless find
// answered X-PM-Cache: HIT.
test("the World page's keyless creature reads are cached, keyed on their args and the key", () => {
  const locs = locations(readFileSync(CONFS[0], "utf8"));
  const apex = servedBy(locs, "/api/world/apex");
  assert.ok(apex, "nothing in nginx-api.conf serves /api/world/apex");
  assert.match(apex.body, /proxy_cache\s+pmworld;/, `location ${apex.where} serves the apex uncached: every open page's creature poll is a whole world read`);
  const key = cacheKeyOf(apex.body) ?? "";
  assert.match(key, /\$is_args\$args/, `the apex cache key "${key}" ignores the query, so a find would answer an investigate`);
  assert.match(key, /\$http_authorization/, `the apex cache key "${key}" ignores the key, so a resident's read could be served keyless`);
  const valid = /proxy_cache_valid\s+200\s+(\d+)s;/.exec(apex.body);
  assert.ok(valid && Number(valid[1]) >= 15, `the apex copy lives ${valid?.[1] ?? "no"} s; the page polls every 15 s, so under 15 s every poll reaches the office`);
  // ⚑ THE FLIP: drop `apex|` from the shield's regex location → the apex falls to
  // `location /api/`, uncached → the second assert reds.
});
