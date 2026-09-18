import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createGitHubClient } from '../../scripts/governance/github.mjs';
import { createGitRepository, evaluatePullRequest } from '../../scripts/governance/pr-policy.mjs';
import { checkPullRequest, writeStepSummary } from '../../scripts/governance/check-pr.mjs';

const repository = 'example/trak-football-hub';
const fork = 'synthetic-fork/trak-football-hub';
const historical = '20260918070209_existing.sql';
const older = '20260918062345_backdated.sql';
const newer = '20260919000001_forward.sql';
const migration = name => `supabase/migrations/${name}`;

function fixture(t) {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-pr-policy-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Synthetic Review', '-c', 'user.email=review@test.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  const commit = (files, message = 'Synthetic change') => {
    for (const [path, content] of Object.entries(files)) {
      if (content === null) rmSync(join(cwd, path));
      else { mkdirSync(join(cwd, path, '..'), { recursive: true }); writeFileSync(join(cwd, path), content); }
    }
    git('add', '.'); git('commit', '--allow-empty', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  git('init', '--initial-branch=main', '--template=');
  const base = commit({ [migration(historical)]: 'SELECT 1;\n' }, 'Synthetic main');
  git('switch', '-c', 'candidate');
  const head = commit({ 'feature.txt': 'candidate\n' });
  return { cwd, git, commit, base, head, reader: createGitRepository(cwd) };
}

function pull(head, number = 50, body = '') {
  return { number, state: 'open', body, user: { login: 'synthetic-author', type: 'User' },
    base: { ref: 'main', repo: { full_name: repository } }, head: { sha: head, repo: { full_name: fork } } };
}

function ack(f, migrations = [older]) {
  return { base_sha: f.base, migrations, evidence_url: `https://github.com/${fork}/actions/runs/123` };
}
function approval(f, value = ack(f), changes = {}) {
  return { id: 1, state: 'APPROVED', commit_id: f.head, submitted_at: '2026-09-18T12:00:00Z',
    user: { login: 'synthetic-reviewer', type: 'User' }, author_association: 'COLLABORATOR',
    body: `migration-order-approved: ${JSON.stringify(value)}`, ...changes };
}
const successRun = f => ({ head_sha: f.head, status: 'completed', conclusion: 'success', repository: { full_name: fork } });

function evaluate(f, overrides = {}) {
  const current = overrides.pullRequest ?? pull(f.head, 50, overrides.body ?? '');
  return evaluatePullRequest({ repository, prNumber: 50, baseSha: f.base, headSha: f.head,
    pullRequest: current, openPullRequests: [current], reviews: [], git: f.reader,
    isAncestor: (base, head) => f.reader.isAncestor(base, head),
    getPullRequest: async number => { throw new Error(`Unexpected dependency #${number}`); },
    getActionsRun: async () => successRun(f), ...overrides });
}

test('independent branches with shared main history pass; current PR never blocks itself', async t => {
  const f = fixture(t);
  f.git('switch', '-c', 'independent', f.base);
  const other = f.commit({ 'other.txt': 'independent' });
  assert.equal((await evaluate(f, { openPullRequests: [pull(f.head), pull(other, 34)] })).passed, true);
});

test('shared feature history alone is not a dependency; only another complete unmerged head blocks', async t => {
  const f = fixture(t);
  const shared = f.head;
  f.head = f.commit({ 'candidate-only.txt': 'candidate' });
  f.git('switch', '-c', 'other', shared);
  const other = f.commit({ 'other-only.txt': 'other' });
  assert.equal((await evaluate(f, { openPullRequests: [pull(f.head), pull(other, 34)] })).passed, true);
});

test('including another open PR head fails with its number and exact SHA', async t => {
  const f = fixture(t);
  const dependency = f.head;
  f.head = f.commit({ 'stack.txt': 'stacked' });
  const result = await evaluate(f, { openPullRequests: [pull(f.head), pull(dependency, 34)] });
  assert.equal(result.passed, false);
  assert.match(result.reasons.join('\n'), new RegExp(`#34 \\(${dependency}\\)`));
});

test('an open PR head already on main does not block', async t => {
  const f = fixture(t);
  assert.equal((await evaluate(f, { openPullRequests: [pull(f.head), pull(f.base, 34)] })).passed, true);
});

test('declared independent dependency fails until delivered; closed without delivery also fails', async t => {
  const f = fixture(t);
  f.git('switch', '-c', 'independent', f.base);
  const other = f.commit({ 'other.txt': 'other' });
  for (const state of ['open', 'closed']) {
    const dependency = { ...pull(other, 34), state, merged: false };
    const result = await evaluate(f, { body: 'Depends-on: #34', getPullRequest: async () => dependency });
    assert.equal(result.passed, false);
    assert.match(result.reasons.join('\n'), /Declared dependency #34 has not reached current main/);
  }
});

test('a declared squash-merged dependency is delivered through its actual merge commit', async t => {
  const f = fixture(t);
  f.git('switch', '-c', 'dependency', f.base);
  const original = f.commit({ 'dependency.txt': 'delivered' }, 'Original dependency');
  f.git('switch', 'main'); f.git('merge', '--squash', 'dependency');
  f.base = f.commit({}, 'Squashed delivery');
  assert.equal(f.reader.isAncestor(original, f.base), false);
  f.git('switch', '-c', 'fresh-candidate', f.base); f.head = f.commit({ 'candidate.txt': 'fresh' });
  const dependency = { ...pull(original, 34), state: 'closed', merged: true, merge_commit_sha: f.base };
  assert.equal((await evaluate(f, { body: 'Depends-on: #34', getPullRequest: async () => dependency })).passed, true);
});

test('non-main base and outdated candidate head fail before migration comparison', async t => {
  const f = fixture(t);
  const current = pull(f.head); current.base.ref = 'shared/old-stack';
  assert.match((await evaluate(f, { pullRequest: current })).reasons[0], /retarget to main/);
  f.git('switch', 'main'); f.base = f.commit({ [migration(newer)]: 'SELECT 2;' });
  const result = await evaluate(f);
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['Candidate does not contain current main; merge current main and rerun checks']);
});

test('identical historical files and genuinely newer migrations require no inversion acknowledgement', async t => {
  const f = fixture(t);
  assert.equal((await evaluate(f)).passed, true);
  f.head = f.commit({ [migration(newer)]: 'SELECT 2;' });
  const result = await evaluate(f);
  assert.equal(result.passed, true);
  assert.deepEqual(result.backdatedMigrations, []);
});

test('backdated migration rejects missing acknowledgement and author-only acknowledgement', async t => {
  const f = fixture(t); f.head = f.commit({ [migration(older)]: 'SELECT 2;' });
  assert.match((await evaluate(f)).reasons.join('\n'), /migration-order-ack/);
  const value = ack(f);
  assert.match((await evaluate(f, { body: `migration-order-ack: ${JSON.stringify(value)}` })).reasons.join('\n'), /independent.*APPROVED/);
});

test('exact current-head independent approval plus matching successful evidence permits inversion', async t => {
  const f = fixture(t); f.head = f.commit({ [migration(older)]: 'SELECT 2;' });
  const value = ack(f);
  const differentlyOrdered = { evidence_url: value.evidence_url, migrations: value.migrations, base_sha: value.base_sha };
  const result = await evaluate(f, { body: `migration-order-ack: ${JSON.stringify(value)}`, reviews: [approval(f, differentlyOrdered)] });
  assert.equal(result.passed, true);
  assert.deepEqual(result.backdatedMigrations, [older]);
});

test('stale, dismissed, revoked, bot, outsider, and author approvals cannot authorize inversion', async t => {
  const f = fixture(t); f.head = f.commit({ [migration(older)]: 'SELECT 2;' });
  const value = ack(f), body = `migration-order-ack: ${JSON.stringify(value)}`;
  const variants = [
    [approval(f, value, { commit_id: f.base })],
    [approval(f, value, { state: 'DISMISSED' })],
    [approval(f), approval(f, value, { id: 2, state: 'CHANGES_REQUESTED', submitted_at: '2026-09-18T13:00:00Z' })],
    [approval(f), approval(f, value, { id: 2, state: 'DISMISSED', submitted_at: '2026-09-18T13:00:00Z' })],
    [approval(f, value, { user: { login: 'helper[bot]', type: 'Bot' } })],
    [approval(f, value, { author_association: 'CONTRIBUTOR' })],
    [approval(f, value, { user: { login: 'synthetic-author', type: 'User' } })],
    [approval(f, value, { body: 'Approved generally' })],
  ];
  for (const reviews of variants) assert.equal((await evaluate(f, { body, reviews })).passed, false, JSON.stringify(reviews));
  // A later comment alone does not revoke GitHub's effective approval.
  assert.equal((await evaluate(f, { body, reviews: [approval(f), approval(f, value, { id: 2, state: 'COMMENTED', submitted_at: '2026-09-18T13:00:00Z' })] })).passed, true);
});

test('acknowledgement must name exact base/list and a successful exact-head allowed-repository run', async t => {
  const f = fixture(t); f.head = f.commit({ [migration(older)]: 'SELECT 2;' });
  const value = ack(f);
  for (const altered of [
    { ...value, base_sha: f.head }, { ...value, migrations: [] }, { ...value, migrations: [older, older] },
    { ...value, evidence_url: 'https://github.com/unrelated/repo/actions/runs/123' },
    { ...value, evidence_url: `https://github.com/${fork}/actions/runs/123?fake=true` },
    { ...value, evidence_url: `https://github.com/${fork}/actions/runs/123/attempts/1` },
  ]) {
    assert.equal((await evaluate(f, { body: `migration-order-ack: ${JSON.stringify(altered)}`, reviews: [approval(f, altered)] })).passed, false);
  }
  for (const run of [
    { ...successRun(f), head_sha: f.base }, { ...successRun(f), status: 'in_progress' },
    { ...successRun(f), conclusion: 'failure' }, { ...successRun(f), repository: { full_name: 'unrelated/repo' } },
  ]) {
    assert.equal((await evaluate(f, { body: `migration-order-ack: ${JSON.stringify(value)}`, reviews: [approval(f)], getActionsRun: async () => run })).passed, false);
  }
});

test('historical edits/deletions and duplicate migration versions fail independently of acknowledgement', async t => {
  const f = fixture(t);
  f.head = f.commit({ [migration(historical)]: 'SELECT 99;' });
  assert.match((await evaluate(f)).reasons.join('\n'), /Historical migration changed/);
  f.head = f.commit({ [migration(historical)]: null });
  assert.match((await evaluate(f)).reasons.join('\n'), /Historical migration deleted/);
  f.head = f.commit({ [migration(historical)]: 'SELECT 1;\n', [migration('20260918070209_collision.sql')]: 'SELECT 3;' });
  assert.match((await evaluate(f)).reasons.join('\n'), /version .* is duplicated/);
});

test('missing refs, malformed dependencies/inventory and unavailable evidence cannot pass', async t => {
  const f = fixture(t);
  await assert.rejects(evaluate(f, { headSha: 'a'.repeat(40), pullRequest: pull('a'.repeat(40)) }), /Local Git/);
  await assert.rejects(evaluate(f, { body: 'Depends-on: not-a-pr' }), /Depends-on/);
  await assert.rejects(evaluate(f, { openPullRequests: [] }), /missing from the open PR inventory/);
  f.head = f.commit({ [migration(older)]: 'SELECT 2;' });
  const result = await evaluate(f, { body: `migration-order-ack: ${JSON.stringify(ack(f))}`, reviews: [approval(f)], getActionsRun: async () => { throw new Error('GitHub HTTP 403'); } });
  assert.equal(result.passed, false); assert.match(result.reasons.join('\n'), /HTTP 403/);
});

test('GitHub client paginates PRs and reviews and only sends authenticated GET to the fixed API', async () => {
  const requests = [];
  const client = createGitHubClient({ token: 'synthetic-token', fetchImpl: async (url, init) => {
    requests.push(url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
    assert.equal(init.headers.Authorization, 'Bearer synthetic-token');
    const page = new URL(url).searchParams.get('page');
    return new Response(JSON.stringify(page === '1' ? Array.from({ length: 100 }, (_, id) => ({ id })) : [{ id: 100 }]));
  } });
  assert.equal((await client.listOpenPullRequests(repository)).length, 101);
  assert.equal((await client.listReviews(repository, 50)).length, 101);
  assert.equal(requests.length, 4);
  for (const path of ['https://evil.invalid', '//evil.invalid', '/\\evil.invalid', '/repos/example/trak#fragment']) {
    await assert.rejects(client.get(path), /API path/);
  }
  assert.equal(requests.length, 4, 'invalid paths never send the token');
});

test('GitHub errors, malformed JSON and incomplete comparisons fail closed', async () => {
  for (const response of [new Response('{}', { status: 403 }), new Response('not-json'), new Response('{}')]) {
    const client = createGitHubClient({ token: 'synthetic-token', fetchImpl: async () => response });
    await assert.rejects(client.isAncestor(repository, 'a'.repeat(40), 'b'.repeat(40)), /HTTP 403|invalid JSON|incomplete/);
  }
  const client = createGitHubClient({ token: 'synthetic-token', fetchImpl: async () => { throw new Error('synthetic network failure'); } });
  await assert.rejects(client.listOpenPullRequests(repository), /GET .*failed/);
  assert.throws(() => createGitHubClient({ token: '' }), /GITHUB_TOKEN/);
});

test('CLI orchestration validates current main/head and propagates API failures', async t => {
  const f = fixture(t);
  const current = pull(f.head);
  const client = {
    getMain: async () => f.base, getPullRequest: async () => current,
    listOpenPullRequests: async () => [current], listReviews: async () => [],
    isAncestor: async (_repo, base, head) => f.reader.isAncestor(base, head),
    getActionsRun: async () => { throw new Error('unexpected evidence request'); },
  };
  const options = { repository, prNumber: 50, baseSha: f.base, headSha: f.head, cwd: f.cwd, client };
  assert.equal((await checkPullRequest(options)).passed, true);
  await assert.rejects(checkPullRequest({ ...options, client: { ...client, listReviews: async () => { throw new Error('GitHub HTTP 503'); } } }), /HTTP 503/);
  await assert.rejects(checkPullRequest({ ...options, client: { ...client, getMain: async () => f.head } }), /Current main/);
  let calls = 0;
  await assert.rejects(checkPullRequest({ ...options, client: { ...client, getPullRequest: async () => ++calls === 1 ? current : pull(f.base) } }), /changed while checking/);
  let reviewCalls = 0;
  await assert.rejects(checkPullRequest({ ...options, client: { ...client, listReviews: async () => ++reviewCalls === 1 ? [] : [approval(f)] } }), /reviews changed while checking/);
  let bodyCalls = 0;
  await assert.rejects(checkPullRequest({ ...options, client: { ...client, getPullRequest: async () => ++bodyCalls === 1 ? current : { ...current, body: 'Depends-on: #99' } } }), /changed while checking/);
});

test('step summaries report pass/fail/unverified and escape untrusted evidence text', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-pr-summary-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const path = join(cwd, 'summary.md');
  for (const state of [{ passed: true }, { passed: false }, { passed: false, unverified: true }]) {
    writeStepSummary({ ...state, baseSha: 'a'.repeat(40), headSha: 'b'.repeat(40),
      reasons: ['</pre><script>unexpected</script> & ```'], backdatedMigrations: [older] }, path);
  }
  const output = readFileSync(path, 'utf8');
  assert.match(output, /PR policy: PASS/); assert.match(output, /PR policy: FAIL/); assert.match(output, /PR policy: UNVERIFIED/);
  assert.match(output, /&lt;\/pre&gt;&lt;script&gt;unexpected/);
  assert.equal(output.includes('<script>'), false);
  assert.match(output, /20260918062345_backdated.sql/);
});
