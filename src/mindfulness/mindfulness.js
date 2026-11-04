// Mindfulness MVP — canonical sessions, context compiler, deterministic
// ranking, script validation/safety, activity lifecycle. Pure, no deps.
// Meta may enrich language/selection (server-side, validated); it is never
// required for a recommendation to exist.
export const SESSION_TYPES = ['reset','focus','pre_meeting','decompress','recovery_pause','wind_down'];
const WPM = 128; // calm spoken pace used for duration estimates
const words = (t) => (String(t||'').trim() ? String(t).trim().split(/\s+/).length : 0);
export const spokenSeconds = (t) => Math.round(words(t) / WPM * 60);

function script(title, durationSeconds, sections, closingText) {
  let cursor = 0; const out = sections.map(([text, pauseAfterSeconds]) => { const dur = spokenSeconds(text); const s = { startSecond: cursor, endSecond: cursor + dur, text, pauseAfterSeconds: pauseAfterSeconds||0 }; cursor += dur + (pauseAfterSeconds||0); return s; });
  return { title, durationSeconds, sections: out, closingText };
}

// Guided voice library shipped with the app (assets/meditations/). Every
// session is a real 3-minute recording; `type` is the recommendation bucket
// the deterministic ranking maps onto, so the hero recommendation, Today
// actions and the library all play the same recorded audio. There is no
// written transcript for these recordings, so `script` stays null and the
// player never falls back to a device voice for them.
const mp3 = (file) => `assets/meditations/${file}`;
const guided = (slug, type, title, description, file, gradient) => ({ id:`ses_${slug.replace(/-/g,'_')}`, slug, type, title, description, durationSeconds:180, version:2, active:true, generationSource:'guided-audio', imageUrl:null, audioUrl:mp3(file), artwork:{ gradient, prompt:null }, script:null });
export const SESSIONS = [
  guided('breathing-into-rest','reset','Breathing Into Rest','Calming breathwork into deep relaxation.','01_breathing-into-rest.mp3','linear-gradient(160deg,#dfe9e4,#f3efe4 55%,#e8e2d4)'),
  guided('first-breath','reset','First Breath','Foundations of conscious breathwork.','07_first-breath.mp3','linear-gradient(160deg,#e3e7ee,#f2f0e8 55%,#e6dfcd)'),
  guided('coming-back','focus','Coming Back','Bringing a wandering mind back to the breath.','02_coming-back.mp3','linear-gradient(160deg,#e8e4da,#f4f1e9 50%,#dde5df)'),
  guided('directing-attention','focus','Directing Attention','Focus training and conscious awareness.','03_directing-attention.mp3','linear-gradient(160deg,#e6ddd2,#f3efe7 55%,#dfe4dc)'),
  guided('distraction-as-data','focus','Distraction as Data','Reframing internal distractions.','04_distraction-as-data.mp3','linear-gradient(160deg,#dde5e0,#f1f0e8 55%,#e9e0d2)'),
  guided('holding-steady','focus','Holding Steady','Sustained focal attention practice.','08_holding-steady.mp3','linear-gradient(160deg,#d8dde6,#eee9dd 55%,#e2d9c8)'),
  guided('feel-your-feet','pre_meeting','Feel Your Feet','A physical grounding practice to settle before what is next.','06_feel-your-feet.mp3','linear-gradient(160deg,#e8e4da,#f4f1e9 50%,#dde5df)'),
  guided('its-yours-now','decompress',"It's Yours Now",'Integration and ownership of the practice.','09_it-s-yours-now.mp3','linear-gradient(160deg,#e6ddd2,#f3efe7 55%,#dfe4dc)'),
  guided('just-noticing','recovery_pause','Just Noticing','Non-judgmental awareness and stillness.','10_just-noticing.mp3','linear-gradient(160deg,#dde5e0,#f1f0e8 55%,#e9e0d2)'),
  guided('drifting','wind_down','Drifting','An evening drift toward rest.','05_drifting.mp3','linear-gradient(160deg,#d8dde6,#eee9dd 55%,#e2d9c8)'),
];
export const sessionById = (id) => SESSIONS.find(s => s.id===id || s.slug===id || s.type===id) || null;

