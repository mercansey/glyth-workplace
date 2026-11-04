// One-time LIVE employer bootstrap (server-side, service keys from .env).
// Creates Northstar in the SYSTEM project, writes bridge-gated aggregates
// into team_signal_aggregates, and seeds goals/interventions/programmes so
// the live employer view has real backend rows. Synthetic participants only;
// aggregates are computed through the same bridge cohort gate as runtime.
// Usage: node scripts/bootstrap-employer.mjs [--user-id=<auth-uuid> --role=owner]
import path from 'node:path'; import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
try { process.loadEnvFile(path.join(root, '.env')); } catch { console.error('Missing .env'); process.exit(1); }
const { loadBridgeConfig, createProjectClient } = await import('../src/bridge/client.js');
const EMP = await import('../src/employer/engine.js');
const B = await import('../src/bridge/bridge.js');
const cfg = loadBridgeConfig();
if (!cfg.system.configured) { console.error('SYSTEM_SUPABASE_URL + SYSTEM_SUPABASE_SERVICE_KEY required'); process.exit(1); }
const client = createProjectClient(cfg.system);
const args = Object.fromEntries(process.argv.slice(2).map(a => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? true]; }));
if (args['list-users']) { if (!cfg.user.configured) { console.error('USER project not configured'); process.exit(1); } const r = await fetch(`${cfg.user.url}/auth/v1/admin/users?per_page=200`, { headers: { apikey: cfg.user._serviceKey, Authorization: `Bearer ${cfg.user._serviceKey}` } }); if (!r.ok) { console.error('Could not list auth users (HTTP ' + r.status + ')'); process.exit(1); } const data = await r.json(); for (const u of data.users || []) console.log(`${u.email || '(no email)'}  ${u.id}`); if (!data.users?.length) console.log('No auth users yet — create an account in the app first.'); process.exit(0); }
const seed = EMP.createEmployerSeed();
const slug = 'northstar';
// A freshly restored Supabase project answers 521/503 for a few minutes
// while its origin wakes. Wait for it instead of failing on first contact.
let [org] = [];
for (let attempt = 1; attempt <= 24; attempt++) {
  try { [org] = await client.select('organisations', `slug=eq.${slug}&limit=1`); break; }
  catch (e) { if (attempt === 24) { console.error('System project still not responding after ~4 minutes. Give the restore more time in the Supabase dashboard, then re-run.'); process.exit(1); } console.log(`System project still waking (attempt ${attempt}) — retrying in 10s…`); await new Promise(r => setTimeout(r, 10000)); }
}
if (!org) [org] = await client.insert('organisations', [{ name: 'Northstar', slug }]);
console.log('organisation', org.id, slug);
const teamIdByName = {};
for (const t of seed.teams) { let [row] = await client.select('teams', `organisation_id=eq.${org.id}&name=eq.${encodeURIComponent(t.name)}&limit=1`); if (!row) [row] = await client.insert('teams', [{ organisation_id: org.id, name: t.name, description: t.description }]); teamIdByName[t.name] = row.id; }
const seedTeamIdByName = Object.fromEntries(seed.teams.map(t => [t.name, t.id]));
// aggregates through the bridge gate, with seed baselines for change%
const { aggregates } = B.demoSync(seed);
const today = new Date().toISOString().slice(0, 10);
const rows = aggregates.map(a => { const seedTeam = seed.teams.find(t => t.id === a.team_id); const base = seed.baselines[a.team_id]?.[a.category] ?? a.value; return { organisation_id: org.id, team_id: teamIdByName[seedTeam.name], signal_type: a.category, period_start: today, period_end: today, value: a.suppressed ? null : a.value, baseline: base, change_percent: a.suppressed || !base ? null : Math.round(((a.value - base) / base) * 100), participant_count: a.participant_count, suppressed: a.suppressed }; });
await client.insert('team_signal_aggregates', rows);
console.log('aggregates written', rows.length, 'suppressed', rows.filter(r => r.suppressed).length);
const goalIdByTitle = {};
for (const g of seed.goals) { let [row] = await client.select('organisation_goals', `organisation_id=eq.${org.id}&title=eq.${encodeURIComponent(g.title)}&limit=1`); if (!row) [row] = await client.insert('organisation_goals', [{ organisation_id: org.id, title: g.title, category: g.category, priority: g.priority, target: g.target, current_value: g.currentValue, status: g.status }]); goalIdByTitle[g.title] = row.id; }
for (const i of seed.interventions) { const team = seed.teams.find(t => t.id === i.teamId); const existing = await client.select('employer_interventions', `organisation_id=eq.${org.id}&title=eq.${encodeURIComponent(i.title)}&limit=1`); if (!existing?.length) await client.insert('employer_interventions', [{ organisation_id: org.id, team_id: team ? teamIdByName[team.name] : null, type: i.type, title: i.title, description: i.description, reason: i.reason, evidence: i.evidence, status: i.status, expected_outcome: i.expectedOutcome, observed_outcome: i.observedOutcome }]); }
console.log('goals + interventions seeded');
for (const p of seed.programmes) { const existing = await client.select('employer_programmes', `id=eq.${p.id}&limit=1`); const goal = seed.goals.find(g => g.id === p.goalId); const row = { id: p.id, org_id: slug, goal_id: goal ? goalIdByTitle[goal.title] : null, team_ids: p.teamIds.map(id => teamIdByName[seed.teams.find(t => t.id === id)?.name]).filter(Boolean), title: p.title, description: p.description, status: p.status, progress: p.progress, target: p.target, intervention_ids: [] }; if (existing?.length) await client.update('employer_programmes', `id=eq.${p.id}`, row); else await client.insert('employer_programmes', [row]); }
console.log('programmes seeded');
let bootstrapUserId = args['user-id'] || null;
if (!bootstrapUserId && args.email) { // resolve the auth user from the USER project (service key, server-side only)
  if (!cfg.user.configured) { console.error('--email needs USER_SUPABASE_URL + USER_SUPABASE_SERVICE_KEY'); process.exit(1); }
  const r = await fetch(`${cfg.user.url}/auth/v1/admin/users?per_page=200`, { headers: { apikey: cfg.user._serviceKey, Authorization: `Bearer ${cfg.user._serviceKey}` } });
  if (!r.ok) { console.error('Could not list auth users from the user project (HTTP ' + r.status + ')'); process.exit(1); }
  const data = await r.json(); const found = (data.users || []).find(u => String(u.email || '').toLowerCase() === String(args.email).toLowerCase());
  if (!found) { console.error(`No auth user with email ${args.email} in the user project — create the account in the app first, then re-run.`); process.exit(1); }
  bootstrapUserId = found.id; console.log('auth user resolved', found.email, bootstrapUserId);
}
if (bootstrapUserId) { args['user-id'] = bootstrapUserId; const role = ['owner','admin','manager','viewer'].includes(args.role) ? args.role : 'owner'; const existing = await client.select('organisation_members', `organisation_id=eq.${org.id}&user_id=eq.${args['user-id']}&limit=1`); if (!existing?.length) await client.insert('organisation_members', [{ organisation_id: org.id, user_id: args['user-id'], role }]); for (const tid of Object.values(teamIdByName)) { const ex = await client.select('team_memberships', `team_id=eq.${tid}&user_id=eq.${args['user-id']}&limit=1`); if (!ex?.length) await client.insert('team_memberships', [{ team_id: tid, user_id: args['user-id'] }]); } console.log('membership granted', bootstrapUserId, role); }
console.log('Done. Set DEMO_MODE=false, restart the server, sign in on the personal app, then open /employer-dashboard/.');
