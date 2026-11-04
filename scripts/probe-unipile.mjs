// Discover the real V2 Unipile surface: accounts + any hosted/auth routes.
// Run: node scripts/probe-unipile.mjs   (reads .env; never prints the key)
try { process.loadEnvFile('.env'); } catch {}
const DSN = (process.env.UNIPILE_DSN || '').replace(/\/$/, '');
const KEY = process.env.UNIPILE_API_KEY || '';
if (!DSN || !KEY) { console.log('UNIPILE_DSN / UNIPILE_API_KEY missing'); process.exit(1); }
const get = async (path) => {
  try { const r = await fetch(`${DSN}${path}`, { headers: { 'X-API-KEY': KEY } });
    const text = await r.text();
    console.log(`\nGET ${path} -> HTTP ${r.status}`);
    console.log(text.slice(0, 1200));
  } catch (e) { console.log(`\nGET ${path} -> FAILED ${e.message}`); }
};
await get('/accounts');
try {
  const spec = await (await fetch(`${DSN}/openapi.json`, { headers: { 'X-API-KEY': KEY } })).json();
  const resolve = (obj) => { if (obj?.$ref) { const parts = obj.$ref.replace('#/', '').split('/'); let cur = spec; for (const k of parts) cur = cur?.[k]; return resolve(cur) || obj; } if (obj && typeof obj === 'object') { if (Array.isArray(obj)) return obj.map(resolve); return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolve(v)])); } return obj; };
  for (const pathName of ['/v2/auth/link', '/v2/auth/intent', '/v2/accounts/']) {
    const op = spec.paths?.[pathName];
    if (!op) { console.log(`\n${pathName}: not in spec`); continue; }
    console.log(`\n=== ${pathName} ===`);
    console.log(JSON.stringify(resolve(op), null, 1).slice(0, 3500));
  }
} catch (e) { console.log('spec dump failed:', e.message); }
for (const spec of ['/openapi.json', '/docs', '/swagger', '/openapi']) {
  try { const r = await fetch(`${DSN}${spec}`, { headers: { 'X-API-KEY': KEY } });
    if (!r.ok) { console.log(`\nGET ${spec} -> HTTP ${r.status}`); continue; }
    const text = await r.text();
    let paths = [];
    try { paths = Object.keys(JSON.parse(text).paths || {}); } catch { /* not JSON */ }
    const rel = paths.filter(p => /hosted|auth|link|account/i.test(p));
    console.log(`\nGET ${spec} -> HTTP ${r.status}, ${paths.length} paths. Relevant:`);
    console.log(rel.length ? rel.join('\n') : '(none matched — paste the first 1200 chars below)');
    if (!rel.length) console.log(text.slice(0, 1200));
    break;
  } catch (e) { console.log(`\nGET ${spec} -> FAILED ${e.message}`); }
}
