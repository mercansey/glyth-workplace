// Glyth Snapshot — clean-room domain engine. Shared by browser (static demo)
// and the Node API server. No external dependencies.
/** @typedef {import('./types.js').SnapshotState} SnapshotState */

import { recommendMindfulness, ensureMindfulness } from '../mindfulness/mindfulness.js';
let seq = 0;
const uid = (p) => `${p}_${++seq}_${Math.random().toString(36).slice(2, 7)}`;
export const fmtSleep = (m) => m == null ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export function createSeedState() {
  seq = 0;
  return {
    version: 2,
    profile: { name: '', timezone: 'Europe/London', wakeTime: '06:30' },
    baselines: { sleepMinutes: null, recovery: null, energy: null, trainingSessionsPerWeek: null },
    goals: [],
    routines: { wake: null, training: null, deepWork: null, admin: null },
    preferences: { trainingTime: 'morning', protectFocus: true, deferLowValueWhenTired: true },
    currentState: { sleepMinutes: null, sleepQuality: null, recovery: null, energy: null, workload: null, trainingLoad: null, stress: null, consecutivePoorNights: null, readiness: null },
    signals: [],
    plan: [],
    focusPriorities: [],
    recommendations: [],
    interventions: [],
    trends: { labels: [], recoveryConsistency: [], priorityCompletion: [], focusProtection: [] },
    weeklySummary: '',
    insight: { headline: 'No data yet.', body: 'Connect a data source and Glyth will start reasoning over your day.', chain: [] },
    canonical: { healthSignals: [], calendarEvents: [], workouts: [], checkins: [] },
    communications: { accounts: [], threads: [], messages: [] }, devices: [],
    connections: [], dailyHistory: [], baselineMeta: null, insights: [], orchestrationRuns: [], lastOrchestration: null, planAssembledAt: null,
    mindfulness: { activity: [], events: [], lastRecommendation: null },
    finance: { imports: [], transactions: [], merchantRules: [], recurring: [], snapshots: [], analysis: null, privacy: 'PRIVATE_FINANCIAL' },
    fitness: { profile: null, sessions: [], events: [], lastRecommendation: null },
    family: { members: [], dates: [], preferences: [], interactions: [], gifts: [], reminderEvents: [], settings: { important_dates: true, reach_out: true }, privacy: 'PRIVATE_PERSONAL_RELATIONSHIP' },
    lastReasoning: null,
    activeScenario: null,
    scenarioRuns: [],
    aiRuns: [],
    pendingProposal: null,
    conversation: [],
    changesCount: 0,
  };
}

export function readinessOf(s) {
  if ([s.recovery, s.energy, s.stress, s.workload].some(v => v == null)) return null;
  return Math.round(s.recovery * 0.45 + s.energy * 0.3 + (100 - s.stress) * 0.15 + (100 - s.workload) * 0.1);
}
export const hasUserData = (state) => state.currentState.sleepMinutes != null || state.plan.length > 0 || state.signals.length > 0;

// ---- Context Compiler: deterministic, compact packet (never the whole DB) ----
export function compileContext(state) {
  const b = state.baselines, c = state.currentState;
  const cal = state.canonical?.calendarEvents || [];
  const freshness = {}; for (const cn of state.connections || []) freshness[cn.kind] = cn.last_success_at;
  const planned = (state.canonical?.workouts || []).find(w => w.planned) || null;
  return {
    context_version: 1,
    generated_at: new Date().toISOString(),
    data_freshness: freshness,
    training_summary: { recent_load_score: c.trainingLoad, planned_session: planned ? { title: planned.type, intensity: planned.intensity, duration_minutes: planned.duration_minutes } : null },
    calendar_summary: { important: cal.filter(e => e.importance === 'critical').map(e => ({ title: e.title, starts_at: e.starts_at })), flexible_count: cal.filter(e => e.movability === 'flexible').length },
    user_profile: { name: state.profile.name, timezone: state.profile.timezone, wake_time: state.profile.wakeTime },
    active_goals: state.goals.filter(g => g.status === 'active').map(g => ({ name: g.name, category: g.category, priority: g.priority, target: g.target })),
    current_state: { ...c, sleep: fmtSleep(c.sleepMinutes) },
    baselines: { sleep: fmtSleep(b.sleepMinutes), sleepMinutes: b.sleepMinutes, recovery: b.recovery, energy: b.energy },
    deviations: {
      sleepPct: c.sleepMinutes != null && b.sleepMinutes ? Math.round(((c.sleepMinutes - b.sleepMinutes) / b.sleepMinutes) * 100) : null,
      recoveryPts: c.recovery != null && b.recovery != null ? c.recovery - b.recovery : null,
      energyPts: c.energy != null && b.energy != null ? c.energy - b.energy : null,
    },
    important_recent_signals: state.signals.slice(-6),
    today_schedule: state.plan.map(p => ({ id: p.id, time: p.time, title: p.title, type: p.type, priority: p.priority, status: p.status })),
    recent_interventions: state.interventions.slice(0, 3),
    constraints: ['Never move the 14:00 investor meeting', 'Prefer morning training', 'Protect focus when recovery is low'],
    preferences: state.preferences,
  };
}

