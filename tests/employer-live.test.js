import { test } from 'node:test'; import assert from 'node:assert/strict';
import * as EMP from '../src/employer/engine.js';
import { createEmployerRepository, actorForUser } from '../src/employer/repository.js';
import { execFile } from 'node:child_process'; import { promisify } from 'node:util';

// Fake system-project PostgREST client (bridge createProjectClient shape).
function fakeSystem(tables) {
  const parse = (q) => { const out = { filters: {}, limit: null, order: null }; for (const part of String(q||'').split('&').filter(Boolean)) { const [k, v] = part.split('='); if (k==='limit') out.limit = Number(v); else if (k==='order') out.order = v; else if (v?.startsWith('eq.')) out.filters[k] = v.slice(3); } return out; };
  return {
    async select(table, q='') { const { filters, limit } = parse(q); let rows = (tables[table]||[]).filter(r => Object.entries(filters).every(([k,v]) => String(r[k]) === decodeURIComponent(v))); if (limit) rows = rows.slice(0, limit); return structuredClone(rows); },
    async insert(table, rows) { tables[table] ||= []; const made = rows.map(r => ({ id: r.id || `db_${tables[table].length+1}`, created_at: new Date().toISOString(), ...r })); tables[table].push(...made); return structuredClone(made); },
    async upsert(table, rows) { tables[table] ||= []; for (const r of rows) { const i = tables[table].findIndex(x => x.id === r.id); if (i>=0) tables[table][i] = { ...tables[table][i], ...r }; else tables[table].push({ created_at: new Date().toISOString(), ...r }); } return structuredClone(rows); },
    async update(table, q, patch) { const { filters } = parse(q); for (const r of tables[table]||[]) if (Object.entries(filters).every(([k,v]) => String(r[k]) === decodeURIComponent(v))) Object.assign(r, patch); return []; },
  };
}
function liveTables() { return {
  organisations: [{ id:'org-uuid-1', name:'Northstar', slug:'northstar' }],
  teams: [{ id:'team-prod', organisation_id:'org-uuid-1', name:'Product', description:'Delivery' }, { id:'team-people', organisation_id:'org-uuid-1', name:'People', description:'Small' }],
  organisation_goals: [{ id:'goal-1', organisation_id:'org-uuid-1', title:'Improve focus capacity', priority:1, target:'+10%', current_value:64, status:'active', category:'focus' }],
  employer_interventions: [{ id:'int-1', organisation_id:'org-uuid-1', team_id:'team-prod', type:'protect_focus', title:'Protect focus window', description:'d', reason:'r', evidence:[], status:'proposed', expected_outcome:'e', observed_outcome:null, created_at:'2026-11-04T08:00:00Z', started_at:null, completed_at:null }],
  employer_programmes: [{ id:'prog_focus', org_id:'northstar', goal_id:'goal-1', team_ids:['team-prod'], title:'Focus Protection', description:'d', status:'active', progress:64, target:'+10%', intervention_ids:['int-1'] }],
  team_signal_aggregates: [
    { organisation_id:'org-uuid-1', team_id:'team-prod', signal_type:'workload', value:68, baseline:58, change_percent:17, participant_count:13, suppressed:false, created_at:'2026-11-04T08:00:00Z' },
    { organisation_id:'org-uuid-1', team_id:'team-prod', signal_type:'capacity', value:74, baseline:76, change_percent:-3, participant_count:13, suppressed:false, created_at:'2026-11-04T08:00:00Z' },
    { organisation_id:'org-uuid-1', team_id:'team-people', signal_type:'workload', value:null, baseline:41, change_percent:null, participant_count:3, suppressed:true, created_at:'2026-11-04T08:00:00Z' },
  ],
  employer_ai_runs: [], organisation_members: [{ user_id:'user-1', organisation_id:'org-uuid-1', role:'manager' }, { user_id:'user-2', organisation_id:'org-uuid-1', role:'viewer' }],
  team_memberships: [{ team_id:'team-prod', user_id:'user-1' }],
}; }

test('live repository: aggregates become precomputed engine state, no individual rows anywhere', async () => {
  const repo = createEmployerRepository(fakeSystem(liveTables()));
  const { state, actor } = await repo.loadStateForUser('user-1');
  assert.ok(state.live); assert.equal(actor.role, 'manager'); assert.deepEqual(actor.teamIds, ['team-prod']); assert.equal(state.members.length, 0);
  const agg = EMP.aggregateOrg(state, 'northstar'); const prod = agg.teams.find(t=>t.name==='Product'); const people = agg.teams.find(t=>t.name==='People');
  assert.equal(prod.metrics.workload.value, 68); assert.equal(prod.metrics.workload.changePercent, 17); assert.equal(people.metrics.workload.suppressed, true); assert.equal(people.metrics.workload.value, null);
  assert.ok(!JSON.stringify(state).includes('"signals"')); assert.equal(actorForUser(state, 'nobody'), null);
  const denied = await repo.loadStateForUser('outsider'); assert.equal(denied.state, null);
});

test('live repository: intervention decision persists through save + reload', async () => {
  const tables = liveTables(); const repo = createEmployerRepository(fakeSystem(tables));
  const { state, actor } = await repo.loadStateForUser('user-1');
  EMP.decideIntervention(state, actor, 'northstar', 'int-1', 'approve'); assert.ok(state.interventions[0].outcomeBaseline?.value >= 0 || state.interventions[0].outcomeBaseline === null);
  await repo.saveState(state);
  assert.equal(tables.employer_interventions[0].status, 'active');
  const again = await repo.loadStateForUser('user-1'); assert.equal(again.state.interventions[0].status, 'active');
  assert.throws(() => EMP.decideIntervention(again.state, actorForUser(again.state, 'user-2'), 'northstar', 'int-1', 'complete'), /cannot manage/);
});

test('live mode HTTP: employer routes require Supabase auth (401 without a token)', async () => {
  const run = promisify(execFile); const serverUrl = new URL('../server/server.js', import.meta.url).href;
  const script = `import { server } from ${JSON.stringify(serverUrl)}; import { Readable } from 'node:stream';
    const call = (method, urlPath, headers={}) => new Promise((resolve) => { const req = Readable.from([]); req.method = method; req.url = urlPath; req.headers = headers; req.socket = { remoteAddress: '127.0.0.1' }; const res = { setHeader(){}, writeHead(code){ this.code=code; }, end(){ resolve(this.code); } }; server.emit('request', req, res); });
    console.log('OVERVIEW=' + await call('GET', '/api/employer/overview'));
    console.log('ACTORS=' + await call('GET', '/api/employer/actors'));`;
  const { stdout } = await run(process.execPath, ['--input-type=module', '-e', script], { env: { ...process.env, DEMO_MODE: 'false' }, timeout: 20000 });
  assert.match(stdout, /OVERVIEW=401/); assert.match(stdout, /ACTORS=401/);
});