// ---------- Context compiler (mindfulness-relevant slice only) ----------
function minutesUntilToday(time, now) { if (!/^\d{2}:\d{2}/.test(String(time||''))) return null; const [h,m]=String(time).slice(0,5).split(':').map(Number); const t=new Date(now); t.setHours(h,m,0,0); return Math.round((t-now)/60000); }
export function compileMindfulnessContext(state, now = new Date()) {
  const c = state.currentState||{}, b = state.baselines||{};
  const upcoming = (state.plan||[]).filter(p=>p.status!=='deferred').map(p=>({ title:p.title, time:p.time, type:p.type, importance:p.priority, minutesUntil:minutesUntilToday(p.time,now) })).filter(p=>p.minutesUntil!=null && p.minutesUntil>=-15);
  const cal = (state.canonical?.calendarEvents||[]).map(e=>({ start:e.starts_at, importance:e.importance||e.priority, type:'calendar', minutesUntil: Math.round((new Date(e.starts_at)-now)/60000) })).filter(e=>Number.isFinite(e.minutesUntil)&&e.minutesUntil>=-15&&e.minutesUntil<600);
  const commitments = [...upcoming.map(u=>({ start:u.time, importance:u.importance, type:u.type, minutesUntil:u.minutesUntil })), ...cal].sort((a,b2)=>a.minutesUntil-b2.minutesUntil).slice(0,4);
  const nextGap = commitments.find(x=>x.minutesUntil>0)?.minutesUntil ?? null;
  const activity = state.mindfulness?.activity||[];
  return {
    local_time: now.toISOString(), hour: now.getHours(),
    available_minutes: nextGap==null?10:Math.max(3,Math.min(15,nextGap)),
    current_state: { sleep_deviation: (c.sleepMinutes!=null&&b.sleepMinutes)?Math.round(((c.sleepMinutes-b.sleepMinutes)/b.sleepMinutes)*100):null, recovery:c.recovery??null, recovery_baseline:b.recovery??null, energy:c.energy??null, workload_pressure:c.workload??null, stress:c.stress??null, training_load:c.trainingLoad??null, consecutive_poor_nights:c.consecutivePoorNights??null },
    upcoming_commitments: commitments,
    focus_context: { focus_within_30m: commitments.some(x=>x.minutesUntil>=0&&x.minutesUntil<=30&&(x.type==='work'||/deep work|focus/i.test(String(x.start||''))) ) || (state.plan||[]).some(p=>/deep work|focus/i.test(p.title||'')&&(minutesUntilToday(p.time,now)??999)>=0&&(minutesUntilToday(p.time,now)??999)<=30) },
    recent_training_load: c.trainingLoad??null,
    recent_sessions: activity.filter(a=>a.status==='completed').slice(0,5).map(a=>({ session_type:a.session_type, completed_at:a.completed_at, post_state:a.post_state||null })),
    preferences: { protect_focus: state.preferences?.protectFocus ?? null },
  };
}

// ---------- Deterministic ranking (Meta is optional enrichment) ----------
export function rankMindfulness(ctx) {
  const s = ctx.current_state, scores = { reset:10, focus:5, pre_meeting:0, decompress:5, recovery_pause:0, wind_down:0 }; const why = { reset:[], focus:[], pre_meeting:[], decompress:[], recovery_pause:[], wind_down:[] };
  const important = ctx.upcoming_commitments.find(x=>x.minutesUntil>=0&&x.minutesUntil<=90&&(x.importance==='critical'||x.importance==='high'));
  if (important) { scores.pre_meeting+=55; why.pre_meeting.push(`an important commitment begins in ${important.minutesUntil} minutes`); if ((s.sleep_deviation!=null&&s.sleep_deviation<=-10)||(s.recovery!=null&&s.recovery<60)) { scores.pre_meeting+=32; why.pre_meeting.push('you are heading into it below baseline'); } }
  if (ctx.focus_context.focus_within_30m) { scores.focus+=55; why.focus.push('a focus block begins soon'); }
  if (s.workload_pressure!=null&&s.workload_pressure>=75) { scores.decompress+=35; scores.reset+=20; why.decompress.push('workload is elevated'); why.reset.push('workload is elevated'); }
  else if (s.workload_pressure!=null&&s.workload_pressure>=60) { scores.reset+=18; why.reset.push('workload is building'); }
  if (s.sleep_deviation!=null&&s.sleep_deviation<=-10) { scores.pre_meeting+=10; scores.wind_down+=12; why.pre_meeting.push('sleep is below baseline'); why.wind_down.push('sleep has recently been short'); }
  if (s.recovery!=null&&s.recovery_baseline!=null&&s.recovery<s.recovery_baseline-10) { scores.recovery_pause+=35; why.recovery_pause.push('recovery is below baseline'); }
  if (s.recovery!=null&&s.recovery<55) { scores.recovery_pause+=20; why.recovery_pause.push('recovery is low today'); }
  if (ctx.recent_training_load!=null&&ctx.recent_training_load>=70) { scores.recovery_pause+=22; why.recovery_pause.push('recent training load is high'); }
  if (ctx.hour>=19) { scores.wind_down+=42; why.wind_down.push('it is evening'); }
  else if (ctx.hour>=16) { scores.decompress+=12; why.decompress.push('it is late in the workday'); }
  if (s.stress!=null&&s.stress>=55) { scores.reset+=14; why.reset.push('stress signals are elevated'); }
  // Do not re-recommend a type completed in the last 2 hours.
  const recent = ctx.recent_sessions[0];
  if (recent && Date.now()-new Date(recent.completed_at).getTime()<2*3600e3 && scores[recent.session_type]!=null) scores[recent.session_type]-=25;
  const ranked = Object.entries(scores).sort((a,b2)=>b2[1]-a[1]);
  const [type, score] = ranked[0];
  const session = SESSIONS.find(x=>x.type===type) || SESSIONS[0];
  const reasons = [...new Set(why[type])];
  const hasData = s.sleep_deviation!=null||s.recovery!=null||s.workload_pressure!=null||ctx.upcoming_commitments.length>0;
  const rationale = !hasData ? 'A short, simple reset that fits almost any moment in the day.' : reasons.length ? `${reasons[0][0].toUpperCase()+reasons[0].slice(1)}${reasons[1]?`, and ${reasons[1]}`:''}. A short ${session.title.toLowerCase()} session may help you settle before the next block.` : `A short ${session.title.toLowerCase()} session fits the time you have now.`;
  const titles = { pre_meeting:'Reset before your meeting', focus:'Settle into focus', wind_down:'Wind down for the evening', recovery_pause:'A quiet recovery pause', decompress:'Decompress from the day', reset:'A short reset' };
  return validateMindfulnessRecommendation({ sessionType:type, durationMinutes:Math.round(session.durationSeconds/60), title:titles[type]||session.title, purpose:session.description, rationale, adaptation:{ pace: type==='wind_down'||type==='recovery_pause'?'slow':'steady', tone:'grounded', focus: type==='focus'?'attention':'settling' }, confidence: hasData?Math.min(0.92,0.55+score/220):0.5 }).value;
}
export function recommendMindfulness(state, now=new Date()) { const rec = rankMindfulness(compileMindfulnessContext(state,now)); const session = SESSIONS.find(x=>x.type===rec.sessionType); return { ...rec, session, sessionId: session.id }; }

