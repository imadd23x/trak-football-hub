import { execFileSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'

const productionRef = 'xbykbqolvqyqmipikuae'
const testRef = 'abcdefghijklmnopqrst' // Fixture only; never contacted.
const testUrl = `https://${testRef}.supabase.co`
const testEnv = { TRAK_TEST_PROJECT_REF: testRef, TRAK_TEST_SUPABASE_URL: testUrl, TRAK_TEST_PUBLISHABLE_KEY: 'sb_publishable_fixture_key' }
const productionFlag = `--production-rehearsal=${productionRef}`
const operatorEnv = { TRAK_REHEARSAL_PUBLISHABLE_KEY: 'sb_publishable_fixture_key' }
// Construct unsigned synthetic claims at runtime. No actual key is stored or sent.
const legacyKey = (role: string, ref: string) => [Buffer.from('{}').toString('base64url'), Buffer.from(JSON.stringify({ role, ref })).toString('base64url'), 'fixture'].join('.')
interface Result { clientCalls: number; clientUrl: string | null; passwordReads: number; envFileReads: number; networkCalls: number; exitCode: number; error: string | null; logs: string[]; disclosedCredential: boolean }
interface Options { env?: Record<string, string>; unset?: string[]; args?: string[] }
function run(entry: string, options: Options = {}): Result {
  return JSON.parse(execFileSync(process.execPath, ['--experimental-vm-modules', 'scripts/testing/test-target-entry.test-fixture.mjs', JSON.stringify({ entry, ...options })], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'pipe'] })) as Result
}
function expectDenied(result: Result) {
  expect(result.clientCalls, JSON.stringify(result)).toBe(0)
  expect(result.exitCode).toBe(1)
  expect(result.error).toBe('EXIT 1')
  expect(result.passwordReads).toBe(0)
  expect(result.envFileReads).toBe(0)
  expect(result.networkCalls).toBe(0)
  expect(result.disclosedCredential).toBe(false)
}
const denied: [string, Options][] = [
  ['ambient app production configuration', {}],
  ['production .env fallback', { unset: ['VITE_SUPABASE_URL', 'VITE_SUPABASE_PUBLISHABLE_KEY'] }],
  ['missing test reference', { env: { TRAK_TEST_SUPABASE_URL: testUrl, TRAK_TEST_PUBLISHABLE_KEY: testEnv.TRAK_TEST_PUBLISHABLE_KEY } }],
  ['missing test URL', { env: { TRAK_TEST_PROJECT_REF: testRef, TRAK_TEST_PUBLISHABLE_KEY: testEnv.TRAK_TEST_PUBLISHABLE_KEY } }],
  ['missing test key', { env: { TRAK_TEST_PROJECT_REF: testRef, TRAK_TEST_SUPABASE_URL: testUrl } }],
  ['whitespace-only project reference', { env: { ...testEnv, TRAK_TEST_PROJECT_REF: ' ' } }],
  ['known production target', { env: { ...testEnv, TRAK_TEST_PROJECT_REF: productionRef, TRAK_TEST_SUPABASE_URL: `https://${productionRef}.supabase.co` } }],
  ['mismatched project reference', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `https://${productionRef}.supabase.co` } }],
  ['malformed URL', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: 'not-a-url' } }],
  ['URL with credentials', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `https://operator:credential@${testRef}.supabase.co` } }],
  ['noncanonical hostname', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `https://${testRef}.supabase.co.invalid` } }],
  ['unexpected URL path', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}/auth/v1` } }],
  ['normalized-away URL path', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}/auth/..` } }],
  ['non-HTTPS URL', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: testUrl.replace('https:', 'http:') } }],
  ['URL with query', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}/?target=production` } }],
  ['URL with fragment', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}/#production` } }],
  ['URL with port', { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}:443` } }],
  ['secret key', { env: { ...testEnv, TRAK_TEST_PUBLISHABLE_KEY: 'sb_secret_fixture_canary' } }],
  ['legacy service-role key', { env: { ...testEnv, TRAK_TEST_PUBLISHABLE_KEY: legacyKey('service_role', testRef) } }],
  ['legacy anon key for production', { env: { ...testEnv, TRAK_TEST_PUBLISHABLE_KEY: legacyKey('anon', productionRef) } }],
  ['malformed key', { env: { ...testEnv, TRAK_TEST_PUBLISHABLE_KEY: 'not-a-key' } }],
  ['ambient production-rehearsal opt-in', { env: { ...operatorEnv, TRAK_PRODUCTION_REHEARSAL: productionRef } }],
]
for (const entry of ['seed-admin-data.mjs', 'seed-pilot-rehearsal.mjs']) describe(`${entry} target boundary`, () => {
  it.each(denied)('rejects %s before client, password or network', (_name, options) => {
    expectDenied(run(entry, options))
  })
  it('passes only an explicitly matched test target to the client', () => {
    const result = run(entry, { env: testEnv })
    expect(result.clientCalls, JSON.stringify(result)).toBe(1)
    expect(result.clientUrl).toBe(testUrl)
    expect(result.error).toBe('CLIENT_BOUNDARY')
    expect(result.networkCalls).toBe(0)
    expect(result.envFileReads).toBe(0)
  })
  it('accepts a matching legacy anon key and canonical trailing slash', () => {
    const result = run(entry, { env: { ...testEnv, TRAK_TEST_SUPABASE_URL: `${testUrl}/`, TRAK_TEST_PUBLISHABLE_KEY: legacyKey('anon', testRef) } })
    expect(result.clientCalls, JSON.stringify(result)).toBe(1)
    expect(result.clientUrl).toBe(testUrl)
    expect(result.error).toBe('CLIENT_BOUNDARY')
  })
  it('permits the explicitly matched test target in CI', () => {
    const result = run(entry, { env: { ...testEnv, CI: 'true' } })
    expect(result.clientCalls, JSON.stringify(result)).toBe(1)
    expect(result.clientUrl).toBe(testUrl)
    expect(result.error).toBe('CLIENT_BOUNDARY')
  })
})

describe('explicit production rehearsal operator mode', () => {
  it.each([
    ['publishable', operatorEnv],
    ['legacy anon', { TRAK_REHEARSAL_PUBLISHABLE_KEY: legacyKey('anon', productionRef) }],
  ])('preserves the operator path with a %s key, without executing it', (_name, env) => {
    const result = run('seed-pilot-rehearsal.mjs', { env, args: [productionFlag] })
    expect(result.clientCalls, JSON.stringify(result)).toBe(1)
    expect(result.clientUrl).toBe(`https://${productionRef}.supabase.co`)
    expect(result.error).toBe('CLIENT_BOUNDARY')
    expect(result.envFileReads).toBe(0)
    expect(result.networkCalls).toBe(0)
    expect(result.disclosedCredential).toBe(false)
  })
  const rejected: [string, Options][] = [
    ['no dedicated operator key', { args: [productionFlag] }],
    ['secret operator key', { env: { TRAK_REHEARSAL_PUBLISHABLE_KEY: 'sb_secret_fixture_canary' }, args: [productionFlag] }],
    ['service-role operator key', { env: { TRAK_REHEARSAL_PUBLISHABLE_KEY: legacyKey('service_role', productionRef) }, args: [productionFlag] }],
    ['wrong-target legacy operator key', { env: { TRAK_REHEARSAL_PUBLISHABLE_KEY: legacyKey('anon', testRef) }, args: [productionFlag] }],
    ['mixed test/operator configuration', { env: { ...testEnv, ...operatorEnv }, args: [productionFlag] }],
    ['empty test configuration still present', { env: { ...operatorEnv, TRAK_TEST_PROJECT_REF: '' }, args: [productionFlag] }],
    ['production opt-in without exact project reference', { env: operatorEnv, args: ['--production-rehearsal'] }],
    ['wrong project in operator flag', { env: operatorEnv, args: [`--production-rehearsal=${testRef}`] }],
    ['unknown argument', { env: testEnv, args: ['--force'] }],
    ['repeated argument', { env: operatorEnv, args: [productionFlag, productionFlag] }],
    ['purge with no explicit target', { args: ['--purge'] }],
    ['purge with production test target', { env: { ...testEnv, TRAK_TEST_PROJECT_REF: productionRef }, args: ['--purge'] }],
    ['NODE_ENV=test', { env: { ...operatorEnv, NODE_ENV: 'test' }, args: [productionFlag] }],
  ]
  it.each(rejected)('rejects %s before credentials/client/network', (_name, options) => {
    expectDenied(run('seed-pilot-rehearsal.mjs', options))
  })
  it.each(['CI', 'CONTINUOUS_INTEGRATION', 'VITEST', 'VITEST_WORKER_ID', 'PLAYWRIGHT_TEST', 'TEST_WORKER_INDEX', 'NODE_TEST_CONTEXT'])('rejects %s even when its value looks false', marker => {
    for (const value of ['false', '0', '']) expectDenied(run('seed-pilot-rehearsal.mjs', { env: { ...operatorEnv, [marker]: value }, args: [productionFlag] }))
  })
  it('does not offer the operator exception through the test-only admin entrypoint', () => {
    expectDenied(run('seed-admin-data.mjs', { env: operatorEnv, args: [productionFlag] }))
    expectDenied(run('seed-admin-data.mjs', { env: testEnv, args: [productionFlag] }))
  })
  it.each([
    ['test', testEnv, ['--purge'], testUrl],
    ['operator', operatorEnv, [productionFlag, '--purge'], `https://${productionRef}.supabase.co`],
  ])('resolves the same target for explicit %s purge without executing deletion', (_name, env, args, url) => {
    const result = run('seed-pilot-rehearsal.mjs', { env, args })
    expect(result.clientCalls, JSON.stringify(result)).toBe(1)
    expect(result.clientUrl).toBe(url)
    expect(result.error).toBe('CLIENT_BOUNDARY')
    expect(result.networkCalls).toBe(0)
  })
})
