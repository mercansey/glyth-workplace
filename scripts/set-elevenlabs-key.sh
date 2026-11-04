#!/bin/zsh
# Prompts (hidden) for the ElevenLabs API key and an optional voice ID, and writes
# them into .env as ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID. The key is never
# echoed and `read -s` keeps it out of shell history. .env is gitignored.
set -e
cd "$(dirname "$0")/.."

printf "Paste ElevenLabs API key (input hidden): "
read -s EL_KEY
echo ""
if [ -z "$EL_KEY" ]; then echo "No key entered — .env left unchanged."; exit 1; fi
printf "Voice ID (optional, Enter to skip — list them later with: node scripts/voiceover.mjs --voices): "
read EL_VOICE

python3 - "$EL_KEY" "$EL_VOICE" << 'PY'
import pathlib, sys
vals = {"ELEVENLABS_API_KEY": sys.argv[1].strip()}
if sys.argv[2].strip(): vals["ELEVENLABS_VOICE_ID"] = sys.argv[2].strip()
p = pathlib.Path(".env")
lines = p.read_text().splitlines() if p.exists() else []
out, seen = [], set()
for line in lines:
    k = line.split("=", 1)[0]
    if k in vals: out.append(f"{k}={vals[k]}"); seen.add(k)
    else: out.append(line)
for k, v in vals.items():
    if k not in seen: out.append(f"{k}={v}")
p.write_text("\n".join(out) + "\n")
print(f"ELEVENLABS_API_KEY saved to .env (length: {len(vals['ELEVENLABS_API_KEY'])})" + (" + voice ID" if "ELEVENLABS_VOICE_ID" in vals else ""))
PY
unset EL_KEY EL_VOICE

echo ""
echo "Next steps:"
echo "  1. Check the key + list voices:   node scripts/voiceover.mjs --voices"
echo "  2. Test voice on the 30s cut:     node scripts/voiceover.mjs demo-video/vo-script-30s.json"
echo "  3. Full 3-min voiceover:          node scripts/voiceover.mjs demo-video/vo-script-3min.json"
