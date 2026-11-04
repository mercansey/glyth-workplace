// Fitness MVP — exercise library, workout templates, FitnessContext,
// deterministic adaptation, bounded generation, session lifecycle.
// Deterministic rules are authoritative; Meta may only enrich rationale /
// propose within the approved library (validated server-side). Pure, no deps.
import { trainingSummary, ingestWorkouts } from '../data/training.js';
import { fmtSleep } from '../domain/engine.js';

export const GOAL_TYPES = ['strength','muscle_gain','general_fitness','conditioning','recovery_maintain'];
export const ADAPTATION_TYPES = ['keep','reduce_volume','reduce_intensity','shorten','replace_exercise','convert_to_recovery','reschedule'];
export const RECOMMENDATION_STATUSES = ['full','modified','light','recovery','rest'];
let fseq = 0; const uid = (p) => `${p}_${Date.now()}_${++fseq}`;

// ---------- Exercise library (26 neutral movements) ----------
const ex = (slug,name,category,equipment,pattern,mediaUrl=null) => ({ id:`ex_${slug.replace(/-/g,'_')}`, slug, name, category, equipment, pattern, mediaUrl, active:true });
// Real movement demos shipped with the app (assets/workouts/).
const gif = (file) => `assets/workouts/${file}`;
export const EXERCISES = [
  ex('bodyweight-squat','Bodyweight Squat','squat',['bodyweight'],'squat', gif('08_squat.gif')),
  ex('goblet-squat','Goblet Squat','squat',['dumbbells'],'squat', gif('08_squat.gif')),
  ex('split-squat','Split Squat','squat',['bodyweight','dumbbells'],'squat', gif('18_foot-elevated-squat.gif')),
  ex('leg-press','Leg Press','squat',['machine'],'squat'),
  ex('romanian-deadlift','Romanian Deadlift','hinge',['dumbbells','barbell'],'hinge', gif('12_stiff.gif')),
  ex('hip-hinge','Kettlebell Hip Hinge','hinge',['kettlebell','dumbbells'],'hinge'),
  ex('glute-bridge','Glute Bridge','hinge',['bodyweight'],'hinge'),
  ex('back-extension','Back Extension','hinge',['bodyweight','machine'],'hinge', gif('11_lumbar-extension.gif')),
  ex('push-up','Push-Up','push',['bodyweight'],'horizontal_push'),
  ex('bench-press','Bench Press','push',['dumbbells','barbell','bench'],'horizontal_push', gif('01_bench-press-1.gif')),
  ex('overhead-press','Overhead Press','push',['dumbbells'],'vertical_push'),
  ex('incline-push-up','Incline Push-Up','push',['bodyweight','bench'],'horizontal_push'),
  ex('dumbbell-row','Dumbbell Row','pull',['dumbbells','bench'],'horizontal_pull', gif('15_bent-over-dumbbell-row.gif')),
  ex('chest-supported-row','Chest-Supported Row','pull',['dumbbells','bench'],'horizontal_pull'),
  ex('lat-pulldown','Lat Pulldown','pull',['machine','cable'],'vertical_pull'),
  ex('band-row','Band Row','pull',['bands'],'horizontal_pull'),
  ex('farmer-carry','Farmer Carry','carry',['dumbbells','kettlebell'],'carry'),
  ex('suitcase-carry','Suitcase Carry','carry',['dumbbells','kettlebell'],'carry'),
  ex('dead-bug','Dead Bug','core',['bodyweight'],'core'),
  ex('plank','Plank','core',['bodyweight'],'core'),
  ex('side-plank','Side Plank','core',['bodyweight'],'core', gif('04_side-plank.gif')),
  ex('bike-intervals','Bike Intervals','conditioning',['bike'],'conditioning', gif('14_exercise-bike.gif')),
  ex('row-intervals','Rowing Intervals','conditioning',['rower'],'conditioning'),
  ex('incline-walk','Treadmill Incline Walk','conditioning',['treadmill','bodyweight'],'conditioning', gif('09_belt.gif')),
  ex('cat-cow','Cat-Cow','mobility',['bodyweight'],'mobility'),
  ex('hip-90-90','90/90 Hip Flow','mobility',['bodyweight'],'mobility'),
  ex('thoracic-rotation','Thoracic Rotation','mobility',['bodyweight'],'mobility'),
  ex('walking-lunge','Walking Lunge','squat',['bodyweight','dumbbells'],'squat'),
  ex('squat','Squat','squat',['barbell','bodyweight'],'squat', gif('08_squat.gif')),
  ex('lateral-raise','Side Raise','push',['dumbbells'],'vertical_push', gif('02_side-raise.gif')),
  ex('front-raise','Front Raise','push',['dumbbells'],'vertical_push', gif('10_front-elevation.gif')),
  ex('bicep-curl','Bicep Curl','arms',['dumbbells','barbell'],'curl', gif('03_direct-thread.gif')),
  ex('hammer-curl','Hammer Curl','arms',['dumbbells'],'curl', gif('05_hammer-curl.gif')),
  ex('reverse-curl','Reverse Curl','arms',['dumbbells','barbell'],'curl', gif('17_reverse-thread.gif')),
  ex('machine-adduction','Machine Adduction','legs',['machine'],'legs', gif('06_adduction-into-the-machine.gif')),
  ex('machine-abduction','Machine Abduction','legs',['machine'],'legs', gif('07_machine-abduction.gif')),
  ex('calf-raise','Calf Raise','legs',['bodyweight','machine'],'legs', gif('13_calf-raise.gif')),
  ex('good-morning','Good Morning','hinge',['barbell'],'hinge', gif('16_good-morning-with-barra.gif')),
  ex('assisted-pull-up','Assisted Pull-Up','pull',['machine'],'vertical_pull', gif('19_assisted-pull-up.gif')),
  ex('band-assisted-pull-up','Band-Assisted Pull-Up','pull',['bands'],'vertical_pull', gif('20_pull-up-with-assistance-band.gif')),
];
export const exerciseById = (id) => EXERCISES.find(e => e.id===id || e.slug===id) || null;
export const exerciseDemoFor = (id) => { const cur = exerciseById(id); if (!cur) return null; if (cur.mediaUrl) return cur.mediaUrl; return EXERCISES.find(e => e.mediaUrl && e.pattern === cur.pattern)?.mediaUrl || EXERCISES.find(e => e.mediaUrl && e.category === cur.category)?.mediaUrl || null; };
export const alternativeFor = (exerciseId, equipment=[]) => { const cur = exerciseById(exerciseId); if(!cur) return null; return EXERCISES.find(e=>e.id!==cur.id && e.pattern===cur.pattern && e.equipment.every(x=>equipment.length===0||equipment.includes(x)||x==='bodyweight')) || EXERCISES.find(e=>e.id!==cur.id && e.category===cur.category) || null; };

