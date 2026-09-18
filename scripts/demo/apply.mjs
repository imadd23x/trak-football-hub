// Server-side tooling only. No application imports, implicit target or .env.
export function verifyAccount(plan, expected, actual) {
  if (!actual || actual.id !== expected.id || actual.email !== expected.email
    || actual.app_metadata?.trak_demo_namespace !== plan.namespace
    || actual.app_metadata?.trak_demo_version !== plan.version
    || !actual.email_confirmed_at || actual.is_anonymous === true) {
    throw new Error(`Account identity conflict for ${expected.id}; no existing account will be changed`);
  }
}

function sameValue(column, expected, actual) {
  // PostgREST normalizes timestamptz offsets; equal instants are equal fixtures.
  if (column.endsWith('_at') && typeof expected === 'string' && typeof actual === 'string') {
    const time = Date.parse(expected);
    if (Number.isFinite(time)) return time === Date.parse(actual);
  }
  return JSON.stringify(expected) === JSON.stringify(actual);
}

export function verifyRecord({ table, row }, actual) {
  if (!actual || Object.entries(row).some(([column, value]) => !sameValue(column, value, actual[column]))) {
    throw new Error(`Fixture content conflict for ${table}/${row.id}; existing data was not overwritten`);
  }
}

export async function preflightDemo(plan, adapter) {
  const existingAccounts = new Set();
  const existingRecords = new Set();
  // Finish every preflight read before the first mutation. A failure is fatal.
  for (const account of plan.accounts) {
    const existing = await adapter.getAccount(account.id);
    if (existing) {
      verifyAccount(plan, account, existing);
      existingAccounts.add(account.id);
    }
  }
  for (const record of plan.records) {
    const existing = await adapter.getRecord(record);
    if (existing) {
      verifyRecord(record, existing);
      existingRecords.add(`${record.table}/${record.row.id}`);
    }
  }
  return { existingAccounts, existingRecords };
}

export async function applyDemo(plan, adapter, credentials) {
  const { existingAccounts, existingRecords } = await preflightDemo(plan, adapter);
  if (credentials.namespace !== plan.namespace || !credentials.passwords
    || plan.accounts.some(account => typeof credentials.passwords[account.id] !== 'string'
      || credentials.passwords[account.id].length < 24)) {
    throw new Error('Missing or mismatched private credentials; refusing account creation');
  }
  const result = { createdAccounts: 0, existingAccounts: 0, insertedRecords: 0, existingRecords: 0, verifiedByTable: {} };
  for (const account of plan.accounts) {
    if (!existingAccounts.has(account.id)) {
      await adapter.createAccount({
        id: account.id, email: account.email, password: credentials.passwords[account.id],
        email_confirm: true,
        app_metadata: { trak_demo_namespace: plan.namespace, trak_demo_version: plan.version },
        user_metadata: { full_name: account.fullName },
      });
    }
    verifyAccount(plan, account, await adapter.getAccount(account.id));
    result[existingAccounts.has(account.id) ? 'existingAccounts' : 'createdAccounts']++;
  }
  for (const record of plan.records) {
    const exists = existingRecords.has(`${record.table}/${record.row.id}`);
    if (!exists) await adapter.createRecord(record);
    verifyRecord(record, await adapter.getRecord(record));
    result[exists ? 'existingRecords' : 'insertedRecords']++;
    result.verifiedByTable[record.table] = (result.verifiedByTable[record.table] ?? 0) + 1;
  }
  return result;
}

export function createSupabaseAdapter(client) {
  return {
    async getAccount(id) {
      const { data, error } = await client.auth.admin.getUserById(id);
      if (error?.code === 'user_not_found') return null;
      if (error) throw new Error(`Auth lookup failed for ${id}; application stopped`);
      if (!data?.user) throw new Error(`Auth lookup returned no verifiable identity for ${id}`);
      return data.user;
    },
    async createAccount(attributes) {
      const { error } = await client.auth.admin.createUser(attributes);
      if (error) throw new Error(`Auth creation failed for ${attributes.id}; rerun the same manifest to reconcile an uncertain result`);
    },
    async getRecord(record) {
      const { data, error } = await client.from(record.table)
        .select(Object.keys(record.row).join(',')).eq('id', record.row.id).maybeSingle();
      if (error) throw new Error(`Database lookup failed for ${record.table}/${record.row.id}; application stopped`);
      return data;
    },
    async createRecord(record) {
      const { error } = await client.from(record.table).insert(record.row);
      if (error) throw new Error(`Database insert failed for ${record.table}/${record.row.id}; rerun the same manifest to reconcile an uncertain result`);
    },
  };
}
