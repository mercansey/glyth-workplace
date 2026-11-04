-- Glyth Workplace bridge — USER CONTEXT project only (hackathon, clean-room).
-- Apply to the USER project (with 202610260001). Never production Glyth.
-- Bridge tables are service-role only: RLS enabled, NO anon/authenticated
-- policies, so only the Node bridge server (service role) can read/write them.
create extension if not exists pgcrypto;

-- Pseudonym mapping stays inside the user project; participant_alias is the
-- only identifier that may cross to the system project.
create table public.bridge_identities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  org_id text not null,
  team_id text,
  participant_alias text not null,
  created_at timestamptz default now(),
  unique (user_id, org_id),
  unique (participant_alias)
);

-- Consent for the six work-pattern categories, owned by the user.
create table public.work_pattern_consents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  category text not null check (category in ('workload','meeting_density','focus_fragmentation','engagement','capacity','schedule_density')),
  granted boolean not null default false,
  updated_at timestamptz default now(),
  unique (user_id, category)
);

create table public.bridge_outbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  direction text not null default 'user_to_system',
  kind text not null check (kind in ('contribution','outcome_ack')),
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','sent','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz default now(),
  sent_at timestamptz
);

create table public.bridge_inbox (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  source_id text,
  org_id text,
  team_id text,
  type text,
  title text,
  description text,
  effective_day date,
  payload jsonb default '{}',
  status text not null default 'received' check (status in ('received','applied','acknowledged','declined')),
  created_at timestamptz default now(),
  applied_at timestamptz
);

create index bridge_outbox_status_idx on public.bridge_outbox(status, created_at);
create index bridge_inbox_status_idx on public.bridge_inbox(status, created_at desc);

alter table public.bridge_identities enable row level security;
alter table public.bridge_outbox enable row level security;
alter table public.bridge_inbox enable row level security;
-- work_pattern_consents is user-owned: owner-only policy.
alter table public.work_pattern_consents enable row level security;
create policy "owner consents" on public.work_pattern_consents
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
-- bridge_identities / bridge_outbox / bridge_inbox: intentionally no policies.
-- Only the service role (bridge server) bypasses RLS; browsers get nothing.
