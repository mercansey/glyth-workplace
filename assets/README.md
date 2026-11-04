# Shipped media

Real media used by the app, copied from the curated `workouts-and-meditations` folder.

- `workouts/` — 20 looping movement GIFs (360×360). Each is mapped to an exercise in
  `src/fitness/fitness.js` via `mediaUrl`; the same demo shows in the Fitness
  "Exercise demos" grid and inside the workout player for that exercise.
- `meditations/` — 10 recorded guided voice sessions, each 3 minutes (180s). Each is a
  session in `src/mindfulness/mindfulness.js` via `audioUrl`, tagged with the
  recommendation type (`reset`, `focus`, `pre_meeting`, `decompress`,
  `recovery_pause`, `wind_down`) the deterministic ranking maps onto. The
  mindfulness player plays the recording; there is no transcript and no
  device-voice fallback for these sessions.

Served by the Node server under `/assets/…` (allowlisted in
`src/server/static.js`, streamed with Range support) and copied into `www/`
by `npm run build:web` for the Capacitor app.
