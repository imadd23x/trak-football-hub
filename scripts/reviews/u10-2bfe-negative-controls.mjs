#!/usr/bin/env node
// Exact-source review evidence; synthetic in-memory PostgreSQL only.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const sha = '2bfe53797b1f8ca9b201fc53f6aa9619db7cad45';
const cwd = fileURLToPath(new URL('../../', import.meta.url));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
const git = (...args) => execFileSync('git', ['--no-replace-objects', ...args], { cwd, env, encoding: 'utf8' });
const read = path => git('show', `${sha}:${path}`);
const db = new PGlite();
const query = async sql => (await db.query(sql)).rows;
try {
  await db.exec(read('supabase/tests/bootstrap.sql'));
  // Same exact-source migration/backfill ordering as the candidate test-db.mjs.
  const migrations = git('ls-tree', '-r', '--name-only', sha, 'supabase/migrations')
    .trim().split('\n').filter(path => path.endsWith('.sql')).sort();
  for (const path of migrations) {
    if (path.endsWith('20260917205027_secure_parent_invites.sql')) await db.exec(read('supabase/tests/parent_invite_backfill_setup.sql'));
    if (path.endsWith('20260918070209_restrict_pilot_operational_views.sql')) await db.exec(read('supabase/tests/pilot_view_backfill_setup.sql'));
    await db.exec(read(path));
    if (path.endsWith('20260917205027_secure_parent_invites.sql')) await db.exec(read('supabase/tests/parent_invite_backfill_assertions.sql'));
  }
  console.log(JSON.stringify({ sha, migrations: migrations.length, engine: await query('SELECT version()') }));
  const suite = read('supabase/tests/account_deletion.sql');
  const rpc = (await query("SELECT pg_get_functiondef('public.delete_my_account()'::regprocedure) AS sql"))[0].sql;
  // First execute the complete unmodified suite, including its real failure.
  await assert.rejects(db.exec(suite), error => error.code === 'P0001'
    && error.message === 'Account deletion: 2 of 13 desired assertions failed');
  await db.exec('ROLLBACK');
  console.log('Original complete suite: FAIL (2/13), not a passing U10 gate.');
  const cases = [
    ['unchanged', rpc, [10], false],
    ['parent-no-op', rpc.replace("  -- ── Coach", "  IF v_role = 'parent' THEN RETURN; END IF;\n  -- ── Coach"), [10, 13], true],
    ['auth-delete-removed', rpc.replace('DELETE FROM auth.users      WHERE id = v_uid;', 'NULL;'), [10, 11, 12, 13], false],
    ['coach-deletes-roster', rpc.replace("IF v_role = 'coach' THEN", "IF v_role = 'coach' THEN\n    DELETE FROM public.squad_players WHERE coach_user_id = v_uid;"), [10], false],
  ];
  let baseline;
  for (const [name, sql, survivors, parentSurvives] of cases) {
    if (name !== 'unchanged') assert.notEqual(sql, rpc, `${name} mutation must apply`);
    await db.exec(sql);
    // Preserve every assertion; inspect rows before the unchanged terminal report
    // aborts the transaction and makes those rows unavailable to this adapter.
    await db.exec(suite.split('-- ── Report')[0]);
    const results = await query('SELECT * FROM pg_temp.del_results ORDER BY description');
    const auth = await query('SELECT right(id::text,2)::integer AS n FROM auth.users WHERE id IN (pg_temp.did(10),pg_temp.did(11),pg_temp.did(12),pg_temp.did(13)) ORDER BY id');
    const profile = await query('SELECT user_id FROM public.profiles WHERE user_id = pg_temp.did(13)');
    assert.deepEqual(auth.map(row => row.n), survivors, `${name}: actual retained Auth accounts`);
    assert.equal(profile.length === 1, parentSurvives, `${name}: actual parent profile`);
    if (!baseline) {
      baseline = results;
      assert.deepEqual(results.filter(row => !row.passed).map(row => row.description), [
        'a club admin can delete their own account', "the deleted club admin's academy is gone",
      ]);
      assert.match(results.find(row => row.description === 'a club admin can delete their own account').detail,
        /^23503:.*squad_players_organization_id_fkey/);
    } else assert.deepEqual(results, baseline, `${name}: every suite result remains unchanged`);
    console.log(JSON.stringify({ name, passed: results.filter(row => row.passed).length, total: results.length, retainedAuth: auth, retainedParentProfile: profile, failures: results.filter(row => !row.passed) }));
    await db.exec('ROLLBACK');
  }
  // Prove the roster mutation is damaging when the leaving coach still has a
  // living child, unlike the candidate's player-before-coach deletion order.
  for (const [name, sql] of [cases[0], cases[3]]) {
    await db.exec(sql);
    await db.exec(suite.split('-- ── Each role deletes itself')[0]);
    await db.exec('SET LOCAL ROLE authenticated; SELECT pg_temp.dactor(pg_temp.did(11)); SELECT public.delete_my_account(); RESET ROLE;');
    const rows = await query('SELECT id FROM public.squad_players WHERE id=pg_temp.did(200)');
    const child = await query('SELECT id FROM auth.users WHERE id=pg_temp.did(12)');
    const otherRoster = await query('SELECT id FROM public.squad_players WHERE id=pg_temp.did(201)');
    assert.equal(rows.length, name === 'unchanged' ? 1 : 0, `${name}: actual own-child roster preservation`);
    assert.equal(child.length, 1, 'living child Auth account survives');
    assert.equal(otherRoster.length, 1, 'other coach roster survives');
    console.log(JSON.stringify({ probe: 'coach-first', name, ownChildRoster: rows.length, childAuth: child.length, otherCoachRoster: otherRoster.length }));
    await db.exec('ROLLBACK');
  }
  console.error('REVIEW FINDINGS REPRODUCED: U10 is red; all three broken implementations evade its current assertions.');
  process.exitCode = 1;
} finally {
  await db.close();
}
