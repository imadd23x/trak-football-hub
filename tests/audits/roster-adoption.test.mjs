import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { executeRosterSuite, git, inventoryPath, replayCandidate, requireCommit, runnerRoot, suitePath,
  validateInventory, verifyPinnedFiles } from '../../scripts/audits/roster-adoption.mjs';
import { evaluateAuditReport } from '../../scripts/governance/audit-ratchet.mjs';

const sql = await readFile(join(runnerRoot, suitePath), 'utf8');
const bootstrap = await readFile(join(runnerRoot, 'supabase/tests/bootstrap.sql'), 'utf8');
const inventory = validateInventory(JSON.parse(await readFile(join(runnerRoot, inventoryPath), 'utf8')));
const revision = git(runnerRoot, ['rev-parse', 'HEAD']).trim();
const db = new PGlite();
let migrationCount;
before(async () => { migrationCount = await replayCandidate(db, runnerRoot, revision, bootstrap); });
after(async () => { await db.close(); });

const mutate = addition => sql.replace('SET LOCAL ROLE authenticated;', `${addition}\nSET LOCAL ROLE authenticated;`);
const failed = results => results.filter(item => item.status === 'fail').map(item => item.id);
const evaluator = results => evaluateAuditReport({ version: 1, suites: [{ id: inventory.id,
  sourceRevision: revision, runnerRevision: revision, inventoryRevision: revision,
  assertions: inventory.assertions.map(item => ({ ...item, expected: 'pass' })) }] },
{ version: 1, candidateRevision: revision, suites: [{ id: inventory.id, sourceRevision: revision,
  runnerRevision: revision, inventoryRevision: revision, status: 'complete', assertions: results }] }, revision);

test('real candidate replay: authenticated exact adoption/idempotency and conservative identity safety', async t => {
  const result = await executeRosterSuite(db, sql, inventory);
  t.diagnostic(`${migrationCount} candidate migrations; ${result.length} assertions; ${result.filter(item => item.kind === 'control').length} controls`);
  assert.deepEqual(failed(result), []);
  assert.equal(result.length, 21);
  assert.equal(evaluator(result).ok, true);
});

test('restrictive assessment policy is a failed same-actor positive control, never passing denial evidence', async () => {
  const result = await executeRosterSuite(db, mutate(`CREATE POLICY audit_deny_read ON public.coach_assessments
    AS RESTRICTIVE FOR SELECT TO authenticated USING (false);`), inventory);
  for (const id of ['RA-C-exact-read','RA-C-typo-read','RA-C-ambiguous-read']) assert.ok(failed(result).includes(id));
  const evaluation = evaluator(result);
  assert.equal(evaluation.ok, false);
  assert.equal(evaluation.violations.filter(item => item.code === 'failed-control').length, 3);
});

test('exposing all assessment rows fails both wrong-child read checks while the same-actor controls pass', async () => {
  const result = await executeRosterSuite(db, mutate(`CREATE POLICY audit_expose_read ON public.coach_assessments
    FOR SELECT TO authenticated USING (true);`), inventory);
  assert.deepEqual(failed(result).sort(), ['RA-ambiguous-no-wrong-read','RA-typo-no-wrong-read'].sort());
  assert.equal(evaluator(result).ok, false);
});

test('sequential repeat cannot pass by returning the original ID while creating hidden unlinked duplicates', async () => {
  const result = await executeRosterSuite(db, mutate(`
    ALTER FUNCTION public.link_player_to_coach(text) RENAME TO audit_original_link;
    CREATE FUNCTION public.link_player_to_coach(p_code text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $mutant$
    DECLARE linked_id uuid;
    BEGIN
      linked_id := public.audit_original_link(p_code);
      IF auth.uid() = pg_temp.rid(20) THEN
        INSERT INTO public.squad_players (coach_user_id, player_name, status)
        VALUES (pg_temp.rid(10), 'Synthetic Yusuf Exact', 'active');
      END IF;
      RETURN linked_id;
    END;
    $mutant$;`), inventory);
  assert.deepEqual(failed(result), ['RA-exact-one-link']);
  assert.equal(evaluator(result).ok, false);
});

test('returning a control-coach membership is not successful linkage to the requested coach', async () => {
  const result = await executeRosterSuite(db, mutate(`
    ALTER FUNCTION public.link_player_to_coach(text) RENAME TO audit_original_link;
    CREATE FUNCTION public.link_player_to_coach(p_code text) RETURNS uuid
    LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $mutant$
    BEGIN
      IF auth.uid() = pg_temp.rid(21) THEN RETURN pg_temp.rid(51); END IF;
      IF auth.uid() = pg_temp.rid(22) THEN RETURN pg_temp.rid(52); END IF;
      RETURN public.audit_original_link(p_code);
    END;
    $mutant$;`), inventory);
  assert.deepEqual(failed(result).sort(), ['RA-typo-own-link','RA-ambiguous-own-link'].sort());
  assert.ok(result.filter(item => item.kind === 'control').every(item => item.status === 'pass'));
  assert.equal(evaluator(result).ok, false);
});

