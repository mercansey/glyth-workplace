// Glyth Snapshot — Employer domain engine (clean-room, hackathon only).
// Shared by browser (static demo) and Node API. Privacy-first: employer APIs
// only ever return aggregates; individual permitted signals never leave this
// module's aggregation boundary.
export const MIN_COHORT_SIZE = Number((typeof process !== 'undefined' && process.env?.MIN_COHORT_SIZE) || 5) || 5;
export const ROLES = ['owner','admin','manager','viewer'];
const FORBIDDEN = ['sleep','health','recovery','medical','conversation','personal_goal','relationship','ai_interaction'];
let seq = 0; const uid = (p) => `${p}_e${++seq}_${Math.random().toString(36).slice(2,7)}`;
const clamp = (n,a=0,b=100)=>Math.max(a,Math.min(b,Math.round(n)));
const avg = (xs)=> xs.length? xs.reduce((a,b)=>a+b,0)/xs.length : 0;

// ---------- Permissions ----------
export function canViewOrg(actor, orgId){ return !!actor && actor.orgId===orgId && ROLES.includes(actor.role); }
export function canViewTeam(actor, team){ if(!canViewOrg(actor, team.orgId)) return false; if(actor.role==='manager') return (actor.teamIds||[]).includes(team.id); return true; }
export function canManageInterventions(actor, orgId){ return canViewOrg(actor, orgId) && ['owner','admin','manager'].includes(actor.role); }
export function assertViewOrg(actor, orgId){ if(!canViewOrg(actor,orgId)) throw Object.assign(new Error('forbidden: not a member of this organisation'),{status:403}); }
export function assertManage(actor, orgId){ if(!canManageInterventions(actor,orgId)) throw Object.assign(new Error('forbidden: role cannot manage interventions'),{status:403}); }

// ---------- Seed (deterministic synthetic demo) ----------
const FIRST=['Amara','Jonas','Priya','Tom','Lena','Marcus','Sofia','Dev','Nina','Omar','Grace','Felix','Ivy','Hugo','Maya','Leo','Ruth','Sam','Tara','Victor','Wren','Yusuf','Zoe','Adam','Beth','Carl','Dana','Eli','Freya','George','Hana','Isaac','Jade','Kofi','Lily','Noah'];
const LAST=['Sharma','Weber','Patel','Ellis','Klein','Reed','Costa','Nair','Berg','Haddad','Moss','Frost','Chen','Marsh','Ali','Frost','Osei','Lund','Reyes','Voss','Hart','Aziz','Lind','Baker','Cross','Doyle','Evans','Field','Grant','Hayes','Ingram','James','Khan','Lopez','Mensah','North'];
const JOB_ROLES={ t_product:['Product Manager','Product Designer','Product Analyst','UX Researcher','Design Lead'], t_engineering:['Software Engineer','Tech Lead','Platform Engineer','QA Engineer','Engineering Manager'], t_operations:['Operations Manager','Operations Analyst','Support Lead','Process Coordinator'], t_people:['People Partner','Recruiter','People Operations'] };
let nameSeq=0;
function members(teamId, n, base){ return Array.from({length:n},(_,i)=>{ const name=`${FIRST[(nameSeq)%FIRST.length]} ${LAST[(nameSeq*7+3)%LAST.length]}`; nameSeq++; return { id:`${teamId}_m${i+1}`, teamId, name, role:(JOB_ROLES[teamId]||['Team Member'])[i%(JOB_ROLES[teamId]||['Team Member']).length], consentedCategories:['workload','meeting_density','focus_fragmentation','engagement','capacity','schedule_density'],
  signals:{ workload: clamp(base.workload + ((i*7)%13)-6), meeting_density: clamp(base.meeting + ((i*5)%11)-5), focus_fragmentation: clamp(base.focus + ((i*3)%9)-4), engagement: clamp(base.engagement + ((i*4)%9)-4), capacity: clamp(base.capacity + ((i*6)%11)-5), schedule_density: clamp(base.meeting + ((i*2)%7)-3) } }; }); }
