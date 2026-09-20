import { afterEach, describe, expect, it } from 'vitest'
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = resolve(__dirname, '../..')
const fixtures: string[] = []

function runMigrations(files: Record<string, string>, mode = '--all') {
  const fixture = mkdtempSync(join(tmpdir(), 'trak-migration-input-'))
  fixtures.push(fixture)
  for (const directory of ['scripts', 'supabase/migrations', 'supabase/tests']) {
    mkdirSync(join(fixture, directory), { recursive: true })
  }
  copyFileSync(join(root, 'scripts/test-db.mjs'), join(fixture, 'scripts/test-db.mjs'))
  for (const dependency of ['scripts/migration-input.mjs', 'scripts/test-native-db.mjs']) {
    if (existsSync(join(root, dependency))) copyFileSync(join(root, dependency), join(fixture, dependency))
  }
  symlinkSync(join(root, 'node_modules'), join(fixture, 'node_modules'), 'dir')
  writeFileSync(join(fixture, 'supabase/tests/bootstrap.sql'), 'SELECT 1;')
  // Keep suite declarations when the registry runner lands (#42). These tests
  // exercise migration input, so every real suite gets a harmless SQL stub.
  for (const suite of readdirSync(join(root, 'supabase/tests')).filter(file => file.endsWith('.sql'))) {
    const source = readFileSync(join(root, 'supabase/tests', suite), 'utf8')
    const pragma = source.match(/^--\s*@trak-(?:suite|fixture)\b.*$/m)?.[0] ?? ''
    writeFileSync(join(fixture, 'supabase/tests', suite), `${pragma}\nSELECT 1;`)
  }
  for (const [file, sql] of Object.entries(files)) {
    writeFileSync(join(fixture, 'supabase/migrations', file), sql)
  }
  return spawnSync(process.execPath, [join(fixture, 'scripts/test-db.mjs'), mode], {
    cwd: fixture,
    encoding: 'utf8',
    timeout: 15_000,
    env: { PATH: process.env.PATH, TZ: 'UTC' },
  })
}

afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

describe('database runner migration input', () => {
  it('replays uniquely versioned migrations in order and runs the suites', () => {
    const result = runMigrations({
      '20260919170001_second.sql': 'INSERT INTO migration_probe VALUES (2);',
      '20260919170000_first.sql': 'CREATE TABLE migration_probe (id int); INSERT INTO migration_probe VALUES (1);',
      '20260919170002_verify.sql': `DO $$ BEGIN
        IF (SELECT count(*) FROM migration_probe) <> 2 THEN RAISE EXCEPTION 'Rows not replayed'; END IF;
      END $$;`,
    })
    expect(result.error).toBeUndefined()
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain('Replayed 3 migrations')
    expect(result.stdout).toContain('Passed: privilege_and_consent_security.sql')
  }, 20_000)

  for (const mode of ['--all', '--baseline']) {
    it(`rejects the #44/#68 version collision before executing SQL or filtering ${mode}`, () => {
      const first = '20260919170000_deny_policies_grant_nothing.sql'
      const second = '20260919170000_no_delete_policy_means_no_delete_grant.sql'
      const result = runMigrations({ [first]: 'SELECT 1;', [second]: 'SELECT 2;' }, mode)
      expect(result.error).toBeUndefined()
      expect(result.status).toBe(1)
      expect(result.stderr).toContain('Duplicate migration version 20260919170000')
      expect(result.stderr).toContain(first)
      expect(result.stderr).toContain(second)
      expect(result.stdout).not.toContain('Disposable database:')
    }, 20_000)
  }

  it('rejects conflict copies before even a preceding migration runs', () => {
    const result = runMigrations({
      '20260919160000_first.sql': "DO $$ BEGIN RAISE EXCEPTION 'SQL ran before validation'; END $$;",
      '20260919170000_fix 2.sql': 'SELECT 1;',
    })
    expect(result.error).toBeUndefined()
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('Invalid migration filename')
    expect(result.stderr).toContain('20260919170000_fix 2.sql')
    expect(result.stderr).not.toContain('SQL ran before validation')
    expect(result.stdout).not.toContain('Disposable database:')
  }, 20_000)
})