// ---------- Workout templates (6) ----------
const we = (slug,sets,reps,restSeconds,intensity,opts={}) => ({ exerciseId: exerciseById(slug).id, slug, sets, reps: reps??null, durationSeconds: opts.durationSeconds??null, restSeconds, intensity, role: opts.role||'accessory' });
export const TEMPLATES = [
  { id:'wt_upper_strength', slug:'upper-strength', title:'Upper Body Strength', goal:'strength', type:'strength', focus:'upper', estimated_duration:42, difficulty:'moderate', equipment:['dumbbells','bench','bodyweight'], active:true, exercises:[ we('bench-press',4,8,90,'moderate',{role:'primary'}), we('dumbbell-row',4,10,75,'moderate',{role:'primary'}), we('overhead-press',3,8,75,'moderate'), we('lat-pulldown',3,10,60,'moderate'), we('assisted-pull-up',3,8,75,'moderate'), we('dead-bug',2,10,45,'low') ] },
  { id:'wt_lower_strength', slug:'lower-strength', title:'Lower Body Strength', goal:'strength', type:'strength', focus:'lower', estimated_duration:55, difficulty:'hard', equipment:['dumbbells','barbell','bodyweight'], active:true, exercises:[ we('goblet-squat',4,6,120,'high',{role:'primary'}), we('romanian-deadlift',4,8,90,'high',{role:'primary'}), we('split-squat',3,8,60,'moderate'), we('glute-bridge',3,12,60,'moderate'), we('good-morning',3,10,75,'moderate'), we('farmer-carry',3,null,60,'moderate',{durationSeconds:40}), we('calf-raise',3,15,45,'low'), we('side-plank',2,null,45,'low',{durationSeconds:30}) ] },
  { id:'wt_full_body', slug:'full-body-strength', title:'Full Body Strength', goal:'general_fitness', type:'strength', focus:'full', estimated_duration:45, difficulty:'moderate', equipment:['dumbbells','bench','bodyweight'], active:true, exercises:[ we('goblet-squat',3,8,90,'moderate',{role:'primary'}), we('bench-press',3,8,75,'moderate',{role:'primary'}), we('dumbbell-row',3,10,60,'moderate'), we('romanian-deadlift',3,10,60,'moderate'), we('plank',2,null,45,'low',{durationSeconds:40}) ] },
  { id:'wt_short_full_body', slug:'short-full-body', title:'Short Full Body', goal:'general_fitness', type:'strength', focus:'full', estimated_duration:25, difficulty:'moderate', equipment:['dumbbells','bodyweight'], active:true, exercises:[ we('goblet-squat',3,8,60,'moderate',{role:'primary'}), we('push-up',3,10,60,'moderate',{role:'primary'}), we('dumbbell-row',3,10,60,'moderate'), we('dead-bug',2,8,30,'low') ] },
  { id:'wt_conditioning', slug:'conditioning', title:'Conditioning', goal:'conditioning', type:'conditioning', focus:'full', estimated_duration:30, difficulty:'moderate', equipment:['bike','rower','bodyweight'], active:true, exercises:[ we('bike-intervals',6,null,60,'moderate',{role:'primary',durationSeconds:60}), we('incline-walk',1,null,0,'low',{durationSeconds:600}), we('dead-bug',2,8,45,'low') ] },
  { id:'wt_gym_accessories', slug:'gym-accessories', title:'Gym Accessories', goal:'muscle_gain', type:'strength', focus:'full', estimated_duration:35, difficulty:'moderate', equipment:['dumbbells','machine','barbell','bands'], active:true, exercises:[ we('lateral-raise',3,12,60,'moderate',{role:'primary'}), we('front-raise',3,12,60,'moderate'), we('hammer-curl',3,12,60,'moderate'), we('reverse-curl',2,12,60,'low'), we('band-assisted-pull-up',3,8,75,'moderate'), we('machine-adduction',3,12,60,'moderate'), we('machine-abduction',3,12,60,'moderate'), we('calf-raise',3,15,45,'low') ] },
  { id:'wt_recovery', slug:'recovery-mobility', title:'Recovery / Mobility', goal:'recovery_maintain', type:'recovery', focus:'recovery', estimated_duration:30, difficulty:'easy', equipment:['bodyweight'], active:true, exercises:[ we('cat-cow',2,8,30,'low',{role:'primary'}), we('hip-90-90',2,6,30,'low'), we('thoracic-rotation',2,8,30,'low'), we('glute-bridge',2,10,45,'low'), we('incline-walk',1,null,0,'low',{durationSeconds:480}), we('dead-bug',2,8,30,'low') ] },
];
export const templateBySlug = (slug) => TEMPLATES.find(t=>t.slug===slug||t.id===slug) || null;

