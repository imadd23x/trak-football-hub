import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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
    // GitHub resolves absent event fields to empty values, rather than throwing
    // as JavaScript would on an undefined intermediate object.
    event: { pull_request: { head: { repo: {
      full_name: scenario.event === 'pull_request' ? scenario.headRepository ?? upstream : '',
    } } } },
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
    expect(permits('vercel-credentials', pr)).toBe(true)
    expect(permits('deploy', { ...pr, headRepository: fork })).toBe(false)
    expect(permits('vercel-credentials', { ...pr, headRepository: fork })).toBe(false)
    expect(permits('supabase', pr)).toBe(false)
    for (const result of ['failure', 'cancelled', 'skipped']) {
      expect(permits('deploy', { ...pr, tests: result })).toBe(false)
    }
    for (const result of ['failure', 'cancelled', 'success']) {
      expect(permits('deploy', { ...pr, backend: result })).toBe(false)
    }
    expect(permits('deploy', { ...pr, credentials: 'false' })).toBe(false)
  })
  it.each(['parent/invitations', 'shared/release-checks', 'develop'])(
    'runs no credential, backend or deployment job for an upstream %s push', branch => {
      const push = { ref: `refs/heads/${branch}`, backend: 'skipped' }
      for (const job of ['vercel-credentials', 'supabase', 'deploy']) {
        expect.soft(permits(job, push), job).toBe(false)
      }
    },
  )
  it.each(['workflow_dispatch', 'schedule', 'pull_request_target'])(
    'does not grant an undeclared %s event a deployment path', event => {
      for (const job of ['vercel-credentials', 'supabase', 'deploy']) {
        expect.soft(permits(job, { event }), job).toBe(false)
      }
    },
  )
  it.each([
    ['refs/heads/main', 'production', '--prod'],
    ['refs/pull/25/merge', 'preview', ''],
  ])('resolves %s to the intended Vercel target', (ref, target, flag) => {
    // Run only the actual local target-resolution shell step. No Vercel CLI,
    // inherited secrets, repository writes or network access are involved.
    const step = workflow.jobs.deploy.steps.find((entry: { id?: string }) => entry.id === 'target')
    const directory = mkdtempSync(join(tmpdir(), 'trak-vercel-target-'))
    const output = join(directory, 'output')
    try {
      execFileSync('/bin/bash', ['-e', '-c', step.run.replaceAll('${{ github.ref }}', ref)], {
        env: { PATH: '/usr/bin:/bin', GITHUB_OUTPUT: output, SCOPE: '', RAW_TOKEN: 'synthetic-token' },
      })
      const values = Object.fromEntries(readFileSync(output, 'utf8').trimEnd().split('\n').map(line => {
        const separator = line.indexOf('=')
        return [line.slice(0, separator), line.slice(separator + 1)]
      }))
      expect(values).toMatchObject({ env: target, flag })
    } finally {
      rmSync(directory, { recursive: true, force: true })
    }
  })
  it('runs checks on task branches and never cancels a main release', () => {
    expect(workflow.on.push.branches).toEqual(expect.arrayContaining(['parent/**', 'shared/**']))
    expect(workflow.concurrency['cancel-in-progress']).toBe("${{ github.event_name == 'pull_request' }}")
    expect(workflow.jobs.test.steps.find((step: { name: string }) => step.name === 'Install dependencies').run).toBe('npm ci --legacy-peer-deps')
  })
})
