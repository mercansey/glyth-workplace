-- Glyth Workplace bridge — SYSTEM CONTEXT project only (hackathon, clean-room).
-- Apply to the SYSTEM project (with 202610260002). Never production Glyth.
-- Stores pseudonymised contributions + cohort aggregates + outbound
-- directives. No raw user_id, names, sleep/health/personal data — enforced
-- in the bridge (src/bridge/bridge.js) and re-checked by constraints below.
create extension if not exists pgcrypto;

create table public.bridge_contributions (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  participant_alias text not null,
  org_id text not null,
  team_id text not null,
  category text not null check (category in ('workload','meeting_density','focus_fragmentation','engagement','capacity','schedule_density')),
  value int not null check (value between 0 and 100),
  day date not null default current_date,
  created_at timestamptz default now()
);
create index bridge_contrib_team_cat_idx on public.bridge_contributions(team_id, category, day desc);

-- Cohort aggregates released for employer views (already suppression-gated).
create table public.bridge_aggregates (
  id uuid primary key default gen_random_uuid(),
  org_id text not null,
  team_id text not null,
  category text not null,
  participant_count int not null,
  value int,
  suppressed boolean not null default false,
  computed_at timestamptz default now(),
  unique (team_id, category, computed_at)
);

-- System -> User directives waiting for the bridge to deliver.
create table public.bridge_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_id text,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);

-- Acknowledgements / outcomes returning from the user project.
create table public.bridge_inbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_id text,
  org_id text,
  status text,
  metric text,
  result text,
  payload jsonb default '{}',
  created_at timestamptz default now()
);

create table public.bridge_sync_log (
  id uuid primary key default gen_random_uuid(),
  direction text not null,
  contributions int default 0,
  released int default 0,
  suppressed int default 0,
  directives int default 0,
  status text not null default 'ok',
  error text,
  created_at timestamptz default now()
);

alter table public.bridge_contributions enable row level security;
alter table public.bridge_aggregates enable row level security;
alter table public.bridge_outbox enable row level security;
alter table public.bridge_inbox enable row level security;
alter table public.bridge_sync_log enable row level security;
-- Intentionally no anon/authenticated policies: service-role bridge only.
-- Employer-facing reads continue through team_signal_aggregates + RLS (002).
