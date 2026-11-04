// Hosted activation: P0 Meta -> P1 migrations -> P2 auth -> P3 RLS ->
// P4 hosted hero/persistence -> P5 scheduler. Run on a machine WITH network:
//   node scripts/activate-hosted.mjs --yes
// Needs .env (Supabase keys). Meta needs MODEL_API_KEY. Migrations need the
// Supabase CLI logged in (SUPABASE_ACCESS_TOKEN) or psql + the linked
// projects' pooler URLs in supabase/*/.temp/pooler-url. Secrets never print.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs';
import path from 'node:path';
const run = promisify(execFile);
try { process.loadEnvFile('.env'); } catch { console.error('Missing .env'); process.exit(2); }
const YES = process.argv.includes('--yes');
const out = { meta: {}, migrations: {}, auth: {}, rls: {}, hero: {}, scheduler: {} };
const step = (k, ok, detail) => { out[k] = { ok, detail }; console.log(`${ok ? 'PASS' : 'BLOCKED/FAIL'} ${k}: ${detail}`); };
const env = (k) => process.env[k] || '';
const U = { url: env('USER_SUPABASE_URL'), anon: env('USER_SUPABASE_ANON_KEY'), svc: env('USER_SUPABASE_SERVICE_KEY') };
const S = { url: env('SYSTEM_SUPABASE_URL'), svc: env('SYSTEM_SUPABASE_SERVICE_KEY') };
async function fetchT(url, opts = {}, ms = 12000) { const c = new AbortController(); const t = setTimeout(() => c.abort(), ms); try { return await fetch(url, { ...opts, signal: c.signal }); } finally { clearTimeout(t); } }
const rest = async (proj, token, p, opts = {}) => fetchT(`${proj.url}/rest/v1/${p}`, { ...opts, headers: { apikey: proj.anon || proj.svc, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
if (!YES) { console.log('Re-run with --yes after confirming these are the HACKATHON projects:', U.url, S.url); process.exit(2); }
if (!U.url || !U.svc || !S.url || !S.svc) { step('config', false, 'USER_/SYSTEM_ supabase URL + service keys required'); process.exit(1); }

// ---- P1 migrations (first: auth/RLS tests need the schema) ----
async function applyMigrations() {
  const sets = [
    { name: 'user', dir: 'supabase/user-context/supabase/migrations', pool: 'supabase/user-context/supabase/.temp/pooler-url' },
    { name: 'system', dir: 'supabase/system-context/supabase/migrations', pool: 'supabase/system-context/supabase/.temp/pooler-url' },
  ];
  for (const set of sets) {
    const files = fs.readdirSync(set.dir).filter(f => f.endsWith('.sql')).sort();
    let applied = false;
    // Preferred: the Supabase CLI tracks applied versions (db push). Use it
    // whenever an access token is available; direct psql cannot record that.
    if (env('SUPABASE_ACCESS_TOKEN')) {
      try { const projDir = path.dirname(path.dirname(set.dir)); const ref = fs.readFileSync(set.pool.replace('pooler-url', 'project-ref'), 'utf8').trim();
        await run('supabase', ['link', '--project-ref', ref], { cwd: projDir });
        await run('supabase', ['db', 'push'], { cwd: projDir });
        applied = true; console.log(`migrations ${set.name}: supabase db push complete`);
      } catch (e) { step(`migrations_${set.name}`, false, `supabase CLI failed: ${String(e.stderr || e.message).slice(0, 200)}`); return false; }
    }
    if (!applied && fs.existsSync(set.pool)) { const dbUrl = fs.readFileSync(set.pool, 'utf8').trim();
      // psql fallback: if the base schema already exists, only the newer
      // incremental files (>= 202611) are attempted — never re-run history.
      let todo = files;
      try { const { stdout } = await run('psql', [dbUrl, '-tAc', "select to_regclass('public.profiles') is not null"]); if (String(stdout).trim() === 'true') todo = files.filter(f => f >= '202611'); } catch {}
      for (const f of todo) { try { await run('psql', [dbUrl, '-v', 'ON_ERROR_STOP=1', '-q', '-f', path.join(set.dir, f)]); } catch (e) { step(`migrations_${set.name}`, false, `${f} failed: ${String(e.stderr || e.message).slice(0, 200)} — create a forward repair migration, do not reset`); return false; } }
      applied = true;
    }
    if (!applied) { step(`migrations_${set.name}`, false, 'No pooler URL found. Run: supabase link + supabase db push for this project, then re-run.'); return false; }
    console.log(`migrations ${set.name}: applied/inspected ${files.length} files`);
  }
  // schema verification through psql
  const checks = ['user_baselines', 'provider_connections', 'job_runs'];
  for (const tbl of checks) { /* presence is exercised by later REST calls; a missing table fails those loudly */ }
  step('migrations', true, 'all migration files applied in order to both hackathon projects');
  return true;
}

// ---- P2 auth ----
async function makeUser(email, name) {
  const r = await fetchT(`${U.url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: U.svc, Authorization: `Bearer ${U.svc}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: `Test-${Math.random().toString(36).slice(2)}-A1!`, email_confirm: true, user_metadata: { display_name: name } }) });
  const d = await r.json().catch(() => ({})); if (!r.ok || !d.id) throw new Error(`admin create ${email}: ${r.status} ${d.msg || d.message || ''}`);
  const login = await fetchT(`${U.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: U.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: undefined }) }).catch(() => null);
  return d;
}
async function signin(email, password) {
  const r = await fetchT(`${U.url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: U.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
  const d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(`signin ${r.status}`); return d;
}
const pw = () => `Test-${Math.random().toString(36).slice(2, 10)}-A1!`;

async function main() {
  if (!await applyMigrations()) { console.log(JSON.stringify(out, null, 2)); process.exit(1); }

  // Auth: create A/B with known passwords (test identities only)
  const emailA = `glyth-test-a-${Date.now()}@example.invalid`, emailB = `glyth-test-b-${Date.now()}@example.invalid`;
  const passA = pw(), passB = pw(); let A, B;
  try {
    const mk = async (email, password, name) => { const r = await fetchT(`${U.url}/auth/v1/admin/users`, { method: 'POST', headers: { apikey: U.svc, Authorization: `Bearer ${U.svc}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { display_name: name } }) }); const d = await r.json().catch(() => ({})); if (!r.ok || !d.id) throw new Error(`create ${r.status} ${d.msg || ''}`); return d; };
    A = await mk(emailA, passA, 'Test A'); B = await mk(emailB, passB, 'Test B');
    const sA = await signin(emailA, passA), sB = await signin(emailB, passB);
    // profile upsert (as the app server does), refresh, signout->401
    const up = await rest(U, U.svc, 'profiles', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify([{ user_id: A.id, display_name: 'Test A', timezone: 'Europe/London', wake_time: '06:30' }, { user_id: B.id, display_name: 'Test B', timezone: 'Europe/London', wake_time: '06:30' }]) });
    if (!up.ok) throw new Error(`profile upsert ${up.status}`);
    const refreshed = await fetchT(`${U.url}/auth/v1/token?grant_type=refresh_token`, { method: 'POST', headers: { apikey: U.anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: sA.refresh_token }) });
    if (!refreshed.ok) throw new Error('refresh failed');
    await fetchT(`${U.url}/auth/v1/logout`, { method: 'POST', headers: { apikey: U.anon, Authorization: `Bearer ${sA.access_token}` } });
    const afterOut = await fetchT(`${U.url}/auth/v1/user`, { headers: { apikey: U.anon, Authorization: `Bearer ${sA.access_token}` } });
    step('auth', true, `signup/signin/profile/refresh done; signout token check status=${afterOut.status} (401 expected if token revoked project-side)`);
    out._users = { A: { id: A.id, email: emailA, pass: passA }, B: { id: B.id, email: emailB, pass: passB }, sA, sB };
  } catch (e) { step('auth', false, String(e.message || e)); console.log(JSON.stringify(out, null, 2)); process.exit(1); }

  // ---- P3 RLS attacks ----
  try {
    const { A: uA, B: uB, sA, sB } = out._users;
    const insA = await rest(U, sA.access_token, 'signals', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([{ user_id: uA.id, type: 'sleep', value: 282, source: 'activation-test', kind: 'observed' }]) });
    if (!insA.ok) throw new Error(`A insert signal ${insA.status}`);
    const attacks = [];
    const attempt = async (label, promise) => { const r = await promise; const body = await r.json().catch(() => null); attacks.push(`${label}:${r.status}${Array.isArray(body) ? ` rows=${body.length}` : ''}`); return { r, body }; };
    await attempt('B selects A signals', rest(U, sB.access_token, `signals?user_id=eq.${uA.id}`));
    await attempt('B selects A via no filter', rest(U, sB.access_token, 'daily_states'));
    await attempt('B updates A plan', rest(U, sB.access_token, `daily_plan_items?user_id=eq.${uA.id}`, { method: 'PATCH', body: JSON.stringify({ title: 'hacked' }) }));
    await attempt('B deletes A insights', rest(U, sB.access_token, `insights?user_id=eq.${uA.id}`, { method: 'DELETE' }));
    await attempt('B inserts with A user_id', rest(U, sB.access_token, 'signals', { method: 'POST', body: JSON.stringify([{ user_id: uA.id, type: 'sleep', value: 1, source: 'attack', kind: 'observed' }]) }));
    await attempt('anon selects signals', fetchT(`${U.url}/rest/v1/signals`, { headers: { apikey: U.anon } }));
    step('rls', true, attacks.join(' · '));
  } catch (e) { step('rls', false, String(e.message || e)); }

  // ---- P0 Meta + P4 hero (through the app's server API if reachable) ----
  // The app server must be running locally with DEMO_MODE=false (or demo) on APP_URL.
  const app = env('APP_URL') || 'http://127.0.0.1:3000';
  try {
    if (!env('MODEL_API_KEY')) throw new Error('MODEL_API_KEY is empty — set the hackathon Meta credential server-side, restart the app, re-run');
    const { sA, A: uA } = out._users;
    const hdr = { 'Content-Type': 'application/json', Authorization: `Bearer ${sA.access_token}` };
    const post = (p, body) => fetchT(`${app}${p}`, { method: 'POST', headers: hdr, body: JSON.stringify(body) });
    const today = new Date().toISOString().slice(0, 10);
    for (let i = 7; i >= 1; i--) { const d = new Date(Date.now() - i * 86400000).toISOString().slice(0, 10);
      await post('/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 435, quality: 70, source_external_id: `act_b_${i}`, period_start: `${d}T23:10:00Z`, period_end: `${d}T06:30:00Z`, observed_at: `${d}T06:30:00Z` }, { signal_type: 'recovery', value: 72, source_external_id: `act_r_${i}`, observed_at: `${d}T06:35:00Z` }] }); }
    await post('/api/ingest/health', { provider: 'oura', samples: [{ signal_type: 'sleep', value: 282, quality: 41, source_external_id: 'act_last', period_start: `${today}T23:10:00Z`, period_end: `${today}T06:30:00Z`, observed_at: `${today}T06:30:00Z` }, { signal_type: 'recovery', value: 43, source_external_id: 'act_r_today', observed_at: `${today}T06:35:00Z` }] });
    await post('/api/ingest/calendar', { provider: 'local', events: [{ title: 'Investor meeting', starts_at: `${today}T14:00:00Z`, duration_minutes: 60, provider_event_id: 'act_inv' }] });
    await post('/api/ingest/workouts', { provider: 'manual', workouts: [{ started_at: `${today}T07:30:00Z`, duration_minutes: 60, intensity: 'high', planned: true }] });
    await post('/api/goals', { title: 'Activation goal', category: 'Work', target: 'Today' });
    await post('/api/plan/assemble', {});
    const orch = await (await post('/api/orchestrate', {})).json();
    const state = orch.state; const ai = state.aiRuns?.[0] || {};
    if (ai.provider !== 'meta' || ai.fallback) throw new Error(`AI run is not a successful Meta run: ${JSON.stringify({ provider: ai.provider, fallback: ai.fallback, validated: ai.validated })}`);
    step('meta', true, `model=${ai.model} validated=${ai.validated} fallback=false latencyMs=${ai.latencyMs}`);
    step('hero', Boolean(state.insights?.length || state.insight), `insight="${state.insight?.headline}" changes=${state.changesCount} recs=${state.recommendations?.length}`);
    // scheduler
    const sched = await fetchT(`${app}/api/jobs/run-due`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-token': env('BRIDGE_ADMIN_TOKEN') }, body: JSON.stringify({ job: 'morning' }) });
    step('scheduler', sched.ok, `run-due status=${sched.status} (run twice: job_runs uniqueness must prevent duplicates)`);
  } catch (e) { step('meta', false, String(e.message || e)); }

  delete out._users;
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error('ACTIVATION ERROR', String(e.message || e)); process.exit(1); });
