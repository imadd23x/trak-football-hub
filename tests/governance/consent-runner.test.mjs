import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeConsentAudit, loadGitBundle, parseAuditResults, runnerFiles, validateInventory } from '../../scripts/audits/consent-runner.mjs';
import { evaluateAuditReport } from '../../scripts/governance/audit-ratchet.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const read = path => readFileSync(join(root, path), 'utf8');
const inventory = JSON.parse(read('scripts/audits/consent-inventory.json'));
const runner = 'a'.repeat(40);
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
const source = git('rev-parse', 'HEAD').trim();
const migrations = git('ls-tree', '-r', '--name-only', source, '--', 'supabase/migrations').trim().split('\n')
  .map(path => ({ name: path.split('/').at(-1), sql: git('show', `${source}:${path}`) }));
const bundle = { candidateRevision: source, runnerRevision: runner, inventory, migrations,
  bootstrap: read('supabase/tests/bootstrap.sql'), auditSql: read('supabase/tests/consent_privacy_review.sql') };
const assertions = inventory.assertions.map(row => ({ id: row.id, kind: row.kind,
  status: row.kind === 'control' ? 'pass' : 'fail', detail: row.description }));
const results = rows => [{ rows: [{ consent_privacy_audit_result: { version: 1, suite: 'consent-privacy', assertions: rows } }] }];
const baselineFor = report => ({ version: 1, suites: report.suites.map(suite => ({
  id: suite.id, sourceRevision: source, runnerRevision: runner, inventoryRevision: runner,
  assertions: suite.assertions.map(row => ({ id: row.id, kind: row.kind, expected: row.status })),
})) });

test('the unchanged behavioral inventory has 27 distinct IDs, including 19 controls', () => {
  validateInventory(inventory);
  assert.equal(inventory.assertions.length, 27);
  assert.equal(inventory.assertions.filter(row => row.kind === 'control').length, 19);
  assert.equal(new Set(inventory.assertions.map(row => row.id)).size, 27);
  assert.deepEqual(parseAuditResults(results(assertions), inventory), assertions);
});

for (const [label, value] of [
  ['missing envelope', []], ['duplicate envelope', [...results(assertions), ...results(assertions)]],
  ['null envelope', [{ rows: [{ consent_privacy_audit_result: null }] }]],
  ['missing check', results(assertions.filter(row => row.id !== 'CP1.child-private-note-denied'))],
  ['missing control', results(assertions.filter(row => row.id !== 'control.grant-authorizes'))],
  ['duplicate assertion', results([...assertions, assertions[0]])],
  ['unknown assertion', results([...assertions, { ...assertions[0], id: 'unexpected' }])],
  ['kind downgrade', results(assertions.map((row, index) => index ? row : { ...row, kind: 'check' }))],
  ['non-boolean-derived status', results(assertions.map((row, index) => index ? row : { ...row, status: 'skipped' }))],
]) {
  test(`rejects ${label} rather than accepting a smaller failure count`, () => {
    assert.throws(() => parseAuditResults(value, inventory));
  });
}

function fakeDatabase({ result = results(assertions), failAt, rollbackError = false, closeError = false, leakedFixture = false } = {}) {
  return {
    async exec(sql) {
      if (sql === 'ROLLBACK' && rollbackError) throw new Error('synthetic cleanup failure');
      if (sql === failAt) throw new Error('synthetic SQL failure');
      return sql === bundle.auditSql ? result : [];
    },
    async query() { return { rows: [{ role_reset: true, result_removed: true, fixtures_removed: !leakedFixture }] }; },
    async close() { if (closeError) throw new Error('synthetic close failure'); },
  };
}

test('bootstrap, migration, SQL, parser, rollback and close failures cannot be accepted as debt', async () => {
  const good = await executeConsentAudit(bundle, { createDatabase: () => fakeDatabase() });
  const baseline = baselineFor(good);
  assert.equal(evaluateAuditReport(baseline, good, source).ok, true);
  for (const fault of [
    { failAt: bundle.bootstrap }, { failAt: migrations[0].sql }, { failAt: bundle.auditSql },
    { result: [] }, { rollbackError: true }, { closeError: true }, { leakedFixture: true },
  ]) {
    const report = await executeConsentAudit(bundle, { createDatabase: () => fakeDatabase(fault) });
    assert.equal(report.suites[0].status, 'error', JSON.stringify(fault));
    assert.equal(evaluateAuditReport(baseline, report, source).ok, false);
  }
  const failedStartup = await executeConsentAudit(bundle, { createDatabase: () => { throw new Error('startup failed'); } });
  assert.equal(failedStartup.suites[0].status, 'error');
});

