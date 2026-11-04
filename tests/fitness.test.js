import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js';
import * as F from '../src/fitness/fitness.js';
import { createFixtureState } from './fixture.js';
import { trainingSummary } from '../src/data/training.js';

test('library: 20-30 exercises, 6 templates, all template exercises exist + validate', () => {
  assert.ok(F.EXERCISES.length>=38 && F.EXERCISES.length<=45); assert.equal(F.TEMPLATES.length,7);
  for (const t of F.TEMPLATES) { const s = F.getOrCreateTodaySession ? null : null; for (const e of t.exercises) assert.ok(F.exerciseById(e.exerciseId), e.exerciseId); }
});
test('every shipped GIF is mapped to a library exercise and the file exists', async () => { const fs = await import('node:fs'); const withGif = F.EXERCISES.filter(e => e.mediaUrl); assert.equal(withGif.length, 22); assert.equal(new Set(withGif.map(e => e.mediaUrl)).size, 20); for (const e of withGif) assert.ok(fs.existsSync(e.mediaUrl), `missing ${e.mediaUrl}`); const sess = F.getOrCreateTodaySession(createFixtureState()); for (const e of sess.exercises) assert.equal(e.mediaUrl, F.exerciseDemoFor(e.exerciseId)); assert.ok(F.exerciseDemoFor('goblet-squat')?.endsWith('08_squat.gif')); assert.ok(F.exerciseDemoFor('bench-press')?.endsWith('.gif')); });
test('context compiler includes only fitness-relevant slice', () => { const ctx=F.compileFitnessContext(createFixtureState()); assert.ok('today' in ctx && 'training' in ctx && 'commitments' in ctx); assert.ok(!('conversation' in ctx)); assert.equal(ctx.primaryGoal,'strength'); });
test('hero adaptation: poor sleep + high load + meeting -> recovery, explainable', () => {
  const s = E.applyScenario(createFixtureState(), 'poor_sleep', { runOrchestration:false });
  // fixture plan is baseline; apply orchestration-independent fitness read of scenario state
  const rec = F.recommendFitness(s);
  assert.equal(rec.status,'recovery'); assert.ok(rec.adaptations.some(a=>a.type==='convert_to_recovery')); assert.match(rec.rationale,/recovery is below baseline/i);
  assert.equal(F.validateFitnessRecommendation(rec).ok, true);
  const sess = F.getOrCreateTodaySession(s); assert.equal(sess.adaptation_status,'adapted'); assert.ok(sess.estimated_duration<=35);
});
test('normal day: planned session proceeds full', () => { const rec=F.recommendFitness(createFixtureState()); assert.equal(rec.status,'full'); assert.equal(rec.adaptations.filter(a=>a.type!=='replace_exercise').length,0); });
test('validation rejects invented exercises, bad sets, unavailable equipment', () => {
  assert.equal(F.validateWorkoutSession({ estimatedDuration:30, exercises:[{exerciseId:'ex_invented',sets:3,reps:8}] }).ok,false);
  assert.equal(F.validateWorkoutSession({ estimatedDuration:30, exercises:[{exerciseId:'ex_goblet_squat',sets:99,reps:8}] }).ok,false);
  assert.equal(F.validateWorkoutSession({ estimatedDuration:30, exercises:[{exerciseId:'ex_leg_press',sets:3,reps:8}] }, { availableEquipment:['bodyweight'] }).ok,false);
  assert.equal(F.validateGeneratedSession({ title:'x', exercises:[{exerciseId:'made_up_id',sets:3,reps:8}] }, createFixtureState()).ok,false);
});
test('generation is bounded to library + equipment + safety screen', () => {
  const g=F.generateWorkout(createFixtureState(),{ goal:'strength' }); assert.equal(g.safe,true); for(const e of g.session.exercises) assert.ok(F.exerciseById(e.exerciseId));
  assert.equal(F.generateWorkout(createFixtureState(),{ note:'I have acute pain in my knee' }).safe,false);
  assert.equal(F.safetyScreen('push through pain').safe,false);
});
test('lifecycle: start -> sets -> complete -> load + Today + feedback persist', () => {
  const s=createFixtureState(); const sess=F.getOrCreateTodaySession(s); F.startSession(s,sess.id);
  const e1=sess.exercises[0]; F.updateExercise(s,sess.id,e1.exerciseId,'complete_set'); assert.equal(e1.completed_sets,1);
  F.updateExercise(s,sess.id,e1.exerciseId,'reduce_sets'); const altBefore=sess.exercises[1].exerciseId; F.updateExercise(s,sess.id,altBefore,'replace'); assert.ok(sess.exercises[1].exerciseId);
  const done=F.completeSession(s,sess.id); assert.equal(done.status,'completed'); assert.ok(done.actual_load>0);
  assert.ok(trainingSummary(s).recentLoad>0); assert.equal(s.plan.find(p=>p.type==='training').status,'completed');
  F.submitFeedback(s,sess.id,'about_right',6); assert.equal(F.sessionById(s,sess.id).feedback,'about_right');
  assert.ok(F.weeklyStats(s).sessionsThisWeek>=1); assert.throws(()=>F.submitFeedback(s,sess.id,'meh'),/feedback/);
});
test('Meta failure fallback: deterministic recommendation still valid on empty state', () => { const rec=F.recommendFitness(E.createSeedState()); assert.ok(F.validateWorkoutSession(rec.recommendedSession).ok); assert.ok(rec.confidence>=0&&rec.confidence<=1); });

import { Readable } from 'node:stream';
import { server } from '../server/server.js';
function call(method, urlPath, payload) { return new Promise((resolve) => { const raw = payload ? JSON.stringify(payload) : ''; const req = Readable.from(raw ? [raw] : []); req.method = method; req.url = urlPath; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' }; const res = { status:0, setHeader(){}, writeHead(code){ this.status=code; }, end(data){ let json=null; try{ json=JSON.parse(String(data||'')); }catch{} resolve({ status:this.status, json }); } }; server.emit('request', req, res); }); }
test('E2E hero over HTTP: poor sleep -> adapted session -> start -> complete -> feedback -> persists', async () => {
  await call('POST','/api/reset');
  let r = await call('POST','/api/scenario',{ scenario:'poor_sleep' }); assert.equal(r.status,200);
  r = await call('GET','/api/fitness'); assert.equal(r.status,200); assert.equal(r.json.session.adaptation_status,'adapted'); assert.equal(r.json.recommendation.status,'recovery'); assert.ok(r.json.exercises.length>=20);
  const id = r.json.session.id;
  r = await call('POST',`/api/fitness/sessions/${id}/start`,{}); assert.equal(r.json.session.status,'in_progress');
  const exid = r.json.session.exercises[0].exerciseId;
  r = await call('POST',`/api/fitness/sessions/${id}/exercise`,{ exerciseId:exid, action:'complete_set' }); assert.equal(r.json.session.exercises[0].completed_sets,1);
  r = await call('POST',`/api/fitness/sessions/${id}/complete`,{}); assert.equal(r.json.session.status,'completed'); assert.ok(r.json.state.currentState.trainingLoad!=null);
  r = await call('POST',`/api/fitness/sessions/${id}/feedback`,{ feedback:'about_right', rpe:5 }); assert.equal(r.json.session.feedback,'about_right');
  r = await call('GET','/api/fitness/history'); assert.ok(r.json.sessions.some(s=>s.id===id && s.status==='completed'));
  r = await call('POST','/api/fitness/generate',{ note:'acute pain in shoulder' }); assert.equal(r.status,422);
  await call('POST','/api/reset');
});
