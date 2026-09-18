import assert from 'node:assert/strict';
import { execFile, execFileSync } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { parse } from 'yaml';
import { historyUpgradeBase, historyMigration, parentHistoryUpgradeOrder } from '../../scripts/lib/parent-history-upgrade.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);

test('CI executes the real upgrade controls with pinned Git history available', async () => {
  const workflow = parse(await readFile(resolve(root, '.github/workflows/ci.yml'), 'utf8'));
  const steps = workflow.jobs.test.steps;
  assert.equal(steps.filter(step => step.run === 'node --test tests/db/parent-history-upgrade.test.mjs').length, 1);
  assert.equal(steps.find(step => step.uses === 'actions/checkout@v4')?.with?.['fetch-depth'], 0);
  assert.ok(steps.some(step => step.run === 'npm run test:db'));
  assert.ok(steps.some(step => step.run === 'npm run test:db -- --parent-upgrade-review'));
});

// Each mutation is a private test-source copy. Original migrations, suites,
// Git objects and working-tree files are never changed by these controls.
async function fixture() {
  const dir = await mkdtemp(resolve(tmpdir(), 'trak-history-upgrade-'));
  await mkdir(resolve(dir, 'scripts/lib'), { recursive: true });
  for (const name of ['scripts/test-db.mjs', 'scripts/lib/parent-history-upgrade.mjs']) {
    await cp(resolve(root, name), resolve(dir, name));
  }
  await cp(resolve(root, 'supabase'), resolve(dir, 'supabase'), { recursive: true });
  await symlink(resolve(root, 'node_modules'), resolve(dir, 'node_modules'));
  const gitDir = execFileSync('git', ['-C', root, 'rev-parse', '--absolute-git-dir'], { encoding: 'utf8' }).trim();
  await writeFile(resolve(dir, '.git'), `gitdir: ${gitDir}\n`);
  return dir;
}

async function execute(dir) {
  try {
    const result = await run(process.execPath, ['scripts/test-db.mjs', '--parent-history-upgrade-review'], {
      cwd: dir, timeout: 60_000, maxBuffer: 2 * 1024 * 1024,
    });
    return { code: 0, output: result.stdout + result.stderr };
  } catch (error) {
    if (!Number.isInteger(error.code)) throw error; // launch/timeout failures are not denial evidence
    return { code: error.code, output: error.stdout + error.stderr };
  }
}

test('pinned main inventory precedes history, and unexpected historical changes fail closed', async () => {
  const dir = await fixture();
  try {
    const files = (await readdir(resolve(dir, 'supabase/migrations'))).filter(name => name.endsWith('.sql')).sort();
    const mainFiles = execFileSync('git', ['-C', root, 'ls-tree', '--name-only', `${historyUpgradeBase}:supabase/migrations`], { encoding: 'utf8' })
      .trim().split('\n').filter(name => name.endsWith('.sql')).sort();
    const order = await parentHistoryUpgradeOrder(dir, files);
    assert.equal(mainFiles.length, 62);
    const expectedMain = [...mainFiles];
    const parent = '20260917205027_secure_parent_invites.sql';
    const reports = '20260918070209_restrict_pilot_operational_views.sql';
    expectedMain.splice(expectedMain.indexOf(parent), 1);
    expectedMain.splice(expectedMain.indexOf(reports) + 1, 0, parent);
    assert.deepEqual(order.slice(0, 62), expectedMain);
    assert.ok(order.indexOf(reports) < order.indexOf(parent));
    assert.equal(order[62], historyMigration);
    assert.equal(order.length, 63);
    await assert.rejects(parentHistoryUpgradeOrder(dir, files.filter(name => name !== mainFiles[0])), /Missing main migration/);
    await assert.rejects(parentHistoryUpgradeOrder(dir, [...files, '20270101000000_unreviewed.sql']), /exactly the pending history migration/);
    await writeFile(resolve(dir, 'supabase/migrations', mainFiles[0]), '-- changed historical SQL\n');
    await assert.rejects(parentHistoryUpgradeOrder(dir, files), /Changed main migration/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('actual CLI replays main first and executes all three role suites', { timeout: 65_000 }, async () => {
  const dir = await fixture();
  try {
    const result = await execute(dir);
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Upgrade boundary: 62 migrations from main 00910940f596d9fe9a7cd416dc741943d1df2cc9 applied; history RPCs absent/);
    assert.match(result.output, /Replayed 63 migrations \(exact main 0091094 first, then pending parent history\)/);
    assert.match(result.output, /Parent invitation assertions: 55/);
    assert.match(result.output, /Operational view assertions: 282/);
    assert.match(result.output, /Parent history assertions: 81/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('actual CLI fails when the history suite produces no completion report', { timeout: 65_000 }, async () => {
  const dir = await fixture();
  try {
    const file = resolve(dir, 'supabase/tests/parent_match_history.sql');
    const original = await readFile(file, 'utf8');
    assert.ok(original.includes('AS parent_match_history_assertions'));
    await writeFile(file, original.replace('AS parent_match_history_assertions', 'AS missing_history_report'));
    const result = await execute(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Missing or incomplete parent_match_history.sql output: expected 81 assertions/);
    assert.doesNotMatch(result.output, /Passed: parent_match_history.sql/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('actual CLI propagates a failed history assertion instead of passing other suites only', { timeout: 65_000 }, async () => {
  const dir = await fixture();
  try {
    const file = resolve(dir, 'supabase/tests/parent_match_history.sql');
    const original = await readFile(file, 'utf8');
    const marker = 'SELECT count(*) AS parent_match_history_assertions';
    assert.ok(original.includes(marker));
    await writeFile(file, original.replace(marker,
      "SELECT pg_temp.parent_history_check(false, 'deliberate suite execution control');\n" + marker));
    const result = await execute(dir);
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, /Parent match history assertion failed: deliberate suite execution control/);
    assert.match(result.output, /Passed: parent_invite_security.sql/);
    assert.match(result.output, /Passed: pilot_view_security.sql/);
    assert.doesNotMatch(result.output, /Passed: parent_match_history.sql/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});
