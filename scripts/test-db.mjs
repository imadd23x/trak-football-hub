#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const args = process.argv.slice(2);
const mode = args[0] ?? '--pilot-views-review';
const modes = ['--pilot-views-review', '--pilot-views-baseline', '--roster-adoption-review', '--feedback-publication-review'];
if (args.length > 1 || !modes.includes(mode)) {
  throw new Error(`Usage: node scripts/test-db.mjs [${modes.join(' | ')}]`);
}
const pilotViewsBaseline = mode === '--pilot-views-baseline';
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql')
      && (!pilotViewsBaseline || file < pilotViewsMigration)).sort();
  for (const file of migrations) {
    try {
      if (file === pilotViewsMigration) await db.exec(await read('pilot_view_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  console.log(`Replayed ${migrations.length} migrations${pilotViewsBaseline ? ' (vulnerable baseline; security assertions should fail)' : ' with legacy privilege fixtures'}.`);
  const suites = mode === '--roster-adoption-review' ? ['roster_adoption.sql']
    : mode === '--feedback-publication-review' ? ['feedback_publication.sql']
    : ['pilot_view_security.sql'];
  for (const suite of suites) {
    const result = await db.exec(await read(suite));
    console.log(`Passed: ${suite}`);
    for (const query of result) {
      if (query.rows?.[0]?.pilot_view_assertions) console.log(`Operational view assertions: ${query.rows[0].pilot_view_assertions}`);
    }
  }
  if (pilotViewsBaseline) throw new Error('Vulnerable baseline unexpectedly passed its security assertions');
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
