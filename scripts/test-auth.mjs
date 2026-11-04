// Diagnose web/iOS login against YOUR running server.
// Usage: node scripts/test-auth.mjs   (prompts for email + hidden password)
import readline from 'node:readline';
const APP = process.env.APP_URL || 'http://127.0.0.1:3000';
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));
function askHidden(q) {
  return new Promise((resolve) => {
    process.stdout.write(q);
    const stdin = process.stdin; const wasRaw = stdin.isRaw; stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    let value = '';
    const onData = (ch) => {
      if (ch === '\n' || ch === '\r' || ch === '\u0004') { stdin.setRawMode(wasRaw); stdin.pause(); stdin.removeListener('data', onData); process.stdout.write('\n'); resolve(value); }
      else if (ch === '\u0003') { process.exit(1); }
      else if (ch === '\u007f') { value = value.slice(0, -1); }
      else value += ch;
    };
    stdin.on('data', onData);
  });
}
try {
  const cfgRes = await fetch(`${APP}/api/public-config`).catch(e => null);
  if (!cfgRes) { console.log(`SERVER UNREACHABLE at ${APP} — is Start-Glyth running?`); process.exit(1); }
  const cfg = await cfgRes.json();
  console.log(`Server reachable. Auth configured: ${cfg.authConfigured}  Supabase: ${cfg.supabaseUrl || 'none'}`);
  if (!cfg.authConfigured) { console.log('=> The running server process predates the config fix. Restart Start-Glyth and retry.'); process.exit(1); }
  const email = (await ask('Email: ')).trim();
  const wantSignup = process.argv.includes('--signup');
  const name = wantSignup ? (await ask('Full name (for signup): ')).trim() : '';
  rl.close();
  const password = await askHidden('Password (hidden): ');
  if (wantSignup) {
    const r = await fetch(`${APP}/api/auth/signup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password, name, timezone: 'Europe/London', wakeTime: '06:30' }) });
    const d = await r.json().catch(() => ({}));
    console.log(`signup: HTTP ${r.status} ${d.error ? 'error="' + d.error + '"' : d.pendingConfirmation ? 'pending="' + (d.message || '') + '"' : 'user=' + (d.user?.email || '?') + ' session=' + (d.session?.access_token ? 'issued' : 'none — check email to confirm, then sign in')}`);
    if (!r.ok) process.exit(1);
    console.log('Now run without --signup to test sign-in with the same details.');
    process.exit(0);
  }
  const mode = (await import('node:readline')).createInterface; // noop keep tree simple
  for (const flow of ['signin']) {
    const r = await fetch(`${APP}/api/auth/${flow}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const d = await r.json().catch(() => ({}));
    console.log(`${flow}: HTTP ${r.status} ${d.error ? 'error="' + d.error + '"' : 'user=' + (d.user?.email || '?') + ' session=' + (d.session?.access_token ? 'issued' : 'none')}`);
    if (r.status === 400 || r.status === 401) console.log('=> If you never completed Create account on THIS server (earlier attempts hit "not configured"), there is no hosted account yet — use Create account in the app first, confirm email if asked, then sign in.');
  }
} catch (e) { console.log('Diagnostic failed:', String(e.message || e)); process.exit(1); }
