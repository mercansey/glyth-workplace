-- Fitness MVP: canonical library (shared, read-only) + owner-only sessions.
create table if not exists public.exercise_library (
  id text primary key, slug text not null unique, name text not null, category text not null,
  pattern text, equipment text[] not null default '{}', active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.workout_templates (
  id text primary key, slug text not null unique, title text not null, goal text, type text,
  estimated_duration int, difficulty text, equipment text[] not null default '{}', active boolean not null default true, created_at timestamptz default now()
);
create table if not exists public.workout_template_exercises (
  workout_id text not null references public.workout_templates(id) on delete cascade,
  exercise_id text not null references public.exercise_library(id), ord int not null,
  sets int not null, reps int, duration_seconds int, rest_seconds int, intensity_target text,
  primary key (workout_id, exercise_id)
);
create table if not exists public.workout_sessions (
  id text primary key, user_id uuid not null, template_id text, plan_item_id text, title text not null,
  type text, goal text, status text not null default 'planned' check (status in ('planned','in_progress','completed','abandoned')),
  planned_duration int, actual_duration int, adaptation_status text, adaptation_reason text,
  exercises jsonb not null default '[]', feedback text check (feedback in ('too_easy','about_right','too_hard')),
  rpe int, actual_load int, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz default now(), updated_at timestamptz default now()
);
create index if not exists workout_sessions_user_created_idx on public.workout_sessions(user_id, created_at desc);
insert into public.exercise_library (id, slug, name, category, pattern, equipment) values
 ('ex_bodyweight_squat','bodyweight-squat','Bodyweight Squat','squat','squat','{bodyweight}'),
 ('ex_goblet_squat','goblet-squat','Goblet Squat','squat','squat','{dumbbells}'),
 ('ex_romanian_deadlift','romanian-deadlift','Romanian Deadlift','hinge','hinge','{dumbbells,barbell}'),
 ('ex_push_up','push-up','Push-Up','push','horizontal_push','{bodyweight}'),
 ('ex_bench_press','bench-press','Dumbbell Bench Press','push','horizontal_push','{dumbbells,bench}'),
 ('ex_dumbbell_row','dumbbell-row','Dumbbell Row','pull','horizontal_pull','{dumbbells,bench}'),
 ('ex_farmer_carry','farmer-carry','Farmer Carry','carry','carry','{dumbbells,kettlebell}'),
 ('ex_dead_bug','dead-bug','Dead Bug','core','core','{bodyweight}'),
 ('ex_plank','plank','Plank','core','core','{bodyweight}'),
 ('ex_cat_cow','cat-cow','Cat-Cow','mobility','mobility','{bodyweight}')
on conflict (id) do nothing;
insert into public.workout_templates (id, slug, title, goal, type, estimated_duration, difficulty, equipment) values
 ('wt_upper_strength','upper-strength','Upper Body Strength','strength','strength',42,'moderate','{dumbbells,bench,bodyweight}'),
 ('wt_lower_strength','lower-strength','Lower Body Strength','strength','strength',55,'hard','{dumbbells,barbell,bodyweight}'),
 ('wt_full_body','full-body-strength','Full Body Strength','general_fitness','strength',45,'moderate','{dumbbells,bench,bodyweight}'),
 ('wt_short_full_body','short-full-body','Short Full Body','general_fitness','strength',25,'moderate','{dumbbells,bodyweight}'),
 ('wt_conditioning','conditioning','Conditioning','conditioning','conditioning',30,'moderate','{bike,rower,bodyweight}'),
 ('wt_recovery','recovery-mobility','Recovery / Mobility','recovery_maintain','recovery',30,'easy','{bodyweight}')
on conflict (id) do nothing;
alter table public.exercise_library enable row level security;
alter table public.workout_templates enable row level security;
alter table public.workout_template_exercises enable row level security;
alter table public.workout_sessions enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename='exercise_library' and policyname='authenticated read exercises') then
    create policy "authenticated read exercises" on public.exercise_library for select using (auth.role() in ('authenticated','anon'));
  end if;
  if not exists (select 1 from pg_policies where tablename='workout_templates' and policyname='authenticated read templates') then
    create policy "authenticated read templates" on public.workout_templates for select using (auth.role() in ('authenticated','anon'));
  end if;
  if not exists (select 1 from pg_policies where tablename='workout_template_exercises' and policyname='authenticated read template exercises') then
    create policy "authenticated read template exercises" on public.workout_template_exercises for select using (auth.role() in ('authenticated','anon'));
  end if;
  if not exists (select 1 from pg_policies where tablename='workout_sessions' and policyname='owner workout sessions') then
    create policy "owner workout sessions" on public.workout_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
  end if;
end $$;
