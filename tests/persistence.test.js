import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js';
import { createRepository, createPostgrestClient } from '../src/data/repository.js';
import { ingestHealthBatch, deriveDailyState } from '../src/data/canonical.js';
import { ingestCalendarBatch } from '../src/data/calendar.js';
import { ingestWorkouts, trainingSummary } from '../src/data/training.js';
import { assembleDailyPlan } from '../src/data/plan.js';
import { recalculateBaselines } from '../src/data/baselines.js';
import { usersDueForJob } from '../src/data/jobs.js';
import { createFixtureState } from './fixture.js';

// In-memory PostgREST-shaped double. It is bound to one auth user and, like
// RLS, only ever returns or accepts that user's rows.
function fakeDb() { return { tables: new Map(), seq: 0 }; }
function fakeClient(db, authUid) {
  const rows = (t) => { if (!db.tables.has(t)) db.tables.set(t, []); return db.tables.get(t); };
  const visible = (t, r) => r.user_id === undefined || r.user_id === authUid;
  const stamp = (r) => ({ id: `db_${++db.seq}`, created_at: new Date(Date.now() + db.seq).toISOString(), ...r });
  return {
    async select(t, { filters = {}, limit } = {}) { let out = rows(t).filter(r => visible(t, r) && Object.entries(filters).every(([k, v]) => String(r[k]) === String(v))); if (limit) out = out.slice(0, limit); return structuredClone(out); },
    async insert(t, rs) { for (const r of rs) if (r.user_id && r.user_id !== authUid) throw new Error('RLS: insert denied'); const made = rs.map(stamp); rows(t).push(...made); return structuredClone(made); },
    async upsert(t, rs, conflict) { const keys = conflict.split(','); const out = [];
      for (const r of rs) { if (r.user_id && r.user_id !== authUid) throw new Error('RLS: upsert denied'); const i = rows(t).findIndex(x => keys.every(k => String(x[k]) === String(r[k]))); if (i >= 0) { rows(t)[i] = { ...rows(t)[i], ...r }; out.push(rows(t)[i]); } else { const m = stamp(r); rows(t).push(m); out.push(m); } }
      return structuredClone(out); },
    async update(t, filters, patch) { const hit = rows(t).filter(r => visible(t, r) && Object.entries(filters).every(([k, v]) => String(r[k]) === String(v))); hit.forEach(r => Object.assign(r, patch)); return structuredClone(hit); },
    async delete(t, filters) { db.tables.set(t, rows(t).filter(r => !(visible(t, r) && Object.entries(filters).every(([k, v]) => String(r[k]) === String(v))))); return null; },
  };
}
const userA = { id: 'user-a', name: 'A' }, userB = { id: 'user-b', name: 'B' };
const sleep = (date, min, id) => ({ signal_type: 'sleep', value: min, quality: 70, source_external_id: id, period_start: `${date}T23:10:00Z`, period_end: `${date}T06:30:00Z`, observed_at: `${date}T06:30:00Z` });

test('PostgREST client is session-bound: anon key + user token, never a service key', async () => {
  let seen; const client = createPostgrestClient({ url: 'https://db.example', anonKey: 'anon-public', accessToken: 'user-token', fetchImpl: async (url, opts) => { seen = { url, opts }; return { ok: true, text: async () => '[]' }; } });
  await client.select('signals', { filters: { user_id: 'user-a' } });
  assert.equal(seen.opts.headers.Authorization, 'Bearer user-token'); assert.equal(seen.opts.headers.apikey, 'anon-public');
  assert.ok(!JSON.stringify(seen).includes('service'));
});

