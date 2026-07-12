#!/usr/bin/env bash
# Drive Codex through the remaining card art.
#
# Three constraints shape this loop:
#   1. Codex enforces a ~15-minute execution window per task, so one run only
#      produces a handful of images. The prompt is resumable, so we relaunch.
#   2. Codex image generation is quota-limited. On "usage limit" we WAIT for the
#      reset rather than treating it as a stall.
#   3. cards.json has many exact duplicates (14x Challenge, 9x Modifier +2/-2 ...).
#      art-todo.js emits one representative per (type,name); dedupe-art.js copies
#      the illustration to its duplicates afterwards. Never generate the same
#      subject twice.
#
#   bash scripts/art-run-loop.sh
set -u

REPO="C:/Users/c.fazal/Desktop/HeretoslayBestanden"
CJS="C:/Users/c.fazal/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs"
LOG="$REPO/scripts/.art-run.log"
MAX_RUNS=40
QUOTA_WAIT=1800          # 30 min between quota retries
MAX_QUOTA_WAITS=8        # ~4h of waiting at most

cd "$REPO" || exit 1
remaining() { node scripts/art-todo.js --count 2>/dev/null || echo 0; }

sync_art() {
  node scripts/dedupe-art.js >/dev/null 2>&1 || true   # fill duplicates
  node scripts/compress-art.js >/dev/null 2>&1 || true # webp for the game
}

quota_waits=0
stall=0

for run in $(seq 1 $MAX_RUNS); do
  sync_art
  node scripts/art-todo.js >/dev/null 2>&1
  left=$(remaining)

  if [ "$left" -eq 0 ]; then
    echo "DONE: every card has art."
    break
  fi

  echo "--- run $run | $left unique subject(s) left | launching codex ---"
  node "$CJS" task --write --fresh "$(cat scripts/art-prompt.txt)" >"$LOG" 2>&1

  if grep -qi "usage limit" "$LOG"; then
    quota_waits=$((quota_waits + 1))
    echo "QUOTA: usage limit hit ($quota_waits/$MAX_QUOTA_WAITS). $(grep -io 'try again at [^.]*' "$LOG" | head -1)"
    sync_art
    [ "$quota_waits" -ge "$MAX_QUOTA_WAITS" ] && { echo "ABORT: quota still exhausted after $quota_waits waits."; break; }
    echo "sleeping ${QUOTA_WAIT}s before retry..."
    sleep "$QUOTA_WAIT"
    continue
  fi

  sync_art
  after=$(remaining)
  echo "--- run $run done | $left -> $after remaining ---"

  if [ "$after" -ge "$left" ]; then
    stall=$((stall + 1))
    echo "WARNING: no progress (stall $stall/2)"
    [ "$stall" -ge 2 ] && { echo "ABORT: two runs with no progress, $after still missing."; break; }
  else
    stall=0
  fi
done

sync_art
echo "ART LOOP ENDED — $(remaining) unique subject(s) still missing."
node scripts/compress-art.js 2>&1 | tail -2
