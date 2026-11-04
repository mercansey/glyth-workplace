import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js';
import * as M from '../src/mindfulness/mindfulness.js';
import { createFixtureState } from './fixture.js';

test('guided library: 10 recorded sessions, every audio file ships, all ranking types covered', async () => { const fs = await import('node:fs'); assert.equal(M.SESSIONS.length, 10); for (const s of M.SESSIONS) { assert.equal(s.durationSeconds, 180, s.slug); assert.ok(s.audioUrl?.endsWith('.mp3'), s.slug); assert.ok(fs.existsSync(s.audioUrl), `missing ${s.audioUrl}`); assert.equal(s.script, null); } for (const t of M.SESSION_TYPES) assert.ok(M.SESSIONS.some(s => s.type === t), `no guided session for ${t}`); });
test('script validator still validates generated draft scripts', () => { const draft = { title:'Draft', durationSeconds:60, closingText:'Close.', sections:[{ startSecond:0, endSecond:30, text:'Welcome. Notice your breath and let your shoulders drop as you settle into this short quiet practice now.', pauseAfterSeconds:30 }] }; assert.ok(M.validateScript(draft).ok); assert.ok(M.auditScriptSafety(draft).safe); });
test('context compiler includes only mindfulness-relevant slice', () => { const ctx = M.compileMindfulnessContext(createFixtureState(), new Date('2026-11-03T13:05:00')); assert.ok('current_state' in ctx && 'upcoming_commitments' in ctx); assert.ok(!('goals' in ctx) && !('conversation' in ctx) && !('signals' in ctx)); });
test('hero ranking: poor sleep + investor meeting in 55m -> pre_meeting 5 min', () => { const s = E.applyScenario(createFixtureState(), 'poor_sleep', { runOrchestration:false }); const rec = M.recommendMindfulness(s, new Date(new Date().setHours(13,5,0,0))); assert.equal(rec.sessionType, 'pre_meeting'); assert.equal(rec.durationMinutes, 3); assert.match(rec.rationale, /important commitment|below baseline/i); });
test('evening + short sleep -> wind_down; focus block soon -> focus; low recovery + load -> recovery_pause', () => {
  const s = createFixtureState(); s.currentState.sleepMinutes=300; assert.equal(M.recommendMindfulness(s, new Date('2026-11-03T20:30:00')).sessionType, 'wind_down');
  const s2 = createFixtureState(); assert.equal(M.recommendMindfulness(s2, new Date(new Date().setHours(9,45,0,0))).sessionType, 'focus');
  const s3 = createFixtureState(); s3.currentState.recovery=40; s3.currentState.trainingLoad=85; s3.plan=[]; assert.equal(M.recommendMindfulness(s3, new Date(new Date().setHours(11,0,0,0))).sessionType, 'recovery_pause');
});
test('Meta-unavailable fallback: empty state still yields a valid deterministic recommendation', () => { const rec = M.recommendMindfulness(E.createSeedState()); assert.ok(M.SESSION_TYPES.includes(rec.sessionType)); assert.ok(rec.confidence>=0&&rec.confidence<=1); });
test('recommendation schema validation rejects bad shapes', () => { assert.equal(M.validateMindfulnessRecommendation({sessionType:'nope'}).ok,false); assert.equal(M.validateMindfulnessRecommendation({sessionType:'reset',durationMinutes:3,title:'x',purpose:'y',rationale:'z',confidence:0.5}).ok,true); });
test('start -> complete -> feedback persists on state and marks Today rec + intervention', () => { const s=E.applyScenario(createFixtureState(),'poor_sleep'); assert.ok(s.recommendations.some(r=>r.action?.type==='mindfulness_session')); const mrec=s.recommendations.find(r=>r.action?.type==='mindfulness_session'); const a=M.startActivity(s,mrec.action.session_type); assert.equal(a.status,'started'); M.completeActivity(s,a.id,300); assert.equal(a.status,'completed'); M.submitFeedback(s,a.id,'better'); assert.equal(a.post_state,'better'); assert.ok(s.recommendations.filter(r=>r.action?.type==='mindfulness_session').every(r=>r.status==='executed')); assert.ok(s.interventions.some(i=>/mindfulness session/.test(i.title))); const st=M.weeklyStats(s); assert.equal(st.sessionsThisWeek,1); assert.ok(st.minutesThisWeek>=3); });
test('abandon does not count as completion', () => { const s=createFixtureState(); const a=M.startActivity(s,'breathing-into-rest'); M.abandonActivity(s,a.id,40); assert.equal(M.weeklyStats(s).sessionsThisWeek,0); });
test('orchestration proposes mindfulness but not after completion today', () => { const s=E.applyScenario(createFixtureState(),'poor_sleep'); const a=M.startActivity(s, M.recommendMindfulness(s).sessionId); M.completeActivity(s,a.id); E.orchestrate(s); assert.ok(!s.recommendations.some(r=>r.action?.type==='mindfulness_session'&&r.status==='proposed'&&r.action.session_type===a.session_type)); });

import { Readable } from 'node:stream';
import { server } from '../server/server.js';
function call(method, urlPath, payload) { return new Promise((resolve) => { const raw = payload ? JSON.stringify(payload) : ''; const req = Readable.from(raw ? [raw] : []); req.method = method; req.url = urlPath; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' }; const res = { status: 0, headers: {}, body: '', setHeader(k,v){this.headers[k]=v;}, writeHead(code,h){this.status=code; Object.assign(this.headers,h||{});}, end(data){ this.body=data?String(data):''; let json=null; try{json=JSON.parse(this.body);}catch{} resolve({status:this.status,json,body:this.body}); } }; server.emit('request', req, res); }); }
test('E2E hero over HTTP: scenario -> recommendation -> start -> complete -> feedback -> persisted', async () => {
  await call('POST','/api/reset',{}); await call('POST','/api/scenario',{scenario:'poor_sleep'});
  let r = await call('GET','/api/mindfulness'); assert.equal(r.status,200); assert.equal(r.json.sessions.length,10); assert.ok(r.json.sessions.every(x=>x.audioUrl)); assert.ok(r.json.recommendation.sessionType);
  const sid = r.json.recommendation.sessionId;
  r = await call('POST',`/api/mindfulness/sessions/${sid}/start`,{}); assert.equal(r.status,200); const aid=r.json.activity.id; assert.equal(r.json.activity.status,'started');
  r = await call('POST',`/api/mindfulness/activity/${aid}/complete`,{duration_completed_seconds:180}); assert.equal(r.json.activity.status,'completed'); assert.equal(r.json.stats.sessionsThisWeek,1);
  r = await call('POST',`/api/mindfulness/activity/${aid}/feedback`,{post_state:'better'}); assert.equal(r.json.activity.post_state,'better');
  r = await call('GET','/api/state'); const a=r.json.state.mindfulness.activity[0]; assert.equal(a.status,'completed'); assert.equal(a.post_state,'better');
  r = await call('GET','/api/mindfulness/sessions/breathing-into-rest'); assert.equal(r.status,200); assert.ok(r.json.session.audioUrl.endsWith('.mp3'));
  r = await call('POST','/api/mindfulness/activity/nope/feedback',{post_state:'better'}); assert.equal(r.status,400);
  await call('POST','/api/reset',{});
});
