// dials-both-forms.test.mjs — every dial the office reads, in either form (LOGOS v2 part 2, O1; W1 G3/G5).
//
// LOGOS/classes.md (ruled 16:02): "Every dial becomes a property, and a locked
// value is its default." W1 removes `dials:` from the class nodes and files each
// dial as a `kind: property` node named by the dial's key verbatim. The office
// reads the property node first and the old dial second, through one helper at
// each projection (world-grants § dialsOfClassNode) and the class layer's own
// readers (classDials, classPredicates, dialNumber, dialNode, departurePace).

import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { tmpdir } from "node:os";

process.env.WORLD_CLONE = join(tmpdir(), "postmark-no-world-clone-dials");
const { dialsOfClassNode } = await import("../src/world-grants.mjs");
const { reloadLawSnapshot, resetLawSnapshot, LAW_REFRESH_SQLS } = await import("../src/law-snapshot.mjs");
const { classDials, classPredicates, dialNumber, dialNode, departurePace, resetClassRosterCache } = await import("../src/world-classes.mjs");

const prop = (id, name, dflt, extra = {}) => ({ id, kind: "property", name, default: dflt, tier: "constitution", ...extra });

test("dialsOfClassNode: the property nodes first, the old dials second, and nothing when neither speaks", () => {
  const oldOnly = { id: "the-town/resident", kind: "class", class: "resident", dials: { pace_km_per_crossing: 60, stride_m: 2 } };
  assert.deepEqual(dialsOfClassNode(oldOnly, []), { pace_km_per_crossing: 60, stride_m: 2 }, "the old form projects as it did");
  const newOnly = { id: "the-town/resident", kind: "class", class: "resident" };
  assert.deepEqual(dialsOfClassNode(newOnly, [prop("the-town/resident-pace", "pace_km_per_crossing", 60), prop("the-town/resident-stride", "stride_m", 2)]),
    { pace_km_per_crossing: 60, stride_m: 2 }, "the new form gives the same map");
  assert.deepEqual(dialsOfClassNode({ ...oldOnly }, [prop("p", "pace_km_per_crossing", 72)]), { pace_km_per_crossing: 72, stride_m: 2 }, "a property node wins over the old dial");
  assert.deepEqual(dialsOfClassNode(newOnly, [{ id: "c", kind: "predicated", slot: "standing", value: "x" }, { id: "d", kind: "sited" }]), null, "only property nodes are dials");
  assert.equal(dialsOfClassNode(newOnly, []), null, "an absent dials: stays absent");
  assert.deepEqual(dialsOfClassNode(newOnly, [prop("s", "radius_m", 40), prop("s2", "flood_cap", 3)]), { radius_m: 40, flood_cap: 3 }, "sound's dials");
});

// The law snapshot in each form: the class row's frontmatter dials (old) or its property rows (new).
const SHA = "c".repeat(40);
const classRow = (key, data) => ({ number: 280, tag_sha: SHA, newest: 280, kind: "class", key, data: { class: key, ...data } });
const propRow = (klass, name, dflt, id) => ({ number: 280, tag_sha: SHA, newest: 280, kind: "property", key: `${klass}/${name}`, data: { class: klass, parent: null, name, tier: "constitution", default: dflt, id } });
const predRow = (klass, slot, value, id) => ({ number: 280, tag_sha: SHA, newest: 280, kind: "predicate", key: `${klass}/${slot}/${id}`, data: { class: klass, slot, value, id, ord: 0 } });
const FORMS = {
  old: [
    classRow("resident", { dials: { pace_km_per_crossing: 60 } }),
    classRow("say", {}), predRow("say", "presence_min", "15", "the-town/say-presence"),
    classRow("doorstep", {}), predRow("doorstep", "psa_window_days", "7", "the-town/doorstep-psa-window"),
    classRow("parcel", { dials: { extent_m: 25 } }), classRow("note", { dials: { body_max_chars: 150 } }),
    classRow("bounty", { dials: { ask_max_chars: 150 } }), classRow("sound", { dials: { radius_m: 40, hearing_ttl_min: 30 } }),
  ],
  new: [
    classRow("resident", {}), propRow("resident", "pace_km_per_crossing", 60, "the-town/resident-pace-km-per-crossing"),
    classRow("say", {}), propRow("say", "presence_min", "15", "the-town/say-presence-min"),
    classRow("doorstep", {}), propRow("doorstep", "psa_window_days", "7", "the-town/doorstep-psa-window-days"),
    classRow("parcel", {}), propRow("parcel", "extent_m", 25, "the-town/parcel-extent-m"),
    classRow("note", {}), propRow("note", "body_max_chars", 150, "the-town/note-body-max-chars"),
    classRow("bounty", {}), propRow("bounty", "ask_max_chars", 150, "the-town/bounty-ask-max-chars"),
    classRow("sound", {}), propRow("sound", "radius_m", 40, "the-town/sound-radius-m"), propRow("sound", "hearing_ttl_min", 30, "the-town/sound-ttl"),
  ],
};
async function readAll(rows) {
  await reloadLawSnapshot({ force: true, query: async (sql) => ({ rows: sql === LAW_REFRESH_SQLS.pin ? [{ newest: 280, pinned: 280 }] : rows }) });
  resetClassRosterCache();
  return {
    pace: departurePace(),
    presence: dialNumber("say", "presence_min", 99, { min: 0 }),
    psa: dialNumber("doorstep", "psa_window_days", 99, { min: 0 }),
    parcel: dialNumber("parcel", "extent_m", 99),
    note: dialNumber("note", "body_max_chars", 99),
    bounty: dialNumber("bounty", "ask_max_chars", 99),
    sound: { radius: classDials("sound").radius_m, ttl: classDials("sound").hearing_ttl_min },
    presenceNode: dialNode("say", "presence_min") != null,
  };
}

test("the class layer's dial readers answer the same in both forms: pace, say, doorstep, parcel, note, bounty, sound", async () => {
  try {
    const a = await readAll(FORMS.old);
    const b = await readAll(FORMS.new);
    assert.deepEqual(a, {
      pace: 60, presence: { value: 15, read: true, source: "record" }, psa: { value: 7, read: true, source: "record" },
      parcel: { value: 25, read: true, source: "record" }, note: { value: 150, read: true, source: "record" },
      bounty: { value: 150, read: true, source: "record" }, sound: { radius: 40, ttl: 30 }, presenceNode: true,
    });
    assert.deepEqual(b, a, "the new form reads every dial the old form did");
    assert.equal(dialNode("say", "presence_min"), "the-town/say-presence-min", "dialNode points at the property node");
    assert.equal(classPredicates("say").presence_min, "15");
  } finally { resetLawSnapshot(); resetClassRosterCache(); }
});

test("a property node wins over an old dial the class still carries, in the class layer", async () => {
  try {
    await readAll([classRow("resident", { dials: { pace_km_per_crossing: 15 } }), propRow("resident", "pace_km_per_crossing", 60, "p")]);
    assert.equal(departurePace(), 60);
  } finally { resetLawSnapshot(); resetClassRosterCache(); }
});
