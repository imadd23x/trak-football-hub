import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
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
  releaseEligible?: string | null
}
function permits(job: string, scenario: Scenario = {}) {
  const github = {
    repository: scenario.repository ?? upstream,
    event_name: scenario.event ?? 'push',
    ref: scenario.ref ?? 'refs/heads/main',
    event: { pull_request: { head: { repo: { full_name: scenario.headRepository ?? upstream } } } },
  }
  const needs = {
    test: { result: scenario.tests ?? 'success', outputs: { release_eligible: scenario.releaseEligible === undefined ? 'true' : scenario.releaseEligible } },
    supabase: { result: scenario.backend ?? 'success' },
    'vercel-credentials': { outputs: { configured: scenario.credentials ?? 'true' } },
  }
  // Evaluate the actual checked-in GitHub expression, not a duplicate gate.
  const expression = workflow.jobs[job].if.replaceAll('needs.vercel-credentials', "needs['vercel-credentials']")
  return new Function('github', 'needs', 'always', `return (${expression})`)(github, needs, () => true)
}
describe('release workflow regression gates', () => {
  it.each([0, 23])('previews pending migrations before applying and stops when preview exits %i', previewStatus => {
    const push = workflow.jobs.supabase.steps.find((step: { name: string }) => step.name === 'Push migrations').run
    // Execute the checked-in step under GitHub's fail-fast shell semantics.
    // The shell function captures CLI calls; no executable or database is used.
    const stub = `supabase() {
      printf '%s\\n' "$*"
      case "$*" in *--dry-run*) return ${previewStatus} ;; esac
      return 0
    }\n`
    const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-e', '-c', stub + push], {
      encoding: 'utf8', env: { PATH: '', DB_URL: 'postgresql://synthetic.invalid/rehearsal' },
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(previewStatus)
    const calls = result.stdout.trim().split('\n')
    expect(calls).toHaveLength(previewStatus ? 1 : 2)
    for (const call of calls) {
      expect(call).toContain('db push --db-url postgresql://synthetic.invalid/rehearsal')
      expect(call).toContain('--include-all')
    }
    expect(calls[0]).toContain('--dry-run')
    if (!previewStatus) expect(calls[1]).not.toContain('--dry-run')
  })

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
  it.each(['supabase', 'deploy'])('does not run %s for a superseded or unverified main release', job => {
    for (const releaseEligible of ['false', '', null]) expect(permits(job, { releaseEligible })).toBe(false)
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
