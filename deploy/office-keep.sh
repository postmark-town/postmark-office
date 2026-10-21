#!/bin/sh
# office-keep.sh — the office's keeping tick: the clones, the ledger, the
# settlements row, the world hydration and the panes. Split out of the old
# office tick (POS-268, 2026-09-27) so the rehydrate unit held only the two
# hydrates and could be retired on its own. It was (POS-268 part 5b,
# 2026-10-08): office.db is no longer built anywhere, and the world hydration,
# the one rehydrate step something still reads, runs here
# (deploy/office-world-hydrate.sh, § the world hydration below). Nothing here
# reads or writes office.db.
#
# Snapshot-under-lock / derive-outside, the same shape office-tick.sh had since
# 2026-07-30: the lock covers only the pulls, the mint pass and a
# `git clone --local` snapshot (seconds); the panes publish runs against the
# frozen snapshot, so the hold never grows with the town's history (pulse
# wright-2026-07-30-office-tick-lock-starves-write-paths).
#
# Runs on postmark-office-keep.timer at :07/:22/:37/:52 — the clock the whole
# tick ran on before the split, so the pulls, the mint, the settlements row and
# the panes are exactly as fresh as they were. The world hydration, which the
# rehydrate ran two minutes after this tick, now runs inside it, after the
# settlements row: the same order, from the same fetch.
#
# Env (from /etc/postmark-office.env via the unit): TOWN_CLONE, WORLD_CLONE.
# And PG_LAW_INGESTER_PASSWORD (from /etc/postmark-world2-dev.env, read by
# systemd and handed in, optional): the world graph's store write takes the law
# pen. That file carries four store passwords, the OWNER's among them, so this
# script takes the one it needs into a shell variable and unsets all four
# before any child runs (§ the store's passwords, below).
# Cwd: /srv/postmark-office (the unit's WorkingDirectory).

set -eu

# ── THE STORE'S PASSWORDS NEVER REACH THE TICK'S CHILDREN (review-593 a) ─────
# The keep units read /etc/postmark-world2-dev.env for the law pen, and systemd
# hands every key in it to this script: four PG_*_PASSWORD values, the store
# owner's included. The tick runs town-repo code (tools/stamp-verify.mjs,
# tools/stamp-mint.mjs, tools/household-keys.mjs) that has no business holding
# any of them. So the law pen's is kept in a shell variable, never exported, and
# all four leave the environment here, before the first child; the world step
# alone is handed the one it needs (§ the world hydration).
KEEP_LAW_PW="${PG_LAW_INGESTER_PASSWORD:-}"
unset PG_WORLD2_OWNER_PASSWORD PG_OFFICE_API_PASSWORD PG_LAW_INGESTER_PASSWORD PG_SNAPSHOT_READER_PASSWORD

# The tick says it is the tick: a tool that must never run here (the reviewed
# award pass, tools/post-award-plan.mjs, POS-290) refuses while this is set.
export OFFICE_KEEP=1

LOCK="${TOWN_LOCK:-/srv/postmark-office/town.lock}"
SNAP="$(mktemp -d /tmp/postmark-tick.XXXXXX)"

