#!/usr/bin/env node
import { PGlite } from '@electric-sql/pglite';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// An in-memory database by construction. Never reads DB_URL or connects to a
// Supabase project; SQL fixture guards also refuse an unmarked connection.
const root = fileURLToPath(new URL('../', import.meta.url));
const securityMigration = '20260917205027_secure_parent_invites.sql';
const baseline = process.argv.includes('--baseline');
if (process.argv.slice(2).some(arg => arg !== '--baseline')) {
  throw new Error('Usage: npm run test:db -- [--baseline]');
}
const db = new PGlite();
const read = name => readFile(resolve(root, 'supabase/tests', name), 'utf8');
try {
  await db.exec(await read('bootstrap.sql'));
  const { rows } = await db.query('SELECT version() AS version');
  console.log(`Disposable database: ${rows[0].version}`);
  const migrations = (await readdir(resolve(root, 'supabase/migrations')))
    .filter(file => file.endsWith('.sql') && (!baseline || file < securityMigration)).sort();
  for (const file of migrations) {
    try {
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_setup.sql'));
      await db.exec(await readFile(resolve(root, 'supabase/migrations', file), 'utf8'));
      if (file === securityMigration) await db.exec(await read('parent_invite_backfill_assertions.sql'));
    } catch (error) {
      throw new Error(`Migration ${file}: ${error.message}`, { cause: error });
    }
  }
  console.log(`Replayed ${migrations.length} migrations${baseline ? ' (vulnerable baseline; security assertions should fail)' : ' with backfill assertions'}.`);
  await db.exec(await read('parent_invite_security.sql'));
  console.log('Parent-invitation role, permission, expiry and replay assertions passed.');
} catch (error) {
  console.error(error.message);
  if (error.cause?.detail) console.error(error.cause.detail);
  process.exitCode = 1;
} finally {
  await db.close();
}
