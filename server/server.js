// Glyth Snapshot API — zero-dependency Node server. Serves the static app
// and typed /api routes. Secrets stay server-side; DEMO_MODE needs none.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import * as E from '../src/domain/engine.js';
import * as EMP from '../src/employer/engine.js';
import { createProvider, MetaReasoningProvider } from '../src/ai/providers.js';
import { validateReasoningResult } from '../src/domain/engine.js';
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT || 3000);
const DEMO = process.env.DEMO_MODE !== 'false';
let state = E.createSeedState();
let employerState = EMP.createEmployerSeed();
const provider = createProvider();
const send = (res, code, body, type = 'application/json') => { res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' }); res.end(type === 'application/json' ? JSON.stringify(body) : body); };
const body = async (req) => { let d = ''; for await (const c of req) d += c; return d ? JSON.parse(d) : {}; };
const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.json': 'application/json', '.md': 'text/plain' };
async function orchestrateWithAI(res) {
  const started = Date.now(); let note = null, used = 'deterministic', validated = true;
  if (provider instanceof MetaReasoningProvider && provider.configured) {
    try { const ctx = E.compileContext(state); const r = await provider.reason(ctx); const v = validateReasoningResult(r.parsed); if (!v.ok) throw new Error(v.error); note = r.parsed.explanation; used = 'meta'; state.aiRuns.unshift({ id: `ai_${Date.now()}`, provider: 'meta', model: provider.model, latencyMs: r.latencyMs, validated: true, fallback: false, at: new Date().toISOString() }); }
    catch (e) { validated = false; state.aiRuns.unshift({ id: `ai_${Date.now()}`, provider: 'meta', latencyMs: Date.now() - started, validated: false, fallback: true, error: String(e.message || e), at: new Date().toISOString() }); }
  }
  const reasoning = E.orchestrate(state, note);
  return reasoning;
}
// Employer actor: demo header/query (x-actor-id / ?actor=), default demo owner.
// Server-side permission checks live in src/employer/engine.js — never UI-only.
const actorOf = (req, url) => employerState.actors.find(a => a.id === (req.headers['x-actor-id'] || url.searchParams.get('actor') || 'actor_owner')) || null;
function employerRoute(req, res, url) {
  const orgId = url.searchParams.get('org') || 'org_northstar';
  const actor = actorOf(req, url);
  const parts = url.pathname.split('/').filter(Boolean); // api, employer, ...
  const sub = parts[2] || '';
  try {
    EMP.assertViewOrg(actor, orgId);
    if (sub === 'overview' && req.method === 'GET') { const agg = EMP.aggregateOrg(employerState, orgId); return send(res, 200, { organisation: employerState.organisations.find(o=>o.id===orgId), actor, minCohortSize: employerState.minCohortSize, stateLabel: agg.stateLabel, withinNormalCapacityPercent: agg.withinNormalCapacityPercent, summary: agg.summary, dimensions: agg.dimensions, signals: EMP.evaluateEmployerRules(employerState, orgId), recommendations: employerState.interventions.filter(i=>i.orgId===orgId && i.status==='proposed'), timeline: employerState.timeline, goals: employerState.goals.filter(g=>g.orgId===orgId && g.status==='active'), teams: agg.teams, privacy: 'Aggregated from consented participants. Individual data is never shown to employers.' }); }
    if (sub === 'teams' && req.method === 'GET' && !parts[3]) { const agg = EMP.aggregateOrg(employerState, orgId); return send(res, 200, { teams: agg.teams.filter(t => EMP.canViewTeam(actor, employerState.teams.find(x=>x.id===t.teamId))) }); }
    if (sub === 'teams' && req.method === 'GET' && parts[3]) { const team = employerState.teams.find(t=>t.id===parts[3] && t.orgId===orgId); if (!team) return send(res, 404, { error: 'team not found' }); if (!EMP.canViewTeam(actor, team)) return send(res, 403, { error: 'forbidden: team not in scope' }); const summary = EMP.aggregateTeam(employerState, team); return send(res, 200, { team: summary, members: EMP.teamRoster(employerState, team), signals: EMP.evaluateEmployerRules(employerState, orgId).filter(s=>s.teamId===team.id), interventions: employerState.interventions.filter(i=>i.orgId===orgId && i.teamId===team.id), suggestedResponse: team.id==='t_product' ? 'Protect two focus windows over the next 48 hours.' : team.id==='t_engineering' ? 'Move two low-priority recurring meetings.' : 'Maintain current rhythm.' }); }
    if (sub === 'insights' && req.method === 'GET') return send(res, 200, EMP.employerInsight(employerState, orgId));
    if (sub === 'context' && req.method === 'GET') return send(res, 200, EMP.compileEmployerContext(employerState, orgId));
    if (sub === 'goals' && req.method === 'GET') return send(res, 200, { goals: employerState.goals.filter(g=>g.orgId===orgId) });
    if (sub === 'interventions' && req.method === 'GET' && !parts[3]) return send(res, 200, { interventions: employerState.interventions.filter(i=>i.orgId===orgId) });
    if (sub === 'interventions' && parts[3] && parts[4] === 'outcome' && req.method === 'GET') { const i = employerState.interventions.find(x=>x.id===parts[3] && x.orgId===orgId); if (!i) return send(res, 404, { error: 'not found' }); return send(res, 200, { intervention: i, outcome: i.observedOutcome }); }
    if (sub === 'interventions' && parts[3] && req.method === 'POST') { return body(req).then(async (b) => { try { const i = EMP.decideIntervention(employerState, actor, orgId, parts[3], b.decision); return send(res, 200, { intervention: i }); } catch (e) { return send(res, e.status || 400, { error: String(e.message || e) }); } }); }
    if (sub === 'scenario' && req.method === 'POST') { return body(req).then(async (b) => { try { const insight = EMP.applyEmployerScenario(employerState, orgId, b.scenario); return send(res, 200, { insight, interventions: employerState.interventions.filter(i=>i.orgId===orgId) }); } catch (e) { return send(res, e.status || 400, { error: String(e.message || e) }); } }); }
    if (sub === 'reset' && req.method === 'POST') { employerState = EMP.resetEmployerDemo(); state = E.resetDemo(); return send(res, 200, { ok: true }); }
    if (sub === 'actors' && req.method === 'GET') return send(res, 200, { actors: employerState.actors });
    return send(res, 404, { error: 'not found' });
  } catch (e) { return send(res, e.status || 400, { error: String(e.message || e) }); }
}
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/employer/')) return employerRoute(req, res, url);
    if (url.pathname === '/api/state' && req.method === 'GET') return send(res, 200, { state, demoMode: DEMO, provider: provider.name });
    if (url.pathname === '/api/flowid' && req.method === 'GET') return send(res, 200, E.compileContext(state));
    if (url.pathname === '/api/orchestrate' && req.method === 'POST') { await orchestrateWithAI(); return send(res, 200, { state }); }
    if (url.pathname === '/api/scenario' && req.method === 'POST') { const { scenario } = await body(req); if (scenario === 'reset') { state = E.resetDemo(); employerState = EMP.resetEmployerDemo(); } else { E.applyScenario(state, scenario); await orchestrateWithAI(); } return send(res, 200, { state }); }
    if (url.pathname === '/api/reset' && req.method === 'POST') { state = E.resetDemo(); employerState = EMP.resetEmployerDemo(); return send(res, 200, { state }); }
    if (url.pathname === '/api/recommendation' && req.method === 'POST') { const { id, decision } = await body(req); E.decideRecommendation(state, id, decision); return send(res, 200, { state }); }
    if (url.pathname === '/api/ask' && req.method === 'POST') { const { message } = await body(req); if (!message || typeof message !== 'string') return send(res, 400, { error: 'message required' }); E.askGlyth(state, message.slice(0, 500)); return send(res, 200, { state }); }
    if (url.pathname === '/api/proposal/confirm' && req.method === 'POST') { E.confirmProposal(state); return send(res, 200, { state }); }
    if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    let file = url.pathname === '/' ? '/index.html' : url.pathname;
    if (file === '/employer-dashboard' || file === '/employer-dashboard/') file = '/employer-dashboard/index.html';
    const fp = path.join(root, file); if (!fp.startsWith(root)) return send(res, 403, 'forbidden', 'text/plain');
    fs.readFile(fp, (err, data) => err ? send(res, 404, 'not found', 'text/plain') : send(res, 200, data, MIME[path.extname(fp)] || 'text/plain'));
  } catch (e) { send(res, e.status || 400, { error: String(e.message || e) }); }
});
server.listen(PORT, '127.0.0.1', () => console.log(`Glyth Snapshot on http://127.0.0.1:${PORT} (provider: ${provider.name}, demo: ${DEMO})`));
