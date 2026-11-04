// Static file allowlist. The server must never serve .env, .git, source
// configuration, tests or server code — only the public app surface.
import path from 'node:path';
const ALLOWED_EXT = new Set(['.html', '.css', '.js', '.json', '.svg', '.png', '.ico', '.woff2', '.gif', '.mp3']);
const ALLOWED_TOP_FILES = new Set(['index.html', 'app.js', 'styles.css']);
export function resolveStaticPath(root, pathname) {
  let decoded; try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded === '/' || decoded === '/employer-dashboard' || decoded === '/employer-dashboard/') decoded = decoded === '/' ? '/index.html' : '/employer-dashboard/index.html';
  const parts = decoded.split('/').filter(Boolean);
  if (!parts.length || parts.some(p => p.startsWith('.') || p === '..')) return null;
  if (parts.length === 1 && !ALLOWED_TOP_FILES.has(parts[0])) return null;
  if (parts.length > 1 && !['src', 'data', 'employer-dashboard', 'assets'].includes(parts[0])) return null;
  if (!ALLOWED_EXT.has(path.extname(parts.at(-1)).toLowerCase())) return null;
  const fp = path.join(root, ...parts);
  if (fp !== root && !fp.startsWith(root + path.sep)) return null;
  return fp;
}
