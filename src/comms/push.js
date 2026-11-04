// APNs sender — server-side only. Uses HTTP/2 + ES256 provider JWT signed
// with the .p8 key (APNS_KEY_PATH, APNS_KEY_ID, APNS_TEAM_ID, APNS_TOPIC).
// Without credentials it reports unconfigured honestly; it never fakes a send.
import fs from 'node:fs'; import http2 from 'node:http2'; import crypto from 'node:crypto';
const b64 = (o) => Buffer.from(typeof o === 'string' ? o : JSON.stringify(o)).toString('base64url');
export function apnsConfigured(env = process.env) { return Boolean(env.APNS_KEY_ID && env.APNS_TEAM_ID && env.APNS_KEY_PATH && env.APNS_TOPIC); }
export function apnsJwt(env = process.env) {
  const key = fs.readFileSync(env.APNS_KEY_PATH, 'utf8');
  const head = b64({ alg: 'ES256', kid: env.APNS_KEY_ID }); const body = b64({ iss: env.APNS_TEAM_ID, iat: Math.floor(Date.now() / 1000) });
  const sig = crypto.sign('sha256', Buffer.from(`${head}.${body}`), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  return `${head}.${body}.${sig}`;
}
export async function sendPush({ tokens = [], title, body, data = {} }, env = process.env) {
  if (!apnsConfigured(env)) return { configured: false, sent: 0 };
  const jwt = apnsJwt(env); const host = env.APNS_ENV === 'sandbox' ? 'https://api.sandbox.push.apple.com' : 'https://api.push.apple.com';
  let sent = 0;
  for (const token of tokens) {
    await new Promise((resolve) => {
      const client = http2.connect(host); const payload = JSON.stringify({ aps: { alert: { title, body }, sound: 'default' }, ...data });
      const req = client.request({ ':method': 'POST', ':path': `/3/device/${token}`, authorization: `bearer ${jwt}`, 'apns-topic': env.APNS_TOPIC, 'content-type': 'application/json' });
      req.on('response', (h) => { if (h[':status'] === 200) sent++; client.close(); resolve(); });
      req.on('error', () => { client.close(); resolve(); }); req.end(payload);
    });
  }
  return { configured: true, sent };
}
