-- Canonical pipelines: provider provenance on signals, baselines, sync state.
alter table public.signals add column if not exists unit text;
alter table public.signals add column if not exists observed_at timestamptz;
alter table public.signals add column if not exists period_start timestamptz;
alter table public.signals add column if not exists period_end timestamptz;
alter table public.signals add column if not exists source_external_id text;
alter table public.signals add column if not exists confidence numeric;
create unique index if not exists signals_provider_external_uidx on public.signals(user_id, source, source_external_id) where source_external_id is not null;
create index if not exists signals_user_type_observed_idx on public.signals(user_id, type, observed_at desc);

create table if not exists public.user_baselines (
  user_id uuid not null, metric text not null, value numeric, sample_count int not null default 0,
  window_start date, window_end date, calculated_at timestamptz default now(),
  primary key (user_id, metric)
);
alter table public.user_baselines enable row level security;
create policy "owner baselines" on public.user_baselines for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(), user_id uuid not null, provider text not null, kind text not null,
  status text not null default 'disconnected', last_sync_at timestamptz, last_success_at timestamptz, last_error text,
  created_at timestamptz default now(), updated_at timestamptz default now(), unique (user_id, provider, kind)
);
alter table public.provider_connections enable row level security;
create policy "owner connections" on public.provider_connections for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

alter table public.calendar_events add column if not exists provider_event_id text;
create unique index if not exists calendar_provider_event_uidx on public.calendar_events(user_id, provider, provider_event_id) where provider_event_id is not null;
create index if not exists insights_user_type_idx on public.insights(user_id, created_at desc);

alter table public.insights add column if not exists type text not null default 'general';
alter table public.interventions add column if not exists outcome_status text;
alter table public.ai_runs add column if not exists context_version int;
