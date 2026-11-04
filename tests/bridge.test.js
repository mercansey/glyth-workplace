import test from 'node:test'; import assert from 'node:assert/strict';
import * as B from '../src/bridge/bridge.js';
import { loadBridgeConfig, publicBridgeStatus, publicAuthConfig, createProjectClient, syncBridge } from '../src/bridge/client.js';
import * as EMP from '../src/employer/engine.js';

test('alias is pseudonymised, stable, and contains no raw user id', () => {
  const a = B.participantAlias('user_alex_123', 'org_northstar', 'salt1');
  assert.equal(a, B.participantAlias('user_alex_123', 'org_northstar', 'salt1'));
  assert.ok(!a.includes('alex') && !a.includes('user_alex_123'));
  assert.notEqual(a, B.participantAlias('user_alex_123', 'org_other', 'salt1'));
});

test('contributions only include consented work-pattern categories', () => {
  const { contributions, dropped } = B.buildContributions({ userId: 'u1', orgId: 'org1', teamId: 't1', day: '2026-10-27', salt: 's',
    signals: { workload: 60, meeting_density: 55, sleep: 420, recovery: 72 }, consentedCategories: ['workload'] });
  assert.equal(contributions.length, 1); assert.equal(contributions[0].category, 'workload');
  assert.ok(dropped.includes('sleep') && dropped.includes('recovery'));
  assert.ok(!JSON.stringify(contributions).includes('u1'));
  assert.equal(contributions[0].idempotency_key, B.buildContributions({ userId: 'u1', orgId: 'org1', teamId: 't1', day: '2026-10-27', salt: 's', signals: { workload: 60 }, consentedCategories: ['workload'] }).contributions[0].idempotency_key);
});

test('forbidden fields are rejected anywhere in a payload', () => {
  assert.throws(() => B.assertNoForbidden({ ok: 1, nested: { sleep: 7 } }), /forbidden field/);
  assert.throws(() => B.assertNoForbidden({ user_id: 'x' }), /forbidden field/);
  assert.equal(B.assertNoForbidden({ category: 'workload', value: 50 }), true);
});

test('cohort gate suppresses below 5 and averages at/above 5', () => {
  const mk = (n, v) => Array.from({ length: n }, (_, i) => ({ participant_alias: `p_${i}`, org_id: 'o', team_id: 't', category: 'workload', value: v }));
  assert.equal(B.gateCohorts(mk(4, 60))[0].suppressed, true);
  assert.equal(B.gateCohorts(mk(4, 60))[0].value, null);
  const ok = B.gateCohorts(mk(6, 60))[0]; assert.equal(ok.suppressed, false); assert.equal(ok.value, 60); assert.equal(ok.participant_count, 6);
});

test('directives validate type and strip to safe fields', () => {
  const d = B.buildDirectiveInboxItem({ id: 'int1', orgId: 'org1', teamId: 't1', type: 'protect_focus', title: 'Protect focus window' });
  assert.equal(d.status, 'received'); assert.ok(d.idempotency_key);
  assert.throws(() => B.buildDirectiveInboxItem({ id: 'x', orgId: 'o', type: 'read_sleep', title: 'bad' }), /unsupported directive/);
  assert.throws(() => B.buildOutcomeAck({ directiveSourceId: 'x', orgId: 'o', status: 'hacked' }), /valid status/);
});

test('config reports configured booleans only, never keys', () => {
  const cfg = loadBridgeConfig({ USER_SUPABASE_URL: 'https://userproj.supabase.co', USER_SUPABASE_SERVICE_KEY: 'secret-user', SYSTEM_SUPABASE_URL: 'https://sysproj.supabase.co', SYSTEM_SUPABASE_SERVICE_KEY: 'secret-sys', BRIDGE_SALT: 's' });
  const st = publicBridgeStatus(cfg);
  assert.equal(st.mode, 'live'); assert.equal(st.userContext.urlHost, 'userproj.supabase.co');
  assert.ok(!JSON.stringify(st).includes('secret'));
  assert.equal(publicBridgeStatus(loadBridgeConfig({})).mode, 'demo-unconfigured');
});

