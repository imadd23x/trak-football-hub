import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'

/**
 * Guards .github/workflows/merge-base.yml.
 *
 * #18, #19 and #20 were merged into base branches that had already been
 * merged to main, so their commits landed on branches no longer on the path
 * to main. GitHub showed all three as merged. The code was not in the
 * product and nothing reported it.
 *
 * ci.yml cannot catch this — it is `pull_request: branches: [main]`, so it
 * does not run for a pull request whose base is not main. Hence a separate
 * workflow, and hence this test: the value is entirely in the shell logic,
 * so it is executed rather than read, with git stubbed.
 */

const workflow = parse(readFileSync('.github/workflows/merge-base.yml', 'utf8'))

const step = workflow.jobs['base-reaches-main'].steps.find(
  (s: { name?: string }) => s.name === 'The base branch must still be on the path to main',
)

interface Scenario {
  /** The pull request's base branch. */
  base: string
  /** Whether origin/<base> still exists on the remote. */
  baseExists?: boolean
  /** Whether origin/<base> is already fully contained in main. */
  spent?: boolean
}

function run({ base, baseExists = true, spent = false }: Scenario) {
  // Stub git so the checked-in script runs unmodified against known ancestry.
  // No repository, network or real git is involved.
  // Note the ${} around base: a bare $base would be literal text in a JS
  // template string, the case patterns would never match, and every stubbed
  // git call would silently fall through to the default.
  const stub = `git() {
    case "$*" in
      "rev-parse --verify --quiet origin/${base}") return ${baseExists ? 0 : 1} ;;
      "merge-base --is-ancestor origin/${base} origin/main") return ${spent ? 0 : 1} ;;
    esac
    echo "unexpected git call: $*" >&2
    return 111
  }\n`
  const result = spawnSync('/bin/bash', ['--noprofile', '--norc', '-c', stub + step.run], {
    encoding: 'utf8',
    env: { PATH: '', BASE: base },
  })
  return { status: result.status, out: `${result.stdout}${result.stderr}` }
}

describe('merge-base guard', () => {
  it('runs for every base, not only main', () => {
    // The whole point: ci.yml restricts pull_request to base main, so it never
    // fires for the PRs that need this check.
    expect(workflow.on.pull_request.branches).toEqual(['**'])
  })

  it('passes quietly when the base is main', () => {
    const { status, out } = run({ base: 'main' })
    expect(status).toBe(0)
    expect(out).not.toContain('::error::')
    expect(out).not.toContain('::warning::')
  })

  it('fails when the base has already been merged into main', () => {
    // The #18/#19/#20 case exactly: merging would put commits on a spent
    // branch and GitHub would still report success.
    const { status, out } = run({ base: 'player/T1-match-dedupe', spent: true })
    expect(status).toBe(1)
    expect(out).toContain('::error::')
    expect(out).toContain('silently lost')
  })

  it('fails when the base branch no longer exists on the remote', () => {
    const { status, out } = run({ base: 'player/deleted-base', baseExists: false })
    expect(status).toBe(1)
    expect(out).toContain('::error::')
  })

  it('warns but allows a live stack whose base still has its own commits', () => {
    // Stacking is legitimate while the base is genuinely ahead of main; the
    // danger is only that nobody re-targets it. Warn, do not block.
    const { status, out } = run({ base: 'player/T7-failure-states', spent: false })
    expect(status).toBe(0)
    expect(out).toContain('::warning::')
    expect(out).toContain('Re-target')
  })
})
