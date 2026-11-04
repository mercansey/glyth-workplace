# Glyth Workplace — Supabase Bridge

Two dedicated **hackathon** Supabase projects (never production Glyth). The Node
server is the only bridge between them and the only holder of service-role keys.

| Project | Holds | Migrations |
|---|---|---|
| **User Context** | personal data: profiles, goals, routines, signals, daily states, plans, insights, conversations | `202610260001`, `202610270003` |
| **System Context** | workplace data: organisations, teams, consents, cohort aggregates, employer insights/interventions | `202610260002`, `202610270004` |

## What crosses the bridge

- **User → System:** pseudonymised work-pattern contributions only — the six
  categories `workload, meeting_density, focus_fragmentation, engagement,
  capacity, schedule_density` — and only where the user consented. Participants
  are identified by `participant_alias` (salted SHA-256, user project only).
  Data is released solely as cohort aggregates with **≥ 5 participants**
  (`MIN_COHORT_SIZE`); smaller cohorts are suppressed.
- **System → User:** approved workplace directives (`protect_focus`,
  `reduce_meetings`, …) into `bridge_inbox`, plus aggregate insights.
  Acknowledgements/outcomes flow back via `bridge_inbox` (system side).

**Never crosses:** sleep, health, recovery, energy, stress, goals, routines,
conversations, support usage, names, emails, raw `user_id`. Enforced in
`src/bridge/bridge.js` (`assertNoForbidden`, category allow-list) and by the
category CHECK constraints in migration 004.

## Pieces

- `src/bridge/bridge.js` — pure builders, pseudonyms, cohort gate, validation.
- `src/bridge/client.js` — env config, zero-dependency PostgREST client, `syncBridge`.
- `server/server.js` — `GET /api/bridge/status`, `POST /api/bridge/preview`,
  `POST /api/bridge/sync`. Unconfigured → demo sync over the in-memory seed.
- Bridge tables are RLS-enabled with **no** anon/authenticated policies:
  service-role (server) only. Idempotency keys make replays safe.

## Project layout (one CLI root per project)

- `supabase/user-context/` — migrations `202610260001` (personal schema) + `202610270003` (bridge)
- `supabase/system-context/` — migrations `202610260002` (workplace schema) + `202610270004` (bridge)

Keeping them in separate CLI roots means `supabase db push` can never apply
personal tables to the System project or workplace tables to the User project.

## Go live (projects named "user context" and "system context")

```bash
supabase login                              # once, in your terminal
node scripts/connect-supabase.mjs --apply   # find both projects by name,
                                            # write .env, link + push migrations
npm start                                   # restart the server
curl localhost:3000/api/bridge/status       # → mode: "live"
curl -X POST localhost:3000/api/bridge/sync # pushes contributions, pulls directives
```

`scripts/connect-supabase.mjs` (without `--apply`) only discovers the projects
and writes `.env`. Keys go only into the gitignored `.env` and are never printed.