// ---------- Profile ----------
export function ensureFitness(state) {
  state.fitness ||= { profile:null, sessions:[], lastRecommendation:null, events:[] };
  state.fitness.sessions ||= []; state.fitness.events ||= [];
  if (!state.fitness.profile) {
    const goal = (state.goals||[]).find(g=>g.status==='active');
    const gname = String(goal?.name||'').toLowerCase();
    state.fitness.profile = { primary_goal: /muscle|hypertrophy/.test(gname)?'muscle_gain':/condition|cardio|fitness/.test(gname)?'conditioning':/recover|maintain/.test(gname)?'recovery_maintain':'strength', experience_level:'intermediate', preferred_training_days:['Mon','Wed','Fri'], preferred_training_time: state.preferences?.trainingTime||'morning', target_session_duration:45, available_equipment:['bodyweight','dumbbells','bench','barbell','bands','machine','cable','kettlebell','bike','rower','treadmill'], movement_preferences:[] };
  }
  return state.fitness;
}
export function setFitnessProfile(state, patch={}) {
  const f = ensureFitness(state); const p = { ...f.profile };
  if (GOAL_TYPES.includes(patch.primary_goal)) p.primary_goal = patch.primary_goal;
  if (['beginner','intermediate','advanced'].includes(patch.experience_level)) p.experience_level = patch.experience_level;
  if (Number.isFinite(Number(patch.target_session_duration))) p.target_session_duration = Math.max(15, Math.min(120, Number(patch.target_session_duration)));
  if (Array.isArray(patch.available_equipment)) p.available_equipment = patch.available_equipment.map(String).slice(0,12);
  if (Array.isArray(patch.preferred_training_days)) p.preferred_training_days = patch.preferred_training_days.map(String).slice(0,7);
  if (typeof patch.preferred_training_time==='string') p.preferred_training_time = patch.preferred_training_time.slice(0,20);
  f.profile = p; return p;
}

// ---------- FitnessContext (fitness-relevant slice only) ----------
function minutesUntilToday(time, now) { if (!/^\d{2}:\d{2}/.test(String(time||''))) return null; const [h,m]=String(time).slice(0,5).split(':').map(Number); const t=new Date(now); t.setHours(h,m,0,0); return Math.round((t-now)/60000); }
export function compileFitnessContext(state, now=new Date()) {
  const f = ensureFitness(state); const c = state.currentState||{}; const b = state.baselines||{};
  const ts = trainingSummary(state, now);
  const completed = f.sessions.filter(s=>s.status==='completed');
  const recentSessions = [...completed].sort((a,b2)=>String(b2.completed_at||'').localeCompare(String(a.completed_at||''))).slice(0,5)
    .map(s=>({ id:s.id, title:s.title, focus:s.focus||null, completed_at:s.completed_at, duration_minutes:s.actual_duration??s.planned_duration, adapted: s.adaptation_status==='adapted', feedback:s.feedback||null }));
  const daysSince = {};
  for (const focus of ['upper','lower','full','recovery']) { const last = recentSessions.find(s=>s.focus===focus||s.focus==='full'); daysSince[focus] = last?.completed_at ? Math.floor((now-new Date(last.completed_at))/864e5) : null; }
  const cal = (state.canonical?.calendarEvents||[]).map(e=>({ title:e.title, starts_at:e.starts_at, importance:e.importance||e.priority, minutesUntil: Math.round((new Date(e.starts_at)-now)/60000) })).filter(e=>Number.isFinite(e.minutesUntil)&&e.minutesUntil>=-15).sort((a,b2)=>a.minutesUntil-b2.minutesUntil);
  const planItems = (state.plan||[]).filter(p=>p.status!=='deferred').map(p=>({ title:p.title, time:p.time, type:p.type, priority:p.priority, minutesUntil:minutesUntilToday(p.time,now) }));
  const nextImportant = [...cal, ...planItems].filter(x=>x.minutesUntil!=null&&x.minutesUntil>=0&&(x.importance==='critical'||x.priority==='critical'||x.priority==='high')).sort((a,b2)=>a.minutesUntil-b2.minutesUntil)[0] || null;
  const nextAny = [...planItems].filter(x=>x.minutesUntil!=null&&x.minutesUntil>30).sort((a,b2)=>a.minutesUntil-b2.minutesUntil)[0] || null;
  const prev = recentSessions[0] || null;
  const feedback = completed.map(s=>s.feedback).filter(Boolean);
  return {
    primaryGoal: f.profile.primary_goal, experienceLevel: f.profile.experience_level, availableEquipment: f.profile.available_equipment, preferredDuration: f.profile.target_session_duration,
    today: { sleepMinutes: c.sleepMinutes??null, sleepBaseline: b.sleepMinutes??null, sleepDeviation: (c.sleepMinutes!=null&&b.sleepMinutes)?Math.round(((c.sleepMinutes-b.sleepMinutes)/b.sleepMinutes)*100):null, recovery: c.recovery??null, recoveryBaseline: b.recovery??null, energy: c.energy??null, recentTrainingLoad: c.trainingLoad??ts.recentLoadScore??null, workloadPressure: c.workload??null, consecutivePoorNights: c.consecutivePoorNights??null, availableTime: nextAny? nextAny.minutesUntil : null },
    training: { previousSession: prev, recentSessions, weeklyLoad: ts.recentLoad, yesterdayLoad: ts.yesterdayLoad, highRecentLoad: ts.highRecentLoad, plannedSession: ts.plannedToday ? { title: ts.plannedToday.type, intensity: ts.plannedToday.intensity, duration_minutes: ts.plannedToday.duration_minutes } : null, daysSinceMuscleGroup: daysSince, lastFeedback: feedback[0]||null },
    commitments: { nextImportantEvent: nextImportant, fixedSchedule: (state.plan||[]).filter(p=>p.priority==='critical').map(p=>({ title:p.title, time:p.time })) },
  };
}

