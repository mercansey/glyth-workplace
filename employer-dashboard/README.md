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
- **Teams roster:** every team card shows a member avatar stack (initials) + member count; the team sheet lists every member with avatar, name, job role, team and aggregate-sharing status. Roster is directory info only — a test (`team roster…`) asserts no signal values/keys ever leak into it.
- **Demo flow (60–90s):** Personal → Northstar ↗ → Overview (Stable/Watch, 82%-style capacity line) → Teams → Product sheet → Insights (meeting density → focus) → Review proposed intervention → Approve (active) → completed outcome (focus fragmentation 31% → 21%). "Simulate: meeting density rises" regenerates signal→insight→proposed intervention. Reset restores personal + employer state. Organisation switcher (top-left wordmark) doubles as demo actor switcher for permission testing.
