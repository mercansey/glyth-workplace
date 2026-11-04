// Scheduled-job logic (pure, invoked by the server scheduler/endpoints):
// morning assembly, nightly roll-up, weekly summary, trigger policy.
import { recalculateBaselines } from './baselines.js';
import { deriveDailyState, localDate } from './canonical.js';
import { assembleDailyPlan } from './plan.js';
export function contextFingerprint(state) {
  const c = state.currentState, plan = state.plan.map(p => `${p.id}:${p.status}:${p.time}`).join('|');
  return [c.sleepMinutes, c.recovery, c.energy, c.workload, c.trainingLoad, plan].join(':');
}
export function shouldOrchestrate(state, trigger, last = {}) {
  if (!state.plan.length && state.currentState.sleepMinutes == null) return { run: false, reason: 'no data' };
  const fp = contextFingerprint(state);
  if (last.fingerprint === fp && (Date.now() - (last.at || 0)) < 30 * 60000) return { run: false, reason: 'deduplicated (same context <30m)', fingerprint: fp };
  const meaningful = ['morning_plan', 'manual', 'user_request', 'recommendation_decision'].includes(trigger)
    || (state.baselines.sleepMinutes && state.currentState.sleepMinutes != null && state.currentState.sleepMinutes < state.baselines.sleepMinutes * 0.85)
    || (state.currentState.recovery != null && state.currentState.recovery < 55);
  return { run: meaningful, reason: meaningful ? `trigger:${trigger}` : 'no meaningful deviation', fingerprint: fp };
}
export function nightlyRollup(state, date = localDate(new Date(Date.now() - 86400000).toISOString(), state.profile.timezone)) {
  const record = deriveDailyState(state, date); recalculateBaselines(state);
  let evaluated = 0;
  for (const i of state.interventions || []) {
    if (!i.outcomeStatus || i.outcomeStatus === 'pending') { i.outcomeStatus = 'insufficient_evidence'; i.outcome = i.outcome && !/pending/i.test(i.outcome) ? i.outcome : 'Observed after intervention: recorded for the day; evidence is insufficient for a stronger claim.'; evaluated++; }
  }
  const last7 = (state.dailyHistory || []).slice(-7);
  state.trends = { labels: last7.map(d => d.date.slice(5)), recoveryConsistency: last7.map(d => d.recovery ?? 0), priorityCompletion: last7.map(() => 0), focusProtection: last7.map(() => 0) };
  return { date, record, interventionsEvaluated: evaluated, baselines: state.baselineMeta };
}
export function weeklySummary(state) {
  const days = (state.dailyHistory || []).slice(-7);
  if (days.length < 3) { state.weeklySummary = ''; return { generated: false, reason: 'needs at least 3 recorded days' }; }
  const withSleep = days.filter(d => d.sleepMinutes != null);
  const avgSleep = withSleep.length ? Math.round(withSleep.reduce((a, d) => a + d.sleepMinutes, 0) / withSleep.length) : null;
  const short = days.filter(d => d.shortNight).length;
  const text = `Over the last ${days.length} recorded days, average sleep was ${avgSleep == null ? 'not recorded' : `${Math.floor(avgSleep / 60)}h ${String(avgSleep % 60).padStart(2, '0')}m`} with ${short} short night${short === 1 ? '' : 's'}. ${short >= 2 ? 'Shorter sleep coincided with lower morning readiness on those days.' : 'Sleep stayed close to baseline.'} Recorded from your connected data; associations only, not proven causation.`;
  state.weeklySummary = text;
  state.insights ||= []; state.insights.unshift({ type: 'weekly_summary', headline: 'Your week in review', body: text, at: new Date().toISOString() });
  return { generated: true, text };
}
export function morningJob(state, orchestrateFn) {
  assembleDailyPlan(state); recalculateBaselines(state);
  const decision = shouldOrchestrate(state, 'morning_plan', state.lastOrchestration || {});
  if (decision.run && orchestrateFn) { orchestrateFn(state); state.lastOrchestration = { fingerprint: decision.fingerprint, at: Date.now(), trigger: 'morning_plan' }; }
  return { planItems: state.plan.length, orchestrated: decision.run, reason: decision.reason };
}

/** Which users are due for a job, by their own timezone/wake time. The host
 * scheduler calls this (via the admin-gated endpoint); a user is due in the
 * 90 minutes after their local wake time (morning), at 23:30 local (nightly),
 * or Sunday in that window (weekly). job_runs uniqueness makes it idempotent. */
export function usersDueForJob(profiles, job, now = new Date(), completedKeys = new Set()) {
  const due = [];
  for (const p of profiles || []) {
    const tz = p.timezone || 'Europe/London'; let parts;
    try { parts = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', weekday: 'short', hour12: false }).formatToParts(now); } catch { continue; }
    const get = (k) => parts.find(x => x.type === k)?.value; const mins = Number(get('hour')) * 60 + Number(get('minute'));
    const [wh, wm] = String(p.wake_time || '06:30').split(':').map(Number); const wake = wh * 60 + (wm || 0);
    const localDateStr = (() => { try { return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(now); } catch { return now.toISOString().slice(0, 10); } })();
    let isDue = false;
    if (job === 'morning') isDue = mins >= wake && mins < wake + 90;
    else if (job === 'nightly') isDue = mins >= 23 * 60 + 30 || mins < 30;
    else if (job === 'weekly') isDue = get('weekday') === 'Sun' && mins >= wake && mins < wake + 90;
    const key = `${p.user_id}:${job}:${localDateStr}`;
    if (isDue && !completedKeys.has(key)) due.push({ user_id: p.user_id, localDate: localDateStr, idempotencyKey: key });
  }
  return due;
}
export const jobIdempotencyKey = (userId, job, localDate) => `${userId}:${job}:${localDate}`;
