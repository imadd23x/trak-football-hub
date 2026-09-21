/**
 * Explicit target selection for executable test/seed tools. No filesystem,
 * client construction or network access is permitted in this module.
 */
export const PRODUCTION_PROJECT_REF = 'xbykbqolvqyqmipikuae'
const productionUrl = `https://${PRODUCTION_PROJECT_REF}.supabase.co`
const testVariables = ['TRAK_TEST_PROJECT_REF', 'TRAK_TEST_SUPABASE_URL', 'TRAK_TEST_PUBLISHABLE_KEY']
const automationVariables = ['CI', 'CONTINUOUS_INTEGRATION', 'VITEST', 'VITEST_WORKER_ID', 'PLAYWRIGHT_TEST', 'TEST_WORKER_INDEX', 'NODE_TEST_CONTEXT']

function required(env, name) {
  const value = env[name]
  if (typeof value !== 'string' || !value || value !== value.trim()) throw new Error(`Set ${name} explicitly without surrounding whitespace`)
  return value
}

function publicKey(env, name, projectRef) {
  const value = required(env, name)
  if (/^sb_publishable_[A-Za-z0-9_-]+$/.test(value)) return value
  // Legacy anon keys are JWTs. This inspects their declared target and role;
  // cryptographic authenticity remains the hosted service's responsibility.
  try {
    const parts = value.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error()
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
    if (claims.role === 'anon' && claims.ref === projectRef) return value
  } catch { /* report a fixed message, never the provided credential */ }
  throw new Error(`${name} must be a publishable key or matching legacy anon key; secret/service-role keys are forbidden`)
}

/** Generic integration/test entrypoints must use this function, never the operator wrapper below. */
export function requireTestTarget(env) {
  const projectRef = required(env, 'TRAK_TEST_PROJECT_REF')
  if (!/^[a-z0-9]{20}$/.test(projectRef) || projectRef === PRODUCTION_PROJECT_REF) {
    throw new Error('TRAK_TEST_PROJECT_REF must name an explicitly approved non-production hosted test project')
  }
  const rawUrl = required(env, 'TRAK_TEST_SUPABASE_URL')
  let url
  try { url = new URL(rawUrl) } catch { throw new Error('TRAK_TEST_SUPABASE_URL is invalid') }
  const expected = `https://${projectRef}.supabase.co`
  if (![expected, `${expected}/`].includes(rawUrl) || url.origin !== expected || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') {
    throw new Error('TRAK_TEST_SUPABASE_URL must be the canonical HTTPS root matching TRAK_TEST_PROJECT_REF')
  }
  return { mode: 'test', projectRef, url: expected, key: publicKey(env, 'TRAK_TEST_PUBLISHABLE_KEY', projectRef) }
}

/** Only seed-pilot-rehearsal.mjs may use this explicit operator exception. */
export function requireRehearsalTarget(env, args) {
  if (args.length !== new Set(args).size || args.some(arg => arg !== '--purge' && arg !== `--production-rehearsal=${PRODUCTION_PROJECT_REF}`)) {
    throw new Error('Unsupported rehearsal arguments; production rehearsal requires its exact project reference in the explicit CLI flag')
  }
  if (!args.includes(`--production-rehearsal=${PRODUCTION_PROJECT_REF}`)) return requireTestTarget(env)
  // Presence is intentional: CI=false / VITEST=0 / empty markers still mean an
  // automation context. An ambient flag must never enable this operator path.
  if (automationVariables.some(name => env[name] !== undefined) || String(env.NODE_ENV ?? '').trim().toLowerCase() === 'test') {
    throw new Error('Production rehearsal mode is forbidden in automated test/CI contexts')
  }
  if (testVariables.some(name => env[name] !== undefined)) throw new Error('Production rehearsal mode cannot be combined with test-project configuration')
  return { mode: 'production-rehearsal', projectRef: PRODUCTION_PROJECT_REF, url: productionUrl, key: publicKey(env, 'TRAK_REHEARSAL_PUBLISHABLE_KEY', PRODUCTION_PROJECT_REF) }
}
