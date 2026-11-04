# Mindfulness MVP

Proposition: Glyth understands what is happening now and recommends the right short session — the user never searches a library.

Loop: context → current state → deterministic ranking (Meta optional) → guided session → recorded-audio player → completion → one-tap "Less settled / Same / More settled" → Today + Progress + future context.

Media (updated 2026-11-04): the library is now the 10 recorded guided voice sessions in `assets/meditations/` (each 3 minutes), replacing the scripted canonical sessions and device text-to-speech. Each recording is tagged with a ranking type (`reset`, `focus`, `pre_meeting`, `decompress`, `recovery_pause`, `wind_down`) so the deterministic hero recommendation, Today actions and the library all play real audio. There is no transcript for the recordings; the player is audio-only and never substitutes a device voice for them. The script validator remains for admin-generated drafts only.

## Audit matrix (pre-build)

| Capability | Existed | Reused | Missing → Action |
|---|---|---|---|
| Mindfulness placeholder | Support card + sheet text, Ask canned reply | Card as entry point | Built full module behind it |
| Routes / views | Today/Insights/Support, Liquid Glass dock, sheets | `switchView`, `.glass`, `.btn`, sheet primitives | Added `view-mindfulness` + player overlay, no new design system |
| Meta provider | `MetaReasoningProvider` (`muse-spark-1.1`, `/chat/completions`) | Server-side `POST /api/mindfulness/recommend` enrichment + admin script generation, validated | No image/audio model configured → providers report `configured:false` |
| Context compiler | `compileContext`, signals/daily_states/goals/plan | New `compileMindfulnessContext` (relevant slice only) | — |
| Orchestration | `orchestrate()` → recommendations/interventions | Mindfulness emitted as typed action `mindfulness_session`; completion marks it executed | — |
| Persistence | Demo in-memory + Supabase repository (RLS) | Repository load/save for `mindfulness_activity` (guarded pre-migration) | Migration `202611030010_mindfulness.sql`: `mindfulness_sessions` (read) + `mindfulness_activity` (owner-only RLS) + `mindfulness-media` bucket |
| Audio | None | Web Speech on web; `AVSpeechSynthesizer` via existing GlythNative Capacitor plugin on iOS | Generated audio only if a verified Meta endpoint/model is configured — none was, none is claimed |
| Artwork | None | Abstract gradients in the existing palette | Muse Image only via `META_IMAGE_MODEL` after capability discovery — not set, so gradients ship |

## Database status

Migration `202611030010_mindfulness.sql` applied to the User Context project and verified 2026-11-03: 6 canonical sessions seeded (reset 180s; focus, pre-meeting, decompress, recovery-pause 300s; wind-down 600s), RLS enabled on both mindfulness tables, `mindfulness-media` bucket present. Applied via `psql` directly, so it is not recorded in `supabase_migrations.schema_migrations`; re-running is safe (idempotent).

## Running

Same server (`node server/server.js`). Demo hero: apply Poor Sleep (meeting day), open Support → Mindfulness (or the Today "Prepare" card), Start, `?demoSeek=1` adds an internal jump-near-end control, complete, choose "More settled", Today shows the action completed and Progress (Support) counts the session.

Media generation (admin): `POST /api/admin/mindfulness/generate {session, idempotency_key:"<slug>:v<version>"}` — Meta script draft is schema- and safety-validated and never overwrites the canonical session automatically. Partial failure leaves canonical media live.
