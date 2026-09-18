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
const baseline = process.argv.includes('--baseline');
const academyBaseline = process.argv.includes('--coach-departure-baseline');
const coachReview = process.argv.includes('--coach-departure-review') || academyBaseline;
if ((baseline && coachReview) || (academyBaseline && process.argv.includes('--coach-departure-review')) || process.argv.slice(2).some(arg => !['--baseline', '--coach-departure-review', '--coach-departure-baseline'].includes(arg))) {
  throw new Error('Usage: npm run test:db -- [--baseline | --coach-departure-review | --coach-departure-baseline]');
}
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql') && (!baseline || file < securityMigration) && (!academyBaseline || file < academyMigration)).sort();
  for (const file of migrations) {
    try {
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_setup.sql'));
      if (file === academyMigration) await db.exec(await read('academy_orphan_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_assertions.sql'));
      if (file === academyMigration) await db.exec(await read('academy_orphan_backfill_assertions.sql'));
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  console.log(`Replayed ${migrations.length} migrations${baseline || academyBaseline ? ' (vulnerable baseline; security assertions should fail)' : ' with backfill assertions'}.`);
  const suites = coachReview ? [
    'coach_departure_review.sql',
    'academy_access_security.sql',
    // Setup commits its fixtures before account-deletion assertions, exercising
    // FK cleanup across transactions as well as same-transaction fixtures.
    'account_deletion_setup.sql',
    'account_deletion_assertions.sql',
  ] : ['parent_invite_security.sql'];
  for (const suite of suites) {
    try {
      await db.exec(await read(suite));
      console.log(`Passed: ${suite}`);
    } catch (error) {
      throw new Error(`${suite}: ${error.message}`, { cause: error });
    }
  }
  console.log(coachReview ? 'Coach departure review assertions passed.' : 'Parent-invitation role, permission, expiry and replay assertions passed.');
} catch (error) {
  console.error(error.message);
  if (error.cause?.detail) console.error(error.cause.detail);
  process.exitCode = 1;
} finally {
  await db.close();
}
