-- Durability cutover: reconcile application-generated ids with uuid PKs,
-- link orchestration lineage, and record job executions idempotently.
alter table public.goals add column if not exists client_ref text;
alter table public.daily_plan_items add column if not exists client_ref text;
alter table public.daily_plan_items add column if not exists source text;
alter table public.daily_plan_items add column if not exists movability text;
alter table public.recommendations add column if not exists client_ref text;
alter table public.recommendations add column if not exists run_id uuid;
alter table public.interventions add column if not exists client_ref text;
alter table public.interventions add column if not exists recommendation_id uuid references public.recommendations(id) on delete set null;
alter table public.ai_runs add column if not exists duration_ms int;
alter table public.ai_runs add column if not exists status text;
alter table public.ai_runs add column if not exists validation_status text;
alter table public.ai_runs add column if not exists context_version int;
alter table public.ai_runs add column if not exists scenario_id text;
create unique index if not exists goals_user_client_ref_uidx on public.goals(user_id, client_ref) where client_ref is not null;
create unique index if not exists plan_user_client_ref_uidx on public.daily_plan_items(user_id, client_ref) where client_ref is not null;
create unique index if not exists rec_user_client_ref_uidx on public.recommendations(user_id, client_ref) where client_ref is not null;
create unique index if not exists int_user_client_ref_uidx on public.interventions(user_id, client_ref) where client_ref is not null;
create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, job text not null check (job in ('morning','nightly','weekly')),
  local_date date not null, status text not null default 'completed', created_at timestamptz default now(), unique (user_id, job, local_date)
);
alter table public.job_runs enable row level security;
create policy "owner job runs" on public.job_runs for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index if not exists job_runs_user_job_date_idx on public.job_runs(user_id, job, local_date desc);

alter table public.calendar_events add column if not exists movability text;
alter table public.calendar_events add column if not exists status text not null default 'confirmed';
alter table public.calendar_events add column if not exists duration_min int;
