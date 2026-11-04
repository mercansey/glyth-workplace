import * as E from './src/domain/engine.js';
import * as MIND from './src/mindfulness/mindfulness.js';
import * as FIT from './src/fitness/fitness.js';
import { HealthBridge, CalendarBridge, SecureStorageBridge, SpeechBridge, nativeCapabilities, nativePlatform } from './src/native/bridge.js';
const KEY = 'glyth-snapshot-v4';
let state;
try { state = JSON.parse(localStorage.getItem(KEY)) || E.createSeedState(); } catch { state = E.createSeedState(); }
if (!state.plan) state = E.createSeedState();
if (!state.mindfulness) state.mindfulness = { activity: [], events: [], lastRecommendation: null };
if (!state.fitness) state.fitness = { profile: null, sessions: [], events: [], lastRecommendation: null };
let useApi = false;
let serverDemoMode = false;
const ACCOUNT_KEY = 'glyth-account-v1';
const IS_NATIVE = (() => { try { return Boolean(globalThis.Capacitor?.isNativePlatform?.()); } catch { return false; } })();
let account = null;
try { account = JSON.parse(localStorage.getItem(ACCOUNT_KEY)); } catch { account = null; }
function persistAccount() {
  if (IS_NATIVE) { // Keychain is authoritative on iOS; clear any legacy local copy
    try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* ignore */ }
    if (account) SecureStorageBridge.set('glyth-account', JSON.stringify(account)).catch(() => {});
    else SecureStorageBridge.remove('glyth-account').catch(() => {});
  } else { try { localStorage.setItem(ACCOUNT_KEY, JSON.stringify(account)); } catch { /* ignore */ } }
}
async function restoreNativeAccount() {
  if (!IS_NATIVE) return;
  try { const r = await SecureStorageBridge.get('glyth-account'); const raw = r?.value || r; if (raw) { account = JSON.parse(raw); if (account?.name) state.profile.name = account.name; updateAuthGate(); render(); } } catch { /* no stored session */ }
}
if (account?.name) state.profile.name = account.name;
const save = () => localStorage.setItem(KEY, JSON.stringify(state));
const $ = (id) => document.getElementById(id);
const STATUS_LABEL = { unchanged: 'unchanged', changed: 'changed', added: 'added', new: 'added', replaced: 'replaced', deferred: 'deferred', completed: 'completed' };
const statusLabel = (s) => STATUS_LABEL[s] || s;
const OP_LABEL = { replace: 'Replaced', move: 'Protected', add: 'Added', defer: 'Deferred' };
const API_BASE = (globalThis.GLYTH_API_BASE || '').replace(/\/$/, '');
async function api(path, opts, retry = true) { const headers = { 'Content-Type': 'application/json', ...(account?.accessToken ? { Authorization: `Bearer ${account.accessToken}` } : {}), ...(opts?.headers || {}) }; const r = await fetch(`${API_BASE}${path}`, { ...opts, headers }); if (r.status === 401 && retry && account?.refreshToken && !path.startsWith('/api/auth/')) { try { const rr = await fetch(`${API_BASE}/api/auth/refresh`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ refresh_token: account.refreshToken }) }); if (rr.ok) { const d = await rr.json(); account = { ...account, accessToken: d.session?.access_token || null, refreshToken: d.session?.refresh_token || account.refreshToken }; persistAccount(); return api(path, opts, false); } } catch { /* fall through to the original error */ } } if (!r.ok) { const txt = await r.text(); try { throw new Error(JSON.parse(txt).error || txt); } catch (e) { if (e instanceof SyntaxError) throw new Error(txt || `Request failed (${r.status})`); throw e; } } return r.json(); }
// Prefer the Node API when present; fall back to the shared in-browser engine (static hosting).
async function init() {
  try { const d = await api('/api/state'); state = d.state; useApi = true; serverDemoMode = Boolean(d.demoMode); save(); } catch { useApi = false; }
  updateAuthGate();
  render();
}
// Cross-client alignment: the server is the source of truth (in live mode,
// Postgres behind it). Whenever this client becomes visible again, reload
// the shared state so web and iOS converge instead of drifting locally.
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && useApi) init(); });
async function act(fn, apiCall) { if (useApi) { try { state = (await apiCall()).state; } catch { fn(); } } else fn(); save(); render(); }

let numberRafs = {};
function animateNumber(el, to) {
  if (!el) return;
  if (to == null) { el.textContent = '–'; el.dataset.v = 0; return; }
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) { el.textContent = to; return; }
  const key = el.id, from = Number(el.dataset.v || 0); cancelAnimationFrame(numberRafs[key]);
  const start = performance.now(), dur = 250;
  const tick = (now) => { const p = Math.min(1, (now - start) / dur), e = 1 - Math.pow(1 - p, 3); el.textContent = Math.round(from + (to - from) * e); if (p < 1) numberRafs[key] = requestAnimationFrame(tick); else el.dataset.v = to; };
  numberRafs[key] = requestAnimationFrame(tick);
}
function render() {
  const c = state.currentState;
  const greet = $('greeting'); if (greet) greet.textContent = state.profile.name ? `Welcome back, ${state.profile.name}` : 'Welcome back';
  const av = $('avatarInitial'); if (av) av.textContent = state.profile.name ? state.profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'G';
  animateNumber($('readiness'), c.readiness);
  const aRing = $('avatarRing'); if (aRing) { const ac = 2 * Math.PI * 19; aRing.style.strokeDasharray = ac; aRing.style.strokeDashoffset = ac * (1 - c.readiness / 100); }
  const ring = $('readinessRing'); if (ring) { const circ = 2 * Math.PI * 48; ring.style.strokeDasharray = circ; ring.style.strokeDashoffset = circ * (1 - c.readiness / 100); }
  for (const [k, v] of [['energy', c.energy], ['recovery', c.recovery], ['workload', c.workload]]) { animateNumber($(k), v); $(k + 'Bar').style.width = (v ?? 0) + '%'; }
  const next = state.plan.find(x => x.status !== 'deferred') || state.plan[0];
  const naEl = $('nextAction'); if (naEl) naEl.style.display = next ? '' : 'none';
  if (next) { $('nextTime').textContent = next.time; $('nextTitle').textContent = next.title; $('nextNote').textContent = next.note || `${next.durationMin} min · ${next.priority} priority`; $('nextStatus').textContent = next.status === 'unchanged' ? 'On plan' : statusLabel(next.status) === 'added' ? 'Added for today' : 'Adjusted for today'; $('nextPill').classList.toggle('warn', next.status === 'changed'); }
  $('stateLine').textContent = E.hasUserData(state) ? `Sleep ${E.fmtSleep(c.sleepMinutes)} (baseline ${E.fmtSleep(state.baselines.sleepMinutes)}) · Recovery ${c.recovery ?? '—'}%` : 'No data connected yet — sleep, recovery, calendar and training will appear here.';
  const hero = $('heroLine'); if (hero) hero.textContent = state.changesCount ? 'Your day changed.' : E.hasUserData(state) ? 'Your day is on track.' : 'No data yet.';
  $('changeBanner').classList.toggle('hidden', !state.changesCount);
  const chList = $('changeList'); if (chList) chList.innerHTML = (state.lastReasoning?.changes || []).map(c => `<li><strong>${OP_LABEL[c.operation] || c.operation}:</strong> ${c.title} — ${c.reason}</li>`).join('');
  const chSum = $('changeSummary'); if (chSum && state.lastReasoning?.summary) chSum.textContent = state.lastReasoning.summary;
  const ih = $('insightHeadline'); if (ih) { ih.textContent = state.insight.headline; $('insightBody').textContent = state.insight.body; $('insightChain').innerHTML = (state.insight.chain?.length ? state.insight.chain : ['No signals yet']).map((x, i, a) => `${i ? '<span class="chain-arrow" aria-hidden="true">→</span>' : ''}<span>${x}</span>`).join(''); $('insightAffected').textContent = state.lastReasoning?.changes?.length ? [...new Set(state.lastReasoning.changes.map(c => c.title))].join(' · ') : E.hasUserData(state) ? 'Nothing yet — your plan stands.' : 'Nothing yet — no data connected.'; $('insightResponse').textContent = state.lastReasoning?.changes?.length ? state.lastReasoning.response.join(' ') : E.hasUserData(state) ? 'No changes. Glyth keeps watching.' : 'Connect a data source and Glyth will respond here.'; }
  const gl = $('goalsList'); if (gl) gl.innerHTML = state.goals.length ? state.goals.map(g => `<div style="margin:12px 0"><strong>${g.name}</strong> <span class="muted small">${g.target} · ${g.progress}%</span><div class="bar" style="margin-top:6px"><i style="width:${g.progress}%"></i></div></div>`).join('') : '<p class="muted">No goals yet — add goals and Glyth will track them here.</p>';
  const askDot = $('askDot'); if (askDot) askDot.classList.toggle('hidden', !state.changesCount);
  syncNotifBadge();
  $('changeCount').textContent = state.changesCount ? `${state.changesCount} adjustment${state.changesCount > 1 ? 's' : ''} made.` : '';
  $('focusList').innerHTML = state.focusPriorities.length ? state.focusPriorities.map(f => `<li>${f}</li>`).join('') : '<li class="muted">No focus priorities yet — these come from your goals and today.</li>';
  $('plan').innerHTML = !state.plan.length ? '<p class="muted">No plan yet. Your calendar, training and goals will build today’s plan once connected.</p>' : state.plan.map(p => `<article class="item ${p.status}" ${p.type==='training'?'data-fit-open="1" role="button" tabindex="0" title="Open in Fitness"':''}><div class="time">${p.time}</div><div style="flex:1"><div class="title">${p.title} <span class="status">${statusLabel(p.status)}</span></div><div class="muted small">${p.note || ''} · ${p.durationMin} min · ${p.priority} priority</div></div></article>`).join(''); document.querySelectorAll('[data-fit-open]').forEach(el=>el.onclick=()=>openFitness());
  $('recs').innerHTML = state.recommendations.length ? state.recommendations.map(r => `<article class="glass rec"><div><strong>${r.title}</strong><div class="muted small">${r.rationale}</div><div class="small">Confidence ${Math.round(r.confidence * 100)}% · ${r.status}</div></div>${r.status === 'proposed' && r.action?.type === 'mindfulness_session' ? `<div class="rec-actions"><button class="btn sm" data-mind-start-rec="${r.action.session_type}" type="button">Start</button></div>` : r.status === 'proposed' ? `<div class="rec-actions"><button class="round-btn" data-rec="${r.id}" data-dec="accepted" aria-label="Accept: ${r.title}" title="Accept">✓</button><button class="round-btn ghost" data-rec="${r.id}" data-dec="rejected" aria-label="Reject: ${r.title}" title="Reject">✕</button></div>` : `<span class="chip">${r.status}</span>`}</article>`).join('') : '<p class="muted">No recommendations yet — Glyth needs your data first.</p>';
  const rbadge = $('recBadge'); if (rbadge) { const n = state.recommendations.filter(r => r.status === 'proposed').length; rbadge.textContent = n; rbadge.classList.toggle('hidden', n === 0); }
  document.querySelectorAll('[data-rec]').forEach(b => b.onclick = () => act(() => E.decideRecommendation(state, b.dataset.rec, b.dataset.dec), () => api('/api/recommendation', { method: 'POST', body: JSON.stringify({ id: b.dataset.rec, decision: b.dataset.dec }) })));
  renderCalendar();
  renderFinance();
  renderMindfulness();
  renderFitness();
  $('whyInline').innerHTML = whyHtml();
  $('weekly').textContent = state.weeklySummary || 'No weekly summary yet — this builds after a week of connected data.';
  $('trends').innerHTML = !state.trends.recoveryConsistency.length ? '<p class="muted">No history yet — trends build as your data is recorded.</p>' : ['recoveryConsistency', 'priorityCompletion', 'focusProtection'].map(k => `<div style="margin:10px 0"><span class="label">${k.replace(/([A-Z])/g, ' $1')}</span><div style="display:flex;gap:5px;align-items:end;height:52px">${state.trends[k].map((v, i) => `<div title="${state.trends.labels[i]}: ${v}" style="flex:1;height:${k === 'recoveryConsistency' ? v * 0.6 : v * 16}px;background:var(--ink);opacity:.82;border-radius:5px 5px 0 0"></div>`).join('')}</div></div>`).join('');
  $('interventions').innerHTML = state.interventions.length ? state.interventions.map(i => `<div class="msg"><strong>${i.title}</strong><div class="muted small">Outcome: ${i.outcome} · ${i.at}</div></div>`).join('') : '<p class="muted">No interventions yet.</p>';
}


