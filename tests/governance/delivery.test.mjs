import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { localGit, verifyDelivery } from '../../scripts/governance/verify-delivery.mjs';

function fixture(t, mode = 'merge') {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-delivery-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Synthetic Governance Test'); git('config', 'user.email', 'governance@test.invalid');
  writeFileSync(join(cwd, 'base.txt'), 'base\n'); git('add', '.'); git('commit', '-m', 'base');
  const base = git('rev-parse', 'HEAD');
  git('checkout', '-b', 'task'); writeFileSync(join(cwd, 'change.txt'), 'expected behavior\n'); git('add', '.'); git('commit', '-m', 'change');
  if (mode === 'rebase') {
    writeFileSync(join(cwd, 'change.txt'), 'expected behavior\nsecond reviewed change\n'); git('add', '.'); git('commit', '-m', 'second change');
  }
  const originalHead = git('rev-parse', 'HEAD');
  git('checkout', 'main');
  writeFileSync(join(cwd, 'independent.txt'), 'another reviewed change\n'); git('add', '.'); git('commit', '-m', 'independent');
  if (mode === 'merge') git('merge', '--no-ff', 'task', '-m', 'merge reviewed task');
  else if (mode === 'squash') { git('merge', '--squash', 'task'); git('commit', '-m', 'squash reviewed task'); }
  else { git('checkout', 'task'); git('rebase', 'main'); git('checkout', 'main'); git('merge', '--ff-only', 'task'); }
  const delivered = git('rev-parse', 'HEAD');
  const pr = { number: 12, merged: true, merge_commit_sha: delivered, changed_files: 1, base: { ref: 'main', repo: { full_name: 'example/trak' } } };
  const files = [{ filename: 'change.txt', status: 'added', sha: git('rev-parse', `${originalHead}:change.txt`) }];
  const data = {
    '/repos/example/trak/branches/main': { commit: { sha: delivered } },
    '/repos/example/trak/pulls/12': pr,
    [`/repos/example/trak/commits/${delivered}/pulls`]: [{ number: 12 }],
    '/repos/example/trak/pulls/12/files': files,
  };
  const api = { get: async path => { if (!(path in data)) throw new Error(`Missing API fixture: ${path}`); return data[path]; } };
  api.paginate = api.get;
  return { cwd, git, local: localGit(cwd), base, originalHead, delivered, pr, files, data, api };
}
for (const mode of ['merge', 'squash', 'rebase']) {
  test(`actual ${mode} result passes without requiring original head ancestry`, async t => {
    const f = fixture(t, mode);
    if (mode !== 'merge') assert.equal(f.local.isAncestor(f.originalHead, f.delivered), false);
    const result = await verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.delivered });
    assert.equal(result.results[0].resultSha, f.delivered);
  });
}
test('a merge into a task branch fails even with merged badge', async t => {
  const f = fixture(t); f.pr.base.ref = 'player/task';
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /has not merged into/);
});
test('a recorded merge absent from main fails', async t => {
  const f = fixture(t); f.data['/repos/example/trak/branches/main'].commit.sha = f.base;
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /absent from main/);
});
test('a stale workflow cannot authorize an older production release', async t => {
  const f = fixture(t);
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.base }), /stale release/);
});
test('a forced reset onto an old recorded PR result cannot authorize release', async t => {
  const f = fixture(t);
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.delivered, forced: true }), /Forced main pushes/);
});
test('non-forward main pushes fail even without a forced flag', async t => {
  const f = fixture(t);
  f.git('checkout', '-b', 'later'); writeFileSync(join(f.cwd, 'later.txt'), 'later'); f.git('add', '.'); f.git('commit', '-m', 'later');
  const later = f.git('rev-parse', 'HEAD');
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.delivered, previousSha: later }), /does not advance/);
});
test('main moving during inventory reads cannot yield successful verification', async t => {
  const f = fixture(t); const original = f.api.get; let reads = 0;
  f.api.get = async path => path.endsWith('/branches/main') && ++reads === 2 ? { commit: { sha: f.base } } : original(path);
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.delivered }), /Main changed during/);
});
test('missing changed file fails despite delivered merge metadata', async t => {
  const f = fixture(t); f.files[0].filename = 'lost-change.txt';
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /wrong file inventory/);
});
test('preserving a changed path while discarding its reviewed contents fails', async t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'change.txt'), 'old behavior restored by a bad merge\n');
  f.git('add', '.'); f.git('commit', '--amend', '--no-edit');
  const badMerge = f.git('rev-parse', 'HEAD');
  assert.equal(f.local.isAncestor(f.originalHead, badMerge), true, 'the original PR head is still an ancestor');
  f.data['/repos/example/trak/branches/main'].commit.sha = badMerge;
  f.pr.merge_commit_sha = badMerge;
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /Delivered contents differ/);
});
test('an incomplete API file inventory fails', async t => {
  const f = fixture(t); f.pr.changed_files = 2;
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /incomplete/);
});
test('a shallow checkout cannot misclassify real ancestry as missing delivery', t => {
  const f = fixture(t);
  const parent = mkdtempSync(join(tmpdir(), 'trak-shallow-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const cwd = join(parent, 'clone');
  execFileSync('git', ['clone', '--depth=1', pathToFileURL(f.cwd).href, cwd], { stdio: 'pipe' });
  assert.throws(() => localGit(cwd), /complete Git history/);
  execFileSync('git', ['fetch', '--unshallow', 'origin'], { cwd, stdio: 'pipe' });
  assert.equal(localGit(cwd).isAncestor(f.base, f.delivered), true);
});
test('direct main pushes have no successful release path', async t => {
  const f = fixture(t); f.data[`/repos/example/trak/commits/${f.delivered}/pulls`] = [];
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', commit: f.delivered }), /direct pushes/);
});
test('API errors fail rather than reporting delivery', async t => {
  const f = fixture(t); f.api.get = async () => { throw new Error('GitHub unavailable'); };
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /GitHub unavailable/);
});
test('removed and renamed paths are checked in the delivered tree', async t => {
  const f = fixture(t); f.files[0].status = 'removed';
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /wrong file inventory/);
  f.files[0] = { filename: 'change.txt', status: 'renamed', previous_filename: 'base.txt', sha: f.git('rev-parse', `${f.originalHead}:change.txt`) };
  await assert.rejects(verifyDelivery({ api: f.api, git: f.local, repository: 'example/trak', prNumber: 12 }), /Renamed path remains/);
});
