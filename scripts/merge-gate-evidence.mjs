import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const WORKFLOW = '.github/workflows/ci.yml'

// Main reuses a successful PR test job only when its recorded Git tree equals
// the contents being deployed. This works for merge, squash and rebase merges.
export async function findTestedMerge({ repository, sha, tree, api, readProof }) {
  const root = `/repos/${repository}`
  const prs = await api(`${root}/commits/${sha}/pulls`)
  for (const pr of prs.filter(p => p.merged_at && p.base.ref === 'main' && p.merge_commit_sha === sha)) {
    const { workflow_runs: runs } = await api(`${root}/actions/workflows/ci.yml/runs?event=pull_request&head_sha=${pr.head.sha}&per_page=100`)
    for (const run of runs) {
      if (run.event !== 'pull_request' || run.head_sha !== pr.head.sha ||
          run.repository.full_name !== repository || run.path.split('@')[0] !== WORKFLOW) continue
      const { jobs } = await api(`${root}/actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`)
      if (!jobs.some(job => job.name === 'test' && job.conclusion === 'success')) continue
      const { artifacts } = await api(`${root}/actions/runs/${run.id}/artifacts?per_page=100`)
      const artifact = artifacts.find(a => a.name === `merge-gate-proof-${run.id}-${run.run_attempt}` && !a.expired && a.size_in_bytes <= 1_000_000)
      if (!artifact) continue
      const proof = await readProof(`${root}/actions/artifacts/${artifact.id}/zip`)
      if (proof.repository === repository && proof.pullRequest === pr.number && proof.head === pr.head.sha &&
          proof.runId === run.id && proof.attempt === run.run_attempt && proof.tree === tree) return { pr: pr.number, run: run.html_url }
    }
  }
  throw new Error('Deployment blocked: no successful final PR merge-gate proof matches these exact contents. Rerun the final PR gate if its evidence expired; never deploy an untested tree.')
}

function record() {
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'))
  if (process.env.GITHUB_EVENT_NAME !== 'pull_request' || event.pull_request?.draft || event.pull_request?.base.ref !== 'main') {
    throw new Error('Only a final pull request to main can record merge-gate proof.')
  }
  // Evidence must describe the checked-out candidate, not source that a test
  // changed temporarily and that will be absent from the deployment.
  execFileSync('git', ['diff', '--exit-code', 'HEAD', '--'], { stdio: 'pipe' })
  const proof = {
    repository: process.env.GITHUB_REPOSITORY,
    pullRequest: event.number,
    head: event.pull_request.head.sha,
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    runId: Number(process.env.GITHUB_RUN_ID),
    attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
  }
  writeFileSync(join(process.env.RUNNER_TEMP, 'merge-gate-proof.json'), JSON.stringify(proof))
}

async function verify() {
  const request = async (path, binary = false) => {
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}${path}`, {
      headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    })
    if (!response.ok) throw new Error(`GitHub evidence lookup failed (${response.status})`)
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json()
  }
  const readProof = async path => {
    const dir = mkdtempSync(join(tmpdir(), 'trak-merge-proof-'))
    try {
      const file = join(dir, 'proof.zip')
      writeFileSync(file, await request(path, true))
      return JSON.parse(execFileSync('unzip', ['-p', file, 'merge-gate-proof.json'], { encoding: 'utf8', maxBuffer: 1_000_000 }))
    } finally { rmSync(dir, { recursive: true, force: true }) }
  }
  const result = await findTestedMerge({
    repository: process.env.GITHUB_REPOSITORY,
    sha: process.env.GITHUB_SHA,
    tree: execFileSync('git', ['rev-parse', 'HEAD^{tree}'], { encoding: 'utf8' }).trim(),
    api: request, readProof,
  })
  console.log(`Reusing final PR #${result.pr} tests: ${result.run}`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv[2] === 'record') record()
    else if (process.argv[2] === 'verify') await verify()
    else throw new Error('Use record or verify.')
  } catch (error) { console.error(error.message); process.exitCode = 1 }
}
