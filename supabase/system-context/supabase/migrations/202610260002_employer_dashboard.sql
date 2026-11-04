-- Glyth Snapshot employer dashboard (hackathon, clean-room) — dedicated project only.
-- Privacy: employer clients never query individual tables; aggregates + RLS below.
create extension if not exists pgcrypto;
create table public.organisations (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, created_at timestamptz default now(), updated_at timestamptz default now());
create table public.organisation_members (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade, user_id uuid not null, role text not null check (role in ('owner','admin','manager','viewer')), created_at timestamptz default now(), unique(organisation_id,user_id));
create table public.teams (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade, name text not null, description text, created_at timestamptz default now());
create table public.team_memberships (id uuid primary key default gen_random_uuid(), team_id uuid not null references public.teams(id) on delete cascade, user_id uuid not null, created_at timestamptz default now(), unique(team_id,user_id));
create table public.data_consents (id uuid primary key default gen_random_uuid(), user_id uuid not null, organisation_id uuid not null references public.organisations(id) on delete cascade, signal_category text not null, allowed boolean not null default true, granted_at timestamptz default now(), revoked_at timestamptz, unique(user_id,organisation_id,signal_category));
create table public.team_signal_aggregates (id uuid primary key default gen_random_uuid(), organisation_id uuid not null, team_id uuid not null references public.teams(id) on delete cascade, signal_type text not null, period_start date, period_end date, value numeric, baseline numeric, change_percent numeric, participant_count int not null default 0, suppressed boolean not null default false, created_at timestamptz default now());
create table public.organisation_goals (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade, title text not null, description text, category text, priority int default 2, target text, current_value numeric, status text default 'active', created_at timestamptz default now());
create table public.employer_insights (id uuid primary key default gen_random_uuid(), organisation_id uuid not null, headline text, body text, evidence jsonb default '[]', reasoning jsonb, created_at timestamptz default now());
-- NB: personal `interventions` table (migration 001, user_id) is personal-only; employer interventions are separate.
create table public.employer_interventions (id uuid primary key default gen_random_uuid(), organisation_id uuid not null references public.organisations(id) on delete cascade, team_id uuid references public.teams(id), type text, title text not null, description text, reason text, evidence jsonb default '[]', status text not null default 'proposed' check (status in ('proposed','approved','active','completed','dismissed')), created_by uuid, started_at timestamptz, completed_at timestamptz, expected_outcome text, observed_outcome jsonb, created_at timestamptz default now());
create table public.intervention_outcomes (id uuid primary key default gen_random_uuid(), intervention_id uuid not null references public.employer_interventions(id) on delete cascade, organisation_id uuid not null, metric text, before_value numeric, after_value numeric, result text, confidence text, created_at timestamptz default now());
create table public.employer_ai_runs (id uuid primary key default gen_random_uuid(), organisation_id uuid, provider text, model text, latency_ms int, validated boolean, fallback boolean default false, created_at timestamptz default now());
create index team_agg_org_idx on public.team_signal_aggregates(organisation_id, team_id);
create index emp_int_org_status_idx on public.employer_interventions(organisation_id, status);
-- RLS: membership-gated. Helper: is member / can manage.
alter table public.organisations enable row level security;
alter table public.organisation_members enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.data_consents enable row level security;
alter table public.team_signal_aggregates enable row level security;
alter table public.organisation_goals enable row level security;
alter table public.employer_insights enable row level security;
alter table public.employer_interventions enable row level security;
alter table public.intervention_outcomes enable row level security;
alter table public.employer_ai_runs enable row level security;
create policy "org member read" on public.organisations for select using (exists (select 1 from public.organisation_members m where m.organisation_id=id and m.user_id=auth.uid()));
create policy "member read own membership" on public.organisation_members for select using (user_id=auth.uid() or exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
create policy "org member read teams" on public.teams for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "team membership self" on public.team_memberships for select using (user_id=auth.uid() or exists (select 1 from public.organisation_members m join public.teams t on t.organisation_id=m.organisation_id where t.id=team_id and m.user_id=auth.uid() and m.role in ('owner','admin','manager')));
create policy "consent owner all" on public.data_consents for all using (auth.uid()=user_id) with check (auth.uid()=user_id);
-- Aggregates are only readable by org members AND only when not suppressed (cohort >=5 enforced at write/aggregation time).
create policy "org member read aggregates" on public.team_signal_aggregates for select using (suppressed=false and exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "org member read goals" on public.organisation_goals for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "org member read insights" on public.employer_insights for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "org member read interventions" on public.employer_interventions for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "managers manage interventions" on public.employer_interventions for update using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid() and m.role in ('owner','admin','manager'))) with check (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid() and m.role in ('owner','admin','manager')));
create policy "org member read outcomes" on public.intervention_outcomes for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid()));
create policy "org admin read ai runs" on public.employer_ai_runs for select using (exists (select 1 from public.organisation_members m where m.organisation_id=organisation_id and m.user_id=auth.uid() and m.role in ('owner','admin')));
