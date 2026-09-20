# The standing flip — the store's clearing decides, and the tree is written from rows

*Written 2026-09-17 by Wright for POS-104 box 4 (postmark-town/postmark#2892).
Design record, not a build record: nothing in §4 or §5 is implemented. One ship
with the read flip, w40. The pen flip's design (`DESIGN-pen-flip.md`, 2026-08-28;
D1–D9 ruled 2026-08-29) stands underneath this note; this is what has to be true
for the READS and for STANDING, which that note deliberately left to the LIVE
lane. Every measurement below is the POS-104 lane's, run read-only against prod
on 2026-09-17 (the report on #2892), or the tree's own word at the line cited.*

---

## 0 · Where the record stands today

- **Writes are flipped** per lane since the 09-05 ruling (D1). Postgres `acts`
  is the record of what residents did; the reverse mirror dies per lane (DEC-2).
- **Standing is still decided by the git sweep** at each settlement. The store's
  `marks` table is materialized FROM the tree, and the retire step reconciles the
  store after the push — *"Canon has not let a mark go until main is actually on
  origin."* The clearing (the store) rules claims through the docket; the sweep
  (git) then re-decides standing from the tree: the rebase, the husks, the KEEP
  frames, and since 09-16 the harm gate's five checks (POS-103).
- **Every World-page read but walks comes from the tree through the office:**
  `/world/apex` (`src/server.mjs:1138`), `/world/state` (`:1146`),
  `/world/present` (`:1197`), `/world/my-marks` (`:1104`), `/world/investigate`
  (`:1124`), `/world/stake` (`:1180`), `/world/settlements` (`:1219`).
- **The twins:** thirteen stood under `/world2/*`, built, A/B-tested, never
  pointed at; office #88 (the w39 train) adds `my-marks`, `stake` and
  `investigate`, each answering `tree_only` by name. Settlements has no twin
  because the store records no settlements (#2897).
- **The instruments, run on prod 2026-09-17:** apex is field-equal everywhere
  but omits the whole `records` key (#2896); ten marks stand `home` on the tree
  and `market` in the store (#2895); `falsifier-live-equality` cannot complete
  on any live checkout since the 08-29 ledger rename (#2894);
  `falsifier-guard-equality` needs a scratch database on prod's own Postgres
  server and was not run (D-A below); and the store's law projection is twelve
  days behind the tree — last ingest 2026-09-05 (#2893).

Two truths are on screen today, for ten marks. That is the case the gate names.

---

## 1 · The smallest true sentence

> The store's clearing decides what a window publishes and returns; the tree is
> written from rows afterwards; and every read the World page makes is
> store-served, each proven equal on prod before its pointer moves.

Everything below is what has to be true before the office can say that.

---

## 2 · Order: the reads move first, standing with them or before — never after

This is POS-104's gate, and the reason is the split brain R3 named, on the
other side. If standing moved to the store while the reads stayed on the tree,
the page would show the tree's standing for a decision the store had made. If
the reads moved first while the sweep still decided standing, the store's
`marks` — materialized from the tree — would be the reads' source and still
right. So the reads CAN move first, one read at a time, each behind its own
flag with its equality falsifier as the gate; standing moves last, in the same
ship, once every read is on rows. A read whose falsifier is red on prod does not
move, whatever the calendar says.

---

## 3 · What has to be true first — the five reds, as requirements

- **S1 · The law pin is current.** The store cannot be the law's reader with a
  pin twelve days old; every twin that reads law through `law_projection`
  answers under a law the tree has amended (the nothing-burns marks, the holo
  marks, the harm gate's own). *Corrected 2026-09-17 13:1x by the #2893 lane:*
  the ingest did not fail — the unit carrying the law pen is PARKED at the
  founder's 08-31 word, and that unit carries the town pen too, which is the
  pen the park was for. So S1 is not a fix but a decision (D-F below); the
  roll-call row on the pin's age still follows once a pen writes it (#2893).
- **S2 · The instruments run.** The live falsifier resolves the ledger by the
  name the checkout carries (#2894); the guard falsifier's scratch database is
  ruled one way or the other (D-A). A gate measured by a tool that cannot
  complete is not a gate.
- **S3 · `/world2/apex` answers `records`** (#2896). A7 is the equality that
  catches a field going missing rather than going wrong, and it is red for
  exactly this.
- **S4 · One owner of "which tier does this mark stand in"** (#2895). The
  store's walk is the one that will decide after the flip, so it is the one
  that must be right; the ten are measured, the rule the walk reads differently
  is found and fixed on the store's side, and the eleventh's missing register
  row with it. Until then the tree serves, and the falsifier says so.
- **S5 · The store records settlements** (#2897, D-B). A settlement is the one
  town fact the store does not hold at all; `/world/settlements` is
  `git tag --list` and a twin cannot be equal until the blessing writes a row.

And one rule carried over rather than new: **the read flip adds no shim.** Each
read is re-aimed by a flag per read, A/B-provable, and the tree read it replaces
is deleted on a named date (rule 6) — the pen side's DEC-2 shape, applied to
reads.

---

## 4 · The standing flip proper

**Today.** The clearing rules claims at the window's close (the docket's
transitions). The sweep then re-decides standing from the tree and commits; the
harm gate refuses the commit if a mark would move; the retire step reconciles
the store from the pushed tree. The keeper blesses the tag.

**After.** The clearing's decision IS standing — publish and return are ruled
once, in rows, at the window's close. The sweep becomes the materializer: it
writes the tree FROM rows (the record's public export, the shape the notary's
snapshot already proves the office can produce) and never decides. The harm
gate keeps its place unchanged as the tree-side refusal: a materialization that
would move a standing mark is refused exactly as a sweep is today (POS-103's
law is not reopened). The retire step inverts — rows → tree, never tree → rows.
The tree stays public canon (residents read it, the keeper blesses it); it stops
being the decider. The keeper's blessing keeps its form, the tag, and it writes
the store's settlements row (S5) so the two receipts name one event.

**What does not change.** Escrow stays the town's ledger, pinned by `town_sha`
(D9). The pen side's D1–D9 stand as ruled. The World page's boot (POS-87) is
separate work.

---

## 5 · Order of work — w40, one ship

1. **S1**, the law ingest — a correctness fix in its own right.
2. **S2**, the live falsifier's path; the guard falsifier under D-A.
3. **S3**, apex `records`.
4. **S4**, the standing walk's ten and the eleventh.
5. **S5**, the settlements row and its twin.
6. **The reads re-aimed one at a time** behind their flags, each with its
   falsifier green on prod first: present · state · apex · my-marks · stake ·
   investigate · settlements.
7. **The standing flip**: the clearing decides, the sweep materializes.
8. **One A/B window** (one crossing pair), then the tree read paths deleted per
   read, each on its named date.

---

## 6 · The founder's decisions — teed, each with a recommendation

- **D-A · The guard falsifier needs a scratch database on prod's Postgres
  server.** → Allow it as a named, time-boxed create-and-drop by the falsifier's
  own hand (`world2_guards_lane`, dropped in the same run, logged), or run it
  against a replica. *Rec: allow it; a replica for one falsifier is furniture.*
- **D-B · Settlements in the store.** → A `settlements` table — number, tag sha,
  blessed_at, the window it closed — written by the publish step at the tag and
  read by the keeper's bless; the tags stay as the git-side receipt. *Rec: yes.*
- **D-C · The tree after the flip is a materialized export.** → The sweep writes
  it from rows and never decides; the harm gate stays as the refusal. *Rec: yes.*
- **D-D · One flag per read, or one for all.** → Per read, mirroring D1's
  per-lane shape. *Rec: per read.*
- **D-F · The law pen, parked with the town pen (#2893).** One ingest unit
  carries two pens; the 08-31 park's reason ("a re-lift would launder v1's record
  into v2's") covers the town pen only, and `law_projection` has no other writer.
  → Split the unit: `law-ingest` on its own timer, `stamp-ingest` stays parked.
  *Rec: split it — the smallest change that leaves the 08-31 ruling intact.*
- **D-E · When a door's tree read dies.** → Kept for one A/B window after its
  flag flips, then deleted per read, dated. *Rec: one window, never longer.*

---

## 7 · What this note does not decide

The pen side (D1–D9) as ruled; escrow's home (D9, the town's); the World page's
own boot order (POS-87); the bulletin's and the keeper's words about crossing
times (POS-80, its own law line).

## Provenance

Author: Wright (Star of Wright-HQ), 2026-09-17, for POS-104 box 4. Measurements:
the POS-104 lane's report on postmark-town/postmark#2892 (the four equality
falsifiers on prod, read-only). Standing law cited: `DESIGN-pen-flip.md` §§ R3,
5, 6, 7; the 09-05 ruling on the board; POS-103's harm gate. Reservoir: #2893
#2894 #2895 #2896 #2897. Principal-approval status: the decisions in § 6 are
teed, not ruled.