test('PostgREST client sends service key server-side and upserts idempotently', async () => {
  const calls = [];
  const client = createProjectClient({ url: 'https://x.supabase.co', _serviceKey: 'k' }, async (url, opts) => { calls.push({ url, opts }); return { ok: true, text: async () => '[]' }; });
  await client.upsert('bridge_contributions', [{ idempotency_key: 'a' }], 'idempotency_key');
  assert.match(calls[0].url, /on_conflict=idempotency_key/);
  assert.equal(calls[0].opts.headers.Authorization, 'Bearer k');
});

test('demo sync over employer seed: small team suppressed, big teams released, no forbidden data', () => {
  const s = EMP.createEmployerSeed(); const r = B.demoSync(s, { day: '2026-10-27' });
  assert.ok(r.contributions > 100); assert.ok(r.released > 0); assert.ok(r.suppressed > 0); // t_people (3) suppressed
  const str = JSON.stringify(r);
  for (const bad of ['"sleep"', '"recovery"', '"user_id"', 't_people_m']) assert.ok(!str.includes(bad), bad);
  assert.ok(r.aggregates.every(a => a.suppressed || a.participant_count >= 5));
});

test('live sync pushes contributions and pulls directives with mocked clients', async () => {
  const s = EMP.createEmployerSeed(); const stored = { contrib: null, inbox: [] };
  const cfg = loadBridgeConfig({ BRIDGE_SALT: 's', MIN_COHORT_SIZE: '5' });
  const systemClient = { upsert: async (t, rows) => { stored.contrib = rows; }, select: async () => [{ id: 'row1', source_id: 'int_focus_product', payload: { org_id: 'org_northstar', team_id: 't_product', type: 'protect_focus', title: 'Protect focus window', description: 'd' } }], update: async () => {} };
  const userClient = { upsert: async (t, rows) => { stored.inbox.push(...rows); } };
  const r = await syncBridge({ config: cfg, employerState: s, userClient, systemClient, day: '2026-10-27' });
  assert.equal(r.mode, 'live'); assert.ok(r.pushed > 100); assert.equal(r.directivesPulled, 1);
  assert.equal(stored.inbox[0].type, 'protect_focus');
});

test('public auth config exposes only the public anon key, never the service key', () => {
  const cfg = loadBridgeConfig({ USER_SUPABASE_URL: 'https://u.supabase.co', USER_SUPABASE_ANON_KEY: 'anon-public', USER_SUPABASE_SERVICE_KEY: 'secret-service', SYSTEM_SUPABASE_URL: 'https://s.supabase.co', SYSTEM_SUPABASE_SERVICE_KEY: 'secret-sys' });
  const pub = publicAuthConfig(cfg);
  assert.equal(pub.authConfigured, true); assert.equal(pub.supabaseAnonKey, 'anon-public');
  assert.ok(!JSON.stringify(pub).includes('secret'));
  assert.equal(publicAuthConfig(loadBridgeConfig({})).authConfigured, false);
});

test('privacy attacks: every forbidden personal category is dropped or rejected at the bridge', () => {
  const attacks = { sleep: 282, sleep_quality: 41, hrv: 62, recovery: 43, health: 1, finance: { balance: 10 }, family: { member: 'Mum' }, conversations: 'secret', message_body: 'hello', calendar_title: 'Dentist', personal_goals: ['x'], mindfulness: { minutes: 5 }, fitness: { workout: 'squat' }, training_load: 90, medical: 'x' };
  const { contributions, dropped } = B.buildContributions({ userId: 'u1', orgId: 'o1', teamId: 't1', signals: { workload: 60, ...attacks }, consentedCategories: ['workload', ...Object.keys(attacks)], day: '2026-11-04', salt: 's' });
  assert.deepEqual(contributions.map(c => c.category), ['workload']);
  for (const k of Object.keys(attacks)) assert.ok(dropped.includes(k), `${k} not dropped`);
  for (const k of ['sleep','hrv','finance','family','conversations','mindfulness','recovery','medical']) {
    assert.throws(() => B.assertNoForbidden({ nested: { [k]: 1 } }), /forbidden field/, k);
  }
  // calendar titles / message bodies are not on the allowlist, so they are dropped before aggregation (proven above), never carried.
  assert.ok(dropped.includes('calendar_title') && dropped.includes('message_body'));
});
