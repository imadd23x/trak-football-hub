#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const securityMigration = '20260917205027_secure_parent_invites.sql';
const academyMigration = '20260918062345_preserve_academy_access_and_fk_cleanup.sql';
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const args = process.argv.slice(2);
const mode = args[0];
if (args.length > 1 || (mode && !['--baseline', '--coach-departure-review', '--coach-departure-baseline', '--pilot-views-review', '--pilot-views-baseline'].includes(mode))) {
  throw new Error('Usage: npm run test:db -- [--baseline | --coach-departure-review | --coach-departure-baseline | --pilot-views-review | --pilot-views-baseline]');
}
const baseline = mode === '--baseline';
const academyBaseline = mode === '--coach-departure-baseline';
const coachReview = mode === '--coach-departure-review' || academyBaseline;
const pilotViewsBaseline = mode === '--pilot-views-baseline';
const pilotViewsReview = mode === '--pilot-views-review' || pilotViewsBaseline;
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql') && (!baseline || file < securityMigration)
      && (!academyBaseline || file < academyMigration)
      && (!pilotViewsBaseline || file < pilotViewsMigration)).sort();
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
  console.log(`Replayed ${migrations.length} migrations${baseline || academyBaseline || pilotViewsBaseline ? ' (vulnerable baseline; security assertions should fail)' : ' with backfill assertions'}.`);
  const suites = coachReview ? [
    'coach_departure_review.sql',
    'academy_access_security.sql',
    // Setup commits its fixtures before account-deletion assertions, exercising
    // FK cleanup across transactions as well as same-transaction fixtures.
    'account_deletion_setup.sql',
    'account_deletion_assertions.sql',
  ] : pilotViewsReview ? ['pilot_view_security.sql'] : ['parent_invite_security.sql', 'pilot_view_security.sql'];
  for (const suite of suites) {
    try {
      const result = await db.exec(await read(suite));
      console.log(`Passed: ${suite}`);
      for (const query of result) {
        if (query.rows?.[0]?.pilot_view_assertions) console.log(`Operational view assertions: ${query.rows[0].pilot_view_assertions}`);
      }
    } catch (error) {
      throw new Error(`${suite}: ${error.message}`, { cause: error });
    }
  }
  if (baseline || academyBaseline || pilotViewsBaseline) throw new Error('Vulnerable baseline unexpectedly passed its security assertions');
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
