// Glyth Workplace — cross-project bridge (pure, testable).
// USER project = personal context. SYSTEM project = workplace/system context.
// Only this bridge may move data between them, and only in these directions:
//   User -> System : consented, pseudonymised work-pattern contributions,
//                    released only as cohort aggregates of >= MIN_COHORT_SIZE.
//   System -> User : approved workplace directives + aggregate insights,
//                    plus acknowledgements/outcomes flowing back.
// NEVER crosses: sleep, health, recovery, energy, stress, goals, routines,
// conversations, support usage, names, emails, raw user_id. Server-side only.
import { createHash } from 'node:crypto';

export const WORK_PATTERN_CATEGORIES = ['workload','meeting_density','focus_fragmentation','engagement','capacity','schedule_density'];
export const FORBIDDEN_CATEGORIES = ['sleep','sleep_minutes','sleep_quality','health','medical','recovery','energy','stress','training_load','readiness','goals','personal_goals','routines','conversations','conversation','support','support_usage','ai_interaction','relationship','family','finance','mindfulness','hrv','resting_heart_rate','heart_rate','workout','workouts','fitness','calendar_title','calendar_event','message_body','message','messages','personal_finance','transactions','family_member','family_members'];
export const DIRECTIVE_TYPES = ['protect_focus','reduce_meetings','workplace_support','schedule_change','wellbeing_opportunity','announcement'];
export const MIN_COHORT_SIZE = Number(process.env.MIN_COHORT_SIZE || 5) || 5;

const sha = (s) => createHash('sha256').update(String(s)).digest('hex');

/** Stable pseudonym for a participant inside one org. Never reversible to user_id without the server-held salt, and the raw user_id never leaves the user project. */
export function participantAlias(userId, orgId, salt = process.env.BRIDGE_SALT || 'demo-bridge-salt-change-me') {
  if (!userId || !orgId) throw new Error('participantAlias requires userId and orgId');
  return `p_${sha(`${salt}:${orgId}:${userId}`).slice(0, 24)}`;
}

export function idempotencyKey(parts) { return sha(parts.map(x => String(x ?? '')).join(':')); }

/** Recursively reject payloads containing forbidden keys or raw identifiers. */
export function assertNoForbidden(value, path = '$') {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoForbidden(v, `${path}[${i}]`)); return true; }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      const key = k.toLowerCase();
      if (FORBIDDEN_CATEGORIES.includes(key) || key === 'user_id' || key === 'userid' || key === 'email' || key === 'name' || key === 'display_name')
        throw Object.assign(new Error(`bridge: forbidden field "${k}" at ${path}`), { status: 422 });
      assertNoForbidden(v, `${path}.${k}`);
    }
  }
  return true;
}

/**
 * Build one pseudonymised contribution per consented work-pattern category.
 * Forbidden / non-work-pattern signal keys are dropped and reported, never sent.
 */
export function buildContributions({ userId, orgId, teamId, signals = {}, consentedCategories = [], day, salt }) {
  if (!userId || !orgId || !teamId) throw Object.assign(new Error('bridge: userId, orgId and teamId are required'), { status: 400 });
  const alias = participantAlias(userId, orgId, salt);
  const consent = new Set(consentedCategories);
  const dropped = Object.keys(signals).filter(k => !WORK_PATTERN_CATEGORIES.includes(k));
  const contributions = [];
  for (const category of WORK_PATTERN_CATEGORIES) {
    if (!consent.has(category) || signals[category] == null) continue;
    const value = Number(signals[category]);
    if (!Number.isFinite(value)) continue;
    contributions.push({
      participant_alias: alias, org_id: orgId, team_id: teamId, category,
      value: Math.max(0, Math.min(100, Math.round(value))), day: day || new Date().toISOString().slice(0, 10),
      idempotency_key: idempotencyKey([alias, teamId, category, day || new Date().toISOString().slice(0, 10)]),
    });
  }
  contributions.forEach(c => assertNoForbidden(c));
  return { alias, contributions, dropped };
}

/** Privacy gate: average contributions per team+category, suppressing any cohort below minCohort distinct participants. */
export function gateCohorts(contributions, minCohort = MIN_COHORT_SIZE) {
  const groups = new Map();
  for (const c of contributions) {
    const key = `${c.team_id}:${c.category}`;
    if (!groups.has(key)) groups.set(key, { team_id: c.team_id, org_id: c.org_id, category: c.category, aliases: new Set(), values: [] });
    const g = groups.get(key); g.aliases.add(c.participant_alias); g.values.push(c.value);
  }
  return [...groups.values()].map(g => {
    const participantCount = g.aliases.size;
    const suppressed = participantCount < minCohort;
    return { org_id: g.org_id, team_id: g.team_id, category: g.category, participant_count: participantCount, suppressed,
      value: suppressed ? null : Math.round(g.values.reduce((a, b) => a + b, 0) / g.values.length),
      message: suppressed ? 'Not enough data to show this insight privately.' : null };
  });
}

/** Validate a System -> User workplace directive before it enters the user project inbox. */
export function buildDirectiveInboxItem(directive) {
  if (!directive || typeof directive !== 'object') throw Object.assign(new Error('bridge: directive must be an object'), { status: 400 });
  const { id, orgId, teamId = null, type, title, description = '', effectiveDay = null } = directive;
  if (!id || !orgId || !title) throw Object.assign(new Error('bridge: directive requires id, orgId and title'), { status: 400 });
  if (!DIRECTIVE_TYPES.includes(type)) throw Object.assign(new Error(`bridge: unsupported directive type "${type}"`), { status: 422 });
  const item = { source_id: String(id), org_id: orgId, team_id: teamId, type, title: String(title).slice(0, 200), description: String(description).slice(0, 1000), effective_day: effectiveDay,
    idempotency_key: idempotencyKey(['directive', orgId, id]), status: 'received' };
  assertNoForbidden(item);
  return item;
}

/** Validate an acknowledgement/outcome flowing User -> System (aggregate-safe fields only). */
export function buildOutcomeAck({ directiveSourceId, orgId, status, metric = null, result = null }) {
  if (!directiveSourceId || !orgId || !['acknowledged','applied','declined','completed'].includes(status))
    throw Object.assign(new Error('bridge: ack requires directiveSourceId, orgId and a valid status'), { status: 400 });
  const ack = { source_id: String(directiveSourceId), org_id: orgId, status, metric, result,
    idempotency_key: idempotencyKey(['ack', orgId, directiveSourceId, status]) };
  assertNoForbidden(ack);
  return ack;
}

/** Demo sync over the in-memory employer seed (used until real projects are configured). */
export function demoSync(employerState, { salt, day } = {}) {
  const all = [];
  for (const m of employerState.members || []) {
    const orgId = (employerState.teams.find(t => t.id === m.teamId) || {}).orgId || 'org_northstar';
    all.push(...buildContributions({ userId: m.id, orgId, teamId: m.teamId, signals: m.signals, consentedCategories: m.consentedCategories, day, salt }).contributions);
  }
  const aggregates = gateCohorts(all, employerState.minCohortSize ?? MIN_COHORT_SIZE);
  const directives = (employerState.interventions || []).filter(i => i.status === 'active' || i.status === 'proposed')
    .map(i => buildDirectiveInboxItem({ id: i.id, orgId: i.orgId, teamId: i.teamId, type: i.type, title: i.title, description: i.description }));
  return { contributions: all.length, released: aggregates.filter(a => !a.suppressed).length, suppressed: aggregates.filter(a => a.suppressed).length, aggregates, directives };
}
