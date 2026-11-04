// Glyth Workplace — Supabase bridge client (zero-dependency, server-side only).
// The Node server is the ONLY component holding both service-role keys.
// Browser code must never import this file or receive these keys.
import { buildContributions, gateCohorts, buildDirectiveInboxItem, buildOutcomeAck, MIN_COHORT_SIZE } from './bridge.js';

export function loadBridgeConfig(env = process.env) {
  const pick = (...names) => names.map(n => env[n]).find(v => v && String(v).trim()) || '';
  const user = { url: pick('USER_SUPABASE_URL', 'USER_CONTEXT_SUPABASE_URL'), serviceKey: pick('USER_SUPABASE_SERVICE_KEY', 'USER_SUPABASE_SERVICE_ROLE_KEY'), anonKey: pick('USER_SUPABASE_ANON_KEY') };
  const system = { url: pick('SYSTEM_SUPABASE_URL', 'SYSTEM_CONTEXT_SUPABASE_URL'), serviceKey: pick('SYSTEM_SUPABASE_SERVICE_KEY', 'SYSTEM_SUPABASE_SERVICE_ROLE_KEY'), anonKey: pick('SYSTEM_SUPABASE_ANON_KEY') };
  const clean = (p) => ({ url: p.url.replace(/\/$/, ''), configured: Boolean(p.url && p.serviceKey), anonConfigured: Boolean(p.url && p.anonKey) });
  // Keys are kept in closures via createProjectClient; status exposes booleans only.
  return { user: { ...clean(user), _serviceKey: user.serviceKey, _anonKey: user.anonKey }, system: { ...clean(system), _serviceKey: system.serviceKey, _anonKey: system.anonKey },
    bridgeSalt: env.BRIDGE_SALT || '', minCohortSize: Number(env.MIN_COHORT_SIZE || MIN_COHORT_SIZE) || MIN_COHORT_SIZE };
}

export function publicAuthConfig(config) {
  return { authConfigured: Boolean(config.user.url && config.user._anonKey), supabaseUrl: config.user.url || null, supabaseAnonKey: config.user._anonKey || null };
}
export function publicBridgeStatus(config) {
  return { mode: config.user.configured && config.system.configured ? 'live' : 'demo-unconfigured',
    userContext: { configured: config.user.configured, urlHost: hostOf(config.user.url) },
    systemContext: { configured: config.system.configured, urlHost: hostOf(config.system.url) },
    minCohortSize: config.minCohortSize,
    note: 'Service-role keys stay on the server and are never exposed to the browser.' };
}
const hostOf = (u) => { try { return u ? new URL(u).host : null; } catch { return null; } };

/** Minimal PostgREST client. fetchImpl is injectable for tests. */
export function createProjectClient(project, fetchImpl = fetch) {
  if (!project?.url || !project?._serviceKey) throw new Error('bridge: project is not configured (url + service key required)');
  const base = project.url.replace(/\/$/, '');
  const headers = { apikey: project._serviceKey, Authorization: `Bearer ${project._serviceKey}`, 'Content-Type': 'application/json' };
  async function request(path, { method = 'GET', body, prefer } = {}) {
    const res = await fetchImpl(`${base}/rest/v1/${path}`, { method, headers: { ...headers, ...(prefer ? { Prefer: prefer } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) { console.error(JSON.stringify({ event: 'supabase_request_failed', status: res.status })); throw Object.assign(new Error('bridge: Supabase request failed'), { status: 502 }); }
    return text ? JSON.parse(text) : null;
  }
  return {
    insert: (table, rows) => request(table, { method: 'POST', body: rows, prefer: 'return=representation' }),
    upsert: (table, rows, onConflict) => request(`${table}?on_conflict=${encodeURIComponent(onConflict)}`, { method: 'POST', body: rows, prefer: 'resolution=merge-duplicates,return=representation' }),
    select: (table, query = '') => request(`${table}${query ? `?${query}` : ''}`),
    update: (table, query, patch) => request(`${table}?${query}`, { method: 'PATCH', body: patch, prefer: 'return=representation' }),
  };
}

/**
 * Live sync (requires both projects configured + migrations 003/004 applied):
 *  1. User -> System: pseudonymised contributions into system.bridge_contributions (idempotent upsert).
 *  2. System -> User: pending directives from system.bridge_outbox into user.bridge_inbox, then marked sent.
 */
export async function syncBridge({ config, employerState, userClient, systemClient, day }) {
  const all = [];
  for (const m of employerState.members || []) {
    const orgId = (employerState.teams.find(t => t.id === m.teamId) || {}).orgId || 'org_northstar';
    all.push(...buildContributions({ userId: m.id, orgId, teamId: m.teamId, signals: m.signals, consentedCategories: m.consentedCategories, day, salt: config.bridgeSalt || undefined }).contributions);
  }
  const aggregates = gateCohorts(all, config.minCohortSize);
  let pushed = 0, directivesPulled = 0;
  if (systemClient && all.length) { await systemClient.upsert('bridge_contributions', all, 'idempotency_key'); pushed = all.length; }
  if (userClient && systemClient) {
    const pending = await systemClient.select('bridge_outbox', 'status=eq.pending&order=created_at.asc&limit=50');
    for (const row of pending || []) {
      const item = buildDirectiveInboxItem({ id: row.source_id || row.id, orgId: row.payload?.org_id, teamId: row.payload?.team_id, type: row.payload?.type, title: row.payload?.title, description: row.payload?.description, effectiveDay: row.payload?.effective_day });
      await userClient.upsert('bridge_inbox', [{ ...item, payload: row.payload }], 'idempotency_key');
      await systemClient.update('bridge_outbox', `id=eq.${row.id}`, { status: 'sent', sent_at: new Date().toISOString() });
      directivesPulled++;
    }
  }
  return { mode: userClient && systemClient ? 'live' : 'demo-unconfigured', contributions: all.length, pushed,
    released: aggregates.filter(a => !a.suppressed).length, suppressed: aggregates.filter(a => a.suppressed).length, aggregates, directivesPulled };
}

export { buildOutcomeAck };