// ---------- Session construction + validation ----------
function expandTemplate(tpl, { reduceVolume=false, shortenTo=null }={}) {
  let exercises = tpl.exercises.map((e,i)=>{ const exd = exerciseById(e.exerciseId); return { exerciseId:e.exerciseId, slug:e.slug, name:exd?.name||e.slug, category:exd?.category, mediaUrl:exerciseDemoFor(e.exerciseId), order:i+1, sets: reduceVolume ? Math.max(1, e.sets - (e.role==='primary'?0:1)) : e.sets, planned_sets: reduceVolume ? Math.max(1, e.sets - (e.role==='primary'?0:1)) : e.sets, completed_sets:0, reps:e.reps, durationSeconds:e.durationSeconds, restSeconds:e.restSeconds, intensity:e.intensity, role:e.role, status:'pending' }; });
  if (shortenTo && tpl.estimated_duration > shortenTo) { // keep primary work, drop trailing accessories until estimate fits
    while (exercises.length>3 && estimateDuration(exercises) > shortenTo) exercises = exercises.slice(0,-1);
  }
  return exercises;
}
export function estimateDuration(exercises) { return Math.max(5, Math.round(exercises.reduce((a,e)=>a + (e.sets||e.planned_sets||1)*((e.durationSeconds||(e.reps?e.reps*3:40)) + (e.restSeconds||45)),0)/60)); }
export function validateWorkoutSession(session, ctx=null) {
  if (!session || !Array.isArray(session.exercises) || !session.exercises.length) return { ok:false, error:'session needs exercises' };
  const seen = new Set();
  for (const e of session.exercises) {
    const exd = exerciseById(e.exerciseId); if (!exd) return { ok:false, error:`unknown exercise "${e.exerciseId}"` };
    if (seen.has(e.exerciseId)) return { ok:false, error:`duplicate exercise "${exd.slug}"` };
    seen.add(e.exerciseId);
    if (ctx?.availableEquipment?.length && !exd.equipment.every(x=>x==='bodyweight'||ctx.availableEquipment.includes(x))) return { ok:false, error:`equipment unavailable for ${exd.name}` };
    if (!(e.sets>=1 && e.sets<=6)) return { ok:false, error:`sets out of range for ${exd.name}` };
    if (e.reps!=null && !(e.reps>=1 && e.reps<=30)) return { ok:false, error:`reps out of range for ${exd.name}` };
    if (e.durationSeconds!=null && !(e.durationSeconds>=10 && e.durationSeconds<=1200)) return { ok:false, error:`duration out of range for ${exd.name}` };
  }
  const dur = session.estimatedDuration ?? estimateDuration(session.exercises);
  if (!(dur>=10 && dur<=90)) return { ok:false, error:`session duration ${dur}min out of range` };
  return { ok:true, value:session };
}
export function validateFitnessRecommendation(x) {
  if (!x||typeof x!=='object'||Array.isArray(x)) return { ok:false, error:'not an object' };
  if (!RECOMMENDATION_STATUSES.includes(x.status)) return { ok:false, error:'invalid status' };
  if (typeof x.rationale!=='string'||!x.rationale.trim()) return { ok:false, error:'missing rationale' };
  if (!Array.isArray(x.adaptations)) return { ok:false, error:'adaptations must be an array' };
  for (const a of x.adaptations) if (!ADAPTATION_TYPES.includes(a.type)) return { ok:false, error:`invalid adaptation "${a.type}"` };
  if (!(typeof x.confidence==='number'&&x.confidence>=0&&x.confidence<=1)) return { ok:false, error:'confidence must be 0-1' };
  return { ok:true, value:x };
}
const BANNED_CLAIMS = ['push through pain','ignore pain','diagnose','rehabilit','treat your injur','cure','guarantee'];
export function safetyScreen(text='') { const t = String(text).toLowerCase(); if (/acute pain|sharp pain|injur|medical restriction|doctor said|fracture|torn/.test(t)) return { safe:false, reason:'pain_or_injury_reported', response:'You mentioned pain, an injury or a medical restriction. Glyth will not programme around that — please pause training on the affected area and seek appropriate professional guidance. A gentle general walk is fine only if it does not aggravate symptoms.' }; const hits = BANNED_CLAIMS.filter(b=>t.includes(b)); return hits.length ? { safe:false, reason:'unsafe_language', response:'That wording is not safe training guidance.' } : { safe:true }; }

