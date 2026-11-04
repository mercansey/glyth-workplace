#!/bin/zsh
cd "$(dirname "$0")"
echo "== Glyth: commit and push =="

# GitHub HTTPS auth goes through the gh CLI on this machine — make sure it works first.
if ! gh auth status >/dev/null 2>&1; then
  echo ""
  echo "GitHub sign-in has expired. A browser sign-in will open now —"
  echo "sign in as mercansey (kmercansey@gmail.com), then this script continues."
  echo ""
  gh auth login -h github.com || { echo "Sign-in failed — run: gh auth login -h github.com"; echo "Press any key to close."; read -k 1; exit 1; }
fi

git add -A
echo ""
git status --short | head -n 30
echo ""
git commit -m "Glyth Workplace: full app build with real media and LLM chat" -m "- Fitness: 20 real workout GIFs mapped to a 40-exercise library, shown in the workout player and demo grid; guided Gym Accessories template
- Mindfulness: 10 recorded 3-minute guided sessions replace device text-to-speech; real audio player with seek
- Ask Glyth is LLM-powered (Meta muse-spark-1.1): no deterministic fallback answers, failures surfaced with the provider error, replies normalised to plain language and rendered formatted; suggestion chips hide after the first message
- Server serves /assets GIF/MP3 with Range support and includes media in the Capacitor web build
- Employer dashboard, finance, family, comms, native iOS bridge, tests (138 passing)" || echo "(nothing new to commit — pushing existing commits)"

git push -u origin main
echo ""
echo "Done. Press any key to close."
read -k 1
