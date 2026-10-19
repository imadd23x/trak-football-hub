import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { findTestedMerge } from './merge-gate-evidence.mjs'

function fixture() {
  const repository = 'synthetic/trak'
  const sha = 'main-sha'
  const tree = 'tested-tree'
  const pr = { number: 12, merged_at: '2026-10-19', merge_commit_sha: sha, base: { ref: 'main' }, head: { sha: 'head-sha' } }
  const run = { id: 42, run_attempt: 2, event: 'pull_request', head_sha: pr.head.sha, repository: { full_name: repository }, path: '.github/workflows/ci.yml', html_url: 'https://github.com/synthetic/trak/actions/runs/42' }
  const job = { name: 'test', conclusion: 'success' }
  const artifact = { id: 7, name: 'merge-gate-proof-42-2', expired: false, size_in_bytes: 400 }
  const proof = { repository, pullRequest: 12, head: pr.head.sha, tree, runId: 42, attempt: 2 }
  const options = {
    repository, sha, tree,
    api: async path => {
      if (path.endsWith('/pulls')) return [pr]
      if (path.includes('/workflows/')) return { workflow_runs: [run] }
      if (path.includes('/jobs?')) { assert.match(path, /\/attempts\/2\/jobs/); return { jobs: [job] } }
      if (path.includes('/artifacts?')) return { artifacts: [artifact] }
      throw new Error('Unexpected GitHub request')
    },
    readProof: async () => proof,
  }
  return { options, pr, run, job, artifact, proof }
}

test('reuses a passed final PR for identical contents despite a different merge commit SHA', async () => {
  const f = fixture()
  assert.deepEqual(await findTestedMerge(f.options), { pr: 12, run: f.run.html_url })
})

for (const [name, alter] of [
  ['untested main contents', f => { f.options.tree = 'different-tree' }],
  ['failed tests', f => { f.job.conclusion = 'failure' }],
  ['skipped tests', f => { f.job.conclusion = 'skipped' }],
  ['old attempt evidence', f => { f.proof.attempt = 1 }],
  ['different PR', f => { f.proof.pullRequest = 99 }],
  ['different head', f => { f.proof.head = 'other-head' }],
  ['different run', f => { f.proof.runId = 99 }],
  ['fork run', f => { f.run.repository.full_name = 'someone/fork' }],
  ['branch push evidence', f => { f.run.event = 'push' }],
  ['wrong workflow', f => { f.run.path = '.github/workflows/other.yml' }],
  ['expired proof', f => { f.artifact.expired = true }],
  ['oversized proof', f => { f.artifact.size_in_bytes = 2_000_000 }],
  ['unmerged PR', f => { f.pr.merged_at = null }],
  ['wrong merge target', f => { f.pr.base.ref = 'develop' }],
  ['different merged commit', f => { f.pr.merge_commit_sha = 'other-main' }],
]) test(`blocks deployment with ${name}`, async () => {
  const f = fixture(); alter(f)
  await assert.rejects(findTestedMerge(f.options), /Deployment blocked/)
})

test('an API error blocks deployment rather than accepting absent evidence', async () => {
  const f = fixture(); f.options.api = async () => { throw new Error('GitHub unavailable') }
  await assert.rejects(findTestedMerge(f.options), /GitHub unavailable/)
})

for (const mode of ['clean', 'dirty', 'draft']) test(`records real checkout evidence: ${mode}`, t => {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-record-proof-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  writeFileSync(join(cwd, 'source.txt'), 'tested contents\n')
  git(['add', 'source.txt'])
  git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Synthetic candidate'])
  if (mode === 'dirty') writeFileSync(join(cwd, 'source.txt'), 'different test contents\n')
  const event = join(cwd, 'event.json')
  writeFileSync(event, JSON.stringify({ number: 12, pull_request: { draft: mode === 'draft', base: { ref: 'main' }, head: { sha: 'synthetic-head' } } }))
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./merge-gate-evidence.mjs', import.meta.url)), 'record'], {
    cwd, encoding: 'utf8', env: { ...process.env, GITHUB_EVENT_PATH: event, GITHUB_EVENT_NAME: 'pull_request', GITHUB_REPOSITORY: 'synthetic/trak', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', RUNNER_TEMP: cwd },
  })
  if (mode !== 'clean') { assert.notEqual(result.status, 0); return }
  assert.equal(result.status, 0, result.stderr)
  assert.deepEqual(JSON.parse(readFileSync(join(cwd, 'merge-gate-proof.json'), 'utf8')), {
    repository: 'synthetic/trak', pullRequest: 12, head: 'synthetic-head',
    tree: git(['rev-parse', 'HEAD^{tree}']).trim(), runId: 42, attempt: 2,
  })
})