// ---------- Deterministic adaptation ----------
function plannedTemplateFor(state, ctx, now) {
  const trainItem = (state.plan||[]).find(p=>p.id==='p_train');
  const text = `${trainItem?.title||''} ${trainItem?.note||''} ${ctx.training.plannedSession?.title||''}`.toLowerCase();
  if (/recovery|mobility/.test(text)) return templateBySlug('recovery-mobility');
  if (/lower|leg|squat/.test(text)) return templateBySlug('lower-strength');
  if (/upper|bench|press/.test(text)) return templateBySlug('upper-strength');
  if (/condition|cardio|run|bike/.test(text)) return templateBySlug('conditioning');
  if (ctx.primaryGoal==='conditioning') return templateBySlug('conditioning');
  if (ctx.primaryGoal==='recovery_maintain') return templateBySlug('recovery-mobility');
  const dow = now.getDay(); // Mon upper, Wed lower, Fri full-body rotation
  if (dow===1) return templateBySlug('upper-strength'); if (dow===3) return templateBySlug('lower-strength'); if (dow===5) return templateBySlug('full-body-strength');
  return templateBySlug('full-body-strength');
}
export function recommendFitness(state, now=new Date()) {
  const ctx = compileFitnessContext(state, now);
  const plannedTpl = plannedTemplateFor(state, ctx, now);
  const planned = { templateSlug: plannedTpl.slug, title: plannedTpl.title, estimatedDuration: plannedTpl.estimated_duration, type: plannedTpl.type, focus: plannedTpl.focus };
  const t = ctx.today, adaptations = []; let status='full', recTpl = plannedTpl, reduceVolume=false, shortenTo=null, confidence=0.82;
  const sleepBad = t.sleepDeviation!=null && t.sleepDeviation <= -25;
  const sleepLow = t.sleepDeviation!=null && t.sleepDeviation <= -15;
  const recBelow = t.recovery!=null && t.recoveryBaseline!=null && t.recovery <= t.recoveryBaseline - 20;
  const recLow = t.recovery!=null && t.recovery < 55;
  const loadHigh = (t.recentTrainingLoad!=null && t.recentTrainingLoad>=70) || ctx.training.highRecentLoad;
  const multiShort = (t.consecutivePoorNights||0) >= 2;
  const hasData = t.sleepMinutes!=null || t.recovery!=null || t.recentTrainingLoad!=null;

  if (hasData && ((recLow && loadHigh && (multiShort || sleepBad)) || (t.recovery!=null && t.recovery < 40 && loadHigh))) {
    status='recovery'; recTpl = templateBySlug('recovery-mobility'); shortenTo = 30; confidence=0.9;
    adaptations.push({ type:'convert_to_recovery', target: plannedTpl.slug, change:'replaced with recovery / mobility' }, { type:'shorten', target:'session', change:`${plannedTpl.estimated_duration}→30 min` });
  } else if (hasData && (recBelow || (sleepLow && loadHigh) || (recLow && sleepLow))) {
    status='modified'; reduceVolume=true; confidence=0.86;
    adaptations.push({ type:'reduce_volume', target:'accessory_work', change:'-1 set per accessory (~-30%)' }, { type:'reduce_intensity', target:'accessory_work', change:'keep primary work, ease accessories' });
    if (plannedTpl.estimated_duration > 40) { shortenTo = 38; adaptations.push({ type:'shorten', target:'session', change:`${plannedTpl.estimated_duration}→~38 min` }); }
  } else if (hasData && (sleepLow || recLow || (t.energy!=null && t.energy < 45))) {
    status='light'; reduceVolume=true; shortenTo=30; confidence=0.78;
    adaptations.push({ type:'reduce_volume', target:'session', change:'-1 set per exercise' }, { type:'shorten', target:'session', change:'~30 min' });
  }
  if (status!=='recovery' && t.availableTime!=null && t.availableTime < plannedTpl.estimated_duration) {
    shortenTo = Math.max(20, Math.min(shortenTo||999, Math.floor(t.availableTime/5)*5)); if (status==='full') status='modified';
    if (!adaptations.some(a=>a.type==='shorten')) adaptations.push({ type:'shorten', target:'session', change:`fits ${t.availableTime} min available` });
    if (shortenTo <= 25) recTpl = templateBySlug('short-full-body');
  }
  // avoid repeating the same major focus on consecutive days
  const prevFocus = ctx.training.previousSession?.focus;
  if (status==='full' && prevFocus && prevFocus===plannedTpl.focus && ctx.training.daysSinceMuscleGroup?.[plannedTpl.focus]===0) { adaptations.push({ type:'replace_exercise', target: plannedTpl.focus, change:'same focus yesterday — volume kept moderate' }); }

  let exercises = expandTemplate(recTpl, { reduceVolume, shortenTo });
  // equipment filter: swap any exercise needing unavailable kit for an approved alternative
  exercises = exercises.map(e=>{ const exd = exerciseById(e.exerciseId); if (exd && ctx.availableEquipment.length && !exd.equipment.every(x=>x==='bodyweight'||ctx.availableEquipment.includes(x))) { const alt = alternativeFor(e.exerciseId, ctx.availableEquipment); if (alt) return { ...e, exerciseId:alt.id, slug:alt.slug, name:alt.name, category:alt.category, mediaUrl:exerciseDemoFor(alt.id) }; } return e; });
  const recommended = { templateSlug: recTpl.slug, title: status==='recovery' ? 'Recovery / Light Strength' : (status==='modified'||status==='light') ? `${recTpl.title} — Reduced` : recTpl.title, estimatedDuration: status==='recovery'?30: shortenTo? Math.min(shortenTo, recTpl.estimated_duration) : reduceVolume? Math.round(recTpl.estimated_duration*0.75) : recTpl.estimated_duration, type: recTpl.type, focus: recTpl.focus, exercises };
  const bits = [];
  if (t.sleepMinutes!=null) bits.push(`Sleep ${fmtSleep(t.sleepMinutes)}${t.sleepBaseline?` vs ${fmtSleep(t.sleepBaseline)} baseline`:''}`);
  if (t.recovery!=null) bits.push(`recovery ${t.recovery}%${t.recoveryBaseline?` (baseline ${t.recoveryBaseline}%)`:''}`);
  if (loadHigh) bits.push('recent training load is high');
  if (ctx.commitments.nextImportantEvent) bits.push('an important commitment is ahead today');
  const rationale = !hasData ? 'No sleep or recovery data yet, so today follows your planned session at a standard dose. Connect a wearable and Glyth will adapt it.' : status==='full' ? `Recovery and load look in range (${bits.join(', ')}), so your planned session proceeds as written.` : status==='recovery' ? `Your recovery is below baseline following a high-load training day (${bits.join(', ')}). Today's session has been reduced to preserve capacity${ctx.commitments.nextImportantEvent?' before your important commitment':''}.` : `Today's volume has been reduced while keeping your primary strength work (${bits.join(', ')}).`;
  const rec = { status, plannedSession: planned, recommendedSession: recommended, rationale, adaptations, confidence: hasData?confidence:0.55, context: ctx };
  const v = validateWorkoutSession({ ...recommended, estimatedDuration: recommended.estimatedDuration }, ctx);
  if (!v.ok) { // deterministic fallback: recovery template always validates with bodyweight
    const fb = templateBySlug('recovery-mobility'); const exs = expandTemplate(fb,{}); rec.recommendedSession = { templateSlug: fb.slug, title: fb.title, estimatedDuration: estimateDuration(exs), type: fb.type, focus: fb.focus, exercises: exs }; rec.status = rec.status==='full'?'light':rec.status; }
  return rec;
}