// ---------- Mindfulness module ----------
let mindTimer = null, mindElapsed = 0, mindPlaying = false, mindSession = null, mindActivity = null, mindSpokenIdx = -1;
const fmtClock = (s) => `${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,'0')}`;
const CHAT_FIELD_LABELS = { today_schedule: "today's schedule", calendar_summary: 'your calendar', recent_interventions: 'recent changes I made', important_recent_signals: 'recent signals', last_reasoning: 'my last reasoning pass', current_state: 'your current state', focus_priorities: 'your focus priorities' };
function chatHtml(text) {
  let t = String(text || '').replace(/`([a-z][a-z0-9_]*)`/g, (m, n) => CHAT_FIELD_LABELS[n] || n.replace(/_/g, ' ')).replace(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g, (m, n) => CHAT_FIELD_LABELS[n] || n.replace(/_/g, ' '));
  t = t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>').replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>').replace(/`([^`]+)`/g, '<code>$1</code>');
  const blocks = t.split(/\n{2,}/).map(b => { const lines = b.split('\n'); if (lines.every(l => /^\s*(?:[-*•]|\d+[.)])\s+/.test(l))) return `<ul>${lines.map(l => `<li>${l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '')}</li>`).join('')}</ul>`; return `<p>${lines.join('<br>')}</p>`; });
  return blocks.join('');
}
function askSourceLabel(m) { if (m.source === 'meta') return `via ${m.model || 'Meta AI'}`; if (m.source === 'llm-unavailable') return 'AI unavailable'; if (m.source === 'deterministic-proposal') return 'Plan proposal — confirm to apply'; return 'local reasoning'; }
async function submitAsk(q) {
  // Ask Glyth is LLM-powered: it goes to the server-side model. There is no
  // silent in-browser fallback answer any more.
  if (useApi) {
    try { const d = await api('/api/ask', { method: 'POST', body: JSON.stringify({ message: q }) }); state = d.state || state; }
    catch (e) { state.conversation.push({ id: `msg_local_${Date.now()}`, role: 'user', text: q, proposal: null }); state.conversation.push({ id: `msg_local_${Date.now()}_g`, role: 'glyth', text: `I couldn't reach the AI service (${e.message || 'server unavailable'}). Check the server is running, then ask again.`, proposal: null, source: 'llm-unavailable' }); }
  } else {
    state.conversation.push({ id: `msg_local_${Date.now()}`, role: 'user', text: q, proposal: null });
    state.conversation.push({ id: `msg_local_${Date.now()}_g`, role: 'glyth', text: 'AI chat needs the Glyth server running (the model key stays server-side). Start the app with Start-Glyth.command, then ask me again.', proposal: null, source: 'llm-unavailable' });
  }
  save(); render();
}
function showOnlyView(id) { document.querySelectorAll('.view').forEach(s=>s.classList.add('hidden')); const el=$(id); if(el) el.classList.remove('hidden'); window.scrollTo({top:0}); }
function openMindfulness() { showOnlyView('view-mindfulness'); renderMindfulness(); }
const mindBackBtn = $('mindBack'); if (mindBackBtn) mindBackBtn.onclick = () => backToMainView('support');
function renderMindfulness() {
  const hero = $('mindHero'); if (!hero || !state.mindfulness) return;
  let rec; try { rec = MIND.recommendMindfulness(state); } catch { rec = null; }
  const stats = MIND.weeklyStats(state);
  const todayHost = $('mindfulnessToday');
  if (rec) {
    const s = rec.session; const doneToday = state.mindfulness.activity.some(a=>a.status==='completed'&&a.session_type===rec.sessionType&&String(a.completed_at||'').slice(0,10)===new Date().toISOString().slice(0,10));
    hero.innerHTML = `<div class="mind-hero" style="background:${s.artwork.gradient}"><div class="label">Recommended for now</div><h2 style="font-size:24px;margin:8px 0 4px">${rec.title}</h2><p style="margin:0;font-weight:600">${Math.round(s.durationSeconds/60)} min · ${s.title}</p><p style="margin:10px 0 16px">${rec.rationale}</p>${doneToday?'<span class="chip">Completed today ✓</span>':`<button class="btn" data-mind-start="${s.id}" type="button">Start</button>`}<p class="small" style="margin:12px 0 0;opacity:.7">Chosen from your current sleep, recovery, workload and what is next. No library search needed.</p></div>`;
    if (todayHost) todayHost.innerHTML = doneToday ? `<div class="glass" style="margin-top:14px"><div class="label">Prepare</div><p style="margin:8px 0 0"><strong>${rec.title}</strong> · completed today ✓</p></div>` : `<button class="next-action" data-mind-start="${s.id}" type="button"><span class="thumb">${Math.round(s.durationSeconds/60)} min</span><span><span class="label">Prepare · Mindfulness</span><h3>${rec.title}</h3><p>${rec.rationale}</p><span class="pill-dot"><i></i><span>Start session</span></span></span></button>`;
  }
  const quick = $('mindQuick'); if (quick) quick.innerHTML = MIND.SESSIONS.map(s=>`<button class="mind-card" data-mind-start="${s.id}" type="button"><div class="mind-card-art" style="background:${s.artwork.gradient}"></div><strong>${Math.round(s.durationSeconds/60)} min · ${s.title}</strong><div class="muted small">${s.description}</div><span class="chip mind-card-audio">▶ Guided audio</span></button>`).join('');
  const st = $('mindStats'); if (st) st.innerHTML = `<strong>${stats.sessionsThisWeek}</strong> session${stats.sessionsThisWeek===1?'':'s'} this week · <strong>${stats.minutesThisWeek}</strong> minutes${stats.completionRate!=null?` · ${stats.completionRate}% completed`:''}`;
  const ins = $('mindInsight'); if (ins) ins.textContent = MIND.mindfulnessInsight(state) || '';
  const prog = $('mindfulnessProgress'); if (prog) prog.innerHTML = `<div class="label">Mindfulness</div><p style="margin:8px 0 0"><strong>${stats.sessionsThisWeek}</strong> sessions this week · <strong>${stats.minutesThisWeek}</strong> minutes</p><button class="btn ghost sm" id="mindProgressOpen" type="button" style="margin-top:10px">Open Mindfulness</button>`; const po=$('mindProgressOpen'); if(po) po.onclick=openMindfulness;
  const recent = $('mindRecent'); if (recent) { const acts = state.mindfulness.activity.filter(a=>a.status==='completed'||a.status==='abandoned').slice(0,5); recent.innerHTML = acts.length ? acts.map(a=>{ const d=new Date(a.completed_at||a.started_at); const when = d.toDateString()===new Date().toDateString()?'Today':d.toDateString()===new Date(Date.now()-864e5).toDateString()?'Yesterday':d.toLocaleDateString('en-GB',{day:'numeric',month:'short'}); return `<div class="mind-recent-row"><span>${when}</span><span class="muted small">${Math.round((a.duration_completed_seconds||a.duration_seconds||0)/60)} min · ${a.session_title||a.session_type} · ${a.status}${a.post_state?` · felt ${a.post_state==='better'?'more settled':a.post_state==='lower'?'less settled':'the same'}`:''}</span></div>`; }).join('') : '<p class="muted">No sessions yet. Your recent activity will appear here.</p>'; }
  const meta = $('mindMeta'); if (meta) meta.textContent = 'Every session is a real recorded guided voice session (3 minutes). Press play and listen — no device voice, no reading required.';
  document.querySelectorAll('[data-mind-start]').forEach(b=>b.onclick=()=>startMindSession(b.dataset.mindStart));
  document.querySelectorAll('[data-mind-start-rec]').forEach(b=>b.onclick=()=>startMindSession(b.dataset.mindStartRec));
}
function speakFrom(elapsed) {
  if (!mindSession?.script) return; // guided-audio sessions play their recording
  if (IS_NATIVE && globalThis.Capacitor?.Plugins?.GlythNative?.speechSpeak) { // native AVSpeechSynthesizer fallback
    const secs = mindSession.script.sections.filter(s=>s.endSecond>=elapsed && s.text); let idx=0;
    const next=()=>{ if(!mindPlaying||idx>=secs.length) return; const sec=secs[idx++]; SpeechBridge.speak(sec.text).catch(()=>{}); setTimeout(next, Math.max(2500,(MIND.spokenSeconds(sec.text)+(sec.pauseAfterSeconds||1))*700)); }; next(); return;
  }
  try {
    if (!('speechSynthesis' in window) || !mindSession) return;
    speechSynthesis.cancel();
    const secs = mindSession.script.sections.filter(s=>s.endSecond>=elapsed);
    let idx=0; const speakNext=()=>{ if(!mindPlaying||idx>=secs.length) return; const sec=secs[idx++]; if(!sec.text){ setTimeout(speakNext, Math.min(4000,(sec.pauseAfterSeconds||2)*200)); return; } const u=new SpeechSynthesisUtterance(sec.text); u.rate=0.92; u.pitch=0.95; u.onend=()=>setTimeout(speakNext, Math.min(5000,(sec.pauseAfterSeconds||1)*250)); u.onerror=()=>setTimeout(speakNext,300); speechSynthesis.speak(u); };
    speakNext();
  } catch { /* readable script mode remains available */ }
}
function mindTick() { const bar=$('mindProgressBar'), el=$('mindElapsed'), rem=$('mindRemaining'); if(bar&&mindSession) bar.style.width=Math.min(100,mindElapsed/mindSession.durationSeconds*100)+'%'; if(el) el.textContent=fmtClock(mindElapsed); if(rem&&mindSession) rem.textContent=fmtClock(Math.max(0,mindSession.durationSeconds-mindElapsed)); }
async function startMindSession(id) {
  const session = MIND.sessionById(id); if(!session) return;
  mindSession=session; mindElapsed=0; mindPlaying=true; mindSpokenIdx=-1;
  if (useApi) { try { const d=await api(`/api/mindfulness/sessions/${session.id}/start`,{method:'POST',body:JSON.stringify({})}); mindActivity=d.activity; state=d.state||state; if(!state.mindfulness) state.mindfulness={activity:[],events:[],lastRecommendation:null}; } catch { mindActivity=MIND.startActivity(state,session.id); } } else mindActivity=MIND.startActivity(state,session.id);
  save();
  $('mindPlayer').classList.remove('hidden'); $('mindComplete').classList.add('hidden');
  $('mindArt').style.background=session.imageUrl?`center/cover url(${session.imageUrl})`:session.artwork.gradient;
  $('mindPlayerTitle').textContent=session.title; $('mindPlayerKicker').textContent='Mindfulness · '+Math.round(session.durationSeconds/60)+' minutes';
  $('mindPlayerDur').textContent=session.description+(session.audioUrl?' Press play and listen — this is a recorded guided session.':' Listen, or read along below — either counts.');
  $('mindScript').innerHTML=session.script?session.script.sections.filter(s=>s.text).map(s=>`<p style="margin:0">${s.text}</p>`).join('')+`<p style="margin:0"><em>${session.script.closingText}</em></p>`:`<p style="margin:0" class="muted">This guided session is audio-only — just listen. ${session.description}</p>`;
  $('mindPlayPause').textContent='Pause';
  const demoSeek = new URLSearchParams(location.search).get('demoSeek')==='1'; $('mindDemoSeek').classList.toggle('hidden',!demoSeek);
  const audio=$('mindAudio');
  if (audio && session.audioUrl) { try { audio.src=session.audioUrl; audio.currentTime=0; audio.play().catch(()=>{ $('mindPlayPause').textContent='Play'; }); } catch {} }
  else speakFrom(0);
  mindTick();
  clearInterval(mindTimer); mindTimer=setInterval(()=>{ if(!mindPlaying) return; const a=$('mindAudio'); if (a && mindSession?.audioUrl && a.src) { mindElapsed=Math.min(Math.floor(a.currentTime||0), mindSession.durationSeconds); mindTick(); if (a.ended || mindElapsed>=mindSession.durationSeconds) completeMindSession(); return; } mindElapsed++; mindTick(); if(mindElapsed>=session.durationSeconds) completeMindSession(); },500);
  try { const { Haptics } = await import('@capacitor/haptics').catch(()=>({})); } catch {}
}
async function completeMindSession() {
  if(!mindSession) return; clearInterval(mindTimer); mindPlaying=false; try{ speechSynthesis.cancel(); }catch{} try{ const a=$('mindAudio'); if(a) a.pause(); }catch{}
  mindElapsed=mindSession.durationSeconds; mindTick();
  if (mindActivity) { if(useApi){ try{ const d=await api(`/api/mindfulness/activity/${mindActivity.id}/complete`,{method:'POST',body:JSON.stringify({duration_completed_seconds:mindElapsed})}); state=d.state||state; mindActivity=d.activity; }catch{ MIND.completeActivity(state,mindActivity.id,mindElapsed); } } else MIND.completeActivity(state,mindActivity.id,mindElapsed); }
  save(); $('mindComplete').classList.remove('hidden'); $('mindPlayPause').textContent='Completed';
  document.querySelectorAll('[data-mind-feedback]').forEach(b=>b.onclick=async()=>{ if(!mindActivity) return; if(useApi){ try{ const d=await api(`/api/mindfulness/activity/${mindActivity.id}/feedback`,{method:'POST',body:JSON.stringify({post_state:b.dataset.mindFeedback})}); state=d.state||state; }catch{ MIND.submitFeedback(state,mindActivity.id,b.dataset.mindFeedback); } } else MIND.submitFeedback(state,mindActivity.id,b.dataset.mindFeedback); save(); render(); $('mindFeedbackMsg').textContent='Saved. Glyth will keep future recommendations short and well-timed.'; setTimeout(()=>{ $('mindPlayer').classList.add('hidden'); switchView('today'); render(); },700); });
}
const pp=$('mindPlayPause'); if(pp) pp.onclick=()=>{ if(!mindSession) return; if(mindElapsed>=mindSession.durationSeconds) return; mindPlaying=!mindPlaying; pp.textContent=mindPlaying?'Pause':'Play'; const a=$('mindAudio'); if (a && mindSession.audioUrl) { try{ if(mindPlaying) a.play().catch(()=>{}); else a.pause(); }catch{} return; } try{ if(mindPlaying) speakFrom(mindElapsed); else speechSynthesis.cancel(); }catch{} };
const mc=$('mindClose'); if(mc) mc.onclick=async()=>{ clearInterval(mindTimer); mindPlaying=false; try{speechSynthesis.cancel();}catch{} try{ const a=$('mindAudio'); if(a){ a.pause(); a.removeAttribute('src'); a.load(); } }catch{} if(mindActivity&&mindElapsed>0&&mindElapsed<(mindSession?.durationSeconds||0)){ if(useApi){ try{ await api(`/api/mindfulness/activity/${mindActivity.id}/abandon`,{method:'POST',body:JSON.stringify({duration_completed_seconds:mindElapsed})}); const d=await api('/api/state'); state=d.state; }catch{ MIND.abandonActivity(state,mindActivity.id,mindElapsed); } } else MIND.abandonActivity(state,mindActivity.id,mindElapsed); save(); } $('mindPlayer').classList.add('hidden'); render(); };
const b15=$('mindBack15'); if(b15) b15.onclick=()=>{ mindElapsed=Math.max(0,mindElapsed-15); const a=$('mindAudio'); if(a&&mindSession?.audioUrl){ try{a.currentTime=mindElapsed;}catch{} } else if(mindPlaying) speakFrom(mindElapsed); mindTick(); };
const f15=$('mindFwd15'); if(f15) f15.onclick=()=>{ mindElapsed=Math.min((mindSession?.durationSeconds||0)-1,mindElapsed+15); const a=$('mindAudio'); if(a&&mindSession?.audioUrl){ try{a.currentTime=mindElapsed;}catch{} } else if(mindPlaying) speakFrom(mindElapsed); mindTick(); };
const dseek=$('mindDemoSeek'); if(dseek) dseek.onclick=()=>{ if(!mindSession) return; mindElapsed=Math.max(0,mindSession.durationSeconds-5); const a=$('mindAudio'); if(a&&mindSession.audioUrl){ try{a.currentTime=mindElapsed;}catch{} } mindTick(); };

const mindAudioEl=$('mindAudio'); if(mindAudioEl){ mindAudioEl.addEventListener('timeupdate',()=>{ if(mindSession?.audioUrl){ mindElapsed=Math.min(Math.floor(mindAudioEl.currentTime||0), mindSession.durationSeconds); mindTick(); } }); mindAudioEl.addEventListener('ended',()=>{ if(mindSession) completeMindSession(); }); }

