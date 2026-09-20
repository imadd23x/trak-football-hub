import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { validateMigrationFiles } from '../../scripts/migration-input.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const boundary = '20260920105000_academy_consent_read_boundary.sql';
async function replay({ mutate = sql => sql, baseline = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(await readFile(root + 'supabase/tests/bootstrap.sql', 'utf8'));
    for (const file of validateMigrationFiles(await readdir(root + 'supabase/migrations'))) {
      if (baseline && file >= boundary) continue;
      let sql = await readFile(root + 'supabase/migrations/' + file, 'utf8');
      if (file === boundary) sql = mutate(sql);
      await db.exec(sql);
    }
    let sql = await readFile(root + 'supabase/tests/academy_consent_reads.sql', 'utf8');
    try { return { passed: true, result: await db.exec(sql) }; }
    catch (error) { return { passed: false, message: error.message, detail: error.detail || '' }; }
  } finally { await db.close(); }
}

test('read boundary passes 43 real-role access assertions', async () => {
  const result = await replay();
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.ok(result.result.some(statement => statement.rows?.[0]?.academy_consent_read_assertions === 43));
});
test('pre-read-boundary database exposes withdrawn and private records', async () => {
  const result = await replay({ baseline: true });
  assert.equal(result.passed, false, JSON.stringify(result));
  for (const label of ['player never reads private coach notes', 'declining parent visibility hides development from that parent', 'last withdrawal stops all coach development reads']) {
    assert.ok(result.detail.includes(label), JSON.stringify(result));
  }
});
for (const [name, before, after, expected] of [
  ['private notes', "IF p_private AND", "IF false AND", 'player never reads private coach notes'],
  ['parent visibility', "IF role_name='parent' AND NOT trak_consent.has_guardian_approval", "IF false AND NOT trak_consent.has_guardian_approval", 'declining parent visibility hides development from that parent'],
  ['recognition choice', "IF p_purpose='recognition' AND NOT trak_consent.has_guardian_approval", "IF false AND NOT trak_consent.has_guardian_approval", 'recognition decline also applies to the player'],
  ['academy-specific visibility', "has_guardian_approval(p_child,p_org,'parent_visibility')", "has_guardian_approval(p_child,'96000000-0000-0000-0000-000000000102'::uuid,'parent_visibility')", 'declining parent visibility hides development from that parent'],
  ['reader verification', "AND u.email_confirmed_at IS NOT NULL AND nullif(btrim(u.email),'') IS NOT NULL", '', 'unverified linked parent cannot read development records'],
  ['current coaching approval', "IF NOT trak_consent.has_guardian_approval(p_child,p_org,'coaching_records')", "IF false", 'last withdrawal stops all coach development reads'],
]) {
  test(`read suite rejects removal of ${name}`, async () => {
    const result = await replay({ mutate: sql => {
      assert.equal(sql.split(before).length, 2, 'mutation must target exactly one actual rule');
      return sql.replace(before, after);
    } });
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.ok(result.detail.includes(expected), JSON.stringify(result));
  });
}
