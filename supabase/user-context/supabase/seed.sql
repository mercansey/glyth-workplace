-- Glyth Snapshot seed (hackathon, clean-room) — idempotent.
-- Creates the starter day for a fixed demo auth placeholder UUID below.
-- To attach this day to a real demo account instead, replace the UUID with
-- that account's auth user id before running. Safe to run twice: every row
-- uses a deterministic id / unique key with ON CONFLICT DO NOTHING.
-- Baselines: sleep 7h15 (435m), recovery 72. Plan: 07:30 heavy strength,
-- 10:00 deep work, 12:30 lunch, 14:00 investor meeting (critical), 17:00 admin.
do $$
declare demo_user uuid := '00000000-0000-4000-8000-000000000001';
begin
  insert into public.profiles (user_id, display_name, timezone, wake_time)
  values (demo_user, null, 'Europe/London', '06:30')
  on conflict (user_id) do nothing;

  insert into public.goals (id, user_id, name, category, priority, target, status, progress) values
    ('00000000-0000-4000-8000-000000000101', demo_user, 'Improve strength', 'Health', 1, '4 sessions / week', 'active', 68),
    ('00000000-0000-4000-8000-000000000102', demo_user, 'Protect work performance', 'Work', 1, '2 protected focus blocks / day', 'active', 74),
    ('00000000-0000-4000-8000-000000000103', demo_user, 'Improve recovery consistency', 'Health', 2, 'Recovery >= 65 on 5 days / week', 'active', 52)
  on conflict (id) do nothing;

  insert into public.routines (id, user_id, wake_time, training_time, deep_work_time, admin_time)
  values ('00000000-0000-4000-8000-000000000110', demo_user, '06:30', '07:30', '10:00', '17:00')
  on conflict (id) do nothing;

  insert into public.daily_states (id, user_id, day, sleep_minutes, sleep_quality, recovery, energy, workload, training_load, stress, readiness)
  values ('00000000-0000-4000-8000-000000000120', demo_user, current_date, 435, 78, 72, 74, 55, 45, 38, 74)
  on conflict (user_id, day) do nothing;

  insert into public.daily_plan_items (id, user_id, day, starts_at, title, type, priority, duration_min, status, note) values
    ('00000000-0000-4000-8000-000000000131', demo_user, current_date, '07:30', 'Heavy strength session', 'training', 'high', 60, 'unchanged', 'Week 6, lower body'),
    ('00000000-0000-4000-8000-000000000132', demo_user, current_date, '10:00', 'Deep work', 'work', 'high', 120, 'unchanged', 'Investor deck draft'),
    ('00000000-0000-4000-8000-000000000133', demo_user, current_date, '12:30', 'Lunch', 'meal', 'medium', 45, 'unchanged', ''),
    ('00000000-0000-4000-8000-000000000134', demo_user, current_date, '14:00', 'Investor meeting', 'meeting', 'critical', 60, 'unchanged', 'High-value. Do not move.'),
    ('00000000-0000-4000-8000-000000000135', demo_user, current_date, '17:00', 'Admin', 'admin', 'low', 45, 'unchanged', 'Email, expenses, scheduling')
  on conflict (id) do nothing;

  insert into public.signals (id, user_id, type, value, baseline, source, kind) values
    ('00000000-0000-4000-8000-000000000141', demo_user, 'sleep', '435', '435', 'demo', 'observed'),
    ('00000000-0000-4000-8000-000000000142', demo_user, 'recovery', '72', '72', 'demo', 'observed')
  on conflict (id) do nothing;
end $$;