# ── THE RUN'S RECEIPT (POS-524) ──────────────────────────────────────────────
# Most steps below are NON-FATAL by design: each prints a line and the tick goes
# on. That let a step fail on every tick forever while the unit read green. So
# every step records its status (ok / refused / skip / notrun, with a reason
# from deploy/keep-history.mjs's fixed vocabulary — never tool output) with
# `keep_step`, into a file in SNAP (an absolute path, so it survives the
# subshells and the mint pass's `cd`), and the EXIT trap writes ONE receipt line
# per run to $KEEP_LOG, then cleans SNAP as before. The roll-call judges each
# step's scheduled streak from that log (postmark-office-keep.timer's outcome).
# The receipt is the tick's bookkeeping, never its work: a receipt that cannot
# be written says so loudly and changes nothing about the tick's exit.
#
# Provenance (Wright 2026-10-13): this unit is the scheduled one by contract;
# postmark-office-keep-by-hand.service runs the same script with
# POSTMARK_KEEP_SOURCE=by-hand, and a hand run never extends or clears a
# scheduled streak. Starting THIS unit by hand records "scheduled": an accepted
# limitation (deploy/DEPLOY.md § the keeping tick's receipt).
#
# The path is a proposal for the owner's box review (POS-524): the directory
# must exist and be writable by the unit's user, or every run says so here and
# the roll-call reads the log as missing.
KEEP_LOG="${OFFICE_KEEP_LOG:-/srv/postmark-harbor/office-keep.jsonl}"
KEEP_SOURCE="${POSTMARK_KEEP_SOURCE:-scheduled}"
KEEP_RUN="${INVOCATION_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"
KEEP_STARTED="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
KEEP_STEPS="$SNAP/keep-steps"
KEEP_SIGNAL=""
keep_step() { printf '%s\t%s\t%s\n' "$1" "$2" "${3:-}" >> "$KEEP_STEPS" 2>/dev/null || true; }
# Exactly once, from the top shell's EXIT only (a subshell never inherits the
# trap). The log's own lock serializes this read-modify-replace against any
# other finisher (a hand run beside the timer's); it is NOT the town lock, so a
# finisher never waits on, or holds, the work.
keep_finish() {
  keep_rc="$1"
  set +e
  if [ -z "${KEEP_DONE:-}" ]; then
    KEEP_DONE=1
    if ! (
      flock -w 20 8 || { echo "[office-keep] RECEIPT NOT WRITTEN — the receipt log's lock was not free within 20 s; the roll-call will read this run as missing" >&2; exit 0; }
      node /srv/postmark-office/deploy/keep-history.mjs write --log "$KEEP_LOG" --steps "$KEEP_STEPS" \
          --source "$KEEP_SOURCE" --run "$KEEP_RUN" --started "$KEEP_STARTED" --exit "$keep_rc" ${KEEP_SIGNAL:+--signal "$KEEP_SIGNAL"} \
        || echo "[office-keep] RECEIPT NOT WRITTEN to $KEEP_LOG (the line above names why) — the tick's work is unaffected; the roll-call will read this run as missing" >&2
    ) 8>>"$KEEP_LOG.lock"; then
      echo "[office-keep] RECEIPT NOT WRITTEN — $KEEP_LOG.lock could not be opened; the roll-call will read this run as missing" >&2
    fi
  fi
  rm -rf "$SNAP"
}
trap 'keep_finish $?' EXIT
# A stopped unit signals the tick: these turn the signals into exits so the
# EXIT trap above writes the receipt (the mint pass keeps its own traps below).
# Only SIGKILL and power loss escape, and the roll-call's staleness catches them.
trap 'KEEP_SIGNAL=TERM; exit 143' TERM
trap 'KEEP_SIGNAL=INT; exit 130' INT
trap 'KEEP_SIGNAL=HUP; exit 129' HUP
# THE STORE'S REGISTRY for the town's tools this tick runs (POS-345): they read
# `--registry "$REGISTRY_FILE"`, never the printed tools/households.json and
# tools/github-ids.json. Written inside the flock below; when the store cannot be
# read nothing is written, and each tool handed the path refuses by name.
REGISTRY_FILE="$SNAP/registry.json"

