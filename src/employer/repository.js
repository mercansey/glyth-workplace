// Employer repository — SYSTEM project (service-role client, server-side
// only). The employer surface never receives individual rows: participants
// exist only as bridge-produced aggregates (team_signal_aggregates), which
// become the engine's precomputedAggregates. Mutable operational state
// (interventions, programmes, AI runs) round-trips to its tables.
export function actorForUser(state, userId) { return (state.actors || []).find(a => a.id === userId) || null; }

export function createEmployerRepository(client) {
  async function loadStateByOrgUuid(orgUuid) {
    const orgs = await client.select('organisations', `id=eq.${orgUuid}&limit=1`);
    const org = orgs?.[0]; if (!org) return null;
    const slug = org.slug;
    const [teams, goals, interventions, programmes, aggregates, aiRuns, memberships, teamMemberships] = await Promise.all([
      client.select('teams', `organisation_id=eq.${orgUuid}&order=name.asc`),
      client.select('organisation_goals', `organisation_id=eq.${orgUuid}&order=priority.asc`),
      client.select('employer_interventions', `organisation_id=eq.${orgUuid}&order=created_at.desc&limit=100`),
      client.select('employer_programmes', `org_id=eq.${slug}&limit=50`),
      client.select('team_signal_aggregates', `organisation_id=eq.${orgUuid}&order=created_at.desc&limit=500`),
      client.select('employer_ai_runs', `organisation_id=eq.${orgUuid}&order=created_at.desc&limit=20`),
      client.select('organisation_members', `organisation_id=eq.${orgUuid}&limit=500`),
      client.select('team_memberships', `limit=1000`),
    ]);
    const teamRows = teams || [];
    const precomputedAggregates = {}; const seenAgg = new Set();
    for (const row of aggregates || []) {
      const key = `${row.team_id}:${row.signal_type}`; if (seenAgg.has(key)) continue; seenAgg.add(key);
      precomputedAggregates[row.team_id] ||= { metrics: {} };
      precomputedAggregates[row.team_id].metrics[row.signal_type] = { suppressed: Boolean(row.suppressed), participantCount: row.participant_count ?? 0, value: row.suppressed ? null : (row.value == null ? null : Number(row.value)), baseline: row.baseline == null ? null : Number(row.baseline), changePercent: row.change_percent == null ? null : Number(row.change_percent), ...(row.suppressed ? { message: 'Not enough data to show this insight privately.' } : {}) };
    }
    const tmByUser = new Map();
    for (const tm of teamMemberships || []) { if (!tmByUser.has(tm.user_id)) tmByUser.set(tm.user_id, []); tmByUser.get(tm.user_id).push(tm.team_id); }
    return {
      version: 2, live: true, orgUuid, minCohortSize: 5,
      organisations: [{ id: slug, uuid: orgUuid, name: org.name, slug }],
      actors: (memberships || []).map(m => ({ id: m.user_id, orgId: slug, role: m.role, teamIds: tmByUser.get(m.user_id) || [], label: `${org.name} ${m.role}` })),
      teams: teamRows.map(t => ({ id: t.id, orgId: slug, name: t.name, description: t.description || '', status: 'stable' })),
      members: [], baselines: {}, precomputedAggregates, timeline: [],
      goals: (goals || []).map(g => ({ id: g.id, orgId: slug, title: g.title, category: g.category, priority: g.priority, target: g.target, currentValue: g.current_value == null ? null : Number(g.current_value), status: g.status })),
      interventions: (interventions || []).map(i => ({ id: i.id, orgId: slug, teamId: i.team_id, type: i.type, title: i.title, description: i.description, reason: i.reason, evidence: i.evidence || [], status: i.status, createdBy: 'glyth', createdAt: i.created_at, startedAt: i.started_at, completedAt: i.completed_at, expectedOutcome: i.expected_outcome, observedOutcome: i.observed_outcome || null })),
      programmes: (programmes || []).map(p => ({ id: p.id, orgId: slug, goalId: p.goal_id, teamIds: p.team_ids || [], title: p.title, description: p.description, status: p.status, progress: p.progress, target: p.target, interventionIds: p.intervention_ids || [] })),
      employerAiRuns: (aiRuns || []).map(r => ({ id: r.id, orgId: slug, provider: r.provider, model: r.model, latencyMs: r.latency_ms, validated: r.validated, fallback: r.fallback, at: r.created_at })),
      scenario: null,
    };
  }
  async function loadStateForUser(userId) {
    const memberships = await client.select('organisation_members', `user_id=eq.${userId}&limit=10`);
    if (!memberships?.length) return { state: null, actor: null };
    const state = await loadStateByOrgUuid(memberships[0].organisation_id);
    return { state, actor: state ? actorForUser(state, userId) : null };
  }
  async function saveState(state) {
    const orgUuid = state.orgUuid; if (!orgUuid) throw new Error('employer repository: orgUuid required');
    if (state.interventions?.length) await client.upsert('employer_interventions', state.interventions.map(i => ({ id: i.id, organisation_id: orgUuid, team_id: i.teamId || null, type: i.type || null, title: i.title, description: i.description || null, reason: i.reason || null, evidence: i.evidence || [], status: i.status, expected_outcome: i.expectedOutcome || null, observed_outcome: i.observedOutcome || null, started_at: i.startedAt && /^\d{4}-/.test(i.startedAt) ? i.startedAt : null, completed_at: i.completedAt && /^\d{4}-/.test(i.completedAt) ? i.completedAt : null })), 'id');
    if (state.programmes?.length) await client.upsert('employer_programmes', state.programmes.map(p => ({ id: p.id, org_id: state.organisations[0].id, goal_id: p.goalId || null, team_ids: p.teamIds || [], title: p.title, description: p.description || null, status: p.status, progress: p.progress ?? 0, target: p.target || null, intervention_ids: p.interventionIds || [] })), 'id');
    const newRuns = (state.employerAiRuns || []).filter(r => r._liveNew);
    for (const r of newRuns) { await client.insert('employer_ai_runs', [{ organisation_id: orgUuid, provider: r.provider || 'deterministic', model: r.model || null, latency_ms: r.latencyMs ?? null, validated: Boolean(r.validated), fallback: Boolean(r.fallback) }]); r._liveNew = false; }
    return { saved: true };
  }
  return { loadStateByOrgUuid, loadStateForUser, saveState };
}