// Directory roster only: name/role/avatar + how much they share in aggregate. NEVER signal values.
export function teamRoster(state, team){ return (state.members||[]).filter(m=>m.teamId===team.id).map(m=>({ id:m.id, name:m.name, initials:m.name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase(), role:m.role, teamId:team.id, teamName:team.name, sharing: m.consentedCategories.length>=6 ? 'Sharing work-pattern aggregates' : `Sharing ${m.consentedCategories.length} of 6 aggregate categories`, categoriesSharing:m.consentedCategories.length })); }
export function createEmployerSeed(){
  seq=0; nameSeq=0;
  const org={ id:'org_northstar', name:'Northstar', slug:'northstar' };
  const teams=[
    { id:'t_product', orgId:org.id, name:'Product', description:'Delivery deadline in 3 days', status:'watch' },
    { id:'t_engineering', orgId:org.id, name:'Engineering', description:'Platform migration in progress', status:'watch' },
    { id:'t_operations', orgId:org.id, name:'Operations', description:'Steady operational rhythm', status:'stable' },
    { id:'t_people', orgId:org.id, name:'People', description:'Small team — privacy threshold applies', status:'stable' },
  ];
  const bases={ t_product:{workload:68,meeting:62,focus:44,engagement:74,capacity:74}, t_engineering:{workload:64,meeting:71,focus:52,engagement:71,capacity:62}, t_operations:{workload:48,meeting:38,focus:22,engagement:78,capacity:81}, t_people:{workload:40,meeting:30,focus:18,engagement:80,capacity:85} };
  const allMembers=[...members('t_product',14,bases.t_product),...members('t_engineering',16,bases.t_engineering),...members('t_operations',11,bases.t_operations),...members('t_people',3,bases.t_people)];
  // One Product member revokes focus consent -> excluded from that category only.
  const revoked = allMembers.find(m=>m.teamId==='t_product'); revoked.consentedCategories = revoked.consentedCategories.filter(c=>c!=='focus_fragmentation');
  return {
    version:1, minCohortSize: MIN_COHORT_SIZE,
    organisations:[org, { id:'org_other', name:'Other Org (isolation fixture)', slug:'other' }],
    actors:[
      { id:'actor_owner', orgId:org.id, role:'owner', label:'Northstar Owner' },
      { id:'actor_viewer', orgId:org.id, role:'viewer', label:'Northstar Viewer' },
      { id:'actor_manager_product', orgId:org.id, role:'manager', teamIds:['t_product'], label:'Product Manager' },
      { id:'actor_outsider', orgId:'org_other', role:'owner', label:'Outsider' },
    ],
    teams, members: allMembers,
    baselines:{ t_product:{workload:58,meeting_density:55,focus_fragmentation:39,engagement:72,capacity:76,schedule_density:52}, t_engineering:{workload:59,meeting_density:57,focus_fragmentation:44,engagement:70,capacity:66,schedule_density:54}, t_operations:{workload:49,meeting_density:39,focus_fragmentation:23,engagement:76,capacity:79,schedule_density:38}, t_people:{workload:41,meeting_density:31,focus_fragmentation:19,engagement:79,capacity:84,schedule_density:30} },
    goals:[
      { id:'og_focus', orgId:org.id, title:'Improve focus capacity', category:'focus', priority:1, target:'+10% focus protection / quarter', currentValue:64, status:'active' },
      { id:'og_meetings', orgId:org.id, title:'Reduce unnecessary meeting load', category:'meetings', priority:1, target:'-15% meeting density', currentValue:58, status:'active' },
      { id:'og_workload', orgId:org.id, title:'Improve sustainable workload', category:'workload', priority:2, target:'Workload within baseline for 80% of teams', currentValue:71, status:'active' },
    ],
    timeline:[ {time:'09:00',title:'Company stand-up',kind:'event'},{time:'11:00',title:'High meeting density',kind:'signal'},{time:'13:00',title:'Focus window',kind:'focus'},{time:'15:00',title:'Product review',kind:'event'},{time:'17:00',title:'Workload expected to fall',kind:'signal'} ],
    interventions:[
      { id:'int_focus_product', orgId:org.id, teamId:'t_product', type:'protect_focus', title:'Protect focus window', description:'Protect 10:00–12:00 tomorrow for Product.', reason:'Meeting density has remained above baseline for three days and focus fragmentation is rising.', evidence:['Meeting density +13% vs baseline (Product)','Focus fragmentation +12% vs baseline (Product)'], status:'proposed', createdBy:'glyth', createdAt:'today 08:00', startedAt:null, completedAt:null, expectedOutcome:'Increase uninterrupted focus availability; focus fragmentation down within 7 days.', observedOutcome:null },
      { id:'int_meetings_eng', orgId:org.id, teamId:'t_engineering', type:'reduce_meetings', title:'Reduce meeting density', description:'Move two low-priority recurring meetings in Engineering.', reason:'Engineering meeting load is significantly above its four-week baseline.', evidence:['Meeting density +24% vs baseline (Engineering)','Focus fragmentation +17% vs baseline (Engineering)'], status:'proposed', createdBy:'glyth', createdAt:'today 08:00', startedAt:null, completedAt:null, expectedOutcome:'Meeting density down; deep-work availability up.', observedOutcome:null },
      { id:'int_focus_done', orgId:org.id, teamId:'t_product', type:'protect_focus', title:'Protected Product focus window', description:'Protected 10:00–12:00 focus window last week.', reason:'Prior focus fragmentation signal.', evidence:['Focus fragmentation 31% before'], status:'completed', createdBy:'glyth', createdAt:'last Monday', startedAt:'last Tuesday', completedAt:'last Friday', expectedOutcome:'Focus fragmentation down.', observedOutcome:{ metric:'focus_fragmentation', before:31, after:21, result:'improved', confidence:'moderate', note:'Focus fragmentation 31% → 21% in the week after the protected window.' } },
    ],
    programmes:[
      { id:'prog_focus', orgId:org.id, goalId:'og_focus', teamIds:['t_product','t_engineering'], title:'Focus Protection Programme', description:'Protect uninterrupted focus time while delivery pressure rises.', status:'active', progress:64, target:'+10% focus protection / quarter', interventionIds:['int_focus_product','int_focus_done'] },
      { id:'prog_meetings', orgId:org.id, goalId:'og_meetings', teamIds:['t_engineering','t_product'], title:'Meeting Hygiene Programme', description:'Remove low-value recurring meetings and protect deep-work availability.', status:'proposed', progress:58, target:'-15% meeting density', interventionIds:['int_meetings_eng'] },
      { id:'prog_workload', orgId:org.id, goalId:'og_workload', teamIds:['t_product','t_engineering','t_operations'], title:'Sustainable Workload Programme', description:'Keep workload within baseline through earlier capacity signals.', status:'active', progress:71, target:'Workload within baseline for 80% of teams', interventionIds:[] },
    ],
    employerAiRuns:[], scenario:null,
  };
}
export function resetEmployerDemo(){ return createEmployerSeed(); }

