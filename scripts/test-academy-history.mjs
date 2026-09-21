#!/usr/bin/env node
// Disposable SQL replay/mutations. Never reads deployment URLs or credentials.
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { validateMigrationFiles } from './migration-input.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = resolve(root, 'supabase/migrations');
const files = validateMigrationFiles(await readdir(directory));
const academy = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
const repair = '20260920152925_preserve_closed_academy_history.sql';
// The one #44 file this script reads by name: the old roster trigger it mutates.
const orgPin = '20260918224500_org_pin_allows_referential_cleanup.sql';
for (const file of [academy, repair, orgPin]) assert.ok(files.includes(file), `Missing dependency ${file}`);
// "Later" is everything that landed after the academy migration's version,
// not a frozen list of #44's eight files. The frozen list broke main the
// moment #84 merged: its migration references coach_shared_feedback (created
// by #44), sorted into "released", and ran before the table existed in both
// pinned histories. Anything newer than the academy migration must replay
// after it in the coach-first history, whichever PR it came from.
// Plain version split. The parent-upgrade reorder the old `released` list
// carried is exercised by its own CI step (--parent-upgrade-review); its
// pivot migration sorts after the academy one, so it cannot be applied to
// the earlier half alone and is not this script's question.
const earlier = files.filter(file => file < academy);
const later = files.filter(file => file > academy && file !== repair);
assert.ok(later.length >= 8, `Expected #44's migrations among the later set, found ${later.length}`);
const read = name => readFile(resolve(directory, name), 'utf8');
const test = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
const correction = await read(repair);
const histories = [
  ['fresh', files],
  ['coach_then_academy', [...earlier, ...later, academy, repair]],
  ['academy_then_coach', [...earlier, academy, ...later, repair]],
];
const suites = ['academy_access_security.sql', 'org_referential_cleanup.sql'];
const signatures = [];
async function observe(db) {
  return (await db.query(`SELECT proname, pg_get_functiondef(oid) AS body,
    obj_description(oid,'pg_proc') AS comment, proacl::text AS acl
    FROM pg_proc WHERE oid IN ('public.pin_org_id_on_update()'::regprocedure,
    'public.set_squad_player_org_id()'::regprocedure) ORDER BY proname`)).rows;
}
function removeRange(body, start, end) {
  const a = body.indexOf(start), b = body.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, 'Mutation must remove the intended branch');
  return body.slice(0, a) + body.slice(b);
}
function triggerDefinition(body, name) {
  const start = body.indexOf(`CREATE OR REPLACE FUNCTION public.${name}()`);
  const end = body.indexOf('$fn$;', start);
  assert.ok(start >= 0 && end > start, `Missing trigger ${name}`);
  return body.slice(start, end + '$fn$;'.length);
}
async function expectMutation(db, label, definition, suite, error) {
  await db.exec(definition);
  await assert.rejects(db.exec(await test(suite)), error, label);
  await db.exec('ROLLBACK;');
  await db.exec(correction);
  console.log(`[academy-history] CAUGHT ${label}`);
}
for (const [label, order] of histories) {
  assert.deepEqual([...order].sort(), files, `${label}: every migration once`);
  const db = new PGlite();
  try {
    await db.exec(await test('bootstrap.sql'));
    for (const file of order) await db.exec(await read(file));
    signatures.push(await observe(db));
    for (const suite of suites) await db.exec(await test(suite));
    console.log(`[academy-history] ${label}: ${order.length} migrations, both history suites PASS`);
    if (label !== 'fresh') continue;
    await expectMutation(db, 'closed-record attribution guard removed',
      removeRange(correction, '  -- Both trigger-bearing tables', '  -- Preserve #44'),
      suites[0], /closed assessments and awards cannot acquire/);
    await expectMutation(db, 'genuine first attribution removed',
      removeRange(correction, "  -- Preserve #44", '  -- Real FK cleanup'),
      suites[1], /an unattributed assessment is adopted/);
    const oldRoster = triggerDefinition(await read(orgPin), 'set_squad_player_org_id');
    await expectMutation(db, 'roster closure guard removed', oldRoster,
      suites[0], /coach cannot read closed history/);
    // Recreate the old trigger's forgeable-marker state in this disposable DB.
    // Refuse ambiguous history before changing any function, instead of guessing
    // that a live-academy reference belonged to a now-deleted academy.
    await db.exec(oldRoster);
    await db.exec(`
      INSERT INTO auth.users(id,email,email_confirmed_at) VALUES
        ('96000000-0000-0000-0000-000000000001','history-admin@test.invalid',now()),
        ('96000000-0000-0000-0000-000000000002','history-coach@test.invalid',now());
      INSERT INTO public.profiles(user_id,role,full_name) VALUES
        ('96000000-0000-0000-0000-000000000001','club','History Admin'),
        ('96000000-0000-0000-0000-000000000002','coach','History Coach');
      INSERT INTO public.organizations(id,admin_user_id,name,join_code) VALUES
        ('96000000-0000-0000-0000-000000000010','96000000-0000-0000-0000-000000000001','History Academy','HISTORY-TEST');
      INSERT INTO public.coach_details(user_id,organization_id) VALUES
        ('96000000-0000-0000-0000-000000000002','96000000-0000-0000-0000-000000000010');
      INSERT INTO public.squad_players(id,coach_user_id,player_name) VALUES
        ('96000000-0000-0000-0000-000000000020','96000000-0000-0000-0000-000000000002','Ambiguous history');
      UPDATE public.squad_players SET organization_deleted_at=now()
        WHERE id='96000000-0000-0000-0000-000000000020';
    `);
    const before = await observe(db);
    await assert.rejects(db.exec(correction), /ambiguous academy references; reviewed repair required/);
    assert.deepEqual(await observe(db), before, 'Ambiguous data must stop before partial function updates');
    assert.equal((await db.query(`SELECT count(*)::int AS n FROM public.squad_players
      WHERE id='96000000-0000-0000-0000-000000000020'
        AND organization_id IS NOT NULL AND organization_deleted_at IS NOT NULL`)).rows[0].n, 1);
    console.log('[academy-history] Ambiguous legacy state refused without partial function changes.');
  } finally { await db.close(); }
}
assert.deepEqual(signatures[0], signatures[1], 'Fresh and coach-first functions/comments/ACLs must converge');
assert.deepEqual(signatures[0], signatures[2], 'Fresh and academy-first functions/comments/ACLs must converge');
console.log('[academy-history] All migration histories converge; mutation controls passed.');
