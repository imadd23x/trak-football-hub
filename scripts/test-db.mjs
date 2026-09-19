#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const securityMigration = '20260917205027_secure_parent_invites.sql';
const pilotViewsMigration = '20260918070209_restrict_pilot_operational_views.sql';
const args = process.argv.slice(2);
const mode = args[0] ?? '--all';
// Suites register themselves. Each suite .sql declares its own mode in a
// header pragma and this file discovers them:
//
//   -- @trak-suite mode=--consent-review in-all=false
//
// The reason is not tidiness. Four player-platform PRs were each MERGEABLE
// against main and conflicted with each other the moment any one of them
// landed, because every one of them hand-edited this same ternary chain. The
// bad outcome is not the conflict, it is a resolution that drops a suite:
// a suite that never runs is indistinguishable from a suite that passes.
// Adding a suite must not touch a shared file, so now it does not.
//
// in-all=true means the suite passes today and CI should run it. A suite that
// documents an unfixed defect sets in-all=false, or it turns main red for
// everyone and people learn to ignore the colour.
// Every .sql in supabase/tests declares what it is, in its own file:
//
//   -- @trak-suite mode=--consent-review in-all=false
//   -- @trak-suite mode=--academy-review in-all=true order=2
//   -- @trak-fixture
//
// A fixture is applied by name from the migration hooks below, not auto-run.
// `order` sequences several suites under one mode, for the case where one must
// run last because the others need a clean database.
//
// Declaring it per file rather than in a list here is the whole point: four
// player PRs collided on this file because each added its own flag, and #34
// adds seven more .sql files. A shared list would just move the collision.
//
// Naming convention was considered and rejected. #34's account_deletion_setup
// and account_deletion_assertions are named like fixtures and are SUITES — his
// runner executes them last, in order. A convention would have classified them
// by name and silently dropped both, which is the failure this guard exists to
// prevent, so the file has to say which it is rather than imply it.
const SUITE_PRAGMA = /^--\s*@trak-suite\s+(.*)$/m;
const FIXTURE_PRAGMA = /^--\s*@trak-fixture\b/m;
const suiteFiles = (await readdir(resolve(root, 'supabase/tests')))
  .filter(f => f.endsWith('.sql')).sort();
const registry = new Map();   // mode -> [{ file, order }]
const inAll = [];
for (const file of suiteFiles) {
  const head = (await readFile(resolve(root, 'supabase/tests', file), 'utf8')).slice(0, 4000);
  if (FIXTURE_PRAGMA.test(head)) continue;
  const found = head.match(SUITE_PRAGMA);
  // Not silently skipped. A typo in the pragma would otherwise delete a suite
  // from the run while leaving the file in the tree.
  if (!found) {
    throw new Error(`supabase/tests/${file} declares neither '-- @trak-suite' nor `
      + `'-- @trak-fixture'. Add whichever it is to the top of the file.`);
  }
  // Every attribute is validated, including the ones with a sensible-looking
  // default. Kostas found that `in-all` was not: `in-all=ture` silently
  // dropped the suite from --all and the run exited 0, which is the exact
  // failure this registry exists to prevent, reachable through the registry.
  // A typo must never be indistinguishable from a deliberate `false`.
  const KNOWN = new Set(['mode', 'in-all', 'order']);
  const attrs = {};
  for (const pair of found[1].trim().split(/\s+/)) {
    const eq = pair.indexOf('=');
    if (eq < 1) {
      throw new Error(`supabase/tests/${file}: '${pair}' is not key=value in @trak-suite`);
    }
    const key = pair.slice(0, eq);
    if (!KNOWN.has(key)) {
      throw new Error(`supabase/tests/${file}: unknown @trak-suite attribute '${key}'. `
        + `Known: ${[...KNOWN].join(', ')}`);
    }
    if (key in attrs) throw new Error(`supabase/tests/${file}: '${key}' given twice`);
    attrs[key] = pair.slice(eq + 1);
  }
  if (!attrs.mode?.startsWith('--')) {
    throw new Error(`supabase/tests/${file}: @trak-suite needs mode=--something`);
  }
  if (attrs['in-all'] !== 'true' && attrs['in-all'] !== 'false') {
    throw new Error(`supabase/tests/${file}: in-all must be exactly true or false, `
      + `got '${attrs['in-all'] ?? '(missing)'}'. A suite silently absent from --all is `
      + `indistinguishable from one that passes.`);
  }
  const order = Number(attrs.order ?? 0);
  if (!Number.isFinite(order)) {
    throw new Error(`supabase/tests/${file}: order must be a number, got '${attrs.order}'`);
  }
  const entry = { file, order };
  if (registry.has(attrs.mode)) registry.get(attrs.mode).push(entry);
  else registry.set(attrs.mode, [entry]);
  if (attrs['in-all'] === 'true') inAll.push(entry);
}
const ordered = entries => entries.slice()
  .sort((a, b) => a.order - b.order || a.file.localeCompare(b.file)).map(e => e.file);
const modes = [...new Set(['--all', '--baseline', '--pilot-views-review',
  '--pilot-views-baseline', '--parent-upgrade-review', ...registry.keys()])];
if (args.length > 1 || !modes.includes(mode)) {
  throw new Error(`Usage: node scripts/test-db.mjs [${modes.join(' | ')}]`);
}
const baseline = mode === '--baseline';
const pilotViewsBaseline = mode === '--pilot-views-baseline';
const parentUpgrade = mode === '--parent-upgrade-review';
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations')))
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
  for (const file of migrations) {
    try {
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_setup.sql'));
      if (file === pilotViewsMigration) await db.exec(await read('pilot_view_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_assertions.sql'));
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  console.log(`Replayed ${migrations.length} migrations${baseline || pilotViewsBaseline
    ? ' (vulnerable baseline; security assertions should fail)'
    : parentUpgrade ? ' (deployed reports first, then parent upgrade)' : ' with both backfill fixtures'}.`);
  const suites = registry.has(mode) ? ordered(registry.get(mode))
    : baseline ? ['parent_invite_security.sql']
    : mode.startsWith('--pilot-views') ? ['pilot_view_security.sql']
    // --all runs every in-all suite, so a regression is caught by the command
    // everyone already runs rather than only by a bespoke one.
    : ordered(inAll);
  // Printed so that a suite silently dropping out of the run is visible.
  console.log(`Suites (${mode}): ${suites.join(', ') || 'none'}`);
  for (const suite of suites) {
    const result = await db.exec(await read(suite));
    console.log(`Passed: ${suite}`);
    for (const query of result) {
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
