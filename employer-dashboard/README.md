# Employer Dashboard — built

Employer command centre for Glyth Snapshot (hackathon, clean-room). Same design system as the personal app: reuses `../styles.css` tokens, `.glass`, `.btn`, `.liquid` dock, `.sheet`, `.bar`, `.chain` — no new colours, radii, or nav system. Employer nav is exactly Overview / Teams / Insights.

## Run
```bash
npm run dev            # http://127.0.0.1:3000  -> "Northstar ↗" chip (top right) or /employer-dashboard/
npm test               # 21 tests (11 personal + 10 employer)
npm run check
```
Static hosting also works: `employer.js` falls back to the shared in-browser employer engine (`src/employer/engine.js`) with localStorage, same as the personal app.

## How it works
- **Backend:** `src/employer/engine.js` (shared domain) + typed routes in `server/server.js` under `/api/employer/*`; Supabase schema in `supabase/migrations/202610260002_employer_dashboard.sql` (organisations, members/roles, teams, memberships, consents, aggregates, goals, employer_interventions, outcomes, employer_ai_runs) with membership-gated RLS. Employer clients never touch personal tables.
- **Privacy boundary:** individual synthetic permitted signals → consent filter → cohort suppression (`MIN_COHORT_SIZE=5`, suppressed = `value:null` + "Not enough data to show this insight privately.") → aggregation → baselines. Forbidden categories (sleep, health, recovery, medical, conversations, personal goals, relationships, AI interactions) are never aggregated or sent to reasoning.
- **Permissions (server-side):** actor via `x-actor-id` header. owner/admin manage, manager only own teams, viewer read-only, non-member 403. Organisation isolation enforced on every route.
- **Reasoning:** `compileEmployerContext` (aggregates only) → deterministic rules (`evaluateEmployerRules`) → validated `EmployerReasoningResult`. AI never mutates state; interventions only change via employer approve/dismiss.
- **Team detail (full-screen):** tapping a team opens a full-screen experience (not a sheet) with 3 top tabs — **Overview** (state, metrics, signals, suggested response, interventions), **Members** (every member: avatar, name, role, sharing status), **Trends** (deterministic 7-day aggregate series per metric + intervention outcomes). Back/Escape returns to Teams.
- **Teams roster:** every team card shows a member avatar stack (initials) + member count; the team sheet lists every member with avatar, name, job role, team and aggregate-sharing status. Roster is directory info only — a test (`team roster…`) asserts no signal values/keys ever leak into it.
- **Demo flow (60–90s):** Personal → Northstar ↗ → Overview (Stable/Watch, 82%-style capacity line) → Teams → Product sheet → Insights (meeting density → focus) → Review proposed intervention → Approve (active) → completed outcome (focus fragmentation 31% → 21%). "Simulate: meeting density rises" regenerates signal→insight→proposed intervention. Reset restores personal + employer state. Organisation switcher (top-left wordmark) doubles as demo actor switcher for permission testing.

## Programmes

The **Programmes** tab (fourth item in the liquid dock) groups longer-running initiatives by goal, participating teams and linked interventions, with aggregate progress, outcomes, and Activate/Pause/Complete (managers and above). Viewers are read-only. API: `GET /api/employer/programmes`, `POST /api/employer/programmes/:id`.

## Live mode (aligned with the main app backend)

Employer routes share the main app's auth and project split:

- `DEMO_MODE=true`: in-memory seed + demo actors (unchanged demo behaviour).
- `DEMO_MODE=false`: every employer request requires the main app's Supabase
  access token. The actor (role + team scope) is derived from
  `organisation_members` / `team_memberships` in the SYSTEM project — client
  supplied actor/org/role values are ignored. Aggregates come only from
  `team_signal_aggregates` (bridge-gated); interventions, programmes and
  employer AI runs persist through `src/employer/repository.js`.
  Scenario/reset are demo-only and return 403 live.

One-time bootstrap (service keys stay server-side):

```bash
node scripts/bootstrap-employer.mjs --email=you@company.com --role=owner
# then in .env: DEMO_MODE=false, restart the server, sign in, open /employer-dashboard/
```

Find your auth user UUID in the USER Supabase project → Authentication → Users.