// ---------- Fitness module ----------
let fitSession = null, fitRestTimer = null, fitRestSecs = 0, fitRestRunning = false;
function openFitness() { showOnlyView('view-fitness'); renderFitness(); }
const fitBackBtn = $('fitBack'); if (fitBackBtn) fitBackBtn.onclick = () => backToMainView('support');
async function fitApi(action, fn) { if (useApi) { try { return await action(); } catch { return fn(); } } return fn(); }
function renderFitness() {
  const hero = $('fitHero'); if (!hero) return;
  try { FIT.ensureFitness(state); } catch { return; }
  let rec, session, stats;
  try { rec = FIT.recommendFitness(state); session = FIT.getOrCreateTodaySession(state); stats = FIT.weeklyStats(state); } catch { return; }
  const c = state.currentState, b = state.baselines;
  const statusLabel2 = { full:'FULL SESSION', modified:'MODIFIED FOR TODAY', light:'LIGHT SESSION', recovery:'RECOVERY', rest:'REST' }[rec.status] || 'TODAY\'S TRAINING';
  hero.innerHTML = `<div class="glass" style="margin-top:16px"><div class="label">Today's training</div><h2 style="font-size:24px;margin:8px 0 4px">${session.title}</h2><p style="margin:0;font-weight:600">${session.estimated_duration} min · ${statusLabel2}</p><p class="muted" style="margin:10px 0 0">Planned: ${rec.plannedSession.title} · ${rec.plannedSession.estimatedDuration} min</p><p style="margin:10px 0 16px">${rec.rationale}</p>${rec.adaptations.length?`<div style="margin:0 0 14px">${rec.adaptations.map(a=>`<span class="chip" style="margin:0 6px 6px 0">${a.type.replace('_',' ')} · ${a.change}</span>`).join('')}</div>`:''}${session.status==='completed'?'<span class="chip">Completed today ✓</span>':`<button class="btn" id="fitStartBtn" type="button">${session.status==='in_progress'?'Continue workout':'Start Workout'}</button>`} <button class="btn ghost" id="fitGenerateBtn" type="button">Generate alternative</button><p class="muted small" id="fitGenMsg" style="margin:10px 0 0"></p></div>`;
  const st = $('fitStatus'); if (st) st.innerHTML = [['Recovery', c.recovery==null?'—':c.recovery+'%'],['Training load', c.trainingLoad==null?'—':(c.trainingLoad>=70?'High':c.trainingLoad>=40?'Moderate':'Low')],['Sleep', E.fmtSleep(c.sleepMinutes)],['Session demand', rec.status==='full'?'Full':rec.status==='recovery'?'Recovery':'Reduced']].map(([k,v])=>`<div class="fit-stat"><span class="muted small">${k}</span><strong>${v}</strong></div>`).join('');
  const wk = $('fitWeek'); if (wk) wk.innerHTML = FIT.weekPlan(state).map(d=>`<div class="mind-recent-row"><span><strong>${d.day}</strong> · ${d.title}</span><span class="muted small">${d.status}</span></div>`).join('');
  const lib = $('fitLibrary'); if (lib) lib.innerHTML = FIT.TEMPLATES.map(t=>`<button class="mind-card" data-fit-tpl="${t.slug}" type="button"><strong>${t.title}</strong><div class="muted small">${t.estimated_duration} min · ${t.type} · ${t.difficulty}</div></button>`).join('');
  const exGrid = $('fitExercises'); if (exGrid) exGrid.innerHTML = FIT.EXERCISES.filter(e=>e.mediaUrl).map(e=>`<div class="fit-exercise-card"><img src="${e.mediaUrl}" alt="${e.name} demo" loading="lazy"><strong>${e.name}</strong><span class="muted">${e.category} · ${e.equipment.join(', ')}</span></div>`).join('');
  const recent = $('fitRecent'); if (recent) { const done = state.fitness.sessions.filter(s=>s.status==='completed'||s.status==='in_progress').slice(0,5); recent.innerHTML = done.length ? done.map(s=>`<div class="mind-recent-row"><span>${s.title}</span><span class="muted small">${s.actual_duration||s.estimated_duration} min · ${s.status}${s.adaptation_status==='adapted'?' · adapted':''}${s.feedback?` · ${s.feedback.replace('_',' ')}`:''}</span></div>`).join('') : '<p class="muted">No sessions yet. Completed workouts will appear here.</p>'; }
  const prof = $('fitProfile'); if (prof) { const pr = state.fitness.profile; prof.innerHTML = `<div class="flow-rows"><div class="flow-row"><span class="k">Primary goal</span><span class="v">${pr.primary_goal.replace('_',' ')}</span></div><div class="flow-row"><span class="k">Experience</span><span class="v">${pr.experience_level}</span></div><div class="flow-row"><span class="k">Session length</span><span class="v">${pr.target_session_duration} min</span></div><div class="flow-row"><span class="k">Equipment</span><span class="v">${pr.available_equipment.join(', ')}</span></div></div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${FIT.GOAL_TYPES.map(g=>`<button class="btn sm ${pr.primary_goal===g?'':'ghost'}" data-fit-goal="${g}" type="button">${g.replace('_',' ')}</button>`).join('')}</div>`; }
  const ins = $('fitInsight'); if (ins) ins.textContent = FIT.fitnessInsight(state) || '';
  const todayHost = $('fitnessToday'); if (todayHost) todayHost.innerHTML = session.status==='completed' ? `<div class="glass" style="margin-top:14px"><div class="label">Fitness</div><p style="margin:8px 0 0"><strong>${session.title}</strong> · completed ✓ · ${session.actual_duration} min</p><button class="btn ghost sm" id="fitTodayOpen" type="button" style="margin-top:10px">Open Fitness</button></div>` : `<button class="next-action" id="fitTodayOpen" type="button"><span class="thumb">${session.estimated_duration}m</span><span><span class="label">Fitness · Today's training</span><h3>${session.title}</h3><p>${rec.rationale}</p><span class="pill-dot"><i></i><span>${session.status==='in_progress'?'Continue workout':'Start workout'}</span></span></span></button>`;
  const prog = $('fitnessProgress'); if (prog) prog.innerHTML = `<div class="label">Fitness · Progress</div><p style="margin:8px 0 0">Sessions this week <strong>${stats.sessionsThisWeek} / ${stats.targetPerWeek}</strong> · Training consistency <strong>${stats.consistency}%</strong> · Weekly load <strong>${stats.weeklyLoadLabel}</strong></p><button class="btn ghost sm" id="fitProgressOpen" type="button" style="margin-top:10px">Open Fitness</button>`;
  const sb = $('fitStartBtn'); if (sb) sb.onclick = () => startFitSession(session.id);
  const gb = $('fitGenerateBtn'); if (gb) gb.onclick = async () => { const msg=$('fitGenMsg'); gb.disabled=true; try { let gen; if (useApi) { const d = await api('/api/fitness/generate',{method:'POST',body:JSON.stringify({})}); gen=d; msg.textContent = `Alternative (${d.source}): ${d.session.title} · ${d.session.estimatedDuration} min — ${d.session.exercises.map(e=>e.name||e.exerciseId).join(', ')}`; } else { const g = FIT.generateWorkout(state,{}); msg.textContent = g.safe ? `Alternative: ${g.session.title} · ${g.session.estimatedDuration} min` : g.response; } } catch(e) { msg.textContent = e.message||'Could not generate.'; } finally { gb.disabled=false; } };
  document.querySelectorAll('[data-fit-goal]').forEach(btn=>btn.onclick=async()=>{ await fitApi(async()=>{ const d=await api('/api/fitness/profile',{method:'POST',body:JSON.stringify({primary_goal:btn.dataset.fitGoal})}); state=d.state||state; }, ()=>{ FIT.setFitnessProfile(state,{primary_goal:btn.dataset.fitGoal}); }); save(); render(); });
  document.querySelectorAll('[data-fit-tpl]').forEach(btn=>btn.onclick=()=>{ const tpl=FIT.templateBySlug(btn.dataset.fitTpl); if(tpl) startFitSession(FIT.getOrCreateTodaySession(state).id, tpl); });
  const to = $('fitTodayOpen'); if (to) to.onclick = openFitness;
  const po = $('fitProgressOpen'); if (po) po.onclick = openFitness;
}
let fitPage = 0, fitPhase = 'exercise'; // exercise | rest | summary | feedback
function fitCurrentExercise() { return fitSession?.exercises?.[fitPage] || null; }
function fitFirstOpenPage() { if (!fitSession) return 0; const i = fitSession.exercises.findIndex(e=>e.status!=='completed' && e.status!=='skipped'); return i<0 ? fitSession.exercises.length : i; }
function fitGoTo(page, phase='exercise') { fitPage = Math.max(0, Math.min(page, fitSession ? fitSession.exercises.length : 0)); fitPhase = phase; fitRenderPlayer(); }
async function fitExerciseAction(action, exid) {
  await fitApi(async()=>{ const d=await api(`/api/fitness/sessions/${fitSession.id}/exercise`,{method:'POST',body:JSON.stringify({exerciseId:exid,action})}); fitSession=d.session; state=d.state||state; }, ()=>{ fitSession=FIT.updateExercise(state, fitSession.id, exid, action); });
  save();
}
function fitRenderPlayer() {
  const host = $('fitPageHost'); if (!host || !fitSession) return;
  const exs = fitSession.exercises;
  const totalSets = exs.reduce((a,e)=>a+(e.planned_sets||0),0), doneSets = exs.reduce((a,e)=>a+(e.completed_sets||0),0);
  $('fitPlayerTitle').textContent = fitSession.title;
  $('fitPlayerKicker').textContent = fitSession.adaptation_status==='adapted' ? 'Adapted for today' : 'As planned';
  $('fitProgressBar').style.width = (fitPhase==='feedback' ? 100 : totalSets ? Math.round(doneSets/totalSets*100) : 0) + '%';
  const dots = `<div class="fit-dots" aria-hidden="true">${exs.map((e,i)=>`<span class="fit-dot ${e.status==='completed'?'done':e.status==='skipped'?'skipped':i===fitPage&&fitPhase==='exercise'?'current':''}"></span>`).join('')}</div>`;

  if (fitPhase === 'feedback') {
    host.innerHTML = `<section class="fit-page fit-page-centre">
      <span class="fit-eyebrow">Workout complete</span>
      <h2 class="fit-big-title">How did that feel?</h2>
      <p class="muted">This shapes your next session. It is kept private.</p>
      <div class="fit-feedback-stack">
        <button class="fit-choice" data-fit-feedback="too_easy" type="button">Too easy</button>
        <button class="fit-choice primary" data-fit-feedback="about_right" type="button">About right</button>
        <button class="fit-choice" data-fit-feedback="too_hard" type="button">Too hard</button>
      </div>
      <p class="muted small" id="fitFeedbackMsg" role="status"></p>
    </section>`;
    document.querySelectorAll('[data-fit-feedback]').forEach(btn=>btn.onclick=async()=>{ await fitApi(async()=>{ const d=await api(`/api/fitness/sessions/${fitSession.id}/feedback`,{method:'POST',body:JSON.stringify({feedback:btn.dataset.fitFeedback})}); state=d.state||state; }, ()=> FIT.submitFeedback(state, fitSession.id, btn.dataset.fitFeedback)); save(); $('fitFeedbackMsg').textContent='Saved — this shapes your next session.'; render(); setTimeout(()=>{ closeFitPlayer(); openFitness(); render(); },800); });
    return;
  }

  if (fitPhase === 'summary' || fitPage >= exs.length) {
    const doneEx = exs.filter(e=>e.status==='completed').length;
    host.innerHTML = `<section class="fit-page fit-page-centre">
      <span class="fit-eyebrow">Session summary</span>
      <h2 class="fit-big-title">Ready to finish?</h2>
      ${dots}
      <div class="fit-summary-grid">
        <div><strong>${doneSets}/${totalSets}</strong><span>sets done</span></div>
        <div><strong>${doneEx}/${exs.length}</strong><span>exercises</span></div>
        <div><strong>${fitSession.estimated_duration} min</strong><span>planned</span></div>
      </div>
      <p class="muted">${fitSession.adaptation_status==='adapted' ? 'This session was adapted for today. Finishing saves the work you actually did.' : 'Finishing saves the work you actually did.'}</p>
      <button class="fit-cta" id="fitFinishBtn2" type="button">Finish workout</button>
      <button class="fit-text-btn" id="fitBackLast" type="button">Back to last exercise</button>
    </section>`;
    $('fitFinishBtn2').onclick = () => finishFitSession(false);
    $('fitBackLast').onclick = () => fitGoTo(Math.max(0, exs.length-1));
    return;
  }

  if (fitPhase === 'rest') {
    const e = fitCurrentExercise(); const next = exs[fitPage+1];
    const restingForNextSet = e && (e.completed_sets||0) < (e.planned_sets||0);
    host.innerHTML = `<section class="fit-page fit-page-centre fit-rest-page">
      <span class="fit-eyebrow">Rest</span>
      <div class="fit-rest-ring"><span id="fitRestTime">${fmtClock(fitRestSecs)}</span></div>
      <p class="muted">${restingForNextSet ? `Next: set ${(e.completed_sets||0)+1} of ${e.planned_sets} · ${e.name}` : next ? `Next exercise: ${next.name}` : 'Next: session summary'}</p>
      ${dots}
      <div class="fit-row">
        <button class="fit-choice" id="fitRestPauseBtn" type="button">${fitRestRunning?'Pause':'Resume'}</button>
        <button class="fit-choice primary" id="fitRestSkipBtn" type="button">Skip rest →</button>
      </div>
      <button class="fit-text-btn" id="fitRestPlus" type="button">+30 seconds</button>
    </section>`;
    const pb=$('fitRestPauseBtn'); if(pb) pb.onclick=()=>{ fitRestRunning=!fitRestRunning; pb.textContent=fitRestRunning?'Pause':'Resume'; if(fitRestRunning) runRestTimer(); else clearInterval(fitRestTimer); };
    const sk=$('fitRestSkipBtn'); if(sk) sk.onclick=()=>endRest();
    const pl=$('fitRestPlus'); if(pl) pl.onclick=()=>{ fitRestSecs+=30; const el=$('fitRestTime'); if(el) el.textContent=fmtClock(fitRestSecs); };
    return;
  }

  // exercise page
  const e = fitCurrentExercise(); if (!e) { fitPhase='summary'; fitRenderPlayer(); return; }
  const next = exs[fitPage+1];
  const setNow = Math.min((e.completed_sets||0)+1, e.planned_sets||1);
  const prescription = e.reps ? `${e.reps} reps` : `${e.durationSeconds||0} seconds`;
  const setDots = Array.from({length:e.planned_sets||0},(_,i)=>`<span class="fit-set-dot ${i<(e.completed_sets||0)?'done':i===(e.completed_sets||0)&&e.status!=='completed'?'current':''}"></span>`).join('');
  host.innerHTML = `<section class="fit-page" key="${fitPage}">
    <div class="fit-page-top">
      <span class="fit-eyebrow">Exercise ${fitPage+1} of ${exs.length}${e.category?` · ${e.category}`:''}</span>
      ${dots}
      <h2 class="fit-exercise-name">${e.name}</h2>
      ${(()=>{ const demo=FIT.exerciseDemoFor?FIT.exerciseDemoFor(e.exerciseId):(e.mediaUrl||FIT.exerciseById(e.exerciseId)?.mediaUrl); return demo?`<div class="fit-exercise-media"><img src="${demo}" alt="${e.name} movement demo"></div>`:`<div class="fit-exercise-media fit-exercise-nomedia">No demo GIF in the library for this movement yet — follow the sets and reps below.</div>`; })()}
      <p class="fit-prescription">Set ${e.status==='completed'? e.planned_sets : setNow} of ${e.planned_sets} · ${prescription}</p>
      <div class="fit-set-dots" aria-label="Sets">${setDots}</div>
      <div class="fit-meta-row"><span>Rest ${e.restSeconds}s</span><span>${e.intensity}</span><span>${doneSets}/${totalSets} sets done</span></div>
    </div>
    <div class="fit-page-actions">
      ${e.status==='completed' ? `<button class="fit-cta" id="fitNextBtn" type="button">${next?'Next exercise →':'See summary →'}</button>` : `<button class="fit-cta" id="fitCompleteSet" type="button">Complete set ✓</button>`}
      <div class="fit-row">
        <button class="fit-choice" id="fitPrevBtn" type="button" ${fitPage===0?'disabled':''}>← Previous</button>
        <button class="fit-choice" id="fitSkipBtn" type="button">${e.status==='completed'?'Next':'Skip exercise'}</button>
      </div>
      <div class="fit-row fit-row-small">
        <button class="fit-text-btn" id="fitReduceBtn" type="button">Reduce a set</button>
        <button class="fit-text-btn" id="fitReplaceBtn" type="button">Replace exercise</button>
        <button class="fit-text-btn" id="fitDemoBtn" type="button">Demo: finish now</button>
      </div>
      ${next?`<p class="fit-next-peek">Next: <strong>${next.name}</strong> · ${next.planned_sets} × ${next.reps? next.reps+' reps' : (next.durationSeconds||0)+'s'}</p>`:`<p class="fit-next-peek">Last exercise — summary is next.</p>`}
    </div>
  </section>`;
  const cs=$('fitCompleteSet'); if(cs) cs.onclick=async()=>{ cs.disabled=true; await fitExerciseAction('complete_set', e.exerciseId); try{ navigator.vibrate?.(15); }catch{} const cur=fitCurrentExercise(); if (cur.status==='completed') { if (fitPage < exs.length-1) { startRest(cur.restSeconds||60, true); } else fitGoTo(exs.length,'summary'); } else startRest(cur.restSeconds||60, false); };
  const nb=$('fitNextBtn'); if(nb) nb.onclick=()=>{ if (fitPage < exs.length-1) fitGoTo(fitPage+1); else fitGoTo(exs.length,'summary'); };
  const pv=$('fitPrevBtn'); if(pv) pv.onclick=()=>fitGoTo(fitPage-1);
  const sk2=$('fitSkipBtn'); if(sk2) sk2.onclick=async()=>{ if (e.status!=='completed') await fitExerciseAction('skip', e.exerciseId); if (fitPage < exs.length-1) fitGoTo(fitPage+1); else fitGoTo(exs.length,'summary'); };
  const rd=$('fitReduceBtn'); if(rd) rd.onclick=async()=>{ await fitExerciseAction('reduce_sets', e.exerciseId); fitRenderPlayer(); };
  const rp=$('fitReplaceBtn'); if(rp) rp.onclick=async()=>{ await fitExerciseAction('replace', e.exerciseId); fitRenderPlayer(); };
  const dm=$('fitDemoBtn'); if(dm) dm.onclick=()=>finishFitSession(true);
}
function runRestTimer() {
  clearInterval(fitRestTimer);
  fitRestTimer = setInterval(()=>{ if(!fitRestRunning) return; fitRestSecs--; const el=$('fitRestTime'); if(el) el.textContent=fmtClock(Math.max(0,fitRestSecs)); if (fitRestSecs<=0) { clearInterval(fitRestTimer); try{ navigator.vibrate?.([40,40,40]); }catch{} endRest(); } },1000);
}
let fitRestMovesNext = false;
function startRest(secs, movesNext=false) { fitRestSecs = Math.max(0, secs||60); fitRestMovesNext = movesNext; fitRestRunning = true; fitPhase='rest'; fitRenderPlayer(); const el=$('fitRestTime'); if(el) el.textContent=fmtClock(fitRestSecs); runRestTimer(); }
function endRest() { clearInterval(fitRestTimer); fitRestRunning=false; if (fitRestMovesNext) { fitRestMovesNext=false; fitGoTo(fitPage+1); } else { fitPhase='exercise'; fitRenderPlayer(); } }
function closeFitPlayer() { clearInterval(fitRestTimer); fitRestRunning=false; $('fitPlayer')?.classList.add('hidden'); document.body.classList.remove('fit-locked'); save(); }
async function startFitSession(id, tpl=null) {
  fitSession = await fitApi(async()=>{ const d=await api(`/api/fitness/sessions/${id}/start`,{method:'POST',body:JSON.stringify({})}); state=d.state||state; return d.session; }, ()=> FIT.startSession(state,id));
  fitPage = fitFirstOpenPage(); fitPhase = fitPage >= fitSession.exercises.length ? 'summary' : 'exercise';
  save(); $('fitPlayer').classList.remove('hidden'); document.body.classList.add('fit-locked'); window.scrollTo({top:0}); fitRenderPlayer();
}
async function finishFitSession(demo=false) {
  if (!fitSession) return;
  if (demo) for (const e of [...fitSession.exercises]) { let guard=0; while ((e.completed_sets||0) < e.planned_sets && guard++<8) { await fitExerciseAction('complete_set', e.exerciseId); const cur=fitSession.exercises.find(x=>x.exerciseId===e.exerciseId); if (cur) e.completed_sets=cur.completed_sets; } }
  fitSession = await fitApi(async()=>{ const d=await api(`/api/fitness/sessions/${fitSession.id}/complete`,{method:'POST',body:JSON.stringify({})}); state=d.state||state; return d.session; }, ()=> FIT.completeSession(state, fitSession.id));
  save(); try{ navigator.vibrate?.([30,40,30]); }catch{} fitPhase='feedback'; fitRenderPlayer(); render();
}
const fitFinishBtn=$('fitFinishTop'); if(fitFinishBtn) fitFinishBtn.onclick=()=>{ if(!fitSession) return; if (fitSession.status==='completed') { fitPhase='feedback'; fitRenderPlayer(); } else fitGoTo(fitSession.exercises.length,'summary'); };
const fitCloseBtn=$('fitClose'); if(fitCloseBtn) fitCloseBtn.onclick=()=>{ closeFitPlayer(); render(); };
let fitTouchX = null;
document.addEventListener('touchstart', (e)=>{ if (!$('fitPlayer')?.classList.contains('hidden')) fitTouchX = e.touches?.[0]?.clientX ?? null; }, { passive:true });
document.addEventListener('touchend', (e)=>{ if (fitTouchX==null || $('fitPlayer')?.classList.contains('hidden') || !fitSession) return; const x = e.changedTouches?.[0]?.clientX ?? fitTouchX; const dx = x - fitTouchX; fitTouchX = null; if (Math.abs(dx) < 64 || fitPhase !== 'exercise') return; if (dx < 0) { if (fitPage < fitSession.exercises.length-1) fitGoTo(fitPage+1); else fitGoTo(fitSession.exercises.length,'summary'); } else if (dx > 0 && fitPage > 0) fitGoTo(fitPage-1); }, { passive:true });
document.addEventListener('keydown', (e)=>{ if ($('fitPlayer')?.classList.contains('hidden')) return; if (e.key==='Escape') { closeFitPlayer(); render(); } if (e.key==='ArrowRight' && fitPhase==='exercise') { /* paging is by action, not accidental swipe */ } });