const wrapper = body => `
  ALTER FUNCTION public.link_player_to_coach(text) RENAME TO audit_original_link;
  CREATE FUNCTION public.link_player_to_coach(p_code text) RETURNS uuid
  LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $mutant$
  BEGIN
    IF auth.uid() = pg_temp.rid(22) THEN ${body} END IF;
    RETURN public.audit_original_link(p_code);
  END;
  $mutant$;`;

test('choosing a namesake cannot pass by reducing ambiguous unlinked rows', async () => {
  const result = await executeRosterSuite(db, mutate(wrapper(`
    UPDATE public.squad_players SET linked_player_id=auth.uid() WHERE id=pg_temp.rid(32);
    RETURN pg_temp.rid(32);`)), inventory);
  for (const id of ['RA-ambiguous-own-link','RA-ambiguous-no-wrong-read','RA-ambiguous-identities']) assert.ok(failed(result).includes(id));
  assert.ok(result.filter(item => item.kind === 'control').every(item => item.status === 'pass'));
  assert.equal(evaluator(result).ok, false);
});

test('deleting one namesake and cascading their history cannot pass preservation checks', async () => {
  const result = await executeRosterSuite(db, mutate(wrapper(`DELETE FROM public.squad_players WHERE id=pg_temp.rid(32);`)), inventory);
  for (const id of ['RA-ambiguous-identities','RA-ambiguous-histories']) assert.ok(failed(result).includes(id));
  assert.equal(evaluator(result).ok, false);
});

test('missing, incomplete, duplicate and misclassified output is fatal', async () => {
  await assert.rejects(executeRosterSuite(db, sql.replace('id AS roster_assertion_id', 'id AS unexpected_id'), inventory), /Missing or duplicate/);
  await assert.rejects(executeRosterSuite(db, sql.replace('FROM pg_temp.roster_results ORDER BY id', "FROM pg_temp.roster_results WHERE id <> 'RA-C-fixture' ORDER BY id"), inventory), /Incomplete/);
  await assert.rejects(executeRosterSuite(db, sql.replace('SELECT id AS roster_assertion_id, kind, status, detail FROM pg_temp.roster_results ORDER BY id;',
    'SELECT id AS roster_assertion_id, kind, status, detail FROM pg_temp.roster_results UNION ALL SELECT id,kind,status,detail FROM pg_temp.roster_results;'), inventory), /Unexpected, duplicate/);
  await assert.rejects(executeRosterSuite(db, sql.replace('id AS roster_assertion_id, kind, status', "id AS roster_assertion_id, 'check' AS kind, status"), inventory), /misclassified/);
});

test('unexpected fixture SQL errors are fatal and every fixture is rolled back', async () => {
  await assert.rejects(executeRosterSuite(db, mutate('SELECT nonexistent_roster_function();'), inventory), /does not exist/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM auth.users WHERE id::text LIKE '95000000-%'")).rows[0].n, 0);
  assert.equal((await db.query('SELECT current_user AS role')).rows[0].role, 'postgres');
  assert.deepEqual(failed(await executeRosterSuite(db, sql, inventory)), []);
});

test('a non-disposable marker is rejected before creating fixtures', async () => {
  await db.exec("SET trak.test_database='not-disposable'");
  try { await assert.rejects(executeRosterSuite(db, sql, inventory), /Refusing roster fixtures/); }
  finally { await db.exec("SET trak.test_database='disposable'"); }
});

test('Git object provenance ignores dirty candidate SQL and rejects changed/missing trusted inputs', async () => {
  const temp = await mkdtemp(join(tmpdir(), 'trak-roster-git-'));
  const other = new PGlite();
  try {
    git(temp, ['init','-q']);
    git(temp, ['config','user.name','Synthetic Audit']);
    git(temp, ['config','user.email','audit@synthetic.test.invalid']);
    await mkdir(join(temp, 'supabase/migrations'), { recursive: true });
    const path = 'supabase/migrations/20260918000000_probe.sql';
    await writeFile(join(temp,path), 'CREATE TABLE provenance(value int); INSERT INTO provenance VALUES (7);');
    git(temp, ['add',path]);
    git(temp, ['commit','-qm','test: disposable provenance']);
    const sha = git(temp, ['rev-parse','HEAD']).trim();
    await verifyPinnedFiles(temp, sha, [path]);
    await writeFile(join(temp,path), 'INVALID DIRTY SQL');
    await assert.rejects(verifyPinnedFiles(temp, sha, [path]), /differs from pinned/);
    await assert.rejects(verifyPinnedFiles(temp, sha, ['missing']), /ENOENT/);
    assert.throws(() => requireCommit(temp, 'HEAD'), /exact lowercase/);
    assert.throws(() => requireCommit(temp, 'f'.repeat(40)));
    assert.equal(await replayCandidate(other, temp, sha, ''), 1);
    assert.deepEqual((await other.query('SELECT * FROM provenance')).rows, [{ value:7 }]);
  } finally {
    await other.close();
    await rm(temp, { recursive:true, force:true });
  }
});