test('restart recovery: ingest -> plan -> orchestrate -> accept -> ask, then a fresh load keeps everything', async () => {
  const db = fakeDb(); const repo = createRepository(fakeClient(db, userA.id));
  const s = E.createSeedState();
  const todayStr = new Date().toISOString().slice(0, 10);
  for (let i = 7; i >= 1; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    ingestHealthBatch(s, [sleep(d, 435, `b_${i}`), { signal_type: 'recovery', value: 72, source_external_id: `r_${i}`, observed_at: `${d}T06:35:00Z` }], { provider: 'oura' }); deriveDailyState(s, d); }
  ingestHealthBatch(s, [sleep(todayStr, 282, 'last'), { signal_type: 'recovery', value: 43, source_external_id: 'r_today', observed_at: `${todayStr}T06:35:00Z` }], { provider: 'oura' });
  deriveDailyState(s, todayStr);
  ingestWorkouts(s, [{ started_at: `${todayStr}T07:30:00Z`, duration_minutes: 60, intensity: 'high', planned: true }], { provider: 'manual' });
  s.currentState.trainingLoad = trainingSummary(s).recentLoadScore;
  ingestCalendarBatch(s, [{ title: 'Investor meeting', starts_at: `${todayStr}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'inv' }], { provider: 'local' });
  s.goals = createFixtureState().goals;
  recalculateBaselines(s); assembleDailyPlan(s, todayStr); E.orchestrate(s);
  const rec = s.recommendations[0]; E.decideRecommendation(s, rec.id, 'accepted');
  E.askGlyth(s, 'Why did my plan change?');
  await repo.saveState(userA, s);
  const counts1 = Object.fromEntries([...db.tables.entries()].map(([k, v]) => [k, v.length]));
  await repo.saveState(userA, s); // duplicate save must not duplicate keyed rows
  const counts2 = Object.fromEntries([...db.tables.entries()].map(([k, v]) => [k, v.length]));
  for (const t of ['signals', 'goals', 'daily_plan_items', 'recommendations', 'user_baselines']) assert.equal(counts2[t], counts1[t], `${t} duplicated on re-save`);

  // "restart": brand-new repository/client over the same database
  const repo2 = createRepository(fakeClient(db, userA.id)); const loaded = await repo2.loadState(userA);
  assert.equal(loaded.currentState.sleepMinutes, 282);
  assert.equal(loaded.baselines.sleepMinutes, 435);
  assert.ok(loaded.canonical.calendarEvents.some(e => e.title === 'Investor meeting'));
  assert.equal(loaded.goals.length, 3);
  assert.ok(loaded.plan.some(p => p.title === 'Investor meeting' && p.time === '14:00'));
  assert.ok(loaded.recommendations.some(r => r.title === rec.title));
  assert.ok(loaded.interventions.some(i => i.title === rec.title));
  assert.ok(loaded.conversation.some(m => /plan change/.test(m.text || '')) || loaded.conversation.length >= 2);
  assert.ok(loaded.dailyHistory.length >= 7);
});

test('RLS-style isolation: user B loading from the same database sees none of A', async () => {
  const db = fakeDb(); const repoA = createRepository(fakeClient(db, userA.id));
  const s = createFixtureState(); E.orchestrate(s); await repoA.saveState(userA, s);
  const repoB = createRepository(fakeClient(db, userB.id)); const loadedB = await repoB.loadState(userB);
  assert.equal(loadedB.goals.length, 0); assert.equal(loadedB.plan.length, 0); assert.equal(loadedB.recommendations.length, 0); assert.equal(loadedB.conversation.length, 0);
  await assert.rejects(() => fakeClient(db, userB.id).insert('signals', [{ user_id: userA.id, type: 'sleep' }]), /RLS/);
});

test('job due-selection respects timezone/wake and idempotency keys', () => {
  const profiles = [{ user_id: 'u1', timezone: 'Europe/London', wake_time: '06:30' }, { user_id: 'u2', timezone: 'America/New_York', wake_time: '06:30' }];
  const at7London = new Date('2026-11-03T07:00:00Z'); // 07:00 London, 02:00 New York
  const due = usersDueForJob(profiles, 'morning', at7London, new Set());
  assert.deepEqual(due.map(d => d.user_id), ['u1']);
  const done = new Set(due.map(d => d.idempotencyKey)); assert.equal(usersDueForJob(profiles, 'morning', at7London, done).length, 0);
});

test('fitness persistence (migration 011): completed session + feedback survive reload, user B sees none', async () => {
  const F = await import('../src/fitness/fitness.js');
  const db = fakeDb(); const repo = createRepository(fakeClient(db, userA.id));
  const s = createFixtureState(); E.applyScenario(s, 'poor_sleep');
  const sess = F.getOrCreateTodaySession(s); F.startSession(s, sess.id);
  F.updateExercise(s, sess.id, sess.exercises[0].exerciseId, 'complete_set');
  F.completeSession(s, sess.id); F.submitFeedback(s, sess.id, 'about_right', 5);
  await repo.saveState(userA, s);
  const rows = db.tables.get('workout_sessions') || [];
  assert.equal(rows.length, 1); assert.equal(rows[0].user_id, userA.id); assert.equal(rows[0].status, 'completed'); assert.equal(rows[0].feedback, 'about_right');
  await repo.saveState(userA, s); assert.equal((db.tables.get('workout_sessions') || []).length, 1, 're-save duplicates workout session');
  const loaded = await createRepository(fakeClient(db, userA.id)).loadState(userA);
  assert.ok(loaded.fitness.sessions.some(x => x.id === sess.id && x.status === 'completed' && x.feedback === 'about_right'));
  const loadedB = await createRepository(fakeClient(db, userB.id)).loadState(userB);
  assert.equal(loadedB.fitness.sessions.length, 0);
});
