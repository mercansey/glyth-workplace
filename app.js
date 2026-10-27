import * as E from './src/domain/engine.js';
const KEY = 'glyth-snapshot-v1';
let state;
try { state = JSON.parse(localStorage.getItem(KEY)) || E.createSeedState(); } catch { state = E.createSeedState(); }
if (!state.plan) state = E.createSeedState();
let useApi = false;
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const $ = (id) => document.getElementById(id);
async function api(path, opts) { const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }); if (!r.ok) throw new Error(await r.text()); return r.json(); }
// Prefer the Node API when present; fall back to the shared in-browser engine (static hosting).
async function init() {
  try { const d = await api('/api/state'); state = d.state; useApi = true; } catch { useApi = false; }
  render();
}
async function act(fn, apiCall) { if (useApi) { try { state = (await apiCall()).state; } catch { fn(); } } else fn(); save(); render(); }

let numberRafs = {};
function animateNumber(el, to) {
  if (!el) return;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const key = el.id, from = Number(el.dataset.v || 0); cancelAnimationFrame(numberRafs[key]);
  const start = performance.now(), dur = 250;
  const tick = (now) => { const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) numberRafs[key] = requestAnimationFrame(tick); else el.dataset.v = to; };
  numberRafs[key] = requestAnimationFrame(tick);
}
function render() {
  const c = state.currentState;
  animateNumber($('readiness'), c.readiness);
  const aRing = $('avatarRing'); if (aRing) { const ac = 2 * Math.PI * 19; aRing.style.strokeDasharray = ac; aRing.style.strokeDashoffset = ac * (1 - c.readiness / 100); }
  const ring = $('readinessRing'); if (ring) { const circ = 2 * Math.PI * 48; ring.style.strokeDasharray = circ; ring.style.strokeDashoffset = circ * (1 - c.readiness / 100); }
  for (const [k, v] of [['energy', c.energy], ['recovery', c.recovery], ['workload', c.workload]]) { animateNumber($(k), v); $(k + 'Bar').style.width = v + '%'; }
  const next = state.plan.find(x => x.status !== 'deferred') || state.plan[0];
  if (next) { $('nextTime').textContent = next.time; $('nextTitle').textContent = next.title; $('nextNote').textContent = next.note || `${next.durationMin} min · ${next.priority} priority`; $('nextStatus').textContent = next.status === 'unchanged' ? 'On plan' : next.status === 'new' ? 'Added for today' : 'Adjusted for today'; $('nextPill').classList.toggle('warn', next.status === 'changed'); }
  $('stateLine').textContent = `Sleep ${E.fmtSleep(c.sleepMinutes)} (baseline ${E.fmtSleep(state.baselines.sleepMinutes)}) · Recovery ${c.recovery}% · ${state.activeScenario ? 'Scenario: ' + state.activeScenario.replace('_', ' ') : 'Baseline day'}`;
  $('changeBanner').classList.toggle('hidden', !state.changesCount);
  const askDot = $('askDot'); if (askDot) askDot.classList.toggle('hidden', !state.changesCount);
  syncNotifBadge();
  $('changeCount').textContent = state.changesCount ? `${state.changesCount} adjustment${state.changesCount > 1 ? 's' : ''} made.` : '';
  $('focusList').innerHTML = state.focusPriorities.map(f => `<li>${f}</li>`).join('');
  $('plan').innerHTML = state.plan.map(p => `<article class="item ${p.status}"><div class="time">${p.time}</div><div style="flex:1"><div class="title">${p.title} <span class="status">${p.status}</span></div><div class="muted small">${p.note || ''} · ${p.durationMin} min · ${p.priority} priority</div></div></article>`).join('');
  $('recs').innerHTML = state.recommendations.length ? state.recommendations.map(r => `<article class="glass rec"><div><strong>${r.title}</strong><div class="muted small">${r.rationale}</div><div class="small">Confidence ${Math.round(r.confidence * 100)}% · ${r.status}</div></div>${r.status === 'proposed' ? `<div class="rec-actions"><button class="round-btn" data-rec="${r.id}" data-dec="accepted" aria-label="Accept: ${r.title}" title="Accept">✓</button><button class="round-btn ghost" data-rec="${r.id}" data-dec="rejected" aria-label="Reject: ${r.title}" title="Reject">✕</button></div>` : ''}</article>`).join('') : '<p class="muted">No active recommendations. Run Poor Sleep in Insights.</p>';
  document.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => act(() => E.decideRecommendation(state, b.dataset.rec, b.dataset.dec), () => api('/api/recommendation', { method: 'POST', body: JSON.stringify({ id: b.dataset.rec, decision: b.dataset.dec }) })));
  $('insightHead').textContent = state.insight.headline; $('insightBody').textContent = state.insight.body;
  $('chain').innerHTML = (state.insight.chain || []).map((s, i) => `${i ? '<span aria-hidden="true">→</span>' : ''}<span>${s}</span>`).join('');
  $('whyInline').innerHTML = whyHtml();
  $('weekly').textContent = state.weeklySummary;
  $('trends').innerHTML = ['recoveryConsistency', 'priorityCompletion', 'focusProtection'].map(k => `<div style="margin:10px 0"><span class="label">${k.replace(/([A-Z])/g, ' $1')}</span><div style="display:flex;gap:5px;align-items:end;height:52px">${state.trends[k].map((v, i) => `<div title="${state.trends.labels[i]}: ${v}" style="flex:1;height:${k === 'recoveryConsistency' ? v * 0.6 : v * 16}px;background:var(--ink);opacity:.82;border-radius:5px 5px 0 0"></div>`).join('')}</div></div>`).join('');
  $('interventions').innerHTML = state.interventions.map(i => `<div class="msg"><strong>${i.title}</strong><div class="muted small">Outcome: ${i.outcome} · ${i.at}</div></div>`).join('');
}
function whyHtml() { const r = state.lastReasoning; if (!r) return 'No changes yet. Run a scenario to see observed facts, baseline comparison, likely impact, and the response.'; return `<p><span class="label">Observed</span><br>${r.observed.join(' · ')}</p><p><span class="label">Compared with</span><br>${r.comparedWith.join(' · ')}</p><p><span class="label">Likely impact</span><br>${r.likelyImpact.join('<br>')}</p><p><span class="label">Response</span><br>${r.response.join('<br>')}</p><p class="small muted">Confidence ${r.confidence}% · Reasoning: ${r.provider}. Observed / inferred / heuristic are kept distinct in the data — no causal claims beyond the evidence.</p>`; }
function openSheet(html) { $('sheetContent').innerHTML = html; const s = $('sheet'); s.classList.remove('hidden', 'closing'); $('backdrop').classList.remove('hidden', 'closing'); requestAnimationFrame(() => { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }); }
function closeSheet() { const s = $('sheet'), b = $('backdrop'); if (s.classList.contains('hidden')) return; s.classList.add('closing'); b.classList.add('closing'); setTimeout(() => { s.classList.add('hidden'); s.classList.remove('closing'); b.classList.add('hidden'); b.classList.remove('closing'); }, 240); }
$('closeSheet').onclick = closeSheet;
$('backdrop').onclick = closeSheet;
$('nextAction').onclick = () => document.querySelector('.plan')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
$('whyBtn').onclick = () => openSheet(`<h2>Why your day changed</h2>${whyHtml()}`);
const SUPPORT_AREAS = {
  mindfulness: { title: 'Mindfulness', status: '2-minute reset, ready', body: 'Short, on-demand resets that fit between meetings. Glyth suggests them when stress rises or recovery drops — like today — and never shares your usage in detail.', next: 'Start a 2-minute reset before your next meeting.' },
  finance: { title: 'Finance', status: 'Weekly check-in due', body: 'A calm weekly money check-in: what came in, what went out, and one small decision. Glyth keeps this private and only surfaces it when workload or stress makes money feel heavier.', next: 'Do the 5-minute weekly check-in on Friday.' },
  fitness: { title: 'Fitness', status: '3 sessions this week', body: 'Training that adapts to sleep and recovery. After poor sleep Glyth swaps heavy work for recovery — the goal is consistency across the week, not heroics on one day.', next: 'Next session follows today’s adapted plan.' },
  family: { title: 'Family', status: 'Sunday call planned', body: 'The people outside work get protected time too. Glyth treats family commitments as fixed points the rest of the day bends around, not leftovers.', next: 'Sunday call, 11:00 — already in your week.' },
  workplace: { title: 'Workplace Support', status: 'People team resources · Confidential', body: 'Your organisation’s support routes: people team, wellbeing benefits, and confidential help. Glyth can point you here; it never reports back what you open or use.', next: 'Browse resources, or ask Glyth to find the right one.' },
  coaches: { title: 'Coaches', status: 'Your coach · Next session Thursday', body: 'Human coaches for the things an app shouldn’t handle alone. Sessions are private — your employer sees that coaching exists, never what’s discussed.', next: 'Next session: Thursday, 30 minutes.' },
};
document.querySelectorAll('[data-area]').forEach(b => b.onclick = () => { const x = SUPPORT_AREAS[b.dataset.area]; if (!x) return; openSheet(`<div class="label">Support</div><h2 style="font-size:24px;margin:6px 0">${x.title}</h2><span class="chip">${x.status}</span><p style="margin-top:14px">${x.body}</p><p><span class="label">Next</span><br>${x.next}</p><button class="btn" id="areaAsk">Ask Glyth about this</button>`); $('areaAsk').onclick = () => { closeSheet(); setTimeout(openAsk, 260); }; });
const WELLNESS = {
  walk: { tag: 'Mindfulness', title: 'Lunchtime walk club', when: 'Today · 13:00 · 20 min', body: 'A gentle loop from reception, led by the People team. Glyth suggests it on high-workload days — daylight and movement between meetings reliably lifts afternoon energy.', next: 'No booking needed. Glyth can hold your 13:00 slot so meetings do not creep in.' },
  sleep: { tag: 'Recovery', title: 'Sleep workshop', when: 'Wednesday · 17:00 · 45 min', body: 'A practical session on wind-down routines, light and caffeine timing, run by an external sleep coach. Especially relevant after a run of short nights.', next: 'Book a virtual seat — cameras optional, nothing is recorded.' },
  yoga: { tag: 'Fitness', title: 'Yoga before stand-up', when: 'Tomorrow · 08:15 · 30 min', body: 'Mobility and strength work scaled to how you slept. On low-recovery mornings the instructor offers a restorative version, so it never competes with training later.', next: 'Studio B, mats provided. Arrive five minutes early.' },
  breathing: { tag: 'Focus', title: 'Breathing for focus', when: 'Thursday · 09:30 · 10 min', body: 'A short guided reset before deep work. Glyth points you here when focus fragmentation rises — ten minutes that protects the two hours after it.', next: 'Quiet room, drop in — no booking, no sharing back.' },
  finance: { tag: 'Finance', title: 'Money wellbeing clinic', when: 'Friday · 12:00 · 25 min', body: 'A confidential one-to-one with a financial coach: budgeting, debt, or just a calm second opinion. Your employer funds it and never learns who attends.', next: 'Book a 25-minute slot — fully confidential.' },
};
document.querySelectorAll('[data-wellness]').forEach(b => b.onclick = () => { const x = WELLNESS[b.dataset.wellness]; if (!x) return; const thumb = b.querySelector('.wellness-thumb')?.outerHTML || ''; openSheet(`<div class="label">Wellness opportunity</div><h2 style="font-size:24px;margin:6px 0">${x.title}</h2><span class="chip">${x.tag} · ${x.when}</span>${thumb}<p style="margin-top:14px">${x.body}</p><p><span class="label">Next step</span><br>${x.next}</p><button class="btn" id="wellnessAsk">Ask Glyth about this</button>`); $('wellnessAsk').onclick = () => { closeSheet(); setTimeout(openAsk, 260); }; });
let notifsRead = false;
function buildNotifications() {
  const list = [];
  if (state.changesCount) list.push({ title: 'Your day changed', body: `${state.changesCount} adjustment${state.changesCount > 1 ? 's' : ''} made — ${state.insight.headline}`, when: 'Today' });
  state.recommendations.filter(r => r.status === 'proposed').forEach(r => list.push({ title: 'Recommendation waiting', body: r.title, when: 'Today' }));
  list.push({ title: 'Coach session Thursday', body: '30 minutes with your coach. Nothing to prepare.', when: 'Thursday' });
  list.push({ title: 'Weekly summary ready', body: state.weeklySummary, when: 'This week' });
  return list;
}
function syncNotifBadge() { const b = $('notifBadge'); if (!b) return; const n = notifsRead ? 0 : buildNotifications().length; b.textContent = n; b.classList.toggle('hidden', n === 0); }
$('notifBtn').onclick = () => { const list = buildNotifications(); openSheet(`<div class="label">Notifications</div><h2 style="font-size:24px;margin:6px 0 4px">What's new</h2>${list.map(n => `<div class="notif-row"><span class="notif-dot ${notifsRead ? 'read' : ''}"></span><div><strong>${n.title}</strong><div class="muted small">${n.body}</div><div class="muted small">${n.when}</div></div></div>`).join('')}`); notifsRead = true; syncNotifBadge(); };
$('workplaceBtn').onclick = () => {
  openSheet(`<div class="label">Workplace profile</div><h2 style="font-size:24px;margin:6px 0 4px">Northstar</h2><span class="chip">Member · Alex</span>
  <section class="flow-section"><div class="label">Your workplace</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Organisation</span><span class="v">Northstar</span></div>
    <div class="flow-row"><span class="k">Sharing</span><span class="v">Work-pattern aggregates</span></div>
    <div class="flow-row"><span class="k">Privacy threshold</span><span class="v">Groups of 5+</span></div>
  </div></section>
  <section class="flow-section"><div class="label">What Northstar can see</div><p class="muted small">Aggregated team patterns only — workload, meeting density and focus fragmentation across a team, never an individual.</p></section>
  <section class="flow-section"><div class="label">What it never sees</div><p class="muted small">Your sleep, health, recovery, conversations, or which support resources you open. Those stay in your FlowID, on your side of the line.</p></section>
  <a class="btn" href="employer-dashboard/" style="display:inline-block;text-decoration:none">Open workplace dashboard</a>`);
};
function flowIdHtml() {
  const ctx = E.compileContext(state), c = ctx.current_state, d = ctx.deviations;
  const initials = ctx.user_profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  const dev = (v, suffix = '') => `<span class="v ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${v}${suffix}</span>`;
  const row = (k, v) => `<div class="flow-row"><span class="k">${k}</span>${typeof v === 'string' && v.startsWith('<') ? v : `<span class="v">${v}</span>`}</div>`;
  return `<div class="flow-head"><div class="avatar" aria-hidden="true">${initials}</div><div><div class="label">FlowID Lite</div><h2>${ctx.user_profile.name}</h2><p class="muted small">The context Glyth reasons over — compact, deterministic, never the whole database.</p></div></div>
  <section class="flow-section"><div class="label">Appearance</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Dark mode<br><span class="small">Graphite theme, easier at night</span></span><button class="switch" id="themeSwitch" role="switch" aria-checked="false" aria-label="Dark mode"></button></div>
  </div></section>
  <section class="flow-section"><div class="label">Current state</div><div class="flow-rings">
    ${[['Sleep', Math.min(100, Math.round(c.sleepMinutes / state.baselines.sleepMinutes * 100)), ctx.current_state.sleep], ['Recovery', c.recovery, c.recovery + '%'], ['Energy', c.energy, String(c.energy)], ['Workload', c.workload, String(c.workload)], ['Training', c.trainingLoad, String(c.trainingLoad)], ['Stress', c.stress, String(c.stress)]].map(([label, pct, val]) => `<div class="flow-ring"><div class="ring-wrap"><svg viewBox="0 0 78 78" aria-hidden="true"><circle class="ring-track" cx="39" cy="39" r="32" fill="none" stroke-width="6"/><circle class="ring-value" cx="39" cy="39" r="32" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="201" style="--off:${201 * (1 - pct / 100)};stroke-dashoffset:${201 * (1 - pct / 100)}"/></svg><div class="ring-centre"><b>${val}</b></div></div><span class="ring-label">${label}</span></div>`).join('')}
  </div><p class="muted small" style="margin:10px 0 0">Sleep ring shows time asleep against your ${ctx.baselines.sleep} baseline · sleep quality ${c.sleepQuality}%.</p></section>
  <section class="flow-section"><div class="label">Against baseline</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Sleep (${ctx.baselines.sleep} baseline)</span>${dev(d.sleepPct, '%')}</div>
    <div class="flow-row"><span class="k">Recovery (${ctx.baselines.recovery}% baseline)</span>${dev(d.recoveryPts, ' pts')}</div>
    <div class="flow-row"><span class="k">Energy (${ctx.baselines.energy} baseline)</span>${dev(d.energyPts, ' pts')}</div>
  </div></section>
  <section class="flow-section"><div class="label">Active goals</div>${state.goals.filter(g => g.status === 'active').map(g => `<div style="padding:10px 0;border-bottom:1px solid var(--line)"><div class="flow-goal" style="border:0;padding:0"><span>${g.name}<br><span class="muted small">${g.target}</span></span><span class="status">${g.category} · P${g.priority}</span></div><div class="bar" style="margin-top:8px"><i style="width:${g.progress}%"></i></div><div class="muted small" style="margin-top:4px">${g.progress}% of target</div></div>`).join('')}</section>
  <section class="flow-section"><div class="label">Today</div><div class="flow-rows">${ctx.today_schedule.map(i => row(`${i.time} · ${i.title}`, i.status)).join('')}</div></section>
  <section class="flow-section"><div class="label">Preferences &amp; constraints</div><div class="flow-rows">
    ${row('Training', state.preferences.trainingTime)}${row('Protect focus when tired', state.preferences.protectFocus ? 'Yes' : 'No')}${ctx.constraints.map(x => row('Constraint', x)).join('')}
  </div></section>
  ${ctx.important_recent_signals.length ? `<section class="flow-section"><div class="label">Recent signals</div><div class="flow-rows">${ctx.important_recent_signals.map(s => row(`${s.type} · ${s.at}`, String(s.value))).join('')}</div></section>` : ''}
  <details class="flow-raw"><summary>View raw context packet</summary><pre>${JSON.stringify(ctx, null, 2)}</pre></details>`;
}
$('flowBtn').onclick = () => { openSheet(flowIdHtml()); syncThemeBtn(); const sw = $('themeSwitch'); if (sw) sw.onclick = toggleTheme; };
$('homeBtn').onclick = () => { switchView('today'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
const themeBtn = $('themeBtn');
function syncThemeBtn() { const dark = document.documentElement.dataset.theme === 'dark'; const mc = $('themeColor'); if (mc) mc.content = dark ? '#0E0F11' : '#F7F7F5'; if (themeBtn) { themeBtn.setAttribute('aria-pressed', String(dark)); themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode'; } const sw = $('themeSwitch'); if (sw) sw.setAttribute('aria-checked', String(dark)); }
function setTheme(next) { document.documentElement.dataset.theme = next; try { localStorage.setItem('glyth-snapshot-theme', next); } catch {} syncThemeBtn(); moveIndicator(); }
function toggleTheme() { setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'); }
if (themeBtn) themeBtn.onclick = toggleTheme;
syncThemeBtn();
const reset = () => act(() => { state = E.resetDemo(); }, () => api('/api/reset', { method: 'POST' }));
const rb = $('resetBtn'); if (rb) rb.onclick = reset; $('resetBtn2').onclick = reset;
document.querySelectorAll('[data-scenario]').forEach(b => b.onclick = async () => { notifsRead = false; b.classList.add('is-busy'); b.setAttribute('aria-busy', 'true'); try { await act(() => E.applyScenario(state, b.dataset.scenario), () => api('/api/scenario', { method: 'POST', body: JSON.stringify({ scenario: b.dataset.scenario }) })); $('scenarioMsg').textContent = `${b.textContent} applied — switch to Today to see your reorganised day, then tap Why?`; switchView('today'); } finally { b.classList.remove('is-busy'); b.removeAttribute('aria-busy'); } });
document.querySelectorAll('nav.liquid button').forEach(b => b.onclick = () => switchView(b.dataset.view));
const VIEW_ORDER = ['today', 'insights', 'support']; let currentView = 'today', switchTimer = null;
function moveIndicator(v = currentView) { const btn = document.querySelector(`nav.liquid button[data-view="${v}"]`), ind = document.querySelector('.nav-indicator'); if (!btn || !ind) return; ind.style.width = btn.offsetWidth + 'px'; ind.style.transform = `translateX(${btn.offsetLeft}px)`; ind.style.opacity = '1'; }
function switchView(v) {
  if (v === currentView) { moveIndicator(v); return; }
  const dir = VIEW_ORDER.indexOf(v) > VIEW_ORDER.indexOf(currentView) ? 'next' : 'prev', from = currentView;
  currentView = v;
  document.querySelectorAll('nav.liquid button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  moveIndicator(v); syncFab(); if (askOpen) renderAsk();
  const current = $('view-' + from), next = $('view-' + v);
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  clearTimeout(switchTimer);
  const show = () => { document.querySelectorAll('.view').forEach(s => { s.classList.add('hidden'); s.classList.remove('enter-next', 'enter-prev', 'is-leaving'); }); next.classList.remove('hidden'); next.classList.add(dir === 'next' ? 'enter-next' : 'enter-prev'); window.scrollTo({ top: 0, behavior: reduced ? 'auto' : 'smooth' }); };
  if (reduced) { show(); return; }
  current.classList.add('is-leaving'); switchTimer = setTimeout(show, 160);
}
window.addEventListener('resize', () => moveIndicator());
requestAnimationFrame(() => moveIndicator()); window.addEventListener('load', () => moveIndicator());
document.addEventListener('keydown', (e) => { if (!['ArrowLeft', 'ArrowRight'].includes(e.key) || /INPUT|TEXTAREA/.test(document.activeElement?.tagName || '')) return; const i = VIEW_ORDER.indexOf(currentView), n = e.key === 'ArrowRight' ? Math.min(VIEW_ORDER.length - 1, i + 1) : Math.max(0, i - 1); switchView(VIEW_ORDER[n]); });
const ASK_CONTEXT = {
  today: { label: 'Ask Glyth about Today', sub: () => `Your plan for today — readiness ${state.currentState.readiness}, recovery ${state.currentState.recovery}%. Changes are proposed first, never applied silently.`, prompts: ['Why did my plan change?', 'What matters most today?', 'Keep my workout'] },
  insights: { label: 'Insights, at a glance', sub: () => `What Glyth is noticing — ${state.insight.headline}`, prompts: ['Why did my plan change?', 'What is affecting me most?', 'What happens if I still train?'] },
  support: { label: 'Support, at a glance', sub: () => 'Mindfulness, finance, fitness, family, workplace support and coaches — ask where to start.', prompts: ['I need support', 'Find me a coach', 'Start a mindfulness reset'] },
};
function syncFab() {
  const ctx = ASK_CONTEXT[currentView] || ASK_CONTEXT.today, fab = $('askFab');
  document.querySelectorAll('.fab-icon').forEach(i => i.classList.toggle('is-active', i.dataset.iconFor === currentView));
  fab.setAttribute('aria-label', ctx.label); fab.title = ctx.label;
}
function intelInsightsHtml() {
  const c = state.currentState, b = state.baselines;
  const days = state.trends.labels || ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const metric = (label, value, note) => `<div class="intel-metric"><span>${label}</span><div class="bar"><i style="width:${Math.max(0, Math.min(100, value))}%"></i></div><strong>${value}</strong><em>${note}</em></div>`;
  const chart = (label, arr, max, suffix) => `<figure class="intel-chart"><figcaption class="label">${label}</figcaption><div class="intel-bars">${arr.map((v, i) => `<div class="intel-bar" title="${days[i]}: ${v}${suffix}"><i style="height:${Math.max(10, v / max * 100)}%"></i><span>${days[i]}</span></div>`).join('')}</div></figure>`;
  const rec = state.trends.recoveryConsistency, recAvg = Math.round(rec.reduce((a, v) => a + v, 0) / rec.length);
  const done = state.trends.priorityCompletion.reduce((a, v) => a + v, 0), focus = state.trends.focusProtection.reduce((a, v) => a + v, 0);
  const chainText = state.insight.chain?.length ? state.insight.chain.join(' → ') : 'Sleep at baseline → recovery steady → full plan protected';
  const latest = state.interventions[0];
  return `<div class="ask-head"><div><h2 style="margin:0">Insights</h2><p class="muted small" style="margin:2px 0 0">Intel from this tab — read-only, no chat here. Ask Glyth lives on Today.</p></div><button class="top-icon" id="askClose" aria-label="Close">✕</button></div>
  <div class="ask-msgs intel-flow">
    <p class="intel-lead"><strong>${state.insight.headline}</strong> ${state.insight.body}</p>
    <div class="intel-metrics" role="img" aria-label="Today against baseline">
      ${metric('Readiness', c.readiness, 'today')}${metric('Recovery', c.recovery, `baseline ${b.recovery}`)}${metric('Energy', c.energy, `baseline ${b.energy}`)}${metric('Workload', c.workload, 'load')}
    </div>
    <p>It starts with sleep — <strong>${E.fmtSleep(c.sleepMinutes)}</strong> against your ${E.fmtSleep(b.sleepMinutes)} baseline. That flows through recovery and energy into how much of today Glyth protects, and what it lets move.</p>
    <p class="intel-chain">${chainText}</p>
    <p>Across the week, recovery has held around <strong>${recAvg}%</strong>. Thursday dipped, then climbed back — the pattern Glyth watches is the recovery after a dip, not the dip itself.</p>
    ${chart('Recovery consistency · %', rec, 100, '%')}
    <p>That steadiness shows up in the work: <strong>${done} priorities completed</strong> and <strong>${focus} focus blocks protected</strong> this week. When recovery holds, Glyth keeps the plan ambitious; when it slips two days running, it starts trading intensity for consistency.</p>
    ${chart('Priority completion · per day', state.trends.priorityCompletion, 3.4, '')}
    ${chart('Focus protection · blocks', state.trends.focusProtection, 2.4, '')}
    ${latest ? `<p>Most recently, Glyth <strong>${latest.title.charAt(0).toLowerCase() + latest.title.slice(1)}</strong> — ${latest.outcome.charAt(0).toLowerCase() + latest.outcome.slice(1)} (${latest.at.toLowerCase()}). Interventions like this are how the pattern above gets built: observe, adjust, then check whether it helped.</p>` : ''}
    <p class="intel-close">${state.lastReasoning ? state.lastReasoning.response.join(' ') : 'No changes yet today — your plan stands as scheduled, and Glyth keeps watching the flow above.'}</p>
  </div>`;
}
function intelSupportHtml() {
  return `<div class="ask-head"><div><h2 style="margin:0">Support</h2><p class="muted small" style="margin:2px 0 0">Intel from this tab — read-only, no chat here. Ask Glyth lives on Today.</p></div><button class="top-icon" id="askClose" aria-label="Close">✕</button></div>
  <div class="ask-msgs"><div class="label">Support areas</div>${Object.values(SUPPORT_AREAS).map(x => `<div class="notif-row"><div><strong>${x.title}</strong><div class="muted small">${x.status}</div></div></div>`).join('')}
  <div class="label" style="margin-top:16px">Goals</div>${state.goals.map(g => `<div style="margin:10px 0"><strong>${g.name}</strong> <span class="muted small">${g.progress}%</span><div class="bar"><i style="width:${g.progress}%"></i></div></div>`).join('')}
  <div class="label" style="margin-top:16px">Weekly summary</div><p class="muted small">${state.weeklySummary}</p></div>`;
}
function askSheetHtml() {
  if (currentView === 'insights') return intelInsightsHtml();
  if (currentView === 'support') return intelSupportHtml();
  const msgs = state.conversation.slice(-8);
  const actx = ASK_CONTEXT[currentView] || ASK_CONTEXT.today;
  return `<div class="ask-head"><div><h2 style="margin:0">Ask Glyth</h2><p class="muted small" style="margin:2px 0 0">${actx.sub()}</p></div><button class="top-icon" id="askClose" aria-label="Close Ask Glyth">✕</button></div>
  <div class="ask-msgs" id="askMsgs">${msgs.length ? msgs.map(m => `<div class="msg ${m.role}">${m.text}${m.proposal ? `<div style="margin-top:10px"><button class="btn sm" id="confirmProposal">Confirm: ${m.proposal.label}</button></div>` : ''}</div>`).join('') : '<div class="msg glyth">Ask me why your plan changed, what to prioritise, or tell me to keep your workout. Plan changes are proposed first — nothing applies without your confirmation.</div>'}</div>
  <div class="ask-prompts">${actx.prompts.map(p => `<button class="btn sm ghost" data-prompt="${p}">${p}</button>`).join('')}</div>
  <form class="ask-composer" id="askForm"><input id="askInput" autocomplete="off" aria-label="Ask Glyth" placeholder="Ask Glyth anything about today…"><button class="btn" type="submit" aria-label="Send">↑</button></form>`;
}
let askOpen = false;
function renderAsk() { $('askPanelInner').innerHTML = askSheetHtml(); bindAsk(); const m = $('askMsgs'); if (m) m.scrollTop = m.scrollHeight; }
function openAsk() { if (askOpen) return; askOpen = true; const p = $('askPanel'); p.classList.remove('closing'); p.classList.add('is-open'); p.setAttribute('aria-hidden', 'false'); $('askFab').classList.add('is-open'); $('askFab').setAttribute('aria-expanded', 'true'); document.body.classList.add('ask-open'); const dot = $('askDot'); if (dot) dot.classList.add('hidden'); renderAsk(); setTimeout(() => { const i = $('askInput'); if (i && matchMedia('(pointer:fine)').matches) i.focus({ preventScroll: true }); }, 380); }
function closeAsk() { if (!askOpen) return; askOpen = false; const p = $('askPanel'); p.classList.add('closing'); p.classList.remove('is-open'); p.setAttribute('aria-hidden', 'true'); $('askFab').classList.remove('is-open'); $('askFab').setAttribute('aria-expanded', 'false'); document.body.classList.remove('ask-open'); setTimeout(() => p.classList.remove('closing'), 300); }
function bindAsk() {
  const close = $('askClose'); if (close) close.onclick = closeAsk;
  const form = $('askForm'); if (!form) return;
  form.onsubmit = async (e) => { e.preventDefault(); const input = $('askInput'), q = input.value.trim(); if (!q) return; await act(() => E.askGlyth(state, q), () => api('/api/ask', { method: 'POST', body: JSON.stringify({ message: q }) })); renderAsk(); const i = $('askInput'); if (i) i.focus({ preventScroll: true }); };
  document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = async () => { await act(() => E.askGlyth(state, b.dataset.prompt), () => api('/api/ask', { method: 'POST', body: JSON.stringify({ message: b.dataset.prompt }) })); renderAsk(); });
  const confirm = $('confirmProposal'); if (confirm) confirm.onclick = async () => { await act(() => E.confirmProposal(state), () => api('/api/proposal/confirm', { method: 'POST' })); closeAsk(); };
}
$('askFab').onclick = () => (askOpen ? closeAsk() : openAsk());
function buildSearchIndex() {
  const idx = [];
  state.plan.forEach(p => idx.push({ title: p.title, sub: `Today · ${p.time} · ${p.status}`, view: 'today' }));
  state.focusPriorities.forEach(f => idx.push({ title: f, sub: "Today's focus", view: 'today' }));
  idx.push({ title: state.insight.headline, sub: 'Insights · Key insight', view: 'insights' });
  state.interventions.forEach(i => idx.push({ title: i.title, sub: `Insights · ${i.outcome}`, view: 'insights' }));
  state.goals.forEach(g => idx.push({ title: g.name, sub: `FlowID · ${g.progress}% of target`, view: 'flow' }));
  Object.entries(SUPPORT_AREAS).forEach(([key, x]) => idx.push({ title: x.title, sub: `Support · ${x.status}`, view: 'support', area: key }));
  return idx;
}
function renderSearchResults(q) {
  const box = $('searchResults'); if (!box) return;
  const query = (q || '').trim().toLowerCase();
  const hits = buildSearchIndex().map((x, i) => ({ ...x, i })).filter(x => !query || (x.title + ' ' + x.sub).toLowerCase().includes(query)).slice(0, 8);
  box.innerHTML = hits.length ? hits.map(x => `<button class="search-result" data-hit="${x.i}"><span style="flex:1"><strong>${x.title}</strong><div class="muted small">${x.sub}</div></span><span class="chevron" aria-hidden="true">›</span></button>`).join('') : '<p class="muted small" style="margin-top:14px">Nothing matches that yet. Try “focus”, “coach” or “recovery”.</p>';
  box.querySelectorAll('[data-hit]').forEach(b => b.onclick = () => {
    const hit = buildSearchIndex()[Number(b.dataset.hit)]; closeSearchPanel();
    if (!hit) return;
    if (hit.view === 'flow') { setTimeout(() => $('flowBtn').click(), 260); return; }
    switchView(hit.view);
    if (hit.area) setTimeout(() => document.querySelector(`[data-area="${hit.area}"]`)?.click(), 320);
  });
}
let searchOpen = false;
function openSearchPanel() {
  if (searchOpen) return; searchOpen = true;
  const p = $('searchPanel'); p.classList.remove('hidden', 'closing'); renderSearchResults('');
  const input = $('searchInput'); if (input) { input.value = ''; input.oninput = () => renderSearchResults(input.value); setTimeout(() => input.focus({ preventScroll: true }), 300); }
}
function closeSearchPanel() {
  if (!searchOpen) return; searchOpen = false;
  const p = $('searchPanel'); p.classList.add('closing'); setTimeout(() => { p.classList.add('hidden'); p.classList.remove('closing'); }, 230);
}
$('searchBtn').onclick = () => (searchOpen ? closeSearchPanel() : openSearchPanel());
$('searchClose').onclick = closeSearchPanel;
document.addEventListener('pointerdown', (e) => { if (searchOpen && !e.target.closest('#searchPanel, #searchBtn')) closeSearchPanel(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && searchOpen) closeSearchPanel(); });
$('settingsBtn').onclick = () => {
  const dark = document.documentElement.dataset.theme === 'dark';
  openSheet(`<div class="label">Settings</div><h2 style="font-size:24px;margin:6px 0 4px">Settings</h2>
  <section class="flow-section"><div class="label">Appearance</div><div class="flow-rows"><div class="flow-row"><span class="k">Dark mode<br><span class="small">Graphite theme, easier at night</span></span><button class="switch" id="themeSwitch" role="switch" aria-checked="${dark}" aria-label="Dark mode"></button></div></div></section>
  <section class="flow-section"><div class="label">Preferences</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Protect focus when tired<br><span class="small">Guard deep work on low-recovery days</span></span><button class="switch" data-pref="protectFocus" role="switch" aria-checked="${state.preferences.protectFocus}" aria-label="Protect focus when tired"></button></div>
    <div class="flow-row"><span class="k">Defer low-value work<br><span class="small">Move admin on high-load days</span></span><button class="switch" data-pref="deferLowValueWhenTired" role="switch" aria-checked="${state.preferences.deferLowValueWhenTired}" aria-label="Defer low-value work"></button></div>
  </div></section>
  <section class="flow-section"><div class="label">Demo</div><p class="muted small">Glyth Workplace · Snapshot v0.1 · Synthetic data only. Runs entirely on this device.</p><button class="btn ghost" id="settingsReset">Reset demo</button></section>`);
  syncThemeBtn();
  const sw = $('themeSwitch'); if (sw) sw.onclick = toggleTheme;
  document.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { const k = b.dataset.pref; state.preferences[k] = !state.preferences[k]; b.setAttribute('aria-checked', String(state.preferences[k])); save(); });
  $('settingsReset').onclick = async () => { closeSheet(); await act(() => { state = E.resetDemo(); }, () => api('/api/reset', { method: 'POST' })); switchView('today'); };
};
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && askOpen) closeAsk(); });
syncFab();
init();