# ── under the lock: mutate + snapshot (seconds) ──────────────────────────────
# The world clone gets FETCH, never pull: its checkout is the write pen's
# (ensureDraftCheckout reseats it per-write), and a pen branch diverged from a
# Worldkeeper rewrite is a NORMAL between-writes state — a pull there killed
# the tick with "Not possible to fast-forward" the first time S5's rewrite met
# an unpushed pen commit. Reads only need origin refs freshened. The town
# clone keeps --ff-only pull loud on purpose: its main diverging IS a fault.
(
  # Fatal as before (set -e): each records its refusal and exits with its own code.
  flock -w 300 9 || { keep_rc=$?; keep_step lock refused "exit:$keep_rc"; exit "$keep_rc"; }
  keep_step lock ok
  git -C "$TOWN_CLONE" pull --ff-only -q || { keep_rc=$?; keep_step pull refused "exit:$keep_rc"; exit "$keep_rc"; }
  keep_step pull ok
  git -C "$WORLD_CLONE" fetch --prune -q origin || { keep_rc=$?; keep_step fetch refused "exit:$keep_rc"; exit "$keep_rc"; }
  keep_step fetch ok
  if node /srv/postmark-office/deploy/registry-file.mjs "$REGISTRY_FILE"; then keep_step registry ok
  else keep_step registry refused "exit:$?"
    echo "[office-keep] the store's registry could not be read — every town check below that needs it refuses this tick, by name" >&2
  fi
  # settle-on-tick (Keemin, 2026-09-29; overturns #3231's "no timer"): every
  # join merged since the last tick is bound here — the pen's residency/* and
  # hand-written single-address joins — BEFORE the mint catch-up and the
  # welcome pass below. A handle bound first is paid its bundle under its
  # GitHub id; one bound after is paid under its card username, and binding it
  # then puts two welcome lines in one house (Wildcat, 2026-09-28). Inside this
  # flock, so the pass calls settle-join's critical section directly. NON-FATAL
  # like the mint: a join that cannot settle now is logged and asked again.
  if node /srv/postmark-office/deploy/settle-pass.mjs \
      --town "$TOWN_CLONE" --cursor /srv/postmark-office/settle-pass.cursor; then keep_step settle ok
  else keep_step settle refused "exit:$?"
    echo "[office-keep] settle pass FAILED (non-fatal) — the lines above name why; the next tick asks again from the same cursor" >&2
  fi
  # standing-on-tick (POS-347, 2026-10-04): the standing ledger is a store
  # table now (standing_acts, 060) and tools/standing-ledger.md its export. The
  # drain adopts any line committed to the file by hand (the store reads git),
  # then renders the file from the store and commits it only when it differs.
  # The Registrar's door renders in its own act; this catches a hand line, and
  # a door act whose push was lost. NON-FATAL: the doors read the store, not the
  # file, so a drain that cannot run leaves only the export (the witness's copy)
  # one tick behind, and the next tick asks again.
  if node /srv/postmark-office/tools/standing-drain.mjs --apply --clone "$TOWN_CLONE"; then keep_step standing ok
  else keep_step standing refused "exit:$?"
    echo "[office-keep] standing drain FAILED (non-fatal) — the line above names why; the doors read the store and are unaffected" >&2
  fi
  # gangway-on-tick (POS-353): the same shape for HARBOR/GANGWAY.md — a
  # founder commit to the file is adopted, then the file is rendered from the
  # store. Non-fatal: every arrival road reads the store, not the file.
  if node /srv/postmark-office/tools/gangway-drain.mjs --apply --clone "$TOWN_CLONE"; then keep_step gangway ok
  else keep_step gangway refused "exit:$?"
    echo "[office-keep] gangway drain FAILED (non-fatal) — the line above names why; the arrival roads read the store and are unaffected" >&2
  fi
  # mint-on-tick (2026-08-06): a MANUAL crossing delivers without minting (the
  # key is box custody), opening an owed-window that used to last until the
  # next automated crossing — and a settlement landing inside it refuses
  # (S18, 06:00Z, correctly). This closes any such window within one tick.
  # Idempotent (--append skips recorded lines; no-op is the normal case);
  # non-fatal — the tick's real job is never held hostage by the mint, and a
  # red ledger stays the keeper's gate's finding. Same key the crossing signs
  # with, same flock we are already holding.
  # welcome-on-tick (2026-09-17): the welcome bundle (founder-ruled 09-14) is
  # ✦5 to every household once, at its first resident. It is NOT derived from
  # the mail, so `--append` above does not and cannot write it — the town's own
  # registry row, its grammar note and its `--welcome` header all say "the
  # office writes the bundle at a crossing", and until this line nothing did.
  # Measured on the train tip: 6 households admitted after the 09-14 by-hand
  # pass held no bundle and no scheduled thing would ever have paid them.
  #
  # ORDER IS LOAD-BEARING, and it is the town's refusals that fix it: `--welcome`
  # declines onto an unsettled tail ("run --append first") and declines a date
  # before the ledger's last. So it runs AFTER the mint pass and BEFORE verify,
  # inside this same flock, with the same key — its rows are verified and pushed
  # by the commit already below rather than sitting unsealed until the next tick.
  #
  # It mints only households the town's own `--welcome-plan` names, and the
  # town's once-per-household law refuses a second bundle on its own.
  #
  # ⚑ ITS EXIT IS SWALLOWED ON PURPOSE, and the first draft of this line got it
  # wrong. Chained with `&&`, one refused bundle would have stopped `stamp-verify`
  # and the commit below — stranding the `--append` rows that DID land, unsealed
  # and unpushed, until a later tick. A refusal means one household waits one
  # crossing; it must never hold the mint pass hostage. Bad rows are still caught:
  # anything this writes goes through the verify below it.
  #
  # ⚑ WHOLE OR NOTHING (POS-295, 2026-09-28). On 09-28 the verify failed on an
  # OLDER committed line (red since 13:59Z), the `&&` chain skipped the commit,
  # and nothing restored the file: Corey's appended welcome sat uncommitted in
  # the town clone from 18:37Z to 23:31Z, and every office write that pulls it
  # refused. Two rules now, both below:
  #   · CHECK BEFORE WRITING. A ledger that arrives red appends nothing, and the
  #     journal says the catch-up is off and why. A green arrival is the only
  #     state a new row is signed onto.
  #   · A FAILED CHECK AFTER WRITING PUTS THE CLONE BACK: the ledger's arrival
  #     bytes and no path the pass created, from an EXIT trap, so a tick killed
  #     mid-pass restores too (TERM/INT/HUP become exits so the trap runs; only
  #     SIGKILL escapes it). Discarding is safe because every row this pass
  #     writes is re-derivable: `--append` recomputes from the mail and the
  #     welcome plan re-reads the ledger, so the household waits one tick.
  # A pass that changed nothing skips the second verify: the arrival check
  # already read these exact bytes, so the quiet tick costs one verify, as before.
  # The trap disarms the moment the commit lands; a push that then fails leaves
  # a local commit, exactly as it did before this block.
  ( cd "$TOWN_CLONE" || { keep_step mint refused prep-failed; exit 1; }
    # nothing to roll back unless this pass arms; restore() below overrides
    keep_step rollback ok not-needed
    LEDGER=WHITE_PAGES/stamp-ledger.md
    # The arrival check reads "mints owed" and "settlement owed" as not red
    # (POS-341, Darko 2026-10-20 15:38): they are exactly what this pass pays.
    # A crossing whose ingest failed skips its store mint and leaves them for
    # this tick, and a plain verify here would refuse the catch-up that pays them.
    # Anything else the town verifier finds is still red, and every verify after
    # a write below stays the plain one (tools/stamp-verify-owed.mjs).
    if ! node /srv/postmark-office/tools/stamp-verify-owed.mjs --registry "$REGISTRY_FILE"; then
      echo "[office-keep] mint catch-up OFF — the ledger arrived red (stamp-verify above names the line), so this tick appended nothing; the catch-up resumes on the first tick that finds it green" >&2
      # exit 0 keeps the tick's flow as it was; the receipt says what it is: the mint REFUSED
      keep_step mint refused ledger-red
      exit 0
    fi
    # The arrival copy lives in a directory THIS subshell owns: a stopped unit
    # signals the whole tick, and the outer shell must not be able to take the
    # copy away before this trap has put it back.
    HOLD="$(mktemp -d /tmp/postmark-tick-hold.XXXXXX)" || { keep_step mint refused prep-failed; exit 1; }
    armed=0
    # The arrival bytes go back only over the head they arrived on (POS-447): a
    # runner that lost its push race and then refused has brought the clone up
    # to the remote's tip, whose ledger holds the other writer's lines, so the
    # ledger is put back from that HEAD instead.
    putback() {
      if [ "$(git rev-parse HEAD)" = "$(cat "$HOLD/head.arrived")" ]; then
        cp "$HOLD/ledger.arrived" "$LEDGER" && git reset -q -- "$LEDGER"
      else
        git reset -q -- "$LEDGER" && git checkout -q HEAD -- "$LEDGER"
      fi
    }
    restore() {
      if [ "$armed" = 1 ]; then
        armed=0
        if putback; then
          git ls-files --others --exclude-standard | grep -vxF -f "$HOLD/untracked.arrived" |
            while IFS= read -r made; do rm -f -- "$made"; done
          echo "[office-keep] mint catch-up ROLLED BACK — the ledger is back to its arrival bytes (to HEAD's after a lost push race) and every path the pass created is gone; the rows re-derive on the next tick" >&2
          keep_step rollback ok rolled-back
        else
          echo "[office-keep] mint catch-up ROLL-BACK FAILED — the town clone may hold uncommitted rows; git -C $TOWN_CLONE status" >&2
          keep_step rollback refused rollback-failed
        fi
      fi
      rm -rf "$HOLD"
    }
    trap restore EXIT
    trap 'exit 143' TERM
    trap 'exit 130' INT
    trap 'exit 129' HUP
    cp "$LEDGER" "$HOLD/ledger.arrived" || { keep_step mint refused prep-failed; exit 1; }
    git rev-parse HEAD > "$HOLD/head.arrived" || { keep_step mint refused prep-failed; exit 1; }
    git ls-files --others --exclude-standard > "$HOLD/untracked.arrived" || { keep_step mint refused prep-failed; exit 1; }
    armed=1
    # armed: the rollback is owed until restore() or a disarm below says what
    # became of it. A stopped unit can write the receipt before this subshell's
    # trap has finished, and then the receipt reads "notrun", never "not needed".
    keep_step rollback notrun
    # POS-341, BEHIND ITS SWITCH. With STAMP_LINES=store (set once the box has
    # 066/067, one ingest, one --sync and a green parity), the mint decides from
    # the store and commits its own lines in its store transaction
    # (world2/tools/stamp-mint-run.mjs). Those lines are in HEAD then, so the
    # arrival copy moves up to them and a roll-back below puts back only what
    # the welcome and stage passes wrote. Unset, the town's own --append runs
    # exactly as before, and unsetting it is the rollback.
    if [ "${STAMP_LINES:-}" = store ]; then
      node /srv/postmark-office/world2/tools/stamp-mint-run.mjs --append --key /srv/postmark-office/stamp-key.pem \
          --clone "$TOWN_CLONE" --message "mint: tick catch-up pass" || { keep_step mint refused mint-failed; exit 1; }
      cp "$LEDGER" "$HOLD/ledger.arrived" || { keep_step mint refused prep-failed; exit 1; }
      git rev-parse HEAD > "$HOLD/head.arrived" || { keep_step mint refused prep-failed; exit 1; }
    else
      node tools/stamp-mint.mjs --append --key /srv/postmark-office/stamp-key.pem || { keep_step mint refused mint-failed; exit 1; }
    fi
    keep_step mint ok
    if node /srv/postmark-office/deploy/welcome-pass.mjs \
        --town "$TOWN_CLONE" --key /srv/postmark-office/stamp-key.pem; then keep_step welcome ok
    else keep_step welcome refused "exit:$?"
      echo "[office-keep] welcome pass had refusals (non-fatal) — the lines above name each one; the household keeps its claim and the next crossing asks again" >&2
    fi
    # The bug ladder's stage pass (Darko, 2026-10-07: payment "rides on the
    # acceptance"). Every stage an advance recorded and the ledger has not paid
    # is minted through the town's own --stage-mint verb, one line per post and
    # stage, ever; the cap and the meep law are the town's. The resident hears
    # what was paid and why from the Bug Catcher's next round, which reads these
    # post:<id>/<stage> lines (MEEPS/SKILLS/bugcatcher-round.md).
    if node /srv/postmark-office/tools/bug-stage-plan.mjs \
        --town "$TOWN_CLONE" --apply --quiet --key /srv/postmark-office/stamp-key.pem; then keep_step bugstage ok
    else keep_step bugstage refused "exit:$?"
      echo "[office-keep] bug stage pass had refusals (non-fatal) — the lines above name each one; the stage stays owed and the next tick pays it" >&2
    fi
    # The ballots (POS-349: ballots are posts). The founder's ballot files are
    # the input: this takes each one in as the town's post, or moves its post to
    # what the file now says, and records every ledger stake no vote carries, in
    # the post's own transaction. Store only (nothing here touches the ledger),
    # and idempotent, so the first tick after the deploy takes the town's ballots
    # in whole and every later tick writes nothing unless something moved. A
    # stake reads the post and refuses while the two disagree, so a status the
    # founder moved stands within one tick of reaching this clone.
    if node /srv/postmark-office/tools/ballots-backfill.mjs --town "$TOWN_CLONE" --hand keemin --apply --quiet; then keep_step ballots ok
    else keep_step ballots refused "exit:$?"
      echo "[office-keep] ballot ingest had refusals (non-fatal) — the lines above name each one; the post stands as it was and the next tick asks again" >&2
    fi
    if ! cmp -s "$LEDGER" "$HOLD/ledger.arrived"; then
      node tools/stamp-verify.mjs --registry "$REGISTRY_FILE" || { keep_step verify refused verify-red; exit 1; }
      keep_step verify ok
    else
      keep_step verify ok no-change
    fi
    if ! git diff --quiet -- "$LEDGER"; then
      git add "$LEDGER" && git commit -qm "mint: tick pass (welcome, bug stages)" || { keep_step commit refused commit-failed; exit 1; }
      keep_step commit ok
      armed=0
      keep_step rollback ok not-needed
      # a commit is not a push: a push that fails leaves the local commit, as before
      git push -q || { keep_step push refused push-failed; exit 1; }
      keep_step push ok
      # with the switch on, the lines this shell committed (the welcome and
      # stage passes) are recorded in the store now: the store reads git
      if [ "${STAMP_LINES:-}" = store ]; then
        node /srv/postmark-office/world2/tools/stamp-lines.mjs --sync --clone "$TOWN_CLONE" || { keep_step sync refused sync-failed; exit 1; }
        keep_step sync ok
      else
        keep_step sync ok switch-off
      fi
    else
      keep_step commit ok no-change
      keep_step push ok no-change
      keep_step sync ok no-change
    fi
    armed=0
    keep_step rollback ok not-needed
  ) || echo "[office-keep] mint catch-up FAILED (non-fatal) — run stamp-verify in the town clone" >&2
  git clone --local --quiet "$TOWN_CLONE" "$SNAP/town" || { keep_rc=$?; keep_step snapshot refused "exit:$keep_rc"; exit "$keep_rc"; }
  keep_step snapshot ok
) 9>>"$LOCK"

