import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { BURNED, ALLOWED_TO_NAME_THEM } from './burned-credentials.mjs'

const ZERO = /^0+$/
const SKIP = /\.(png|jpe?g|gif|webp|svg|ico|woff2?|ttf|eot|pdf|pptx?|zip|mp4|lock)$/i
const PASSWORD = /(?:password|PW|DEV_PASSWORD)\s*[:=]\s*(['"`])([^'"`]{6,})\1/gi

export function checkPush(input, git = args => execFileSync('git', args, { encoding: 'utf8' })) {
  const commits = new Set()
  for (const line of input.trim().split('\n').filter(Boolean)) {
    const [, local, , remote] = line.split(/\s+/)
    if (!local || !remote || !/^[a-f0-9]{40,64}$/.test(local) || !/^[a-f0-9]{40,64}$/.test(remote)) {
      throw new Error('Invalid pre-push input; credential check could not run.')
    }
    if (ZERO.test(local)) continue // Deleting a ref publishes no objects.
    // A new branch excludes fetched history, including existing incident records.
    const range = ZERO.test(remote) ? [local, '--not', '--remotes'] : [`${remote}..${local}`]
    for (const sha of git(['rev-list', ...range]).trim().split('\n').filter(Boolean)) commits.add(sha)
  }
  const violations = []
  for (const sha of commits) {
    const paths = new Set(git(['diff-tree', '--root', '-m', '--diff-filter=ACMRT', '--no-commit-id', '--name-only', '-r', '-z', sha]).split('\0').filter(Boolean))
    for (const path of paths) {
      if (SKIP.test(path)) continue
      const text = git(['show', `${sha}:${path}`])
      if ((!ALLOWED_TO_NAME_THEM.includes(path) && BURNED.some(value => text.includes(value))) ||
          (/\.(ts|tsx|js|mjs|cjs)$/.test(path) && !/__tests__|\.test\.|\.spec\./.test(path) && PASSWORD.test(text))) {
        violations.push(`${sha.slice(0, 8)}:${path}`)
      }
      PASSWORD.lastIndex = 0
    }
  }
  if (violations.length) throw new Error(`Push blocked: credential material in outgoing history (${violations.join(', ')}). Remove it from those commits before pushing. Values are withheld.`)
  return commits.size
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(`Credential check passed (${checkPush(readFileSync(0, 'utf8'))} outgoing commits).`) }
  catch (error) { console.error(error.message); process.exitCode = 1 }
}