// ---- Deterministic rule layer (application logic is authoritative) ----
export function evaluateRules(ctx) {
  const c = ctx.current_state, flags = [];
  const sleepDeficit = c.sleepMinutes != null && ctx.baselines.sleepMinutes != null && c.sleepMinutes < ctx.baselines.sleepMinutes * 0.85;
  if (sleepDeficit) flags.push({ id: 'sleep_deficit', kind: 'observed', label: `Sleep ${ctx.current_state.sleep} vs baseline ${ctx.baselines.sleep} (${ctx.deviations.sleepPct}%)` });
  if (sleepDeficit && c.trainingLoad != null && c.trainingLoad >= 60) flags.push({ id: 'recovery_concern', kind: 'inferred', label: 'Sleep deficit + high accumulated training load → elevated recovery concern' });
  if (c.recovery != null && c.recovery < 55) flags.push({ id: 'low_recovery', kind: 'observed', label: `Recovery ${c.recovery}% vs baseline ${ctx.baselines.recovery}%` });
  const hasCritical = ctx.today_schedule.some(p => p.priority === 'critical');
  if (hasCritical && (sleepDeficit || (c.recovery != null && c.recovery < 60))) flags.push({ id: 'protect_cognition', kind: 'heuristic', label: 'High-priority event + reduced recovery → protect pre-event cognitive window' });
  if (c.workload != null && c.workload >= 75) flags.push({ id: 'high_workload', kind: 'observed', label: `Workload ${c.workload}/100` });
  if (((c.workload != null && c.workload >= 75) || sleepDeficit) && ctx.today_schedule.some(p => p.priority === 'low')) flags.push({ id: 'defer_candidate', kind: 'heuristic', label: 'Low-priority work is a candidate for deferral today' });
  if (c.trainingLoad != null && c.trainingLoad >= 80) flags.push({ id: 'high_training_load', kind: 'observed', label: `Training load ${c.trainingLoad}/100` });
  return flags;
}

// ---- Orchestration: rules (+ optional provider enrichment) -> plan changes ----
function snapshotOriginal(item) { if (!item.original) item.original = { time: item.time, title: item.title, durationMin: item.durationMin, status: 'unchanged', note: item.note }; }