# ── settlements-on-tick (postmark#2897, Wright-ruled 2026-09-17) ─────────────
# The store's `settlements` row FOLLOWS the keeper's tag, and the world fetch
# under the lock above is what carries the tag in: measured 2026-09-17, a plain
# `git fetch --prune origin` re-follows an annotated tag whose commit is already
# local (S71 deleted locally, back as a `tag` object on the next plain fetch).
# So the office learns of a blessing within one tick of it, which is exactly
# the freshness 1.0's own tag read has had all along ("tags ride the tick's
# existing fetch", src/settlements.mjs). Outside the lock, because the tool
# reads refs and a Postgres, never the clone's working tree, and the lock's
# hold is what the write path waits on. Idempotent: a present row is skipped,
# a moved tag is REFUSED with its number and nothing partial lands. NON-FATAL
# like the mint and the world hydrate — the tick's real work never waits on
# the store — and its one receipt line lands in this journal either way.
# The same run then records which settlement carried each newly published mark
# (049, `mark_carried`) and adds a `carried:` line; a refusal there exits 1 with
# the settlement rows already committed, so the failure line names both tables.
if settled="$(node world2/tools/settlements-backfill.mjs --apply --prod --quiet --world-repo "$WORLD_CLONE" 2>&1)"; then
  keep_step settlements ok; echo "[office-keep] settlements: $settled"
