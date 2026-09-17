import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

const workflow = parse(readFileSync('.github/workflows/ci.yml', 'utf8'))
const upstream = 'kostasanastasioubusiness-lang/trak-football-hub'
const fork = 'imadd23x/trak-football-hub'
interface Scenario {
  repository?: string
  event?: string
  ref?: string
  headRepository?: string
  tests?: string
  backend?: string
  credentials?: string
}
function permits(job: string, scenario: Scenario = {}) {
  const github = {
    repository: scenario.repository ?? upstream,
    event_name: scenario.event ?? 'push',
    ref: scenario.ref ?? 'refs/heads/main',
    event: { pull_request: { head: { repo: { full_name: scenario.headRepository ?? upstream } } } },
  }
  const needs = {
    test: { result: scenario.tests ?? 'success' },
    supabase: { result: scenario.backend ?? 'success' },
    'vercel-credentials': { outputs: { configured: scenario.credentials ?? 'true' } },
  }
  // Evaluate the actual checked-in GitHub expression, not a duplicate gate.
  const expression = workflow.jobs[job].if.replaceAll('needs.vercel-credentials', "needs['vercel-credentials']")
  return new Function('github', 'needs', 'always', `return (${expression})`)(github, needs, () => true)
}
describe('release workflow regression gates', () => {
  it.each(['vercel-credentials', 'supabase', 'deploy'])('never runs %s from fork main even with credentials', job => {
    expect(permits(job, { repository: fork })).toBe(false)
  })
  it('deploys upstream main only after successful tests and backend', () => {
    expect(permits('deploy')).toBe(true)
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(permits('deploy', { tests: result })).toBe(false)
      expect(permits('deploy', { backend: result })).toBe(false)
    }
    expect(permits('deploy', { credentials: 'false' })).toBe(false)
    expect(workflow.jobs.supabase.needs).toEqual(expect.arrayContaining(['test', 'vercel-credentials']))
  })
  it('allows an upstream preview but blocks a fork PR preview and every PR database write', () => {
    const pr = { event: 'pull_request', ref: 'refs/pull/25/merge', backend: 'skipped' }
    expect(permits('deploy', pr)).toBe(true)
    expect(permits('deploy', { ...pr, headRepository: fork })).toBe(false)
    expect(permits('supabase', pr)).toBe(false)
  })
  it('runs checks on task branches and never cancels a main release', () => {
    expect(workflow.on.push.branches).toEqual(expect.arrayContaining(['parent/**', 'shared/**']))
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}")
    expect(workflow.jobs.test.steps.find((step: { name: string }) => step.name === 'Install dependencies').run).toBe('npm ci --legacy-peer-deps')
  })
})