export function orchestrate(state, providerNote = null) {
  const ctx = compileContext(state);
  const flags = evaluateRules(ctx);
  const changes = [], recs = [];
  const byId = (id) => state.plan.find(p => p.id === id);
  const change = (item, patch, reason) => { snapshotOriginal(item); Object.assign(item, patch, { status: patch.status || 'changed' }); changes.push({ planItemId: item.id, title: item.title, operation: patch.operation || 'replace', reason }); };

  if (flags.some(f => f.id === 'recovery_concern' || f.id === 'high_training_load') && byId('p_train')?.status !== 'deferred') {
    change(byId('p_train'), { time: '08:00', title: 'Recovery session', durationMin: 35, status: 'replaced', operation: 'replace', note: 'Mobility, zone-1, breathwork. Heavy session moved, not cancelled.' }, 'Reduce training demand while recovery is compromised');
    recs.push({ id: uid('rec'), category: 'training', title: 'Replace heavy strength with recovery session', rationale: 'Sleep is below baseline and training load is already high. Protect adaptation instead of adding strain.', evidence: flags.map(f => f.label), action: { type: 'replace_plan_item', planItemId: 'p_train' }, priority: 'high', confidence: 0.92, status: 'proposed', kind: 'inferred' });
  }
  if (flags.some(f => f.id === 'protect_cognition') && byId('p_focus')) {
    change(byId('p_focus'), { title: 'Protected deep work', operation: 'move', note: 'Notifications off. Deck draft finished before the 14:00 meeting.' }, 'Protect cognitive capacity before a high-value meeting');
    if (!byId('p_recovery')) { const lunchIdx = state.plan.findIndex(x => x.id === 'p_lunch'); state.plan.splice(lunchIdx >= 0 ? lunchIdx + 1 : 2, 0, { id: 'p_recovery', time: '13:15', title: 'Recovery break', type: 'recovery', priority: 'medium', durationMin: 30, status: 'added', note: 'Walk, daylight, no screens. Added by Glyth before the meeting.' }); changes.push({ planItemId: 'p_recovery', title: 'Recovery break', operation: 'add', reason: 'Create a recovery window before the meeting' }); }
    recs.push({ id: uid('rec'), category: 'focus', title: 'Protect 10:00–12:00 deep work', rationale: 'Your highest-value work should happen while attention is freshest, ahead of the 14:00 meeting.', evidence: flags.map(f => f.label), action: { type: 'protect_plan_item', planItemId: 'p_focus' }, priority: 'high', confidence: 0.88, status: 'proposed', kind: 'heuristic' });
  }
  if (flags.some(f => f.id === 'defer_candidate') && byId('p_admin')) {
    change(byId('p_admin'), { status: 'deferred', operation: 'defer', note: 'Deferred to tomorrow 09:00 by Glyth.' }, 'Defer low-value workload to protect energy');
    recs.push({ id: uid('rec'), category: 'workload', title: 'Defer admin to tomorrow', rationale: 'Admin is low priority and movable. Today it competes with recovery and meeting preparation.', evidence: flags.map(f => f.label), action: { type: 'defer_plan_item', planItemId: 'p_admin' }, priority: 'medium', confidence: 0.84, status: 'proposed', kind: 'heuristic' });
  }
  if (state.activeScenario === 'travel_day' && byId('p_train')) {
    change(byId('p_train'), { status: 'deferred', operation: 'defer', note: 'Deferred — travel day.' }, 'Travel displaces morning training');
  }

  if (hasUserData(state)) { try { const mr = recommendMindfulness(state); const doneToday = (state.mindfulness?.activity||[]).some(a=>a.status==='completed'&&a.session_type===mr.sessionType&&String(a.completed_at||'').slice(0,10)===new Date().toISOString().slice(0,10)); if (!doneToday && mr.confidence>=0.55) { recs.push({ id: uid('rec'), category:'mindfulness', title: mr.title, rationale: mr.rationale, evidence: flags.map(f=>f.label), action:{ type:'mindfulness_session', session_type:mr.sessionType, duration_minutes:mr.durationMinutes }, priority: mr.sessionType==='pre_meeting'?'high':'medium', confidence: mr.confidence, status:'proposed', kind:'heuristic' }); state.mindfulness.lastRecommendation = { ...mr, session: undefined, at: new Date().toISOString() }; } } catch { /* mindfulness never blocks orchestration */ } }
  state.currentState.readiness = readinessOf(state.currentState);
  state.recommendations = recs;
  state.changesCount = changes.length;
  state.focusPriorities = changes.length
    ? ['Recover first', 'Protect deep work', 'Prepare for investor meeting']
    : (hasUserData(state) ? ['Train with intent', 'Protect deep work', 'Prepare for investor meeting'] : []);
  const chain = [];
  if (flags.some(f => f.id === 'sleep_deficit')) chain.push('Sleep ↓', 'Recovery ↓', 'Training capacity ↓', 'Attention risk ↑');
  else if (flags.some(f => f.id === 'high_workload')) chain.push('Workload ↑', 'Available energy ↓', 'Low-priority work at risk');
  else if (flags.some(f => f.id === 'high_training_load')) chain.push('Training load ↑', 'Recovery need ↑', 'Next-session quality ↓');

  state.insight = !hasUserData(state) ? { headline: 'No data yet.', body: 'Connect a data source and Glyth will start reasoning over your day.', chain: [] } : changes.length ? {
    headline: flags.some(f => f.id === 'sleep_deficit') ? 'Sleep is affecting today’s performance.' : 'Your context changed — today has been reorganised.',
    body: `${flags.map(f => f.label).join('. ')}. ${providerNote || 'Glyth reduced demand, protected your highest-value work, and deferred what can wait.'}`,
    chain,
  } : { headline: 'You are starting from a stable baseline.', body: 'No rule fired strongly enough to reorganise today. Your plan stands.', chain: [] };

  const critical = state.plan.filter(x => x.priority === 'critical');
  const sleepPctBelow = Math.max(0, Math.round(((state.baselines.sleepMinutes - state.currentState.sleepMinutes) / state.baselines.sleepMinutes) * 100));
  const recentContext = [];
  if (state.currentState.consecutivePoorNights) recentContext.push(`${state.currentState.consecutivePoorNights} consecutive below-baseline night${state.currentState.consecutivePoorNights > 1 ? 's' : ''}`);
  if (state.currentState.trainingLoad >= 60) recentContext.push(`Hard training yesterday — accumulated training load ${state.currentState.trainingLoad}/100`);
  for (const s of state.signals.filter(x => x.type === 'recent_event')) if (!recentContext.includes(String(s.value))) recentContext.push(String(s.value));
  state.lastReasoning = {
    observed: [`Sleep ${fmtSleep(state.currentState.sleepMinutes)}`, `Recovery ${state.currentState.recovery}%`, `Energy ${state.currentState.energy}/100`, `Workload ${state.currentState.workload}/100`],
    comparedWith: [`Sleep baseline ${fmtSleep(state.baselines.sleepMinutes)}`, `Recovery baseline ${state.baselines.recovery}%`],
    recentContext: recentContext.length ? recentContext : ['No unusual recent load'],
    importantToday: critical.length ? critical.map(x => `${x.title} · ${x.time}`) : ['No critical commitment today'],
    summary: changes.length && flags.some(f => f.id === 'sleep_deficit')
      ? `Your sleep is ${sleepPctBelow}% below baseline${state.currentState.trainingLoad >= 60 ? ' after a high-load training day' : ''}. Glyth reduced physical demand and protected the period before your most important commitment.`
      : changes.length ? 'Your context changed, so Glyth reorganised today around your current state and commitments.' : 'Sleep and recovery are at baseline. Today is set up as planned.',
    likelyImpact: flags.length ? flags.map(f => f.label) : ['No material deviation from baseline'],
    affected: [...new Set(recs.map(r => r.category))],
    response: changes.length ? changes.map(c => `${c.operation}: ${c.title} — ${c.reason}`) : ['No changes. Plan stands.'],
    confidence: recs.length ? Math.round(recs.reduce((a, r) => a + r.confidence, 0) / recs.length * 100) : 90,
    flags, changes, provider: providerNote ? 'meta-enriched' : 'deterministic',
  };
  return state.lastReasoning;
}

