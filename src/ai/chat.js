// Ask Glyth routing: questions are answered by the LLM (Meta) over the
// compiled context — that is the product. Deterministic code has exactly
// two jobs left: (1) plan mutations, which only ever happen through typed,
// confirmed proposals (the LLM explains, it never applies), and (2) safety
// validation of what comes back. If the LLM is not configured or the call
// fails, the user is told so in the chat — a canned local answer is never
// passed off as the assistant.
import * as E from '../domain/engine.js';
import * as FAM from '../family/family.js';
import * as FIT from '../fitness/fitness.js';
import * as MIND from '../mindfulness/mindfulness.js';
const MUTATION_RE = /(keep|restore).*(workout|training|train)|(move|defer|shift).*(admin|meeting|session|workout)/i;
export function isMutationIntent(message) { return MUTATION_RE.test(String(message || '')); }

function familyContext(state) {
  try {
    const f = FAM.ensureFamily(state); if (!f.members.length) return null;
    const upcoming = FAM.upcomingDates(state, 90);
    return f.members.map(m => { const last = FAM.lastContactFor(state, m); return { name: m.display_name, relationship: m.relationship_type, birthday: m.birthday || null, notes: m.notes || null, preferences: f.preferences.filter(p => p.family_member_id === m.id).map(p => p.value), days_since_contact: last ? FAM.daysSince(last.at) : null, upcoming_dates: upcoming.filter(d => d.family_member_id === m.id).map(d => ({ title: d.title, date: d.next_date, days_until: d.days_until })) }; });
  } catch { return null; }
}
function fitnessContext(state) { try { const s = FIT.weeklyStats(state); const sess = state.fitness?.sessions?.[0]; return { sessions_this_week: s.sessionsThisWeek, target_per_week: s.targetPerWeek, weekly_load: s.weeklyLoadLabel, latest_session: sess ? { title: sess.title, status: sess.status } : null }; } catch { return null; } }
function mindfulnessContext(state) { try { const s = MIND.weeklyStats(state); return { sessions_this_week: s.sessionsThisWeek, minutes_this_week: s.minutesThisWeek }; } catch { return null; } }

export function buildChatMessages(state, message) {
  return [
    { role: 'system', content: 'You are Glyth, a personal daily-planning assistant. Answer ONLY from the JSON context provided. Be concise, specific and warm. Use the family, fitness and mindfulness context when the question touches those areas. Never claim you have changed the plan, booked anything, or contacted anyone. Never mention JSON field names, keys, internal identifiers or the word null — refer to everything in plain everyday language (say "your schedule today", not a field name). Keep formatting light: short paragraphs, bold sparingly, dash lists only when listing. If the user asks to change their plan, explain what you would propose and tell them to phrase it as a direct instruction (for example "keep my workout" or "move admin to tomorrow") so it can be confirmed. Do not invent health data, meetings, people or metrics that are not in the context.' },
    { role: 'user', content: JSON.stringify({ question: message, context: E.compileContext(state), family: familyContext(state), fitness: fitnessContext(state), mindfulness: mindfulnessContext(state), last_reasoning: state.lastReasoning, insight: state.insight, focus_priorities: state.focusPriorities }) },
  ];
}
// Normalise a model reply for a human reader: internal identifiers become
// plain language and tech phrasing is smoothed out, whatever the model sent.
const FIELD_LABELS = { today_schedule: "today's schedule", calendar_summary: 'your calendar', recent_interventions: 'recent changes I made', important_recent_signals: 'recent signals', last_reasoning: 'my last reasoning pass', current_state: 'your current state', baselines: 'your baselines', focus_priorities: 'your focus priorities', active_goals: 'your active goals', user_profile: 'your profile', data_freshness: 'data freshness', training_summary: 'your training', context_version: 'context' };
const humaniseField = (name) => FIELD_LABELS[name] || name.replace(/_/g, ' ');
export function normaliseChatText(text) {
  let t = String(text || '');
  t = t.replace(/`([a-z][a-z0-9_]*)`/g, (m, name) => humaniseField(name)); // `today_schedule` -> today's schedule
  t = t.replace(/\b([a-z][a-z0-9]*_[a-z0-9_]+)\b/g, (m, name) => humaniseField(name)); // bare snake_case too
  t = t.replace(/\bis null\b/g, 'has not been recorded').replace(/\bnull\b/g, 'not recorded');
  t = t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return t.trim().slice(0, 2000);
}
let chatSeq = 0;
const pushPair = (state, message, text, source, extra = {}) => { state.conversation.push({ id: `msg_chat_${++chatSeq}_${Date.now()}`, role: 'user', text: message, proposal: null }); state.conversation.push({ id: `msg_chat_${++chatSeq}_${Date.now()}`, role: 'glyth', text, proposal: null, source, ...extra }); };

export async function answerAsk({ state, message, provider }) {
  if (isMutationIntent(message)) {
    E.askGlyth(state, message);
    const last = state.conversation.at(-1); if (last) last.source = 'deterministic-proposal';
    return { source: 'deterministic-proposal' };
  }
  if (!provider?.configured || typeof provider.chat !== 'function') {
    const error = 'MODEL_API_KEY is not configured on the server';
    pushPair(state, message, `I can't answer that yet — the AI model isn't connected on this server (${error}). Add MODEL_API_KEY to the server's .env and restart it, then ask me again.`, 'llm-unavailable');
    return { source: 'llm-unavailable', error };
  }
  const started = Date.now();
  try {
    const text = await provider.chat(buildChatMessages(state, message));
    if (!String(text || '').trim()) throw new Error('the model returned an empty response');
    pushPair(state, message, normaliseChatText(text), 'meta', { model: provider.model || null });
    return { source: 'meta', latencyMs: Date.now() - started, model: provider.model };
  } catch (e) {
    const error = String(e?.message || e).slice(0, 200);
    pushPair(state, message, `I couldn't reach the AI model just now (${error}). Nothing was answered locally instead — check the server key/model and try again.`, 'llm-unavailable');
    return { source: 'llm-unavailable', latencyMs: Date.now() - started, error };
  }
}
