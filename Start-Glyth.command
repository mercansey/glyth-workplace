#!/bin/zsh
cd "$(dirname "$0")"
LOG="$PWD/glyth-preview.log"
echo "Starting Glyth preview..." | tee "$LOG"
echo "Log: $LOG" | tee -a "$LOG"

# Finder-launched Terminal may not have Homebrew on PATH — find node explicitly.
NODE_BIN="$(command -v node 2>/dev/null)"
if [ -z "$NODE_BIN" ] && [ -x /opt/homebrew/bin/node ]; then NODE_BIN=/opt/homebrew/bin/node; fi
if [ -z "$NODE_BIN" ] && [ -x /usr/local/bin/node ]; then NODE_BIN=/usr/local/bin/node; fi
if [ -z "$NODE_BIN" ]; then
  echo "Could not find Node.js. Install Node 20+ from https://nodejs.org then try again." | tee -a "$LOG"
  echo "Press any key to close."; read -k 1; exit 1
fi
echo "Using node: $NODE_BIN ($($NODE_BIN --version))" | tee -a "$LOG"

export PORT=3000
export DEMO_MODE=true

# Open the browser only once the server is actually answering.
( for i in {1..30}; do
    if curl -s -o /dev/null http://127.0.0.1:3000/; then open "http://127.0.0.1:3000/"; break; fi
    sleep 1
  done ) &

echo "Open http://127.0.0.1:3000/ — keep this window open while previewing." | tee -a "$LOG"
"$NODE_BIN" server/server.js 2>&1 | tee -a "$LOG"
echo "" | tee -a "$LOG"
echo "The server has stopped. Press any key to close this window."
read -k 1
