import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat, chmod, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, validateTarget, validateServiceKey, credentialsName, loadCredentials } from './cli.mjs';

const hosted = 'https://abcdefghijklmnopqrst.supabase.co';
const plan = { namespace: 'synthetic-test', accounts: [{ id: 'one' }, { id: 'two' }] };
test('target requires an exact explicit confirmation and rejects unsafe origins', () => {
  for (const target of ['http://abcdefghijklmnopqrst.supabase.co', 'https://evil.invalid', `${hosted}/rest/v1`, `${hosted}?key=x`, `${hosted}#x`, 'https://user:secret@abcdefghijklmnopqrst.supabase.co', 'file:///tmp/x', `${hosted}:444`]) {
    assert.throws(() => validateTarget(target, new URL(target).origin));
  }
  assert.throws(() => validateTarget(hosted, undefined), /confirm-target/);
  assert.equal(validateTarget(hosted, hosted), hosted);
  assert.equal(validateTarget('http://127.0.0.1:54321', 'http://127.0.0.1:54321'), 'http://127.0.0.1:54321');
});
test('CLI is plan by default and rejects ambiguous, missing, repeated or secret arguments', () => {
  assert.deepEqual(parseArgs(['--as-of', '2026-09-25']), { apply: false, asOf: '2026-09-25' });
  for (const args of [['--apply', '--plan'], ['--as-of'], ['--url', hosted], ['--service-key', 'do-not-print-me'], ['--apply', '--apply']]) assert.throws(() => parseArgs(args));
});
test('key classification rejects anon/publishable keys without printing values', () => {
  const jwt = role => `header.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.signature`;
  validateServiceKey(jwt('service_role')); validateServiceKey('sb_secret_synthetic_test_key');
  for (const key of [undefined, '', 'sb_publishable_test_key', jwt('anon'), 'random-secret-value-not-valid']) {
    assert.throws(() => validateServiceKey(key), error => !key || !error.message.includes(key));
  }
});
test('private credential file is reusable, target-bound and never stores the server key', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'trak-demo-credentials-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, credentialsName(hosted, plan.namespace));
  const first = await loadCredentials(path, hosted, plan, new Set());
  assert.equal((await stat(path)).mode & 0o777, 0o600);
  assert.ok(first.passwords.one.length >= 24); assert.notEqual(first.passwords.one, first.passwords.two);
  assert.deepEqual(await loadCredentials(path, hosted, plan, new Set(['one'])), first);
  assert.equal((await readFile(path, 'utf8')).includes('service_key'), false);
  await assert.rejects(loadCredentials(path, 'http://localhost:54321', plan, new Set()), /do not match/);
  await chmod(path, 0o644);
  await assert.rejects(loadCredentials(path, hosted, plan, new Set()), /private regular file/);
});
test('lost credentials and symlinks fail closed; existing passwords never reset', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'trak-demo-state-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'credentials.json');
  await assert.rejects(loadCredentials(path, hosted, plan, new Set(['one'])), /original private credentials/);
  const other = join(dir, 'other'); await writeFile(other, 'private', { mode: 0o600 }); await symlink(other, path);
  await assert.rejects(loadCredentials(path, hosted, plan, new Set()), /private regular file/);
});
test('real CLI plan ignores application env and credentials and writes no state', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'trak-demo-plan-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
  const output = execFileSync(process.execPath, [cli, '--as-of', '2026-09-25'], {
    cwd: dir, encoding: 'utf8', env: { ...process.env, VITE_SUPABASE_URL: 'https://must-not-contact.invalid', TRAK_DEMO_SERVICE_KEY: 'must-not-print-or-use-me' },
  });
  assert.equal(JSON.parse(output).namespace, 'trak-demo-v1-2026-09-25');
  assert.equal(output.includes('must-not-print'), false);
  await assert.rejects(stat(join(dir, '.local')), { code: 'ENOENT' });
});
