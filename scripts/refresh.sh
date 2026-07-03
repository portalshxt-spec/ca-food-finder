#!/bin/zsh
# Weekly data refresh: fetch all sources → normalize → rebuild → restart app.
# Scheduled by ~/Library/LaunchAgents/com.cafoodfinder.refresh.plist
set -u
export PATH="/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin"
PROJECT="/Volumes/LaCie/ca-food-finder"
LOG="$PROJECT/data/refresh.log"

{
  echo "===== refresh started $(date)"
  cd "$PROJECT" || { echo "project drive not mounted — skipping"; exit 0; }

  node scripts/ingest/fetch.mjs
  node scripts/ingest/normalize.mjs
  npm run build

  # Restart the production server so it serves the fresh build
  pkill -f "next start" 2>/dev/null || true
  sleep 2
  nohup npm run start >> "$PROJECT/data/server.log" 2>&1 &
  echo "===== refresh finished $(date)"
} >> "$LOG" 2>&1
