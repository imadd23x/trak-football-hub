import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
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
  it('runs checks on task branches', () => {
    expect(workflow.on.push.branches).toEqual(expect.arrayContaining(['parent/**', 'shared/**']))
    expect(workflow.jobs.test.steps.find((step: { name: string }) => step.name === 'Install dependencies').run).toBe('npm ci --legacy-peer-deps')
  })
  it.each([
    ['push', 'refs/heads/main', 'max', false],
    ['push', 'refs/heads/shared/release-checks', 'max', false],
    ['pull_request', 'refs/pull/25/merge', 'single', true],
  ])('resolves the queue and cancellation policy for %s %s', (event, ref, queue, cancel) => {
    // This is a contract check of the actual YAML expressions, not a mock of
    // GitHub's scheduler. Hosted scheduling evidence is recorded separately.
    const github = { event_name: event, ref, workflow: 'CI' }
    const evaluate = (value: unknown): unknown => {
      if (typeof value !== 'string' || !value.startsWith('${{')) return value
      return new Function('github', `return (${value.slice(3, -2)})`)(github)
    }
    expect(evaluate(workflow.concurrency.queue ?? 'single')).toBe(queue)
    expect(evaluate(workflow.concurrency['cancel-in-progress'])).toBe(cancel)
    expect(workflow.concurrency.group).toBe('${{ github.workflow }}-${{ github.ref }}')
  })
})
