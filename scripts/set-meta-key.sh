#!/bin/zsh
# Prompts (hidden) for the Meta Model API key and writes it server-side
# into .env as MODEL_API_KEY. The key is never echoed and, when run from
# an interactive terminal, `read -s` keeps it out of shell history.
set -e
cd "$(dirname "$0")/.."

printf "Paste Meta Model API key (input hidden): "
read -s META_KEY
echo ""
if [ -z "$META_KEY" ]; then
  echo "No key entered — .env left unchanged."
  exit 1
fi

python3 - "$META_KEY" << 'PY'
import pathlib, sys
key = sys.argv[1].strip()
p = pathlib.Path(".env")
lines = p.read_text().splitlines() if p.exists() else []
found = False
out = []
for line in lines:
    if line.startswith("MODEL_API_KEY="):
        out.append("MODEL_API_KEY=" + key); found = True
    else:
        out.append(line)
if not found:
    out.append("MODEL_API_KEY=" + key)
p.write_text("\n".join(out) + "\n")
print(f"MODEL_API_KEY saved to .env (length: {len(key)})")
PY
unset META_KEY

echo ""
echo "Next steps:"
echo "  1. Restart the app: Ctrl+C in the Start-Glyth window, then relaunch Start-Glyth.command"
echo "  2. Prove the real Meta call:  node scripts/meta-hero-test.mjs"
echo "  3. Run the hosted gates:      node scripts/activate-hosted.mjs --yes"