// ---------- Readiness calendar (Insights) ----------
// Deterministic demo history seeded by date, so every render agrees;
// today's cell always reflects the live readiness (scenarios move it).
let calRange = 'week';
let calSelected = null; // yyyy-mm-dd of the tapped day
const calPad = (n) => String(n).padStart(2, '0');
const calKey = (d) => `${d.getFullYear()}-${calPad(d.getMonth() + 1)}-${calPad(d.getDate())}`;
const calSameDay = (a, b) => calKey(a) === calKey(b);
const CAL_MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DOW = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
function readinessOn(d) {
  const now = new Date();
  if (calSameDay(d, now)) return state.currentState.readiness;
  if (d > now) return null;
  return null; // no recorded history until a real pipeline writes daily states
}
function calBand(s) {
  // Diagonal stripes in the band colour: strong stripe + soft stripe.
  if (s == null) return '';
  const stripe = (color, strong, soft) => `background:repeating-linear-gradient(135deg,color-mix(in srgb,${color} ${strong}%,var(--surface)) 0 6px,color-mix(in srgb,${color} ${soft}%,var(--surface)) 6px 12px)`;
  if (s >= 75) return stripe('var(--good)', 62, 30);
  if (s >= 62) return stripe('var(--good)', 38, 16);
  if (s >= 50) return stripe('var(--warn)', 50, 22);
  return stripe('var(--bad)', 58, 26);
}
function calCell(d, mode, idx = 0) {
  const now = new Date();
  const s = readinessOn(d);
  const future = d > now && !calSameDay(d, now);
  const cls = ['cal-cell', mode === 'mini' ? 'mini' : '', calSameDay(d, now) ? 'today' : '', future ? 'future' : '', calSelected === calKey(d) ? 'selected' : ''].filter(Boolean).join(' ');
  const label = `${CAL_DOW[(d.getDay() + 6) % 7]} ${d.getDate()} ${CAL_MONTHS[d.getMonth()].slice(0, 3)}${s == null ? ' — no score yet' : ` — readiness ${s}`}`;
  if (mode === 'mini') return `<button type="button" class="${cls}" data-calday="${calKey(d)}" style="${calBand(s)}" title="${label}" aria-label="${label}"></button>`;
  if (mode === 'week') return `<button type="button" class="${cls}" data-calday="${calKey(d)}" style="${calBand(s)}" aria-label="${label}"><span class="cal-dow">${CAL_DOW[(d.getDay() + 6) % 7]}</span><span class="cal-date">${d.getDate()}</span><span class="cal-score">${s == null ? '–' : s}</span></button>`;
  return `<button type="button" class="${cls}" data-calday="${calKey(d)}" style="${calBand(s)}" aria-label="${label}"><span class="cal-date">${d.getDate()}</span><span class="cal-score">${s == null ? '' : s}</span></button>`;
}
function calPeriodStats(days) {
  const vals = days.map(readinessOn).filter(v => v != null);
  if (!vals.length) return 'No recorded history yet';
  const avg = Math.round(vals.reduce((a, v) => a + v, 0) / vals.length);
  const best = Math.max(...vals);
  const bestDay = days[vals.indexOf(best)];
  return `Average ${avg} · Best ${CAL_DOW[(bestDay.getDay() + 6) % 7]} ${bestDay.getDate()} ${CAL_MONTHS[bestDay.getMonth()].slice(0, 3)} (${best}) · Today ${state.currentState.readiness}`;
}
function renderCalendar() {
  const host = $('readinessCal'); if (!host) return;
  const now = new Date();
  document.querySelectorAll('[data-cal]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.cal === calRange)));
  let html = '', statsDays = [], period = '';
  if (calRange === 'week') {
    const monday = new Date(now); monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
    const days = Array.from({ length: 7 }, (_, i) => { const d = new Date(monday); d.setDate(monday.getDate() + i); return d; });
    statsDays = days; const sun = days[6];
    period = `${monday.getDate()} ${CAL_MONTHS[monday.getMonth()].slice(0, 3)} – ${sun.getDate()} ${CAL_MONTHS[sun.getMonth()].slice(0, 3)}`;
    html = `<div class="cal-week">${days.map((d, i) => calCell(d, 'week', i)).join('')}</div>`;
  } else if (calRange === 'month') {
    const y = now.getFullYear(), m = now.getMonth();
    const first = new Date(y, m, 1), lastDate = new Date(y, m + 1, 0).getDate();
    const blanks = (first.getDay() + 6) % 7;
    const days = Array.from({ length: lastDate }, (_, i) => new Date(y, m, i + 1));
    statsDays = days; period = `${CAL_MONTHS[m]} ${y}`;
    html = `<div class="cal-dowrow">${CAL_DOW.map(d => `<span>${d[0]}</span>`).join('')}</div><div class="cal-month">${'<span class="cal-cell blank"></span>'.repeat(blanks)}${days.map((d, i) => calCell(d, 'month', i)).join('')}</div>`;
  } else {
    const y = now.getFullYear(); period = `${y}`;
    statsDays = Array.from({ length: 365 }, (_, i) => new Date(y, 0, i + 1)).filter(d => d <= now);
    html = `<div class="cal-year">${CAL_MONTHS.map((name, m) => {
      const first = new Date(y, m, 1), lastDate = new Date(y, m + 1, 0).getDate();
      const blanks = (first.getDay() + 6) % 7;
      const days = Array.from({ length: lastDate }, (_, i) => new Date(y, m, i + 1));
      return `<div class="cal-mini"><div class="cal-mini-name">${name.slice(0, 3)}</div><div class="cal-mini-grid">${'<span></span>'.repeat(blanks)}${days.map((d, i) => calCell(d, 'mini', i)).join('')}</div></div>`;
    }).join('')}</div>`;
  }
  host.innerHTML = html;
  const sum = $('calSummary'); if (sum) sum.textContent = `${period} · ${calPeriodStats(statsDays)}`;
  const detail = $('calDetail');
  if (detail) {
    const sel = calSelected ? new Date(calSelected + 'T12:00:00') : now;
    const s = readinessOn(sel);
    detail.textContent = s == null ? `${CAL_DOW[(sel.getDay() + 6) % 7]} ${sel.getDate()} ${CAL_MONTHS[sel.getMonth()].slice(0, 3)} — no score yet` : `${CAL_DOW[(sel.getDay() + 6) % 7]} ${sel.getDate()} ${CAL_MONTHS[sel.getMonth()].slice(0, 3)} — Readiness ${s}${calSameDay(sel, now) ? ' · today' : ''}`;
  }
  host.querySelectorAll('[data-calday]').forEach(b => b.onclick = () => { calSelected = b.dataset.calday; renderCalendar(); });
}
document.querySelectorAll('[data-cal]').forEach(b => b.onclick = () => { calRange = b.dataset.cal; renderCalendar(); });

function whyHtml() { const r = state.lastReasoning; if (!r) return 'No reasoning yet. Glyth needs your data before it can explain a day.'; const c = state.currentState; const recent = r.recentContext || [`${c.consecutivePoorNights || 0} consecutive below-baseline nights`, `Training load ${c.trainingLoad}/100`]; const important = r.importantToday || state.plan.filter(x => x.priority === 'critical').map(x => `${x.title} · ${x.time}`); return `${r.summary ? `<p style="margin-top:0">${r.summary}</p>` : ''}<p><span class="label">Observed</span><br>${r.observed.join(' · ')}</p><p><span class="label">Compared with</span><br>${r.comparedWith.join(' · ')}</p><p><span class="label">Recent context</span><br>${recent.join('<br>')}</p><p><span class="label">Important today</span><br>${important.join('<br>') || 'No critical commitment'}</p><p><span class="label">Likely impact</span><br>Physical capacity lower · Attention risk elevated<br>${r.likelyImpact.join('<br>')}</p><p><span class="label">Glyth response</span><br>${r.response.join('<br>')}</p><p class="small muted">Confidence ${r.confidence}% · Reasoning: ${r.provider}. This is a structured summary, not a chain of thought — no causal claims beyond the evidence.</p>`; }
function openSheet(html) { $('sheetContent').innerHTML = html; const cb = $('closeSheet'); if (cb) setTimeout(() => cb.focus({ preventScroll: true }), 60); const s = $('sheet'); s.classList.remove('hidden', 'closing'); $('backdrop').classList.remove('hidden', 'closing'); requestAnimationFrame(() => { s.style.animation = 'none'; void s.offsetWidth; s.style.animation = ''; }); }
function closeSheet() { const s = $('sheet'), b = $('backdrop'); if (s.classList.contains('hidden')) return; s.classList.add('closing'); b.classList.add('closing'); setTimeout(() => { s.classList.add('hidden'); s.classList.remove('closing'); b.classList.add('hidden'); b.classList.remove('closing'); }, 240); }
$('closeSheet').onclick = closeSheet;
$('backdrop').onclick = closeSheet;
function switchPlanTab(name) { document.querySelectorAll('[data-ptab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.ptab === name))); $('panel-plan')?.classList.toggle('hidden', name !== 'plan'); $('panel-recs')?.classList.toggle('hidden', name !== 'recs'); }
document.querySelectorAll('[data-ptab]').forEach(b => b.onclick = () => switchPlanTab(b.dataset.ptab));
$('nextAction').onclick = () => { switchPlanTab('plan'); document.querySelector('.plan-tabs')?.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' }); };
$('whyBtn').onclick = () => openSheet(`<h2>Why your day changed</h2>${whyHtml()}`);
const orchBtn = $('orchestrateBtn');
if (orchBtn) orchBtn.onclick = async () => { const status = $('orchestrateStatus'); orchBtn.disabled = true; orchBtn.textContent = 'Re-evaluating your day…'; if (status) status.textContent = ''; try { await act(() => E.orchestrate(state), () => api('/api/orchestrate', { method: 'POST', body: JSON.stringify({}) })); if (status) status.textContent = state.changesCount ? `${state.changesCount} adjustment${state.changesCount > 1 ? 's' : ''} · ${state.lastReasoning?.provider || 'local'}` : `No changes needed · ${state.lastReasoning?.provider || 'local'}`; } catch { if (status) status.textContent = 'Could not re-evaluate — your plan is unchanged.'; } finally { orchBtn.disabled = false; orchBtn.textContent = 'Re-evaluate my day'; } };
const SUPPORT_AREAS = {
  mindfulness: { title: 'Mindfulness', status: '2-minute reset, ready', body: 'Short, on-demand resets that fit between meetings. Glyth suggests them when stress rises or recovery drops — like today — and never shares your usage in detail.', next: 'Start a 2-minute reset before your next meeting.' },
  finance: { title: 'Finance', status: 'Weekly check-in due', body: 'A calm weekly money check-in: what came in, what went out, and one small decision. Glyth keeps this private and only surfaces it when workload or stress makes money feel heavier.', next: 'Do the 5-minute weekly check-in on Friday.' },
  fitness: { title: 'Fitness', status: 'Training resources', body: 'Training that adapts to sleep and recovery. After poor sleep Glyth swaps heavy work for recovery — the goal is consistency across the week, not heroics on one day.', next: 'Sessions appear here once training data is connected.' },
  family: { title: 'Family', status: 'People and time', body: 'The people outside work get protected time too. Glyth treats family commitments as fixed points the rest of the day bends around, not leftovers.', next: 'Family time appears here once your calendar is connected.' },
  workplace: { title: 'Workplace Support', status: 'People team resources · Confidential', body: 'Your organisation’s support routes: people team, wellbeing benefits, and confidential help. Glyth can point you here; it never reports back what you open or use.', next: 'Browse resources, or ask Glyth to find the right one.' },
  coaches: { title: 'Coaches', status: 'Human coaches', body: 'Human coaches for the things an app shouldn’t handle alone. Sessions are private — your employer sees that coaching exists, never what’s discussed.', next: 'Your sessions appear here once coaching is connected.' },
};
document.querySelectorAll('[data-area]').forEach(b => b.onclick = () => { if (b.dataset.area === 'mindfulness') { openMindfulness(); return; } if (b.dataset.area === 'fitness') { openFitness(); return; } if (b.dataset.area === 'finance') { openFinance(); return; } if (b.dataset.area === 'family') { openFamily(); return; } const x = SUPPORT_AREAS[b.dataset.area]; if (!x) return; openSheet(`<div class="label">Support</div><h2 style="font-size:24px;margin:6px 0">${x.title}</h2><span class="chip">${x.status}</span><p style="margin-top:14px">${x.body}</p><p><span class="label">Next</span><br>${x.next}</p><button class="btn" id="areaAsk">Ask Glyth about this</button>`); $('areaAsk').onclick = () => { closeSheet(); setTimeout(openAsk, 260); }; });
let notifsRead = false;
function buildNotifications() {
  const list = [];
  if (state.changesCount) list.push({ title: 'Your day changed', body: `${state.changesCount} adjustment${state.changesCount > 1 ? 's' : ''} made — ${state.insight.headline}`, when: 'Today' });
  state.recommendations.filter(r => r.status === 'proposed').forEach(r => list.push({ title: 'Recommendation waiting', body: r.title, when: 'Today' }));
  if (state.weeklySummary) list.push({ title: 'Weekly summary ready', body: state.weeklySummary, when: 'This week' });
  return list;
}
function syncNotifBadge() { const b = $('notifBadge'); if (!b) return; const n = notifsRead ? 0 : buildNotifications().length; b.textContent = n; b.classList.toggle('hidden', n === 0); }
$('notifBtn').onclick = () => { const list = buildNotifications(); openSheet(`<div class="label">Notifications</div><h2 style="font-size:24px;margin:6px 0 4px">What's new</h2>${list.map(n => `<div class="notif-row"><span class="notif-dot ${notifsRead ? 'read' : ''}"></span><div><strong>${n.title}</strong><div class="muted small">${n.body}</div><div class="muted small">${n.when}</div></div></div>`).join('')}`); notifsRead = true; syncNotifBadge(); };
$('workplaceBtn').onclick = () => {
  openSheet(`<div class="label">Workplace profile</div><h2 style="font-size:24px;margin:6px 0 4px">Northstar</h2><span class="chip">${state.profile.name ? `Member · ${state.profile.name}` : 'Member'}</span>
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
  const initials = ctx.user_profile.name ? ctx.user_profile.name.split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase() : 'G';
  const dev = (v, suffix = '') => v == null ? '<span class="v">—</span>' : `<span class="v ${v < 0 ? 'neg' : v > 0 ? 'pos' : ''}">${v > 0 ? '+' : ''}${v}${suffix}</span>`;
  const row = (k, v) => `<div class="flow-row"><span class="k">${k}</span>${typeof v === 'string' && v.startsWith('<') ? v : `<span class="v">${v}</span>`}</div>`;
  return `<div class="flow-head"><div class="avatar" aria-hidden="true">${initials}</div><div><div class="label">FlowID Lite</div><h2>${ctx.user_profile.name || 'Your FlowID'}</h2><p class="muted small">The context Glyth reasons over — compact, deterministic, never the whole database.</p></div></div>
  <section class="flow-section"><div class="label">Appearance</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Dark mode<br><span class="small">Graphite theme, easier at night</span></span><button class="switch" id="themeSwitch" role="switch" aria-checked="false" aria-label="Dark mode"></button></div>
  </div></section>
  <section class="flow-section"><div class="label">Current state</div><div class="flow-rings">
    ${[['Sleep', c.sleepMinutes != null && state.baselines.sleepMinutes ? Math.min(100, Math.round(c.sleepMinutes / state.baselines.sleepMinutes * 100)) : 0, ctx.current_state.sleep], ['Recovery', c.recovery ?? 0, c.recovery == null ? '—' : c.recovery + '%'], ['Energy', c.energy ?? 0, c.energy == null ? '—' : String(c.energy)], ['Workload', c.workload ?? 0, c.workload == null ? '—' : String(c.workload)], ['Training', c.trainingLoad ?? 0, c.trainingLoad == null ? '—' : String(c.trainingLoad)], ['Stress', c.stress ?? 0, c.stress == null ? '—' : String(c.stress)]].map(([label, pct, val]) => `<div class="flow-ring"><div class="ring-wrap"><svg viewBox="0 0 78 78" aria-hidden="true"><circle class="ring-track" cx="39" cy="39" r="32" fill="none" stroke-width="6"/><circle class="ring-value" cx="39" cy="39" r="32" fill="none" stroke-width="6" stroke-linecap="round" stroke-dasharray="201" style="--off:${201 * (1 - pct / 100)};stroke-dashoffset:${201 * (1 - pct / 100)}"/></svg><div class="ring-centre"><b>${val}</b></div></div><span class="ring-label">${label}</span></div>`).join('')}
  </div><p class="muted small" style="margin:10px 0 0">Sleep ring shows time asleep against your ${ctx.baselines.sleep} baseline · sleep quality ${c.sleepQuality == null ? '—' : c.sleepQuality + '%'}.</p></section>
  <section class="flow-section"><div class="label">Against baseline</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Sleep (${ctx.baselines.sleep} baseline)</span>${dev(d.sleepPct, '%')}</div>
    <div class="flow-row"><span class="k">Recovery (${ctx.baselines.recovery}% baseline)</span>${dev(d.recoveryPts, ' pts')}</div>
    <div class="flow-row"><span class="k">Energy (${ctx.baselines.energy} baseline)</span>${dev(d.energyPts, ' pts')}</div>
  </div></section>
  <section class="flow-section"><div class="label">Data connections</div><div class="flow-rows">${(state.connections || []).length ? state.connections.map(cn => row(`${cn.kind} · ${cn.provider}`, `${cn.status} · last synced ${cn.last_success_at ? cn.last_success_at.slice(0, 16).replace('T', ' ') : '—'}`)).join('') : row('Health, calendar, training', 'Not connected')}</div></section>
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
const reset = async () => { const msg = $('todayScenarioMsg'); if (msg) msg.textContent = 'Resetting your demo day…'; try { await act(() => { state = E.resetDemo(); }, () => api('/api/reset', { method: 'POST' })); } catch { /* act falls back locally */ } if (msg) msg.textContent = 'Reset complete.'; const sm = $('scenarioMsg'); if (sm) sm.textContent = 'Demo reset — baseline restored.'; switchView('today'); window.scrollTo({ top: 0 }); };
const rb = $('resetBtn'); if (rb) rb.onclick = reset; const rb2 = $('resetBtn2'); if (rb2) rb2.onclick = reset;
document.querySelectorAll('nav.liquid button').forEach(b => b.onclick = () => switchView(b.dataset.view));
const VIEW_ORDER = ['today', 'insights', 'support']; let currentView = 'today', switchTimer = null;
function moveIndicator(v = currentView) { const btn = document.querySelector(`nav.liquid button[data-view="${v}"]`), ind = document.querySelector('.nav-indicator'); if (!btn || !ind) return; ind.style.width = btn.offsetWidth + 'px'; ind.style.transform = `translateX(${btn.offsetLeft}px)`; ind.style.opacity = '1'; }
function backToMainView(v = 'support') {
  // Module pages (Fitness/Mindfulness) are shown over a main tab without
  // changing currentView, so switchView(v) would early-return when v is
  // already the underlying tab. Force the return explicitly.
  clearTimeout(switchTimer);
  currentView = v;
  document.querySelectorAll('nav.liquid button').forEach(b => b.setAttribute('aria-selected', String(b.dataset.view === v)));
  document.querySelectorAll('.view').forEach(s => { s.classList.add('hidden'); s.classList.remove('enter-next', 'enter-prev', 'is-leaving'); });
  const next = $('view-' + v); if (next) next.classList.remove('hidden');
  moveIndicator(v); syncFab(); if (askOpen) renderAsk();
  window.scrollTo({ top: 0 });
}
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
  today: { label: 'Ask Glyth about Today', sub: () => state.currentState.readiness == null ? 'Your plan for today. Changes are proposed first, never applied silently.' : `Your plan for today — readiness ${state.currentState.readiness}, recovery ${state.currentState.recovery}%. Changes are proposed first, never applied silently.`, prompts: ['Why did my plan change?', 'What matters most today?', 'Give me a coaching tip for today', 'Keep my workout'] },
  insights: { label: 'Insights, at a glance', sub: () => `What Glyth is noticing — ${state.insight.headline}`, prompts: ['Why did my plan change?', 'What is affecting me most?', 'What happens if I still train?'] },
  support: { label: 'Support, at a glance', sub: () => 'Mindfulness, finance, fitness, family, workplace support and coaches — ask where to start.', prompts: ['I need support', 'Find me a coach', 'Start a mindfulness reset'] },
};
function syncFab() {
  const ctx = ASK_CONTEXT[currentView] || ASK_CONTEXT.today, fab = $('askFab');
  document.querySelectorAll('.fab-icon').forEach(i => i.classList.toggle('is-active', i.dataset.iconFor === currentView));
  fab.setAttribute('aria-label', ctx.label); fab.title = ctx.label;
}
function askSheetHtml() {
  const msgs = state.conversation.slice(-8);
  const actx = ASK_CONTEXT[currentView] || ASK_CONTEXT.today;
  return `<div class="ask-head"><div><h2 style="margin:0">Ask Glyth</h2><p class="muted small" style="margin:2px 0 0">${actx.sub()}</p></div><button class="top-icon" id="askClose" aria-label="Close Ask Glyth">✕</button></div>
  <div class="ask-msgs" id="askMsgs">${msgs.length ? msgs.map(m => `<div class="msg ${m.role}">${m.role === 'glyth' ? chatHtml(m.text) : String(m.text).replace(/&/g, '&amp;').replace(/</g, '&lt;')}${m.role === 'glyth' && m.source ? `<div class="muted small" style="margin-top:6px">${askSourceLabel(m)}</div>` : ''}${m.proposal ? `<div style="margin-top:10px"><button class="btn sm" id="confirmProposal">Confirm: ${m.proposal.label}</button></div>` : ''}</div>`).join('') : '<div class="msg glyth">Ask me why your plan changed, what to prioritise, or tell me to keep your workout. Plan changes are proposed first — nothing applies without your confirmation.</div>'}</div>
  ${state.conversation.some(m => m.role === 'user') ? '' : `<div class="ask-prompts">${actx.prompts.map(p => `<button class="btn sm ghost" data-prompt="${p}">${p}</button>`).join('')}</div>`}
  <form class="ask-composer" id="askForm"><input id="askInput" autocomplete="off" aria-label="Ask Glyth" placeholder="Ask Glyth anything about today…"><button class="btn" type="submit" aria-label="Send">↑</button></form>`;
}
let askOpen = false;
function renderAsk() { $('askPanelInner').innerHTML = askSheetHtml(); bindAsk(); const m = $('askMsgs'); if (m) m.scrollTop = m.scrollHeight; }
function openAsk() { if (askOpen) return; askOpen = true; const p = $('askPanel'); p.classList.remove('closing'); p.classList.add('is-open'); p.setAttribute('aria-hidden', 'false'); $('askFab').classList.add('is-open'); $('askFab').setAttribute('aria-expanded', 'true'); document.body.classList.add('ask-open'); const dot = $('askDot'); if (dot) dot.classList.add('hidden'); renderAsk(); setTimeout(() => { const i = $('askInput'); if (i && matchMedia('(pointer:fine)').matches) i.focus({ preventScroll: true }); }, 380); }
function closeAsk() { if (!askOpen) return; askOpen = false; const p = $('askPanel'); p.classList.add('closing'); p.classList.remove('is-open'); p.setAttribute('aria-hidden', 'true'); $('askFab').classList.remove('is-open'); $('askFab').setAttribute('aria-expanded', 'false'); document.body.classList.remove('ask-open'); setTimeout(() => p.classList.remove('closing'), 300); }
function bindAsk() {
  const close = $('askClose'); if (close) close.onclick = closeAsk;
  const form = $('askForm'); if (!form) return;
  form.onsubmit = async (e) => { e.preventDefault(); const input = $('askInput'), q = input.value.trim(); if (!q) return; input.value = ''; await submitAsk(q); renderAsk(); const i = $('askInput'); if (i) i.focus({ preventScroll: true }); };
  document.querySelectorAll('[data-prompt]').forEach(b => b.onclick = async () => { await submitAsk(b.dataset.prompt); renderAsk(); });
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
// ---------- Settings: a list of categories, each opening its own menu ----------
const UI_SETTINGS_KEY = 'glyth-ui-settings-v1';
let uiSettings = { shareAggregates: true, includeInTeamInsights: true, calendarLocal: true, wearableSync: false, slackSync: false, weeklyDigest: true };
try { uiSettings = { ...uiSettings, ...JSON.parse(localStorage.getItem(UI_SETTINGS_KEY)) }; } catch { /* defaults */ }
const saveUiSettings = () => { try { localStorage.setItem(UI_SETTINGS_KEY, JSON.stringify(uiSettings)); } catch { /* private mode */ } };
const SETTINGS_ICONS = {
  account: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="8" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/></svg>',
  privacy: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="10.5" width="14" height="9.5" rx="2.5"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/><circle cx="12" cy="15.2" r="1.3"/></svg>',
  integrations: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 7V3.5M15 7V3.5M7 7h10v3.5a5 5 0 0 1-10 0V7z"/><path d="M12 15.5V21"/></svg>',
  appearance: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2.5v2.4M12 19.1v2.4M2.5 12h2.4M19.1 12h2.4M5 5l1.7 1.7M17.3 17.3L19 19M19 5l-1.7 1.7M6.7 17.3L5 19"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.2A2.6 2.6 0 0 1 12 7.5c1.4 0 2.5 1 2.5 2.2 0 1.7-2.4 2-2.4 3.5"/><circle cx="12" cy="17" r=".4" fill="currentColor"/></svg>',
};
function settingsListRow(id, icon, title, sub) {
  return `<button class="settings-row" id="${id}" type="button"><span class="settings-icon">${SETTINGS_ICONS[icon]}</span><span class="support-row-text"><strong>${title}</strong><span class="muted small">${sub}</span></span><span class="chevron" aria-hidden="true">›</span></button>`;
}
function settingsHead(label, title, sub = '') {
  return `<button class="icon-btn" id="settingsBack" type="button" style="margin-bottom:12px">‹ Settings</button><div class="label">${label}</div><h2 style="font-size:24px;margin:6px 0 4px">${title}</h2>${sub ? `<p class="muted small" style="margin:0">${sub}</p>` : ''}`;
}
function openSettingsPage(html, backFn) {
  openSheet(html);
  const b = $('settingsBack'); if (b) { b.onclick = backFn || openSettings; if (backFn && backFn !== openSettings) b.textContent = '‹ Back'; }
}
function wireUiSwitches() {
  document.querySelectorAll('[data-setting]').forEach(b => b.onclick = () => {
    const k = b.dataset.setting; uiSettings[k] = !uiSettings[k]; saveUiSettings();
    b.setAttribute('aria-checked', String(uiSettings[k]));
    const row = b.closest('.flow-row'); const v = row?.querySelector('[data-setting-state]');
    if (v) v.textContent = uiSettings[k] ? 'On' : 'Off';
  });
}
function openSettings() {
  openSheet(`<div class="label">Settings</div><h2 style="font-size:24px;margin:6px 0 14px">Settings</h2>
  <div class="settings-list">
    ${settingsListRow('setAccount', 'account', 'Account', account ? `Signed in · ${account.email}` : 'Profile, sign-in and security')}
    ${settingsListRow('setPrivacy', 'privacy', 'Privacy', 'What Northstar can see, sharing and your data')}
    ${settingsListRow('setIntegrations', 'integrations', 'Integrations', 'Calendar, wearables and connected apps')}
    ${settingsListRow('setAppearance', 'appearance', 'Appearance & behaviour', 'Dark mode and how Glyth adapts your day')}
    ${settingsListRow('setHelp', 'help', 'Help', 'How Glyth works, guides and support')}
  </div>
  <p class="muted small" style="margin:14px 2px 0">Glyth Workplace · Snapshot v0.1</p>`);
  $('setAccount').onclick = openSettingsAccount;
  $('setPrivacy').onclick = openSettingsPrivacy;
  $('setIntegrations').onclick = openSettingsIntegrations;
  $('setAppearance').onclick = openSettingsAppearance;
  $('setHelp').onclick = openSettingsHelp;
}
function openSettingsAccount() {
  openSettingsPage(`${settingsHead('Settings · Account', 'Account', 'Your profile and how you sign in.')}
  <section class="flow-section"><div class="label">Profile</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Name</span><span class="v">${state.profile.name || 'Add your name by creating an account'}</span></div>
    <div class="flow-row"><span class="k">Email</span><span class="v">${account ? account.email : 'Not signed in'}</span></div>
    <div class="flow-row"><span class="k">Wake time</span><span class="v">${state.profile.wakeTime}</span></div>
    <div class="flow-row"><span class="k">Timezone</span><span class="v">${state.profile.timezone}</span></div>
  </div></section>
  <section class="flow-section"><div class="label">Sign-in &amp; security</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Status</span><span class="v">${account ? 'Signed in' : 'Not signed in'}</span></div>
    <div class="flow-row"><span class="k">Account type</span><span class="v">${account ? 'Supabase (User Context)' : '—'}</span></div>
    <div class="flow-row"><span class="k">Password</span><span class="v">${account ? '••••••••' : '—'}</span></div>
  </div><div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">${account ? '<button class="btn ghost" id="signOutBtn">Sign out</button>' : '<button class="btn" id="signUpBtn">Create account</button><button class="btn ghost" id="signInBtn">Sign in</button>'}</div></section>
  <section class="flow-section"><div class="label">Your context</div><p class="muted small">Your FlowID is the compact context Glyth reasons over. Personal data lives here, on your side — never in the employer view.</p><button class="btn ghost" id="accountFlowBtn">View my FlowID</button></section>`);
  const su = $('signUpBtn'); if (su) su.onclick = () => { closeSheet(); setTimeout(() => openAuth('signup'), 260); };
  const si = $('signInBtn'); if (si) si.onclick = () => { closeSheet(); setTimeout(() => openAuth('signin'), 260); };
  const so = $('signOutBtn'); if (so) so.onclick = () => { signOut(); openSettingsAccount(); };
  const fb = $('accountFlowBtn'); if (fb) fb.onclick = () => { openSheet(flowIdHtml()); syncThemeBtn(); const sw = $('themeSwitch'); if (sw) sw.onclick = toggleTheme; };
}
function openSettingsPrivacy() {
  const sw = (key, label, sub) => `<div class="flow-row"><span class="k">${label}<br><span class="small">${sub}</span></span><span style="display:flex;align-items:center;gap:10px"><span class="v" data-setting-state>${uiSettings[key] ? 'On' : 'Off'}</span><button class="switch" data-setting="${key}" role="switch" aria-checked="${uiSettings[key]}" aria-label="${label}"></button></span></div>`;
  openSettingsPage(`${settingsHead('Settings · Privacy', 'Privacy', 'You stay on your side of the line. Northstar only ever sees aggregated work patterns.')}
  <section class="flow-section"><div class="label">Sharing with Northstar</div><div class="flow-rows">
    ${sw('shareAggregates', 'Share work-pattern aggregates', 'Workload, meeting density and focus fragmentation, grouped')}
    ${sw('includeInTeamInsights', 'Include me in team insights', 'Only ever in groups of 5 or more people')}
  </div></section>
  <section class="flow-section"><div class="label">What Northstar can see</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Team workload &amp; capacity</span><span class="v">Aggregated</span></div>
    <div class="flow-row"><span class="k">Meeting density &amp; focus fragmentation</span><span class="v">Aggregated</span></div>
    <div class="flow-row"><span class="k">Privacy threshold</span><span class="v">Groups of 5+</span></div>
  </div></section>
  <section class="flow-section"><div class="label">What never crosses</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Sleep, health &amp; recovery</span><span class="v">Never</span></div>
    <div class="flow-row"><span class="k">Conversations with Glyth</span><span class="v">Never</span></div>
    <div class="flow-row"><span class="k">Support resources you open</span><span class="v">Never</span></div>
    <div class="flow-row"><span class="k">Anything about you as an individual</span><span class="v">Never</span></div>
  </div></section>
  <section class="flow-section"><div class="label">Your data</div><p class="muted small">Take a copy of everything Glyth holds in this demo, or reset it entirely.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn ghost" id="privacyExport">Download my data</button><button class="btn ghost" id="privacyReset">Reset demo data</button></div></section>`);
  wireUiSwitches();
  $('privacyExport').onclick = () => {
    const blob = new Blob([JSON.stringify({ profile: state.profile, currentState: state.currentState, goals: state.goals, plan: state.plan, settings: uiSettings }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'glyth-my-data.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  };
  $('privacyReset').onclick = async () => { closeSheet(); await act(() => { state = E.resetDemo(); }, () => api('/api/reset', { method: 'POST' })); switchView('today'); };
}
function openSettingsIntegrations() {
  const sw = (key, label, sub, onLabel = 'Connected') => `<div class="flow-row"><span class="k">${label}<br><span class="small">${sub}</span></span><span style="display:flex;align-items:center;gap:10px"><span class="v" data-setting-state>${uiSettings[key] ? onLabel : 'Off'}</span><button class="switch" data-setting="${key}" role="switch" aria-checked="${uiSettings[key]}" aria-label="${label}"></button></span></div>`;
  openSettingsPage(`${settingsHead('Settings · Integrations', 'Integrations', 'Connected apps feed your FlowID. Nothing connects without you switching it on.')}
  <section class="flow-section"><div class="label">Calendar</div><div class="flow-rows">
    ${sw('calendarLocal', 'Local calendar', 'The demo calendar Glyth plans around today')}
    <div class="flow-row"><span class="k">Google Calendar<br><span class="small">Full two-way sync in the complete app</span></span><button class="btn ghost sm" id="googleCalBtn" type="button">Connect</button></div>
  </div><p class="muted small hidden" id="googleCalNote" style="margin:10px 0 0">Google Calendar plugs in at this point in the full app. This demo runs on the local calendar only — no events leave your device.</p></section>
  <section class="flow-section"><div class="label">Health &amp; activity</div><div class="flow-rows">
    ${sw('wearableSync', 'Wearable sync', 'Sleep, recovery and training load from your wearable', 'Syncing')}
  </div><p class="muted small" style="margin:10px 0 0">Health signals stay in your FlowID. They are on the list of things that never cross to your employer.</p></section>
  <section class="flow-section"><div class="label">Messaging · Unipile</div>
    <p class="muted small" style="margin:0 0 10px">Connect a messaging account through Unipile. You log in at the provider — Glyth never sees your password. Conversations stay private and never reach your employer.</p>
    <div class="flow-rows">
      <div class="flow-row"><span class="k">WhatsApp<br><span class="small">Chats and replies in Messages</span></span><button class="btn ghost sm" data-uconnect="whatsapp" type="button">Connect</button></div>
      <div class="flow-row"><span class="k">LinkedIn<br><span class="small">Messages and replies in Messages</span></span><button class="btn ghost sm" data-uconnect="linkedin" type="button">Connect</button></div>
      <div class="flow-row"><span class="k">Instagram<br><span class="small">DMs and replies in Messages</span></span><button class="btn ghost sm" data-uconnect="instagram" type="button">Connect</button></div>
    </div>
    <div id="unipileAccounts" style="margin-top:10px"><p class="muted small">Checking connected accounts…</p></div>
    <p class="muted small hidden" id="unipileNote" style="margin:10px 0 0"></p>
  </section>
  <section class="flow-section"><div class="label">Work apps</div><div class="flow-rows">
    ${sw('slackSync', 'Slack', 'Let Glyth protect focus time in your status', 'Linked')}
    ${sw('weeklyDigest', 'Weekly digest email', 'A short Sunday summary of your week', 'Subscribed')}
  </div></section>
  <section class="flow-section" id="appleSources"><div class="label">Apple (iOS app)</div><div class="flow-rows">
    <div class="flow-row" id="appleHealthRow"><span class="k">Apple Health<br><span class="small">Sleep, HRV, resting heart rate, workouts — private to you</span></span><button class="btn ghost sm" id="appleHealthBtn" type="button">Connect</button></div>
    <div class="flow-row" id="appleCalRow"><span class="k">Apple Calendar<br><span class="small">Fixed commitments and important time</span></span><button class="btn ghost sm" id="appleCalBtn" type="button">Connect</button></div>
  </div><p class="muted small" id="appleStatus" style="margin:10px 0 0">Checking this device…</p></section>`);
  wireUiSwitches();
  (async () => {
    const host = $('unipileAccounts'); if (!host) return;
    const renderAccounts = (accounts) => { host.innerHTML = (accounts.length ? accounts.map(ac => `<div class="flow-row"><span class="k">${ac.provider}<br><span class="small">${ac.status}${ac.last_synced_at ? ` · synced ${String(ac.last_synced_at).slice(0, 16).replace('T', ' ')}` : ''}</span></span><button class="btn ghost sm" data-usync="${ac.id}" type="button">Sync</button></div>`).join('') : '<p class="muted small">No messaging accounts connected yet.</p>') + '<div style="margin-top:10px"><button class="btn ghost sm" id="unipileRefreshBtn" type="button">Refresh connected accounts</button></div>';
      const rb = $('unipileRefreshBtn'); if (rb) rb.onclick = async () => { rb.disabled = true; rb.textContent = 'Checking…'; const n = $('unipileNote'); try { const r = await api('/api/unipile/accounts/refresh', { method: 'POST', body: JSON.stringify({}) }); const d = await api('/api/communications/accounts'); renderAccounts(d.accounts || []); if (n) { n.textContent = r.added ? `Connected account found and linked.` : (d.accounts?.length ? 'Your connected account is already linked.' : 'No connected account found yet — finish the login in the provider tab first, then refresh.'); n.classList.remove('hidden'); } } catch (e) { if (n) { n.textContent = e.message || 'Could not check connected accounts.'; n.classList.remove('hidden'); } rb.disabled = false; rb.textContent = 'Refresh connected accounts'; } };
      host.querySelectorAll('[data-usync]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Syncing…'; try { await api('/api/unipile/sync', { method: 'POST', body: JSON.stringify({ account_id: b.dataset.usync }) }); const d = await api('/api/communications/accounts'); renderAccounts(d.accounts || []); } catch (e) { const n = $('unipileNote'); if (n) { n.textContent = e.message || 'Sync failed.'; n.classList.remove('hidden'); } b.disabled = false; b.textContent = 'Sync'; } }); };
    try { const d = await api('/api/communications/accounts'); renderAccounts(d.accounts || []); } catch { host.innerHTML = '<p class="muted small">Could not load messaging accounts.</p>'; }
    document.querySelectorAll('[data-uconnect]').forEach(b => b.onclick = async () => { const n = $('unipileNote'); b.disabled = true; try { const d = await api('/api/unipile/connect', { method: 'POST', body: JSON.stringify({ provider: b.dataset.uconnect }) }); if (d.url) { window.open(d.url, '_blank', 'noopener'); if (n) { n.textContent = 'Complete the login in the new tab, then come back and tap “Refresh connected accounts”.'; n.classList.remove('hidden'); } } else if (n) { n.textContent = 'Connection link returned no URL — check the server configuration.'; n.classList.remove('hidden'); } } catch (e) { if (n) { n.textContent = e.message || 'Could not start the connection.'; n.classList.remove('hidden'); } } finally { b.disabled = false; } });
  })();
  $('googleCalBtn').onclick = () => { $('googleCalNote').classList.remove('hidden'); $('googleCalBtn').textContent = 'Demo only'; };
  nativeCapabilities().then(caps => {
    const status = $('appleStatus'); if (!status) return;
    if (!caps.healthKit && !caps.calendar) { $('appleSources')?.remove(); return; }
    if (!caps.healthKit) $('appleHealthRow')?.remove(); if (!caps.calendar) $('appleCalRow')?.remove();
    status.textContent = 'Available on this device. Connecting asks for permission first — nothing syncs until you allow it.';
    const hb = $('appleHealthBtn'); if (hb) hb.onclick = async () => { hb.disabled = true; status.textContent = 'Requesting HealthKit permission…'; try { await HealthBridge.requestAuthorization(); const sleep = await HealthBridge.syncSleep(); await api('/api/ingest/health', { method: 'POST', body: JSON.stringify({ provider: 'apple_healthkit', samples: sleep.samples || [], deleted_external_ids: sleep.deleted_external_ids || [] }) }); const rec = await HealthBridge.syncRecoverySignals(); await api('/api/ingest/health', { method: 'POST', body: JSON.stringify({ provider: 'apple_healthkit', samples: rec.samples || [], deleted_external_ids: rec.deleted_external_ids || [] }) }); const wo = await HealthBridge.syncWorkouts(); await api('/api/ingest/workouts', { method: 'POST', body: JSON.stringify({ provider: 'apple_healthkit', workouts: wo.samples || [] }) }); status.textContent = 'Apple Health synced just now.'; } catch (e) { status.textContent = `Apple Health unavailable: ${e.message || e}`; } finally { hb.disabled = false; } };
    const cb = $('appleCalBtn'); if (cb) cb.onclick = async () => { cb.disabled = true; status.textContent = 'Requesting calendar permission…'; try { await CalendarBridge.requestReadAccess(); const ev = await CalendarBridge.syncEvents({ days: 14 }); await api('/api/ingest/calendar', { method: 'POST', body: JSON.stringify({ provider: 'apple_calendar', events: ev.events || [] }) }); status.textContent = 'Apple Calendar synced just now.'; } catch (e) { status.textContent = `Apple Calendar unavailable: ${e.message || e}`; } finally { cb.disabled = false; } };
  }).catch(() => { $('appleSources')?.remove(); });
}
function openSettingsAppearance() {
  const dark = document.documentElement.dataset.theme === 'dark';
  openSettingsPage(`${settingsHead('Settings · Appearance', 'Appearance & behaviour', 'How Glyth looks, and how it adapts your day.')}
  <section class="flow-section"><div class="label">Appearance</div><div class="flow-rows"><div class="flow-row"><span class="k">Dark mode<br><span class="small">Graphite theme, easier at night</span></span><button class="switch" id="themeSwitch" role="switch" aria-checked="${dark}" aria-label="Dark mode"></button></div></div></section>
  <section class="flow-section"><div class="label">Behaviour</div><div class="flow-rows">
    <div class="flow-row"><span class="k">Protect focus when tired<br><span class="small">Guard deep work on low-recovery days</span></span><button class="switch" data-pref="protectFocus" role="switch" aria-checked="${state.preferences.protectFocus}" aria-label="Protect focus when tired"></button></div>
    <div class="flow-row"><span class="k">Defer low-value work<br><span class="small">Move admin on high-load days</span></span><button class="switch" data-pref="deferLowValueWhenTired" role="switch" aria-checked="${state.preferences.deferLowValueWhenTired}" aria-label="Defer low-value work"></button></div>
    <div class="flow-row"><span class="k">Training time</span><span class="v">${state.preferences.trainingTime}</span></div>
  </div></section>`);
  syncThemeBtn();
  const swEl = $('themeSwitch'); if (swEl) swEl.onclick = toggleTheme;
  document.querySelectorAll('[data-pref]').forEach(b => b.onclick = () => { const k = b.dataset.pref; state.preferences[k] = !state.preferences[k]; b.setAttribute('aria-checked', String(state.preferences[k])); save(); });
}
function openSettingsHelp() {
  openSettingsPage(`${settingsHead('Settings · Help', 'Help', 'Guides, answers and a human when you need one.')}
  <div class="settings-list" style="margin-top:6px">
    ${settingsListRow('helpWhy', 'help', 'How Glyth decides', 'Why your plan changed, in plain language')}
    ${settingsListRow('helpScenario', 'integrations', 'Try a scenario', 'See Glyth reorganise a day in Insights')}
    ${settingsListRow('helpPrivacy', 'privacy', 'Our privacy promise', 'What crosses to your employer — and what never does')}
  </div>
  <section class="flow-section"><div class="label">Common questions</div>
    <details class="flow-raw"><summary>Why did my plan change?</summary><p class="muted small" style="margin:10px 0 0">Glyth compares today's signals with your baselines. When something meaningful moves — like a third poor night of sleep — it reorganises the day and tells you exactly what it observed and what it did. Tap “Why?” on Today to inspect any change.</p></details>
    <details class="flow-raw"><summary>Can my employer see my sleep or health?</summary><p class="muted small" style="margin:10px 0 0">No. Employers see aggregated work patterns for groups of five or more only. Sleep, health, recovery, conversations and support usage never cross.</p></details>
    <details class="flow-raw"><summary>How do I undo a change Glyth made?</summary><p class="muted small" style="margin:10px 0 0">Reject the recommendation on Today and the plan item reverts. Or ask Glyth directly — it proposes changes and only applies them when you confirm.</p></details>
  </section>
  <section class="flow-section"><div class="label">Still stuck?</div><p class="muted small">Your People team runs Glyth Workplace at Northstar and can help with access and support routes. Anything you raise with them about your personal data stays confidential.</p><div style="display:flex;gap:8px;flex-wrap:wrap"><a class="btn" href="mailto:people@northstar.example" style="text-decoration:none">Contact People team</a><button class="btn ghost" id="helpReset">Reset demo</button></div></section>
  <section class="flow-section"><div class="label">About</div><div class="flow-rows"><div class="flow-row"><span class="k">Version</span><span class="v">Snapshot v0.1</span></div><div class="flow-row"><span class="k">Data</span><span class="v">Saved for this workspace</span></div></div></section>`);
  $('helpWhy').onclick = () => openSettingsPage(`${settingsHead('Help', 'How Glyth decides')}<div style="margin-top:6px">${whyHtml()}</div>`, openSettingsHelp);
  $('helpScenario').onclick = () => { closeSheet(); switchView('insights'); window.scrollTo({ top: 0, behavior: 'smooth' }); };
  $('helpPrivacy').onclick = openSettingsPrivacy;
  $('helpReset').onclick = async () => { closeSheet(); await act(() => { state = E.resetDemo(); }, () => api('/api/reset', { method: 'POST' })); switchView('today'); };
}
$('settingsBtn').onclick = openSettings;

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && askOpen) closeAsk(); if (e.key === 'Escape') closeSheet(); });

// ---------- Account creation (optional; demo data is kept) ----------

// ---------- Auth gate: signed out = login page, never the full app ----------
let gateMode = 'signin';
function updateAuthGate() {
  const gate = $('authGate'); if (!gate) return;
  const signedIn = Boolean(account?.id) || gateGuest;
  gate.classList.toggle('hidden', signedIn);
  document.body.classList.toggle('auth-locked', !signedIn);
  const demoBtn = $('gateDemoBtn'); if (demoBtn) demoBtn.classList.toggle('hidden', signedIn || !serverDemoMode);
  if (!signedIn && !$('gateStatus')?.dataset.checked) {
    const st = $('gateStatus'); if (st) st.dataset.checked = '1';
    api('/api/public-config').then(cfg => { if (!cfg.authConfigured) { serverDemoMode = true; const db = $('gateDemoBtn'); if (db && !account?.id && !gateGuest) db.classList.remove('hidden'); } if (st) st.textContent = cfg.authConfigured ? 'Accounts are ready. Your data stays yours — nothing is shared with your employer.' : 'Accounts are not configured on this server yet. Guest demo is available.'; })
      .catch(() => { if (st) st.textContent = 'Could not reach your backend. Check the server is running.'; });
  }
}
let gateGuest = false;
function setGateMode(mode) {
  gateMode = mode; const isUp = mode === 'signup';
  $('gateTabIn')?.setAttribute('aria-selected', String(!isUp)); $('gateTabUp')?.setAttribute('aria-selected', String(isUp));
  $('gateNameWrap')?.classList.toggle('hidden', !isUp); $('gateExtra')?.classList.toggle('hidden', !isUp);
  const pw = $('gatePassword'); if (pw) pw.autocomplete = isUp ? 'new-password' : 'current-password';
  const btn = $('gateSubmit'); if (btn) btn.textContent = isUp ? 'Create account' : 'Sign in';
}
document.addEventListener('DOMContentLoaded', () => {});
const _gtIn = $('gateTabIn'); if (_gtIn) _gtIn.onclick = () => setGateMode('signin');
const _gtUp = $('gateTabUp'); if (_gtUp) _gtUp.onclick = () => setGateMode('signup');
const _gDemo = $('gateDemoBtn'); if (_gDemo) _gDemo.onclick = () => { gateGuest = true; updateAuthGate(); init(); };
const _gForm = $('gateForm');
if (_gForm) _gForm.onsubmit = async (ev) => {
  ev.preventDefault();
  const err = $('gateError'); const showErr = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); }; showErr('');
  const isUp = gateMode === 'signup';
  const creds = { name: $('gateName')?.value.trim() || '', email: $('gateEmail').value.trim(), password: $('gatePassword').value, timezone: $('gateTz')?.value.trim() || 'Europe/London', wakeTime: $('gateWake')?.value || '06:30' };
  if (isUp && !creds.name) { showErr('Please add your name.'); return; }
  const btn = $('gateSubmit'); btn.disabled = true; btn.textContent = isUp ? 'Creating…' : 'Signing in…';
  try {
    const res = await api(isUp ? '/api/auth/signup' : '/api/auth/signin', { method: 'POST', body: JSON.stringify(creds) });
    if (res.pendingConfirmation) { showErr(res.message || 'Check your email to confirm your account, then sign in.'); setGateMode('signin'); return; }
    if (!res.user?.id) throw new Error('Account service returned no user.');
    completeAuth({ id: res.user.id, email: res.user.email, name: res.user.name || creds.name, mode: 'supabase' }, res.session);
    await init();
  } catch (e) { showErr(String(e.message || e)); }
  finally { btn.disabled = false; btn.textContent = isUp ? 'Create account' : 'Sign in'; }
};

function completeAuth(acc, session = null) {
  account = { ...acc, accessToken: session?.access_token || null, refreshToken: session?.refresh_token || null }; persistAccount();
  if (acc.name) state.profile.name = acc.name;
  save(); closeSheet(); updateAuthGate(); render();
}
function signOut() {
  const token = account?.accessToken; if (token) fetch(`${API_BASE}/api/auth/signout`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
  gateGuest = false;
  account = null; persistAccount(); try { localStorage.removeItem(ACCOUNT_KEY); } catch { /* ignore */ }
  closeSheet(); updateAuthGate();
  state.profile.name = ''; save(); render();
}
function openAuth(mode = 'signup') {
  const isSignup = mode === 'signup';
  openSheet(`<div class="label">Account</div><h2 style="font-size:24px;margin:6px 0 4px">${isSignup ? 'Create your account' : 'Welcome back'}</h2>
  <p class="muted small">${isSignup ? 'Create an account to save your FlowID. Your demo day stays exactly as it is.' : 'Sign in to your Glyth account.'}</p>
  <form id="authForm" class="auth-form">
    ${isSignup ? '<label>Full name<input id="authName" type="text" autocomplete="name" placeholder="Your name"></label>' : ''}
    <label>Email<input id="authEmail" type="email" autocomplete="email" placeholder="you@company.com" required></label>
    <label>Password<input id="authPassword" type="password" autocomplete="${isSignup ? 'new-password' : 'current-password'}" placeholder="8+ characters" required minlength="8"></label>
    ${isSignup ? '<div class="auth-row" style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><label>Wake time<input id="authWake" type="time" value="06:30"></label><label>Timezone<input id="authTz" type="text" value="Europe/London"></label></div>' : ''}
    <p class="auth-error hidden" id="authError" role="alert"></p>
    <button class="btn" id="authSubmit" type="submit">${isSignup ? 'Create account' : 'Sign in'}</button>
  </form>
  <button class="auth-toggle" id="authToggle" type="button">${isSignup ? 'Already have an account? Sign in' : 'New to Glyth? Create an account'}</button>
  <p class="muted small" id="authBackendStatus" style="margin:12px 0 0">Backend: ${API_BASE || 'same origin'} · checking…</p>`);
  $('authToggle').onclick = () => openAuth(isSignup ? 'signin' : 'signup');
  api('/api/public-config').then(cfg => { const bs = $('authBackendStatus'); if (bs) bs.textContent = `Backend: ${API_BASE || 'same origin'} · reachable · accounts ${cfg.authConfigured ? 'ready' : 'not configured on that server'}`; if (!cfg.authConfigured) { const e = $('authError'); if (e) { e.textContent = 'Accounts are not available on this server yet — the demo works without one.'; e.classList.remove('hidden'); } const b = $('authSubmit'); if (b) { b.disabled = true; b.textContent = 'Accounts unavailable'; } } }).catch(() => {});
  $('authForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const err = $('authError'); const showErr = (m) => { err.textContent = m; err.classList.toggle('hidden', !m); }; showErr('');
    const creds = { name: $('authName')?.value.trim() || '', email: $('authEmail').value.trim(), password: $('authPassword').value, timezone: $('authTz')?.value.trim() || 'Europe/London', wakeTime: $('authWake')?.value || '06:30' };
    if (isSignup && !creds.name) { showErr('Please add your name.'); return; }
    const btn = $('authSubmit'); btn.disabled = true; btn.textContent = isSignup ? 'Creating…' : 'Signing in…';
    try {
      const res = await api(isSignup ? '/api/auth/signup' : '/api/auth/signin', { method: 'POST', body: JSON.stringify(creds) });
      if (res.pendingConfirmation) { showErr(res.message || 'Check your email to confirm your account, then sign in.'); return; }
      if (!res.user?.id) throw new Error('Account service returned no user.');
      completeAuth({ id: res.user.id, email: res.user.email, name: res.user.name || creds.name, mode: 'supabase' }, res.session);
    } catch (e) { showErr(String(e.message || e)); }
    finally { btn.disabled = false; btn.textContent = isSignup ? 'Create account' : 'Sign in'; }
  };
}

// ---------- Messages (external channels via Unipile; separate from Ask Glyth) ----------
async function openMessages(needsReplyOnly = false) {
  openSheet('<div class="label">Messages</div><h2 style="font-size:24px;margin:6px 0">Your messages</h2><p class="muted small">Loading…</p>');
  try {
    const d = await api(`/api/communications/threads${needsReplyOnly ? '?filter=needs_reply' : ''}`);
    const threads = d.threads || [];
    let accounts = []; try { accounts = (await api('/api/communications/accounts')).accounts || []; } catch { /* accounts optional */ }
    openSheet(`<div class="label">Messages</div><h2 style="font-size:24px;margin:6px 0 10px">Your messages</h2>
    <div class="ask-prompts" style="margin:0 0 12px"><button class="btn sm ghost" data-connect="instagram">Connect Instagram</button><button class="btn sm ghost" data-connect="linkedin">Connect LinkedIn</button><button class="btn sm ghost" data-connect="whatsapp">Connect WhatsApp</button></div>
    ${accounts.length ? `<p class="muted small" style="margin:0 0 8px">${accounts.map(ac => `${ac.provider}: ${ac.status}${ac.last_synced_at ? ` · synced ${String(ac.last_synced_at).slice(0, 16).replace('T', ' ')}` : ''} <button class="btn sm ghost" data-sync="${ac.id}">Sync</button>`).join('<br>')}</p>` : '<p class="muted small" style="margin:0 0 8px">No accounts connected yet — connect one above.</p>'}
    <p class="muted small hidden" id="msgConnectNote" style="margin:0 0 10px"></p>
    <div class="ask-prompts" style="margin:0 0 12px"><button class="btn sm ${needsReplyOnly ? '' : 'ghost'}" id="msgAll">All</button><button class="btn sm ${needsReplyOnly ? '' : 'ghost'}" id="msgNeeds">Needs reply${d.context?.unanswered_thread_count ? ` · ${d.context.unanswered_thread_count}` : ''}</button></div>
    ${threads.length ? threads.map(x => `<button class="search-result" data-thread="${x.id}"><span style="flex:1"><strong>${x.title || x.provider}</strong><div class="muted small">${x.provider} · ${x.last_message_preview || 'No messages yet'}${x.last_message_at ? ` · ${String(x.last_message_at).slice(0, 16).replace('T', ' ')}` : ''}</div></span>${x.needs_reply ? '<span class="chip">Needs reply</span>' : '<span class="chevron" aria-hidden="true">›</span>'}</button>`).join('') : '<p class="muted">No conversations yet. Connect Instagram, LinkedIn or WhatsApp and your threads will appear here.</p>'}`);
    $('msgAll').onclick = () => openMessages(false); $('msgNeeds').onclick = () => openMessages(true);
    document.querySelectorAll('[data-thread]').forEach(b => b.onclick = () => openThread(b.dataset.thread));
    document.querySelectorAll('[data-sync]').forEach(b => b.onclick = async () => { b.disabled = true; b.textContent = 'Syncing…'; try { await api('/api/unipile/sync', { method: 'POST', body: JSON.stringify({ account_id: b.dataset.sync }) }); openMessages(needsReplyOnly); } catch (e) { const note = $('msgConnectNote'); if (note) { note.textContent = e.message || 'Sync failed.'; note.classList.remove('hidden'); } b.disabled = false; b.textContent = 'Sync'; } });
  } catch (e) { openSheet(`<div class="label">Messages</div><h2 style="font-size:24px;margin:6px 0">Your messages</h2><p class="muted">${e.message || 'Messages unavailable.'}</p>`); }
}
async function openThread(threadId) {
  try {
    const d = await api(`/api/communications/threads/${threadId}`); const x = d.thread;
    openSheet(`<div class="label">${x.provider}</div><h2 style="font-size:24px;margin:6px 0 10px">${x.title || x.provider}</h2>
    <div>${(d.messages || []).map(m => `<div class="msg ${m.direction === 'outbound' ? 'user' : 'glyth'}">${m.body || m.caption || ''}${m.original_url ? `<div style="margin-top:6px"><a href="${m.original_url}" target="_blank" rel="noopener">Open original</a></div>` : ''}<div class="muted small" style="margin-top:4px">${String(m.sent_at || '').slice(0, 16).replace('T', ' ')}</div></div>`).join('') || '<p class="muted">No messages in this thread yet.</p>'}</div>
    <form class="ask-composer" id="threadForm"><input id="threadInput" autocomplete="off" aria-label="Reply" placeholder="Write a reply…"><button class="btn" type="submit" aria-label="Send reply">↑</button></form>
    <p class="muted small hidden" id="threadError" role="alert"></p><button class="btn ghost sm" id="threadBack" style="margin-top:10px">‹ All messages</button>`);
    $('threadBack').onclick = () => openMessages(false);
    $('threadForm').onsubmit = async (ev) => { ev.preventDefault(); const text = $('threadInput').value.trim(); if (!text) return; try { await api(`/api/communications/threads/${threadId}/reply`, { method: 'POST', body: JSON.stringify({ text }) }); openThread(threadId); } catch (e) { const er = $('threadError'); er.textContent = e.message || 'Could not send.'; er.classList.remove('hidden'); } };
  } catch (e) { openSheet(`<h2>Thread unavailable</h2><p class="muted">${e.message || ''}</p>`); }
}
const msgBtn = $('messagesBtn'); if (msgBtn) msgBtn.onclick = () => openMessages(false);
updateAuthGate();
syncFab();
init();
restoreNativeAccount();
try { const push = globalThis.Capacitor?.Plugins?.PushNotifications; if (push && IS_NATIVE) { push.addListener('registration', (token) => { api('/api/devices/push-token', { method: 'POST', body: JSON.stringify({ token: token.value, environment: 'development' }) }).catch(() => {}); }); push.addListener('pushNotificationActionPerformed', (action) => { const url = action?.notification?.data?.url || ''; if (url.startsWith('/messages/')) switchView('support'); else if (url.startsWith('/insights')) switchView('insights'); }); push.checkPermissions().then((perm) => (perm.receive === 'prompt' ? push.requestPermissions() : perm)).then(() => push.register()).catch(() => {}); } } catch { /* web or plugin absent */ }
try { const capApp = globalThis.Capacitor?.Plugins?.App; capApp?.addListener?.('appUrlOpen', ({ url }) => { const parts = new URL(url).pathname.split('/').filter(Boolean); if (parts[0] === 'insights') switchView('insights'); else if (parts[0] === 'today' || parts[0] === 'messages') switchView('today'); }); capApp?.addListener?.('appStateChange', ({ isActive }) => { if (isActive) init(); }); } catch { /* web */ }

// ---------- Finance module (PRIVATE_FINANCIAL) ----------
if (!state.finance) state.finance = { imports: [], transactions: [], merchantRules: [], recurring: [], snapshots: [], analysis: null };
let finTab = 'overview', finPreview = null, finAskAnswer = '';
const finFmt = (minor, cur='GBP') => { try { return new Intl.NumberFormat('en-GB',{style:'currency',currency:cur}).format((Number(minor)||0)/100); } catch { return `${cur} ${((Number(minor)||0)/100).toFixed(2)}`; } };
function finMetricsLocal() {
  const txs = state.finance?.transactions || []; if (!txs.length) return null;
  const cur = txs[0].currency || 'GBP'; const months = [...new Set(txs.map(t=>String(t.transaction_date).slice(0,7)))].sort(); const month = months.at(-1); const prev = months[months.length-2];
  const inM = txs.filter(t=>String(t.transaction_date).startsWith(month)); const sum=(a,f)=>a.filter(f).reduce((x,t)=>x+Math.abs(t.amount_minor),0);
  const income=sum(inM,t=>t.direction==='in'&&!t.is_transfer), spent=sum(inM,t=>t.direction==='out'&&!t.is_transfer);
  const cats={}; inM.filter(t=>t.direction==='out'&&!t.is_transfer).forEach(t=>cats[t.category]=(cats[t.category]||0)+Math.abs(t.amount_minor));
  const categories=Object.entries(cats).map(([category,total_minor])=>({category,total_minor,share:spent?Math.round(total_minor/spent*100):0})).sort((a,b)=>b.total_minor-a.total_minor);
  const recMap={}; txs.forEach(t=>{ const k=t.merchant_normalized+'|'+t.direction; (recMap[k] ||= []).push(t); }); const recurring=[];
  for (const list of Object.values(recMap)) { if (list.length<2) continue; const avg=Math.round(list.reduce((a,t)=>a+Math.abs(t.amount_minor),0)/list.length); recurring.push({merchant:list[0].merchant_normalized,category:list[0].category,direction:list[0].direction,average_amount_minor:avg,frequency:'monthly',occurrences:list.length,next_expected_date:null}); }
  return { currency:cur, period:month, income_minor:income, spending_minor:spent, net_minor:income-spent, categories, recurring:recurring.sort((a,b)=>b.average_amount_minor-a.average_amount_minor), monthly:months.map(m=>{ const a=txs.filter(t=>String(t.transaction_date).startsWith(m)); return {month:m,income:sum(a,t=>t.direction==='in'&&!t.is_transfer),spending:sum(a,t=>t.direction==='out'&&!t.is_transfer)}; }) };
}

// ---- Family ----
function famEsc(s){return String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}
function openFamily(){ showOnlyView('view-family'); renderFamily(); }
async function renderFamily(){
  let data; try{ data=await api('/api/family'); if(data.state) state=data.state; }catch{ data={family:state.family||{members:[]},recommendations:[]}; }
  const fam=data.family||state.family||{members:[]}; state.family=fam; const recs=data.recommendations||[];
  const up=recs.find(r=>r.type==='important_date'||r.type==='gift_planning'); const reach=recs.find(r=>r.type==='reach_out');
  const upHost=$('familyUpNext'); if(upHost) upHost.innerHTML=up?`<div class="glass" style="margin-top:14px"><div class="label">Up next</div><h3 style="margin:6px 0">${famEsc(up.title)} — ${up.days_until} days</h3><p class="muted small">${famEsc(up.rationale)}</p><button class="btn sm" data-fam-open="${up.familyMemberId}">Plan</button></div>`:'';
  const rHost=$('familyReachOut'); if(rHost) rHost.innerHTML=reach?`<div class="glass" style="margin-top:14px"><div class="label">Reach out</div><h3 style="margin:6px 0">${famEsc(reach.title)}</h3><p class="muted small">${famEsc(reach.rationale)}</p><button class="btn sm" data-fam-open="${reach.familyMemberId}">Reach out</button></div>`:'';
  const pHost=$('familyPeople'); if(pHost) pHost.innerHTML=(fam.members||[]).map(m=>`<button class="support-row" data-fam-open="${m.id}" style="width:100%;text-align:left"><span class="support-row-text"><strong>${famEsc(m.display_name)}</strong><span class="muted small">${famEsc(m.relationship_type)}${m.contact_frequency_days?` · every ${m.contact_frequency_days} days`:''}</span></span><span class="chevron">›</span></button>`).join('')||'<p class="muted">No family members yet. Add someone above, or load the demo family.</p>';
  const prog=$('familyProgress'); if(prog&&data.progress) prog.innerHTML=`<div class="glass" style="margin-top:14px"><div class="label">This month</div><p style="margin:8px 0 0">${data.progress.family_checkins_this_month} family check-ins · Contact rhythms maintained: ${famEsc(data.progress.contact_rhythms_maintained)}</p></div>`;
  document.querySelectorAll('[data-fam-open]').forEach(b=>b.onclick=()=>openFamilyMember(b.dataset.famOpen));
  const ft=$('familyToday'); if(ft){ const top=(data.today||[])[0]; ft.innerHTML=top?`<button class="next-action" id="famTodayOpen" type="button"><span class="thumb">♥</span><span><span class="label">Family · Private</span><h3>${famEsc(top.title)}</h3><p>${famEsc(top.rationale)}</p><span class="pill-dot"><i></i><span>${famEsc(top.suggestedAction)}</span></span></span></button>`:''; const o=$('famTodayOpen'); if(o) o.onclick=openFamily; }
}
async function openFamilyMember(id){
  const fam=state.family||{members:[],preferences:[],dates:[],interactions:[],gifts:[]}; const m=(fam.members||[]).find(x=>x.id===id); if(!m) return;
  const prefs=(fam.preferences||[]).filter(x=>x.family_member_id===id); const gifts=(fam.gifts||[]).filter(x=>x.family_member_id===id);
  const ints=(fam.interactions||[]).filter(x=>x.family_member_id===id).sort((a,b)=>String(b.occurred_at).localeCompare(String(a.occurred_at)));
  const last=ints[0]; const days=last?Math.floor((Date.now()-new Date(last.occurred_at))/864e5):null;
  $('familyDetail').innerHTML=`<div class="glass" style="margin-top:14px"><div class="label">${famEsc(m.relationship_type)}</div><h2 style="margin:6px 0">${famEsc(m.display_name)}</h2><p class="muted small">Last contact: ${last?`${days} days ago`:'not recorded yet'}${m.contact_frequency_days?` · Usual rhythm: every ${m.contact_frequency_days} days`:''}</p>${prefs.length?`<p><span class="label">Preferences</span><br>${prefs.map(x=>famEsc(x.value)).join(' · ')}</p>`:''}${gifts.length?`<p><span class="label">Previous gifts</span><br>${gifts.map(g=>famEsc(g.gift)).join(', ')}</p>`:''}${m.notes?`<p class="muted small">${famEsc(m.notes)}</p>`:''}<div id="famDraft"></div><button class="btn sm" id="famContacted">Mark contacted</button> <button class="btn ghost sm" id="famGiftBtn">Gift ideas</button> <button class="btn ghost sm" id="famDraftBtn">Draft a message</button> <button class="btn ghost sm" id="famDelete">Remove</button><div id="famGiftOut"></div></div>`;
  $('famContacted').onclick=async()=>{ await api(`/api/family/members/${id}/interactions`,{method:'POST',body:JSON.stringify({interaction_type:'message'})}); renderFamily(); openFamilyMember(id); };
  $('famGiftBtn').onclick=async()=>{ const r=await api('/api/family/gift-suggestions',{method:'POST',body:JSON.stringify({familyMemberId:id})}); $('famGiftOut').innerHTML=r.suggestions.map(g=>`<p style="margin:8px 0 0"><strong>${famEsc(g.title)}</strong> <span class="muted small">${famEsc(g.category)} · ${famEsc(g.approximateBudgetBand)} — ${famEsc(g.reason)}</span></p>`).join(''); };
  $('famDraftBtn').onclick=async()=>{ const r=await api('/api/family/message-draft',{method:'POST',body:JSON.stringify({familyMemberId:id})}); $('famDraft').innerHTML=`<p class="glass" style="padding:10px">${famEsc(r.draft)}</p><p class="muted small">Review before sending — Glyth never sends on your behalf.</p>`; };
  $('famDelete').onclick=async()=>{ await api(`/api/family/members/${id}`,{method:'DELETE'}); $('familyDetail').innerHTML=''; renderFamily(); };
}
document.addEventListener('DOMContentLoaded',()=>{ const f=$('famAddForm'); if(f) f.onsubmit=async(e)=>{ e.preventDefault(); const r=await api('/api/family/members',{method:'POST',body:JSON.stringify({display_name:$('famName').value,relationship_type:$('famRel').value,birthday:$('famBday').value||null,contact_frequency_days:Number($('famFreq').value)})}); if($('famPref').value&&r.member) await api(`/api/family/members/${r.member.id}/preferences`,{method:'POST',body:JSON.stringify({category:'gift',value:$('famPref').value})}); $('famMsg').textContent='Saved.'; renderFamily(); }; const s=$('famSeed'); if(s) s.onclick=async()=>{ await api('/api/family/demo',{method:'POST',body:JSON.stringify({})}); renderFamily(); }; renderFamily().catch(()=>{}); });

function openFinance() { showOnlyView('view-finance'); renderFinance(); }
const finBackBtn2 = $('finBack'); if (finBackBtn2) finBackBtn2.onclick = () => backToMainView('support');
function renderFinance() {
  const root = $('finRoot'); if (!root) return;
  const f = state.finance || { transactions: [], imports: [] }; const m = finMetricsLocal();
  // Today / Insights / Progress hooks
  const ft = $('financeToday'); if (ft) ft.innerHTML = m ? `<div class="glass" style="margin-top:14px"><div class="label">Finance · Private</div><p style="margin:8px 0 0"><strong>${finFmt(m.net_minor,m.currency)} net in ${m.period}</strong></p><p class="muted small" style="margin:4px 0 0">${f.analysis?.headline || 'Your monthly statement analysis is ready to review in Finance.'}</p><button class="btn ghost sm" id="finTodayOpen" type="button" style="margin-top:10px">Review Finance</button></div>` : '';
  const fi = $('financeInsights'); if (fi) fi.innerHTML = m && f.analysis ? `<div class="glass" style="margin-top:14px"><div class="label">Finance insight · Private</div><h2 style="font-size:20px;margin:6px 0 0">${f.analysis.headline}</h2><p class="muted" style="margin:8px 0 0">${f.analysis.summary}</p></div>` : '';
  const fp = $('financeProgress'); if (fp) fp.innerHTML = m ? `<div class="label">Finance</div><p style="margin:8px 0 0">Monthly surplus <strong>${finFmt(m.net_minor,m.currency)}</strong> · ${m.period}</p><div class="fin-bar" role="img" aria-label="Spending versus income this month"><i style="width:${m.income_minor?Math.min(100,Math.round(m.spending_minor/m.income_minor*100)):0}%"></i></div><p class="muted small">Spent ${finFmt(m.spending_minor,m.currency)} of ${finFmt(m.income_minor,m.currency)} income. Private — never shared with your employer.</p><button class="btn ghost sm" id="finProgOpen" type="button">Open Finance</button>` : `<div class="label">Finance</div><p class="muted" style="margin:8px 0 0">Upload a bank export to track surplus and spending trends here.</p><button class="btn ghost sm" id="finProgOpen" type="button">Open Finance</button>`;
  const fo1=$('finTodayOpen'); if(fo1) fo1.onclick=openFinance; const fo2=$('finProgOpen'); if(fo2) fo2.onclick=openFinance;
  if (!m) { root.innerHTML = `<div class="glass" style="margin-top:16px"><h2 style="font-size:22px;margin:0 0 8px">Understand where your money actually goes.</h2><p class="muted">Upload a bank transaction export and Glyth will organise, analyse and explain it.</p><div class="fin-upload"><p><strong>CSV or XLSX</strong> · up to 15 MB · 50,000 rows</p><label class="btn" style="display:inline-block;cursor:pointer">Upload transactions<input id="finFile" type="file" accept=".csv,.xlsx" class="hidden" style="display:none"></label><p class="muted small" id="finStatus" role="status" aria-live="polite">Your original file is processed privately and is never shared with employers. Originals are not retained after import.</p><p style="margin-top:12px"><button class="btn ghost" id="finDemo" type="button">Load demo statement</button> <a class="btn ghost" href="#" id="finDemoCsv">Download demo CSV</a></p></div></div>`; bindFinUpload(); const d=$('finDemo'); if(d) d.onclick=finLoadDemo; const dc=$('finDemoCsv'); if(dc) dc.onclick=async(e)=>{ e.preventDefault(); try{ const r=await fetch(`${API_BASE}/api/finance/demo-csv`); }catch{} window.open(`${API_BASE}/api/finance/demo-csv`,'_blank'); }; return; }
  const a = f.analysis; const subs = m.recurring.filter(r=>r.category==='Subscriptions'); const subsTotal = subs.reduce((x,r)=>x+r.average_amount_minor,0);
  const tabs = [['overview','Overview'],['spending','Spending'],['recurring','Recurring'],['insights','Insights']];
  let body = '';
  if (finTab==='overview') body = `<div class="glass" style="margin-top:14px"><div class="label">${m.period} · This month</div><div class="fin-hero"><div class="fin-stat"><span class="muted small">Income</span><b>${finFmt(m.income_minor,m.currency)}</b></div><div class="fin-stat"><span class="muted small">Spent</span><b>${finFmt(m.spending_minor,m.currency)}</b></div><div class="fin-stat"><span class="muted small">Net</span><b>${m.net_minor>=0?'+':''}${finFmt(m.net_minor,m.currency)}</b></div></div>${a?`<p style="margin:14px 0 0">${a.summary}</p><p class="muted small">Briefing: ${a.source==='meta'?'Meta':'deterministic'} · Figures calculated in code.</p>`:`<p class="muted" style="margin:14px 0 0">Income, spending and net are calculated deterministically from your imported transactions.</p>`}<p style="margin-top:12px"><button class="btn" id="finAnalyse" type="button">Deep analysis</button> <button class="btn ghost" id="finUpload2" type="button">Upload another statement</button></p><p class="muted small" id="finStatus" role="status" aria-live="polite"></p><input id="finFile" type="file" accept=".csv,.xlsx" style="display:none"></div>
  <div class="glass" style="margin-top:14px"><div class="label">Monthly cash flow</div>${m.monthly.map(x=>`<div class="fin-row"><span>${x.month}</span><span class="small">In ${finFmt(x.income,m.currency)} · Out ${finFmt(x.spending,m.currency)} · Net ${finFmt(x.income-x.spending,m.currency)}</span></div>`).join('')}</div>
  <div class="glass" style="margin-top:14px"><div class="label">Ask Finance</div><form class="fin-ask" id="finAskForm"><input id="finAskInput" placeholder="How much am I spending on subscriptions?" aria-label="Ask Finance"><button class="btn" type="submit">Ask</button></form>${finAskAnswer?`<p style="margin:12px 0 0">${finAskAnswer}</p>`:''}<div class="fin-cats" style="margin-top:10px">${['Where did most of my money go last month?','How much am I spending on subscriptions?','Could I save another £300 a month?'].map(q=>`<button class="btn sm ghost" data-fin-q="${q}" type="button">${q}</button>`).join('')}</div></div>`;
  if (finTab==='spending') body = `<div class="glass" style="margin-top:14px"><div class="label">Spending · ${m.period}</div>${m.categories.map(c=>`<div style="margin:12px 0"><div class="fin-row" style="border:0;padding:0"><strong>${c.category}</strong><span>${finFmt(c.total_minor,m.currency)} · ${c.share}%</span></div><div class="fin-bar" role="img" aria-label="${c.category} ${c.share} percent of spending"><i style="width:${c.share}%"></i></div></div>`).join('')||'<p class="muted">No spending in this period.</p>'}<p class="muted small">Text summary: largest category is ${m.categories[0]?.category||'—'} at ${m.categories[0]?finFmt(m.categories[0].total_minor,m.currency):'—'}.</p></div><div class="glass" style="margin-top:14px"><div class="label">Recent transactions</div><div style="margin-top:8px"><label class="small">Search <input id="finSearch" type="search" placeholder="Merchant or description" style="padding:8px;border-radius:8px;border:1px solid var(--line)"></label></div><div id="finTxList">${finTxHtml()}</div></div>`;
  if (finTab==='recurring') body = `<div class="glass" style="margin-top:14px"><div class="label">Recurring</div><p style="margin:8px 0"><strong>Subscriptions ${finFmt(subsTotal,m.currency)}/month</strong> · ${subs.length} detected</p>${m.recurring.map(r=>`<div class="fin-row"><span><strong>${r.merchant}</strong><br><span class="muted small">${r.category} · ${r.frequency} · seen ${r.occurrences}×</span></span><span>${finFmt(r.average_amount_minor,m.currency)}</span></div>`).join('')||'<p class="muted">No recurring items yet — detection needs at least two similar payments.</p>'}</div>`;
  if (finTab==='insights') body = `<div class="glass" style="margin-top:14px"><div class="label">Deep analysis</div>${a?`<h2 style="font-size:21px;margin:8px 0">${a.headline}</h2><p>${a.summary}</p>${(a.attentionSignals||[]).length?`<div class="label" style="margin-top:12px">What changed</div><ul>${a.attentionSignals.map(x=>`<li>${x}</li>`).join('')}</ul>`:''}${(a.observations||[]).length?`<div class="label" style="margin-top:12px">Where your money goes</div><ul>${a.observations.map(x=>`<li>${x}</li>`).join('')}</ul>`:''}${(a.recommendedActions||[]).length?`<div class="label" style="margin-top:12px">Recommended actions</div><ul>${a.recommendedActions.map(x=>`<li><strong>${x.title}</strong> — ${x.detail||''}</li>`).join('')}</ul>`:''}<p class="muted small">Source: ${a.source||'deterministic'} · No automatic money movement. Glyth suggests; you decide.</p>`:'<p class="muted">Run Deep analysis from Overview.</p>'}</div><div class="glass" style="margin-top:14px"><div class="label">Import history</div>${(f.imports||[]).map(i=>`<div class="fin-row"><span><strong>${i.filename}</strong><br><span class="muted small">${i.created_at?String(i.created_at).slice(0,10):''} · ${i.imported_count} imported · ${i.duplicate_count||0} duplicates skipped</span></span><button class="btn sm ghost" data-fin-del-import="${i.id}" type="button">Delete import</button></div>`).join('')||'<p class="muted">No imports yet.</p>'}<p style="margin-top:12px"><button class="btn ghost" id="finDeleteAll" type="button">Delete all Finance data</button></p></div>`;
  root.innerHTML = `<div class="fin-tabs" role="tablist" aria-label="Finance sections">${tabs.map(([k,l])=>`<button data-fin-tab="${k}" role="tab" aria-selected="${String(finTab===k)}" type="button">${l}</button>`).join('')}</div>${body}`;
  root.querySelectorAll('[data-fin-tab]').forEach(b=>b.onclick=()=>{ finTab=b.dataset.finTab; renderFinance(); });
  const an=$('finAnalyse'); if(an) an.onclick=finAnalyse; const up=$('finUpload2'); if(up) up.onclick=()=>$('finFile')?.click(); bindFinUpload();
  const af=$('finAskForm'); if(af) af.onsubmit=async(e)=>{ e.preventDefault(); finAskSubmit($('finAskInput').value); };
  root.querySelectorAll('[data-fin-q]').forEach(b=>b.onclick=()=>finAskSubmit(b.dataset.finQ));
  const fs=$('finSearch'); if(fs) fs.oninput=()=>{ const el=$('finTxList'); if(el) el.innerHTML=finTxHtml(fs.value); bindFinTx(); };
  const da=$('finDeleteAll'); if(da) da.onclick=async()=>{ if(!confirm('Delete all Finance data? This cannot be undone.')) return; try{ if(useApi){ const d=await api('/api/finance',{method:'DELETE',body:JSON.stringify({})}); state=d.state; } else { state.finance={imports:[],transactions:[],merchantRules:[],recurring:[],snapshots:[],analysis:null}; } }catch{ state.finance={imports:[],transactions:[],merchantRules:[],recurring:[],snapshots:[],analysis:null}; } save(); render(); renderFinance(); };
  root.querySelectorAll('[data-fin-del-import]').forEach(b=>b.onclick=async()=>{ if(!confirm('Delete this import and its transactions?')) return; try{ if(useApi){ const d=await api('/api/finance',{method:'DELETE',body:JSON.stringify({importId:b.dataset.finDelImport})}); state=d.state; } }catch{} save(); render(); renderFinance(); });
  bindFinTx();
}
function finTxHtml(q='') { const txs=(state.finance?.transactions||[]).filter(t=>!q||`${t.merchant_normalized} ${t.description_raw}`.toLowerCase().includes(q.toLowerCase())).slice().sort((a,b)=>String(b.transaction_date).localeCompare(String(a.transaction_date))).slice(0,40); const cats=['Housing','Bills & Utilities','Groceries','Dining','Transport','Shopping','Health & Fitness','Entertainment','Travel','Subscriptions','Insurance','Education','Personal','Family','Income','Savings','Transfers','Fees','Other']; return txs.map(t=>`<div class="fin-tx"><span><strong>${t.merchant_normalized}</strong><br><span class="muted small">${t.transaction_date} · ${t.description_raw}</span></span><span style="text-align:right"><strong>${t.direction==='in'?'+':'−'}${finFmt(Math.abs(t.amount_minor),t.currency)}</strong><br><select data-fin-cat="${t.id}" aria-label="Category for ${t.merchant_normalized}" style="max-width:150px">${cats.map(c=>`<option ${c===t.category?'selected':''}>${c}</option>`).join('')}</select></span></div>`).join('')||'<p class="muted">No transactions match.</p>'; }
function bindFinTx(){ document.querySelectorAll('[data-fin-cat]').forEach(sel=>sel.onchange=async()=>{ const id=sel.dataset.finCat, category=sel.value; try{ if(useApi){ const d=await api(`/api/finance/transactions/${encodeURIComponent(id)}`,{method:'PATCH',body:JSON.stringify({category})}); state=d.state; } else { const tx=state.finance.transactions.find(t=>t.id===id); if(tx){ tx.category=category; state.finance.transactions.filter(t=>t.merchant_normalized===tx.merchant_normalized).forEach(t=>t.category=category); const ex=state.finance.merchantRules.find(r=>r.merchant_normalized===tx.merchant_normalized); if(ex) ex.category=category; else state.finance.merchantRules.push({merchant_pattern:tx.merchant_normalized,merchant_normalized:tx.merchant_normalized,category,source:'user',confidence:1}); } } }catch{} save(); render(); renderFinance(); }); }
async function finAskSubmit(q){ if(!q?.trim()) return; try{ if(useApi){ const d=await api('/api/finance/ask',{method:'POST',body:JSON.stringify({message:q})}); finAskAnswer=d.answer; } else finAskAnswer='Connect to the server to ask Finance questions over your deterministic figures.'; }catch(e){ finAskAnswer=e.message||'Could not answer.'; } renderFinance(); }
async function finAnalyse(){ const st=$('finStatus'); if(st) st.textContent='Analysing patterns…'; try{ if(useApi){ const d=await api('/api/finance/analyse',{method:'POST',body:JSON.stringify({})}); state=d.state||state; if(d.analysis) state.finance.analysis=d.analysis; } finTab='insights'; }catch(e){ if(st) st.textContent=e.message||'Analysis failed.'; return; } save(); render(); renderFinance(); }
async function finLoadDemo(){ const st=$('finStatus'); if(st) st.textContent='Loading demo statement…'; try{ if(useApi){ const d=await api('/api/finance/demo',{method:'POST',body:JSON.stringify({})}); state=d.state||state; } else if(st){ st.textContent='Demo data needs the server — start with npm start.'; return; } }catch(e){ if(st){ st.textContent=e.message||'Could not load demo.'; } return; } save(); render(); renderFinance(); }
function bindFinUpload(){ const input=$('finFile'); if(!input||input.dataset.bound) return; input.dataset.bound='1'; input.onchange=async()=>{ const file=input.files?.[0]; if(!file) return; const st=$('finStatus'); if(st) st.textContent='Reading file…'; try{ const buf=await file.arrayBuffer(); let b64=''; const bytes=new Uint8Array(buf); for(let i=0;i<bytes.length;i+=8192) b64+=String.fromCharCode(...bytes.subarray(i,i+8192)); b64=btoa(b64); const d=await api('/api/finance/import/preview',{method:'POST',body:JSON.stringify({filename:file.name,contentBase64:b64})}); finPreview=d; showFinPreview(d,file.name); }catch(e){ if(st) st.textContent=e.message||'That file could not be read.'; } }; }
function showFinPreview(d){ finPreview=d; if(d.needsMapping){ openSheet(`<div class="label">Finance · Map columns</div><h2 style="font-size:24px;margin:6px 0">Check the columns</h2><p class="muted small">Glyth could not confidently detect every column in ${d.filename}. Choose them, then preview again.</p>${['date','description','amount','debit','credit','currency'].map(f=>`<p><span class="label">${f}</span><br><select id="map-${f}" style="width:100%;padding:10px"><option value="">—</option>${(d.headers||[]).map(h=>`<option ${d.mapping?.[f]===h?'selected':''}>${h}</option>`).join('')}</select></p>`).join('')}<button class="btn" id="finRemap" type="button">Preview with this mapping</button>`); const b=$('finRemap'); if(b) b.onclick=async()=>{ const mapping={}; ['date','description','amount','debit','credit','currency'].forEach(f=>{ const v=document.getElementById('map-'+f)?.value; if(v) mapping[f]=v; }); b.disabled=true; try{ const d2=await api('/api/finance/import/preview',{method:'POST',body:JSON.stringify({filename:d.filename,previewId:d.previewId,mapping})}); showFinPreview(d2); }catch(e){ b.disabled=false; alert(e.message||'Could not preview with that mapping.'); } }; return; }
  openSheet(`<div class="label">Finance · Import preview</div><h2 style="font-size:24px;margin:6px 0">${d.filename}</h2><p><strong>${d.rowCount}</strong> rows · ${d.dateMin||''} – ${d.dateMax||''}</p><p class="muted">Transactions: <strong>${d.transactionCount}</strong> · Potential duplicates: <strong>${d.duplicateCount}</strong> · Rejected: <strong>${d.rejectedCount}</strong> · Currency: ${(d.currencies||[]).join(', ')||'GBP'}</p><div class="label" style="margin-top:12px">Column mapping</div><p class="small">${Object.entries(d.mapping||{}).filter(([,v])=>v).map(([k,v])=>`${k}: ${v}`).join(' · ')}</p>${(d.sample||[]).map(t=>`<div class="fin-row"><span>${t.transaction_date} · ${t.merchant_normalized}</span><span>${finFmt(t.amount_minor,t.currency)}</span></div>`).join('')}<p class="muted small" style="margin-top:10px">Original file is processed privately, never shared, and not retained after import.</p><button class="btn" id="finConfirm" type="button">Import ${d.transactionCount-d.duplicateCount} transactions</button> <span class="small muted" id="finConfirmStatus" role="status"></span>`);
  const c=$('finConfirm'); if(c) c.onclick=async()=>{ c.disabled=true; const s=$('finConfirmStatus'); if(s) s.textContent='Importing…'; try{ const r=await api('/api/finance/import/confirm',{method:'POST',body:JSON.stringify({previewId:d.previewId})}); state=r.state||state; closeSheet(); finTab='overview'; save(); render(); renderFinance(); }catch(e){ if(s) s.textContent=e.message||'Import failed.'; c.disabled=false; } }; }