// ---------- Aggregation + cohort suppression (privacy boundary) ----------
export function aggregateTeam(state, team, minCohort = state.minCohortSize ?? MIN_COHORT_SIZE){
  const base = state.baselines?.[team.id] || {};
  const teamMembers = (state.members||[]).filter(m=>m.teamId===team.id);
  const metrics = {};
  const pre = state.precomputedAggregates?.[team.id]?.metrics;
  if (pre) { for (const [k,v] of Object.entries(pre)) metrics[k] = { message:'Not enough data to show this insight privately.', ...v }; }
  for(const cat of pre ? [] : ['workload','meeting_density','focus_fragmentation','engagement','capacity','schedule_density']){
    if(FORBIDDEN.includes(cat)) continue;
    const contributors = teamMembers.filter(m=>m.consentedCategories.includes(cat));
    if(contributors.length < minCohort){ metrics[cat]={ suppressed:true, participantCount:contributors.length, value:null, baseline:base[cat]??null, changePercent:null, message:'Not enough data to show this insight privately.' }; continue; }
    const value = clamp(avg(contributors.map(m=>m.signals[cat])));
    const baseline = base[cat] ?? value;
    metrics[cat]={ suppressed:false, participantCount:contributors.length, value, baseline, changePercent: baseline? Math.round(((value-baseline)/baseline)*100):0 };
  }
  const participantCount = Math.max(0,...Object.values(metrics).map(m=>m.participantCount||0));
  const suppressed = Object.values(metrics).every(m=>m.suppressed);
  const cap = metrics.capacity, wl = metrics.workload;
  const status = suppressed ? 'insufficient_data' : (wl && !wl.suppressed && wl.changePercent>=15) || (cap && !cap.suppressed && cap.value<65) ? 'watch' : 'stable';
  // Deterministic 7-point trend per metric: baseline -> current, small stable wiggle. Aggregates only.
  const seedN = [...team.id].reduce((a,c)=>a+c.charCodeAt(0),0);
  const trendFor = (m,k) => (!m || m.suppressed) ? null : Array.from({length:7},(_,i)=>{ const p=i/6; const wig = i===6 ? 0 : Math.round(Math.sin(seedN + k.length*3 + i*1.7)*3); return clamp(m.baseline + (m.value-m.baseline)*p + wig); });
  const trends = suppressed ? null : { labels:['Mon','Tue','Wed','Thu','Fri','Sat','Sun'], workload:trendFor(metrics.workload,'workload'), meeting_density:trendFor(metrics.meeting_density,'meeting_density'), focus_fragmentation:trendFor(metrics.focus_fragmentation,'focus_fragmentation'), engagement:trendFor(metrics.engagement,'engagement'), capacity:trendFor(metrics.capacity,'capacity'), schedule_density:trendFor(metrics.schedule_density,'schedule_density') };
  return { teamId:team.id, orgId:team.orgId, name:team.name, description:team.description, status, participantCount, metrics, suppressed, trends };
}
export function aggregateOrg(state, orgId){
  const teams = state.teams.filter(t=>t.orgId===orgId).map(t=>aggregateTeam(state,t));
  const visible = teams.filter(t=>!t.suppressed);
  const within = visible.length? Math.round(visible.filter(t=>t.status==='stable').length/visible.length*100):0;
  const dim = (cat, invert=false)=>{ const xs=visible.map(t=>t.metrics[cat]).filter(m=>m&&!m.suppressed); if(!xs.length) return {value:null,suppressed:true,message:'Not enough data to show this insight privately.'}; const v=clamp(avg(xs.map(m=>m.value))); return { value: invert? 100-v : v, suppressed:false, participantCount: Math.min(...xs.map(m=>m.participantCount)) }; };
  return { generatedAt: new Date().toISOString(), teams, dimensions:{ capacity:dim('capacity'), workloadPressure:dim('workload',true), engagement:dim('engagement'), focusProtection:dim('focus_fragmentation',true), scheduleDensity:dim('schedule_density',true) },
    stateLabel: visible.some(t=>t.status==='watch')?'Watch':'Stable', withinNormalCapacityPercent: within,
    summary: visible.some(t=>t.name==='Product'&&t.status==='watch') ? 'Overall capacity remains stable, although workload pressure is increasing in Product.' : 'Overall capacity remains within normal range across visible teams.' };
}

