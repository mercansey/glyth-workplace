-- Backend hardening: lookup indexes for user-scoped query paths.
-- RLS already enabled in 202610260001; these only add access paths.
create index if not exists insights_user_created_idx on public.insights(user_id, created_at desc);
create index if not exists ai_runs_user_created_idx on public.ai_runs(user_id, created_at desc);
create index if not exists scenario_runs_user_created_idx on public.scenario_runs(user_id, created_at desc);
create index if not exists interventions_user_created_idx on public.interventions(user_id, created_at desc);
create index if not exists messages_thread_created_idx on public.conversation_messages(thread_id, created_at);
create index if not exists goals_user_status_idx on public.goals(user_id, status);
-- Data integrity guards that match application-level invariants.
alter table public.goals add constraint goals_progress_range check (progress between 0 and 100);
alter table public.recommendations add constraint recommendations_confidence_range check (confidence is null or (confidence >= 0 and confidence <= 1));