// ---- Scenarios ----
export const SCENARIOS = {
  poor_sleep: { label: 'Poor Sleep', apply(s) { Object.assign(s.currentState, { sleepMinutes: 282, sleepQuality: 41, recovery: 43, energy: 48, trainingLoad: 78, stress: 57, consecutivePoorNights: 3 }); s.signals.push({ id: uid('sig'), type: 'sleep', value: 282, baseline: 435, source: 'scenario', kind: 'observed', at: 'today 06:30' }, { id: uid('sig'), type: 'recent_event', value: 'Hard training yesterday', baseline: null, source: 'scenario', kind: 'observed', at: 'yesterday 18:00' }); } },
  heavy_workload: { label: 'Heavy Workload', apply(s) { Object.assign(s.currentState, { workload: 92, stress: 68, energy: 57 }); s.signals.push({ id: uid('sig'), type: 'workload', value: 92, baseline: 55, source: 'scenario', kind: 'observed', at: 'today 09:00' }); } },
  hard_training: { label: 'Hard Training', apply(s) { Object.assign(s.currentState, { trainingLoad: 94, recovery: 52, energy: 58 }); s.signals.push({ id: uid('sig'), type: 'training_load', value: 94, baseline: 45, source: 'scenario', kind: 'observed', at: 'yesterday 19:00' }); } },
  important_meeting: { label: 'Important Meeting', apply(s) { Object.assign(s.currentState, { stress: 55, workload: 70 }); const m = s.plan.find(p => p.id === 'p_meeting'); if (m) m.note = 'High-value. Confirmed critical. Preparation protected.'; s.signals.push({ id: uid('sig'), type: 'commitment', value: 'Investor meeting 14:00', baseline: null, source: 'scenario', kind: 'observed', at: 'today' }); } },
  travel_day: { label: 'Travel Day', apply(s) { Object.assign(s.currentState, { sleepMinutes: 360, recovery: 58, energy: 60, stress: 52 }); s.plan.splice(1, 0, { id: 'p_travel', time: '09:15', title: 'Travel to airport', type: 'travel', priority: 'high', durationMin: 75, status: 'new', note: 'Flight 11:40. Added by scenario.' }); s.signals.push({ id: uid('sig'), type: 'travel', value: 'Travel day', baseline: null, source: 'scenario', kind: 'observed', at: 'today' }); } },
};