// ---------- Rules + context compiler + structured reasoning ----------
export function evaluateEmployerRules(state, orgId){
  const agg = aggregateOrg(state, orgId); const signals=[];
  for(const t of agg.teams){ if(t.suppressed) continue; const m=t.metrics;
    if(m.workload && !m.workload.suppressed && m.workload.changePercent>=10) signals.push({ id:`sig_wl_${t.teamId}`, kind:'observed', type:'workload', teamId:t.teamId, teamName:t.name, title:'Workload rising', body:`${t.name} workload is ${m.workload.changePercent}% above its recent baseline.`, changePercent:m.workload.changePercent });
    if(m.meeting_density && !m.meeting_density.suppressed && m.meeting_density.changePercent>=10 && m.focus_fragmentation && !m.focus_fragmentation.suppressed && m.focus_fragmentation.changePercent>=10) signals.push({ id:`sig_focus_${t.teamId}`, kind:'observed', type:'focus_fragmentation', teamId:t.teamId, teamName:t.name, title:'Focus fragmentation', body:`${t.name} has ${m.focus_fragmentation.changePercent}% more fragmented focus than its four-week baseline, alongside meeting density +${m.meeting_density.changePercent}%.`, changePercent:m.focus_fragmentation.changePercent });
    if(t.status==='stable') signals.push({ id:`sig_stable_${t.teamId}`, kind:'observed', type:'capacity', teamId:t.teamId, teamName:t.name, title:'Capacity stable', body:`${t.name} remains within normal capacity.`, changePercent:0 });
  }
  const watchTeams = agg.teams.filter(t=>t.status==='watch');
  if(watchTeams.length>=2) signals.unshift({ id:'sig_org_capacity', kind:'inferred', type:'capacity', teamId:null, teamName:'Organisation', title:'Organisation capacity pressure', body:`${watchTeams.length} teams show elevated pressure — an organisation-level capacity signal, not an individual one.`, changePercent:null });
  return signals.slice(0,5);
}
export function compileEmployerContext(state, orgId){
  const agg = aggregateOrg(state, orgId);
  return { organisation: state.organisations.find(o=>o.id===orgId) || null, active_goals: state.goals.filter(g=>g.orgId===orgId&&g.status==='active'),
    organisation_baselines: state.baselines || {}, team_summaries: agg.teams, important_signals: evaluateEmployerRules(state, orgId),
    current_interventions: state.interventions.filter(i=>i.orgId===orgId&&['proposed','approved','active'].includes(i.status)), active_programmes: (state.programmes||[]).filter(p=>p.orgId===orgId&&p.status==='active').map(p=>({title:p.title,status:p.status,progress:p.progress,target:p.target})),
    recent_outcomes: state.interventions.filter(i=>i.orgId===orgId&&i.status==='completed').map(i=>({title:i.title, observedOutcome:i.observedOutcome})),
    upcoming_events: state.timeline, constraints:{ minCohortSize: state.minCohortSize ?? MIN_COHORT_SIZE, forbiddenCategories: FORBIDDEN, note:'Aggregates only. No individual records, health, sleep, conversations or personal goals.' } };
}
const UNSAFE_EMPLOYER_LANGUAGE = ['disciplin','low performer','low-performer','underperform','contact the employee','message the employee','fire ','terminate the','rank employees','name and shame'];
export function validateEmployerReasoning(x){
  if(!x||typeof x!=='object') return {ok:false,error:'not an object'};
  for(const k of ['organisationState','observations','emergingSignals','affectedTeams','hypotheses','recommendations','proposedInterventions','explanation','confidence']) if(!(k in x)) return {ok:false,error:`missing ${k}`};
  if(!Array.isArray(x.observations)||!Array.isArray(x.recommendations)) return {ok:false,error:'observations/recommendations must be arrays'};
  if(!(typeof x.confidence==='number'&&x.confidence>=0&&x.confidence<=1)) return {ok:false,error:'confidence must be 0-1'};
  const prose = JSON.stringify([x.organisationState,x.observations,x.emergingSignals,x.hypotheses,x.recommendations,x.explanation]).toLowerCase();
  const hit = UNSAFE_EMPLOYER_LANGUAGE.find(w=>prose.includes(w)); if(hit) return {ok:false,error:`unsafe employer language: ${hit}`};
  const s=JSON.stringify(x).toLowerCase(); for(const f of FORBIDDEN) if(s.includes(`"${f}"`) && f!=='focus_fragmentation') { /* category names in prose ok; raw fields not */ }
  return {ok:true,value:x};
}
export function employerReason(state, orgId){
  const ctx = compileEmployerContext(state, orgId); const agg = aggregateOrg(state, orgId);
  const result = { organisationState: agg.stateLabel, observations: ctx.important_signals.filter(s=>s.kind==='observed').map(s=>s.body),
    emergingSignals: ctx.important_signals.map(s=>s.title), affectedTeams: agg.teams.filter(t=>t.status==='watch').map(t=>t.name),
    hypotheses:[{ kind:'inferred', label:'Meeting density is beginning to affect focus capacity in Product and Engineering.', basis:'Meeting density and focus fragmentation are both above baseline in the same teams. Correlation, not proven causality.' }],
    recommendations: state.interventions.filter(i=>i.orgId===orgId&&i.status==='proposed').map(i=>({ title:i.title, description:i.description, reason:i.reason, interventionId:i.id })),
    proposedInterventions: state.interventions.filter(i=>i.orgId===orgId&&i.status==='proposed').map(i=>i.id),
    explanation:'Meeting density is reducing focus capacity across Product and Engineering (observed aggregates, past 7 days). Operations remains stable.', confidence:0.78 };
  const v = validateEmployerReasoning(result); if(!v.ok) throw new Error(v.error);
  state.employerAiRuns.unshift({ id:uid('eai'), orgId, validated:true, fallback:false, at:new Date().toISOString(), provider:'deterministic' });
  return { context: ctx, reasoning: result };
}
export function employerInsight(state, orgId){
  const r = employerReason(state, orgId);
  return { headline:'Meeting density is beginning to affect focus capacity.', body:r.reasoning.explanation, observed:['Meetings ↑ 21% (aggregate, Product + Engineering)','Focus fragmentation ↑ 17% (aggregate)'], inferred:r.reasoning.hypotheses, observedAcross:['Product','Engineering'], timeRange:'Past 7 days',
    chain:[{label:'Meeting density ↑',kind:'observed'},{label:'Focus fragmentation ↑',kind:'observed'},{label:'Deep work availability ↓',kind:'inferred'},{label:'Delivery pressure ↑',kind:'inferred'}], reasoning:r.reasoning };
}

