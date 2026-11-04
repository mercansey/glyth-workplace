// Glyth Workplace — connect the two Supabase projects by NAME and wire .env.
//   node scripts/connect-supabase.mjs           # find projects + write .env
//   node scripts/connect-supabase.mjs --apply   # also link + push migrations
// Prereq: `supabase login` (or SUPABASE_ACCESS_TOKEN). Keys are written only
// to the gitignored .env; nothing secret is printed.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const apply = process.argv.includes('--apply');
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
function cli(args, opts = {}) {
  try { return execFileSync('supabase', args, { encoding: 'utf8', cwd: opts.cwd || root, stdio: ['ignore', 'pipe', 'pipe'] }); }
  catch (e) { throw new Error(`supabase ${args.slice(0, 2).join(' ')} failed: ${String(e.stderr || e.message).slice(0, 400)}`); }
}
let projects;
try { projects = JSON.parse(cli(['projects', 'list', '-o', 'json'])); }
catch { console.error('\n✖ Not logged in to Supabase.\n  Run:  supabase login\n  Then: node scripts/connect-supabase.mjs --apply\n'); process.exit(1); }
const list = Array.isArray(projects) ? projects : projects.projects || [];
const find = (want) => list.find(p => norm(p.name) === norm(want)) || list.find(p => norm(p.name).includes(norm(want)));
const userProject = find('user context');
const systemProject = find('system context');
if (!userProject || !systemProject) {
  console.error('✖ Could not find both projects by name. Found:', list.map(p => `"${p.name}" (${p.id || p.ref})`).join(', ') || '(none)');
  process.exit(1);
}
const refOf = (p) => p.id || p.ref;
function apiKeys(ref) {
  const out = JSON.parse(cli(['projects', 'api-keys', '--project-ref', ref, '-o', 'json']));
  const arr = Array.isArray(out) ? out : out.keys || [];
  const get = (names) => (arr.find(k => names.includes(k.name) || names.includes(k.id)) || {}).api_key || (arr.find(k => names.includes(k.name)) || {}).key || '';
  return { anon: get(['anon', 'publishable']), service: get(['service_role', 'service-role', 'secret']) };
}
const u = apiKeys(refOf(userProject)); const s = apiKeys(refOf(systemProject));
if (!u.service || !s.service) { console.error('✖ API keys unavailable for one project — check your Supabase role/permissions.'); process.exit(1); }
const existing = fs.existsSync(path.join(root, '.env')) ? fs.readFileSync(path.join(root, '.env'), 'utf8') : '';
const keep = (key) => (existing.match(new RegExp(`^${key}=(.+)$`, 'm')) || [])[1];
const env = { DEMO_MODE: 'true', PORT: keep('PORT') || '3000', MODEL_API_KEY: keep('MODEL_API_KEY') || '', META_MODEL: keep('META_MODEL') || 'muse-spark-1.1', META_API_BASE_URL: 'https://api.meta.ai/v1',
  USER_SUPABASE_URL: `https://${refOf(userProject)}.supabase.co`, USER_SUPABASE_ANON_KEY: u.anon, USER_SUPABASE_SERVICE_KEY: u.service,
  SYSTEM_SUPABASE_URL: `https://${refOf(systemProject)}.supabase.co`, SYSTEM_SUPABASE_ANON_KEY: s.anon, SYSTEM_SUPABASE_SERVICE_KEY: s.service,
  BRIDGE_SALT: keep('BRIDGE_SALT') && !keep('BRIDGE_SALT').startsWith('change-me') ? keep('BRIDGE_SALT') : crypto.randomBytes(24).toString('hex'), MIN_COHORT_SIZE: '5' };
fs.writeFileSync(path.join(root, '.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n');
console.log(`✓ User Context   → ${userProject.name} (${refOf(userProject)})`);
console.log(`✓ System Context → ${systemProject.name} (${refOf(systemProject)})`);
console.log('✓ .env written (gitignored; service keys never printed).');
if (apply) {
  for (const [label, dir, ref] of [['User Context', 'supabase/user-context', refOf(userProject)], ['System Context', 'supabase/system-context', refOf(systemProject)]]) {
    cli(['link', '--project-ref', ref], { cwd: path.join(root, dir) });
    console.log(cli(['db', 'push'], { cwd: path.join(root, dir) }).trim().split('\n').pop());
    console.log(`✓ ${label}: linked + migrations applied`);
  }
  console.log('\nRestart the server (npm start), then:  curl localhost:3000/api/bridge/status   → mode "live"');
} else console.log('\nNext: node scripts/connect-supabase.mjs --apply   (links each project + applies its migrations)');
