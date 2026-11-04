// Unipile adapter — SERVER-SIDE ONLY. API key/DSN come from env and never
// reach the client.
// V2 (shared API, https://api.unipile.com/v2): hosted auth is a two-step
// flow — POST /scopes/ then POST /auth/link with lowercase providers and an
// account_scope_id (or account_id acc_... on reconnect, never both). All
// messaging reads/writes are account-scoped in the URL: /{acc_id}/chats...
// V1 (dedicated DSN, apiN.unipile.com:port): legacy hosted/accounts/link
// payload and ?account_id= query style. Set UNIPILE_API_VERSION=v1 there.
import crypto from 'node:crypto';
export const isValidUnipileAccountId = (id) => /^acc_[A-Za-z0-9_\-]+$/.test(String(id || ''));
export class UnipileClient {
  constructor({ apiKey, dsn, version, fetchImpl = fetch } = {}) {
    this.apiKey = apiKey || process.env.UNIPILE_API_KEY || '';
    this.dsn = (dsn || process.env.UNIPILE_DSN || '').replace(/\/$/, '');
    // Version resolution: explicit > env > inferred from DSN (generic
    // api.unipile.com/v2 is v2; a dedicated apiN host:port DSN is legacy v1).
    let inferred = 'v2'; try { const u = new URL(this.dsn); if (!/\/v\d+$/.test(u.pathname) && u.hostname !== 'api.unipile.com') inferred = 'v1'; } catch { /* keep v2 */ }
    this.version = String(version || process.env.UNIPILE_API_VERSION || inferred).toLowerCase(); this.fetchImpl = fetchImpl;
  }
  get configured() { return Boolean(this.apiKey && this.dsn); }
  get isV2() { return this.version === 'v2'; }
  basePath() { try { return /\/v\d+$/.test(new URL(this.dsn).pathname) ? '' : '/api/v1'; } catch { return '/api/v1'; } }
  async request(path, opts = {}) {
    if (!this.configured) throw Object.assign(new Error('Unipile is not configured on the server'), { status: 501 });
    const res = await this.fetchImpl(`${this.dsn}${this.basePath()}/${String(path).replace(/^\//, '')}`, { ...opts, headers: { 'X-API-KEY': this.apiKey, 'Content-Type': 'application/json', ...(opts.headers || {}) } });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const detail = String(data.message || data.detail || data.error || data.title || '');
      const hint = /account_id/.test(detail) ? 'The saved messaging account reference is invalid or expired — reconnect the account from Messages.' : /checkpoint|challenge/i.test(detail) ? 'The provider asked for an extra verification step — reconnect the account to complete it.' : '';
      throw Object.assign(new Error(hint || `Messaging provider request failed (HTTP ${res.status})${detail ? `: ${detail.slice(0, 160)}` : ''}`), { status: 502 }); }
    return data;
  }
  async hostedAuthLink({ userId, provider, successUrl, failureUrl, type = 'create', accountId = '' }) {
    const p = String(provider || '').toLowerCase();
    if (this.isV2) {
      const expires_on = new Date(Date.now() + 3600000).toISOString();
      if (type !== 'create') {
        if (!isValidUnipileAccountId(accountId)) throw Object.assign(new Error('Reconnect needs a connected Unipile account (acc_...). Connect the account first.'), { status: 400 });
        return this.request('auth/link', { method: 'POST', body: JSON.stringify({ account_id: accountId, expires_on, ...(successUrl ? { redirect_uri: successUrl } : {}) }) });
      }
      const scope = await this.request('scopes/', { method: 'POST', body: JSON.stringify({ name: 'Glyth messaging connection', reference: String(userId || 'glyth-user') }) });
      if (!scope?.id) throw Object.assign(new Error('Messaging provider did not return a connection scope — please try again.'), { status: 502 });
      const payload = { providers: [p], account_scope_id: scope.id, state: crypto.randomUUID(), expires_on,
        ...(p === 'linkedin' ? { config: { linkedin: { products: ['classic'], allow_product_selection: false } } } : {}),
        ...(successUrl ? { redirect_uri: successUrl } : {}) };
      return this.request('auth/link', { method: 'POST', body: JSON.stringify(payload) });
    }
    // V1 legacy flow
    const payload = { type, providers: [p.toUpperCase()], api_url: this.dsn, expiresOn: new Date(Date.now() + 3600000).toISOString(), name: userId,
      ...(type !== 'create' && isValidUnipileAccountId(accountId) ? { account_id: accountId } : {}),
      ...(successUrl ? { success_redirect_url: successUrl } : {}), ...(failureUrl ? { failure_redirect_url: failureUrl } : {}) };
    return this.request('hosted/accounts/link', { method: 'POST', body: JSON.stringify(payload) });
  }
  listAccounts() { return this.request('accounts'); }
  sendMessage({ chatId, accountId, text }) {
    if (this.isV2) { if (!isValidUnipileAccountId(accountId)) throw Object.assign(new Error('This messaging account needs to be reconnected before sending.'), { status: 400 }); return this.request(`${encodeURIComponent(accountId)}/chats/${encodeURIComponent(chatId)}/messages/send`, { method: 'POST', body: JSON.stringify({ text }) }); }
    return this.request(`chats/${encodeURIComponent(chatId)}/messages`, { method: 'POST', body: JSON.stringify({ account_id: accountId, text }) });
  }
  listChats(accountId, limit = 25) { const lim = Math.min(50, Math.max(1, limit));
    if (this.isV2) { if (!isValidUnipileAccountId(accountId)) throw Object.assign(new Error('This messaging account needs to be reconnected before syncing.'), { status: 400 }); return this.request(`${encodeURIComponent(accountId)}/chats?limit=${lim}`); }
    return this.request(`chats?account_id=${encodeURIComponent(accountId)}&limit=${lim}`); }
  listMessages(chatId, limit = 25, accountId = '') { const lim = Math.min(50, Math.max(1, limit));
    if (this.isV2) { const acc = accountId || ''; if (!isValidUnipileAccountId(acc)) throw Object.assign(new Error('This messaging account needs to be reconnected before syncing.'), { status: 400 }); return this.request(`${encodeURIComponent(acc)}/chats/${encodeURIComponent(chatId)}/messages?limit=${lim}`); }
    return this.request(`chats/${encodeURIComponent(chatId)}/messages?limit=${lim}`); }
}
export function verifyWebhook(req, secret = process.env.UNIPILE_WEBHOOK_SECRET || '') {
  if (!secret) return false; // in live mode an unconfigured webhook secret means reject, never trust
  return String(req.headers['x-unipile-secret'] || req.headers['x-webhook-secret'] || '') === secret;
}