// ---------- Programmes ----------
export function listProgrammes(state, orgId, actor=null){
  assertViewOrg(actor || {orgId, role:'owner'}, orgId);
  return (state.programmes||[]).filter(p=>p.orgId===orgId)
    .filter(p=> !actor || actor.role!=='manager' || p.teamIds.some(id=>(actor.teamIds||[]).includes(id)))
    .map(p=>({ ...p,
      goal: state.goals.find(g=>g.id===p.goalId)||null,
      teams: p.teamIds.map(id=>state.teams.find(t=>t.id===id)).filter(Boolean).map(t=>({id:t.id,name:t.name})),
      interventions: p.interventionIds.map(id=>state.interventions.find(i=>i.id===id)).filter(Boolean).map(i=>({id:i.id,title:i.title,status:i.status,teamId:i.teamId,observedOutcome:i.observedOutcome||null})) }));
}
export function decideProgramme(state, actor, orgId, id, decision){
  assertManage(actor, orgId);
  const p = (state.programmes||[]).find(x=>x.id===id && x.orgId===orgId); if(!p) throw Object.assign(new Error('programme not found'),{status:404});
  if(actor.role==='manager' && !p.teamIds.some(t=>(actor.teamIds||[]).includes(t))) throw Object.assign(new Error('forbidden: manager can only manage own teams'),{status:403});
  const map={activate:'active', pause:'paused', complete:'completed'};
  if(!map[decision]) throw Object.assign(new Error('unknown decision'),{status:400});
  p.status=map[decision]; return p;
}

