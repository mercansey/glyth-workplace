// Glyth Snapshot — clean-room domain engine. Shared by browser (static demo)
// and the Node API server. No external dependencies.
/** @typedef {import('./types.js').SnapshotState} SnapshotState */

const BASELINES = { sleepMinutes: 435, recovery: 72, energy: 74, trainingSessionsPerWeek: 4 };
let seq = 0;
const uid = (p) => `${p}_${++seq}_${Math.random().toString(36).slice(2, 7)}`;
export const fmtSleep = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

export function createSeedState() {
  seq = 0;
  return {
    version: 1,
    profile: { name: 'Alex', timezone: 'Europe/London', wakeTime: '06:30' },
    baselines: { ...BASELINES },
    goals: [
      { id: 'g_strength', name: 'Improve strength', category: 'Health', priority: 1, target: '4 sessions / week', status: 'active', progress: 68 },
      { id: 'g_work', name: 'Protect work performance', category: 'Work', priority: 1, target: '2 protected focus blocks / day', status: 'active', progress: 74 },
      { id: 'g_recovery', name: 'Improve recovery consistency', category: 'Health', priority: 2, target: 'Recovery ≥ 65 on 5 days / week', status: 'active', progress: 52 },
    ],
    routines: { wake: '06:30', training: '07:30', deepWork: '10:00', admin: '17:00' },
    preferences: { trainingTime: 'morning', protectFocus: true, deferLowValueWhenTired: true },
    currentState: { sleepMinutes: 435, sleepQuality: 78, recovery: 72, energy: 74, workload: 55, trainingLoad: 45, stress: 38, consecutivePoorNights: 0, readiness: 74 },
    signals: [
      { id: uid('sig'), type: 'sleep', value: 435, baseline: 435, source: 'demo', kind: 'observed', at: 'today 06:30' },
      { id: uid('sig'), type: 'recovery', value: 72, baseline: 72, source: 'demo', kind: 'observed', at: 'today 06:30' },
    ],
    plan: [
      { id: 'p_train', time: '07:30', title: 'Heavy strength session', type: 'training', priority: 'high', durationMin: 60, status: 'unchanged', note: 'Week 6, lower body' },
      { id: 'p_focus', time: '10:00', title: 'Deep work', type: 'work', priority: 'high', durationMin: 120, status: 'unchanged', note: 'Investor deck draft' },
      { id: 'p_lunch', time: '12:30', title: 'Lunch', type: 'meal', priority: 'medium', durationMin: 45, status: 'unchanged', note: '' },
      { id: 'p_meeting', time: '14:00', title: 'Investor meeting', type: 'meeting', priority: 'critical', durationMin: 60, status: 'unchanged', note: 'High-value. Do not move.' },
      { id: 'p_admin', time: '17:00', title: 'Admin', type: 'admin', priority: 'low', durationMin: 45, status: 'unchanged', note: 'Email, expenses, scheduling' },
    ],
    focusPriorities: ['Train with intent', 'Protect deep work', 'Prepare for investor meeting'],
    recommendations: [],
    interventions: [
      { id: uid('int'), title: 'Moved intense training off meeting day', outcome: 'Meeting-day energy remained stable', at: 'Last Tuesday', kind: 'heuristic' },
      { id: uid('int'), title: 'Protected 10:00–12:00 focus after late night', outcome: 'Deck draft completed before 14:00', at: 'Last Thursday', kind: 'heuristic' },
    ],
    trends: { labels: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], recoveryConsistency: [70,66,72,58,64,71,72], priorityCompletion: [3,2,3,2,3,1,3], focusProtection: [2,2,1,2,2,0,2] },
    weeklySummary: 'This week, reduced sleep correlated with lower morning readiness. Moving intense training away from high-value workdays improved adherence to both training and work priorities.',
    insight: { headline: 'You are starting from a stable baseline.', body: 'Sleep and recovery are at baseline. Today is set up for a full training session and protected focus.', chain: [] },
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
  return Math.round(s.recovery * 0.45 + s.energy * 0.3 + (100 - s.stress) * 0.15 + (100 - s.workload) * 0.1);
}

