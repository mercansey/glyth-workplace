// Startup environment validation. Pure and testable: the server fails
// clearly on unsafe configuration instead of silently falling back.
export function validateEnv(env = process.env) {
  const errors = [], warnings = [];
  const demoRaw = String(env.DEMO_MODE ?? 'true').toLowerCase();
  if (!['true', 'false'].includes(demoRaw)) errors.push('DEMO_MODE must be "true" or "false"');
  const demo = demoRaw !== 'false';
  const port = Number(env.PORT || 3000);
  if (!Number.isInteger(port) || port < 1 || port > 65535) errors.push('PORT must be an integer between 1 and 65535');
  const urlOk = (v) => { try { const u = new URL(v); return ['http:', 'https:'].includes(u.protocol); } catch { return false; } };
  for (const k of ['USER_SUPABASE_URL', 'SYSTEM_SUPABASE_URL', 'META_API_BASE_URL']) if (env[k] && !urlOk(env[k])) errors.push(`${k} must be a valid http(s) URL`);
  for (const p of ['USER', 'SYSTEM']) {
    const hasUrl = Boolean(env[`${p}_SUPABASE_URL`]), hasService = Boolean(env[`${p}_SUPABASE_SERVICE_KEY`] || env[`${p}_SUPABASE_SERVICE_ROLE_KEY`]);
    if (hasUrl !== hasService) warnings.push(`${p}_SUPABASE_URL and ${p}_SUPABASE_SERVICE_KEY should be set together for live bridge sync`);
  }
  if (!demo && !(env.USER_SUPABASE_URL && env.USER_SUPABASE_ANON_KEY)) errors.push('DEMO_MODE=false requires USER_SUPABASE_URL and USER_SUPABASE_ANON_KEY so authenticated access can be verified');
  if (env.MODEL_API_KEY && !String(env.META_MODEL || 'muse-spark-1.1').trim()) errors.push('META_MODEL must be set when MODEL_API_KEY is configured');
  return { ok: errors.length === 0, errors, warnings, demo, port };
}