else
  keep_step settlements refused "exit:$?"; echo "[office-keep] settlements or carried rows NOT written (non-fatal) — $settled — the next tick tries again; world2/tools/settlements-backfill.mjs --verify and mark-carried-backfill.mjs --verify say where the tables stand" >&2
fi
# The same run's four soft steps get their OWN keep steps (POS-612 and POS-627,
# review-612): each is non-fatal, so its failure leaves the run's exit 0 and
# `settlements ok` above, and would otherwise reach no alarm. Read from the
# run's own lines (`carried: …`, `chests: …`, `amends: …`, `drops: …`;
# settlements-backfill.mjs § softStepStatus, which names each step's rules):
# done → ok; failed, or a prerequisite missing → refused; no line → notrun.
# box-rollcall alarms on three scheduled ticks that are not ok (keep-history.mjs).
# shellcheck disable=SC2046 # the status and its reason are two words on purpose
keep_step carried $(printf '%s\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step carried 2>/dev/null || echo notrun)
# shellcheck disable=SC2046
keep_step chests $(printf '%s\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step chests 2>/dev/null || echo notrun)
# shellcheck disable=SC2046
keep_step amends $(printf '%s\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step amends 2>/dev/null || echo notrun)
# shellcheck disable=SC2046
keep_step drops $(printf '%s\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step drops 2>/dev/null || echo notrun)
# a named creature's ending at the settlement (WLD-25): a failed ending fails every tick, so it alarms
# shellcheck disable=SC2046
keep_step endings $(printf '%s\n' "$settled" | node world2/tools/settlements-backfill.mjs --soft-step endings 2>/dev/null || echo notrun)

# ── the positions snapshot, once per clearing (POS-302, 053) ─────────────────
# The newest closed window's snapshot of each resident's governing departure,
# written if that window has none, so the office's positions rebuild replays
# only the acts since. NON-FATAL and outside the clearing (Wright 2026-10-02): a
# failed snapshot never blocks a clearing or this tick, and the office reads the
# whole record until one exists. Same connection as the settlements rows above.
if snapped="$(node world2/tools/position-snapshot.mjs --apply --prod --quiet --world-repo "$WORLD_CLONE" 2>&1)"; then
  keep_step positions ok; echo "[office-keep] $snapped"
else
  keep_step positions refused "exit:$?"; echo "[office-keep] positions snapshot NOT written (non-fatal) — $snapped — the next tick tries again; world2/tools/position-snapshot.mjs --verify says where it stands" >&2
fi

# ── one household, one mint key: the alarm's log line (Darko, 2026-10-04) ────
# The town's own predicate (tools/household-keys.mjs) over the frozen snapshot:
# every declared household mints under ONE key and no key spans two houses.
# One JSON line per tick, appended to the log the roll-call reads (the
# postmark-office-keep.timer row's outcome block: alarm_on_nonempty
# split_households / shared_keys, alarm_on_false checked). NON-FATAL: a split
# is the alarm's to raise, never this tick's to stop on. A run that produced no
# JSON (the tool absent or crashed) still writes a line, `checked: false`, so
# "did not run" never reads like "found nothing".
HK_LOG="${HOUSEHOLD_KEYS_LOG:-/srv/postmark-harbor/household-keys.jsonl}"
hk_out="$(node "$SNAP/town/tools/household-keys.mjs" --json --repo "$SNAP/town" --registry "$REGISTRY_FILE" 2>&1)" || true
if node -e '
  const text = process.argv[1] ?? "";
  let j = null;
  try { j = JSON.parse(text.trim().split("\n").pop()); } catch {}
  const line = j && Array.isArray(j.split_households)
    ? { ...j, checked: true }
    : { at: new Date().toISOString(), checked: false, split_households: [], shared_keys: [], error: text.slice(0, 400) };
  process.stdout.write(JSON.stringify(line) + "\n");
' "$hk_out" >> "$HK_LOG"; then
  keep_step hhkeys_log ok
  echo "[office-keep] household keys: $(printf '%s' "$hk_out" | tail -n 1 | cut -c1-300)"
else
  keep_step hhkeys_log refused write-failed
  echo "[office-keep] household keys line NOT written to $HK_LOG (non-fatal) — the roll-call will read the log as stale" >&2
fi
# The predicate RAN only if it left its JSON: a `checked: false` line is a step
# that did not run, whatever the append above returned (POS-524).
if node -e '
  let j = null;
  try { j = JSON.parse(String(process.argv[1] ?? "").trim().split("\n").pop()); } catch {}
  process.exit(j && Array.isArray(j.split_households) ? 0 : 3);
' "$hk_out"; then keep_step hhkeys ok
else keep_step hhkeys refused unchecked
fi

# ── the world hydration (moved from the retired rehydrate, POS-268 5b) ───────
# the store's world graph snapshot (world.db is retired, POS-270 3b), at the
# newest blessing, from the world clone fetched under the lock above. After the settlements row, as
# it ran before (two minutes after this tick), and before the panes, whose
# publish fails the tick loudly and must never take this step down with it.
# It never takes the lock (it reads refs, not the pen's checkout) and it never
# fails the tick, but it is a receipt step (review-593 c): a snapshot that stops
# being written reads on the roll-call, not only in the journal. It is the only
# child handed the law pen's password (§ the store's passwords, above).
if PG_LAW_INGESTER_PASSWORD="$KEEP_LAW_PW" sh deploy/office-world-hydrate.sh; then keep_step world ok
else keep_step world refused "exit:$?"
fi

# ── outside the lock: the panes, from the frozen snapshot ────────────────────
# publish-windows keeps its stage-and-swap: a failed publish leaves the live
# webroot untouched and fails the tick loudly.
if node deploy/publish-windows.mjs --town "$SNAP/town" --out /var/www/postmark-panes/live; then keep_step publish ok
else keep_rc=$?; keep_step publish refused "exit:$keep_rc"; exit "$keep_rc"
fi
