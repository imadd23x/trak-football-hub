import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPush } from './check-push-credentials.mjs'
import { BURNED } from './burned-credentials.mjs'

const ZERO = '0'.repeat(40)
function repo(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-push-guard-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  const git = args => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  git(['init', '-q'])
  const commit = (name, text) => {
    writeFileSync(join(cwd, name), text); git(['add', '--', name])
    git(['-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.invalid', '-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'Synthetic fixture'])
    return git(['rev-parse', 'HEAD']).trim()
  }
  return { git, commit }
}

test('permits clean outgoing commits without running regression suites', t => {
  const { git, commit } = repo(t)
  const sha = commit('clean.js', 'export const ready = true\n')
  assert.equal(checkPush(`refs/heads/task ${sha} refs/heads/task ${ZERO}`, git), 1)
})

test('blocks a credential introduced then removed before push, without printing it', t => {
  const { git, commit } = repo(t)
  commit('incident.txt', BURNED[0])
  const sha = commit('incident.txt', 'removed\n')
  assert.throws(() => checkPush(`refs/heads/task ${sha} refs/heads/task ${ZERO}`, git), error => {
    assert.match(error.message, /Push blocked/)
    assert.ok(!error.message.includes(BURNED[0]))
    return true
  })
})

test('blocks new password literals in application source', t => {
  const { git, commit } = repo(t)
  const sha = commit('application.js', 'const password = "synthetic-fixture-only"\n')
  assert.throws(() => checkPush(`refs/heads/task ${sha} refs/heads/task ${ZERO}`, git), /Push blocked/)
})

test('ignores pre-existing remote history and checks only new commits', t => {
  const { git, commit } = repo(t)
  const base = commit('incident.txt', BURNED[0])
  git(['update-ref', 'refs/remotes/origin/main', base])
  const sha = commit('clean.js', 'export const ready = true\n')
  assert.equal(checkPush(`refs/heads/task ${sha} refs/heads/task ${ZERO}`, git), 1)
  assert.equal(checkPush(`refs/heads/task ${sha} refs/heads/task ${base}`, git), 1)
})

test('allows ref deletion and fails closed on malformed input or git failure', () => {
  assert.equal(checkPush(`refs/heads/task ${ZERO} refs/heads/task ${'a'.repeat(40)}`), 0)
  assert.throws(() => checkPush('bad-input'), /Invalid pre-push input/)
  assert.throws(() => checkPush(`refs/heads/task ${'a'.repeat(40)} refs/heads/task ${ZERO}`, () => { throw new Error('git failed') }), /git failed/)
})
