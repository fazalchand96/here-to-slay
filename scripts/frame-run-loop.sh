#!/usr/bin/env bash
# Retry the frame + crest generation until Codex's image quota allows it.
# Same quota-aware pattern as art-run-loop.sh: on "usage limit" we wait rather
# than treating it as a stall. Stops as soon as all 8 frames + 6 crests exist.
set -u

REPO="C:/Users/c.fazal/Desktop/HeretoslayBestanden"
CJS="C:/Users/c.fazal/.claude/plugins/cache/openai-codex/codex/1.0.6/scripts/codex-companion.mjs"
LOG="$REPO/scripts/.frame-run.log"
V2="$REPO/public/assets/skin/frames/v2"
CRESTS="$REPO/public/assets/skin/icons/crest-v2"
QUOTA_WAIT=1800
MAX_RUNS=20

cd "$REPO" || exit 1
count() { echo $(( $(ls "$V2"/*.png 2>/dev/null | wc -l) + $(ls "$CRESTS"/*.png 2>/dev/null | wc -l) )); }

for run in $(seq 1 $MAX_RUNS); do
  have=$(count)
  if [ "$have" -ge 14 ]; then echo "DONE: 8 frames + 6 crests present."; break; fi

  echo "--- run $run | have $have/14 assets | launching codex ---"
  node "$CJS" task --write --fresh "$(cat scripts/frame-prompt.txt)" >"$LOG" 2>&1

  if grep -qi "usage limit" "$LOG"; then
    echo "QUOTA blocked. $(grep -io 'try again at [^.]*' "$LOG" | head -1) — sleeping ${QUOTA_WAIT}s"
    sleep "$QUOTA_WAIT"
    continue
  fi
  echo "--- run $run done | $have -> $(count)/14 ---"
done

echo "FRAME LOOP ENDED — $(count)/14 assets present."
