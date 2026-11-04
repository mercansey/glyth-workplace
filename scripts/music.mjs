// Glyth Workplace demo — background music (Eleven Music). Zero dependencies, Node ≥ 20.
//   node scripts/music.mjs           3-minute instrumental, sections aligned to the video's acts
//   node scripts/music.mjs --take2   another take, saved alongside the first
// Uses ELEVENLABS_API_KEY from .env (asks for it if missing). Output: demo-video/music/music-3min.mp3
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';

process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..')); // always run from project root
const args = process.argv.slice(2);

// ---------- .env helpers ----------
const readEnv = () => { const e = {}; if (existsSync('.env')) for (const l of readFileSync('.env', 'utf8').split('\n')) { const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/); if (m) e[m[1]] = m[2].replace(/^['"]|['"]$/g, ''); } return e; };
const saveEnv = (k, v) => { const lines = existsSync('.env') ? readFileSync('.env', 'utf8').split('\n').filter((l, i, a) => !(i === a.length - 1 && l === '')) : []; let found = false; const out = lines.map(l => l.startsWith(k + '=') ? (found = true, `${k}=${v}`) : l); if (!found) out.push(`${k}=${v}`); writeFileSync('.env', out.join('\n') + '\n'); };
const env = { ...readEnv(), ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith('ELEVENLABS_'))) };

// ---------- prompts ----------
const ask = async (q) => { const rl = createInterface({ input: process.stdin, output: process.stdout }); const a = await rl.question(q); rl.close(); return a.trim(); };
const askHidden = (q) => new Promise((res) => {
  process.stdout.write(q); const s = process.stdin; let v = '';
  if (!s.isTTY) { s.once('data', d => res(String(d).trim())); return; }
  s.setRawMode(true); s.resume(); s.setEncoding('utf8');
  const on = (c) => { for (const ch of c) {
    if (ch === '\r' || ch === '\n') { s.setRawMode(false); s.pause(); s.off('data', on); process.stdout.write('\n'); return res(v.trim()); }
    if (ch === '\u0003') { process.stdout.write('\n'); process.exit(130); }
    if (ch === '\u007f') { if (v) { v = v.slice(0, -1); process.stdout.write('\b \b'); } } else { v += ch; process.stdout.write('•'); }
  } };
  s.on('data', on);
});

// ---------- API ----------
let KEY = args.includes('--reset-key') ? '' : env.ELEVENLABS_API_KEY;
const api = (path, init = {}) => fetch(`https://api.elevenlabs.io${path}`, { ...init, headers: { 'xi-api-key': KEY, ...(init.headers || {}) } });
const getVoices = async () => { try { const r = await api('/v1/voices'); return r.ok ? (await r.json()).voices : null; } catch (e) { console.error(`Couldn't reach ElevenLabs (${e.cause?.code || e.message}). Check your internet connection.`); process.exit(1); } };

// 1) key
let voices = null;
if (KEY) voices = await getVoices();
while (!voices) {
  if (KEY) console.log('That key didn’t work with ElevenLabs. Try again.');
  else console.log('No ElevenLabs API key found. It will be saved to .env (gitignored) so you only do this once.');
  KEY = await askHidden('Paste your ElevenLabs API key: ');
  if (!KEY) { console.log('No key entered — stopping.'); process.exit(1); }
  voices = await getVoices();
  if (voices) { saveEnv('ELEVENLABS_API_KEY', KEY); console.log('✓ Key works and is saved to .env'); }
}

// ---------- compose ----------
  const sections = [ // name, ms, styles  (totals 180 000 ms = the video length)
    ['Intro – the average day',   15400, ['sparse felt piano motif', 'curious', 'soft pulse', 'lots of space']],
    ['Meet Glyth – for employees',16600, ['warm soft synth pads enter', 'gentle rhythmic plucks', 'optimistic']],
    ['Then life happens',         15000, ['filtered and minimal', 'slight tension', 'held low pad', 'piano drops out']],
    ['Glyth re-plans the day',    23000, ['resolves to major', 'light electronic percussion', 'steady and reassuring']],
    ['Trust and control',         18000, ['calm', 'sparse piano and pads', 'reassuring', 'soft dynamics']],
    ['The whole person',          30600, ['warmer and fuller', 'uplifting', 'subtle bass', 'gentle momentum']],
    ['For employers',             49400, ['confident and modern', 'steady rhythm', 'clean plucks', 'building gradually']],
    ['Close – healthier people, better work', 12000, ['gentle lift', 'final warm chord', 'resolve and soft fade out']],
  ];
  const global = ['modern workplace wellness brand music', 'minimal', 'warm', 'uplifting', 'felt piano', 'soft synth pads', 'clean modern mix', 'around 90 BPM', 'background music that leaves space for a voiceover'];
  const negative = ['vocals', 'lyrics', 'choir', 'heavy drums', 'aggressive', 'epic orchestral', 'distorted guitar', 'dubstep', 'cheesy corporate ukulele'];
  const plan = { positive_global_styles: global, negative_global_styles: negative,
    sections: sections.map(([section_name, duration_ms, positive_local_styles]) => ({ section_name, duration_ms, positive_local_styles, negative_local_styles: ['vocals'], lines: [] })) };
  const prompt = `Instrumental only, exactly 3 minutes. ${global.join(', ')}. No ${negative.join(', no ')}. Structure: ` +
    sections.map(([n, ms, st]) => `${n} (${Math.round(ms / 1000)}s): ${st.join(', ')}`).join('; ') + '.';
  mkdirSync('demo-video/music', { recursive: true });
  const call = async (body) => api(`/v1/music?output_format=mp3_44100_128`, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' }, body: JSON.stringify(body) });
  console.log('Composing a 3-minute instrumental (this can take a minute or two)…');
  let r = await call({ composition_plan: plan, model_id: 'music_v2' });
  if (!r.ok) { const e = await r.text(); console.log(`Section plan not accepted (${r.status}) — retrying with a text prompt…\n  ${e.slice(0, 200)}`);
    r = await call({ prompt, music_length_ms: 180000, force_instrumental: true, model_id: 'music_v2' });
    if (!r.ok) { const e2 = await r.text(); if (/model/i.test(e2)) r = await call({ prompt, music_length_ms: 180000, force_instrumental: true }); else { console.error(`✗ Music failed: ${r.status} ${e2}`); process.exit(1); } }
    if (!r.ok) { console.error(`✗ Music failed: ${r.status} ${await r.text()}\n(If this mentions your plan, music may not be included in your ElevenLabs subscription.)`); process.exit(1); } }
  const out = `demo-video/music/music-3min${args.includes('--take2') ? '-take2' : ''}.mp3`;
  writeFileSync(out, Buffer.from(await r.arrayBuffer()));
  console.log(`✓ ${out}  (song id: ${r.headers.get('song-id') || 'n/a'})\nTell Claude the music is ready.`);
