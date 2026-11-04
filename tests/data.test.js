import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js';
import { ingestHealthBatch, deriveDailyState, nightDateFor, normalizeHealthSample, PRIVACY_CLASS, privacyClassOf } from '../src/data/canonical.js';
import { computeBaseline, recalculateBaselines } from '../src/data/baselines.js';
import { ingestCalendarBatch, classifyEvent } from '../src/data/calendar.js';
import { ingestWorkouts, trainingSummary } from '../src/data/training.js';
import { deriveWorkload } from '../src/data/workload.js';
import { assembleDailyPlan } from '../src/data/plan.js';
import { nightlyRollup, weeklySummary, shouldOrchestrate } from '../src/data/jobs.js';
import { createFixtureState } from './fixture.js';

const today = () => new Date().toISOString().slice(0, 10);
const sleepSample = (date, minutes, id) => ({ signal_type: 'sleep', value: minutes, quality: 70, source_external_id: id, period_start: `${date}T23:10:00Z`, period_end: `${date}T06:30:00Z`, observed_at: `${date}T06:30:00Z` });

test('night grouping: a session crossing midnight belongs to the waking day, per timezone', () => {
  assert.equal(nightDateFor('2026-11-02T23:30:00Z', '2026-11-03T06:30:00Z', 'Europe/London'), '2026-11-03');
  assert.equal(nightDateFor('2026-11-02T18:30:00Z', '2026-11-03T02:00:00Z', 'America/New_York'), '2026-11-02');
  assert.equal(nightDateFor('2026-11-03T00:30:00Z', '2026-11-03T07:00:00Z', 'UTC'), '2026-11-03');
});
test('health ingest is idempotent, reconciles updates, handles deletions, keeps provenance', () => {
  const s = E.createSeedState(); const d = today();
  let r = ingestHealthBatch(s, [sleepSample(d, 400, 'n1')], { provider: 'oura' });
  assert.equal(r.accepted, 1);
  r = ingestHealthBatch(s, [sleepSample(d, 410, 'n1')], { provider: 'oura' });
  assert.equal(s.canonical.healthSignals.length, 1); assert.equal(s.canonical.healthSignals[0].value, 410);
  assert.equal(s.canonical.healthSignals[0].source_provider, 'oura'); assert.equal(s.canonical.healthSignals[0].source_metric, 'sleep');
  r = ingestHealthBatch(s, [], { provider: 'oura', deletedExternalIds: ['n1'] }); assert.equal(r.deleted, 1); assert.equal(s.canonical.healthSignals.length, 0);
  assert.throws(() => normalizeHealthSample({ signal_type: 'blood_glucose', value: 1 }, { provider: 'oura' }), /unsupported signal_type/);
  assert.throws(() => normalizeHealthSample({ signal_type: 'sleep', value: 1 }, { provider: 'fitbit' }), /unsupported health provider/);
});
test('baselines: <7 days null, >=7 generated, missing days tolerated', () => {
  assert.equal(computeBaseline([400, 420, 430]).value, null);
  assert.equal(computeBaseline([400, 410, 420, 430, 440, 450, 460]).value, 430);
  assert.equal(computeBaseline([null, 400, undefined, 410, 420, 430, 440, 450, 460]).value, 430);
});
test('calendar classification: keywords fixed/critical, plain events unknown movability', () => {
  assert.equal(classifyEvent({ title: 'Investor meeting', duration_minutes: 60 }).importance, 'critical');
  assert.equal(classifyEvent({ title: 'Investor meeting' }).movability, 'fixed');
  assert.equal(classifyEvent({ title: 'Team lunch' }).movability, 'unknown');
});
test('training: load is deterministic and cross-provider duplicates reconcile to the stronger source', () => {
  const s = E.createSeedState(); const y = new Date(Date.now() - 86400000).toISOString();
  ingestWorkouts(s, [{ started_at: y, duration_minutes: 60, intensity: 'high', external_id: 'w1' }], { provider: 'apple_healthkit' });
  let sum = trainingSummary(s); assert.equal(sum.yesterdayLoad, 96); assert.equal(sum.highRecentLoad, true); assert.ok(sum.recentLoadScore >= 60, 'a hard session yesterday must read as high load');
  ingestWorkouts(s, [{ started_at: y, duration_minutes: 62, intensity: 'high', external_id: 'w2' }], { provider: 'whoop' });
  assert.equal(s.canonical.workouts.length, 1); assert.equal(s.canonical.workouts[0].provider, 'whoop');
});
test('workload derivation is documented and blends the check-in', () => {
  const d = today(); const ev = [{ title: 'Meetings', starts_at: `${d}T09:00:00Z`, ends_at: `${d}T13:00:00Z`, duration_minutes: 240, status: 'confirmed' }];
  const w = deriveWorkload(ev, null); assert.equal(w.meetingDensity, 50); assert.ok(w.workload > 0);
  const blended = deriveWorkload(ev, { workload: 'high' }); assert.ok(blended.workload >= w.workload);
});
test('plan assembly: fixed commitments never move, flexible focus shifts around them', () => {
  const s = createFixtureState(); s.canonical.calendarEvents = []; s.plan = [];
  const d = today();
  ingestCalendarBatch(s, [{ title: 'Investor meeting', starts_at: `${d}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'e1' }], { provider: 'local' });
  ingestWorkouts(s, [{ started_at: `${d}T07:30:00Z`, duration_minutes: 60, intensity: 'high', planned: true }], { provider: 'manual' });
  const plan = assembleDailyPlan(s, d);
  const meeting = plan.find(p => p.title === 'Investor meeting'); assert.equal(meeting.time, '14:00'); assert.equal(meeting.priority, 'critical');
  assert.ok(plan.some(p => p.type === 'training')); assert.ok(plan.some(p => p.title === 'Deep work'));
  const overlaps = plan.some((a, i) => plan.some((b, j) => j > i && a.time === b.time && a.type !== b.type && a.title !== b.title && a.time === '14:00' && b.title === 'Investor meeting'));
  assert.equal(overlaps, false);
});
test('privacy classes separate health from consentable work patterns', () => {
  assert.equal(privacyClassOf('sleep'), 'PRIVATE_HEALTH'); assert.equal(PRIVACY_CLASS.hrv, 'PRIVATE_HEALTH');
  assert.equal(privacyClassOf('meeting_density'), 'WORK_PATTERN_CONSENTABLE'); assert.equal(privacyClassOf('conversation'), 'PRIVATE_CONVERSATION');
});
test('orchestration trigger policy deduplicates identical context', () => {
  const s = createFixtureState(); const a = shouldOrchestrate(s, 'manual', {}); assert.equal(a.run, true);
  const b = shouldOrchestrate(s, 'health_sync', { fingerprint: a.fingerprint, at: Date.now() }); assert.equal(b.run, false);
  assert.equal(shouldOrchestrate(E.createSeedState(), 'manual', {}).run, false);
});

test('E2E realistic morning + poor sleep from canonical ingestion only', () => {
  const s = E.createSeedState(); s.profile.timezone = 'Europe/London';
  // 7 nights of baseline sleep + recovery, then last night collapses
  for (let i = 7; i >= 1; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
    ingestHealthBatch(s, [sleepSample(d, 435, `base_${i}`), { signal_type: 'recovery', value: 72, source_external_id: `rec_${i}`, observed_at: `${d}T06:35:00Z` }], { provider: 'oura' });
    deriveDailyState(s, d); }
  const meta = recalculateBaselines(s); assert.equal(meta.sleep.value, 435);
  const d = today();
  ingestHealthBatch(s, [sleepSample(d, 282, 'lastnight'), { signal_type: 'recovery', value: 43, source_external_id: 'rec_today', observed_at: `${d}T06:35:00Z` }], { provider: 'oura' });
  const rec = deriveDailyState(s, d); assert.equal(rec.sleepMinutes, 282); assert.equal(s.currentState.consecutivePoorNights >= 1, true);
  const y = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  deriveDailyState(s, y);
  ingestWorkouts(s, [{ started_at: `${y}T18:00:00Z`, duration_minutes: 60, intensity: 'high' }], { provider: 'whoop' });
  s.currentState.trainingLoad = trainingSummary(s).recentLoadScore; assert.ok(s.currentState.trainingLoad >= 30 || trainingSummary(s).highRecentLoad);
  ingestCalendarBatch(s, [{ title: 'Investor meeting', starts_at: `${d}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'inv1' }], { provider: 'local' });
  ingestWorkouts(s, [{ started_at: `${d}T07:30:00Z`, duration_minutes: 60, intensity: 'high', planned: true }], { provider: 'manual' });
  s.goals = createFixtureState().goals;
  assembleDailyPlan(s, d);
  assert.ok(s.plan.some(p => p.title === 'Investor meeting' && p.time === '14:00'));
  assert.ok(s.plan.some(p => p.type === 'training'));
  E.orchestrate(s);
  assert.equal(s.plan.find(p => p.title === 'Investor meeting')?.time, '14:00');
  assert.ok(s.recommendations.length >= 1); assert.equal(s.insight.headline, 'Sleep is affecting today’s performance.');
  // accept -> intervention recorded
  const first = s.recommendations[0]; E.decideRecommendation(s, first.id, 'accepted');
  assert.ok(s.interventions.some(i => i.title === first.title));
  // nightly roll-up evaluates without causal claims; weekly needs >=3 days
  const night = nightlyRollup(s, y); assert.ok(night.baselines);
  const wk = weeklySummary(s); assert.ok('generated' in wk);
});
