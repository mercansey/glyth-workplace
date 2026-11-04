-- Mindfulness MVP: canonical sessions (shared content) + owner-only activity.
create table if not exists public.mindfulness_sessions (
  id text primary key, slug text not null unique, type text not null, title text not null,
  description text, duration_seconds int not null, script jsonb, audio_url text, image_url text,
  generation_source text default 'canonical', generation_model text, version int not null default 1,
  active boolean not null default true, created_at timestamptz default now(), updated_at timestamptz default now()
);
create table if not exists public.mindfulness_activity (
  id text primary key, user_id uuid not null, session_id text not null references public.mindfulness_sessions(id),
  session_type text, recommendation_id text, started_at timestamptz not null default now(), completed_at timestamptz,
  duration_completed_seconds int default 0, status text not null default 'started' check (status in ('started','completed','abandoned')),
  post_state text check (post_state in ('lower','same','better')), created_at timestamptz default now()
);
create index if not exists mindfulness_activity_user_started_idx on public.mindfulness_activity(user_id, started_at desc);
insert into public.mindfulness_sessions (id, slug, type, title, description, duration_seconds) values
 ('ses_reset','reset','reset','Reset','Interrupt mental noise and settle attention.',180),
 ('ses_focus','focus','focus','Focus','Transition into a protected focus period.',300),
 ('ses_pre_meeting','pre-meeting','pre_meeting','Pre-Meeting','Settle before a high-priority meeting or presentation.',300),
 ('ses_decompress','decompress','decompress','Decompress','Transition out of elevated workload.',300),
 ('ses_recovery_pause','recovery-pause','recovery_pause','Recovery Pause','A low-stimulation pause when recovery is below baseline.',300),
 ('ses_wind_down','wind-down','wind_down','Wind Down','Support an evening transition toward rest.',600)
on conflict (id) do nothing;
alter table public.mindfulness_sessions enable row level security;
alter table public.mindfulness_activity enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='mindfulness_sessions' and policyname='authenticated read sessions') then
    create policy "authenticated read sessions" on public.mindfulness_sessions for select using (auth.role() = 'authenticated' or auth.role() = 'anon');
  end if;
  if not exists (select 1 from pg_policies where tablename='mindfulness_activity' and policyname='owner mindfulness activity') then
    create policy "owner mindfulness activity" on public.mindfulness_activity for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
-- Storage bucket for generated media (created once; assets under sessions/{id}/…)
insert into storage.buckets (id, name, public) values ('mindfulness-media','mindfulness-media', true) on conflict (id) do nothing;
