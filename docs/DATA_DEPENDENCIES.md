# Data dependencies — what to build pipelines for

The application ships with **no mock user data**. Every item below previously
appeared as seeded/static content and now renders as an empty state until a
real pipeline supplies it. Build in the order listed: 1–4 unlock Today,
Insights and Ask Glyth; the rest unlock Progress/Support and Workplace.

| # | Dependency | Used by | Fields the app needs | Suggested source | Pipeline to build | Store |
|---|------------|---------|----------------------|------------------|---|---|
| 1 | Identity & profile | Greeting, avatar, FlowID, Settings | user id, display name, timezone, wake time | Supabase Auth (done) + profile row | Auth → `POST /api/auth/*` (exists) → upsert profile on sign-up/in (exists) | `profiles` |
| 2 | Sleep | Today state, readiness, rules, Why, Insights | sleep minutes, sleep quality, night date, consecutive below-baseline nights | Wearable (Apple Health / Google Fit / Oura / Whoop) | Device OAuth → nightly sync job → normalise to minutes/quality → baseline job (14-day median) | `signals` (type=sleep), `daily_states` |
| 3 | Recovery & energy | Today metrics, readiness, rules | recovery %, energy score, HRV/resting HR if derived | Wearable (same sync as #2) | Same nightly sync → score mapping per provider → write with sleep | `daily_states`, `signals` |
| 4 | Baselines | Every "vs baseline" comparison, deviations | sleep baseline, recovery baseline, energy baseline, sessions/week target | Derived from #2/#3 history | Rolling 14–28 day aggregation job per user, recomputed nightly; cold-start = null until 7 nights exist | Derived columns on read / `daily_states` |
| 5 | Calendar & commitments | Daily plan, critical-meeting protection | events (start, duration, title, priority/importance, movable?) | Google/Outlook Calendar (`CalendarProvider` interface exists) | Calendar OAuth → incremental sync → importance classifier (attendees/title rules + user pin) | `calendar_events` |
| 6 | Training plan & load | Plan item, training-load rule | scheduled sessions (type, time, intensity), completed load, yesterday's session | Training app / wearable workouts / manual plan | Workout sync → load model (duration × intensity) → today's scheduled session into plan | `daily_plan_items`, `signals` (training_load) |
| 7 | Workload & stress signals | Today metrics, workload rule | workload score, meeting density, focus fragmentation, stress proxy | Calendar density (#5) + self-report check-in | Nightly/morning aggregation from calendar + optional 1-tap check-in → scores 0–100 | `signals`, `daily_states` |
| 8 | Goals & routines | Focus priorities, Progress/Support goals, FlowID | goals (name, target, progress), wake/training/deep-work times | In-app goal setting (to build) or imported | Simple CRUD UI/API with user ownership (RLS exists) → progress computed from #6/#7 outcomes | `goals`, `routines` |
| 9 | Daily plan assembly | Today's timeline | ordered items from #5 + #6 + generated blocks | Glyth plan builder (server) | Morning job: merge calendar + training + protected focus + meals → plan items with status | `daily_plan_items` |
| 10 | Orchestration outputs | What changed, recommendations, Why | plan changes, recommendations, reasoning, confidence | Rule engine + Meta provider (both exist) | Persist each orchestration run + changed items + recommendation lifecycle (already modelled in engine) | `scenario_runs`→ real run table, `recommendations`, `ai_runs`, `insights` |
| 11 | History & trends | Insights calendar, trajectory, Progress | daily readiness/recovery history, priority completion, focus protection counts | Derived from #2/#3/#9 outcomes | Nightly roll-up per user → one row per day; completion from plan outcomes | `daily_states` + rollups |
| 12 | Intervention history | Insights/Support record | what Glyth changed, when, observed outcome | Orchestration log (#10) + outcome check | Write on accept/change; evaluate next-day outcome in nightly job | `interventions` |
| 13 | Weekly summary | Support | narrative summary of the week | Derived from #11/#12 | Weekly job summarising rollups (template or Meta with validated output) | `insights` (weekly kind) |
| 14 | Coaching & support directory | Support, Ask Glyth referrals | coach availability, support routes, programme catalogue | People team / coaching provider (content, not user data) | Content feed or admin CMS → publish directory; bookings stay with provider | Content tables / static config owned by People team |
| 15 | Workplace aggregates (employer view) | Employer dashboard | consented work-pattern categories only (workload, meeting density, focus fragmentation, engagement, capacity, schedule density) | Bridge (exists, tested) | Consent capture → pseudonymised contributions → cohort gate ≥5 → aggregates; never sleep/health/personal data | System project bridge tables (migrations exist) |
| 16 | Ask Glyth conversation | Ask Glyth | thread, messages, typed proposals (all exist in engine) | User input + current context (#2–#10) | Persist threads/messages per user with ownership (RLS exists); proposals stay typed + confirmed | `conversation_threads`, `conversation_messages` |

## Definition of done per pipeline
Authenticated user → consent/scope recorded → raw ingest stored → normalised
fields above written → baselines/jobs computed → API returns the user's own
rows only (RLS) → the empty state disappears because data exists, not because
anything was seeded.
