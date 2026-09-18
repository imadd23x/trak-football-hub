#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { migrationReplayOrder } from './test-native-db.mjs';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const securityMigration = '20260917205027_secure_parent_invites.sql';
const academyMigration = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const args = process.argv.slice(2);
const mode = args[0] ?? '--all';
const modes = ['--all', '--baseline', '--pilot-views-review', '--pilot-views-baseline',
  '--parent-upgrade-review', '--coach-departure-review', '--coach-departure-baseline', '--academy-upgrade-review', '--assessment-upgrade-review'];
if (args.length > 1 || !modes.includes(mode)) {
  throw new Error(`Usage: node scripts/test-db.mjs [${modes.join(' | ')}]`);
}
const baseline = mode === '--baseline';
const pilotViewsBaseline = mode === '--pilot-views-baseline';
const academyBaseline = mode === '--coach-departure-baseline';
const coachReview = mode === '--coach-departure-review' || academyBaseline;
const academyUpgrade = mode === '--academy-upgrade-review';
const assessmentUpgrade = mode === '--assessment-upgrade-review';
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = migrationReplayOrder((await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql')
      && (!baseline || file < securityMigration)
      && (!pilotViewsBaseline || file < pilotViewsMigration)
      && (!academyBaseline || file < academyMigration)), mode);
  for (const file of migrations) {
    try {
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_setup.sql'));
      if (file === academyMigration) await db.exec(await read('academy_orphan_backfill_setup.sql'));
      if (file === pilotViewsMigration) await db.exec(await read('pilot_view_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_assertions.sql'));
      if (file === academyMigration) await db.exec(await read('academy_orphan_backfill_assertions.sql'));
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  const description = baseline || pilotViewsBaseline || academyBaseline
    ? ' (vulnerable baseline; security assertions should fail)'
    : mode === '--parent-upgrade-review' ? ' (deployed reports first, then parent upgrade)'
      : assessmentUpgrade ? ' (deployed main first, then academy repair, then assessment index)'
        : academyUpgrade ? ' (deployed main first, then academy repair)' : ' with backfill assertions';
  console.log(`Replayed ${migrations.length} migrations${description}.`);
  const academySuites = ['coach_departure_review.sql', 'academy_access_security.sql',
    // Committed deletion fixtures must remain last: other suites expect a clean DB.
    'account_deletion_setup.sql', 'account_deletion_assertions.sql'];
  const suites = baseline ? ['parent_invite_security.sql']
    : mode.startsWith('--pilot-views') ? ['pilot_view_security.sql']
      : coachReview ? academySuites
        : ['parent_invite_security.sql', 'pilot_view_security.sql', ...(academyUpgrade || assessmentUpgrade ? academySuites : [])];
  for (const suite of suites) {
    try {
      const result = await db.exec(await read(suite));
      console.log(`Passed: ${suite}`);
      for (const query of result) {
        if (query.rows?.[0]?.pilot_view_assertions) console.log(`Operational view assertions: ${query.rows[0].pilot_view_assertions}`);
        if (query.rows?.[0]?.account_deletion_checks_passed) console.log(`Account deletion assertions: ${query.rows[0].account_deletion_checks_passed}`);
      }
    } catch (error) {
      throw new Error(`${suite}: ${error.message}`, { cause: error });
    }
  }
  if (baseline || pilotViewsBaseline || academyBaseline) throw new Error('Vulnerable baseline unexpectedly passed its security assertions');
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
