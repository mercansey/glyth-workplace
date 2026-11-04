-- Employer programmes: longer-running initiatives linking goals, teams and interventions.
create table if not exists public.employer_programmes (
  id text primary key, org_id text not null, goal_id text, team_ids text[] not null default '{}',
  title text not null, description text, status text not null default 'proposed' check (status in ('proposed','active','paused','completed')),
  progress int not null default 0 check (progress between 0 and 100), target text, intervention_ids text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.employer_programmes enable row level security;
drop policy if exists programmes_read_members on public.employer_programmes;
create policy programmes_read_members on public.employer_programmes for select using (exists (select 1 from public.organisations o join public.organisation_members m on m.organisation_id = o.id where o.slug = employer_programmes.org_id and m.user_id = auth.uid()));
drop policy if exists programmes_update_managers on public.employer_programmes;
create policy programmes_update_managers on public.employer_programmes for update using (exists (select 1 from public.organisations o join public.organisation_members m on m.organisation_id = o.id where o.slug = employer_programmes.org_id and m.user_id = auth.uid() and m.role in ('owner','admin','manager')));
