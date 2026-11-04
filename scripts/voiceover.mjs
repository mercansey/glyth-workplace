// Glyth demo voiceover generator (ElevenLabs). Zero dependencies, Node ≥ 20.
// Just run:  node scripts/voiceover.mjs
//  • First run: asks for your ElevenLabs API key (hidden), checks it, saves it to .env (gitignored),
//    then lists your voices so you can pick one by number. Later runs skip straight to generating.
//  • Then asks which script to voice (30s test or full 3-min) unless you pass one:
//      node scripts/voiceover.mjs demo-video/vo-script-3min.json
//      node scripts/voiceover.mjs demo-video/vo-script-3min.json --only 4,7   (redo selected lines)
//      node scripts/voiceover.mjs --reset-key    (enter a new key)   --pick-voice   (choose another voice)
// Output: demo-video/vo/<script name>/line_NN.mp3 + lines.json (start times for the edit).
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

// 2) voice
let VOICE = args.includes('--pick-voice') ? '' : env.ELEVENLABS_VOICE_ID;
if (!VOICE || !voices.some(v => v.voice_id === VOICE)) {
  console.log('\nYour voices:');
  voices.forEach((v, i) => console.log(`  ${String(i + 1).padStart(2)}. ${v.name.padEnd(26)} ${Object.values(v.labels || {}).join(', ')}`));
  let pick;
  while (!pick) { const n = Number(await ask(`Pick a voice (1–${voices.length}): `)); pick = voices[n - 1]; }
  VOICE = pick.voice_id; saveEnv('ELEVENLABS_VOICE_ID', VOICE); console.log(`✓ Using "${pick.name}" (saved to .env)`);
} else console.log(`Using voice: ${voices.find(v => v.voice_id === VOICE).name}`);

// 3) script
let scriptPath = args.find(a => a.endsWith('.json'));
if (!scriptPath) {
  const c = await ask('\nWhich voiceover?  1) 30-second test   2) Full 3-minute   [1]: ');
  scriptPath = c === '2' ? 'demo-video/vo-script-3min.json' : 'demo-video/vo-script-30s.json';
}
const { lines: LINES } = JSON.parse(readFileSync(scriptPath, 'utf8'));
const oi = args.indexOf('--only');
const only = oi >= 0 ? new Set(args[oi + 1].split(',').map(Number)) : null;
const dir = `demo-video/vo/${basename(scriptPath, '.json')}`;
mkdirSync(dir, { recursive: true });
const MODEL = 'eleven_multilingual_v2';
console.log(`\nGenerating ${only ? only.size : LINES.length} line(s) → ${dir}`);

// 4) generate
for (const [i, l] of LINES.entries()) {
  const n = i + 1; if (only && !only.has(n)) continue;
  const file = `${dir}/line_${String(n).padStart(2, '0')}.mp3`;
  const r = await api(`/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
    body: JSON.stringify({
      text: l.text, model_id: MODEL,
      previous_text: LINES[i - 1]?.text, next_text: LINES[i + 1]?.text, // keeps delivery consistent line to line
      voice_settings: { stability: 0.5, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
    }),
  });
  if (!r.ok) { console.error(`✗ Line ${n} failed: ${r.status} ${await r.text()}`); process.exit(1); }
  writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  console.log(`✓ ${String(n).padStart(2)}  "${l.text.slice(0, 60)}${l.text.length > 60 ? '…' : ''}"`);
}
writeFileSync(`${dir}/lines.json`, JSON.stringify({ voice: VOICE, model: MODEL, script: scriptPath, lines: LINES.map((l, i) => ({ n: i + 1, file: `line_${String(i + 1).padStart(2, '0')}.mp3`, ...l })) }, null, 2));
console.log(`\nDone → ${dir}\nTell Claude the voiceover is ready.`);