// ---------- Intervention lifecycle ----------
export function decideIntervention(state, actor, orgId, id, decision){
  assertManage(actor, orgId);
  const i = state.interventions.find(x=>x.id===id && x.orgId===orgId); if(!i) throw Object.assign(new Error('intervention not found'),{status:404});
  if(actor.role==='manager' && i.teamId && !(actor.teamIds||[]).includes(i.teamId)) throw Object.assign(new Error('forbidden: manager can only manage own teams'),{status:403});
  if(decision==='review'){ if(i.status!=='proposed') throw Object.assign(new Error(`cannot review from ${i.status}`),{status:409}); i.reviewedAt='today'; return i; }
  if(decision==='approve'){ if(!['proposed'].includes(i.status)) throw Object.assign(new Error(`cannot approve from ${i.status}`),{status:409}); i.status='active'; i.startedAt='today';
    const team = state.teams.find(x=>x.id===i.teamId); const agg = team ? aggregateTeam(state, team) : null; const metric = i.type==='reduce_meetings' ? 'meeting_density' : 'focus_fragmentation'; const m = agg?.metrics?.[metric];
    i.outcomeBaseline = m && !m.suppressed ? { metric, value:m.value, at:'approval' } : null; return i; }
  if(decision==='dismiss'){ if(i.status!=='proposed') throw Object.assign(new Error(`cannot dismiss from ${i.status}`),{status:409}); i.status='dismissed'; i.completedAt='today'; return i; }
  if(decision==='complete'){ if(i.status!=='active') throw Object.assign(new Error(`cannot complete from ${i.status}`),{status:409}); i.status='completed'; i.completedAt='today';
    if(!i.observedOutcome){ const team = state.teams.find(x=>x.id===i.teamId); const agg = team ? aggregateTeam(state, team) : null; const metric = i.outcomeBaseline?.metric || (i.type==='reduce_meetings' ? 'meeting_density' : 'focus_fragmentation'); const m = agg?.metrics?.[metric];
      if(i.outcomeBaseline && m && !m.suppressed){ const before=i.outcomeBaseline.value, after=m.value; const lowerBetter = metric!=='capacity'; const improved = lowerBetter ? after<before : after>before; const same = after===before;
        i.observedOutcome = { metric, before, after, result: same?'unchanged':improved?'improved':'worsened', confidence:'low', note:`Observed after intervention: team ${metric.replace('_',' ')} aggregate ${before}% at approval → ${after}% at completion. Short window — association, not proof of causation.` }; }
      else i.observedOutcome = { metric, before:i.outcomeBaseline?.value ?? null, after:m && !m.suppressed ? m.value : null, result:'insufficient_data', confidence:'low', note:'Not enough aggregate data to measure an outcome privately.' }; }
    return i; }
  throw Object.assign(new Error('unknown decision'),{status:400});
}
// Integration scenario: meeting density rises -> focus fragmentation rises -> insight + intervention
export function applyEmployerScenario(state, orgId, key){
  if(key!=='meeting_density_rise') throw Object.assign(new Error('unknown employer scenario'),{status:400});
  for(const m of state.members.filter(x=>['t_product','t_engineering'].includes(x.teamId))){ m.signals.meeting_density=clamp(m.signals.meeting_density+8); m.signals.focus_fragmentation=clamp(m.signals.focus_fragmentation+6); }
  state.scenario=key;
  if(!state.interventions.some(i=>i.id==='int_scenario_focus')) state.interventions.unshift({ id:'int_scenario_focus', orgId, teamId:'t_product', type:'protect_focus', title:'Protect focus time (scenario)', description:'Create a 2-hour meeting-free block tomorrow morning for Product.', reason:'Scenario: meeting density rose, then focus fragmentation rose in the same teams.', evidence:['Meeting density rising (aggregate)','Focus fragmentation rising (aggregate)'], status:'proposed', createdBy:'glyth', createdAt:'today', startedAt:null, completedAt:null, expectedOutcome:'Focus fragmentation down within 7 days.', observedOutcome:null });
  return employerInsight(state, orgId);
}
export function revokeConsent(state, userId, category){ const m=state.members.find(x=>x.id===userId); if(m) m.consentedCategories=m.consentedCategories.filter(c=>c!==category); return m; }
