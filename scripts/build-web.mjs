// Deterministic web bundle for Capacitor: packaged UI + remote HTTPS API.
// Usage: GLYTH_API_BASE=https://your-backend.example node scripts/build-web.mjs
import fs from 'node:fs'; import path from 'node:path';
const base = (process.env.GLYTH_API_BASE || '').replace(/\/$/, '');
fs.rmSync('www', { recursive: true, force: true }); fs.mkdirSync('www/src/domain', { recursive: true }); fs.mkdirSync('www/src/comms', { recursive: true }); fs.mkdirSync('www/src/native', { recursive: true }); fs.mkdirSync('www/src/mindfulness', { recursive: true }); fs.mkdirSync('www/src/fitness', { recursive: true });
for (const f of ['index.html', 'app.js', 'styles.css']) fs.copyFileSync(f, path.join('www', f));
for (const f of ['engine.js', 'types.js']) fs.copyFileSync(path.join('src/domain', f), path.join('www/src/domain', f));
fs.copyFileSync('src/comms/comms.js', 'www/src/comms/comms.js');
fs.copyFileSync('src/native/bridge.js', 'www/src/native/bridge.js');
fs.copyFileSync('src/mindfulness/mindfulness.js', 'www/src/mindfulness/mindfulness.js');
fs.copyFileSync('src/fitness/fitness.js', 'www/src/fitness/fitness.js');
if (fs.existsSync('assets')) fs.cpSync('assets', 'www/assets', { recursive: true });
let html = fs.readFileSync('www/index.html', 'utf8');
html = html.replace('<script type="module" src="app.js', `<script>window.GLYTH_API_BASE=${JSON.stringify(base)};</script><script type="module" src="app.js`);
fs.writeFileSync('www/index.html', html);
if (!base) console.warn('GLYTH_API_BASE not set: bundle expects same-origin /api (web deployment). For the iOS package set GLYTH_API_BASE to your HTTPS backend.');
console.log(`www built (API base: ${base || 'same-origin'})`);
