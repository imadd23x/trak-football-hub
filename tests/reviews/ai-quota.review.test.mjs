// Opt-in actual-role audit: node --test tests/reviews/ai-quota.review.test.mjs
// Replays only the target quota migration plus the repository platform bootstrap.
// No connection URL, HTTP, hosted database or application-schema replay.
import assert from 'node:assert/strict';
import { before, after, beforeEach, afterEach, test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

const db = new PGlite();
const firstUser = '99000000-0000-4000-8000-000000000041';
const secondUser = '99000000-0000-4000-8000-000000000042';

before(async () => {
  await db.exec(await readFile(new URL('../../supabase/tests/bootstrap.sql', import.meta.url), 'utf8'));
  const marker = await db.query("SELECT current_setting('trak.test_database', true) AS marker");
  assert.equal(marker.rows[0].marker, 'disposable');
  await db.exec(await readFile(new URL('../../supabase/migrations/20260918000002_ai_call_quota.sql', import.meta.url), 'utf8'));
  await db.query('INSERT INTO auth.users(id,email) VALUES ($1,$2),($3,$4)',
    [firstUser, 'first@quota.test.invalid', secondUser, 'second@quota.test.invalid']);
});
after(async () => { await db.close(); });
beforeEach(async () => { await db.exec('BEGIN'); });
afterEach(async () => { await db.exec('ROLLBACK'); });

async function asUser(userId) {
  await db.exec('SET LOCAL ROLE authenticated');
  await db.query("SELECT set_config('request.jwt.claims', $1, true)",
    [JSON.stringify({ sub: userId, role: 'authenticated' })]);
  const role = await db.query('SELECT current_user AS role, auth.uid() AS id');
  assert.deepEqual(role.rows[0], { role: 'authenticated', id: userId });
}

test('CONTROL: a known function caps allowance and keeps users isolated', async () => {
  await asUser(firstUser);
  const claims = await db.query("SELECT public.claim_ai_call('parse-schedule',40) AS allowed FROM generate_series(1,41)");
  assert.deepEqual(claims.rows.map(row => row.allowed), [...Array(40).fill(true), false]);
  const own = await db.query('SELECT user_id, call_count FROM public.ai_usage_daily');
  assert.deepEqual(own.rows, [{ user_id: firstUser, call_count: 40 }]);
  await asUser(secondUser);
  assert.deepEqual((await db.query('SELECT user_id FROM public.ai_usage_daily')).rows, []);
  assert.equal((await db.query("SELECT public.claim_ai_call('parse-schedule',40) AS allowed")).rows[0].allowed, true);
  assert.deepEqual((await db.query('SELECT user_id,call_count FROM public.ai_usage_daily')).rows,
    [{ user_id: secondUser, call_count: 1 }]);
});

test('CONTROL: anonymous execution is denied', async () => {
  await db.exec('SET LOCAL ROLE anon');
  // Legacy explicit anon EXECUTE grants can survive revoking PUBLIC. Either
  // ACL denial or the function's auth.uid() guard must reject the operation.
  await assert.rejects(db.query("SELECT public.claim_ai_call('parse-schedule',40)"), /permission denied|Not authenticated/i);
});

test('CONTROL: authenticated direct counter writes are denied', async () => {
  await asUser(firstUser);
  await assert.rejects(db.query("INSERT INTO public.ai_usage_daily(user_id,function_name) VALUES ($1,'parse-schedule')", [firstUser]),
    /permission denied|row-level security/i);
});

test('rejects arbitrary function names without creating extra daily counter rows', async () => {
  await asUser(firstUser);
  const attempts = [];
  for (const name of ['synthetic-not-an-edge-function-a', 'synthetic-not-an-edge-function-b']) {
    await db.exec('SAVEPOINT attempt');
    try {
      const result = await db.query('SELECT public.claim_ai_call($1,40) AS allowed', [name]);
      attempts.push({ name, allowed: result.rows[0].allowed });
    } catch {
      await db.exec('ROLLBACK TO SAVEPOINT attempt');
      attempts.push({ name, allowed: false });
    }
    await db.exec('RELEASE SAVEPOINT attempt');
  }
  const stored = await db.query('SELECT function_name,call_count FROM public.ai_usage_daily ORDER BY function_name');
  assert.deepEqual({ attempts, stored: stored.rows }, {
    attempts: attempts.map(({ name }) => ({ name, allowed: false })), stored: [],
  }, 'unrecognized function keys must not become writable rows through the public definer RPC');
});
