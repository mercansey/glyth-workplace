import { test } from 'node:test'; import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { server } from '../server/server.js';

function call(method, urlPath, payload) {
  return new Promise((resolve) => {
    const raw = payload ? JSON.stringify(payload) : '';
    const req = Readable.from(raw ? [raw] : []); req.method = method; req.url = urlPath; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
    const res = { status: 0, headers: {}, body: '',
      setHeader(k, v) { this.headers[k] = v; },
      writeHead(code, headers) { this.status = code; Object.assign(this.headers, headers || {}); },
      end(data) { this.body = data ? String(data) : ''; let json = null; try { json = JSON.parse(this.body); } catch { /* static text */ } resolve({ status: this.status, json, body: this.body }); } };
    server.emit('request', req, res);
  });
}

test('E2E backend flow over the real HTTP handler: empty state -> validation -> reset', async () => {
  let r = await call('GET', '/api/state');
  assert.equal(r.status, 200);
  assert.equal(r.json.state.plan.length, 0);
  assert.equal(r.json.state.goals.length, 0);
  assert.equal(r.json.state.currentState.sleepMinutes, null);
  assert.equal(r.json.state.insight.headline, 'No data yet.');

  r = await call('POST', '/api/ask', { message: 'Why did my plan change?' });
  assert.equal(r.status, 200); // Ask is LLM-only now: a real model answer, or an honest unavailability message — never a canned local one.
  assert.ok(['meta', 'llm-unavailable'].includes(r.json.state.conversation.at(-1).source), r.json.state.conversation.at(-1).source);

  r = await call('POST', '/api/scenario', { scenario: 'not_a_scenario' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/ask', { message: '   ' });
  assert.equal(r.status, 400);
  r = await call('POST', '/api/recommendation', { id: 'x', decision: 'hacked' });
  assert.equal(r.status, 400);

  r = await call('POST', '/api/reset'); assert.equal(r.status, 200);
  assert.equal(r.json.state.plan.length, 0); assert.equal(r.json.state.currentState.readiness, null);
});

test('static surface never serves .env or server code', async () => {
  assert.equal((await call('GET', '/.env')).status, 404);
  assert.equal((await call('GET', '/server/server.js')).status, 404);
  assert.equal((await call('GET', '/')).status, 200);
});

test('non-demo mode rejects unauthenticated consumer access (401) and still blocks .env', async () => {
  const run = promisify(execFile);
  const serverUrl = new URL('../server/server.js', import.meta.url).href;
  const script = `
    import { server } from ${JSON.stringify(serverUrl)};
    import { Readable } from 'node:stream';
    const call = (method, urlPath, payload='') => new Promise((resolve) => {
      const req = Readable.from(payload ? [payload] : []); req.method = method; req.url = urlPath; req.headers = {}; req.socket = { remoteAddress: '127.0.0.1' };
      const res = { setHeader(){}, writeHead(code){ this.code = code; }, end(){ resolve(this.code); } };
      server.emit('request', req, res);
    });
    console.log('STATE=' + await call('GET', '/api/state'));
    console.log('SCENARIO=' + await call('POST', '/api/scenario', JSON.stringify({ scenario: 'poor_sleep' })));
    console.log('ENVFILE=' + await call('GET', '/.env'));
    console.log('BADTOKEN=' + await (async () => { const req = Readable.from([]); req.method='GET'; req.url='/api/state'; req.headers={ authorization: 'Bearer invalid-token' }; req.socket={ remoteAddress: '127.0.0.1' }; return new Promise((resolve)=>{ const res={ setHeader(){}, writeHead(c){this.code=c;}, end(){ resolve(this.code); } }; server.emit('request', req, res); }); })());
  `;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DEMO_MODE: 'false', USER_SUPABASE_URL: 'https://auth.example.invalid', USER_SUPABASE_ANON_KEY: 'anon-test' } });
  assert.match(stdout, /STATE=401/); assert.match(stdout, /SCENARIO=401/); assert.match(stdout, /ENVFILE=404/); assert.match(stdout, /BADTOKEN=401/);
});

test('ingestion routes over the HTTP handler build state from real payloads', async () => {
  const todayStr = new Date().toISOString().slice(0, 10);
  let r = await call('POST', '/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 300, quality: 50, source_external_id: 'srv_n1', period_start: `${todayStr}T23:00:00Z`, period_end: `${todayStr}T06:00:00Z`, observed_at: `${todayStr}T06:00:00Z` }] });
  assert.equal(r.status, 200); assert.equal(r.json.ingest.accepted, 1); assert.equal(r.json.state.currentState.sleepMinutes, 300);
  r = await call('POST', '/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 300, source_external_id: 'srv_n1', period_start: `${todayStr}T23:00:00Z`, period_end: `${todayStr}T06:00:00Z`, observed_at: `${todayStr}T06:00:00Z` }] });
  assert.equal(r.json.state.canonical.healthSignals.filter(x => x.source_external_id === 'srv_n1').length, 1);
  r = await call('POST', '/api/ingest/calendar', { provider: 'local', events: [{ title: 'Investor meeting', starts_at: `${todayStr}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'srv_e1' }] });
  assert.equal(r.status, 200); assert.equal(r.json.state.canonical.calendarEvents[0].importance, 'critical');
  r = await call('POST', '/api/goals', { title: 'Ship the demo', category: 'Work', target: 'Friday' });
  assert.equal(r.status, 200); assert.equal(r.json.state.goals.length, 1);
  r = await call('POST', '/api/plan/assemble', {});
  assert.equal(r.status, 200); assert.ok(r.json.state.plan.some(p => p.title === 'Investor meeting'));
  r = await call('GET', '/api/trends?range=7'); assert.equal(r.status, 200);
  r = await call('POST', '/api/reset', {}); assert.equal(r.json.state.plan.length, 0); assert.equal(r.json.state.canonical.healthSignals.length, 0);
});

test('health ingest derives every affected night so baselines form', async () => {
  const day = (i) => new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
  for (let i = 7; i >= 1; i--) { const d = day(i);
    await call('POST', '/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 435, quality: 70, source_external_id: `hd_${i}`, period_start: `${d}T23:10:00Z`, period_end: `${d}T06:30:00Z`, observed_at: `${d}T06:30:00Z` }] }); }
  const r = await call('POST', '/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 282, quality: 41, source_external_id: 'hd_today', period_start: `${day(0)}T23:10:00Z`, period_end: `${day(0)}T06:30:00Z`, observed_at: `${day(0)}T06:30:00Z` }] });
  assert.equal(r.status, 200);
  assert.ok(r.json.state.dailyHistory.length >= 7, `dailyHistory=${r.json.state.dailyHistory.length}`);
  assert.equal(r.json.state.baselines.sleepMinutes, 435);
  await call('POST', '/api/reset', {});
});

test('CORS preflight from the Capacitor origin is answered', async () => {
  const r = await new Promise((resolve) => {
    const req = Readable.from([]); req.method = 'OPTIONS'; req.url = '/api/auth/signin'; req.headers = { origin: 'capacitor://localhost' }; req.socket = { remoteAddress: '127.0.0.1' };
    const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, writeHead(code, headers) { this.code = code; Object.assign(this.headers, headers || {}); }, end() { resolve({ code: this.code, headers: this.headers }); } };
    server.emit('request', req, res);
  });
  assert.equal(r.code, 204); assert.equal(r.headers['Access-Control-Allow-Origin'], 'capacitor://localhost');
});
