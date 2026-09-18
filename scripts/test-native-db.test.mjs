import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { advisorDatabaseUrl, buildReplayPlan, childEnvironment, parseMode, runCommand } from './test-native-db.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const runnerUrl = new URL('./test-native-db.mjs', import.meta.url).href;
const privateDirectory = '/private/tmp/trak-native-helper-test';
const pgBin = '/synthetic-postgres/bin';
const options = { env: childEnvironment(pgBin, privateDirectory), cwd: root, timeoutMs: 5_000 };
// These tests launch only short-lived Node/env processes. They never start a
// PostgreSQL cluster, connect to a database, create fixtures or invoke advisors.

test('child environment excludes inherited database targets and credentials', async () => {
  const inherited = {
    PATH: '/untrusted/search/path', PGHOST: 'remote.invalid', PGPORT: '5432',
    PGSERVICE: 'production', PGOPTIONS: '-c search_path=other', PGPASSWORD: 'synthetic-secret',
    PGPASSFILE: '/untrusted/password-file', DB_URL: 'postgresql://remote.invalid/database',
    SUPABASE_ACCESS_TOKEN: 'synthetic-token', NODE_OPTIONS: '--no-warnings',
  };
  const result = await runCommand(process.execPath, ['--input-type=module', '-e',
    `import { childEnvironment } from ${JSON.stringify(runnerUrl)}; process.stdout.write(JSON.stringify(childEnvironment(${JSON.stringify(pgBin)}, ${JSON.stringify(privateDirectory)})));`,
  ], { ...options, env: inherited });
  const actual = JSON.parse(result.stdout);
  assert.deepEqual(Object.keys(actual).sort(), ['LANG', 'LC_ALL', 'PATH', 'PGPASSFILE', 'TZ']);
  assert.equal(actual.PGPASSFILE, join(privateDirectory, 'unused-pgpass'));
  assert.equal(actual.TZ, 'UTC');
  assert.ok(!actual.PATH.includes('/untrusted/search/path'));
});

test('a Node-wrapped CLI resolves the current Node without the inherited PATH', async () => {
  const result = await runCommand('/usr/bin/env', ['node', '-p', 'process.execPath'], options);
  assert.equal(result.stdout.trim(), process.execPath);
  assert.ok(options.env.PATH.split(':').includes(dirname(process.execPath)));
});

test('advisor URL names only the private socket and explicit database identity', () => {
  const socket = '/private/tmp/trak test/socket';
  const url = new URL(advisorDatabaseUrl(socket));
  assert.equal(url.hostname, '');
  assert.equal(url.pathname, '/postgres');
  assert.equal(url.searchParams.get('host'), socket);
  assert.equal(url.searchParams.get('port'), '55439');
  assert.equal(url.searchParams.get('user'), 'postgres');
  assert.equal(url.searchParams.get('password'), null);
});

test('full replay includes both backfills and leaves committed deletion fixtures last', async () => {
  const { sql, suites } = await buildReplayPlan(root, parseMode([]));
  const index = file => sql.indexOf(`\\echo [stage] ${file}\n`);
  for (const [setup, migration, assertions] of [
    ['parent_invite_backfill_setup.sql', '20260917205027_secure_parent_invites.sql', 'parent_invite_backfill_assertions.sql'],
    ['academy_orphan_backfill_setup.sql', '20260918062345_preserve_academy_access_and_fk_cleanup.sql', 'academy_orphan_backfill_assertions.sql'],
    ['pilot_view_backfill_setup.sql', '20260918070209_restrict_pilot_operational_views.sql', 'pilot_view_security.sql'],
  ]) {
    assert.ok(index(setup) >= 0 && index(setup) < index(migration));
    assert.ok(index(migration) < index(assertions));
  }
  for (const suite of ['parent_invite_security.sql', 'coach_departure_review.sql', 'academy_access_security.sql', 'pilot_view_security.sql']) {
    assert.ok(suites.includes(suite), `${suite} must run in the full replay`);
  }
  assert.deepEqual(suites.slice(-2), ['account_deletion_setup.sql', 'account_deletion_assertions.sql']);
  assert.ok(index('academy_access_security.sql') < index('account_deletion_setup.sql'));
});

test('negative controls exclude the corresponding repair while retaining its failing suite', async () => {
  const parent = await buildReplayPlan(root, parseMode(['--baseline']));
  assert.ok(!parent.sql.includes('\\echo [stage] 20260917205027_secure_parent_invites.sql\n'));
  assert.deepEqual(parent.suites, ['parent_invite_security.sql']);
  const departure = await buildReplayPlan(root, parseMode(['--coach-departure-baseline']));
  assert.ok(departure.sql.includes('\\echo [stage] 20260917205027_secure_parent_invites.sql\n'));
  assert.ok(!departure.sql.includes('\\echo [stage] 20260918062345_preserve_academy_access_and_fk_cleanup.sql\n'));
  assert.ok(departure.suites.includes('coach_departure_review.sql'));
  assert.ok(departure.migrationCount > parent.migrationCount);
});

test('CLI rejects arbitrary connection arguments and conflicting baseline modes', () => {
  assert.throws(() => parseMode(['--db-url=postgresql://remote.invalid']), /Usage/);
  assert.throws(() => parseMode(['--baseline', '--coach-departure-baseline']), /Usage/);
});

test('a failing process is rejected with its useful diagnostic output', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e',
    "process.stdout.write('last-stage'); process.stderr.write('synthetic failure'); process.exit(7);",
  ], options), error => {
    assert.match(error.message, /exited 7/);
    assert.match(error.message, /last-stage/);
    assert.match(error.message, /synthetic failure/);
    return true;
  });
});

test('only explicitly accepted nonzero status is successful', async () => {
  const result = await runCommand(process.execPath, ['-e', 'process.exit(3)'], { ...options, allowedCodes: [0, 3] });
  assert.equal(result.code, 3);
  await assert.rejects(runCommand(process.execPath, ['-e', 'process.exit(3)'], options), /exited 3/);
});

test('missing executable is rejected without waiting for the command deadline', async () => {
  await assert.rejects(runCommand(join(root, 'no-such-native-test-binary'), [], options), /ENOENT/);
});

test('a hung process is terminated and rejected at its deadline', async () => {
  await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
    ...options, timeoutMs: 100,
  }), /deadline/);
});

test('an interrupted process is terminated and cannot become a successful result', async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 100);
  try {
    await assert.rejects(runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      ...options, signal: controller.signal,
    }), /interrupted/);
  } finally { clearTimeout(timer); }
});

test('process diagnostics stay bounded while preserving the end of each stream', async () => {
  const result = await runCommand(process.execPath, ['-e',
    "process.stdout.write('x'.repeat(40000) + 'stdout-tail'); process.stderr.write('y'.repeat(40000) + 'stderr-tail');",
  ], options);
  assert.ok(result.stdout.length <= 16 * 1024);
  assert.ok(result.stderr.length <= 16 * 1024);
  assert.ok(result.stdout.endsWith('stdout-tail'));
  assert.ok(result.stderr.endsWith('stderr-tail'));
});