test('a reported failed control is rejected even with the exact prior eight failed checks', async () => {
  const good = await executeConsentAudit(bundle, { createDatabase: () => fakeDatabase() });
  const bad = await executeConsentAudit(bundle, { createDatabase: () => fakeDatabase({
    result: results(assertions.map(row => row.id === 'control.grant-authorizes' ? { ...row, status: 'fail' } : row)),
  }) });
  const evaluation = evaluateAuditReport(baselineFor(good), bad, source);
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.violations.some(row => row.code === 'failed-control' && row.assertionId === 'control.grant-authorizes'));
});

test('real current migration replay preserves all 27 results; weakened RLS turns the exact control red', async () => {
  assert.ok(migrations.length > 0);
  const real = await executeConsentAudit(bundle);
  assert.equal(real.suites[0].status, 'complete', real.suites[0].detail);
  assert.equal(real.suites[0].assertions.length, 27);
  assert.equal(real.suites[0].assertions.filter(row => row.kind === 'control').length, 19);
  assert.ok(real.suites[0].assertions.filter(row => row.kind === 'control').every(row => row.status === 'pass'));
  // Behavior repairs should reduce reviewed debt, not fail a test demanding
  // the old bug. This mutation targets a presently passing isolation control.
  const weakened = await executeConsentAudit({ ...bundle, migrations: [...migrations, {
    name: 'in-memory-test-only-permissive-policy',
    sql: 'CREATE POLICY audit_mutation_private_notes_public ON public.coach_assessment_notes FOR SELECT TO authenticated USING (true)',
  }] });
  assert.equal(weakened.suites[0].status, 'complete', weakened.suites[0].detail);
  const failedControls = weakened.suites[0].assertions.filter(row => row.kind === 'control' && row.status === 'fail');
  assert.deepEqual(failedControls.map(row => row.id), ['control.parent-private-note-denied']);
  const evaluation = evaluateAuditReport(baselineFor(real), weakened, source);
  assert.equal(evaluation.ok, false);
  assert.ok(evaluation.violations.some(row => row.code === 'failed-control'));
});

test('a real undefined-column error is execution failure, never an accepted read denial', async () => {
  const auditSql = bundle.auditSql.replace("'SELECT count(*) FROM public.coach_assessment_notes", "'SELECT missing_audit_column FROM public.coach_assessment_notes");
  assert.notEqual(auditSql, bundle.auditSql);
  const report = await executeConsentAudit({ ...bundle, auditSql });
  assert.equal(report.suites[0].status, 'error');
  assert.match(report.suites[0].detail, /42703/);
  assert.deepEqual(report.suites[0].assertions, []);
});

test('Git provenance rejects changed runner bytes, dirty/untracked migrations and wrong candidate HEAD', t => {
  const cwd = mkdtempSync(join(tmpdir(), 'trak-consent-provenance-'));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
  for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR']) delete env[key];
  const run = (...args) => execFileSync('git', ['-c', 'user.name=Synthetic Audit', '-c', 'user.email=audit@test.invalid',
    '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', ...args], { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  for (const path of runnerFiles) { mkdirSync(dirname(join(cwd, path)), { recursive: true }); writeFileSync(join(cwd, path), read(path)); }
  const migrationPath = 'supabase/migrations/20260918000000_synthetic.sql';
  mkdirSync(dirname(join(cwd, migrationPath)), { recursive: true }); writeFileSync(join(cwd, migrationPath), 'SELECT 1;');
  run('init', '--template='); run('add', '.'); run('commit', '-m', 'Synthetic trusted runner');
  const sha = run('rev-parse', 'HEAD');
  const options = { candidateRoot: cwd, candidateRevision: sha, runnerRevision: sha, trustedRoot: cwd };
  assert.equal(loadGitBundle(options).migrations.length, 1);
  assert.throws(() => loadGitBundle({ ...options, candidateRevision: source }));
  writeFileSync(join(cwd, migrationPath), 'SELECT 2;');
  assert.throws(() => loadGitBundle(options), /dirty/);
  writeFileSync(join(cwd, migrationPath), 'SELECT 1;');
  const unexpected = join(cwd, 'supabase/migrations/20260918000001_untracked.sql');
  writeFileSync(unexpected, 'SELECT 2;');
  assert.throws(() => loadGitBundle(options), /untracked/); rmSync(unexpected);
  writeFileSync(join(cwd, 'scripts/audits/consent-inventory.json'), '{}');
  assert.throws(() => loadGitBundle(options), /pinned Git object/);
});
