import test from 'node:test';
import assert from 'node:assert/strict';
import { applyDemo, createSupabaseAdapter, preflightDemo } from './apply.mjs';

const plan = {
  version: 1, namespace: 'synthetic-test',
  accounts: [{ id: 'a', email: 'a@example.invalid', fullName: 'Synthetic A' }],
  records: [{ table: 'profiles', row: { id: 'p', user_id: 'a', role: 'parent', created_at: '2026-09-25T00:00:00.000Z' } }],
};
const credentials = { namespace: plan.namespace, passwords: { a: 'only-a-synthetic-unit-test-password' } };
function fixture() {
  const accounts = new Map(); const records = new Map(); const writes = [];
  const adapter = {
    async getAccount(id) { return accounts.get(id) ?? null; },
    async createAccount(attributes) {
      writes.push('account');
      const { password: _password, ...account } = attributes;
      accounts.set(attributes.id, { ...account, email_confirmed_at: '2026-09-25T00:00:00Z' });
    },
    async getRecord({ row }) { return records.get(row.id) ?? null; },
    async createRecord({ row }) { writes.push('row'); records.set(row.id, { ...row }); },
  };
  return { adapter, accounts, records, writes };
}

test('identical second apply makes no writes and reports verified counts', async () => {
  const f = fixture();
  assert.deepEqual(await applyDemo(plan, f.adapter, credentials), { createdAccounts: 1, existingAccounts: 0, insertedRecords: 1, existingRecords: 0, verifiedByTable: { profiles: 1 } });
  f.records.get('p').created_at = '2026-09-25T04:00:00+04:00';
  const again = await applyDemo(plan, f.adapter, credentials);
  assert.equal(again.createdAccounts, 0); assert.equal(again.insertedRecords, 0);
  assert.deepEqual(f.writes, ['account', 'row']);
});

for (const field of ['email', 'namespace', 'confirmation']) {
  test(`foreign or unverifiable account ${field} aborts before any writes`, async () => {
    const f = fixture(); await applyDemo(plan, f.adapter, credentials); f.writes.length = 0;
    const account = f.accounts.get('a');
    if (field === 'email') account.email = 'someone-else@example.invalid';
    if (field === 'namespace') account.app_metadata.trak_demo_namespace = 'foreign';
    if (field === 'confirmation') account.email_confirmed_at = null;
    await assert.rejects(applyDemo(plan, f.adapter, credentials), /identity conflict/);
    assert.deepEqual(f.writes, []);
  });
}

test('conflict anywhere in the record preflight prevents even new account creation', async () => {
  const f = fixture(); f.records.set('p', { ...plan.records[0].row, role: 'club' });
  await assert.rejects(applyDemo(plan, f.adapter, credentials), /content conflict/);
  assert.deepEqual(f.writes, []);
});

test('read error is not treated as missing data', async () => {
  const f = fixture(); f.adapter.getRecord = async () => { throw new Error('unavailable'); };
  await assert.rejects(preflightDemo(plan, f.adapter), /unavailable/);
  assert.deepEqual(f.writes, []);
});

test('uncertain account response resumes by identity without duplicate creation or password reset', async () => {
  const f = fixture(); const create = f.adapter.createAccount;
  f.adapter.createAccount = async attributes => { await create(attributes); throw new Error('lost response'); };
  await assert.rejects(applyDemo(plan, f.adapter, credentials), /lost response/);
  f.adapter.createAccount = create;
  const result = await applyDemo(plan, f.adapter, credentials);
  assert.equal(result.existingAccounts, 1); assert.deepEqual(f.writes, ['account', 'row']);
});

test('post-insert validation rejects changed trigger results rather than reporting success', async () => {
  const f = fixture(); f.adapter.createRecord = async ({ row }) => { f.records.set(row.id, { ...row, user_id: 'other' }); };
  await assert.rejects(applyDemo(plan, f.adapter, credentials), /content conflict/);
});

test('missing credentials fails before mutation', async () => {
  const f = fixture(); await assert.rejects(applyDemo(plan, f.adapter, { namespace: 'wrong' }), /credentials/);
  assert.deepEqual(f.writes, []);
});

test('SDK adapter accepts only explicit user_not_found and never exposes provider errors', async () => {
  let error = { code: 'user_not_found', status: 404 };
  const adapter = createSupabaseAdapter({ auth: { admin: {
    getUserById: async () => ({ data: null, error }),
    createUser: async () => ({ error: { message: 'SECRET_MUST_NOT_LEAK' } }),
  } } });
  assert.equal(await adapter.getAccount('id'), null);
  error = { code: 'unknown', status: 404, message: 'SECRET_MUST_NOT_LEAK' };
  await assert.rejects(adapter.getAccount('id'), error => /lookup failed/.test(error.message) && !error.message.includes('SECRET'));
  await assert.rejects(adapter.createAccount({ id: 'id' }), error => /creation failed/.test(error.message) && !error.message.includes('SECRET'));
});
