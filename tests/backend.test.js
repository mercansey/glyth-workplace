import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as E from '../src/domain/engine.js';
import { createFixtureState } from './fixture.js';
import { validateEnv } from '../src/server/env.js';
import { RateLimiter } from '../src/server/ratelimit.js';
import { resolveStaticPath } from '../src/server/static.js';
import { MetaReasoningProvider } from '../src/ai/providers.js';

// --- Environment validation ---
test('env: demo defaults are valid, unsafe production config fails clearly', () => {
  assert.equal(validateEnv({}).ok, true);
  assert.equal(validateEnv({ DEMO_MODE: 'false' }).ok, false);
  assert.match(validateEnv({ DEMO_MODE: 'false' }).errors.join(' '), /DEMO_MODE=false requires/);
  assert.equal(validateEnv({ DEMO_MODE: 'false', USER_SUPABASE_URL: 'https://x.supabase.co', USER_SUPABASE_ANON_KEY: 'anon' }).ok, true);
  assert.equal(validateEnv({ PORT: '99999' }).ok, false);
  assert.equal(validateEnv({ USER_SUPABASE_URL: 'not a url' }).ok, false);
});

// --- Static allowlist: secrets and server code are never served ---
test('static: app surface allowed, .env/.git/server/tests blocked, traversal blocked', () => {
  const root = '/srv/app';
  assert.equal(resolveStaticPath(root, '/'), '/srv/app/index.html');
  assert.equal(resolveStaticPath(root, '/app.js'), '/srv/app/app.js');
  assert.equal(resolveStaticPath(root, '/src/domain/engine.js'), '/srv/app/src/domain/engine.js');
  assert.equal(resolveStaticPath(root, '/.env'), null);
  assert.equal(resolveStaticPath(root, '/.git/config'), null);
  assert.equal(resolveStaticPath(root, '/server/server.js'), null);
  assert.equal(resolveStaticPath(root, '/tests/engine.test.js'), null);
  assert.equal(resolveStaticPath(root, '/%2e%2e/.env'), null);
  assert.equal(resolveStaticPath(root, '/package.json'), null);
  assert.equal(resolveStaticPath(root, '/assets/workouts/08_squat.gif'), '/srv/app/assets/workouts/08_squat.gif');
  assert.equal(resolveStaticPath(root, '/assets/meditations/05_drifting.mp3'), '/srv/app/assets/meditations/05_drifting.mp3');
  assert.equal(resolveStaticPath(root, '/assets/../.env'), null);
});

// --- Rate limiting ---
test('rate limiter blocks after the limit and recovers after the window', () => {
  const rl = new RateLimiter(); const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) assert.equal(rl.hit('k', 3, 60000, t0 + i).allowed, true);
  assert.equal(rl.hit('k', 3, 60000, t0 + 4).allowed, false);
  assert.equal(rl.hit('k', 3, 60000, t0 + 61000).allowed, true);
});

// --- Recommendation lifecycle: impossible transitions are rejected ---
test('rejected recommendation cannot later be executed', () => {
  const s = E.applyScenario(createFixtureState(), 'poor_sleep');
  const rec = s.recommendations[0];
  E.decideRecommendation(s, rec.id, 'rejected');
  assert.throws(() => E.decideRecommendation(s, rec.id, 'accepted'), /Invalid recommendation transition/);
  assert.notEqual(rec.status, 'executed');
});
test('proposal confirm only acts on the latest message', () => {
  const s = E.applyScenario(createFixtureState(), 'poor_sleep');
  E.askGlyth(s, 'Keep my workout');            // creates a proposal
  E.askGlyth(s, 'What matters most today?');   // newer message, no proposal
  E.confirmProposal(s);                        // must be a no-op
  assert.equal(s.plan.find(p => p.id === 'p_train').title, 'Recovery session');
});

// --- Context compiler snapshot: scoped, compact, no secret-shaped keys ---
test('context snapshot has the exact top-level shape and no secrets', () => {
  const s = E.applyScenario(createFixtureState(), 'poor_sleep');
  const ctx = E.compileContext(s);
  for (const k of ['active_goals','baselines','constraints','current_state','deviations','important_recent_signals','preferences','today_schedule','recent_interventions','user_profile']) assert.ok(k in ctx, k);
  assert.equal(ctx.context_version, 1); assert.ok(ctx.generated_at); assert.ok('data_freshness' in ctx);
  assert.equal(ctx.deviations.sleepPct, -35);
  const str = JSON.stringify(ctx).toLowerCase();
  for (const bad of ['api_key','service','token','password','secret']) assert.ok(!str.includes(bad), bad);
  assert.ok(ctx.today_schedule.some(p => p.title === 'Investor meeting'));
});

// --- Reset: 5 full cycles restore the baseline every time ---
test('five poor-sleep/reset cycles restore baseline each time', () => {
  for (let i = 0; i < 5; i++) {
    const s = createFixtureState();
    E.applyScenario(s, 'poor_sleep');
    assert.ok(s.changesCount >= 3);
    const r = E.resetDemo();
    assert.equal(r.changesCount, 0); assert.equal(r.activeScenario, null);
    assert.equal(r.plan.length, 0); assert.equal(r.currentState.sleepMinutes, null); assert.equal(E.hasUserData(r), false);
  }
});

// --- Rule engine independence (no Meta) ---
test('rules fire deterministically for poor sleep without any provider', () => {
  const ctx = E.compileContext(createFixtureState());
  assert.equal(E.evaluateRules(ctx).length, 0);
  const s = createFixtureState(); E.SCENARIOS.poor_sleep.apply(s);
  const flags = E.evaluateRules(E.compileContext(s)).map(f => f.id);
  for (const id of ['sleep_deficit','recovery_concern','low_recovery','protect_cognition','defer_candidate']) assert.ok(flags.includes(id), id);
});

// --- Meta failure modes never produce unvalidated output ---
test('Meta timeout is bounded and surfaces as a catchable error', async () => {
  const fetchImpl = (url, opts) => new Promise((_, reject) => { opts.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); });
  const pr = new MetaReasoningProvider({ apiKey: 'k', fetchImpl, timeoutMs: 50 });
  await assert.rejects(() => pr.reason({}), /timed out|aborted/i);
});
test('Meta invalid JSON and empty bodies are rejected, never trusted', async () => {
  const bad = new MetaReasoningProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'not json at all' } }] }) }) });
  await assert.rejects(() => bad.reason({}), /non-JSON/);
  const empty = new MetaReasoningProvider({ apiKey: 'k', fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({}) }) });
  await assert.rejects(() => empty.reason({}), /non-JSON/);
  assert.equal(E.validateReasoningResult({ observations: [], affectedAreas: [], recommendations: [], explanation: { summary: 'x' }, confidence: 2 }).ok, false);
});