export function applyScenario(state, key, opts = {}) {
  const sc = SCENARIOS[key]; if (!sc) throw new Error(`Unknown scenario: ${key}`);
  if (state.activeScenario && state.baselineSnapshot) { const snap = structuredClone(state.baselineSnapshot); state.currentState = snap.currentState; state.plan = snap.plan; state.signals = snap.signals; }
  else if (!state.activeScenario) state.baselineSnapshot = structuredClone({ currentState: state.currentState, plan: state.plan, signals: state.signals });
  const before = structuredClone({ currentState: state.currentState, plan: state.plan });
  state.activeScenario = key; sc.apply(state);
  const reasoning = opts.runOrchestration === false ? null : orchestrate(state);
  state.scenarioRuns.push({ id: uid('run'), scenario: key, label: sc.label, before, after: structuredClone({ currentState: state.currentState, plan: state.plan }), reasoning, at: new Date().toISOString() });
  return state;
}

export function resetDemo() { return createSeedState(); }

// ---- Recommendation decisions ----
export function decideRecommendation(state, id, decision) {
  const rec = state.recommendations.find(r => r.id === id); if (!rec) throw new Error('Recommendation not found');
  if (!['accepted', 'rejected', 'modified'].includes(decision)) throw new Error('Invalid decision');
  if (rec.status !== 'proposed') throw new Error(`Invalid recommendation transition: ${rec.status} -> ${decision}`);
  rec.status = decision === 'accepted' ? 'executed' : decision;
  const item = state.plan.find(p => p.id === rec.action.planItemId);
  if (decision === 'rejected' && item?.original) { Object.assign(item, item.original); delete item.original; state.changesCount = Math.max(0, state.changesCount - 1); }
  if (decision === 'accepted') state.interventions.unshift({ id: uid('int'), title: rec.title, outcome: 'Accepted — outcome pending', at: 'Today', kind: rec.kind });
  return rec;
}

// ---- Ask Glyth: typed proposals, confirmation before mutation ----
export function askGlyth(state, message) {
  const m = message.toLowerCase(); const push = (role, text, proposal = null) => { const msg = { id: uid('msg'), role, text, proposal }; state.conversation.push(msg); return msg; };
  push('user', message);
  if (!hasUserData(state)) return push('glyth', 'I do not have any of your data yet. Once sleep, calendar, goals and training are connected, I can explain your day, say what matters most, and propose changes.');
  if (m.includes('if i') || m.includes('still train') || m.includes('what happens')) return push('glyth', 'With sleep at ' + fmtSleep(state.currentState.sleepMinutes) + ' and recovery at ' + state.currentState.recovery + '%, a heavy session raises injury and attention risk and likely blunts the session itself. A recovery session preserves the habit without the cost. If you still want it, say "keep my workout" and I will propose it first.');
  if (m.includes('why') || m.includes('change') || m.includes('reduce')) return push('glyth', state.lastReasoning ? `${state.lastReasoning.summary || ''} Observed: ${state.lastReasoning.observed.join(', ')}. Compared with baseline: ${state.lastReasoning.comparedWith.join(', ')}. So I: ${state.lastReasoning.response.join('; ')}.` : 'Nothing has changed yet today. Run Poor Sleep and I will explain every adjustment.');
  if (m.includes('keep') && (m.includes('workout') || m.includes('train'))) { const train = state.plan.find(p => p.id === 'p_train'); if (!train?.original && train?.title === 'Heavy strength session') return push('glyth', 'Your heavy strength session is already in today\'s plan — nothing to restore.'); return push('glyth', 'I can restore your heavy session and defer admin instead — you will carry more fatigue into the 14:00 meeting. Confirm?', { type: 'restore_training', label: 'Keep workout, defer admin instead' }); }
  if (m.includes('admin') && (m.includes('move') || m.includes('tomorrow') || m.includes('defer'))) return push('glyth', 'Move Admin to tomorrow 09:00?', { type: 'defer_admin', label: 'Move admin to tomorrow' });
  if (m.includes('coach')) return push('glyth', 'Coaches live in Support. Coaching is private — nothing discussed is shared with your employer.');
  if (m.includes('support') || m.includes('help')) return push('glyth', 'Support lives in the Support tab: Mindfulness, Finance, Fitness and Family, plus Workplace Support (confidential people-team resources) and Coaches. Tell me which area, or say "find me a coach".');
  if (m.includes('mindfulness') || m.includes('reset') || m.includes('calm')) { const mr = recommendMindfulness(state); return push('glyth', `For right now I'd suggest ${mr.title.toLowerCase()} (${mr.durationMinutes} min). ${mr.rationale} Open Mindfulness from Support to start it.`); }
  if (m.includes('affecting') || m.includes('noticing')) return push('glyth', state.insight.headline + ' ' + state.insight.body);
  if (m.includes('priorit') || m.includes('matters') || m.includes('focus')) return push('glyth', `Today, in order: ${state.focusPriorities.join(' → ')}. The 14:00 investor meeting is the fixed point; everything else bends around it.`);
  return push('glyth', `Based on your current state (readiness ${state.currentState.readiness}, recovery ${state.currentState.recovery}%), my priorities are: ${state.focusPriorities.join('; ')}. Ask me "why did my plan change?" or say "keep my workout".`);
}