// ---------- Bounded generation (Meta proposal gate uses this) ----------
export function generateWorkout(state, { goal, availableMinutes, note }={}) {
  const screen = safetyScreen(note||''); if (!screen.safe) return screen;
  const f = ensureFitness(state); const ctx = compileFitnessContext(state);
  const g = GOAL_TYPES.includes(goal) ? goal : f.profile.primary_goal;
  let tpl = g==='conditioning'?templateBySlug('conditioning'):g==='recovery_maintain'?templateBySlug('recovery-mobility'):g==='muscle_gain'?templateBySlug('full-body-strength'):templateBySlug('full-body-strength');
  if (availableMinutes && availableMinutes<=25) tpl = templateBySlug('short-full-body');
  const exercises = expandTemplate(tpl, { shortenTo: availableMinutes||null });
  const session = { title: tpl.title, purpose: `Generated for ${g.replace('_',' ')} within your available equipment and time.`, estimatedDuration: estimateDuration(exercises), exercises: exercises.map(e=>({ exerciseId:e.exerciseId, sets:e.sets, reps:e.reps, durationSeconds:e.durationSeconds, restSeconds:e.restSeconds, intensity:e.intensity })) };
  const v = validateWorkoutSession({ ...session, exercises: session.exercises.map((e,i)=>({...e, name: exerciseById(e.exerciseId)?.name })) }, ctx);
  if (!v.ok) return { safe:false, reason:'validation_failed', response: v.error };
  return { safe:true, session: { ...session, templateSlug: tpl.slug, type: tpl.type, focus: tpl.focus, exercises: exercises } };
}
export function validateGeneratedSession(raw, state) {
  if (!raw || !Array.isArray(raw.exercises)) return { ok:false, error:'exercises required' };
  const ctx = compileFitnessContext(state);
  const exercises = raw.exercises.map((e,i)=>{ const exd = exerciseById(e.exerciseId); if(!exd) return null; return { exerciseId:exd.id, slug:exd.slug, name:exd.name, category:exd.category, mediaUrl:exd.mediaUrl||null, order:i+1, sets:e.sets, planned_sets:e.sets, completed_sets:0, reps:e.reps??null, durationSeconds:e.durationSeconds??null, restSeconds:e.restSeconds??60, intensity:['low','moderate','high'].includes(e.intensity)?e.intensity:'moderate', role:'accessory', status:'pending' }; });
  if (exercises.some(x=>!x)) return { ok:false, error:'model invented an exercise id' };
  const session = { title: String(raw.title||'Generated session').slice(0,80), estimatedDuration: raw.estimatedDuration||estimateDuration(exercises), exercises };
  return validateWorkoutSession(session, ctx);
}

