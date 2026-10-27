-- Glyth Snapshot (hackathon, clean-room) — dedicated project only.
-- Never apply to production Glyth. All user tables: user_id + RLS.
create extension if not exists pgcrypto;
create table public.profiles (id uuid primary key default gen_random_uuid(), user_id uuid not null unique, display_name text, timezone text default 'Europe/London', wake_time time, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.goals (id uuid primary key default gen_random_uuid(), user_id uuid not null, name text not null, category text, priority int default 2, target text, status text default 'active', progress int default 0, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.routines (id uuid primary key default gen_random_uuid(), user_id uuid not null, wake_time time, training_time time, deep_work_time time, admin_time time, created_at timestamptz default now());
create table public.signals (id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null, value jsonb, baseline jsonb, source text, kind text check (kind in ('observed','inferred','correlated','heuristic')), created_at timestamptz default now());
create table public.daily_states (id uuid primary key default gen_random_uuid(), user_id uuid not null, day date not null, sleep_minutes int, sleep_quality int, recovery int, energy int, workload int, training_load int, stress int, readiness int, unique(user_id, day), created_at timestamptz default now());
create table public.calendar_events (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text, starts_at timestamptz, ends_at timestamptz, priority text, provider text default 'local', external_id text, created_at timestamptz default now());
create table public.daily_plan_items (id uuid primary key default gen_random_uuid(), user_id uuid not null, day date not null, starts_at time, title text, type text, priority text, duration_min int, status text default 'unchanged', note text, original jsonb, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.insights (id uuid primary key default gen_random_uuid(), user_id uuid not null, headline text, body text, chain jsonb default '[]', created_at timestamptz default now());
create table public.recommendations (id uuid primary key default gen_random_uuid(), user_id uuid not null, category text, title text, rationale text, evidence jsonb default '[]', action jsonb, priority text, confidence numeric, status text default 'proposed' check (status in ('proposed','accepted','rejected','modified','executed')), kind text, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.interventions (id uuid primary key default gen_random_uuid(), user_id uuid not null, title text, outcome text, kind text, created_at timestamptz default now());
create table public.scenario_runs (id uuid primary key default gen_random_uuid(), user_id uuid not null, scenario text, before_state jsonb, after_state jsonb, reasoning jsonb, created_at timestamptz default now());
create table public.ai_runs (id uuid primary key default gen_random_uuid(), user_id uuid, provider text, model text, latency_ms int, validated boolean, fallback boolean default false, created_at timestamptz default now());
create table public.conversation_threads (id uuid primary key default gen_random_uuid(), user_id uuid not null, created_at timestamptz default now());
create table public.conversation_messages (id uuid primary key default gen_random_uuid(), thread_id uuid references public.conversation_threads(id) on delete cascade, user_id uuid not null, role text, content text, proposal jsonb, created_at timestamptz default now());
create index signals_user_created_idx on public.signals(user_id, created_at desc);
create index plan_user_day_idx on public.daily_plan_items(user_id, day);
create index rec_user_status_idx on public.recommendations(user_id, status);
-- RLS: owner-only on every user table
do $$ declare t text; begin for t in select unnest(array['profiles','goals','routines','signals','daily_states','calendar_events','daily_plan_items','insights','recommendations','interventions','scenario_runs','ai_runs','conversation_threads','conversation_messages']) loop
  execute format('alter table public.%I enable row level security', t);
  execute format('create policy "owner all" on public.%I for all using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
end loop; end $$;