// ---- Context Compiler: deterministic, compact packet (never the whole DB) ----
export function compileContext(state) {
  const b = state.baselines, c = state.currentState;
  return {
    user_profile: { name: state.profile.name, timezone: state.profile.timezone, wake_time: state.profile.wakeTime },
    active_goals: state.goals.filter(g => g.status === 'active').map(g => ({ name: g.name, category: g.category, priority: g.priority, target: g.target })),
    current_state: { ...c, sleep: fmtSleep(c.sleepMinutes) },
    baselines: { sleep: fmtSleep(b.sleepMinutes), sleepMinutes: b.sleepMinutes, recovery: b.recovery, energy: b.energy },
    deviations: {
      sleepPct: Math.round(((c.sleepMinutes - b.sleepMinutes) / b.sleepMinutes) * 100),
      recoveryPts: c.recovery - b.recovery,
      energyPts: c.energy - b.energy,
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
  const sleepDeficit = c.sleepMinutes < ctx.baselines.sleepMinutes * 0.85;
  if (sleepDeficit) flags.push({ id: 'sleep_deficit', kind: 'observed', label: `Sleep ${ctx.current_state.sleep} vs baseline ${ctx.baselines.sleep} (${ctx.deviations.sleepPct}%)` });
  if (sleepDeficit && c.trainingLoad >= 60) flags.push({ id: 'recovery_concern', kind: 'inferred', label: 'Sleep deficit + high accumulated training load → elevated recovery concern' });
  if (c.recovery < 55) flags.push({ id: 'low_recovery', kind: 'observed', label: `Recovery ${c.recovery}% vs baseline ${ctx.baselines.recovery}%` });
  const hasCritical = ctx.today_schedule.some(p => p.priority === 'critical');
  if (hasCritical && (sleepDeficit || c.recovery < 60)) flags.push({ id: 'protect_cognition', kind: 'heuristic', label: 'High-priority event + reduced recovery → protect pre-event cognitive window' });
  if (c.workload >= 75) flags.push({ id: 'high_workload', kind: 'observed', label: `Workload ${c.workload}/100` });
  if ((c.workload >= 75 || sleepDeficit) && ctx.today_schedule.some(p => p.priority === 'low')) flags.push({ id: 'defer_candidate', kind: 'heuristic', label: 'Low-priority work is a candidate for deferral today' });
  if (c.trainingLoad >= 80) flags.push({ id: 'high_training_load', kind: 'observed', label: `Training load ${c.trainingLoad}/100` });
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
    change(byId('p_train'), { time: '08:00', title: 'Recovery session', durationMin: 35, operation: 'replace', note: 'Mobility, zone-1, breathwork. Heavy session moved, not cancelled.' }, 'Reduce training demand while recovery is compromised');
    recs.push({ id: uid('rec'), category: 'training', title: 'Replace heavy strength with recovery session', rationale: 'Sleep is below baseline and training load is already high. Protect adaptation instead of adding strain.', evidence: flags.map(f => f.label), action: { type: 'replace_plan_item', planItemId: 'p_train' }, priority: 'high', confidence: 0.92, status: 'proposed', kind: 'inferred' });
  }
  if (flags.some(f => f.id === 'protect_cognition') && byId('p_focus')) {
    change(byId('p_focus'), { title: 'Protected deep work', operation: 'move', note: 'Notifications off. Deck draft finished before the 14:00 meeting.' }, 'Protect cognitive capacity before a high-value meeting');
    if (!byId('p_recovery')) { state.plan.splice(2, 0, { id: 'p_recovery', time: '12:30', title: 'Recovery / meal', type: 'recovery', priority: 'medium', durationMin: 45, status: 'new', note: 'Eat, walk, no screens. Added by Glyth.' }); changes.push({ planItemId: 'p_recovery', title: 'Recovery / meal', operation: 'add', reason: 'Create a recovery window before the meeting' }); }
    recs.push({ id: uid('rec'), category: 'focus', title: 'Protect 10:00–12:00 deep work', rationale: 'Your highest-value work should happen while attention is freshest, ahead of the 14:00 meeting.', evidence: flags.map(f => f.label), action: { type: 'protect_plan_item', planItemId: 'p_focus' }, priority: 'high', confidence: 0.88, status: 'proposed', kind: 'heuristic' });
  }
  if (flags.some(f => f.id === 'defer_candidate') && byId('p_admin')) {
    change(byId('p_admin'), { status: 'deferred', operation: 'defer', note: 'Deferred to tomorrow 09:00 by Glyth.' }, 'Defer low-value workload to protect energy');
    recs.push({ id: uid('rec'), category: 'workload', title: 'Defer admin to tomorrow', rationale: 'Admin is low priority and movable. Today it competes with recovery and meeting preparation.', evidence: flags.map(f => f.label), action: { type: 'defer_plan_item', planItemId: 'p_admin' }, priority: 'medium', confidence: 0.84, status: 'proposed', kind: 'heuristic' });
  }
  if (state.activeScenario === 'travel_day' && byId('p_train')) {
    change(byId('p_train'), { status: 'deferred', operation: 'defer', note: 'Deferred — travel day.' }, 'Travel displaces morning training');
  }

  state.currentState.readiness = readinessOf(state.currentState);
  state.recommendations = recs;
  state.changesCount = changes.length;
  state.focusPriorities = changes.length
    ? ['Recover first', 'Protect deep work', 'Prepare for investor meeting']
    : ['Train with intent', 'Protect deep work', 'Prepare for investor meeting'];
  const chain = [];
  if (flags.some(f => f.id === 'sleep_deficit')) chain.push('Sleep ↓', 'Recovery ↓', 'Training capacity ↓', 'Attention risk ↑');
  else if (flags.some(f => f.id === 'high_workload')) chain.push('Workload ↑', 'Available energy ↓', 'Low-priority work at risk');
  else if (flags.some(f => f.id === 'high_training_load')) chain.push('Training load ↑', 'Recovery need ↑', 'Next-session quality ↓');

  state.insight = changes.length ? {
    headline: state.activeScenario === 'poor_sleep' ? 'Sleep is affecting today’s performance.' : 'Your context changed — today has been reorganised.',
    body: `${flags.map(f => f.label).join('. ')}. ${providerNote || 'Glyth reduced demand, protected your highest-value work, and deferred what can wait.'}`,
    chain,
  } : { headline: 'You are starting from a stable baseline.', body: 'No rule fired strongly enough to reorganise today. Your plan stands.', chain: [] };

  state.lastReasoning = {
    observed: [`Sleep ${fmtSleep(state.currentState.sleepMinutes)}`, `Recovery ${state.currentState.recovery}%`, `Energy ${state.currentState.energy}/100`, `Workload ${state.currentState.workload}/100`],
    comparedWith: [`Sleep baseline ${fmtSleep(state.baselines.sleepMinutes)}`, `Recovery baseline ${state.baselines.recovery}%`],
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

export function applyScenario(state, key) {
  const before = structuredClone({ currentState: state.currentState, plan: state.plan });
  const sc = SCENARIOS[key]; if (!sc) throw new Error(`Unknown scenario: ${key}`);
  state.activeScenario = key; sc.apply(state);
  const reasoning = orchestrate(state);
  state.scenarioRuns.push({ id: uid('run'), scenario: key, label: sc.label, before, after: structuredClone({ currentState: state.currentState, plan: state.plan }), reasoning, at: new Date().toISOString() });
  return state;
}

export function resetDemo() { return createSeedState(); }

// ---- Recommendation decisions ----
export function decideRecommendation(state, id, decision) {
  const rec = state.recommendations.find(r => r.id === id); if (!rec) throw new Error('Recommendation not found');
  if (!['accepted', 'rejected', 'modified'].includes(decision)) throw new Error('Invalid decision');
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
  if (m.includes('why') || m.includes('change')) return push('glyth', state.lastReasoning ? `Observed: ${state.lastReasoning.observed.join(', ')}. Compared with baseline: ${state.lastReasoning.comparedWith.join(', ')}. So I: ${state.lastReasoning.response.join('; ')}.` : 'Nothing has changed yet today. Trigger Poor Sleep in Insights and I will explain every adjustment.');
  if (m.includes('keep') && (m.includes('workout') || m.includes('train'))) return push('glyth', 'I can restore your heavy session and defer admin instead — you will carry more fatigue into the 14:00 meeting. Confirm?', { type: 'restore_training', label: 'Keep workout, defer admin instead' });
  if (m.includes('admin') && (m.includes('move') || m.includes('tomorrow') || m.includes('defer'))) return push('glyth', 'Move Admin to tomorrow 09:00?', { type: 'defer_admin', label: 'Move admin to tomorrow' });
  if (m.includes('if i') || m.includes('still train') || m.includes('what happens')) return push('glyth', 'With sleep at ' + fmtSleep(state.currentState.sleepMinutes) + ' and recovery at ' + state.currentState.recovery + '%, a heavy session raises injury and attention risk and likely blunts the session itself. A recovery session preserves the habit without the cost.');
  if (m.includes('coach')) return push('glyth', 'You have a coach, with your next session on Thursday (30 minutes). Coaching is private — nothing discussed is shared. You can also browse Coaches in Support.');
  if (m.includes('support') || m.includes('help')) return push('glyth', 'Support lives in the Support tab: Mindfulness, Finance, Fitness and Family, plus Workplace Support (confidential people-team resources) and Coaches. Tell me which area, or say "find me a coach".');
  if (m.includes('mindfulness') || m.includes('reset') || m.includes('calm')) return push('glyth', 'A 2-minute reset fits well right now: breathe in for 4, out for 6, and drop your shoulders. Mindfulness is in Support whenever you want a guided one.');
  if (m.includes('affecting') || m.includes('noticing')) return push('glyth', state.insight.headline + ' ' + state.insight.body);
  if (m.includes('priorit') || m.includes('matters') || m.includes('focus')) return push('glyth', `Today, in order: ${state.focusPriorities.join(' → ')}. The 14:00 investor meeting is the fixed point; everything else bends around it.`);
  return push('glyth', `Based on your current state (readiness ${state.currentState.readiness}, recovery ${state.currentState.recovery}%), my priorities are: ${state.focusPriorities.join('; ')}. Ask me "why did my plan change?" or say "keep my workout".`);
}

export function confirmProposal(state) {
  const msg = [...state.conversation].reverse().find(c => c.proposal); if (!msg) return state;
  const type = msg.proposal.type; msg.proposal = null;
  if (type === 'restore_training') { const t = state.plan.find(p => p.id === 'p_train'); if (t?.original) { Object.assign(t, t.original, { status: 'changed', note: 'Kept at your request. Heavy session restored.' }); delete t.original; } const a = state.plan.find(p => p.id === 'p_admin'); if (a) { snapshotOriginal(a); a.status = 'deferred'; a.note = 'Deferred to tomorrow at your request.'; } }
  if (type === 'defer_admin') { const a = state.plan.find(p => p.id === 'p_admin'); if (a) { snapshotOriginal(a); a.status = 'deferred'; a.note = 'Deferred to tomorrow 09:00 at your request.'; } }
  state.conversation.push({ id: uid('msg'), role: 'glyth', text: 'Done. Your plan is updated and your choice is saved to Progress.', proposal: null });
  state.interventions.unshift({ id: uid('int'), title: type === 'restore_training' ? 'Kept heavy training at user request' : 'Deferred admin at user request', outcome: 'User-modified recommendation', at: 'Today', kind: 'heuristic' });
  return state;
}

// ---- Structured reasoning validation (provider output gate) ----
export function validateReasoningResult(x) {
  if (!x || typeof x !== 'object') return { ok: false, error: 'not an object' };
  for (const k of ['observations', 'affectedAreas', 'recommendations', 'explanation']) if (!(k in x)) return { ok: false, error: `missing ${k}` };
  if (!Array.isArray(x.recommendations)) return { ok: false, error: 'recommendations must be an array' };
  return { ok: true, value: x };
}
