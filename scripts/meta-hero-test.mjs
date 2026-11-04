// Prove a REAL Meta call through the existing orchestration path.
// Prereq: app server running (Start-Glyth.command) AFTER the key was put in
// .env. Usage: node scripts/meta-hero-test.mjs
const APP = process.env.APP_URL || 'http://127.0.0.1:3000';
const post = async (p, body) => { const r = await fetch(`${APP}${p}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`${p} -> ${r.status} ${d.error || ''}`); return d; };
const today = new Date().toISOString().slice(0, 10);
const sleep = (date, min, id) => ({ signal_type: 'sleep', value: min, quality: 70, source_external_id: id, period_start: `${date}T23:10:00Z`, period_end: `${date}T06:30:00Z`, observed_at: `${date}T06:30:00Z` });
for (let i = 7; i >= 1; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  await post('/api/ingest/health', { provider: 'oura', samples: [sleep(d, 435, `hero_b_${i}`), { signal_type: 'recovery', value: 72, source_external_id: `hero_r_${i}`, observed_at: `${d}T06:35:00Z` }] }); }
await post('/api/ingest/health', { provider: 'oura', samples: [sleep(today, 282, 'hero_last'), { signal_type: 'recovery', value: 43, source_external_id: 'hero_r_today', observed_at: `${today}T06:35:00Z` }] });
const yday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
await post('/api/ingest/workouts', { provider: 'manual', workouts: [{ started_at: `${yday}T18:00:00Z`, duration_minutes: 60, intensity: 'high', planned: false }, { started_at: `${today}T07:30:00Z`, duration_minutes: 60, intensity: 'high', planned: true }] });
await post('/api/ingest/calendar', { provider: 'local', events: [{ title: 'Investor meeting', starts_at: `${today}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'hero_inv' }] });
await post('/api/goals', { title: 'Protect work performance', category: 'Work', target: '2 focus blocks' });
await post('/api/plan/assemble', {});
console.log('Running orchestration (this calls Meta)...');
const orch = await post('/api/orchestrate', {});
const s = orch.state; const ai = s.aiRuns?.[0] || {};
const meeting = s.plan.find(p => p.title === 'Investor meeting');
console.log(JSON.stringify({
  provider: ai.provider, model: ai.model, fallback: ai.fallback, validated: ai.validated, latencyMs: ai.latencyMs,
  changes: s.changesCount, insight: s.insight?.headline, meeting: meeting ? `${meeting.time} ${meeting.status}` : 'MISSING',
  plan: s.plan.map(p => `${p.time} ${p.title} [${p.status}]`),
}, null, 2));
if (ai.provider !== 'meta') { console.error(ai.fallback && ai.latencyMs > 7000 ? '\nMETA TIMED OUT (two 8s attempts) and deterministic fallback ran. The key IS loaded. Check Meta reachability:  curl -m 15 -s -o /dev/null -w "%{http_code} %{time_total}s\\n" https://api.meta.ai/v1/models -H "Authorization: Bearer $MODEL_API_KEY"' : '\nNOT A META RUN — the server was probably started before the key was added. Restart Start-Glyth.command and re-run.'); process.exit(1); }
if (ai.fallback) { console.error('\nMeta failed and fallback ran. Check the key/model, then re-run.'); process.exit(1); }
console.log('\nPASS: real Meta run stored. Now open Today / Why / Insights in the app.');