export function confirmProposal(state) {
  const msg = state.conversation.at(-1); if (!msg?.proposal) return state;
  const type = msg.proposal.type; msg.proposal = null;
  if (type === 'restore_training') { const t = state.plan.find(p => p.id === 'p_train'); if (t?.original) { Object.assign(t, t.original, { status: 'changed', note: 'Kept at your request. Heavy session restored.' }); delete t.original; } const a = state.plan.find(p => p.id === 'p_admin'); if (a) { snapshotOriginal(a); a.status = 'deferred'; a.note = 'Deferred to tomorrow at your request.'; } }
  if (type === 'defer_admin') { const a = state.plan.find(p => p.id === 'p_admin'); if (a) { snapshotOriginal(a); a.status = 'deferred'; a.note = 'Deferred to tomorrow 09:00 at your request.'; } }
  state.conversation.push({ id: uid('msg'), role: 'glyth', text: 'Done. Your plan is updated and your choice is saved to Progress.', proposal: null });
  state.interventions.unshift({ id: uid('int'), title: type === 'restore_training' ? 'Kept heavy training at user request' : 'Deferred admin at user request', outcome: 'User-modified recommendation', at: 'Today', kind: 'heuristic' });
  return state;
}

// ---- Structured reasoning validation (provider output gate) ----
export function validateReasoningResult(x) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) return { ok: false, error: 'not an object' };
  for (const k of ['observations', 'affectedAreas', 'recommendations', 'explanation']) if (!(k in x)) return { ok: false, error: `missing ${k}` };
  for (const k of ['observations', 'affectedAreas', 'hypotheses', 'priorityChanges', 'planChanges']) if (k in x && !Array.isArray(x[k])) return { ok: false, error: `${k} must be an array` };
  if (!Array.isArray(x.observations) || !x.observations.every(v => typeof v === 'string')) return { ok: false, error: 'observations must be string[]' };
  if (!Array.isArray(x.affectedAreas) || !x.affectedAreas.every(v => typeof v === 'string')) return { ok: false, error: 'affectedAreas must be string[]' };
  if (!Array.isArray(x.recommendations) || !x.recommendations.every(v => typeof v === 'string' || (v && typeof v === 'object'))) return { ok: false, error: 'recommendations must be an array of strings/objects' };
  const e = x.explanation;
  if (!(typeof e === 'string' || (e && typeof e === 'object' && (typeof e.summary === 'string' || typeof e.text === 'string')))) return { ok: false, error: 'explanation must be a string or {summary}' };
  if ('confidence' in x && !(typeof x.confidence === 'number' && x.confidence >= 0 && x.confidence <= 1)) return { ok: false, error: 'confidence must be a number 0-1' };
  return { ok: true, value: x };
}
export function reasoningExplanationText(parsed) {
  if (!parsed) return '';
  const e = parsed.explanation;
  const text = typeof e === 'string' ? e : (e?.summary || e?.text || '');
  if (text) return String(text);
  const first = Array.isArray(parsed.recommendations) ? parsed.recommendations.find(r => typeof r === 'string') : null;
  return first || 'Meta reasoning supported today\'s deterministic adjustments.';
}
