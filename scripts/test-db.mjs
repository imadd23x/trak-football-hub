#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { historyUpgradeBase, historyMigration, parentHistoryUpgradeOrder, requireHistoryUpgradeSuiteOutput } from './lib/parent-history-upgrade.mjs';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const securityMigration = '20260917205027_secure_parent_invites.sql';
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const args = process.argv.slice(2);
const mode = args[0] ?? '--all';
const modes = ['--all', '--baseline', '--pilot-views-review', '--pilot-views-baseline', '--parent-upgrade-review', '--parent-history-upgrade-review'];
if (args.length > 1 || !modes.includes(mode)) {
  throw new Error(`Usage: node scripts/test-db.mjs [${modes.join(' | ')}]`);
}
const baseline = mode === '--baseline';
const pilotViewsBaseline = mode === '--pilot-views-baseline';
const parentUpgrade = mode === '--parent-upgrade-review';
const historyUpgrade = mode === '--parent-history-upgrade-review';
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  let migrations = (await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql')
      && (!baseline || file < securityMigration)
      && (!pilotViewsBaseline || file < pilotViewsMigration)).sort();
  if (parentUpgrade) {
    // PR35 was deployed before PR33. Replay that actual order as well as the
    // fresh-install order, retaining original filenames and immutable SQL.
    if (!migrations.includes(securityMigration) || !migrations.includes(pilotViewsMigration)) {
      throw new Error('Parent upgrade review requires both original migration files');
    }
    migrations.splice(migrations.indexOf(securityMigration), 1);
    migrations.splice(migrations.indexOf(pilotViewsMigration) + 1, 0, securityMigration);
  }
  if (historyUpgrade) migrations = await parentHistoryUpgradeOrder(root, migrations);
  let applied = 0;
  for (const file of migrations) {
    try {
      if (historyUpgrade && file === historyMigration) {
        if (applied !== 62) throw new Error('History migration must follow all 62 pinned-main migrations');
        const { rows } = await db.query("SELECT to_regprocedure('public.get_parent_match_summary(uuid)') IS NULL AND to_regprocedure('public.get_parent_match_page(uuid,date,timestamp with time zone,uuid,integer)') IS NULL AS absent");
        if (rows[0].absent !== true) throw new Error('History RPCs unexpectedly exist before pending migration');
        console.log(`Upgrade boundary: ${applied} migrations from main ${historyUpgradeBase} applied; history RPCs absent; applying ${file} next.`);
      }
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_setup.sql'));
      if (file === pilotViewsMigration) await db.exec(await read('pilot_view_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_assertions.sql'));
      applied++;
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  console.log(`Replayed ${migrations.length} migrations${baseline || pilotViewsBaseline
    ? ' (vulnerable baseline; security assertions should fail)'
    : historyUpgrade ? ' (exact main 0091094 first, then pending parent history)'
      : parentUpgrade ? ' (deployed reports first, then parent upgrade)' : ' with both backfill fixtures'}.`);
  const suites = baseline ? ['parent_invite_security.sql']
    : mode.startsWith('--pilot-views') ? ['pilot_view_security.sql']
    : ['parent_invite_security.sql', 'pilot_view_security.sql', 'parent_match_history.sql'];
  for (const suite of suites) {
    const result = await db.exec(await read(suite));
    if (historyUpgrade) requireHistoryUpgradeSuiteOutput(suite, result);
    console.log(`Passed: ${suite}`);
    if (historyUpgrade && suite === 'parent_invite_security.sql') console.log('Parent invitation assertions: 55');
    for (const query of result) {
      if (query.rows?.[0]?.parent_match_history_assertions) console.log(`Parent history assertions: ${query.rows[0].parent_match_history_assertions}`);
      if (query.rows?.[0]?.pilot_view_assertions) console.log(`Operational view assertions: ${query.rows[0].pilot_view_assertions}`);
    }
  }
  if (baseline || pilotViewsBaseline) throw new Error('Vulnerable baseline unexpectedly passed its security assertions');
} catch (error) {
  console.error(error.message);
  const detail = error.detail || error.cause?.detail;
  if (detail) {
    const lines = detail.split('\n');
    console.error(lines.slice(0, 20).join('\n'));
    if (lines.length > 20) console.error(`... ${lines.length - 20} additional assertion details omitted.`);
  }
  process.exitCode = 1;
} finally {
  await db.close();
}
