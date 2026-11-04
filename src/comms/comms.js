// External communications (Instagram/LinkedIn/WhatsApp via Unipile).
// SEPARATE from Ask Glyth conversations. Canonical, idempotent, private:
// PRIVATE_CONVERSATION, never employer-aggregated, bodies never logged here.
export const COMM_PROVIDERS = ['instagram', 'linkedin', 'whatsapp'];
export function needsReplyFor(messages = []) {
  const sorted = [...messages].sort((a, b) => String(a.sent_at).localeCompare(String(b.sent_at)));
  const last = [...sorted].reverse().find(m => m.direction === 'inbound' || m.direction === 'outbound');
  return Boolean(last && last.direction === 'inbound');
}
export function normalizeUnipileMessage(payload = {}) {
  const msg = payload.message || payload.data || payload;
  const provider = String(msg.provider || payload.provider || '').toLowerCase();
  if (!COMM_PROVIDERS.includes(provider)) throw new Error(`unsupported communication provider "${provider}"`);
  const providerMessageId = String(msg.provider_message_id || msg.id || msg.message_id || '');
  if (!providerMessageId) throw new Error('message requires provider_message_id');
  const chatId = String(msg.chat_id || msg.thread_id || msg.conversation_id || '');
  if (!chatId) throw new Error('message requires chat_id');
  const ts = msg.sent_at || msg.timestamp || msg.created_at || new Date().toISOString();
  return {
    provider, provider_chat_id: chatId, provider_message_id: providerMessageId,
    direction: ['outbound', 'sent', 'out'].includes(String(msg.direction || '').toLowerCase()) ? 'outbound' : 'inbound',
    sender_name: msg.sender_name || msg.from_name || null, sender_provider_id: msg.sender_id || msg.from_id || null,
    body: typeof msg.body === 'string' ? msg.body.slice(0, 5000) : (msg.text || msg.caption || ''),
    caption: msg.caption || null, content_type: msg.content_type || msg.type || 'text',
    attachment_metadata: msg.attachment_metadata || (Array.isArray(msg.attachments) ? msg.attachments.map(a => ({ type: a.type || 'file' })) : []),
    sent_at: new Date(ts).toISOString(), original_url: msg.original_url || msg.url || null,
  };
}
/** Idempotent upsert: provider + provider_message_id is the stable key. */
export function upsertCommunicationMessage(store, userId, accountId, normalized) {
  store.threads ||= []; store.messages ||= [];
  const msgKey = `${normalized.provider}:${normalized.provider_message_id}`;
  let msg = store.messages.find(m => m._key === msgKey && m.user_id === userId);
  if (!msg) { msg = { id: `cm_${store.messages.length + 1}_${Math.random().toString(36).slice(2, 7)}`, _key: msgKey, user_id: userId, account_id: accountId, ...normalized }; store.messages.push(msg); }
  else Object.assign(msg, normalized);
  let thread = store.threads.find(t => t.provider_chat_id === normalized.provider_chat_id && t.user_id === userId);
  if (!thread) { thread = { id: `ct_${store.threads.length + 1}_${Math.random().toString(36).slice(2, 7)}`, user_id: userId, account_id: accountId, provider: normalized.provider, provider_chat_id: normalized.provider_chat_id, title: normalized.sender_name || normalized.provider, avatar_url: null, unread_count: 0, created_at: new Date().toISOString() }; store.threads.push(thread); }
  const threadMsgs = store.messages.filter(m => m.user_id === userId && m.provider_chat_id === normalized.provider_chat_id);
  const latest = [...threadMsgs].sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0];
  thread.last_message_at = latest?.sent_at || null; thread.last_message_preview = latest?.body?.slice(0, 120) || '';
  thread.last_inbound_at = [...threadMsgs].filter(m => m.direction === 'inbound').sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0]?.sent_at || null;
  thread.last_outbound_at = [...threadMsgs].filter(m => m.direction === 'outbound').sort((a, b) => String(b.sent_at).localeCompare(String(a.sent_at)))[0]?.sent_at || null;
  thread.needs_reply = needsReplyFor(threadMsgs); thread.updated_at = new Date().toISOString();
  return { message: msg, thread, deduplicated: store.messages.filter(m => m._key === msgKey).length === 1 };
}
/** Derived-only context for Meta: counts/backlog, never the whole inbox. */
export function communicationContext(store, userId) {
  const threads = (store.threads || []).filter(t => t.user_id === userId);
  return { unanswered_thread_count: threads.filter(t => t.needs_reply).length, needs_reply_threads: threads.filter(t => t.needs_reply).map(t => ({ thread_id: t.id, provider: t.provider, title: t.title, last_message_at: t.last_message_at })), communication_load: threads.length ? Math.min(100, threads.filter(t => t.needs_reply).length * 20) : 0, privacy_class: 'PRIVATE_CONVERSATION' };
}
export function parseDeepLink(url) {
  try { const u = new URL(url); const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0] === 'messages' && parts[1]) return { view: 'messages', threadId: parts[1] };
    if (parts[0] === 'today') return { view: 'today' }; if (parts[0] === 'insights') return { view: 'insights' };
    if (parts[0] === 'connect') return { view: 'connect', provider: parts[1] || null };
    return { view: 'today' };
  } catch { return { view: 'today' }; }
}
