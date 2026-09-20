import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { validateMigrationFiles } from '../../scripts/migration-input.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const boundary = '20260920101000_academy_consent_write_boundary.sql';
const verdict = `RESET ROLE; DO $$ DECLARE failures text; BEGIN
 SELECT string_agg(description||coalesce(' ['||detail||']',''),E'\\n') INTO failures FROM ac_results WHERE NOT passed;
 IF failures IS NOT NULL THEN RAISE EXCEPTION 'Academy consent write assertions failed' USING DETAIL=failures; END IF;
END $$; ROLLBACK;`;
async function replay({ mutate = sql => sql, baseline = false } = {}) {
  const db = new PGlite();
  try {
    await db.exec(await readFile(root + 'supabase/tests/bootstrap.sql', 'utf8'));
    for (const file of validateMigrationFiles(await readdir(root + 'supabase/migrations'))) {
      if (baseline && file === boundary) continue;
      let sql = await readFile(root + 'supabase/migrations/' + file, 'utf8');
      if (file === boundary) sql = mutate(sql);
      await db.exec(sql);
    }
    let sql = await readFile(root + 'supabase/tests/academy_consent_writes.sql', 'utf8');
    if (baseline) sql = sql.split('SELECT pg_temp.ac_as(1);\nSELECT pg_temp.ac_grant(12,102,709,202);')[0] + verdict;
    try { return { passed: true, result: await db.exec(sql) }; }
    catch (error) { return { passed: false, message: error.message, detail: error.detail || '' }; }
  } finally { await db.close(); }
}

test('unchanged write boundary passes actual role and receipt assertions', async () => {
  const result = await replay();
  assert.equal(result.passed, true, JSON.stringify(result));
  assert.ok(result.result.some(statement => statement.rows?.[0]?.academy_consent_write_assertions === 36));
});
test('pre-cutover foundation fails the unauthorized development-write probes', async () => {
  const result = await replay({ baseline: true });
  assert.equal(result.passed, false, JSON.stringify(result));
  assert.match(result.detail, /17-year-old without academy approval cannot be assessed/);
  assert.match(result.detail, /unknown age cannot be assessed/);
  assert.match(result.detail, /unlinked roster cannot bypass guardian approval/);
  assert.match(result.detail, /legacy child-wide approval alone cannot authorize a ten-year-old/);
});
for (const [name, changes, expected] of [
  ['purpose enforcement', [["e.purposes->p_purpose='true'::jsonb", "e.purposes->'coaching_records'='true'::jsonb"]], 'coaching-only approval does not admit recognition'],
  ['academy isolation', [['d.organization_id=p_org AND e.action', 'e.action'], ['e.notice_id=notice AND e.purposes', 'e.purposes']], 'academy A grant cannot authorize a player match for B'],
  ['immutable provenance', [["IF TG_OP='UPDATE' AND (OLD.consent_child_id", "IF false AND (OLD.consent_child_id"]], 'match cannot be reparented to another academy'],
  ['DOB protection', [['IF NOT trak_consent.is_maintenance() AND OLD.date_of_birth', 'IF false AND OLD.date_of_birth']], 'player cannot change established DOB to bypass approval'],
  ['receipt-after-persistence', [['zz_consent_write_receipt AFTER INSERT OR UPDATE', 'zz_consent_write_receipt BEFORE INSERT OR UPDATE']], 'conflict no-op creates no phantom receipt'],
]) {
  test(`role suite rejects removal of ${name}`, async () => {
    const result = await replay({ mutate: sql => {
      for (const [before, after] of changes) {
        assert.equal(sql.split(before).length, 2, 'mutation must target exactly one actual rule');
        sql = sql.replace(before, after);
      }
      return sql;
    } });
    assert.equal(result.passed, false, JSON.stringify(result));
    assert.ok(result.detail.includes(expected), JSON.stringify(result));
  });
}