// ---------- Session lifecycle ----------
const localDay = (d=new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function getOrCreateTodaySession(state, now=new Date()) {
  const f = ensureFitness(state); const today = localDay(now);
  let s = f.sessions.find(x=>x.day===today && ['planned','in_progress'].includes(x.status)) || f.sessions.find(x=>x.day===today && x.status==='completed');
  if (s) return s;
  const rec = recommendFitness(state, now); f.lastRecommendation = { status:rec.status, rationale:rec.rationale, adaptations:rec.adaptations, confidence:rec.confidence, at: now.toISOString() };
  s = { id: uid('ws'), day: today, template_id: rec.recommendedSession.templateSlug, plan_item_id:'p_train', title: rec.recommendedSession.title, planned_title: rec.plannedSession.title, type: rec.recommendedSession.type, focus: rec.recommendedSession.focus, goal: f.profile.primary_goal, status:'planned', planned_duration: rec.plannedSession.estimatedDuration, estimated_duration: rec.recommendedSession.estimatedDuration, adaptation_status: rec.status==='full'?'none':'adapted', recommendation_status: rec.status, adaptation_reason: rec.status==='full'?null:rec.rationale, adaptations: rec.adaptations, exercises: rec.recommendedSession.exercises, started_at:null, completed_at:null, actual_duration:null, actual_load:null, feedback:null, rpe:null, created_at: now.toISOString() };
  f.sessions.unshift(s); f.events.unshift({ type:'fitness_session_created', session_id:s.id, status:rec.status, at: now.toISOString() });
  // intervention for an accepted adaptation
  if (rec.status!=='full') { state.interventions ||= []; if (!state.interventions.some(i=>i.id===`int_fit_${s.id}`)) state.interventions.unshift({ id:`int_fit_${s.id}`, title: rec.status==='recovery'?'Recovery session (training adapted)':'Training volume reduced for today', outcome:'Adapted — outcome pending completion', at:'Today', kind:'heuristic', fitness_type: rec.adaptations[0]?.type==='convert_to_recovery'?'recovery_session':rec.adaptations.some(a=>a.type==='shorten')?'shortened_workout':'training_volume_reduction' }); }
  return s;
}
export function sessionById(state, id) { return ensureFitness(state).sessions.find(s=>s.id===id) || null; }
export function startSession(state, id) { const s = sessionById(state,id); if(!s) throw new Error('Session not found'); if (s.status==='completed') return s; s.status='in_progress'; s.started_at ||= new Date().toISOString(); ensureFitness(state).events.unshift({ type:'fitness_started', session_id:s.id, at:s.started_at }); return s; }
export function updateExercise(state, id, exerciseId, action, payload={}) {
  const s = sessionById(state,id); if(!s) throw new Error('Session not found'); const e = s.exercises.find(x=>x.exerciseId===exerciseId||x.slug===exerciseId); if(!e) throw new Error('Exercise not in session');
  if (action==='complete_set') { e.completed_sets = Math.min(e.planned_sets, (e.completed_sets||0)+1); if (e.completed_sets>=e.planned_sets) e.status='completed'; else e.status='in_progress'; }
  else if (action==='skip') { e.status='skipped'; }
  else if (action==='reduce_sets') { e.planned_sets = Math.max(1, e.planned_sets-1); if (e.completed_sets>=e.planned_sets) e.status='completed'; }
  else if (action==='replace') { const taken = new Set(s.exercises.map(x=>x.exerciseId)); const alt = EXERCISES.find(x=>x.id!==e.exerciseId && !taken.has(x.id) && (x.pattern===exerciseById(e.exerciseId)?.pattern || x.category===e.category) && x.equipment.every(k=>k==='bodyweight'||ensureFitness(state).profile.available_equipment.includes(k))); if(!alt) throw new Error('No approved alternative available'); Object.assign(e, { exerciseId:alt.id, slug:alt.slug, name:alt.name, category:alt.category, mediaUrl:exerciseDemoFor(alt.id), status:'pending', completed_sets:0 }); }
  else throw new Error('unknown exercise action');
  if (s.status==='planned') startSession(state,id);
  return s;
}
export function completeSession(state, id, { endedEarly=false }={}) {
  const s = sessionById(state,id); if(!s) throw new Error('Session not found'); if (s.status==='completed') return s;
  const now = new Date(); s.status='completed'; s.completed_at = now.toISOString(); s.started_at ||= now.toISOString();
  s.actual_duration = Math.max(1, Math.round((now - new Date(s.started_at))/60000) || s.estimated_duration);
  const doneSets = s.exercises.reduce((a,e)=>a+(e.completed_sets||0),0); const plannedSets = s.exercises.reduce((a,e)=>a+(e.planned_sets||0),0);
  s.completion_ratio = plannedSets? Math.round(doneSets/plannedSets*100):0;
  const intensity = s.type==='recovery'?'low':(s.adaptation_status==='adapted'?'moderate':'high');
  // training load via existing deterministic model (idempotent by external_id)
  try { ingestWorkouts(state, [{ external_id:s.id, started_at:s.started_at, duration_minutes:s.actual_duration, intensity, type:s.title }], { provider:'manual' }); const ts = trainingSummary(state, now); state.currentState.trainingLoad = ts.recentLoadScore; s.actual_load = state.canonical.workouts.find(w=>w.external_id===s.id)?.load ?? null; } catch { s.actual_load = null; }
  const item = (state.plan||[]).find(p=>p.id==='p_train'||p.type==='training'); if (item) { item.status='completed'; item.note = `${s.title} · completed ${s.actual_duration} min${s.adaptation_status==='adapted'?' · adapted for today':''}`; }
  state.interventions ||= []; const inv = state.interventions.find(i=>i.id===`int_fit_${s.id}`); if (inv) inv.outcome = 'Completed — outcome pending feedback'; else state.interventions.unshift({ id:`int_fit_done_${s.id}`, title:`${s.title} completed`, outcome:'Completed — outcome pending feedback', at:'Today', kind:'heuristic' });
  ensureFitness(state).events.unshift({ type:'fitness_completed', session_id:s.id, at:s.completed_at });
  return s;
}
export function submitFeedback(state, id, feedback, rpe=null) {
  if (!['too_easy','about_right','too_hard'].includes(feedback)) throw new Error('feedback must be too_easy, about_right or too_hard');
  const s = sessionById(state,id); if(!s) throw new Error('Session not found'); s.feedback = feedback; if (rpe!=null) s.rpe = Math.max(1, Math.min(10, Number(rpe)));
  const inv = (state.interventions||[]).find(i=>i.id===`int_fit_${s.id}`||i.id===`int_fit_done_${s.id}`); if (inv) inv.outcome = feedback==='about_right'?'Completed — felt about right':feedback==='too_hard'?'Completed — felt too hard; future volume will ease':'Completed — felt too easy; future volume can progress';
  return s;
}

// ---------- Week / progress / insight ----------
export function weeklyStats(state, now=new Date()) {
  const f = ensureFitness(state); const weekAgo = now.getTime()-7*864e5;
  const done = f.sessions.filter(s=>s.status==='completed' && new Date(s.completed_at).getTime()>=weekAgo);
  const target = 4; const completedToday = f.sessions.some(s=>s.day===localDay(now)&&s.status==='completed');
  return { sessionsThisWeek: done.length, targetPerWeek: target, consistency: Math.min(100, Math.round(done.length/target*100)), minutesThisWeek: done.reduce((a,s)=>a+(s.actual_duration||0),0), adaptedCount: done.filter(s=>s.adaptation_status==='adapted').length, completedToday, weeklyLoadLabel: (state.currentState?.trainingLoad??0)>=70?'High':(state.currentState?.trainingLoad??0)>=40?'Moderate':'Low' };
}
export function weekPlan(state, now=new Date()) {
  const f = ensureFitness(state); const monday = new Date(now); monday.setDate(now.getDate()-((now.getDay()+6)%7));
  return Array.from({length:7},(_,i)=>{ const d=new Date(monday); d.setDate(monday.getDate()+i); const day=localDay(d); const s=f.sessions.find(x=>x.day===day); const label=['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i];
    if (s) return { day:label, date:day, title:s.title, status:s.status==='completed'?'Completed':s.status==='in_progress'?'In progress':s.adaptation_status==='adapted'?'Adjusted':'Planned' };
    if (d.toDateString()===now.toDateString()) return { day:label, date:day, title:'Today\'s session', status:'Planned' };
    return { day:label, date:day, title: [0,2,4].includes(i)?'Strength':'Rest', status: d<now?'—':'Planned' }; });
}
export function fitnessInsight(state) {
  const f = ensureFitness(state); const done = f.sessions.filter(s=>s.status==='completed'); if (!done.length) return null;
  const short = done.filter(s=>(s.actual_duration||99)<=45); if (done.length>=3 && short.length/done.length>=0.6) return 'Your highest completion rate is on sessions under 45 minutes.';
  if (done.filter(s=>s.adaptation_status==='adapted').length>=2) return 'Training demand has been reduced on lower-recovery days, and those sessions were still completed.';
  return `${done.length} training session${done.length===1?'':'s'} completed. Glyth adapts the next one to your sleep, recovery and load.`;
}
export { fmtSleep };
