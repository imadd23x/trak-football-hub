// Executes the real entry module with a stub SDK and no network/filesystem inside
// the VM. A valid target stops exactly at createClient; no Auth action is run.
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { randomUUID } from 'node:crypto'

const input = JSON.parse(process.argv[2])
const password = randomUUID()
const fixtureEnv = {
  VITE_SUPABASE_URL: 'https://xbykbqolvqyqmipikuae.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'synthetic-legacy-key',
  TRAK_REHEARSAL_PASSWORD: password, TRAK_DEV_OLD_PASSWORD: password, TRAK_DEV_PASSWORD: password,
  ...input.env,
}
for (const key of input.unset ?? []) delete fixtureEnv[key]
const result = { clientCalls: 0, clientUrl: null, passwordReads: 0, envFileReads: 0, networkCalls: 0, exitCode: 0, error: null, logs: [], disclosedCredential: false }
const fakeProcess = {
  env: new Proxy(fixtureEnv, { get(target, key) { if (['TRAK_REHEARSAL_PASSWORD', 'TRAK_DEV_OLD_PASSWORD', 'TRAK_DEV_PASSWORD'].includes(key)) result.passwordReads++; return target[key] } }),
  argv: ['node', input.entry, ...(input.args ?? [])],
  get exitCode() { return result.exitCode }, set exitCode(value) { result.exitCode = value },
  exit(code) { result.exitCode = code; throw new Error(`EXIT ${code}`) },
}
const context = vm.createContext({
  process: fakeProcess, URL, Buffer, Date,
  console: { log: (...values) => result.logs.push(values.join(' ')), error: (...values) => result.logs.push(values.join(' ')) },
  fetch: () => { result.networkCalls++; throw new Error('NETWORK_FORBIDDEN') },
})
const cache = new Map()
async function load(path) {
  if (cache.has(path)) return cache.get(path)
  const module = new vm.SourceTextModule(readFileSync(path, 'utf8'), { context, identifier: pathToFileURL(path).href })
  cache.set(path, module)
  await module.link(async (specifier, parent) => {
    if (specifier === './scripts/testing/supabase-test-target.mjs') return load(resolve('scripts/testing/supabase-test-target.mjs'))
    if (specifier === '@supabase/supabase-js') return new vm.SyntheticModule(['createClient'], function () {
      this.setExport('createClient', url => { result.clientCalls++; result.clientUrl = url; throw new Error('CLIENT_BOUNDARY') })
    }, { context })
    if (specifier === 'node:fs') return new vm.SyntheticModule(['readFileSync'], function () {
      this.setExport('readFileSync', () => {
        result.envFileReads++
        return 'VITE_SUPABASE_URL=https://xbykbqolvqyqmipikuae.supabase.co\nVITE_SUPABASE_PUBLISHABLE_KEY=synthetic-legacy-key\n'
      })
    }, { context })
    throw new Error(`Unexpected import: ${specifier} from ${parent.identifier}`)
  })
  return module
}
try { await (await load(resolve(input.entry))).evaluate() }
catch (error) { result.error = error.message }
const credentialCanaries = [password, ...Object.entries(input.env ?? {}).filter(([name, value]) => name.endsWith('_KEY') && value).map(([, value]) => value)]
result.disclosedCredential = [result.error, ...result.logs].some(line => typeof line === 'string' && credentialCanaries.some(value => line.includes(value)))
console.log(JSON.stringify(result))