// ---------- Validation + safety ----------
export function validateMindfulnessRecommendation(x) {
  if (!x||typeof x!=='object'||Array.isArray(x)) return { ok:false, error:'not an object' };
  if (!SESSION_TYPES.includes(x.sessionType)) return { ok:false, error:'invalid sessionType' };
  if (!(Number.isFinite(x.durationMinutes)&&x.durationMinutes>=2&&x.durationMinutes<=15)) return { ok:false, error:'durationMinutes out of range' };
  for (const k of ['title','purpose','rationale']) if (typeof x[k]!=='string'||!x[k].trim()) return { ok:false, error:`missing ${k}` };
  if (!(typeof x.confidence==='number'&&x.confidence>=0&&x.confidence<=1)) return { ok:false, error:'confidence must be 0-1' };
  return { ok:true, value:{ sessionType:x.sessionType, durationMinutes:x.durationMinutes, title:String(x.title).slice(0,80), purpose:String(x.purpose).slice(0,160), rationale:String(x.rationale).slice(0,280), adaptation:{ pace:['slow','steady'].includes(x.adaptation?.pace)?x.adaptation.pace:'steady', tone:'grounded', focus:String(x.adaptation?.focus||'settling').slice(0,40) }, confidence:x.confidence } };
}
const BANNED = ['heal your trauma','lower your cortisol','treats anxiety','treat anxiety','cure','guarantees','diagnose','hold your breath','suppress your thoughts','will fix','medical treatment'];
export function auditScriptSafety(scriptObj) { if (!scriptObj) return { safe:true, hits:[] }; const text = `${scriptObj.title} ${scriptObj.closingText} ${scriptObj.sections.map(s=>s.text).join(' ')}`.toLowerCase(); const hits = BANNED.filter(b=>text.includes(b)); return { safe: hits.length===0, hits }; }
export function scriptDurationEstimate(scriptObj) { const spoken = scriptObj.sections.reduce((a,s)=>a+spokenSeconds(s.text),0)+spokenSeconds(scriptObj.closingText); const pauses = scriptObj.sections.reduce((a,s)=>a+(s.pauseAfterSeconds||0),0); return { spokenSeconds:spoken, pauseSeconds:pauses, totalSeconds:spoken+pauses }; }
export function validateScript(scriptObj) {
  if (!scriptObj||!Array.isArray(scriptObj.sections)||!scriptObj.sections.length) return { ok:false, error:'script needs sections' };
  if (!(scriptObj.durationSeconds>=60&&scriptObj.durationSeconds<=900)) return { ok:false, error:'durationSeconds out of range' };
  for (const s of scriptObj.sections) { if (typeof s.text!=='string'||!(s.pauseAfterSeconds>=0&&s.pauseAfterSeconds<=120)) return { ok:false, error:'invalid section' }; }
  const est = scriptDurationEstimate(scriptObj);
  if (est.totalSeconds > scriptObj.durationSeconds*1.08) return { ok:false, error:`script overruns: estimated ${est.totalSeconds}s vs ${scriptObj.durationSeconds}s` };
  if (est.totalSeconds < scriptObj.durationSeconds*0.45) return { ok:false, error:`script underruns: estimated ${est.totalSeconds}s vs ${scriptObj.durationSeconds}s` };
  const safety = auditScriptSafety(scriptObj); if (!safety.safe) return { ok:false, error:`unsafe language: ${safety.hits.join(', ')}` };
  return { ok:true, value:scriptObj, estimate:est };
}

