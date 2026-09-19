import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const run = promisify(execFile);
const migration = 'supabase/migrations/20260919202324_academy_consent_authority.sql';

async function replay(mutate = sql => sql) {
  const fixture = await mkdtemp(resolve(tmpdir(), 'trak-consent-mutation-'));
  try {
    await cp(resolve(root, 'scripts'), resolve(fixture, 'scripts'), { recursive: true });
    await cp(resolve(root, 'supabase'), resolve(fixture, 'supabase'), { recursive: true });
    await symlink(resolve(root, 'node_modules'), resolve(fixture, 'node_modules'));
    const file = resolve(fixture, migration);
    await writeFile(file, mutate(await readFile(file, 'utf8')));
    try {
      const result = await run(process.execPath, ['scripts/test-db.mjs', '--academy-consent-review'], {
        cwd: fixture, timeout: 60_000, maxBuffer: 1024 * 1024,
      });
      return { code: 0, output: result.stdout + result.stderr };
    } catch (error) {
      if (!Number.isInteger(error.code)) throw error;
      return { code: error.code, output: error.stdout + error.stderr };
    }
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
}

test('actual RPC role suite passes on the unchanged authority', async () => {
  const result = await replay();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Academy consent authority assertions: 52/);
});

for (const [name, before, after, evidence] of [
  ['academy scope', 'WHERE d.player_user_id = p_child AND d.organization_id = p_org',
    'WHERE d.player_user_id = p_child', 'academy A approval never approves B'],
  ['independent guardians', "AND e.action = 'grant' AND e.purposes->p_purpose = 'true'::jsonb",
    "AND d.parent_user_id = auth.uid() AND e.action = 'grant' AND e.purposes->p_purpose = 'true'::jsonb",
    'one withdrawal leaves another guardian approval active'],
  ['notice replacement', 'AND pr.notice_id = e.notice_id AND pr.enabled',
    'AND pr.enabled', 'new notice requires a new approval'],
  ['stale request check', 'IF v_current.id IS DISTINCT FROM p_expected_event_id THEN',
    'IF false THEN', 'stale expected decision cannot overwrite a grant'],
]) {
  test(`suite rejects a runtime mutation of ${name}`, async () => {
    const result = await replay(sql => {
      assert.equal(sql.split(before).length, 2, 'mutation must target exactly one real rule');
      return sql.replace(before, after);
    });
    assert.equal(result.code, 1, result.output);
    assert.ok(result.output.includes(evidence), result.output);
  });
}