// ---------- Activity lifecycle (on canonical state) ----------
let aseq = 0;
export function ensureMindfulness(state) { state.mindfulness ||= { activity:[], events:[], lastRecommendation:null }; state.mindfulness.activity ||= []; state.mindfulness.events ||= []; return state.mindfulness; }
export function startActivity(state, sessionId, recommendationId=null) {
  const session = sessionById(sessionId); if (!session) throw new Error('Session not found');
  const m = ensureMindfulness(state);
  const rec = recommendMindfulness(state); m.lastRecommendation = { ...rec, session:undefined, at:new Date().toISOString() };
  const act = { id:`mact_${Date.now()}_${++aseq}`, user_id:'demo', session_id:session.id, session_type:session.type, session_title:session.title, duration_seconds:session.durationSeconds, recommendation_id:recommendationId, started_at:new Date().toISOString(), completed_at:null, duration_completed_seconds:0, status:'started', post_state:null };
  m.activity.unshift(act); m.events.unshift({ type:'mindfulness_started', session_type:session.type, at:act.started_at }); return act;
}
export function completeActivity(state, activityId, durationCompletedSeconds=null) {
  const m = ensureMindfulness(state); const act = m.activity.find(a=>a.id===activityId); if (!act) throw new Error('Activity not found');
  if (act.status==='completed') return act;
  act.status='completed'; act.completed_at=new Date().toISOString(); act.duration_completed_seconds = durationCompletedSeconds==null?act.duration_seconds:Math.min(durationCompletedSeconds, act.duration_seconds);
  m.events.unshift({ type:'mindfulness_completed', session_type:act.session_type, at:act.completed_at });
  for (const r of state.recommendations||[]) if (r.action?.type==='mindfulness_session'&&r.action.session_type===act.session_type&&r.status==='proposed') r.status='executed';
  state.interventions ||= []; state.interventions.unshift({ id:`int_mind_${act.id}`, title:`${act.session_title} mindfulness session`, outcome:'Completed — outcome pending feedback', at:'Today', kind:'heuristic' });
  return act;
}
export function abandonActivity(state, activityId, elapsed=0) { const m=ensureMindfulness(state); const act=m.activity.find(a=>a.id===activityId); if(!act) throw new Error('Activity not found'); if(act.status!=='completed'){ act.status='abandoned'; act.duration_completed_seconds=elapsed; m.events.unshift({ type:'mindfulness_abandoned', session_type:act.session_type, at:new Date().toISOString() }); } return act; }
export function submitFeedback(state, activityId, postState) {
  if (!['lower','same','better'].includes(postState)) throw new Error('post_state must be lower, same or better');
  const m = ensureMindfulness(state); const act = m.activity.find(a=>a.id===activityId); if (!act) throw new Error('Activity not found');
  act.post_state = postState; m.events.unshift({ type:'mindfulness_feedback', session_type:act.session_type, post_state:postState, at:new Date().toISOString() });
  const inv = (state.interventions||[]).find(i=>i.id===`int_mind_${act.id}`); if (inv) inv.outcome = postState==='better'?'Completed — felt more settled':postState==='lower'?'Completed — felt less settled':'Completed — felt about the same';
  return act;
}
export function weeklyStats(state, now=new Date()) { const m=ensureMindfulness(state); const weekAgo=now.getTime()-7*864e5; const done=m.activity.filter(a=>a.status==='completed'&&new Date(a.completed_at).getTime()>=weekAgo); return { sessionsThisWeek:done.length, minutesThisWeek:Math.round(done.reduce((a,x)=>a+(x.duration_completed_seconds||0),0)/60), completedTotal:m.activity.filter(a=>a.status==='completed').length, startedTotal:m.activity.length, completionRate:m.activity.length?Math.round(m.activity.filter(a=>a.status==='completed').length/m.activity.length*100):null }; }
export function mindfulnessInsight(state) { const m=ensureMindfulness(state); const done=m.activity.filter(a=>a.status==='completed'); if (done.length<2) return null; const better=done.filter(a=>a.post_state==='better').length; if (better>=2) return 'Short resets have been easiest for you to complete, and you have often felt more settled afterwards.'; return `${done.length} mindfulness sessions completed. Glyth keeps the recommendation short and timed to what is next.`; }
